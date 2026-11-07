"""Local open-source mode: AI surfaces degrade clearly without API keys."""

import os
import sys

sys.path.insert(
    0,
    os.path.join(os.path.dirname(__file__), "..", "src"),
)

import pytest
import server
from fastapi.testclient import TestClient
from sponsors.meta_muse import get_meta_client
from sponsors.mongo_memory import AtlasSkillMemory
from sponsors.subq_trace import analyze_long_dom_trace_diff


def test_run_returns_error_when_agent_build_fails(monkeypatch) -> None:
    async def boom(*args, **kwargs):
        raise RuntimeError("MODEL_API_KEY environment variable is required.")

    monkeypatch.setattr(server, "build_cobrowse_deep_agent", boom)
    client = TestClient(server.app)
    response = client.post("/api/sessions/t-nokeys/run", json={"prompt": "hi"})
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ERROR"
    assert body["thread_id"] == "t-nokeys"
    assert "MODEL_API_KEY" in body["detail"]


def test_meta_client_requires_key(monkeypatch) -> None:
    monkeypatch.delenv("MODEL_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="MODEL_API_KEY"):
        get_meta_client()


def test_mongo_placeholder_falls_back_to_localhost() -> None:
    memory = AtlasSkillMemory(uri="mongodb+srv://<user>:<password>@x/?retryWrites=true")
    assert memory.uri == "mongodb://localhost:27017"
    memory.client.close()


def test_subq_requires_key(monkeypatch) -> None:
    monkeypatch.delenv("SUBQ_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="SUBQ_API_KEY"):
        analyze_long_dom_trace_diff("run1", "run2")
