"""The extension asks for the skill's name and goal after the demonstration; finish accepts them."""
import pytest
from fastapi.testclient import TestClient

from cerebral import api, store
from cerebral.schemas import Action, TraceEvent


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "SKILLS", tmp_path / "skills")
    monkeypatch.setattr(store, "RUNS", tmp_path / "runs")
    monkeypatch.setattr(store, "DEMOS", tmp_path / "runs" / "demos")
    monkeypatch.setattr(store, "LEDGER", tmp_path / "runs" / "ledger.jsonl")
    return TestClient(api.app)


def _demo_with_one_event(tc, home, product):
    demo = tc.post("/demos/start", json={"name": "untitled", "goal": "", "site": home.url}).json()
    ev = TraceEvent(before=home, action=Action(kind="click", target="role=link name=Widget", description="click Widget"), after=product)
    assert tc.post(f"/demos/{demo['id']}/events", json=ev.model_dump()).status_code == 200
    return demo


def test_finish_takes_name_and_goal(client, home, product):
    demo = _demo_with_one_event(client, home, product)
    r = client.post(f"/demos/{demo['id']}/finish", json={"name": "Open the widget", "goal": "The widget page is shown"})
    assert r.status_code == 200, r.text
    skill = r.json()
    assert skill["name"] == "Open the widget"
    assert skill["goal"] == "The widget page is shown"
    assert skill["site"] == home.url
    assert len(skill["steps"]) == 1


def test_finish_without_body_keeps_demo_fields(client, home, product):
    demo = _demo_with_one_event(client, home, product)
    r = client.post(f"/demos/{demo['id']}/finish")
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "untitled"
