"""Meta AI (Llama) adapter via an OpenAI-compatible endpoint.

Generation jobs, all off the critical path: name steps from a demo trace, propose semantic
goal checks, and act as the fallback judge when Subq is not configured. Without META_API_KEY
every method degrades to a deterministic stub so the system still runs.
"""
from __future__ import annotations

import json
import os

import httpx

from ..schemas import Action, Assertion, AssertionKind
from ..verifier import JUDGE_THRESHOLD


class MetaClient:
    def __init__(self) -> None:
        self.base = os.getenv("META_API_BASE", "https://api.llama.com/compat/v1").rstrip("/")
        self.key = os.getenv("META_API_KEY", "")
        self.model_name = os.getenv("META_MODEL", "Llama-4-Maverick-17B-128E-Instruct-FP8")

    @property
    def enabled(self) -> bool:
        return bool(self.key)

    async def _chat(self, system: str, user: str) -> str:
        async with httpx.AsyncClient(timeout=60) as c:
            r = await c.post(
                f"{self.base}/chat/completions",
                headers={"Authorization": f"Bearer {self.key}"},
                json={
                    "model": self.model_name,
                    "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
                    "temperature": 0,
                    "response_format": {"type": "json_object"},
                },
            )
            r.raise_for_status()
            return r.json()["choices"][0]["message"]["content"]

    async def judge(self, claim: str, evidence: str) -> tuple[bool, float, str]:
        """Implements verifier.Judge. Fails closed: any transport or parse error, or a reply that
        is not a JSON object, is a failed verdict; 'holds' passes only at or above JUDGE_THRESHOLD,
        the same bar SubqJudge applies."""
        if not self.enabled:
            return (False, 0.0, "judge disabled: META_API_KEY unset")
        try:
            raw = await self._chat(
                "You verify claims about a web page strictly from the evidence given. "
                'Reply JSON: {"holds": bool, "confidence": 0..1, "reason": str}. '
                "If the evidence does not clearly support the claim, holds=false.",
                f"CLAIM:\n{claim}\n\nEVIDENCE:\n{evidence}",
            )
            d = json.loads(raw)
            if not isinstance(d, dict):
                raise TypeError("judge reply is not a JSON object")
            holds = bool(d.get("holds"))
            confidence = float(d.get("confidence", 0))
            reason = str(d.get("reason", ""))
        except Exception as e:
            return (False, 0.0, f"meta unavailable: {type(e).__name__}")
        if not (0.0 <= confidence <= 1.0):  # also rejects NaN
            return (False, 0.0, f"meta returned confidence out of range: {confidence!r}")
        ok = holds and confidence >= JUDGE_THRESHOLD
        return (ok, confidence, f"meta holds={holds} confidence={confidence:.2f}: {reason}")

    async def name_steps(self, actions: list[Action]) -> list[str]:
        fallback = [a.description or f"{a.kind} {a.target or a.value or ''}".strip() for a in actions]
        if not self.enabled:
            return fallback
        try:
            raw = await self._chat(
                'Name each browser action in 2-5 words. Reply JSON: {"names": [str, ...]} same length as input.',
                json.dumps([a.model_dump() for a in actions]),
            )
            names = json.loads(raw).get("names", [])
        except Exception:  # generation is off the critical path: a bad reply must not break demo_finish
            return fallback
        if len(names) != len(actions):
            return fallback
        # A blank or non-string name falls back per step; a Step requires a name.
        return [str(n).strip() if isinstance(n, str) and n.strip() else fb for n, fb in zip(names, fallback)]

    async def propose_goal_checks(self, goal: str, final_text: str) -> list[Assertion]:
        if not self.enabled:
            return []
        try:
            raw = await self._chat(
                "Given a task goal and the final page text, write 1-3 checkable claims that would be true "
                'only if the goal was achieved. Reply JSON: {"claims": [str, ...]}.',
                f"GOAL: {goal}\n\nFINAL PAGE TEXT:\n{final_text[:4000]}",
            )
            claims = json.loads(raw).get("claims", [])
        except Exception:  # no goal checks is a weaker skill, not a failed demonstration
            return []
        if not isinstance(claims, list):
            return []
        # Assertion.expected has min_length=1: drop blank or non-string claims instead of raising.
        return [Assertion(kind=AssertionKind.semantic, expected=c.strip(), source="model")
                for c in claims if isinstance(c, str) and c.strip()][:3]
