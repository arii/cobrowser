# File: services/agent-orchestrator/src/sponsors/meta_muse.py
import os
from typing import Any

from openai import OpenAI

META_BASE_URL = "https://api.meta.ai/v1"
DEFAULT_MUSE_MODEL = "muse-spark-1.3"


def get_meta_client() -> OpenAI:
    """Initializes the OpenAI SDK pointed at Meta Model API (MODEL_API_KEY = LLM|{id}|{secret})."""
    api_key = os.environ.get("MODEL_API_KEY", "")
    if not api_key:
        raise RuntimeError("MODEL_API_KEY environment variable is required for Meta Model API.")
    return OpenAI(base_url=META_BASE_URL, api_key=api_key)


def compile_browser_skill_with_muse(
    accessibility_snapshot: str,
    user_demonstration_events: list[dict[str, Any]],
    goal: str,
) -> dict[str, Any]:
    """
    Uses Muse Spark 1.3 (1M context window + high reasoning effort) to compile a recorded
    human co-browsing demonstration into a deterministic Playwright code skill.
    """
    client = get_meta_client()
    response = client.chat.completions.create(
        model=DEFAULT_MUSE_MODEL,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a Deterministic Skill Compiler. Given a page accessibility snapshot "
                    "and a trace of human co-browsing actions, output a reusable Playwright async "
                    "code block that executes the workflow deterministically with self-healing assertions."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Goal: {goal}\n\n"
                    f"Demonstration Trace:\n{user_demonstration_events}\n\n"
                    f"Accessibility Snapshot:\n{accessibility_snapshot}"
                ),
            },
        ],
        extra_body={
            "reasoning_effort": "high",
            "include": ["reasoning.encrypted_content"],
        },
    )
    choice = response.choices[0].message
    return {
        "compiled_playwright_code": choice.content or "",
        "model": DEFAULT_MUSE_MODEL,
        "usage": response.usage.model_dump() if response.usage else {},
    }
