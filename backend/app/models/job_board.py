import enum
import uuid
from datetime import date, datetime
from typing import Optional

from sqlalchemy import Date, DateTime, Enum, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class JobKind(str, enum.Enum):
    ofrece = "ofrece"
    busca = "busca"


class JobStatus(str, enum.Enum):
    pendiente = "pendiente"
    publicado = "publicado"
    rechazado = "rechazado"


class JobPost(Base):
    """
    Aviso de la bolsa de trabajo del club.

    **No es público**: publica el contacto de un socio, así que se ve sólo con
    sesión iniciada y capacidad `bolsa.ver`. Hacerla pública sería un problema de
    datos personales, no una decisión de producto.
    """

    __tablename__ = "job_posts"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    club_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clubs.id"), nullable=False)
    author_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    kind: Mapped[JobKind] = mapped_column(Enum(JobKind), nullable=False)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    #: Cómo contactar al autor. Lo escribe él: puede no querer dar su teléfono.
    contact: Mapped[str] = mapped_column(String(200), nullable=False)
    category: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    #: Imagen de portada. Es lo que hace que el aviso se lea como una publicación
    #: y no como un renglón de una lista.
    cover_image_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    status: Mapped[JobStatus] = mapped_column(
        Enum(JobStatus), nullable=False, default=JobStatus.pendiente, server_default="pendiente"
    )
    #: Motivo del rechazo, para que el autor sepa qué corregir.
    moderation_note: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    moderated_by: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("users.id"), nullable=True)
    published_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    #: **Obligatorio.** Una bolsa llena de avisos de hace dos años deja de leerse,
    #: y ahí ya no la recupera nadie. Se calcula al aprobar y se puede renovar.
    expires_on: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    author: Mapped["User"] = relationship(foreign_keys=[author_id], lazy="selectin")
    attachments: Mapped[list["JobAttachment"]] = relationship(
        back_populates="post", cascade="all, delete-orphan", lazy="selectin"
    )


class JobAttachment(Base):
    """
    Un archivo colgado de un aviso: el CV, un presupuesto, una foto del trabajo.

    Se guarda el nombre original **sólo para mostrarlo**. La clave en S3 es
    aleatoria: el nombre que eligió quien subió el archivo no decide dónde queda
    guardado ni cómo se sirve.
    """

    __tablename__ = "job_attachments"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    post_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("job_posts.id", ondelete="CASCADE"), nullable=False
    )
    url: Mapped[str] = mapped_column(String(500), nullable=False)
    filename: Mapped[str] = mapped_column(String(200), nullable=False)
    content_type: Mapped[str] = mapped_column(String(100), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    post: Mapped["JobPost"] = relationship(back_populates="attachments")

    @property
    def is_image(self) -> bool:
        return self.content_type.startswith("image/")
