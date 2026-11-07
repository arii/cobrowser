"""Fetch.ai uAgents: publish run receipts and let other agents re-verify them.

Optional and off the run path. Install with `uv sync --extra agents`, run with
`uv run python -m cerebral.uagent`. Verification itself is pure (receipt.verify), so a peer
agent can confirm a run without trusting the runner. Whether this earns its place is an
open question in DESIGN.md.
"""
from __future__ import annotations

import os

from . import receipt as receipt_mod
from .store import load_run

try:
    from uagents import Agent, Context, Model
except ImportError:  # optional extra not installed
    Agent = Context = Model = None  # type: ignore[assignment,misc]


if Model is not None:

    class ReceiptAnnounce(Model):
        run_id: str
        skill_id: str
        skill_version: int
        final_link: str
        receipt_link: str  # the seal to compare; final_link alone does not commit to success
        success: bool

    class VerifyRequest(Model):
        run_id: str

    class VerifyResponse(Model):
        run_id: str
        ok: bool
        problems: list[str]
        final_link: str
        receipt_link: str

    _port = os.getenv("UAGENT_PORT", "8020")
    agent = Agent(name="cerebral-receipts", seed=os.getenv("UAGENT_SEED", "cerebral-dev-seed"),
                  port=int(_port), endpoint=[f"http://localhost:{_port}/submit"])

    @agent.on_message(model=VerifyRequest, replies=VerifyResponse)
    async def handle_verify(ctx: Context, sender: str, msg: VerifyRequest) -> None:
        try:
            run = load_run(msg.run_id)
            ok, problems = receipt_mod.verify(run.receipt)
            await ctx.send(sender, VerifyResponse(run_id=msg.run_id, ok=ok, problems=problems,
                                                  final_link=run.receipt.final_link,
                                                  receipt_link=run.receipt.receipt_link))
        except FileNotFoundError:
            await ctx.send(sender, VerifyResponse(run_id=msg.run_id, ok=False, problems=["unknown run"], final_link="", receipt_link=""))

    def announce_payload(run_id: str) -> ReceiptAnnounce:
        run = load_run(run_id)
        return ReceiptAnnounce(run_id=run.id, skill_id=run.skill_id, skill_version=run.skill_version,
                               final_link=run.receipt.final_link, receipt_link=run.receipt.receipt_link,
                               success=run.receipt.success)


if __name__ == "__main__":
    if Agent is None:
        raise SystemExit("install with: uv sync --extra agents")
    agent.run()
