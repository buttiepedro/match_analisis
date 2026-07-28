import hashlib
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    get_password_hash,
    verify_password,
)
from app.models import Club, RefreshToken, User
from app.schemas.auth import (
    ChangePasswordRequest,
    AccessTokenResponse,
    LoginRequest,
    LogoutRequest,
    RefreshRequest,
    TokenResponse,
)
from app.schemas.user import UserResponse

router = APIRouter(prefix="/auth")


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def _resolve_login(body: LoginRequest, db: AsyncSession) -> User | None:
    """
    Resuelve el usuario por email o por DNI.

    El DNI es único **por club**, así que la misma persona puede ser socia de dos
    clubes. Si resuelve a más de uno se pide el club en vez de elegir por el
    usuario: con un club nunca se dispara, y evita rehacer el login el día que
    haya dos.
    """
    if body.email:
        return await db.scalar(select(User).where(User.email == body.email))

    if not body.document_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Indicá tu email o tu DNI",
        )

    query = select(User).where(User.document_id == body.document_id)
    if body.club_slug:
        query = query.join(Club, Club.id == User.club_id).where(Club.slug == body.club_slug)

    matches = (await db.execute(query)).scalars().all()

    if len(matches) > 1:
        clubs = (
            await db.execute(
                select(Club.slug, Club.name).where(
                    Club.id.in_([u.club_id for u in matches if u.club_id])
                )
            )
        ).all()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "message": "Ese DNI está en más de un club. Elegí cuál.",
                "clubs": [{"slug": slug, "name": name} for slug, name in clubs],
            },
        )

    return matches[0] if matches else None


@router.post("/login", response_model=TokenResponse)
async def login(
    body: LoginRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    user = await _resolve_login(body, db)

    if not user or not user.is_active or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    token_data = {
        "sub": str(user.id),
        "role": user.role.value,
        "club_id": str(user.club_id) if user.club_id else None,
    }
    access_token = create_access_token(token_data)
    refresh_token = create_refresh_token({"sub": str(user.id)})
    expires_at = datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)

    db.add(RefreshToken(
        id=uuid.uuid4(),
        user_id=user.id,
        token_hash=_hash(refresh_token),
        expires_at=expires_at,
    ))
    await db.commit()

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        user=UserResponse.model_validate(user),
        must_change_password=user.must_change_password,
    )


@router.post("/refresh", response_model=AccessTokenResponse)
async def refresh(
    body: RefreshRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    try:
        payload = decode_token(body.refresh_token)
        if payload.get("type") != "refresh":
            raise ValueError("not a refresh token")
        user_id = uuid.UUID(payload["sub"])
    except (JWTError, KeyError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")

    stored = await db.scalar(
        select(RefreshToken).where(
            RefreshToken.token_hash == _hash(body.refresh_token),
            RefreshToken.revoked.is_(False),
            RefreshToken.expires_at > datetime.now(timezone.utc),
        )
    )
    if not stored:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expired or revoked")

    user = await db.scalar(
        select(User).where(User.id == user_id, User.is_active.is_(True))
    )
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    token_data = {
        "sub": str(user.id),
        "role": user.role.value,
        "club_id": str(user.club_id) if user.club_id else None,
    }
    return AccessTokenResponse(access_token=create_access_token(token_data))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    body: LogoutRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    stored = await db.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == _hash(body.refresh_token))
    )
    if stored:
        stored.revoked = True
        await db.commit()


@router.get("/me", response_model=UserResponse)
async def me(
    current_user: Annotated[User, Depends(get_current_user)],
):
    return UserResponse.model_validate(current_user)


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    body: ChangePasswordRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Baja el flag `must_change_password`, que es lo que destraba el resto de la app."""
    if not verify_password(body.current_password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="La contraseña actual no coincide"
        )
    if len(body.new_password) < 8:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="La contraseña nueva necesita al menos 8 caracteres",
        )
    if body.new_password == body.current_password:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="La contraseña nueva tiene que ser distinta de la actual",
        )

    current_user.password_hash = get_password_hash(body.new_password)
    current_user.must_change_password = False
    await db.commit()
