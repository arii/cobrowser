import re

from conftest import snap

from cerebral.derive import _url_pattern, derive_postconditions, derive_preconditions, skill_from_demo
from cerebral.schemas import A11yNode, Action, AssertionKind, Demo, Snapshot, TraceEvent
from cerebral.verifier import check_deterministic, element_visible
from cerebral.schemas import VerdictStatus


def test_derives_url_and_element_postconditions(home, product, cart):
    d = Demo(name="buy", goal="g", site="shop.test", events=[
        TraceEvent(before=home, action=Action(kind="click", target="role=link name=Widget"), after=product),
        TraceEvent(before=product, action=Action(kind="click", target="role=button name=Add to cart"), after=cart),
    ])
    sk = skill_from_demo(d)
    kinds = [a.kind for a in sk.steps[0].postconditions]
    assert AssertionKind.url_matches in kinds and AssertionKind.element_visible in kinds
    assert any("Add to cart" in a.expected for a in sk.steps[0].postconditions)
    assert sk.steps[1].preconditions[1].expected == "role=button name=Add to cart"


def test_text_only_change_yields_text_present_postcondition(product):
    after = snap("https://shop.test/p/42", [("button", "Add to cart"), ("heading", "Widget")],
                 "Widget $9.99\nAdded to your cart\nUpdated 12:03")
    d = Demo(name="x", goal="g", site="shop.test", events=[
        TraceEvent(before=product, action=Action(kind="click", target="role=button name=Add to cart"), after=after),
    ])
    post = skill_from_demo(d).steps[0].postconditions
    assert [a.kind for a in post] == [AssertionKind.text_present]
    assert post[0].expected == "Added to your cart"


# ---- findings 16 and 17: _url_pattern ----

def test_url_pattern_escapes_regex_metacharacters():
    for url in ["https://shop.test/c/(all)/items", "https://shop.test/s/a+b", "https://shop.test/search/[q]",
                "https://shop.test/a|b.c$"]:
        pat = _url_pattern(url)
        assert re.search(pat, url), (pat, url)
    assert not re.search(_url_pattern("https://shop.test/s/a+b"), "https://shop.test/s/aaab")


def test_url_pattern_generalizes_identifier_segments():
    pat = _url_pattern("https://shop.test/checkout/ORD-9/x")
    assert re.search(pat, "https://shop.test/checkout/ORD-10/x")
    assert not re.search(pat, "https://shop.test/checkout/ORD-10/y")
    assert re.search(_url_pattern("https://shop.test/cart/3f9a2b"), "https://shop.test/cart/77c0de")
    assert re.search(_url_pattern("https://shop.test/p/42"), "https://shop.test/p/43")
    assert re.search(_url_pattern("https://shop.test/o/9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"),
                     "https://shop.test/o/0f8fad5b-d9cb-469f-a165-70867728950e")
    assert re.search(_url_pattern("https://shop.test/s/deadbeefcafe"), "https://shop.test/s/0123456789ab")
    # static segments stay literal
    assert not re.search(_url_pattern("https://shop.test/cart"), "https://shop.test/account")
    assert _url_pattern("https://shop.test") == r"^https://shop\.test/"


# ---- finding 18: derived element_visible survives volatile labels ----

def test_derived_element_visible_matches_on_replay_with_different_numbers(product):
    after = snap("https://shop.test/p/42", [("button", "Add to cart"), ("heading", "Widget"), ("status", "Added 10:42")])
    ev = TraceEvent(before=product, action=Action(kind="click", target="role=button name=Add to cart"), after=after)
    post = derive_postconditions(ev)
    assert post[0].expected == "role=status name=Added 10:42"  # raw name kept for readability
    replay = snap("https://shop.test/p/42", [("button", "Add to cart"), ("heading", "Widget"), ("status", "Added 11:07")])
    assert element_visible(replay, post[0].expected)


# ---- finding 19: type/select steps get a value postcondition; nothing ever passes silently ----

def _field(url: str, value: str, extra_text: str = "") -> Snapshot:
    return Snapshot(url=url, tree=[A11yNode(role="textbox", name="Search", value=value),
                                   A11yNode(role="button", name="Go")], text="Welcome\n" + extra_text)


def test_type_step_derives_field_value_postcondition():
    ev = TraceEvent(before=_field("https://shop.test/", ""),
                    action=Action(kind="type", target="role=textbox name=Search", value="widget"),
                    after=_field("https://shop.test/", "widget"))
    post = derive_postconditions(ev)
    assert [a.kind for a in post] == [AssertionKind.element_visible]
    assert post[0].expected == "role=textbox name=Search value=widget" and post[0].required
    # passes on a snapshot whose field holds the value, fails when the fill silently missed
    assert check_deterministic(post[0], _field("https://shop.test/", "Widget")).status == VerdictStatus.passed
    assert check_deterministic(post[0], _field("https://shop.test/", "")).status == VerdictStatus.failed


def test_select_step_asserts_observed_option_label():
    before = Snapshot(url="https://shop.test/", tree=[A11yNode(role="combobox", name="Country", value="Pick one")])
    after = Snapshot(url="https://shop.test/", tree=[A11yNode(role="combobox", name="Country", value="United States")])
    ev = TraceEvent(before=before, action=Action(kind="select", target="role=combobox name=Country", value="us"), after=after)
    post = derive_postconditions(ev)
    assert post[0].expected == "role=combobox name=Country value=United States"


def test_password_field_gets_no_value_postcondition_but_never_passes_silently():
    before = Snapshot(url="https://shop.test/login", tree=[A11yNode(role="textbox", name="Password", value="")])
    after = Snapshot(url="https://shop.test/login", tree=[A11yNode(role="textbox", name="Password", value="")])
    ev = TraceEvent(before=before, action=Action(kind="type", target="role=textbox name=Password", value="hunter2"), after=after)
    post = derive_postconditions(ev, step_name="enter password")
    assert all("hunter2" not in a.expected for a in post)
    assert [a.kind for a in post] == [AssertionKind.semantic]
    assert post[0].required and "enter password" in post[0].expected


def test_no_change_step_derives_required_semantic_postcondition(product):
    ev = TraceEvent(before=product, action=Action(kind="click", target="role=button name=Add to cart"), after=product)
    post = derive_postconditions(ev)
    assert len(post) == 1 and post[0].kind == AssertionKind.semantic and post[0].required
    assert "click role=button name=Add to cart" in post[0].expected
    sk = skill_from_demo(Demo(name="x", goal="g", site="shop.test", events=[ev]), step_names=["add widget"])
    assert "add widget" in sk.steps[0].postconditions[0].expected


def test_typed_text_that_shows_up_in_page_text_becomes_text_present():
    before = Snapshot(url="https://shop.test/", tree=[], text="Welcome")
    after = Snapshot(url="https://shop.test/", tree=[], text="Welcome\nShowing results for widget")
    ev = TraceEvent(before=before, action=Action(kind="type", target="role=textbox name=Search", value="widget"), after=after)
    post = derive_postconditions(ev)
    assert post[0].kind == AssertionKind.text_present


# ---- finding 15: network_ok stores method + path ----

def test_network_postcondition_stores_method_and_path(product, cart):
    from cerebral.schemas import NetworkEvent
    after = cart.model_copy(update={"network": [NetworkEvent(method="GET", url="https://shop.test/recs", status=200),
                                                NetworkEvent(method="POST", url="https://shop.test/cart/add?x=1", status=201)]})
    ev = TraceEvent(before=product, action=Action(kind="click", target="role=button name=Add to cart"), after=after)
    net = [a for a in derive_postconditions(ev) if a.kind == AssertionKind.network_ok]
    assert len(net) == 1 and net[0].expected == "POST /cart/add" and not net[0].required


# ---- finding 26: opening navigate gets no about:blank precondition ----

def test_preconditions_skip_url_for_about_blank_and_navigate(home, product):
    blank = snap("about:blank", [])
    ev = TraceEvent(before=blank, action=Action(kind="navigate", value="https://shop.test/"), after=home)
    assert derive_preconditions(ev) == []
    ev2 = TraceEvent(before=home, action=Action(kind="navigate", value="https://shop.test/p/42"), after=product)
    assert [a.kind for a in derive_preconditions(ev2)] == []
    ev3 = TraceEvent(before=home, action=Action(kind="click", target="role=link name=Widget"), after=product)
    assert [a.kind for a in derive_preconditions(ev3)] == [AssertionKind.url_matches, AssertionKind.element_visible]
