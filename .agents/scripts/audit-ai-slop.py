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
