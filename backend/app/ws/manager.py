import asyncio
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

from fastapi import WebSocket


@dataclass
class InMemoryTimer:
    session_id: str
    current_half: int = 1
    status: str = "stopped"
    base_elapsed: int = 0
    started_at: Optional[datetime] = None

    def elapsed(self) -> int:
        if self.status == "running" and self.started_at:
            return self.base_elapsed + int(
                (datetime.now(timezone.utc) - self.started_at).total_seconds()
            )
        return self.base_elapsed

    def snapshot(self) -> dict:
        return {
            "session_id": self.session_id,
            "half": self.current_half,
            "status": self.status,
            "elapsed_seconds": self.elapsed(),
            "server_timestamp": datetime.now(timezone.utc).isoformat(),
        }

    def apply(self, action: str) -> bool:
        now = datetime.now(timezone.utc)

        if action == "start":
            if self.status == "stopped":
                self.current_half = 1
                self.base_elapsed = 0
                self.started_at = now
                self.status = "running"
            elif self.status == "halftime":
                self.current_half = 2
                self.base_elapsed = 0
                self.started_at = now
                self.status = "running"
            else:
                return False
        elif action == "pause" and self.status == "running":
            self.base_elapsed = self.elapsed()
            self.started_at = None
            self.status = "paused"
        elif action == "resume" and self.status == "paused":
            self.started_at = now
            self.status = "running"
        elif action == "halftime" and self.status == "running" and self.current_half == 1:
            self.base_elapsed = self.elapsed()
            self.started_at = None
            self.status = "halftime"
        elif action == "finish" and self.status not in ("stopped", "finished"):
            self.base_elapsed = self.elapsed()
            self.started_at = None
            self.status = "finished"
        else:
            return False

        return True


class ConnectionManager:
    def __init__(self) -> None:
        self._conns: dict[str, list[WebSocket]] = defaultdict(list)
        self._timers: dict[str, InMemoryTimer] = {}
        self._tasks: dict[str, asyncio.Task] = {}

    # ── Connections ──────────────────────────────────────────────────────────

    async def connect(self, session_id: str, ws: WebSocket) -> None:
        await ws.accept()
        self._conns[session_id].append(ws)
        self._ensure_tick(session_id)

    def disconnect(self, session_id: str, ws: WebSocket) -> None:
        conns = self._conns.get(session_id, [])
        if ws in conns:
            conns.remove(ws)

    async def send(self, ws: WebSocket, data: dict) -> None:
        try:
            await ws.send_json(data)
        except Exception:
            pass

    async def broadcast(self, session_id: str, data: dict) -> None:
        dead: list[WebSocket] = []
        for ws in list(self._conns.get(session_id, [])):
            try:
                await ws.send_json(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(session_id, ws)

    # ── Timer ────────────────────────────────────────────────────────────────

    def init_timer(self, session_id: str, db_state=None) -> InMemoryTimer:
        if session_id not in self._timers:
            if db_state is not None:
                t = InMemoryTimer(
                    session_id=session_id,
                    current_half=db_state.current_half,
                    status=db_state.status.value,
                    base_elapsed=db_state.elapsed_seconds,
                    started_at=db_state.started_at,
                )
            else:
                t = InMemoryTimer(session_id=session_id)
            self._timers[session_id] = t
        return self._timers[session_id]

    def get_timer(self, session_id: str) -> Optional[InMemoryTimer]:
        return self._timers.get(session_id)

    def apply_action(self, session_id: str, action: str) -> Optional[InMemoryTimer]:
        t = self._timers.get(session_id)
        if not t:
            return None
        if not t.apply(action):
            return None
        self._ensure_tick(session_id)
        return t

    # ── Background tick ──────────────────────────────────────────────────────

    def _ensure_tick(self, session_id: str) -> None:
        task = self._tasks.get(session_id)
        if not task or task.done():
            self._tasks[session_id] = asyncio.create_task(
                self._tick_loop(session_id)
            )

    async def _tick_loop(self, session_id: str) -> None:
        while self._conns.get(session_id):
            t = self._timers.get(session_id)
            if t and t.status == "running":
                await self.broadcast(session_id, {"type": "timer_tick", "data": t.snapshot()})
            await asyncio.sleep(1)
        self._tasks.pop(session_id, None)


manager = ConnectionManager()
