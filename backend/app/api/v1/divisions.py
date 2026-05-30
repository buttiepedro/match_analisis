import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import assert_club_access, get_club_or_404, get_current_user, require_club_admin
from app.models import Division, User
from app.schemas.division import DivisionCreate, DivisionResponse

router = APIRouter(prefix="/clubs")


@router.post("/{club_id}/divisions", response_model=DivisionResponse, status_code=status.HTTP_201_CREATED)
async def create_division(
    club_id: uuid.UUID,
    body: DivisionCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_club_admin)],
):
    club = await get_club_or_404(club_id, db)
    assert_club_access(club, current_user)

    division = Division(id=uuid.uuid4(), club_id=club.id, name=body.name)
    db.add(division)
    await db.commit()
    await db.refresh(division)
    return division


@router.get("/{club_id}/divisions", response_model=list[DivisionResponse])
async def list_divisions(
    club_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    club = await get_club_or_404(club_id, db)
    assert_club_access(club, current_user)

    result = await db.execute(
        select(Division)
        .where(Division.club_id == club.id, Division.is_active.is_(True))
        .order_by(Division.name)
    )
    return result.scalars().all()
