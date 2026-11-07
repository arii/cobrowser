import pytest
from conftest import snap

from cerebral.schemas import A11yNode, Assertion, AssertionKind, NetworkEvent, Snapshot, VerdictStatus
from cerebral.verifier import check_all, check_deterministic, element_visible, parse_anchor


def test_parse_anchor_handles_spaces_in_names():
    assert parse_anchor("role=button name=Add to cart") == {"role": "button", "name": "add to cart"}


# ---- finding 21: parse_anchor matches the worker's locator ----

def test_parse_anchor_key_token_inside_name_does_not_override_role():
    want = parse_anchor("role=button name=Switch role=admin")
    assert want["role"] == "button"          # first role= wins, as in session.ts locate()
    assert want["name"] == "switch role=admin"


def test_parse_anchor_splits_trailing_value():
    want = parse_anchor("role=textbox name=Search value=widget")
    assert want == {"role": "textbox", "name": "search", "value": "widget"}


def test_parse_anchor_without_role_or_name_is_empty():
    assert parse_anchor("Add to cart") == {}
    assert "role" not in parse_anchor("username=bob")


def test_element_visible_matches_node_with_key_token_in_label():
    s = snap("https://shop.test/", [("button", "Switch role=admin")])
    assert element_visible(s, "role=button name=Switch role=admin")


# ---- finding 18: names compared normalized on both sides ----

def test_element_visible_ignores_volatile_digits_in_names():
    s = snap("https://shop.test/cart", [("status", "Added 11:07"), ("heading", "Order #48214 placed")])
    assert element_visible(s, "role=status name=Added 10:42")
    assert element_visible(s, "role=heading name=Order #48213 placed")
    assert not element_visible(s, "role=status name=Removed 10:42")


# ---- finding 19: value-aware element_visible ----

def test_element_visible_checks_field_value_when_given():
    s = Snapshot(url="https://shop.test/", tree=[A11yNode(role="textbox", name="Search", value="Widget")])
    assert element_visible(s, "role=textbox name=Search value=widget")
    assert not element_visible(s, "role=textbox name=Search value=gadget")
    assert element_visible(s, "role=textbox name=Search")  # no value: plain presence check


# ---- finding 20: anchor-less element_visible fails with evidence ----

async def test_unparseable_anchor_fails_with_evidence():
    s = snap("https://shop.test/oops", [("heading", "Oops 404")])
    v = await check_all([Assertion(kind=AssertionKind.element_visible, expected="Add to cart")], s, None)
    assert v[0].status == VerdictStatus.failed and v[0].evidence == "unparseable anchor"


def test_empty_expected_is_rejected_by_schema():
    with pytest.raises(Exception):
        Assertion(kind=AssertionKind.text_present, expected="")


# ---- finding 16: a bad url pattern is a failed verdict, not a crash ----

def test_invalid_url_regex_returns_failed_verdict(product):
    v = check_deterministic(Assertion(kind=AssertionKind.url_matches, expected="^https://shop.test/search/[q"), product)
    assert v is not None and v.status == VerdictStatus.failed
    assert "invalid url pattern" in v.evidence


# ---- finding 15: network_ok semantics ----

def _net(*events: tuple[str, str, int]) -> Snapshot:
    return Snapshot(url="https://shop.test/cart",
                    network=[NetworkEvent(method=m, url=u, status=s) for m, u, s in events])


def _net_verdict(exp: str, s: Snapshot):
    v = check_deterministic(Assertion(kind=AssertionKind.network_ok, expected=exp), s)
    assert v is not None
    return v


def test_network_ok_passes_post_redirect_get_flow():
    s = _net(("POST", "https://shop.test/cart", 302), ("GET", "https://shop.test/cart", 200))
    assert _net_verdict("/cart", s).status == VerdictStatus.passed


def test_network_ok_ignores_redirects_and_passes_on_any_2xx():
    s = _net(("POST", "https://shop.test/cart/add", 302), ("POST", "https://shop.test/cart/add", 201),
             ("POST", "https://shop.test/cart/add", 500))
    v = _net_verdict("POST /cart/add", s)
    assert v.status == VerdictStatus.passed
    assert "3 matching responses" in v.evidence and "1 2xx" in v.evidence


def test_network_ok_redirect_only_is_not_a_pass():
    s = _net(("POST", "https://shop.test/cart/add", 302))
    assert _net_verdict("POST /cart/add", s).status == VerdictStatus.failed


def test_network_ok_compares_method_when_given():
    s = _net(("GET", "https://shop.test/cart/add", 200))
    assert _net_verdict("POST /cart/add", s).status == VerdictStatus.failed
    assert _net_verdict("/cart/add", s).status == VerdictStatus.passed


def test_network_ok_matches_path_equality_or_segment_prefix_only():
    s = _net(("POST", "https://shop.test/cartoon", 200), ("GET", "https://shop.test/recs", 500))
    assert _net_verdict("/cart", s).status == VerdictStatus.failed   # /cartoon is not under /cart
    s2 = _net(("POST", "https://shop.test/cart/add", 200))
    assert _net_verdict("/cart", s2).status == VerdictStatus.passed  # /cart/add is under /cart


def test_network_ok_root_path_does_not_match_everything():
    s = _net(("GET", "https://shop.test/recs", 500), ("POST", "https://shop.test/", 200))
    assert _net_verdict("POST /", s).status == VerdictStatus.passed
    s2 = _net(("GET", "https://shop.test/recs", 200))
    assert _net_verdict("/", s2).status == VerdictStatus.failed


def test_network_ok_no_matching_response_fails():
    s = _net(("GET", "https://shop.test/recs", 200))
    v = _net_verdict("POST /cart/add", s)
    assert v.status == VerdictStatus.failed and "0 matching responses" in v.evidence


# ---- existing behaviour ----

async def test_deterministic_checks(product):
    asserts = [
        Assertion(kind=AssertionKind.url_matches, expected=r"/p/\d+"),
        Assertion(kind=AssertionKind.element_visible, expected="role=button name=Add to cart"),
        Assertion(kind=AssertionKind.text_present, expected="$9.99"),
        Assertion(kind=AssertionKind.element_visible, expected="role=button name=Checkout"),
    ]
    v = await check_all(asserts, product, judge=None)
    assert [x.status for x in v] == [VerdictStatus.passed] * 3 + [VerdictStatus.failed]
    assert all(x.method == "deterministic" for x in v)


async def test_semantic_without_judge_fails_closed(product):
    v = await check_all([Assertion(kind=AssertionKind.semantic, expected="widget is in the cart")], product, None)
    assert v[0].status == VerdictStatus.failed and v[0].method == "judge"
