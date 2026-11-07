"""Hash-chained run receipts.

A receipt is tamper-evident at two levels:

* Record chain. Each StepRecord's `link` is sha256 over its canonical content plus the previous
  link (`prev_link`); the first record's prev_link is the genesis hash. Record `index` is the
  record's position in the chain (0, 1, 2, ...), not the skill step index: one step may produce
  several records (failed attempts, the repaired attempt, a handoff, the human's correction), and
  `step_id` says which step each record belongs to.
* Receipt seal. `receipt_link` is sha256 over the receipt's identity and outcome fields
  (run_id, skill_id, skill_version, genesis, final_link, goal_verdicts, success), so success
  flags, goal verdicts and identity cannot be rewritten without breaking verify(). `append`
  reseals after every record and the graph reseals at finish, so a persisted receipt is always
  sealed.

verify() recomputes both from scratch. It is pure: no network, no store.

Unattested by design: each record's `at` timestamp is excluded from `record_link`. Wall-clock
times are not evidence of anything the verifier can recompute, and attesting them would let clock
skew between the API and a re-verifying peer look like tampering. Treat `at` as a convenience
annotation, not as part of the proof.

Snapshot hashes come from a normalized accessibility tree, not raw HTML, so volatile markup does
not break replay.
"""
from __future__ import annotations

import hashlib
import json
import re
from urllib.parse import urlsplit

from .schemas import Receipt, Snapshot, StepRecord

GENESIS = "0" * 64

# Digit runs (with the separators that appear inside timestamps, counters, prices and ids) are
# masked in names. No word-boundary anchors: "Qty x3" and "Qty x 3" must mask the same way.
_VOLATILE = re.compile(r"\d[\d,.:/-]*")

# An empty accessibility tree is hashed as this explicit marker rather than as "a page with no
# nodes", so a failed capture is visibly a failed capture in the receipt.
EMPTY_TREE = "<empty-tree>"


def _sha(payload: str) -> str:
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _canon(obj: object) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"))


def normalize_name(name: str) -> str:
    return _VOLATILE.sub("#", name).strip().lower()


def snapshot_hash(snap: Snapshot) -> str:
    """Hash of (host + path, sorted multiset of (role, normalized name, value)).

    Order-insensitive, query string dropped. Duplicates are kept, so three "Remove" buttons hash
    differently from one. `value` carries widget state (checked, selected option, typed text) and
    is not masked. An empty tree hashes to a distinct sentinel (see EMPTY_TREE).
    """
    parts = urlsplit(snap.url)
    if snap.tree:
        nodes: object = sorted((n.role, normalize_name(n.name), n.value) for n in snap.tree)
    else:
        nodes = EMPTY_TREE
    return _sha(_canon({"path": parts.netloc + parts.path, "nodes": nodes}))


def record_link(rec: StepRecord) -> str:
    body = rec.model_dump(mode="json", exclude={"link", "at"})
    return _sha(json.dumps(body, sort_keys=True))


def seal_record(rec: StepRecord) -> StepRecord:
    rec.link = record_link(rec)
    return rec


def next_index(receipt: Receipt) -> int:
    """Chain position for the next record to append."""
    return receipt.records[-1].index + 1 if receipt.records else 0


def receipt_link(receipt: Receipt) -> str:
    """The receipt-level seal: identity + outcome, bound to the end of the record chain."""
    body = {
        "run_id": receipt.run_id,
        "skill_id": receipt.skill_id,
        "skill_version": receipt.skill_version,
        "genesis": receipt.genesis,
        "final_link": receipt.final_link,
        "goal_verdicts": [v.model_dump(mode="json") for v in receipt.goal_verdicts],
        "success": receipt.success,
    }
    return _sha(_canon(body))


def seal_receipt(receipt: Receipt) -> Receipt:
    """Recompute final_link from the chain and receipt_link from the receipt. Idempotent."""
    receipt.final_link = receipt.records[-1].link if receipt.records else receipt.genesis
    receipt.receipt_link = receipt_link(receipt)
    return receipt


def append(receipt: Receipt, rec: StepRecord) -> Receipt:
    rec.prev_link = receipt.records[-1].link if receipt.records else receipt.genesis
    seal_record(rec)
    receipt.records.append(rec)
    return seal_receipt(receipt)


def verify(receipt: Receipt) -> tuple[bool, list[str]]:
    """Recompute the chain and the seal. Returns (ok, problems). Pure; no network."""
    problems: list[str] = []
    prev = receipt.genesis
    last_index: int | None = None
    for rec in receipt.records:
        if last_index is not None and rec.index <= last_index:
            problems.append(f"record {rec.index}: index does not increase (previous {last_index})")
        last_index = rec.index
        if rec.prev_link != prev:
            problems.append(f"record {rec.index}: prev_link mismatch")
        if record_link(rec) != rec.link:
            problems.append(f"record {rec.index}: link does not match content")
        prev = rec.link
    if receipt.records:
        if receipt.final_link != receipt.records[-1].link:
            problems.append("final_link does not match last record")
    elif receipt.final_link != receipt.genesis:
        problems.append("empty receipt: final_link must equal genesis")
    if receipt_link(receipt) != receipt.receipt_link:
        problems.append("receipt_link does not match receipt content")
    return (not problems, problems)
