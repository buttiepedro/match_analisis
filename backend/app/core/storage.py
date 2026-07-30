"""
Subida de archivos a S3.

Vivía dentro de `api/v1/players.py`, que era el único que subía algo. Con la
bolsa de trabajo subiendo portadas y documentos pasan a ser dos, y las reglas de
qué se acepta no pueden quedar escritas dos veces: la que se olvide de una es la
que abre el agujero.
"""
import uuid

import boto3
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import HTTPException, UploadFile, status

from app.core.config import settings

#: Imágenes que se muestran embebidas.
IMAGE_TYPES: dict[str, str] = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
}

#: Documentos que se ofrecen para descargar. Lo que **no** está acá no entra:
#: una lista de prohibidos siempre se queda corta.
DOCUMENT_TYPES: dict[str, str] = {
    "application/pdf": "pdf",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "text/plain": "txt",
    **IMAGE_TYPES,
}

MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_DOCUMENT_BYTES = 10 * 1024 * 1024


def s3_client():
    if not settings.AWS_S3_BUCKET:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="Todavía no está configurado el almacenamiento de archivos del club",
        )
    return boto3.client(
        "s3",
        region_name=settings.AWS_REGION,
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
    )


def public_url(key: str) -> str:
    if settings.AWS_S3_PUBLIC_URL:
        base = settings.AWS_S3_PUBLIC_URL.rstrip("/")
        return f"{base}/{key}"
    return f"https://{settings.AWS_S3_BUCKET}.s3.{settings.AWS_REGION}.amazonaws.com/{key}"


async def read_upload(
    file: UploadFile, *, allowed: dict[str, str], max_bytes: int
) -> tuple[bytes, str, str]:
    """
    Valida y lee el archivo. Devuelve (contenido, content_type, extensión).

    El `content_type` que se devuelve es el **de la lista blanca**, no el que
    mandó el cliente: es el que después se guarda en S3, y dejar pasar el del
    cliente sería dejar que alguien suba un `.html` diciendo que es un PDF y que
    el bucket lo sirva como página.
    """
    content_type = (file.content_type or "").split(";")[0].strip().lower()
    if content_type not in allowed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Tipo de archivo no permitido: {content_type or 'desconocido'}",
        )

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="El archivo está vacío")
    if len(content) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"El archivo supera los {max_bytes // (1024 * 1024)} MB",
        )

    return content, content_type, allowed[content_type]


def put_object(
    key: str, content: bytes, content_type: str, *, download_as: str | None = None
) -> str:
    """
    Guarda el objeto y devuelve su URL pública.

    `download_as` fuerza la descarga con ese nombre en vez de que el browser
    intente mostrarlo. Se usa para los documentos: un archivo subido por un
    socio que el browser **renderiza** en el dominio del bucket es un problema de
    seguridad, no una comodidad.
    """
    extra: dict[str, str] = {"ContentType": content_type}
    if download_as:
        # El nombre se sanea: unas comillas acá y la cabecera se puede partir.
        limpio = "".join(c for c in download_as if c.isalnum() or c in " .-_")[:80]
        extra["ContentDisposition"] = f'attachment; filename="{limpio or "archivo"}"'

    try:
        s3_client().put_object(
            Bucket=settings.AWS_S3_BUCKET, Key=key, Body=content, **extra
        )
    except (BotoCoreError, ClientError) as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"No se pudo guardar el archivo: {exc}",
        )

    return public_url(key)


def delete_object(key: str) -> None:
    """Borra sin hacer ruido: que falle no puede impedir borrar el aviso."""
    try:
        s3_client().delete_object(Bucket=settings.AWS_S3_BUCKET, Key=key)
    except (BotoCoreError, ClientError, HTTPException):
        pass


def key_from_url(url: str) -> str | None:
    """Recupera la clave de S3 desde la URL pública, para poder borrar."""
    if settings.AWS_S3_PUBLIC_URL and url.startswith(settings.AWS_S3_PUBLIC_URL):
        return url[len(settings.AWS_S3_PUBLIC_URL) :].lstrip("/")
    marcador = ".amazonaws.com/"
    if marcador in url:
        return url.split(marcador, 1)[1]
    return None


def new_key(prefix: str, extension: str) -> str:
    """Clave con nombre aleatorio: el del archivo original no se usa nunca."""
    return f"{prefix}/{uuid.uuid4()}.{extension}"
