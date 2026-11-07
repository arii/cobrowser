# File: services/agent-orchestrator/src/sponsors/subq_trace.py
import os

from openai import OpenAI


def analyze_long_dom_trace_diff(run1_trace: str, run2_failed_trace: str) -> str:
    """Routes multi-run DOM & execution logs through SubQ Snap 1.1 to pinpoint selector drift."""
    if not os.environ.get("SUBQ_API_KEY"):
        raise RuntimeError("SUBQ_API_KEY is not set; SubQ trace analysis needs a SubQ API key.")
    client = OpenAI(
        base_url=os.environ.get("SUBQ_BASE_URL", "https://api.subq.ai/v1"),
        api_key=os.environ.get("SUBQ_API_KEY", ""),
    )
    resp = client.chat.completions.create(
        model="subq-snap-1.1",
        messages=[
            {
                "role": "system",
                "content": "Compare the working Run #1 trace against the failed Run #2 trace and return the exact selector delta.",
            },
            {
                "role": "user",
                "content": f"--- RUN 1 ---\n{run1_trace}\n\n--- RUN 2 ---\n{run2_failed_trace}",
            },
        ],
    )
    return resp.choices[0].message.content or ""
