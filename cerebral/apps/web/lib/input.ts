// Maps canvas pointer/keyboard events to CDP Input.dispatchMouseEvent / dispatchKeyEvent params.
// Pure so it can be unit tested without a DOM; CoBrowseCanvas feeds it the React event.

export type MouseEventType = "mouseMoved" | "mousePressed" | "mouseReleased";

// The subset of MouseEvent the mapping reads. React.MouseEvent and native MouseEvent both satisfy it.
export type MouseLike = {
  buttons: number; button: number; detail: number;
  altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean;
};
export type KeyLike = { key: string; code: string; keyCode: number; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean };

export type CdpMouseParams = {
  type: MouseEventType; x: number; y: number;
  button: "none" | "left" | "middle" | "right"; buttons: number; clickCount: number; modifiers: number;
};
export type CdpKeyParams = {
  type: "keyDown" | "keyUp"; key: string; code: string; windowsVirtualKeyCode: number; modifiers: number; text?: string;
};

// CDP Input modifier bit mask: Alt=1, Ctrl=2, Meta/Command=4, Shift=8.
export function cdpModifiers(e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): number {
  return (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);
}

const BUTTON_NAME: Record<number, CdpMouseParams["button"]> = { 0: "left", 1: "middle", 2: "right" };

/** Build the CDP mouse event. A plain move carries button "none" and buttons 0 so the page does not see a
 *  phantom drag; a move with a button held keeps that button and the held mask. Press/release name the
 *  button, set the mask to that button and pass the browser's click count (e.detail) so double-clicks work. */
export function mouseParams(type: MouseEventType, e: MouseLike, at: { x: number; y: number }): CdpMouseParams {
  const modifiers = cdpModifiers(e);
  if (type === "mouseMoved") {
    const held = e.buttons !== 0;
    const button: CdpMouseParams["button"] = held ? (e.buttons & 1 ? "left" : e.buttons & 2 ? "right" : e.buttons & 4 ? "middle" : "left") : "none";
    return { type, x: at.x, y: at.y, button, buttons: held ? e.buttons : 0, clickCount: 0, modifiers };
  }
  const button = BUTTON_NAME[e.button] ?? "left";
  const mask = button === "left" ? 1 : button === "right" ? 2 : 4;
  return { type, x: at.x, y: at.y, button, buttons: mask, clickCount: Math.max(1, e.detail || 1), modifiers };
}

/** Device-pixel position of a client point inside the rendered frame. `rect` is the <img> bounding box;
 *  `device` the worker's reported viewport (falls back to the image's natural size). */
export function framePosition(client: { x: number; y: number }, rect: { left: number; top: number; width: number; height: number },
                              device: { width: number; height: number }): { x: number; y: number } {
  if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
  return { x: Math.round(((client.x - rect.left) / rect.width) * device.width), y: Math.round(((client.y - rect.top) / rect.height) * device.height) };
}

/** keyDown + keyUp for one keyboard event. CDP needs "\r" as text for Enter to act as a keypress. */
export function keyParams(e: KeyLike): [CdpKeyParams, CdpKeyParams] {
  const modifiers = cdpModifiers(e);
  const text = e.key.length === 1 ? e.key : e.key === "Enter" ? "\r" : undefined;
  const base = { key: e.key, code: e.code, windowsVirtualKeyCode: e.keyCode, modifiers, ...(text !== undefined ? { text } : {}) };
  return [{ type: "keyDown", ...base }, { type: "keyUp", ...base }];
}
