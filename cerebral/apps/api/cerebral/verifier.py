"""Assertion checking. Deterministic first; the judge is a fallback for `semantic` only."""
from __future__ import annotations

import re
from typing import Protocol
from urllib.parse import urlsplit

from .receipt import normalize_name
from .schemas import A11yNode, Assertion, AssertionKind, Snapshot, Verdict, VerdictStatus

# A judge verdict of "holds" only passes when its confidence reaches this. Shared by every judge
# (Subq and the Meta fallback) so a semantic assertion means the same thing whichever one answered.
JUDGE_THRESHOLD = 0.7

_ROLE_RE = re.compile(r"\brole=(\w+)")
_NAME_RE = re.compile(r"\bname=")
_VALUE_RE = re.compile(r"(?:^|\s)value=")
_NETWORK_EXPECTED_RE = re.compile(r"^([A-Za-z]+)\s+(\S.*)$")


class Judge(Protocol):
    """Anything that can judge a semantic claim against evidence.
    Subq (adapters/subq.SubqJudge) is preferred: one fast call returning a probability.
    Meta (adapters/meta.MetaClient) is the fallback."""
    model_name: str

    async def judge(self, claim: str, evidence: str) -> tuple[bool, float, str]: ...


def parse_anchor(anchor: str) -> dict[str, str]:
    """'role=button name=Add to cart' -> {'role': 'button', 'name': 'add to cart'}

    Mirrors the worker's locator (apps/browser/src/session.ts locate()): role is the first
    `role=<word>` token; name is everything after the first `name=`, so a `key=` inside the
    label cannot override the role. An optional trailing ` value=...` (derived for type/select
    steps) is split off into 'value' and is not part of the name.
    """
    out: dict[str, str] = {}
    m = _ROLE_RE.search(anchor)
    if m:
        out["role"] = m.group(1).lower()
    nm = _NAME_RE.search(anchor)
    if nm:
        rest = anchor[nm.end():]
        vm = _VALUE_RE.search(rest)
        if vm:
            out["value"] = rest[vm.end():].strip()
            rest = rest[:vm.start()]
        out["name"] = rest.strip().lower()
    else:
        vm = _VALUE_RE.search(anchor)
        if vm:
            out["value"] = anchor[vm.end():].strip()
    return out


def _node_matches(want: dict[str, str], n: A11yNode) -> bool:
    if "role" in want and n.role.lower() != want["role"]:
        return False
    # Names are compared normalized on both sides (receipt.normalize_name), so a label whose
    # digits change between runs ("Added 10:42" vs "Added 11:07") still matches.
    if "name" in want and normalize_name(want["name"]) not in normalize_name(n.name):
        return False
    if "value" in want and n.value.strip().lower() != want["value"].strip().lower():
        return False
    return True


def element_visible(snap: Snapshot, anchor: str) -> bool:
    want = parse_anchor(anchor)
    if "role" not in want and "name" not in want:
        return False  # an anchor that names nothing must never pass on an arbitrary tree
    return any(_node_matches(want, n) for n in snap.tree)


def parse_network_expected(exp: str) -> tuple[str | None, str]:
    """'POST /cart/add' -> ('POST', '/cart/add'); '/cart/add' -> (None, '/cart/add')."""
    m = _NETWORK_EXPECTED_RE.match(exp.strip())
    if m and m.group(2).startswith("/"):
        return (m.group(1).upper(), m.group(2).strip())
    return (None, exp.strip())


def _path_matches(expected_path: str, url: str) -> bool:
    path = urlsplit(url).path or "/"
    if path == expected_path:
        return True
    if expected_path in ("", "/"):
        return False  # the root is never a prefix of everything
    prefix = expected_path if expected_path.endswith("/") else expected_path + "/"
    return path.startswith(prefix)


def network_ok(snap: Snapshot, exp: str) -> tuple[bool, str]:
    """Any 2xx response for the expected (method, path) passes. Redirects are not failures:
    a POST -> 302 -> GET 200 flow is the normal shape of a successful form submission."""
    method, path = parse_network_expected(exp)
    hits = [e for e in snap.network
            if _path_matches(path, e.url) and (method is None or e.method.upper() == method)]
    ok_hits = [e for e in hits if 200 <= e.status < 300]
    redirects = [e for e in hits if 300 <= e.status < 400]
    return (bool(ok_hits), f"{len(hits)} matching responses, {len(ok_hits)} 2xx, {len(redirects)} 3xx")


def check_deterministic(a: Assertion, snap: Snapshot) -> Verdict | None:
    """Returns a Verdict, or None if the assertion needs the judge."""
    kind, exp = a.kind, a.expected
    if kind == AssertionKind.url_matches:
        try:
            ok = re.search(exp, snap.url) is not None
        except re.error as e:
            return _v(a, False, "deterministic", f"invalid url pattern: {e}; url={snap.url}")
        return _v(a, ok, "deterministic", f"url={snap.url}")
    if kind == AssertionKind.element_visible:
        want = parse_anchor(exp)
        if "role" not in want and "name" not in want:
            return _v(a, False, "deterministic", "unparseable anchor")
        ok = element_visible(snap, exp)
        return _v(a, ok, "deterministic", f"{len(snap.tree)} nodes scanned")
    if kind == AssertionKind.text_present:
        ok = exp.lower() in snap.text.lower()
        return _v(a, ok, "deterministic", f"text len={len(snap.text)}")
    if kind == AssertionKind.network_ok:
        ok, evidence = network_ok(snap, exp)
        return _v(a, ok, "deterministic", evidence)
    return None


def _v(a: Assertion, ok: bool, method: str, evidence: str, **kw) -> Verdict:
    return Verdict(
        assertion_id=a.id,
        kind=a.kind,
        status=VerdictStatus.passed if ok else VerdictStatus.failed,
        method=method,  # type: ignore[arg-type]
        evidence=evidence,
        **kw,
    )


async def check_all(assertions: list[Assertion], snap: Snapshot, judge: Judge | None) -> list[Verdict]:
    out: list[Verdict] = []
    for a in assertions:
        v = check_deterministic(a, snap)
        if v is None:
            if judge is None:
                # fail closed: an unverifiable semantic claim never passes silently
                out.append(_v(a, False, "judge", "no judge configured"))
                continue
            evidence = f"url={snap.url}\ntitle={snap.title}\n{snap.text[:4000]}"
            ok, conf, why = await judge.judge(a.expected, evidence)
            out.append(_v(a, ok, "judge", why[:500], judge_model=judge.model_name, confidence=conf))
        else:
            out.append(v)
    return out


def all_required_passed(verdicts: list[Verdict], assertions: list[Assertion]) -> bool:
    required = {a.id for a in assertions if a.required}
    return all(v.status == VerdictStatus.passed for v in verdicts if v.assertion_id in required)
