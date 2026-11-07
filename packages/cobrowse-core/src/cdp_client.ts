// File: packages/cobrowse-core/src/cdp_client.ts
export interface CdpPoint {
  x: number;
  y: number;
}

export interface CdpResponse {
  result?: { value?: unknown };
  [key: string]: unknown;
}

export type SendCdp = (method: string, params?: Record<string, unknown>) => Promise<CdpResponse>;

const CURSOR_INJECTION_SCRIPT = `
(() => {
  if (window.__agentCursorInstalled) return;
  window.__agentCursorInstalled = true;
  const cursor = document.createElement('div');
  cursor.id = '__agent_cdp_cursor';
  Object.assign(cursor.style, {
    position: 'fixed',
    top: '0px',
    left: '0px',
    width: '18px',
    height: '18px',
    borderRadius: '50%',
    background: 'rgba(255, 59, 48, 0.85)',
    border: '2px solid #ffffff',
    boxShadow: '0 0 8px rgba(0,0,0,0.6)',
    pointerEvents: 'none',
    zIndex: '2147483647',
    transform: 'translate(-50%, -50%)',
    transition: 'top 0.08s ease-out, left 0.08s ease-out',
  });
  document.documentElement.appendChild(cursor);
  window.__moveAgentCursor = (x, y, click = false) => {
    const el = document.getElementById('__agent_cdp_cursor');
    if (!el) return;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    if (click) {
      el.style.transform = 'translate(-50%, -50%) scale(0.7)';
      setTimeout(() => {
        el.style.transform = 'translate(-50%, -50%) scale(1)';
      }, 120);
    }
  };
})();
`;

export async function ensureCursorOverlay(sendCdp: SendCdp): Promise<void> {
  await sendCdp("Page.enable");
  await sendCdp("Runtime.enable");
  await sendCdp("DOM.enable");
  await sendCdp("Page.addScriptToEvaluateOnNewDocument", { source: CURSOR_INJECTION_SCRIPT });
  await sendCdp("Runtime.evaluate", { expression: CURSOR_INJECTION_SCRIPT });
}

export async function resolveSelectorCenter(sendCdp: SendCdp, selector: string): Promise<CdpPoint> {
  const { result } = await sendCdp("Runtime.evaluate", {
    expression: `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const rect = el.getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    })()`,
    returnByValue: true,
  });
  if (!result?.value) {
    throw new Error(`Element not found for selector: ${selector}`);
  }
  return result.value as CdpPoint;
}

export async function cdpClick(
  sendCdp: SendCdp,
  target: { selector?: string; x?: number; y?: number },
): Promise<CdpPoint> {
  await ensureCursorOverlay(sendCdp);
  const pt: CdpPoint = target.selector
    ? await resolveSelectorCenter(sendCdp, target.selector)
    : { x: target.x ?? 0, y: target.y ?? 0 };

  await sendCdp("Runtime.evaluate", {
    expression: `window.__moveAgentCursor && window.__moveAgentCursor(${pt.x}, ${pt.y}, true)`,
  });
  await sendCdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: pt.x, y: pt.y });
  await sendCdp("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: pt.x,
    y: pt.y,
    button: "left",
    clickCount: 1,
  });
  await sendCdp("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: pt.x,
    y: pt.y,
    button: "left",
    clickCount: 1,
  });
  return pt;
}

export async function cdpTypeText(
  sendCdp: SendCdp,
  options: { selector?: string; text: string; clearFirst?: boolean; pressEnter?: boolean },
): Promise<void> {
  if (options.selector) {
    await cdpClick(sendCdp, { selector: options.selector });
    if (options.clearFirst) {
      await sendCdp("Runtime.evaluate", {
        expression: `(() => {
          const el = document.querySelector(${JSON.stringify(options.selector)});
          if (el && 'value' in el) {
            el.value = '';
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }
        })()`,
      });
    }
  }
  for (const ch of options.text) {
    await sendCdp("Input.dispatchKeyEvent", { type: "keyDown", text: ch, unmodifiedText: ch });
    await sendCdp("Input.dispatchKeyEvent", { type: "keyUp", text: ch, unmodifiedText: ch });
  }
  if (options.pressEnter) {
    await sendCdp("Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      windowsVirtualKeyCode: 13,
      key: "Enter",
      code: "Enter",
    });
    await sendCdp("Input.dispatchKeyEvent", {
      type: "keyUp",
      windowsVirtualKeyCode: 13,
      key: "Enter",
      code: "Enter",
    });
  }
}
