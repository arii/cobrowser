import pytest

from cerebral import receipt as receipt_mod
from cerebral.schemas import A11yNode, Action, Assertion, AssertionKind, Receipt, Run, Snapshot, Step, Skill


def snap(url: str, nodes: list[tuple[str, str]], text: str = "") -> Snapshot:
    return Snapshot(url=url, tree=[A11yNode(role=r, name=n) for r, n in nodes], text=text)


def make_run(skill: Skill, version: int | None = None) -> Run:
    """A fresh run of `skill` with an empty, sealed receipt."""
    v = skill.version if version is None else version
    r = Run(skill_id=skill.id, skill_version=v,
            receipt=Receipt(run_id="", skill_id=skill.id, skill_version=v, genesis=receipt_mod.GENESIS))
    r.receipt.run_id = r.id
    receipt_mod.seal_receipt(r.receipt)
    return r


@pytest.fixture
def search():
    """Where a mis-click lands: not the product page."""
    return snap("https://shop.test/search", [("searchbox", "Search"), ("link", "Widget")], "Results")


@pytest.fixture
def home():
    return snap("https://shop.test/", [("link", "Widget"), ("button", "Search")], "Welcome")


@pytest.fixture
def product():
    return snap("https://shop.test/p/42", [("button", "Add to cart"), ("heading", "Widget")], "Widget $9.99")


@pytest.fixture
def cart():
    return snap("https://shop.test/cart", [("heading", "Your cart"), ("text", "Widget x 1")], "Your cart Widget x 1")


@pytest.fixture
def skill():
    return Skill(
        name="buy widget", goal="widget in cart", site="shop.test",
        steps=[
            Step(name="open widget", action=Action(kind="click", target="role=link name=Widget"),
                 preconditions=[Assertion(kind=AssertionKind.url_matches, expected=r"^https://shop\.test/$")],
                 postconditions=[Assertion(kind=AssertionKind.url_matches, expected=r"/p/\d+"),
                                 Assertion(kind=AssertionKind.element_visible, expected="role=button name=Add to cart")]),
            Step(name="add to cart", action=Action(kind="click", target="role=button name=Add to cart"),
                 postconditions=[Assertion(kind=AssertionKind.text_present, expected="Your cart")]),
        ],
        goal_checks=[Assertion(kind=AssertionKind.text_present, expected="Widget x 1")],
    )
