# File: services/agent-orchestrator/src/deep_browser_agent.py
import os
from typing import Any

from deepagents import create_deep_agent
from langchain_core.tools import tool
from langchain_stagehand import StagehandMiddleware
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import interrupt
from stagehand import Stagehand, local_browser

ACTIVE_BROWSER_SESSIONS: dict[str, dict[str, Any]] = {}


async def get_or_create_stagehand_session(
    thread_id: str, cdp_url: str | None = None
) -> dict[str, Any]:
    """Attaches Stagehand v4.4 to Steel Browser container (:9223) or crash-safe local Chrome."""
    if thread_id in ACTIVE_BROWSER_SESSIONS:
        return ACTIVE_BROWSER_SESSIONS[thread_id]

    steel_base = os.environ.get("STEEL_API_URL", "http://127.0.0.1:3000")
    effective_cdp = cdp_url or os.environ.get("REMOTE_SERVER_CDP_URL", "ws://127.0.0.1:9223")

    if effective_cdp:
        browser = await local_browser.connect(cdp_url=effective_cdp)
        live_view_url = f"{steel_base}/ui"
    else:
        browser = await local_browser.launch(headless=True, keep_alive=True)
        live_view_url = f"{os.environ.get('REMOTE_SERVER_PUBLIC_URL', 'http://localhost:8000')}/cobrowse/{thread_id}"

    stagehand = await Stagehand.create(browser=browser)
    session_bundle = {
        "browser": browser,
        "stagehand": stagehand,
        "live_view_url": live_view_url,
        "mode": "agent_active",
    }
    ACTIVE_BROWSER_SESSIONS[thread_id] = session_bundle
    return session_bundle


@tool
def request_human_cobrowse_handoff(thread_id: str, reason: str, current_url: str) -> str:
    """
    Call IMMEDIATELY on login walls, MFA/2FA prompts, CAPTCHAs, or ambiguous UI states.
    Pauses autonomous execution and yields the live browser canvas to the human operator.
    """
    session = ACTIVE_BROWSER_SESSIONS.get(thread_id, {})
    session["mode"] = "human_handoff"
    live_url = session.get("live_view_url", "http://127.0.0.1:3000/ui")

    human_resolution = interrupt(
        {
            "event": "browser_handoff_requested",
            "thread_id": thread_id,
            "reason": reason,
            "current_url": current_url,
            "live_view_url": live_url,
            "instructions": "Complete the action in the Live View canvas, then click 'Hand Back'.",
        }
    )

    session["mode"] = "agent_active"
    return (
        f"Human operator returned control (note: {human_resolution}). "
        "IMPORTANT: Call `snapshot` immediately to inspect the updated accessibility tree."
    )


async def build_cobrowse_deep_agent(
    thread_id: str,
    repo_root: str = ".",
    model_name: str | None = None,
):
    """Constructs the Deep Agent with isolated Stagehand browser subagent and checkpointer."""
    resolved_model = model_name or os.environ.get("COBROWSE_MODEL", "openai:muse-spark-1.3")
    session = await get_or_create_stagehand_session(thread_id)
    stagehand_mw = StagehandMiddleware(stagehand=session["stagehand"])

    browser_subagent_spec = {
        "name": "browser-cobrowse-specialist",
        "description": "Dedicated browser automation, skill compilation, and interactive co-browsing agent.",
        "system_prompt": (
            "You control a live persistent browser via Stagehand (`snapshot`, `run`, `screenshot`) "
            "and `request_human_cobrowse_handoff`.\n"
            "Rules:\n"
            "1. Always call `snapshot` first to get bracketed element IDs (e.g., [0-7]).\n"
            "2. Batch sequential interactions (fill, click, waitForFunction) into a single `run` call.\n"
            "3. Never guess credentials or bypass MFA. Call `request_human_cobrowse_handoff` with "
            f"thread_id='{thread_id}' whenever authentication or human demonstration is needed."
        ),
        "tools": [request_human_cobrowse_handoff],
        "middleware": [stagehand_mw],
    }

    checkpointer = InMemorySaver()
    return create_deep_agent(
        model=resolved_model,
        system_prompt=(
            "You are the Lead Co-Browsing & Skill-Compilation Agent. Delegate web interactions to "
            "`browser-cobrowse-specialist` and compile demonstrated trajectories into reusable skills."
        ),
        subagents=[browser_subagent_spec],
        memory=[os.path.join(repo_root, ".agents/AGENT_CONTRACT.md")],
        interrupt_on={"execute": False},
        checkpointer=checkpointer,
    )
