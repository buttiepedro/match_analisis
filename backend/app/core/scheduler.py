"""
Recordatorio de turno de nutrición: el primer trabajo del backend que se
dispara por **tiempo**, no por un request.

`APScheduler` en el mismo proceso, no Celery/Redis: [[despliegue]] corre un
solo backend, y sumar una cola y un worker para un job que corre una vez por
hora sería infraestructura para un problema que no la necesita. Si el
despliegue algún día escala a más de una instancia, este job pasa a
necesitar un lock (`SELECT ... FOR UPDATE SKIP LOCKED`) — se deja anotado
para no repetir el problema, no se resuelve ahora porque hoy no existe.
"""
import logging
from datetime import datetime, timedelta, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.core.notifications import notify
from app.models import NotificationType, NutritionSlot, NutritionSlotStatus, Player

logger = logging.getLogger(__name__)

#: Ventana de aviso: entre 20 y 24 horas antes del turno. Ni tan justo que no
#: dé tiempo a reorganizarse, ni tan lejos que se olvide para cuando llegue.
REMINDER_WINDOW_MIN_HOURS = 20
REMINDER_WINDOW_MAX_HOURS = 24

_scheduler: AsyncIOScheduler | None = None


async def send_nutrition_reminders() -> int:
    """
    Por cada turno reservado en la ventana, sin recordatorio mandado:
    `notify()` primero, `reminder_sent_at` **recién después**. Si el proceso
    se reinicia entre el envío y la escritura, en el peor caso el
    recordatorio se manda dos veces — no cero. Preferible a perderlo.

    Devuelve cuántos se mandaron, para el log y para los tests.
    """
    now = datetime.now(timezone.utc)
    window_start = now + timedelta(hours=REMINDER_WINDOW_MIN_HOURS)
    window_end = now + timedelta(hours=REMINDER_WINDOW_MAX_HOURS)

    sent = 0
    async with AsyncSessionLocal() as db:
        rows = (
            await db.execute(
                select(NutritionSlot).where(
                    NutritionSlot.status == NutritionSlotStatus.reservado,
                    NutritionSlot.starts_at >= window_start,
                    NutritionSlot.starts_at <= window_end,
                    NutritionSlot.reminder_sent_at.is_(None),
                )
            )
        ).scalars().all()

        for slot in rows:
            player = await db.scalar(select(Player).where(Player.id == slot.player_id))
            if not player or not player.user_id:
                continue

            when = slot.starts_at.strftime("%d/%m a las %H:%M")
            try:
                await notify(
                    db,
                    user_id=player.user_id,
                    club_id=slot.club_id,
                    type=NotificationType.turno_recordatorio,
                    title="Turno mañana",
                    body=f"Tenés turno con la nutricionista el {when}.",
                )
            except Exception:
                # No se marca `reminder_sent_at`: el próximo pase del job
                # (dentro de una hora) lo va a volver a intentar.
                logger.exception("No se pudo notificar el recordatorio del turno %s", slot.id)
                continue

            slot.reminder_sent_at = datetime.now(timezone.utc)
            await db.commit()
            sent += 1

    return sent


def start_scheduler() -> None:
    """Se llama una vez, desde el `lifespan` de la app."""
    global _scheduler
    if _scheduler is not None:
        return
    _scheduler = AsyncIOScheduler()
    _scheduler.add_job(
        send_nutrition_reminders, "interval", hours=1, id="nutrition_reminders", replace_existing=True
    )
    _scheduler.start()


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
