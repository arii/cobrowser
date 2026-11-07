from cerebral import receipt as R
from cerebral.schemas import (A11yNode, Action, AssertionKind, Receipt, Snapshot, StepOutcome, StepRecord, Verdict,
                              VerdictStatus)
from conftest import snap


def rec(i: int) -> StepRecord:
    return StepRecord(index=i, step_id=f"s{i}", step_name="x", pre_hash="a", post_hash="b",
                      action=Action(kind="noop"), outcome=StepOutcome.passed, prev_link="")


def receipt(n: int = 3) -> Receipt:
    r = Receipt(run_id="r", skill_id="s", skill_version=1, genesis=R.GENESIS)
    for i in range(n):
        R.append(r, rec(i))
    return r


# ---------- record chain ----------

def test_chain_verifies_and_detects_tampering():
    r = receipt()
    assert R.verify(r) == (True, [])
    r.records[1].outcome = StepOutcome.failed  # tamper
    ok, problems = R.verify(r)
    assert not ok and any("record 1" in p for p in problems)


def test_non_increasing_indices_are_rejected():
    r = receipt(2)
    dup = rec(1)  # a second record claiming index 1 (a step re-run after a bad resume)
    R.append(r, dup)
    ok, problems = R.verify(r)
    assert not ok and any("index does not increase" in p for p in problems)
    assert R.next_index(receipt(2)) == 2


# ---------- receipt seal (finding 1) ----------

def test_append_seals_the_receipt_and_verify_recomputes_it():
    r = receipt()
    assert r.receipt_link == R.receipt_link(r)
    assert R.verify(r) == (True, [])


def test_forged_outcome_fields_break_the_seal():
    for field, value in [
        ("success", True),
        ("goal_verdicts", [Verdict(assertion_id="g", kind=AssertionKind.text_present, status=VerdictStatus.passed,
                                   method="deterministic")]),
        ("skill_version", 7),
        ("skill_id", "other"),
        ("run_id", "other"),
    ]:
        r = receipt()
        setattr(r, field, value)
        ok, problems = R.verify(r)
        assert not ok, field
        assert any("receipt_link" in p for p in problems), field
        assert R.verify(R.seal_receipt(r)) == (True, [])  # resealing after a legitimate change is fine


def test_record_timestamps_are_unattested():
    r = receipt()
    r.records[0].at = "1999-01-01T00:00:00+00:00"
    assert R.verify(r) == (True, [])


def test_empty_receipt_must_point_at_genesis():
    r = Receipt(run_id="r", skill_id="s", skill_version=1, genesis=R.GENESIS)
    assert not R.verify(r)[0]  # unsealed: final_link "" and no receipt_link
    R.seal_receipt(r)
    assert r.final_link == R.GENESIS
    assert R.verify(r) == (True, [])
    r.final_link = "f" * 64
    R.seal_receipt(r)  # a seal cannot launder an arbitrary final_link: seal_receipt recomputes it
    assert r.final_link == R.GENESIS
    r.final_link = "f" * 64
    r.receipt_link = R.receipt_link(r)
    ok, problems = R.verify(r)
    assert not ok and any("genesis" in p for p in problems)


# ---------- snapshot hash (finding 6) ----------

def test_snapshot_hash_ignores_volatile_text_and_query():
    a = snap("https://x.test/cart?t=1", [("text", "Updated 12:01"), ("button", "Pay")])
    b = snap("https://x.test/cart?t=2", [("button", "Pay"), ("text", "Updated 12:02")])
    c = snap("https://x.test/cart", [("button", "Pay now")])
    assert R.snapshot_hash(a) == R.snapshot_hash(b)
    assert R.snapshot_hash(a) != R.snapshot_hash(c)


def test_digit_masking_does_not_depend_on_spacing():
    assert R.normalize_name("Qty x3") == R.normalize_name("Qty x5")
    assert R.normalize_name("Qty x 3") == R.normalize_name("Qty x 5")
    assert R.normalize_name("Order #1234") == R.normalize_name("Order #9876")


def test_snapshot_hash_keeps_duplicates():
    one = snap("https://x.test/cart", [("button", "Remove")])
    three = snap("https://x.test/cart", [("button", "Remove")] * 3)
    assert R.snapshot_hash(one) != R.snapshot_hash(three)
    # still order-insensitive
    ab = snap("https://x.test/cart", [("button", "Remove"), ("button", "Remove"), ("link", "Home")])
    ba = snap("https://x.test/cart", [("link", "Home"), ("button", "Remove"), ("button", "Remove")])
    assert R.snapshot_hash(ab) == R.snapshot_hash(ba)


def test_snapshot_hash_includes_widget_value():
    unchecked = Snapshot(url="https://x.test/pay", tree=[A11yNode(role="checkbox", name="Agree", value="false")])
    checked = Snapshot(url="https://x.test/pay", tree=[A11yNode(role="checkbox", name="Agree", value="true")])
    assert R.snapshot_hash(unchecked) != R.snapshot_hash(checked)


def test_empty_tree_is_a_distinct_sentinel():
    empty = Snapshot(url="https://x.test/")
    page = Snapshot(url="https://x.test/", tree=[A11yNode(role="document", name="")])
    assert R.snapshot_hash(empty) != R.snapshot_hash(page)
    # the sentinel is deterministic and tied to the path, like any other hash
    assert R.snapshot_hash(empty) == R.snapshot_hash(Snapshot(url="https://x.test/?q=1"))
    assert R.snapshot_hash(empty) != R.snapshot_hash(Snapshot(url="https://x.test/other"))
