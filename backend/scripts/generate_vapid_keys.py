#!/usr/bin/env python3
"""
Genera un par de claves VAPID para notificaciones push, listas para pegar
en el `.env` del backend.

    python scripts/generate_vapid_keys.py

Son claves del **origen** (esta instalación), no del club: se generan **una
sola vez**, no una por club. Perderlas no rompe nada retroactivo — las
suscripciones viejas del navegador simplemente dejan de aceptar push nuevo y
hay que volver a activarlo desde el perfil del jugador.
"""
import base64

from cryptography.hazmat.primitives import serialization
from py_vapid import Vapid02


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def main() -> None:
    vapid = Vapid02()
    vapid.generate_keys()

    private_raw = vapid.private_key.private_numbers().private_value.to_bytes(32, "big")
    public_raw = vapid.public_key.public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )

    print("Pegá esto en el .env del backend:\n")
    print(f"VAPID_PUBLIC_KEY={_b64url(public_raw)}")
    print(f"VAPID_PRIVATE_KEY={_b64url(private_raw)}")
    print("VAPID_SUBJECT=mailto:admin@tudominio.com  # cambiar por un contacto real")


if __name__ == "__main__":
    main()
