"""Minimal smoke test: every orchestrator surface imports without side effects."""

import os
import sys

sys.path.insert(
    0,
    os.path.join(os.path.dirname(__file__), "..", "src"),
)

from browser_cdp import BrowserCDPService
from server import app
from sponsors.meta_muse import compile_browser_skill_with_muse
from sponsors.mongo_memory import AtlasSkillMemory


def test_imports() -> None:
    calls: list[tuple[str, dict]] = []

    def fake_send(method: str, params: dict) -> dict:
        calls.append((method, params))
        return {}

    service = BrowserCDPService(send_command=fake_send)
    service.inject_cursor()
    assert calls and calls[0][0] == "Runtime.evaluate"

    assert callable(compile_browser_skill_with_muse)

    memory = AtlasSkillMemory(uri="mongodb://localhost:27017", db_name="cobrowse_smoke")
    assert memory.skills is not None
    memory.client.close()

    paths = {route.path for route in app.routes}
    assert "/health" in paths
