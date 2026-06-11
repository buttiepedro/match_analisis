import uuid
from typing import Annotated

import boto3
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import assert_club_access, get_club_or_404, get_current_user, require_club_admin
from app.models import Division, Event, MatchLineup, Player, User
from app.schemas.player import PlayerCreate, PlayerResponse, PlayerUpdate


def _s3_client():
    if not settings.AWS_S3_BUCKET:
        raise HTTPException(status_code=501, detail="S3 no configurado (AWS_S3_BUCKET faltante)")
    return boto3.client(
        "s3",
        region_name=settings.AWS_REGION,
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
    )


def _s3_public_url(key: str) -> str:
    if settings.AWS_S3_PUBLIC_URL:
        base = settings.AWS_S3_PUBLIC_URL.rstrip("/")
        return f"{base}/{key}"
    return f"https://{settings.AWS_S3_BUCKET}.s3.{settings.AWS_REGION}.amazonaws.com/{key}"

router = APIRouter(prefix="/divisions")


async def _get_division_or_404(division_id: uuid.UUID, db: AsyncSession) -> Division:
    d = await db.scalar(select(Division).where(Division.id == division_id))
    if not d:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Division not found")
    return d


@router.post("/{division_id}/players", response_model=PlayerResponse, status_code=status.HTTP_201_CREATED)
async def create_player(
    division_id: uuid.UUID,
    body: PlayerCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_club_admin)],
):
    division = await _get_division_or_404(division_id, db)
    club = await get_club_or_404(division.club_id, db)
    assert_club_access(club, current_user)

    player = Player(
        id=uuid.uuid4(),
        division_id=division.id,
        name=body.name,
        position=body.position,
        dni=body.dni or None,
    )
    db.add(player)
    await db.commit()
    await db.refresh(player)
    return player


@router.get("/{division_id}/players", response_model=list[PlayerResponse])
async def list_players(
    division_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    division = await _get_division_or_404(division_id, db)
    club = await get_club_or_404(division.club_id, db)
    assert_club_access(club, current_user)

    result = await db.execute(
        select(Player)
        .where(Player.division_id == division.id, Player.is_active.is_(True))
        .order_by(Player.name)
    )
    return result.scalars().all()


@router.patch("/{division_id}/players/{player_id}", response_model=PlayerResponse)
async def update_player(
    division_id: uuid.UUID,
    player_id: uuid.UUID,
    body: PlayerUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_club_admin)],
):
    division = await _get_division_or_404(division_id, db)
    club = await get_club_or_404(division.club_id, db)
    assert_club_access(club, current_user)

    player = await db.scalar(
        select(Player).where(Player.id == player_id, Player.division_id == division.id)
    )
    if not player:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Player not found")

    if body.name is not None:
        player.name = body.name
    if body.position is not None:
        player.position = body.position
    if body.dni is not None:
        player.dni = body.dni or None
    if body.is_active is not None:
        player.is_active = body.is_active
    if body.division_id is not None:
        new_div = await db.scalar(select(Division).where(Division.id == body.division_id))
        if not new_div or new_div.club_id != division.club_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid division")
        player.division_id = body.division_id

    await db.commit()
    await db.refresh(player)
    return player


@router.delete("/{division_id}/players/{player_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_player(
    division_id: uuid.UUID,
    player_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_club_admin)],
):
    division = await _get_division_or_404(division_id, db)
    club = await get_club_or_404(division.club_id, db)
    assert_club_access(club, current_user)

    player = await db.scalar(
        select(Player).where(Player.id == player_id, Player.division_id == division.id)
    )
    if not player:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Player not found")

    player.is_active = False
    await db.commit()


class AbsorbRequest(BaseModel):
    target_id: uuid.UUID


@router.post("/{division_id}/players/{player_id}/absorb", response_model=PlayerResponse)
async def absorb_player(
    division_id: uuid.UUID,
    player_id: uuid.UUID,
    body: AbsorbRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_club_admin)],
):
    division = await _get_division_or_404(division_id, db)
    club = await get_club_or_404(division.club_id, db)
    assert_club_access(club, current_user)

    keeper = await db.scalar(
        select(Player).where(Player.id == player_id, Player.is_active.is_(True))
    )
    if not keeper:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Jugador a mantener no encontrado")

    target = await db.scalar(
        select(Player).where(Player.id == body.target_id, Player.is_active.is_(True))
    )
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Jugador a absorber no encontrado")

    if keeper.id == target.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No se puede unificar un jugador consigo mismo")

    # Verify both belong to the same club via their divisions
    target_div = await db.scalar(select(Division).where(Division.id == target.division_id))
    if not target_div or target_div.club_id != division.club_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Los jugadores deben pertenecer al mismo club")

    # Reassign all lineup entries from target to keeper
    await db.execute(
        update(MatchLineup)
        .where(MatchLineup.player_id == target.id)
        .values(player_id=keeper.id)
    )

    # Reassign all event entries from target to keeper
    await db.execute(
        update(Event)
        .where(Event.player_id == target.id)
        .values(player_id=keeper.id)
    )

    # Copy DNI from target to keeper if keeper has none
    if not keeper.dni and target.dni:
        keeper.dni = target.dni

    # Soft-delete the absorbed player
    target.is_active = False

    await db.commit()
    await db.refresh(keeper)
    return keeper


@router.post("/{division_id}/players/{player_id}/photo", response_model=PlayerResponse)
async def upload_player_photo(
    division_id: uuid.UUID,
    player_id: uuid.UUID,
    file: Annotated[UploadFile, File(...)],
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_club_admin)],
):
    if file.content_type not in ("image/png", "image/jpeg", "image/webp"):
        raise HTTPException(status_code=400, detail="Solo se aceptan imágenes PNG, JPEG o WebP")

    division = await _get_division_or_404(division_id, db)
    club = await get_club_or_404(division.club_id, db)
    assert_club_access(club, current_user)

    player = await db.scalar(
        select(Player).where(Player.id == player_id, Player.division_id == division.id)
    )
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")

    ext = "png" if file.content_type == "image/png" else ("jpg" if file.content_type == "image/jpeg" else "webp")
    key = f"players/{player_id}.{ext}"
    content = await file.read()

    try:
        s3 = _s3_client()
        s3.put_object(
            Bucket=settings.AWS_S3_BUCKET,
            Key=key,
            Body=content,
            ContentType=file.content_type,
        )
    except (BotoCoreError, ClientError) as e:
        raise HTTPException(status_code=502, detail=f"Error al subir a S3: {e}")

    player.profile_photo_url = _s3_public_url(key)
    await db.commit()
    await db.refresh(player)
    return player
