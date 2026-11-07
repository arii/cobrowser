"""Demonstration traces are recorded to disk as they arrive, not held in process memory until finish.

The raw trace is the data a skill was derived from. Losing it on restart means a skill can never be
re-derived, inspected or compared to its replay.
"""
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
    monkeypatch.setattr(api, "_demos", {})
    return TestClient(api.app)


def _event(before, after, target="role=link name=Widget"):
    return TraceEvent(before=before, action=Action(kind="click", target=target, description="click"), after=after).model_dump()


def test_every_event_is_on_disk_before_finish(client, home, product, cart):
    demo = client.post("/demos/start", json={"name": "untitled", "goal": "", "site": home.url}).json()
    assert store.load_demo(demo["id"]).events == []

    client.post(f"/demos/{demo['id']}/events", json=_event(home, product))
    assert len(store.load_demo(demo["id"]).events) == 1
    client.post(f"/demos/{demo['id']}/events", json=_event(product, cart, "role=button name=Add to cart"))
    on_disk = store.load_demo(demo["id"])
    assert len(on_disk.events) == 2
    assert on_disk.events[1].before.url == product.url and on_disk.events[1].after.url == cart.url
    assert on_disk.finished_at is None and on_disk.skill_id == ""


def test_demo_survives_process_memory_loss(client, home, product):
    demo = client.post("/demos/start", json={"name": "untitled", "goal": "", "site": home.url}).json()
    client.post(f"/demos/{demo['id']}/events", json=_event(home, product))

    api._demos.clear()  # what a restart does

    r = client.get(f"/demos/{demo['id']}")
    assert r.status_code == 200
    assert len(r.json()["events"]) == 1
    # And the demonstration can still be continued and finished from the reloaded copy.
    assert client.post(f"/demos/{demo['id']}/events", json=_event(product, home)).status_code == 200
    r = client.post(f"/demos/{demo['id']}/finish", json={"name": "Round trip", "goal": "back home"})
    assert r.status_code == 200, r.text
    assert len(r.json()["steps"]) == 2


def test_finish_links_skill_and_recording_both_ways(client, home, product):
    demo = client.post("/demos/start", json={"name": "untitled", "goal": "", "site": home.url}).json()
    client.post(f"/demos/{demo['id']}/events", json=_event(home, product))
    skill = client.post(f"/demos/{demo['id']}/finish", json={"name": "Open widget", "goal": ""}).json()

    assert skill["demo_id"] == demo["id"]
    assert store.load_skill(skill["id"]).demo_id == demo["id"]
    saved = store.load_demo(demo["id"])
    assert saved.skill_id == skill["id"] and saved.finished_at
    assert saved.name == "Open widget"  # the name given at finish is kept on the recording too


def test_list_demos_summarises_without_events(client, home, product):
    a = client.post("/demos/start", json={"name": "a", "goal": "", "site": home.url}).json()
    b = client.post("/demos/start", json={"name": "b", "goal": "", "site": home.url}).json()
    client.post(f"/demos/{a['id']}/events", json=_event(home, product))

    r = client.get("/demos")
    assert r.status_code == 200
    by_id = {d["id"]: d for d in r.json()}
    assert set(by_id) == {a["id"], b["id"]}
    assert by_id[a["id"]]["events"] == 1 and by_id[b["id"]]["events"] == 0
    assert "before" not in str(r.json())  # summaries carry counts, not snapshots


def test_unknown_demo_is_404(client):
    assert client.get("/demos/dm_nope").status_code == 404
    assert client.post("/demos/dm_nope/events", json=_event(
        __import__("conftest").snap("https://x.test/", []), __import__("conftest").snap("https://x.test/a", []))).status_code == 404
