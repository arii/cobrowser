import { test } from "node:test";
import assert from "node:assert/strict";
import { ASSERTION_KINDS, KIND_HINT, buildPostconditions, isAssertionKind, parsePostconditionLines } from "./postconditions.ts";

test("finding 25: the kind list mirrors schemas.AssertionKind exactly", () => {
  assert.deepEqual([...ASSERTION_KINDS], ["url_matches", "element_visible", "text_present", "network_ok", "semantic"]);
  assert.ok(isAssertionKind("text_present"));
  assert.ok(!isAssertionKind("text_presnt"));
  assert.ok(!isAssertionKind(""));
});

test("finding 25: rows become human-sourced assertions, blank rows are skipped, expected is trimmed", () => {
  const r = buildPostconditions([
    { kind: "text_present", expected: "  Your cart " },
    { kind: "element_visible", expected: "" },
    { kind: "url_matches", expected: "/cart$" },
  ]);
  assert.ok(r.ok);
  assert.deepEqual(r.assertions, [
    { kind: "text_present", expected: "Your cart", source: "human", required: true },
    { kind: "url_matches", expected: "/cart$", source: "human", required: true },
  ]);
});

test("finding 25: an unknown kind is rejected client-side before the API sees it", () => {
  const r = buildPostconditions([{ kind: "text_presnt" as never, expected: "x" }]);
  assert.ok(!r.ok);
  assert.match(r.problems[0], /line 1: unknown kind "text_presnt"/);
});

test("finding 25: whitespace-only expected never reaches the API (Assertion.expected min_length=1)", () => {
  const r = buildPostconditions([{ kind: "text_present", expected: "   " }]);
  assert.ok(r.ok);
  assert.equal(r.assertions.length, 0);
  const lines = parsePostconditionLines("text_present:   ");
  assert.ok(!lines.ok);
  assert.match(lines.problems[0], /non-empty/);
});

test("finding 25: legacy 'kind: value' lines parse, keep colons in the value, and validate the kind", () => {
  const ok = parsePostconditionLines("text_present: Your cart\nelement_visible: role=button name=Checkout\nurl_matches: https://x.test/a:b");
  assert.ok(ok.ok);
  assert.equal(ok.assertions.length, 3);
  assert.equal(ok.assertions[2].expected, "https://x.test/a:b");
  const bad = parsePostconditionLines("visible: thing\nno separator here");
  assert.ok(!bad.ok);
  assert.equal(bad.problems.length, 2);
  assert.match(bad.problems[0], /unknown kind "visible"/);
  assert.match(bad.problems[1], /expected "kind: value"/);
});

test("every assertion kind has a hint, and network_ok's hint shows the METHOD /path form the verifier parses", () => {
  for (const k of ASSERTION_KINDS) assert.ok(KIND_HINT[k].length > 0, k);
  assert.match(KIND_HINT.network_ok, /^[A-Z]+ \//);
});
