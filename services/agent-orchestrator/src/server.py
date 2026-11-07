# File: services/agent-orchestrator/src/server.py
from deep_browser_agent import (
    ACTIVE_BROWSER_SESSIONS,
    build_cobrowse_deep_agent,
)
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from langgraph.types import Command
from pydantic import BaseModel

app = FastAPI(title="Co-Browse & Skill Compiler Orchestrator")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

AGENTS_BY_THREAD: dict[str, object] = {}


class RunRequest(BaseModel):
    prompt: str


class HandbackRequest(BaseModel):
    resolution_note: str = "Operator completed manual step in live browser."


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/sessions/{thread_id}/run")
async def run_session(thread_id: str, body: RunRequest) -> dict:
    if thread_id not in AGENTS_BY_THREAD:
        AGENTS_BY_THREAD[thread_id] = await build_cobrowse_deep_agent(thread_id=thread_id)
    agent = AGENTS_BY_THREAD[thread_id]
    config = {"configurable": {"thread_id": thread_id}}
    state = await agent.ainvoke({"messages": [("user", body.prompt)]}, config=config)

    if "__interrupt__" in state:
        return {
            "status": "WAITING_FOR_COBROWSE_HANDOFF",
            "thread_id": thread_id,
            "interrupt": str(state["__interrupt__"]),
            "live_view_url": ACTIVE_BROWSER_SESSIONS.get(thread_id, {}).get(
                "live_view_url", "http://127.0.0.1:3000/ui"
            ),
        }
    return {"status": "COMPLETED", "thread_id": thread_id}


@app.post("/api/sessions/{thread_id}/handback")
async def handback_session(thread_id: str, body: HandbackRequest) -> dict:
    agent = AGENTS_BY_THREAD.get(thread_id)
    if not agent:
        return {"status": "ERROR", "detail": "Session not found"}
    config = {"configurable": {"thread_id": thread_id}}
    state = await agent.ainvoke(Command(resume=body.resolution_note), config=config)
    return {
        "status": "WAITING_FOR_COBROWSE_HANDOFF" if "__interrupt__" in state else "RESUMED",
        "thread_id": thread_id,
    }
