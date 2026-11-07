"""Turn a demonstration trace into a skill with derived assertions.

Only deterministic assertions come from the state diff. Semantic goal checks are
proposed separately by the model adapter and tagged source="model".
"""
from __future__ import annotations

import re
from urllib.parse import urlsplit

from .receipt import normalize_name
from .schemas import A11yNode, Action, Assertion, AssertionKind, Demo, Skill, Snapshot, Step, TraceEvent
from .verifier import parse_anchor

_IGNORED_ROLES = {"generic", "none", "presentation", "StaticText", "text"}
_VOLATILE_LINE = re.compile(r"[\d\s.,:/%$€£-]+|.*\b\d{1,2}:\d{2}(:\d{2})?\b.*")
# Path segments that are per-session identifiers rather than structure: anything with a digit
# (order numbers, "ORD-9", slug-ids, uuids) or a long run of hex (cart/session tokens).
_HEX_SEGMENT = re.compile(r"^[0-9a-fA-F]{8,}$")
# Pages the demonstration started from that no replay can be on (the opening navigate's `before`).
_NON_SITE_SCHEMES = ("about:", "chrome:", "data:")


def _volatile_segment(seg: str) -> bool:
    return any(ch.isdigit() for ch in seg) or bool(_HEX_SEGMENT.match(seg))


def _url_pattern(url: str) -> str:
    """Anchored regex over scheme, host and path; every segment is regex-escaped and volatile
    (identifier-like) segments become [^/]+ so another session's ids still match."""
    p = urlsplit(url)
    segments = (p.path or "/").split("/")
    path = "/".join("[^/]+" if _volatile_segment(seg) else re.escape(seg) for seg in segments)
    return f"^{re.escape(p.scheme + '://' + p.netloc)}{path}"


def _new_nodes(before: Snapshot, after: Snapshot) -> list:
    seen = {(n.role, normalize_name(n.name)) for n in before.tree}
    return [n for n in after.tree if (n.role, normalize_name(n.name)) not in seen
            and n.role not in _IGNORED_ROLES and n.name.strip()]


def _find_target(tree: list[A11yNode], anchor: str) -> A11yNode | None:
    """The node the action's anchor resolves to, by the same rules the verifier uses."""
    want = parse_anchor(anchor)
    want.pop("value", None)
    if "role" not in want and "name" not in want:
        return None
    for n in tree:
        if "role" in want and n.role.lower() != want["role"]:
            continue
        if "name" in want and normalize_name(want["name"]) not in normalize_name(n.name):
            continue
        return n
    return None


def _field_value_assertion(ev: TraceEvent) -> Assertion | None:
    """For type/select: assert the value the field was observed to hold after the action.

    Only what the after-snapshot actually shows is asserted (the page script reports "" for
    password fields and the option label for selects), so the check can pass on replay.
    """
    if ev.action.kind not in ("type", "select") or not ev.action.target:
        return None
    node = _find_target(ev.after.tree, ev.action.target)
    if node is None or not node.value.strip():
        return None
    before = _find_target(ev.before.tree, ev.action.target)
    typed = (ev.action.value or "").strip().lower()
    if before is not None and before.value == node.value and node.value.strip().lower() != typed:
        return None  # the field did not change and does not show what was typed: nothing observed
    return Assertion(kind=AssertionKind.element_visible, expected=f"{ev.action.target} value={node.value}")


def _default_step_name(action: Action) -> str:
    return action.description or f"{action.kind} {action.target or ''}".strip()


def derive_postconditions(ev: TraceEvent, max_elements: int = 3, step_name: str | None = None) -> list[Assertion]:
    out: list[Assertion] = []
    if urlsplit(ev.before.url).path != urlsplit(ev.after.url).path:
        out.append(Assertion(kind=AssertionKind.url_matches, expected=_url_pattern(ev.after.url)))
    for n in _new_nodes(ev.before, ev.after)[:max_elements]:
        # Raw name stored for readability; element_visible matches it normalized.
        out.append(Assertion(kind=AssertionKind.element_visible, expected=f"role={n.role} name={n.name}"))
    value_check = _field_value_assertion(ev)
    if value_check is not None:
        out.append(value_check)
    for e in ev.after.network:
        if e.method != "GET" and 200 <= e.status < 300:
            out.append(Assertion(kind=AssertionKind.network_ok, required=False,
                                 expected=f"{e.method.upper()} {urlsplit(e.url).path or '/'}"))
            break
    if not out:
        # The step's only visible effect was new text (a status line, "Results for X", a toast).
        for line in new_text_lines(ev.before.text, ev.after.text)[:1]:
            out.append(Assertion(kind=AssertionKind.text_present, expected=line))
    if not out and ev.action.kind == "type" and ev.action.value and ev.action.value.strip():
        typed = ev.action.value.strip()
        if typed.lower() in ev.after.text.lower() and typed.lower() not in ev.before.text.lower():
            out.append(Assertion(kind=AssertionKind.text_present, expected=typed))
    if not out:
        # Nothing deterministic distinguishes after from before. A step with no postcondition
        # would pass silently; instead demand a judged (or human) verdict on the step itself.
        name = step_name or _default_step_name(ev.action)
        out.append(Assertion(kind=AssertionKind.semantic, required=True,
                             expected=f"The step '{name}' took effect on the page"))
    return out


def new_text_lines(before: str, after: str, min_len: int = 3, max_len: int = 80) -> list[str]:
    """Lines present after but not before, skipping volatile ones (mostly digits, timestamps)."""
    seen = {l.strip() for l in before.splitlines()}
    out: list[str] = []
    for raw in after.splitlines():
        line = raw.strip()
        if not (min_len <= len(line) <= max_len) or line in seen:
            continue
        if _VOLATILE_LINE.fullmatch(line):
            continue
        out.append(line)
    return out


def derive_preconditions(ev: TraceEvent) -> list[Assertion]:
    out: list[Assertion] = []
    # The opening navigate starts from about:blank, which no replay session is ever on; and a
    # navigate step does not depend on where the page was before it.
    if ev.action.kind != "navigate" and not ev.before.url.lower().startswith(_NON_SITE_SCHEMES):
        out.append(Assertion(kind=AssertionKind.url_matches, expected=_url_pattern(ev.before.url)))
    if ev.action.target:
        out.append(Assertion(kind=AssertionKind.element_visible, expected=ev.action.target))
    return out


def skill_from_demo(demo: Demo, step_names: list[str] | None = None,
                    goal_checks: list[Assertion] | None = None) -> Skill:
    steps: list[Step] = []
    for i, ev in enumerate(demo.events):
        name = (step_names[i] if step_names and i < len(step_names) else _default_step_name(ev.action))
        steps.append(Step(
            name=name,
            action=ev.action,
            preconditions=derive_preconditions(ev),
            postconditions=derive_postconditions(ev, step_name=name),
        ))
    return Skill(name=demo.name, goal=demo.goal, site=demo.site, steps=steps, goal_checks=goal_checks or [],
                 demo_id=demo.id)
