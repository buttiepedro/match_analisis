"""
Portada, archivos y página propia de un aviso.

Dos cosas son las que importan acá, y ninguna es que la imagen se vea:

1. **Qué se acepta subir.** Una lista blanca de tipos y un tope de tamaño. Un
   archivo subido por un socio que el browser *renderiza* en el dominio del
   bucket no es una comodidad, es un XSS almacenado — por eso los documentos
   salen con `Content-Disposition: attachment`.
2. **Quién puede leer la página de un aviso.** El listado esconde los vencidos;
   si el detalle no hiciera lo mismo, cualquiera con el link seguiría leyendo un
   aviso vencido con el teléfono adentro.
"""
import io
import uuid
from datetime import date, timedelta

import pytest
from sqlalchemy import select

from app.api.v1.job_board import MAX_ATTACHMENTS, _excerpt, _initials
from app.core.permissions import SOCIO
from app.core.storage import MAX_IMAGE_BYTES
from app.models import JobAttachment, JobPost, Role, UserRole, user_roles

from tests.conftest import auth_header, login, make_user


# ── Doble de S3 ───────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def fake_s3(monkeypatch):
    """
    Reemplaza S3 por un diccionario.

    Los tests no pueden depender de credenciales, pero sí tienen que ejercitar la
    validación **antes** de la subida, que es donde están las decisiones.
    """
    guardado: dict[str, dict] = {}

    def put_object(key, content, content_type, *, download_as=None):
        guardado[key] = {
            "content": content,
            "content_type": content_type,
            "download_as": download_as,
        }
        return f"https://cdn.test/{key}"

    def delete_object(key):
        guardado.pop(key, None)

    def key_from_url(url):
        return url.replace("https://cdn.test/", "") if url.startswith("https://cdn.test/") else None

    import app.api.v1.job_board as modulo

    monkeypatch.setattr(modulo, "put_object", put_object)
    monkeypatch.setattr(modulo, "delete_object", delete_object)
    monkeypatch.setattr(modulo, "key_from_url", key_from_url)
    return guardado


@pytest.fixture
async def aviso(client, db, club_admin_ctx):
    """Un socio con un aviso propio, y el admin que modera."""
    club = club_admin_ctx["club"]
    socio_role = await db.scalar(
        select(Role).where(Role.club_id == club.id, Role.name == SOCIO)
    )
    user = await make_user(db, email="ana@example.com", role=UserRole.player, club_id=club.id)
    await db.execute(user_roles.insert().values(user_id=user.id, role_id=socio_role.id))
    await db.commit()
    tokens = await login(client, user.email)
    headers = auth_header(tokens["access_token"])

    res = await client.post(
        f"/clubs/{club.id}/job-posts",
        json={
            "kind": "busca",
            "title": "Busco changas de albañilería",
            "description": "Tengo herramientas propias.",
            "contact": "11-5555-5555",
        },
        headers=headers,
    )
    assert res.status_code == 201, res.text

    return {
        "club": club,
        "id": res.json()["id"],
        "headers": headers,
        "author": user,
        "admin_headers": club_admin_ctx["headers"],
    }


def archivo(nombre: str, content_type: str, size: int = 64):
    return {"file": (nombre, io.BytesIO(b"x" * size), content_type)}


# ── Portada ───────────────────────────────────────────────────────────────────

async def test_the_author_can_add_a_cover_image(client, aviso, fake_s3):
    res = await client.post(
        f"/job-posts/{aviso['id']}/cover",
        files=archivo("foto.png", "image/png"),
        headers=aviso["headers"],
    )
    assert res.status_code == 200, res.text
    assert res.json()["cover_image_url"].startswith("https://cdn.test/")
    assert len(fake_s3) == 1


async def test_replacing_the_cover_deletes_the_old_file(client, aviso, fake_s3):
    """Si no, cada cambio de imagen deja basura pagada en el bucket."""
    await client.post(
        f"/job-posts/{aviso['id']}/cover",
        files=archivo("uno.png", "image/png"),
        headers=aviso["headers"],
    )
    await client.post(
        f"/job-posts/{aviso['id']}/cover",
        files=archivo("dos.png", "image/png"),
        headers=aviso["headers"],
    )
    assert len(fake_s3) == 1, "queda sólo la última"


async def test_a_pdf_is_not_accepted_as_a_cover(client, aviso):
    res = await client.post(
        f"/job-posts/{aviso['id']}/cover",
        files=archivo("cv.pdf", "application/pdf"),
        headers=aviso["headers"],
    )
    assert res.status_code == 400


async def test_an_oversized_image_is_refused(client, aviso):
    res = await client.post(
        f"/job-posts/{aviso['id']}/cover",
        files=archivo("grande.png", "image/png", size=MAX_IMAGE_BYTES + 1),
        headers=aviso["headers"],
    )
    assert res.status_code == 413


# ── Archivos ──────────────────────────────────────────────────────────────────

async def test_the_author_can_attach_a_document(client, aviso):
    res = await client.post(
        f"/job-posts/{aviso['id']}/attachments",
        files=archivo("cv.pdf", "application/pdf"),
        headers=aviso["headers"],
    )
    assert res.status_code == 201, res.text
    assert res.json()["filename"] == "cv.pdf"
    assert res.json()["is_image"] is False


async def test_a_document_is_stored_to_be_downloaded_not_rendered(client, aviso, fake_s3):
    """
    La regla de seguridad del módulo.

    Un archivo que el browser abre en el dominio del bucket es un XSS almacenado.
    Las imágenes sí se muestran: su tipo ya está en la lista blanca.
    """
    await client.post(
        f"/job-posts/{aviso['id']}/attachments",
        files=archivo("cv.pdf", "application/pdf"),
        headers=aviso["headers"],
    )
    await client.post(
        f"/job-posts/{aviso['id']}/attachments",
        files=archivo("obra.png", "image/png"),
        headers=aviso["headers"],
    )

    guardados = {v["content_type"]: v["download_as"] for v in fake_s3.values()}
    assert guardados["application/pdf"] == "cv.pdf", "se descarga"
    assert guardados["image/png"] is None, "se muestra"


async def test_an_executable_is_refused(client, aviso):
    """Una lista de prohibidos siempre se queda corta; ésta es una lista blanca."""
    for nombre, tipo in [
        ("virus.exe", "application/x-msdownload"),
        ("pagina.html", "text/html"),
        ("script.js", "application/javascript"),
        ("raro.bin", ""),
    ]:
        res = await client.post(
            f"/job-posts/{aviso['id']}/attachments",
            files=archivo(nombre, tipo),
            headers=aviso["headers"],
        )
        assert res.status_code == 400, f"{nombre} no debería entrar"


async def test_there_is_a_ceiling_on_attachments(client, aviso):
    """Un aviso con quince archivos ya no se lee, y hay que moderarlo."""
    for i in range(MAX_ATTACHMENTS):
        res = await client.post(
            f"/job-posts/{aviso['id']}/attachments",
            files=archivo(f"doc{i}.pdf", "application/pdf"),
            headers=aviso["headers"],
        )
        assert res.status_code == 201, res.text

    res = await client.post(
        f"/job-posts/{aviso['id']}/attachments",
        files=archivo("uno-mas.pdf", "application/pdf"),
        headers=aviso["headers"],
    )
    assert res.status_code == 409


async def test_deleting_an_attachment_removes_the_file(client, db, aviso, fake_s3):
    res = await client.post(
        f"/job-posts/{aviso['id']}/attachments",
        files=archivo("cv.pdf", "application/pdf"),
        headers=aviso["headers"],
    )
    attachment_id = res.json()["id"]

    res = await client.delete(
        f"/job-posts/{aviso['id']}/attachments/{attachment_id}", headers=aviso["headers"]
    )
    assert res.status_code == 204
    assert fake_s3 == {}
    assert (await db.execute(select(JobAttachment))).scalars().first() is None


async def test_taking_the_post_down_takes_the_files_with_it(client, db, aviso, fake_s3):
    """
    Bajar el aviso es arrepentirse de haber publicado algo.

    Dejar la imagen y el CV accesibles por URL sería no cumplir con eso.
    """
    await client.post(
        f"/job-posts/{aviso['id']}/cover",
        files=archivo("foto.png", "image/png"),
        headers=aviso["headers"],
    )
    await client.post(
        f"/job-posts/{aviso['id']}/attachments",
        files=archivo("cv.pdf", "application/pdf"),
        headers=aviso["headers"],
    )
    assert len(fake_s3) == 2

    res = await client.delete(f"/job-posts/{aviso['id']}", headers=aviso["headers"])
    assert res.status_code == 204
    assert fake_s3 == {}


# ── Quién puede subir ─────────────────────────────────────────────────────────

async def test_only_the_author_uploads(client, db, aviso):
    """El moderador aprueba o rechaza lo que el otro armó; no lo edita por él."""
    res = await client.post(
        f"/job-posts/{aviso['id']}/cover",
        files=archivo("foto.png", "image/png"),
        headers=aviso["admin_headers"],
    )
    assert res.status_code == 403


# ── La página del aviso ───────────────────────────────────────────────────────

async def test_a_live_post_has_its_own_page(client, db, aviso):
    await client.post(
        f"/job-posts/{aviso['id']}/moderate",
        json={"approve": True},
        headers=aviso["admin_headers"],
    )

    otro = await make_user(
        db, email="bruno@example.com", role=UserRole.player, club_id=aviso["club"].id
    )
    socio_role = await db.scalar(
        select(Role).where(Role.club_id == aviso["club"].id, Role.name == SOCIO)
    )
    await db.execute(user_roles.insert().values(user_id=otro.id, role_id=socio_role.id))
    await db.commit()
    tokens = await login(client, otro.email)

    res = await client.get(
        f"/job-posts/{aviso['id']}", headers=auth_header(tokens["access_token"])
    )
    assert res.status_code == 200, res.text
    assert res.json()["contact"] == "11-5555-5555"
    assert res.json()["author_initials"] == "AN" or len(res.json()["author_initials"]) <= 2


async def test_a_pending_post_has_no_page_for_others(client, db, aviso):
    """Si no, moderar no serviría: alcanzaría con tener el link."""
    otro = await make_user(
        db, email="curioso@example.com", role=UserRole.player, club_id=aviso["club"].id
    )
    socio_role = await db.scalar(
        select(Role).where(Role.club_id == aviso["club"].id, Role.name == SOCIO)
    )
    await db.execute(user_roles.insert().values(user_id=otro.id, role_id=socio_role.id))
    await db.commit()
    tokens = await login(client, otro.email)

    res = await client.get(
        f"/job-posts/{aviso['id']}", headers=auth_header(tokens["access_token"])
    )
    assert res.status_code == 404


async def test_an_expired_post_has_no_page_for_others(client, db, aviso):
    """El listado los esconde; con el link se seguían leyendo, teléfono incluido."""
    await client.post(
        f"/job-posts/{aviso['id']}/moderate",
        json={"approve": True},
        headers=aviso["admin_headers"],
    )
    post = await db.scalar(select(JobPost).where(JobPost.id == uuid.UUID(aviso["id"])))
    post.expires_on = date.today() - timedelta(days=1)
    await db.commit()

    otro = await make_user(
        db, email="tarde@example.com", role=UserRole.player, club_id=aviso["club"].id
    )
    socio_role = await db.scalar(
        select(Role).where(Role.club_id == aviso["club"].id, Role.name == SOCIO)
    )
    await db.execute(user_roles.insert().values(user_id=otro.id, role_id=socio_role.id))
    await db.commit()
    tokens = await login(client, otro.email)

    res = await client.get(
        f"/job-posts/{aviso['id']}", headers=auth_header(tokens["access_token"])
    )
    assert res.status_code == 404

    # Su autor sí lo ve: es su aviso, y tiene que poder renovarlo.
    res = await client.get(f"/job-posts/{aviso['id']}", headers=aviso["headers"])
    assert res.status_code == 200
    assert res.json()["status"] == "vencido"


# ── Resumen de la tarjeta ─────────────────────────────────────────────────────

def test_the_excerpt_drops_the_formatting_marks():
    assert _excerpt("**Urgente** y _serio_") == "Urgente y serio"
    assert _excerpt("## Título\n- uno\n- dos") == "Título uno dos"


def test_the_excerpt_does_not_cut_a_word_in_half():
    texto = "palabra " * 60
    recorte = _excerpt(texto)
    assert recorte.endswith("…")
    assert "palabr…" not in recorte


def test_short_text_is_not_truncated():
    assert _excerpt("Dos líneas nada más") == "Dos líneas nada más"


def test_initials_handle_one_word_and_many():
    assert _initials("Ana Perez") == "AP"
    assert _initials("Ana") == "AN"
    assert _initials("Ana Maria Perez Gomez") == "AG"
    assert _initials("") == "?"
