# File: services/agent-orchestrator/src/browser_cdp.py
import json
from collections.abc import Callable
from typing import Any


class BrowserCDPService:
    """Python CDP Co-Browsing helper that injects the visual cursor and dispatches input events."""

    def __init__(self, send_command: Callable[[str, dict[str, Any]], dict[str, Any]]) -> None:
        self.send_command = send_command

    def inject_cursor(self) -> None:
        """Injects visible red cobrowsing cursor into the active CDP page."""
        js = """
        if (!window.__agentCursorInstalled) {
            window.__agentCursorInstalled = true;
            const c = document.createElement('div');
            c.id = '__agent_cdp_cursor';
            c.style.cssText = 'position:fixed;top:0;left:0;width:18px;height:18px;border-radius:50%;background:rgba(255,59,48,0.85);border:2px solid #fff;box-shadow:0 0 8px rgba(0,0,0,0.6);pointer-events:none;z-index:2147483647;transform:translate(-50%,-50%);transition:top 0.08s,left 0.08s;';
            document.documentElement.appendChild(c);
            window.__moveAgentCursor = (x, y) => {
                const el = document.getElementById('__agent_cdp_cursor');
                if (el) { el.style.left = x + 'px'; el.style.top = y + 'px'; }
            };
        }
        """
        self.send_command("Runtime.evaluate", {"expression": js})

    def click(
        self, selector: str | None = None, x: int | None = None, y: int | None = None
    ) -> dict[str, int]:
        """Moves visual cobrowsing cursor and dispatches CDP left click."""
        self.inject_cursor()
        if selector:
            res = self.send_command(
                "Runtime.evaluate",
                {
                    "expression": f"""(() => {{
                    const el = document.querySelector({json.dumps(selector)});
                    if (!el) return null;
                    el.scrollIntoView({{block: 'center', inline: 'center'}});
                    const r = el.getBoundingClientRect();
                    return {{x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2)}};
                }})()""",
                    "returnByValue": True,
                },
            )
            pt = (res.get("result") or {}).get("value")
            if not pt:
                raise ValueError(f"Selector not found: {selector}")
            x, y = int(pt["x"]), int(pt["y"])
        if x is None or y is None:
            raise ValueError("Must provide selector or (x, y) coordinates")

        self.send_command("Runtime.evaluate", {"expression": f"window.__moveAgentCursor({x}, {y})"})
        self.send_command("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": x, "y": y})
        self.send_command(
            "Input.dispatchMouseEvent",
            {"type": "mousePressed", "x": x, "y": y, "button": "left", "clickCount": 1},
        )
        self.send_command(
            "Input.dispatchMouseEvent",
            {"type": "mouseReleased", "x": x, "y": y, "button": "left", "clickCount": 1},
        )
        return {"x": x, "y": y}

    def type_text(
        self,
        text: str,
        selector: str | None = None,
        clear_first: bool = True,
        press_enter: bool = False,
    ) -> dict[str, Any]:
        """Clicks optional selector, clears existing value if requested, and dispatches key events."""
        if selector:
            self.click(selector=selector)
            if clear_first:
                self.send_command(
                    "Runtime.evaluate",
                    {
                        "expression": f"""(() => {{
                        const el = document.querySelector({json.dumps(selector)});
                        if (el && 'value' in el) {{
                            el.value = '';
                            el.dispatchEvent(new Event('input', {{bubbles: true}}));
                        }}
                    }})()"""
                    },
                )
        for ch in text:
            self.send_command(
                "Input.dispatchKeyEvent", {"type": "keyDown", "text": ch, "unmodifiedText": ch}
            )
            self.send_command(
                "Input.dispatchKeyEvent", {"type": "keyUp", "text": ch, "unmodifiedText": ch}
            )
        if press_enter:
            self.send_command(
                "Input.dispatchKeyEvent",
                {
                    "type": "rawKeyDown",
                    "windowsVirtualKeyCode": 13,
                    "key": "Enter",
                    "code": "Enter",
                },
            )
            self.send_command(
                "Input.dispatchKeyEvent",
                {"type": "keyUp", "windowsVirtualKeyCode": 13, "key": "Enter", "code": "Enter"},
            )
        return {"typed": len(text), "press_enter": press_enter}
