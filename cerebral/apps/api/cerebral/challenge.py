"""Bot-check / CAPTCHA detection.

A challenge page is the one kind of step the agent must never attempt or learn. The run loop hands
off the moment it sees one (no repair budget spent), and a correction recorded while the human was
clearing a challenge is treated as *unblocking the run*, not as a fix to the step: the skill keeps
its original action and postconditions. Detection is deliberately simple and conservative: text
markers on the page plus well-known widget names. It never tries to interact with the challenge.
"""
from __future__ import annotations

import re

from .schemas import Action, Snapshot, TraceEvent

_TEXT_MARKERS = (
    "captcha", "verify you are human", "verify you're human", "are you a robot", "i'm not a robot",
    "unusual traffic", "checking your browser", "checking if the site connection is secure",
    "this will only take a few seconds", "drag the slider", "slide to verify", "press and hold",
    "security check", "access denied", "bot protection", "just a moment",
)
_ACTION_MARKERS = re.compile(r"captcha|slider|slide to verify|press and hold|i'?m not a robot|verify you", re.I)
_URL_MARKERS = re.compile(r"captcha|challenge|/cdn-cgi/|verify|sorry/index|bot-?check", re.I)


def looks_like_challenge(snap: Snapshot) -> str | None:
    """Returns the marker that matched, or None."""
    low = (snap.text or "").lower()
    for m in _TEXT_MARKERS:
        if m in low:
            return f"page text: {m!r}"
    for n in snap.tree:
        if _ACTION_MARKERS.search(n.name or ""):
            return f"widget: {n.role} {n.name!r}"
    if _URL_MARKERS.search(snap.url or "") and len(snap.tree) <= 3:
        return f"url: {snap.url}"
    return None


def action_is_challenge(action: Action) -> bool:
    return bool(_ACTION_MARKERS.search((action.target or "") + " " + (action.description or "")))


def trace_is_challenge(trace: list[TraceEvent]) -> str | None:
    """A recorded correction that is really the human clearing a bot check."""
    for ev in trace:
        if action_is_challenge(ev.action):
            return f"action: {ev.action.target or ev.action.description}"
        why = looks_like_challenge(ev.before)
        if why:
            return why
    return None
