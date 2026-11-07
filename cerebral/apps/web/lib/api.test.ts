import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { ApiError, api, formatApiError, resolveSessionId } from "./api.ts";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function mockFetch(handler: (url: string, init?: RequestInit) => { status: number; body: string }) {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    const { status, body } = handler(url, init);
    return new Response(body, { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return calls;
}

test("finding 28: run.session_id wins over sessionStorage; storage is the fallback; neither gives empty", () => {
  assert.equal(resolveSessionId({ session_id: "s_api" }, "s_tab"), "s_api");
  assert.equal(resolveSessionId({ session_id: "" }, "s_tab"), "s_tab");
  assert.equal(resolveSessionId({}, "s_tab"), "s_tab");
  assert.equal(resolveSessionId(null, null), "");
  assert.equal(resolveSessionId({ session_id: "  " }, "  "), "");
});

test("finding 24: takeover posts to /runs/{id}/takeover and returns the run", async () => {
  const calls = mockFetch(() => ({ status: 200, body: JSON.stringify({ id: "r1", status: "awaiting_human", session_id: "s1" }) }));
  const run = await api.takeover("r1");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/runs\/r1\/takeover$/);
  assert.equal(calls[0].init?.method, "POST");
  assert.equal(run.status, "awaiting_human");
});

test("finding 24: a 409/404 from takeover surfaces as an ApiError with the status and FastAPI detail", async () => {
  mockFetch(() => ({ status: 409, body: JSON.stringify({ detail: "run is not running" }) }));
  await assert.rejects(api.takeover("r1"), (e: unknown) => {
    assert.ok(e instanceof ApiError);
    assert.equal(e.status, 409);
    assert.equal(e.message, "409: run is not running");
    return true;
  });
  mockFetch(() => ({ status: 404, body: JSON.stringify({ detail: "unknown run" }) }));
  await assert.rejects(api.takeover("nope"), (e: unknown) => e instanceof ApiError && e.status === 404 && e.message === "404: unknown run");
});

test("finding 25: a 422 validation body is flattened to field: message lines", async () => {
  const body = JSON.stringify({ detail: [
    { type: "string_too_short", loc: ["body", "new_postconditions", 0, "expected"], msg: "String should have at least 1 character" },
    { type: "enum", loc: ["body", "new_postconditions", 1, "kind"], msg: "Input should be 'url_matches', 'element_visible', 'text_present', 'network_ok' or 'semantic'" },
  ] });
  assert.equal(formatApiError(422, body),
    "422: new_postconditions.0.expected: String should have at least 1 character; new_postconditions.1.kind: Input should be 'url_matches', 'element_visible', 'text_present', 'network_ok' or 'semantic'");
  mockFetch(() => ({ status: 422, body }));
  await assert.rejects(api.correction("r1", {}), (e: unknown) => e instanceof ApiError && e.status === 422 && /new_postconditions\.0\.expected/.test(e.message));
});

test("formatApiError falls back to the raw body when it is not FastAPI-shaped", () => {
  assert.equal(formatApiError(500, "Internal Server Error"), "500 Internal Server Error");
  assert.equal(formatApiError(502, ""), "502");
  assert.equal(formatApiError(400, JSON.stringify({ other: 1 })), '400 {"other":1}');
});
