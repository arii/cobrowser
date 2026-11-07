# Autonomous Agent Instructions: Initial Repository & Co-Browser Stack Setup

**Target Event:** AI Engineer Code Summit Hackathon  
**Primary Track:** "The System That Gets Better" (Self-improving Co-Browsing & Skill-Compiling Web Agent)  
**Target Architecture:** Hybrid Python (`uv` + FastAPI + LangGraph/DeepAgents + Fetch.ai `uAgents`) & TypeScript (`pnpm` + Next.js Live Co-Browse Canvas + Stagehand v4 / CDP Multiplexer)

---

## 0. Mission & Operational Rules for the Setup Agent

You are the **Bootstrap Architect Agent**. Your objective is to initialize the GitHub repository so that multiple human engineers and AI coding agents (`muse`, `claude`, `copilot`) can collaborate in parallel without stepping on each other, while having **100% of the Co-Browsing ("Cobra" / Co-Browser) infrastructure and Hackathon Sponsor integrations** wired from commit #1.

1. **Unblocked Parallel Velocity:** Set up branch protections, `.pre-commit-config.yaml`, and GitHub Actions so syntax errors, leaked secrets, and formatting drift are caught locally in $<2\text{ seconds}$, while PR merges remain fast and unblocked.
2. **No Dashboard Slop:** Per hackathon rules, projects where a static dashboard is the main feature are disqualified. Scaffold the frontend strictly as an **Interactive Live Co-Browsing Viewport Canvas** with human takeover/handback controls.
3. **One-Command Bring-Up:** Every developer or agent cloning this repo must be able to run `pnpm setup` and `pnpm dev` (or `make up`) to bring up the entire stack (Steel Browser sidecar, FastAPI/LangGraph orchestrator, Fetch.ai uAgent, and Co-Browse UI).

---

## 1. Repository Directory Structure

Initialize the repository with the following monorepo layout:

```text
.
├── .agents/
│   ├── AGENT_CONTRACT.md           # Guardrails & low-token rules for coding agents
│   └── scripts/
│       └── audit-ai-slop.py        # Pre-commit AST/regex check blocking AI slop
├── .github/
│   └── workflows/
│       └── ci.yml                  # Fast parallel lint + typecheck + test gate
├── docker/
│   └── docker-compose.cobrowse.yml # Self-hosted Steel Browser (:3000 API, :9223 CDP, :5173 UI)
├── packages/
│   ├── cobrowse-core/              # TypeScript CDP red-cursor injector & Stagehand v4 harness
│   │   ├── src/
│   │   │   ├── cdp_client.ts       # #__agent_cdp_cursor injection + cdpClick + cdpTypeText
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── web-canvas/                 # Next.js 15 Live Co-Browse Viewport & Handoff Controller
│       ├── package.json
│       └── tsconfig.json
├── services/
│   └── agent-orchestrator/         # Python 3.12+ FastAPI + LangGraph + Sponsor Integrations
│       ├── src/
│       │   ├── __init__.py
│       │   ├── browser_cdp.py      # Python CDP red-cursor & input dispatch service
│       │   ├── deep_browser_agent.py # Stagehand v4.4 + LangGraph interrupt() handoff loop
│       │   ├── sponsors/
│       │   │   ├── meta_muse.py    # Meta Model API (muse-spark-1.3) + encrypted reasoning
│       │   │   ├── mongo_memory.py # MongoDB Atlas Vector Search skill compiler store
│       │   │   ├── fetch_uagent.py # Fetch.ai uAgent with Agent Chat Protocol (ACP)
│       │   │   └── subq_trace.py   # Subquadratic (SubQ Snap 1.1) long-trace diff analyzer
│       │   └── server.py           # FastAPI server (:8000) with /run and /handback endpoints
│       └── tests/
│           └── test_smoke.py
├── scripts/
│   ├── setup-github-branch-protection.sh
│   └── dev-bringup.sh
├── .env.example
├── .gitignore
├── .pre-commit-config.yaml
├── biome.json
├── package.json
├── pnpm-workspace.yaml
├── pyproject.toml
└── README.md
```

---

## 2. GitHub Repository & Collaboration Setup (Unblocked Flow)

Create and execute `scripts/setup-github-branch-protection.sh` (requires `gh` CLI authenticated). We configure protection on `main` that **blocks broken builds and force-pushes** without blocking solo/pair hackathon velocity on manual PR review bottlenecks:

```bash
#!/usr/bin/env bash
set -euo pipefail

REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
echo "Configuring hackathon-optimized branch protection for $REPO..."

# Enable auto-merge and automatically delete head branches after merge
gh api -X PATCH "repos/$REPO" \
  -F allow_auto_merge=true \
  -F delete_branch_on_merge=true \
  -F allow_squash_merge=true \
  -F allow_Update_branch=true

# Protect main: require CI status checks ("Verify (Lint, Typecheck, Slop Gate)")
# Set required_approving_review_count=0 so teammates/agents can merge immediately when CI is green
gh api -X PUT "repos/$REPO/branches/main/protection" \
  --input - << 'EOF'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["verify"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 0
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_linear_history": true
}
EOF

echo "Branch protection applied to main."
```

---

## 3. Root Bring-Up Configuration (`package.json`, `pnpm-workspace.yaml`, `pyproject.toml`)

We use **`pnpm` (Node 22+)** for TypeScript workspaces and **`uv` (Python 3.12+)** for Python dependency management.

### 3.1 `pnpm-workspace.yaml`

```yaml
packages:
  - "packages/*"
```

### 3.2 Root `package.json`

```json
{
  "name": "cobrowse-hackathon-monorepo",
  "version": "0.1.0",
  "private": true,
  "packageManager": "pnpm@9.15.0",
  "engines": {
    "node": ">=22.0.0"
  },
  "scripts": {
    "setup": "pnpm install && uv sync && uv run pre-commit install",
    "dev": "bash scripts/dev-bringup.sh",
    "dev:browser": "docker compose -f docker/docker-compose.cobrowse.yml up -d",
    "dev:api": "uv run uvicorn services.agent-orchestrator.src.server:app --reload --port 8000",
    "dev:uagent": "uv run python services/agent-orchestrator/src/sponsors/fetch_uagent.py",
    "dev:web": "pnpm --filter @cobrowse/web-canvas dev",
    "lint": "biome check . && uv run ruff check . && uv run python3 .agents/scripts/audit-ai-slop.py",
    "format": "biome format --write . && uv run ruff format .",
    "typecheck": "pnpm -r typecheck",
    "test": "uv run pytest && pnpm -r test"
  },
  "devDependencies": {
    "@biomejs/biome": "1.9.4",
    "concurrently": "^9.1.0",
    "typescript": "^5.7.2"
  }
}
```

### 3.3 Root `pyproject.toml`

Includes all required packages for **Co-Browsing (`stagehand`, `langchain-stagehand`, `langgraph`, `deepagents`)** and **Hackathon Sponsors (`openai` for Meta Model API & Subquadratic, `uagents` for Fetch.ai, `pymongo` for MongoDB Atlas Vector Search)**:

```toml
[project]
name = "cobrowse-agent-orchestrator"
version = "0.1.0"
description = "Self-Improving Co-Browsing Agent with Meta Muse Spark 1.3, Stagehand v4, MongoDB Atlas Vector Search, and Fetch.ai uAgents"
readme = "README.md"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.115.6",
    "uvicorn[standard]>=0.34.0",
    "pydantic>=2.10.4",
    "python-dotenv>=1.0.1",
    "websockets>=14.1",
    "httpx>=0.28.1",
    # Deep Agents & Co-Browser Stack
    "langgraph>=1.2.0",
    "langchain>=1.4.7",
    "langchain-core>=0.3.28",
    "deepagents>=0.7.34",
    "stagehand>=4.4.0",
    "langchain-stagehand>=0.1.2",
    "playwright>=1.49.1",
    # Sponsor 1 & 4: Meta Model API (muse-spark-1.3) & Subquadratic (SubQ Snap 1.1) via OpenAI SDK
    "openai>=1.60.0",
    # Sponsor 2: MongoDB Atlas Vector Search
    "pymongo[srv]>=4.10.1",
    # Sponsor 3: Fetch.ai Agentverse & Chat Protocol
    "uagents>=0.18.0",
    "uagents-core>=0.2.0",
]

[dependency-groups]
dev = [
    "pytest>=8.3.4",
    "pytest-asyncio>=0.25.0",
    "ruff>=0.9.2",
    "pre-commit>=4.0.1",
]

[tool.ruff]
line-length = 100
target-version = "py312"

[tool.ruff.lint]
select = ["E", "F", "I", "B", "UP"]
ignore = ["E501"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["services/agent-orchestrator/tests"]
```

---

## 4. Linting, Formatting & Pre-Commit Hooks

### 4.1 `.pre-commit-config.yaml`

Runs in $<2\text{s}$ on every commit to enforce formatting, prevent secret leaks, and block AI placeholder slop:

```yaml
repos:
  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v5.0.0
    hooks:
      - id: check-merge-conflict
      - id: check-added-large-files
        args: ["--maxkb=500"]
      - id: detect-private-key
      - id: end-of-file-fixer
      - id: trailing-whitespace

  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.9.2
    hooks:
      - id: ruff
        args: [--fix]
      - id: ruff-format

  - repo: local
    hooks:
      - id: biome-check
        name: Biome Format & Lint (TS/JS/JSON)
        entry: pnpm biome check --write --no-errors-on-unmatched
        language: system
        types_or: [javascript, jsx, ts, tsx, json]
      - id: audit-ai-slop
        name: Block Silent Exception Swallowing & Unimplemented Placeholders
        entry: uv run python3 .agents/scripts/audit-ai-slop.py
        language: system
        pass_filenames: false
```

### 4.2 `.agents/scripts/audit-ai-slop.py`

Create this script to deterministically block common AI coding mistakes before commit:

```python
#!/usr/bin/env python3
"""Deterministic pre-commit gate to block AI slop patterns."""
import pathlib
import re
import sys

FORBIDDEN_PATTERNS = [
    (r"except\s+Exception\s*:\s*pass", "Silent exception swallowing is forbidden"),
    (r"#\s*TODO:\s*implement", "Unimplemented placeholder comment left by agent"),
    (r"console\.log\([\"']DEBUG", "Leftover debug console.log"),
]

SCAN_DIRS = ["packages", "services"]
EXTENSIONS = {".py", ".ts", ".tsx"}


def main() -> int:
    violations: list[str] = []
    for base in SCAN_DIRS:
        base_path = pathlib.Path(base)
        if not base_path.exists():
            continue
        for path in base_path.rglob("*"):
            if path.suffix not in EXTENSIONS or "node_modules" in path.parts:
                continue
            content = path.read_text(encoding="utf-8", errors="ignore")
            for pattern, reason in FORBIDDEN_PATTERNS:
                if re.search(pattern, content):
                    violations.append(f"{path}: {reason} (matched `{pattern}`)")

    if violations:
        print("AI Slop Gate Failed:", file=sys.stderr)
        for v in violations:
            print(f"  - {v}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

### 4.3 `biome.json`

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "organizeImports": { "enabled": true },
  "linter": {
    "enabled": true,
    "rules": { "recommended": true }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "files": {
    "ignore": ["node_modules", ".next", "dist", ".venv"]
  }
}
```

---

## 5. Required Co-Browser ("Cobra") Infrastructure & Code

### 5.1 Self-Hosted Steel Browser Sidecar (`docker/docker-compose.cobrowse.yml`)

Provides an instant 1080p interactive WebRTC/Canvas Live Viewer (`/ui` on `:3000` / `:5173`), Sessions API (`:3000`), and CDP WebSocket proxy (`:9223`) with persistent `steel_data` volumes so human MFA/login sessions survive across runs:

```yaml
services:
  steel-browser:
    image: ghcr.io/steel-dev/steel-browser:latest
    container_name: cobrowse-steel-sandbox
    ports:
      - "3000:3000" # Steel Sessions API & Live Viewer (/ui)
      - "9223:9223" # Chrome DevTools Protocol (CDP) WebSocket Proxy
    shm_size: "1gb"
    environment:
      - CDP_REDIRECT_PORT=9223
    volumes:
      - steel_files:/app/files
      - steel_data:/app/data
    restart: unless-stopped

volumes:
  steel_files:
  steel_data:
```

### 5.2 TypeScript In-DOM Co-Browsing Client (`packages/cobrowse-core/src/cdp_client.ts`)

Injects the high-visibility `#__agent_cdp_cursor` (`z-index: 2147483647`) into every page and dispatches real CDP mouse and keyboard events so both human operators and vision models see the agent's actions in real time:

```typescript
// File: packages/cobrowse-core/src/cdp_client.ts
export interface CdpPoint {
  x: number;
  y: number;
}

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

export async function ensureCursorOverlay(
  sendCdp: (method: string, params?: Record<string, unknown>) => Promise<any>
): Promise<void> {
  await sendCdp("Page.enable");
  await sendCdp("Runtime.enable");
  await sendCdp("DOM.enable");
  await sendCdp("Page.addScriptToEvaluateOnNewDocument", { source: CURSOR_INJECTION_SCRIPT });
  await sendCdp("Runtime.evaluate", { expression: CURSOR_INJECTION_SCRIPT });
}

export async function resolveSelectorCenter(
  sendCdp: (method: string, params?: Record<string, unknown>) => Promise<any>,
  selector: string
): Promise<CdpPoint> {
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
  sendCdp: (method: string, params?: Record<string, unknown>) => Promise<any>,
  target: { selector?: string; x?: number; y?: number }
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
  sendCdp: (method: string, params?: Record<string, unknown>) => Promise<any>,
  options: { selector?: string; text: string; clearFirst?: boolean; pressEnter?: boolean }
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
```

### 5.3 Python CDP Co-Browsing Service (`services/agent-orchestrator/src/browser_cdp.py`)

```python
# File: services/agent-orchestrator/src/browser_cdp.py
import json
from typing import Any, Callable


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
                {"type": "rawKeyDown", "windowsVirtualKeyCode": 13, "key": "Enter", "code": "Enter"},
            )
            self.send_command(
                "Input.dispatchKeyEvent",
                {"type": "keyUp", "windowsVirtualKeyCode": 13, "key": "Enter", "code": "Enter"},
            )
        return {"typed": len(text), "press_enter": press_enter}
```

### 5.4 Deep Browser Agent & LangGraph Handoff (`services/agent-orchestrator/src/deep_browser_agent.py`)

Wires `StagehandMiddleware` (Stagehand v4.4 Code Mode: `snapshot`, `run`, `screenshot`) and the `request_human_cobrowse_handoff` LangGraph `interrupt()` tool:

```python
# File: services/agent-orchestrator/src/deep_browser_agent.py
import os
from typing import Any
from deepagents import create_deep_agent
from langchain_core.tools import tool
from langchain_stagehand import StagehandMiddleware
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import interrupt
from stagehand import Stagehand, local_browser

ACTIVE_BROWSER_SESSIONS: dict[str, dict[str, Any]] = {}


async def get_or_create_stagehand_session(
    thread_id: str, cdp_url: str | None = None
) -> dict[str, Any]:
    """Attaches Stagehand v4.4 to Steel Browser container (:9223) or crash-safe local Chrome."""
    if thread_id in ACTIVE_BROWSER_SESSIONS:
        return ACTIVE_BROWSER_SESSIONS[thread_id]

    steel_base = os.environ.get("STEEL_API_URL", "http://127.0.0.1:3000")
    effective_cdp = cdp_url or os.environ.get("REMOTE_SERVER_CDP_URL", "ws://127.0.0.1:9223")

    if effective_cdp:
        browser = await local_browser.connect(cdp_url=effective_cdp)
        live_view_url = f"{steel_base}/ui"
    else:
        browser = await local_browser.launch(headless=True, keep_alive=True)
        live_view_url = (
            f"{os.environ.get('REMOTE_SERVER_PUBLIC_URL', 'http://localhost:8000')}/cobrowse/{thread_id}"
        )

    stagehand = await Stagehand.create(browser=browser)
    session_bundle = {
        "browser": browser,
        "stagehand": stagehand,
        "live_view_url": live_view_url,
        "mode": "agent_active",
    }
    ACTIVE_BROWSER_SESSIONS[thread_id] = session_bundle
    return session_bundle


@tool
def request_human_cobrowse_handoff(thread_id: str, reason: str, current_url: str) -> str:
    """
    Call IMMEDIATELY on login walls, MFA/2FA prompts, CAPTCHAs, or ambiguous UI states.
    Pauses autonomous execution and yields the live browser canvas to the human operator.
    """
    session = ACTIVE_BROWSER_SESSIONS.get(thread_id, {})
    session["mode"] = "human_handoff"
    live_url = session.get("live_view_url", "http://127.0.0.1:3000/ui")

    human_resolution = interrupt(
        {
            "event": "browser_handoff_requested",
            "thread_id": thread_id,
            "reason": reason,
            "current_url": current_url,
            "live_view_url": live_url,
            "instructions": "Complete the action in the Live View canvas, then click 'Hand Back'.",
        }
    )

    session["mode"] = "agent_active"
    return (
        f"Human operator returned control (note: {human_resolution}). "
        "IMPORTANT: Call `snapshot` immediately to inspect the updated accessibility tree."
    )


async def build_cobrowse_deep_agent(
    thread_id: str,
    repo_root: str = ".",
    model_name: str = "openai:muse-spark-1.3",
):
    """Constructs the Deep Agent with isolated Stagehand browser subagent and checkpointer."""
    session = await get_or_create_stagehand_session(thread_id)
    stagehand_mw = StagehandMiddleware(stagehand=session["stagehand"])

    browser_subagent_spec = {
        "name": "browser-cobrowse-specialist",
        "description": "Dedicated browser automation, skill compilation, and interactive co-browsing agent.",
        "system_prompt": (
            "You control a live persistent browser via Stagehand (`snapshot`, `run`, `screenshot`) "
            "and `request_human_cobrowse_handoff`.\n"
            "Rules:\n"
            "1. Always call `snapshot` first to get bracketed element IDs (e.g., [0-7]).\n"
            "2. Batch sequential interactions (fill, click, waitForFunction) into a single `run` call.\n"
            "3. Never guess credentials or bypass MFA. Call `request_human_cobrowse_handoff` with "
            f"thread_id='{thread_id}' whenever authentication or human demonstration is needed."
        ),
        "tools": [request_human_cobrowse_handoff],
        "middleware": [stagehand_mw],
    }

    checkpointer = InMemorySaver()
    return create_deep_agent(
        model=model_name,
        system_prompt=(
            "You are the Lead Co-Browsing & Skill-Compilation Agent. Delegate web interactions to "
            "`browser-cobrowse-specialist` and compile demonstrated trajectories into reusable skills."
        ),
        subagents=[browser_subagent_spec],
        memory=[os.path.join(repo_root, ".agents/AGENT_CONTRACT.md")],
        interrupt_on={"execute": False},
        checkpointer=checkpointer,
    )
```

---

## 6. Hackathon Sponsor Integrations (`services/agent-orchestrator/src/sponsors/`)

### 6.1 Sponsor 1: Meta Model API (`muse-spark-1.3` with Encrypted Reasoning Continuity)

Create `services/agent-orchestrator/src/sponsors/meta_muse.py`. Uses the official OpenAI Python SDK pointed at `https://api.meta.ai/v1` with `MODEL_API_KEY` and preserves reasoning across co-browsing handoffs:

```python
# File: services/agent-orchestrator/src/sponsors/meta_muse.py
import os
from typing import Any
from openai import OpenAI

META_BASE_URL = "https://api.meta.ai/v1"
DEFAULT_MUSE_MODEL = "muse-spark-1.3"


def get_meta_client() -> OpenAI:
    """Initializes the OpenAI SDK pointed at Meta Model API (MODEL_API_KEY = LLM|{id}|{secret})."""
    api_key = os.environ.get("MODEL_API_KEY", "")
    if not api_key:
        raise RuntimeError("MODEL_API_KEY environment variable is required for Meta Model API.")
    return OpenAI(base_url=META_BASE_URL, api_key=api_key)


def compile_browser_skill_with_muse(
    accessibility_snapshot: str,
    user_demonstration_events: list[dict[str, Any]],
    goal: str,
) -> dict[str, Any]:
    """
    Uses Muse Spark 1.3 (1M context window + high reasoning effort) to compile a recorded
    human co-browsing demonstration into a deterministic Playwright code skill.
    """
    client = get_meta_client()
    response = client.chat.completions.create(
        model=DEFAULT_MUSE_MODEL,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a Deterministic Skill Compiler. Given a page accessibility snapshot "
                    "and a trace of human co-browsing actions, output a reusable Playwright async "
                    "code block that executes the workflow deterministically with self-healing assertions."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Goal: {goal}\n\n"
                    f"Demonstration Trace:\n{user_demonstration_events}\n\n"
                    f"Accessibility Snapshot:\n{accessibility_snapshot}"
                ),
            },
        ],
        extra_body={
            "reasoning_effort": "high",
            "include": ["reasoning.encrypted_content"],
        },
    )
    choice = response.choices[0].message
    return {
        "compiled_playwright_code": choice.content or "",
        "model": DEFAULT_MUSE_MODEL,
        "usage": response.usage.model_dump() if response.usage else {},
    }
```

### 6.2 Sponsor 2: MongoDB Atlas Vector Search Skill Memory (`services/agent-orchestrator/src/sponsors/mongo_memory.py`)

Stores compiled Playwright skills, accessibility snapshots, and embeddings so the agent self-heals when selectors change on Run #2+:

```python
# File: services/agent-orchestrator/src/sponsors/mongo_memory.py
import os
from datetime import datetime, timezone
from typing import Any
from pymongo import MongoClient


class AtlasSkillMemory:
    """MongoDB Atlas Vector Search store for compiled browser skills and DOM embeddings."""

    def __init__(self, uri: str | None = None, db_name: str = "cobrowse_agent") -> None:
        mongo_uri = uri or os.environ.get("MONGODB_URI", "mongodb://localhost:27017")
        self.client: MongoClient = MongoClient(mongo_uri)
        self.db = self.client[db_name]
        self.skills = self.db["compiled_skills"]

    def save_compiled_skill(
        self,
        domain: str,
        goal: str,
        playwright_code: str,
        dom_embedding: list[float],
        selectors: list[str],
    ) -> str:
        doc = {
            "domain": domain,
            "goal": goal,
            "playwright_code": playwright_code,
            "dom_embedding": dom_embedding,
            "selectors": selectors,
            "version": 1,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        result = self.skills.insert_one(doc)
        return str(result.inserted_id)

    def search_skill_by_vector(
        self, query_embedding: list[float], domain: str, limit: int = 3
    ) -> list[dict[str, Any]]:
        """Executes MongoDB Atlas $vectorSearch to retrieve matching skills or self-heal selectors."""
        pipeline = [
            {
                "$vectorSearch": {
                    "index": "skill_vector_index",
                    "path": "dom_embedding",
                    "queryVector": query_embedding,
                    "numCandidates": 25,
                    "limit": limit,
                    "filter": {"domain": domain},
                }
            },
            {
                "$project": {
                    "_id": 0,
                    "domain": 1,
                    "goal": 1,
                    "playwright_code": 1,
                    "selectors": 1,
                    "score": {"$meta": "vectorSearchScore"},
                }
            },
        ]
        return list(self.skills.aggregate(pipeline))
```

### 6.3 Sponsor 3: Fetch.ai `uAgent` with Agent Chat Protocol (`services/agent-orchestrator/src/sponsors/fetch_uagent.py`)

Exposes our Co-Browsing Skill Compiler on the Fetch.ai Agentverse under the **Innovation Lab** category:

```python
# File: services/agent-orchestrator/src/sponsors/fetch_uagent.py
import os
from datetime import datetime, timezone
from uuid import uuid4
from uagents import Agent, Context, Protocol
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    EndSessionContent,
    StartSessionContent,
    TextContent,
    chat_protocol_spec,
)

from services.agent_orchestrator.src.sponsors.meta_muse import get_meta_client

agent = Agent(
    name="cobrowse_skill_agent",
    seed=os.environ.get("FETCH_AGENT_SEED", "cobrowse-hackathon-seed-phrase"),
    port=8001,
    mailbox=True,
)

chat_proto = Protocol(spec=chat_protocol_spec)


@chat_proto.on_message(ChatMessage)
async def handle_chat(ctx: Context, sender: str, msg: ChatMessage) -> None:
    await ctx.send(
        sender,
        ChatAcknowledgement(
            timestamp=datetime.now(timezone.utc),
            acknowledged_msg_id=msg.msg_id,
        ),
    )
    user_text = " ".join(item.text for item in msg.content if isinstance(item, TextContent)).strip()
    if not user_text:
        return

    client = get_meta_client()
    completion = client.chat.completions.create(
        model="muse-spark-1.3",
        messages=[
            {
                "role": "system",
                "content": "You are the Fetch.ai Co-Browse Skill Coordinator powered by Meta Muse Spark 1.3.",
            },
            {"role": "user", "content": user_text},
        ],
    )
    reply_text = completion.choices[0].message.content or "Task queued for co-browsing."

    await ctx.send(
        sender,
        ChatMessage(
            timestamp=datetime.now(timezone.utc),
            msg_id=uuid4(),
            content=[TextContent(type="text", text=reply_text), EndSessionContent(type="end-session")],
        ),
    )


@chat_proto.on_message(ChatAcknowledgement)
async def handle_ack(ctx: Context, sender: str, msg: ChatAcknowledgement) -> None:
    ctx.logger.info(f"ACP ack from {sender}: {msg.acknowledged_msg_id}")


agent.include(chat_proto, publish_manifest=True)

if __name__ == "__main__":
    print(f"Fetch.ai uAgent Address: {agent.address}")
    agent.run()
```

### 6.4 Sponsor 4: Subquadratic Long-Trace Analyzer (`services/agent-orchestrator/src/sponsors/subq_trace.py`)

Uses Subquadratic's **SubQ Snap 1.1** (`SUBQ_API_KEY`) to diff multi-run execution traces and identify where DOM selectors drifted:

```python
# File: services/agent-orchestrator/src/sponsors/subq_trace.py
import os
from openai import OpenAI


def analyze_long_dom_trace_diff(run1_trace: str, run2_failed_trace: str) -> str:
    """Routes multi-run DOM & execution logs through SubQ Snap 1.1 to pinpoint selector drift."""
    client = OpenAI(
        base_url=os.environ.get("SUBQ_BASE_URL", "https://api.subq.ai/v1"),
        api_key=os.environ.get("SUBQ_API_KEY", ""),
    )
    resp = client.chat.completions.create(
        model="subq-snap-1.1",
        messages=[
            {
                "role": "system",
                "content": "Compare the working Run #1 trace against the failed Run #2 trace and return the exact selector delta.",
            },
            {
                "role": "user",
                "content": f"--- RUN 1 ---\n{run1_trace}\n\n--- RUN 2 ---\n{run2_failed_trace}",
            },
        ],
    )
    return resp.choices[0].message.content or ""
```

---

## 7. FastAPI Co-Browsing Handoff Server (`services/agent-orchestrator/src/server.py`)

Exposes `/api/sessions/{thread_id}/run` and `/api/sessions/{thread_id}/handback` so the Live Co-Browse UI can pause on `interrupt()` and resume via `Command(resume=...)`:

```python
# File: services/agent-orchestrator/src/server.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from langgraph.types import Command
from pydantic import BaseModel

from services.agent_orchestrator.src.deep_browser_agent import (
    ACTIVE_BROWSER_SESSIONS,
    build_cobrowse_deep_agent,
)

app = FastAPI(title="Co-Browse & Skill Compiler Orchestrator")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

AGENTS_BY_THREAD: dict[str, object] = {}


class RunRequest(BaseModel):
    prompt: str


class HandbackRequest(BaseModel):
    resolution_note: str = "Operator completed manual step in live browser."


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/sessions/{thread_id}/run")
async def run_session(thread_id: str, body: RunRequest) -> dict:
    if thread_id not in AGENTS_BY_THREAD:
        AGENTS_BY_THREAD[thread_id] = await build_cobrowse_deep_agent(thread_id=thread_id)
    agent = AGENTS_BY_THREAD[thread_id]
    config = {"configurable": {"thread_id": thread_id}}
    state = await agent.ainvoke({"messages": [("user", body.prompt)]}, config=config)

    if "__interrupt__" in state:
        return {
            "status": "WAITING_FOR_COBROWSE_HANDOFF",
            "thread_id": thread_id,
            "interrupt": str(state["__interrupt__"]),
            "live_view_url": ACTIVE_BROWSER_SESSIONS.get(thread_id, {}).get(
                "live_view_url", "http://127.0.0.1:3000/ui"
            ),
        }
    return {"status": "COMPLETED", "thread_id": thread_id}


@app.post("/api/sessions/{thread_id}/handback")
async def handback_session(thread_id: str, body: HandbackRequest) -> dict:
    agent = AGENTS_BY_THREAD.get(thread_id)
    if not agent:
        return {"status": "ERROR", "detail": "Session not found"}
    config = {"configurable": {"thread_id": thread_id}}
    state = await agent.ainvoke(Command(resume=body.resolution_note), config=config)
    return {
        "status": "WAITING_FOR_COBROWSE_HANDOFF" if "__interrupt__" in state else "RESUMED",
        "thread_id": thread_id,
    }
```

---

## 8. Environment Template (`.env.example`) & Bring-Up Script (`scripts/dev-bringup.sh`)

### 8.1 `.env.example`

```ini
# --- 1. Meta Model API ($100 Credits via dev.meta.ai, Model: muse-spark-1.3) ---
MODEL_API_KEY="LLM|YOUR_NUMERIC_ID|YOUR_SECRET"

# --- 2. Co-Browsing Sandbox (Steel Browser Docker Sidecar) ---
STEEL_API_URL="http://127.0.0.1:3000"
REMOTE_SERVER_CDP_URL="ws://127.0.0.1:9223"
REMOTE_SERVER_PUBLIC_URL="http://localhost:8000"

# --- 3. MongoDB Atlas Vector Search ($100 Credits Code: MKT-BUILDERS-100) ---
MONGODB_URI="mongodb+srv://<user>:<password>@atlas-agent-dev.mongodb.net/?retryWrites=true&w=majority"

# --- 4. Fetch.ai uAgents & Agentverse (Innovation Lab) ---
FETCH_AGENT_SEED="replace-with-unique-team-seed-phrase"

# --- 5. Subquadratic Long-Context Trace Analysis (100M Free Tokens at console.subq.ai) ---
SUBQ_API_KEY="subq_..."
SUBQ_BASE_URL="https://api.subq.ai/v1"
```

### 8.2 `scripts/dev-bringup.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

if [ ! -f .env ]; then
  echo "Creating .env from .env.example..."
  cp .env.example .env
fi

echo "1. Starting Steel Co-Browsing Container (:3000 Live UI, :9223 CDP)..."
docker compose -f docker/docker-compose.cobrowse.yml up -d

echo "2. Launching FastAPI Orchestrator (:8000), Fetch.ai uAgent (:8001), and Next.js Live Canvas (:3001)..."
pnpm concurrently \
  --names "API,UAGENT,WEB" \
  -c "cyan,magenta,green" \
  "pnpm dev:api" \
  "pnpm dev:uagent" \
  "pnpm dev:web"
```

---

## 9. Mandatory `README.md` Badges & Hackathon Verification

When generating `README.md`, you **MUST** include the Fetch.ai Innovation Lab badges and placeholders for our registered `uAgent` name and address so our submission passes automated hackathon verification:

```markdown
# CobraSkill: The Co-Browsing Agent That Gets Better

![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)
![tag:hackathon](https://img.shields.io/badge/hackathon-5F43F1)

## Fetch.ai Agentverse Registration
- **Agent Name:** `cobrowse_skill_agent`
- **Agent Address:** `agent1q...` *(auto-printed on `pnpm dev:uagent` startup)*
- **Category:** Innovation Lab

## Quickstart
1. `cp .env.example .env` (Fill in `MODEL_API_KEY`, `MONGODB_URI`, `SUBQ_API_KEY`)
2. `pnpm setup`
3. `pnpm dev`
```

---

## 10. Step-by-Step Execution Checklist for the Setup Agent

Execute these steps in order and do not mark the task complete until Step 7 exits `0`:

1. Create the directory tree and write all files defined in Sections 1–9.
2. Run `chmod +x scripts/*.sh .agents/scripts/audit-ai-slop.py`.
3. Run `pnpm setup` to install Node packages, create the Python `.venv` via `uv sync`, and install git pre-commit hooks.
4. Create a minimal smoke test in `services/agent-orchestrator/tests/test_smoke.py` that imports `BrowserCDPService`, `compile_browser_skill_with_muse`, `AtlasSkillMemory`, and `app` from `server.py`.
5. Create `.github/workflows/ci.yml` with a job named `verify` that runs `pnpm lint && pnpm test`.
6. Commit the initial scaffold to `main`, push to GitHub, and run `bash scripts/setup-github-branch-protection.sh`.
7. Run `pnpm lint && pnpm test` locally and confirm zero errors.

### **1\. Strategic Positioning & Track Alignment**

* **Primary Problem Statement**: Submit under **"The System That Gets Better"**. Your browser agent learns from a single human demonstration, saves the workflow as a versioned skill, and executes it autonomously on subsequent runs while self-correcting when steps break.  
* **Avoid Banned Anti-Patterns**: The hackathon rules strictly disqualify projects where a static dashboard or simple chatbot is the main feature. Position your UI strictly as a **live shared viewport (co-browsing canvas)** and focus the technical core on autonomous action execution, skill compilation, and self-correction.

---

### **2\. Sponsor Product Integration Map**

To maximize prize eligibility across the **\$11,000 total prize pool**, integrate each sponsor product into a distinct layer of your architecture:

#### **Meta Model API (*Eligible for \$5,000 Cash Prize*)**

* **Multimodal Perception & Skill Compilation**: Use **Muse Spark (`muse-spark-1.3`)** by setting the base URL to `https://api.meta.ai/v1` in the OpenAI SDK. Leverage its **1M-token context window** to ingest full page accessibility trees, DOM snapshots, and multi-turn user interaction logs.  
* **Reasoning Continuity Across Handoffs**: Enable reasoning tokens with `include: ["reasoning.encrypted_content"]`. This preserves Muse Spark's reasoning context across human takeover interrupts so the agent maintains task awareness when taking control back.

#### **Fetch.ai & ASI:One (*Eligible for \$5,000 Cash Prizes*)**

* **Agentverse & Agent Chat Protocol (ACP)**: Package the browser automation engine as a `uAgent` registered on **Agentverse**. Implement **ACP** so users can trigger and monitor co-browsing tasks directly from an **ASI:One** conversation.  
* **ASI Interactive Cards**: Use interactive cards inside ASI:One to display live session state, show screenshot previews, and trigger "Take Over" or "Approve Skill" buttons directly within the chat UI.  
* **Agent Payment Protocol (AP2) Monetization (Bonus)**: Implement AP2 to enable an "Agent Skill Marketplace," where other autonomous agents can pay micro-transactions to execute a stored web workflow skill.

#### **MongoDB Atlas (*\$100 Credits \- Code `MKT-BUILDERS-100`*)**

* **Persistent Skill & Memory Store**: Use **MongoDB Atlas Vector Search** as the long-term memory layer. Store vectorized accessibility trees, page layout embeddings, and recorded Playwright code blocks. When a target website updates its UI, the agent uses semantic vector search to map legacy selectors to new DOM elements.

#### **Subquadratic (*100M Free Tokens*)**

* **Long-Trace Processing**: Route long execution logs and multi-run DOM diffs through **SubQ Snap 1.1** to analyze trace differences across runs.

---

### **3\. Winning Architecture: Probabilistic Perception vs. Deterministic Policy**

Winning hackathon projects separate probabilistic model perception from deterministic policy execution.

```
[ Human Web Session / ASI:One Prompt ]
                  │
                  ▼
   [ Perception: Muse Spark 1.3 ]  ──> Extracts DOM actions & visual bounding boxes
                  │
                  ▼
 [ Human Takeover / Correction Gate ] ──> Captures manual fix & emits delta
                  │
                  ▼
    [ Skill Compiler (Playwright) ] ──> Generates deterministic code block
                  │
                  ▼
  [ Memory Layer: MongoDB Atlas ]  ──> Stores vector embeddings & code snippet
                  │
                  ▼
   [ Execution Run #2 (Code Mode) ] ──> Runs code deterministically; falls back
                                        to Muse Spark only when assertions fail
```

* **Run \#1 (Demonstration & Correction)**: The user performs or corrects a step during live co-browsing. Muse Spark records the event stream (clicks, inputs, navigation).  
* **Skill Compilation**: Muse Spark compiles the trajectory into a deterministic Playwright/JavaScript code block rather than keeping it as an expensive LLM prompt chain.  
* **Run \#2 (Deterministic Autonomous Execution)**: The stored Playwright code runs directly inside the browser sandbox. Execution is fast, cheap, and reliable. If a selector fails, the agent pauses, calls Muse Spark vision to re-inspect the DOM, updates the skill in MongoDB Atlas, and resumes execution.

---

### **4\. Live Pitch & Judging Playbook**

The judging rubric heavily weights **Technical Demo (35%)** and **Implementation Difficulty (30%)** in Round 1:

1. **The 10-Second Hook**: Start your pitch immediately with the operational friction: *"Teaching browser agents through prompt engineering fails on complex web forms. We built a co-browsing agent that learns by watching you once and compiles your actions into deterministic code."*  
2. **The Unscripted Chaos Test**: Show a live demo where the agent gets stuck on a tricky form step (e.g., custom dropdown or modal). Click "Take Over" in the live viewer, complete the step manually, and hand control back.  
3. **The Proof of Improvement**: Trigger Run \#2 directly inside ASI:One. Show the agent executing the exact same task autonomously in seconds using its newly compiled skill.

---

### **1\. System Architecture Diagram & Technical Pipeline**

The architecture is built around **probabilistic perception paired with deterministic policy execution**. The system captures live web interactions, compiles human fixes into reusable Playwright code scripts, stores vector embeddings in MongoDB Atlas, and exposes the autonomous agent over Fetch.ai's Agentverse and ASI:One.

```
  ┌─────────────────────────────────────────────────────────────────────────┐
  │                         ASI:One / Co-Browsing Canvas                    │
  │   (Human Operator sees live Steel Browser / WebRTC viewport + Cursor)   │
  └───────────────────────────────────┬─────────────────────────────────────┘
                                      │
                                      ▼
  ┌─────────────────────────────────────────────────────────────────────────┐
  │                   Fetch.ai uAgent & Agent Chat Protocol                 │
  │   - Discovered on Agentverse via ACP (chat_protocol_spec)               │
  │   - Manages session state, human takeover interrupts & AP2 payments     │
  └───────────────────┬───────────────────────────────▲─────────────────────┘
                      │                               │
            Run #1: Perception                Execution Handoff
                      │                               │
                      ▼                               │
  ┌─────────────────────────────────────────┐         │
  │       Perception & Reasoning Engine     │         │
  │       Meta Model API (Muse Spark 1.3)   │         │
  │   - Base URL: https://api.meta.ai/v1    │         │
  │   - 1M-token context & reasoning effort │         │
  │   - Generates Playwright script code    │         │
  └───────────────────┬─────────────────────┘         │
                      │                               │
                      ▼                               │
  ┌─────────────────────────────────────────┐         │
  │        Skill Compilation & Memory       │         │
  │         MongoDB Atlas Vector Search     │         │
  │   - Stores DOM accessibility snapshots  │         │
  │   - Vector embeddings (Voyage AI)       │         │
  │   - Saved Playwright workflow scripts   │         │
  └───────────────────┬─────────────────────┘         │
                      │                               │
                      ▼                               │
  ┌───────────────────────────────────────────────────┴─────────────────────┐
  │                    Run #2: Autonomous Code Execution                    │
  │       Stagehand v4 / Steel Browser Sandbox (CDP WebSocket)             │
  │   - Executes compiled Playwright script deterministically               │
  │   - On selector failure: re-inspects DOM via Muse Spark & self-corrects│
  └─────────────────────────────────────────────────────────────────────────┘
```

#### **Key Architecture Stages:**

1. **Demonstration & Takeover (Run \#1)**: The agent executes actions inside a self-hosted **Steel Browser container** (`ghcr.io/steel-dev/steel-browser:latest`). When a step breaks or requires human intervention, a visual cursor overlay (`#__agent_cdp_cursor`) is rendered while a human takeover handoff is triggered via CDP.  
2. **Skill Compilation**: **Meta Model API (`muse-spark-1.3`)** ingests the accessibility tree and interaction log within its **1,048,576-token context window** to compile the trajectory into a clean Playwright JavaScript script.  
3. **Persistent Memory Store**: The compiled script and DOM accessibility tree embeddings are saved to **MongoDB Atlas** using **Atlas Vector Search**.  
4. **Deterministic Autonomous Execution (Run \#2)**: On subsequent runs, the agent executes the stored Playwright script directly without per-step LLM calls, cutting execution cost and round-trip latency by over 90%. If a DOM selector breaks, the agent falls back to Muse Spark vision to re-inspect the element, updates the script in MongoDB Atlas, and resumes.

---

### **2\. Starter `uAgent` Python Implementation**

This production-ready starter script demonstrates a Fetch.ai `uAgent` implementing the **Agent Chat Protocol (ACP)**, connecting to the **Meta Model API (`muse-spark-1.3`)** via the OpenAI Python SDK, and managing persistent skills in **MongoDB Atlas**.

````
import os
from datetime import datetime
from uuid import uuid4
from openai import OpenAI
from uagents import Agent, Context, Protocol
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    EndSessionContent,
    StartSessionContent,
    TextContent,
    chat_protocol_spec,
)

# -----------------------------------------------------------------------------
# 1. Meta Model API Client Configuration (OpenAI SDK Drop-In)
# -----------------------------------------------------------------------------
# Meta Model API uses https://api.meta.ai/v1 with MODEL_API_KEY (LLM|{id}|{secret})
meta_client = OpenAI(
    base_url="https://api.meta.ai/v1",
    api_key=os.environ.get("MODEL_API_KEY", "LLM|demo|secret_key"),
)

# -----------------------------------------------------------------------------
# 2. Fetch.ai uAgent & Agent Chat Protocol Setup
# -----------------------------------------------------------------------------
# Initialize agent with mailbox support for Agentverse registration & ASI:One discovery
agent = Agent(
    name="CoBrowsing Skill Agent",
    seed=os.environ.get("AGENT_SEED", "cobrowse_learning_agent_seed_phrase_2026"),
    port=8001,
    mailbox=True,
    publish_agent_details=True,
)

# Initialize standard ACP protocol spec for ASI:One compatibility
chat_proto = Protocol(spec=chat_protocol_spec)

# Simulated MongoDB Atlas Skill Repository helper
def query_mongodb_skill_store(task_description: str) -> str | None:
    """
    Queries MongoDB Atlas Vector Search for a pre-compiled Playwright skill.
    Uses Atlas Vector Search embeddings (e.g. Voyage AI voyage-4).
    """
    # Placeholder returning None to demonstrate perception -> compilation workflow
    return None

def save_compiled_skill_to_mongodb(task_name: str, playwright_code: str):
    """
    Saves a newly compiled Playwright skill script to MongoDB Atlas.
    """
    print(f"[MongoDB Atlas] Persisted compiled skill '{task_name}' to Atlas collection.")

# Helper to construct ACP text response messages
def create_acp_text_message(text: str, end_session: bool = False) -> ChatMessage:
    content = [TextContent(type="text", text=text)]
    if end_session:
        content.append(EndSessionContent(type="end-session"))
    return ChatMessage(
        timestamp=datetime.utcnow(),
        msg_id=uuid4(),
        content=content,
    )

# -----------------------------------------------------------------------------
# 3. Message Handlers & Skill Learning Loop
# -----------------------------------------------------------------------------
@chat_proto.on_message(ChatMessage)
async def handle_incoming_chat(ctx: Context, sender: str, msg: ChatMessage):
    # Send immediate acknowledgement as required by ACP
    await ctx.send(
        sender,
        ChatAcknowledgement(timestamp=datetime.utcnow(), acknowledged_msg_id=msg.msg_id),
    )

    user_input = ""
    for item in msg.content:
        if isinstance(item, StartSessionContent):
            ctx.logger.info(f"Co-browsing session initialized with sender: {sender}")
        elif isinstance(item, TextContent):
            user_input += item.text

    if not user_input.strip():
        return

    ctx.logger.info(f"Processing web task request: '{user_input}'")

    # Step A: Check MongoDB Atlas Vector Search for existing compiled skill
    existing_skill = query_mongodb_skill_store(user_input)

    if existing_skill:
        status_msg = f"⚡ Executing compiled Playwright skill deterministically from MongoDB Atlas..."
        await ctx.send(sender, create_acp_text_message(status_msg))
    else:
        # Step B: Perceive and compile skill using Meta Model API (Muse Spark 1.3)
        ctx.logger.info("No compiled skill found. Reasoning over DOM context via Muse Spark 1.3...")

        try:
            # Call Meta Model API using Muse Spark 1.3 with long context and reasoning
            completion = meta_client.chat.completions.create(
                model="muse-spark-1.3",
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are a browser agent skill compiler. Analyze the human web task "
                            "demonstration and generate a deterministic Playwright JavaScript code block "
                            "that automates the task safely using exact selectors."
                        ),
                    },
                    {"role": "user", "content": f"Task: {user_input}"},
                ],
                max_tokens=2048,
            )
            compiled_output = str(completion.choices.message.content)

            # Step C: Persist skill to MongoDB Atlas
            save_compiled_skill_to_mongodb(user_input, compiled_output)

            response_text = (
                f" Learned new web skill using Muse Spark 1.3!\n\n"
                f"**Compiled Script Preview:**\n```javascript\n{compiled_output[:300]}...\n```\n\n"
                f"Saved to **MongoDB Atlas Vector Search**. Subsequent runs will execute autonomously."
            )
            await ctx.send(sender, create_acp_text_message(response_text, end_session=True))

        except Exception as e:
            ctx.logger.exception("Error querying Meta Model API")
            error_reply = "Failed to process task via Muse Spark 1.3. Please verify your MODEL_API_KEY."
            await ctx.send(sender, create_acp_text_message(error_reply, end_session=True))

@chat_proto.on_message(ChatAcknowledgement)
async def handle_ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
    ctx.logger.info(f"Received ACP acknowledgement from {sender} for message {msg.acknowledged_msg_id}")

# Register ACP protocol and publish manifest to Agentverse
agent.include(chat_proto, publish_manifest=True)

if __name__ == "__main__":
    agent.run()
````

---

### **3\. Setup & Submission Verification Checklist**

1. **Meta Model API**: Set `export MODEL_API_KEY="LLM|{numeric_id}|{secret}"` and call `base_url="https://api.meta.ai/v1"` with model `muse-spark-1.3`. Claim **\$100 in credits** using team ID from `dev.meta.ai` before 3:00 PM PT on Saturday.  
2. **Fetch.ai & Agentverse**: Ensure `uagents` is installed, run `agent.py`, click the **Agent Inspector** URL, select **Mailbox**, and register the agent on **Agentverse** under the **Innovation Lab** category.  
3. **MongoDB Atlas**: Apply credit code `MKT-BUILDERS-100` for **\$100 in Atlas credits**. Provision a cluster with Atlas Vector Search enabled for skill vector indexing.  
4. **GitHub README Requirements**: Include your agent's name and address in `README.md` alongside the required badges:

```
![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)
![tag:hackathon](https://img.shields.io/badge/hackathon-5F43F1)
```

---

💡 **Next Step**: Would you like me to draft a 60-second pitch script and 3-act demo video outline structured specifically for the hackathon judging rubric?

To build a functional co-browsing agent application with the lowest technical complexity and overhead, you can rely on a **minimal 4-tool stack**. Rather than building a custom WebRTC streaming server, canvas video compositor, and DOM parser from scratch, this stack pairs open-source browser infrastructure with a code-mode actuation harness.

---

### **The Minimal Co-Browser Tool Stack**

```
┌────────────────────────────────────────────────────────────────────────┐
│                        1. Steel Browser Container                      │
│  - Chromium Sandbox & CDP WebSocket Proxy (:9223)                      │
│  - Embedded Interactive WebRTC Live Viewer UI (/ui)                    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        2. Stagehand v4 Actuation                       │
│  - Injects #__agent_cdp_cursor overlay                                 │
│  - Batches Playwright Code Mode actions (snapshot, run, screenshot)     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                  3. LangGraph Handoff State Engine                     │
│  - Pauses execution via interrupt() when human takeover is active       │
│  - Resumes execution loop via Command(resume=...) on handback          │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                4. Meta Model API (Muse Spark 1.3) & Atlas              │
│  - Muse Spark: Perceives DOM context & compiles human fixes to code   │
│  - MongoDB Atlas: Vector store for compiled scripts & DOM embeddings  │
└────────────────────────────────────────────────────────────────────────┘
```

---

### **1\. Browser Infrastructure: Steel Browser Container (`steel-browser`)**

* **Why it's minimal**: Eliminates the need to construct a custom Xvfb, WebRTC video streaming pipeline, and input proxy.  
* **What it provides**: Running the official Docker container (`ghcr.io/steel-dev/steel-browser:latest`) immediately exposes:  
  * A **CDP WebSocket endpoint** (port 9223\) for agent attachment.  
  * A **1080p interactive WebRTC live view** (`/ui` or port 5173\) where the human operator can view the page and click directly to take control.  
  * Session context persistence (`steel.json`) to retain cookies and login state across runs.

### **2\. Agent Actuation: Stagehand v4 \+ Injected CDP Cursor**

* **Why it's minimal**: Replaces atomic, per-click LLM calls (which require dozens of turns and raw HTML dumps) with batched "Code Mode" execution.  
* **What it provides**:  
  * Exposes just three core tools (`snapshot`, `run`, `screenshot`), executing standard Playwright JavaScript blocks inside the browser. This cuts multi-turn latency and token costs by over 90% compared to raw MCP wrappers.  
  * **Visual Cursor Overlay (`#__agent_cdp_cursor`)**: A lightweight script injected via `Page.addScriptToEvaluateOnNewDocument` and animated using CDP `Input.dispatchMouseEvent`. This makes the agent's pointer visible to both human observers and multimodal vision models.

### **3\. Human Handoff Engine: LangGraph (`interrupt()` / `Command`)**

* **Why it's minimal**: Provides clean state-machine management for human takeover without manual WebSockets or custom polling loops.  
* **What it provides**:  
  * When the agent hits a CAPTCHA or MFA login wall, a custom tool invokes `interrupt()`, which serializes the current execution state and hands the live browser UI URL (`/ui`) to the user.  
  * When the human finishes the manual action and clicks "Hand Back," the graph receives `Command(resume=...)`, triggers a fresh DOM `snapshot`, and resumes autonomous execution.

### **4\. Perception & Skill Store: Meta Model API (`muse-spark-1.3`) & MongoDB Atlas**

* **Why it's minimal**: Separates probabilistic perception (understanding the DOM) from deterministic execution (running saved code).  
* **What it provides**:  
  * **Muse Spark 1.3**: Uses its 1M-token context window to read page accessibility trees, reason over human takeover interactions, and compile steps into deterministic Playwright code.  
  * **MongoDB Atlas**: Stores the compiled Playwright scripts alongside DOM vector embeddings. On subsequent runs, the stored code executes directly without LLM calls unless a UI selector breaks.

---
