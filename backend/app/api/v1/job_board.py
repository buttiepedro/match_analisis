"""
Bolsa de trabajo del club.

Dos decisiones definen si se usa o se abandona:

1. **Expiración obligatoria.** Una bolsa llena de avisos de hace dos años deja de
   leerse, y ahí ya no la recupera nadie.
2. **No es pública.** Publica el contacto de un socio: verla exige sesión y
   capacidad. Hacerla pública es un problema de datos personales.
"""
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import (
    assert_club_access,
    get_club_or_404,
    has_permission,
    require,
)
from app.core.permissions import Permission
from app.models import JobKind, JobPost, JobStatus, User
from app.schemas.job_board import (
    JobPostCreate,
    JobPostModeration,
    JobPostResponse,
    JobPostUpdate,
)

router = APIRouter()

#: Vigencia por defecto de un aviso aprobado. Renovable.
DEFAULT_DAYS = 30


def _is_expired(post: JobPost) -> bool:
    return bool(post.expires_on and post.expires_on < date.today())


def _to_response(post: JobPost, *, viewer: User) -> JobPostResponse:
    # El contacto sólo se muestra en avisos vigentes. En uno vencido o rechazado
    # es un teléfono de un socio circulando sin motivo.
    visible = post.status == JobStatus.publicado and not _is_expired(post)
    own = post.author_id == viewer.id

    return JobPostResponse(
        id=post.id,
        kind=post.kind.value,
        title=post.title,
        description=post.description,
        contact=post.contact if (visible or own) else None,
        category=post.category,
        status="vencido" if _is_expired(post) else post.status.value,
        moderation_note=post.moderation_note if own else None,
        author_name=post.author.full_name,
        is_mine=own,
        published_at=post.published_at,
        expires_on=post.expires_on,
    )


async def _get_post_or_404(post_id: uuid.UUID, db: AsyncSession, viewer: User) -> JobPost:
    post = await db.scalar(select(JobPost).where(JobPost.id == post_id))
    if not post:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Aviso no encontrado")
    club = await get_club_or_404(post.club_id, db)
    assert_club_access(club, viewer)
    return post


@router.get("/clubs/{club_id}/job-posts", response_model=list[JobPostResponse])
async def list_posts(
    club_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.bolsa_ver))],
    mine: Annotated[bool, Query()] = False,
    pending: Annotated[bool, Query()] = False,
):
    """
    Avisos vigentes.

    `mine` trae los propios en cualquier estado — el autor tiene que poder ver el
    suyo pendiente o rechazado. `pending` es la cola de moderación.
    """
    club = await get_club_or_404(club_id, db)
    assert_club_access(club, current_user)

    query = select(JobPost).where(JobPost.club_id == club.id)

    if mine:
        query = query.where(JobPost.author_id == current_user.id)
    elif pending:
        if not has_permission(current_user, Permission.bolsa_moderar):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="No podés moderar la bolsa"
            )
        query = query.where(JobPost.status == JobStatus.pendiente)
    else:
        query = query.where(JobPost.status == JobStatus.publicado)

    posts = (await db.execute(query.order_by(JobPost.created_at.desc()))).scalars().all()

    # Los vencidos se filtran al leer en vez de marcarlos con una tarea
    # programada: así "vencido" siempre es exacto y no hace falta un scheduler.
    if not mine and not pending:
        posts = [p for p in posts if not _is_expired(p)]

    return [_to_response(p, viewer=current_user) for p in posts]


@router.post(
    "/clubs/{club_id}/job-posts",
    response_model=JobPostResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_post(
    club_id: uuid.UUID,
    body: JobPostCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.bolsa_publicar))],
):
    """Queda `pendiente`: lo publica alguien con `bolsa.moderar`."""
    club = await get_club_or_404(club_id, db)
    assert_club_access(club, current_user)

    for field, value in (("título", body.title), ("descripción", body.description), ("contacto", body.contact)):
        if not value.strip():
            raise HTTPException(status_code=400, detail=f"Falta el {field}")

    post = JobPost(
        id=uuid.uuid4(),
        club_id=club.id,
        author_id=current_user.id,
        kind=JobKind(body.kind),
        title=body.title.strip(),
        description=body.description.strip(),
        contact=body.contact.strip(),
        category=body.category,
        status=JobStatus.pendiente,
    )
    db.add(post)
    await db.commit()
    await db.refresh(post)
    return _to_response(post, viewer=current_user)


@router.patch("/job-posts/{post_id}", response_model=JobPostResponse)
async def update_post(
    post_id: uuid.UUID,
    body: JobPostUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.bolsa_publicar))],
):
    """
    El autor corrige su aviso. Vuelve a `pendiente`: si editar dejara el aviso
    publicado, la moderación no serviría de nada.
    """
    post = await _get_post_or_404(post_id, db, current_user)
    if post.author_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No es tu aviso")

    for field in ("title", "description", "contact", "category"):
        value = getattr(body, field)
        if value is not None:
            setattr(post, field, value.strip() if isinstance(value, str) else value)
    if body.kind is not None:
        post.kind = JobKind(body.kind)

    post.status = JobStatus.pendiente
    post.moderation_note = None
    post.published_at = None
    post.expires_on = None

    await db.commit()
    await db.refresh(post)
    return _to_response(post, viewer=current_user)


@router.post("/job-posts/{post_id}/moderate", response_model=JobPostResponse)
async def moderate_post(
    post_id: uuid.UUID,
    body: JobPostModeration,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.bolsa_moderar))],
):
    post = await _get_post_or_404(post_id, db, current_user)

    if body.approve:
        post.status = JobStatus.publicado
        post.published_at = datetime.now(timezone.utc)
        post.expires_on = date.today() + timedelta(days=body.days or DEFAULT_DAYS)
        post.moderation_note = None
    else:
        post.status = JobStatus.rechazado
        # Sin motivo, el autor no sabe qué corregir y vuelve a mandar lo mismo.
        post.moderation_note = body.note

    post.moderated_by = current_user.id
    await db.commit()
    await db.refresh(post)
    return _to_response(post, viewer=current_user)


@router.post("/job-posts/{post_id}/renew", response_model=JobPostResponse)
async def renew_post(
    post_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.bolsa_publicar))],
    days: Annotated[int, Query(ge=1, le=180)] = DEFAULT_DAYS,
):
    """Renovar es del autor: si sigue buscando, no tiene que pedir permiso otra vez."""
    post = await _get_post_or_404(post_id, db, current_user)
    if post.author_id != current_user.id and not has_permission(
        current_user, Permission.bolsa_moderar
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No es tu aviso")
    if post.status != JobStatus.publicado:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Sólo se renueva un aviso ya publicado",
        )

    post.expires_on = date.today() + timedelta(days=days)
    await db.commit()
    await db.refresh(post)
    return _to_response(post, viewer=current_user)


@router.delete("/job-posts/{post_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_post(
    post_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.bolsa_publicar))],
):
    """
    El autor baja su aviso cuando quiere.

    Es la contracara de publicar su teléfono: si se arrepiente, no tiene que pedirle
    permiso a nadie.
    """
    post = await _get_post_or_404(post_id, db, current_user)
    if post.author_id != current_user.id and not has_permission(
        current_user, Permission.bolsa_moderar
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No es tu aviso")

    await db.delete(post)
    await db.commit()
