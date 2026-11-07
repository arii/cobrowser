import { test } from "node:test";
import assert from "node:assert/strict";
import { cdpModifiers, framePosition, keyParams, mouseParams, type MouseLike } from "./input.ts";

const ev = (over: Partial<MouseLike> = {}): MouseLike =>
  ({ buttons: 0, button: 0, detail: 0, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...over });
const at = { x: 10, y: 20 };

test("finding 29: a plain move sends button none and buttons 0, not a phantom left drag", () => {
  const p = mouseParams("mouseMoved", ev(), at);
  assert.deepEqual(p, { type: "mouseMoved", x: 10, y: 20, button: "none", buttons: 0, clickCount: 0, modifiers: 0 });
});

test("finding 29: a move with the left button held keeps the button and the held mask (drag)", () => {
  const p = mouseParams("mouseMoved", ev({ buttons: 1 }), at);
  assert.equal(p.button, "left");
  assert.equal(p.buttons, 1);
  assert.equal(p.clickCount, 0);
  const right = mouseParams("mouseMoved", ev({ buttons: 2 }), at);
  assert.equal(right.button, "right");
  assert.equal(right.buttons, 2);
});

test("finding 29: press and release send button left, buttons 1 and clickCount from e.detail", () => {
  const down = mouseParams("mousePressed", ev({ button: 0, buttons: 1, detail: 1 }), at);
  assert.deepEqual(down, { type: "mousePressed", x: 10, y: 20, button: "left", buttons: 1, clickCount: 1, modifiers: 0 });
  const up = mouseParams("mouseReleased", ev({ button: 0, buttons: 0, detail: 1 }), at);
  assert.equal(up.button, "left");
  assert.equal(up.buttons, 1);
  assert.equal(up.clickCount, 1);
  const dbl = mouseParams("mousePressed", ev({ button: 0, buttons: 1, detail: 2 }), at);
  assert.equal(dbl.clickCount, 2);
  // a press always counts as at least one click even if the browser reports detail 0
  assert.equal(mouseParams("mousePressed", ev({ detail: 0 }), at).clickCount, 1);
});

test("finding 29: right and middle buttons are named with their own mask", () => {
  const right = mouseParams("mousePressed", ev({ button: 2, buttons: 2, detail: 1 }), at);
  assert.equal(right.button, "right");
  assert.equal(right.buttons, 2);
  const middle = mouseParams("mousePressed", ev({ button: 1, buttons: 4, detail: 1 }), at);
  assert.equal(middle.button, "middle");
  assert.equal(middle.buttons, 4);
});

test("finding 29: modifiers are forwarded with the CDP bit mask (Alt 1, Ctrl 2, Meta 4, Shift 8)", () => {
  assert.equal(cdpModifiers({ altKey: true, ctrlKey: false, metaKey: false, shiftKey: false }), 1);
  assert.equal(cdpModifiers({ altKey: false, ctrlKey: true, metaKey: false, shiftKey: false }), 2);
  assert.equal(cdpModifiers({ altKey: false, ctrlKey: false, metaKey: true, shiftKey: false }), 4);
  assert.equal(cdpModifiers({ altKey: false, ctrlKey: false, metaKey: false, shiftKey: true }), 8);
  assert.equal(mouseParams("mousePressed", ev({ shiftKey: true, metaKey: true, detail: 1 }), at).modifiers, 12);
  const [down, up] = keyParams({ key: "a", code: "KeyA", keyCode: 65, altKey: false, ctrlKey: true, metaKey: false, shiftKey: false });
  assert.equal(down.modifiers, 2);
  assert.equal(up.modifiers, 2);
  assert.equal(down.text, "a");
});

test("key events: Enter carries \\r as text, named keys carry no text", () => {
  const [enter] = keyParams({ key: "Enter", code: "Enter", keyCode: 13, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false });
  assert.equal(enter.text, "\r");
  const [tab] = keyParams({ key: "Tab", code: "Tab", keyCode: 9, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false });
  assert.equal("text" in tab, false);
});

test("finding 34: a pointer position maps through the frame's device size and survives a zero-size image", () => {
  const rect = { left: 100, top: 50, width: 400, height: 300 };
  assert.deepEqual(framePosition({ x: 300, y: 200 }, rect, { width: 1280, height: 720 }), { x: 640, y: 360 });
  // before layout the <img> can report a 0x0 box; mapping must not divide by zero
  assert.deepEqual(framePosition({ x: 300, y: 200 }, { ...rect, width: 0, height: 0 }, { width: 1280, height: 720 }), { x: 0, y: 0 });
});
