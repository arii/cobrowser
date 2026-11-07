"""Driver protocol for the browser worker, plus the HTTP implementation and an in-memory fake for tests."""
from __future__ import annotations

import os
from typing import Protocol

import httpx

from .schemas import Action, Snapshot


class ControlLost(Exception):
    """The worker refused the action because a human holds the session (HTTP 409)."""


class ActionFailed(Exception):
    """The worker could not perform the action (HTTP 422); carries the snapshot it took afterwards."""
    def __init__(self, message: str, snapshot: Snapshot | None) -> None:
        super().__init__(message)
        self.snapshot = snapshot


class Driver(Protocol):
    async def snapshot(self, session_id: str) -> Snapshot: ...
    async def act(self, session_id: str, action: Action) -> Snapshot: ...
    async def wait(self, session_id: str, ms: int) -> None: ...
    async def set_control(self, session_id: str, who: str) -> None: ...  # "agent" | "human"


class HttpDriver:
    def __init__(self, base: str | None = None) -> None:
        self.base = (base or os.getenv("BROWSER_URL", "http://localhost:8010")).rstrip("/")

    async def _post(self, path: str, body: dict) -> dict:
        async with httpx.AsyncClient(timeout=90) as c:
            r = await c.post(f"{self.base}{path}", json=body)
            r.raise_for_status()
            return r.json()

    async def snapshot(self, session_id: str) -> Snapshot:
        return Snapshot.model_validate(await self._post("/snapshot", {"sessionId": session_id}))

    async def act(self, session_id: str, action: Action) -> Snapshot:
        async with httpx.AsyncClient(timeout=90) as c:
            r = await c.post(f"{self.base}/act", json={"sessionId": session_id, "action": action.model_dump()})
        if r.status_code == 409:
            raise ControlLost(r.text)
        if r.status_code == 422:
            body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
            snap = Snapshot.model_validate(body["snapshot"]) if body.get("snapshot") else None
            raise ActionFailed(str(body.get("error", r.text)), snap)
        r.raise_for_status()
        return Snapshot.model_validate(r.json())

    async def wait(self, session_id: str, ms: int) -> None:
        await self._post("/wait", {"sessionId": session_id, "ms": ms})

    async def set_control(self, session_id: str, who: str) -> None:
        await self._post("/control", {"sessionId": session_id, "who": who})


class ScriptedDriver:
    """Test double: returns snapshots from a queue, records actions.

    The first queue item is the initial page. Each act() or wait() consumes the next item. A queue
    item may be an exception (ControlLost, ActionFailed, ...) instead of a Snapshot: act() raises
    it, and an ActionFailed that carries a snapshot makes that snapshot the current page first, the
    way the worker's 422 body does.
    """
    def __init__(self, snapshots: list[Snapshot | BaseException]) -> None:
        self.queue = list(snapshots)
        self.actions: list[Action] = []
        self.control: list[str] = []
        self.waits: list[int] = []
        first = self.queue.pop(0)
        if isinstance(first, BaseException):
            raise ValueError("ScriptedDriver needs an initial Snapshot")
        self.current: Snapshot = first

    def _advance(self) -> None:
        if not self.queue:
            return
        nxt = self.queue.pop(0)
        if isinstance(nxt, BaseException):
            if isinstance(nxt, ActionFailed) and nxt.snapshot is not None:
                self.current = nxt.snapshot
            raise nxt
        self.current = nxt

    async def snapshot(self, session_id: str) -> Snapshot:
        return self.current

    async def act(self, session_id: str, action: Action) -> Snapshot:
        self.actions.append(action)
        self._advance()
        return self.current

    async def wait(self, session_id: str, ms: int) -> None:
        self.waits.append(ms)
        self._advance()

    async def set_control(self, session_id: str, who: str) -> None:
        self.control.append(who)
