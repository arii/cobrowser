// Postconditions a human types during a correction. Mirrors schemas.AssertionKind and the
// Assertion.expected min_length=1 rule so the API's 422 is a backstop, not the first line of defence.

export const ASSERTION_KINDS = ["url_matches", "element_visible", "text_present", "network_ok", "semantic"] as const;
export type AssertionKind = (typeof ASSERTION_KINDS)[number];

export const KIND_HINT: Record<AssertionKind, string> = {
  url_matches: "regex the page URL must match",
  element_visible: "role=button name=Checkout",
  text_present: "substring of the page text",
  network_ok: "POST /cart/add  (METHOD /path or /path; any 2xx on it passes)",
  semantic: "claim for the judge, fallback only",
};

export type PostconditionRow = { kind: AssertionKind; expected: string };
export type NewAssertion = { kind: AssertionKind; expected: string; source: "human"; required: true };

export function isAssertionKind(x: string): x is AssertionKind {
  return (ASSERTION_KINDS as readonly string[]).includes(x);
}

export function emptyRow(): PostconditionRow {
  return { kind: "text_present", expected: "" };
}

/** Validate the rows the form holds. Blank rows (no expected text) are ignored; a row with an unknown kind or
 *  whitespace-only expected is an error. Returns the payload the API accepts or the problems to show. */
export function buildPostconditions(rows: PostconditionRow[]): { ok: true; assertions: NewAssertion[] } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  const assertions: NewAssertion[] = [];
  rows.forEach((row, i) => {
    const expected = row.expected.trim();
    if (!isAssertionKind(row.kind)) { problems.push(`line ${i + 1}: unknown kind "${row.kind}" (one of ${ASSERTION_KINDS.join(", ")})`); return; }
    if (!expected) return; // an untouched row, not an assertion
    assertions.push({ kind: row.kind, expected, source: "human", required: true });
  });
  return problems.length ? { ok: false, problems } : { ok: true, assertions };
}

/** Parse the legacy "kind: expected" one-per-line text (kept for pasting). Each line is validated against the kind list. */
export function parsePostconditionLines(text: string): { ok: true; assertions: NewAssertion[] } | { ok: false; problems: string[] } {
  const rows: PostconditionRow[] = [];
  const problems: string[] = [];
  text.split("\n").map((l) => l.trim()).filter(Boolean).forEach((line, i) => {
    const sep = line.indexOf(":");
    if (sep < 0) { problems.push(`line ${i + 1}: expected "kind: value"`); return; }
    const kind = line.slice(0, sep).trim();
    const expected = line.slice(sep + 1).trim();
    if (!isAssertionKind(kind)) { problems.push(`line ${i + 1}: unknown kind "${kind}" (one of ${ASSERTION_KINDS.join(", ")})`); return; }
    if (!expected) { problems.push(`line ${i + 1}: ${kind} needs a non-empty value`); return; }
    rows.push({ kind, expected });
  });
  if (problems.length) return { ok: false, problems };
  return buildPostconditions(rows);
}
