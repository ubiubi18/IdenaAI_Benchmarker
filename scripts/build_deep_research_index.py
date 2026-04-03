#!/usr/bin/env python3
"""
Build a compact, machine-readable project index for ChatGPT Deep Research.

Output:
  - docs/deep-research-index.json
"""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, List


REPO_ROOT = Path(__file__).resolve().parents[1]
OUT_PATH = REPO_ROOT / "docs" / "deep-research-index.json"


@dataclass
class Entry:
    path: str
    role: str
    area: str
    notes: str
    size_bytes: int
    modified_utc: str


def run_git(args: List[str]) -> str:
    return (
        subprocess.check_output(["git", *args], cwd=REPO_ROOT)
        .decode("utf-8", errors="replace")
        .strip()
    )


def utc_iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).replace(microsecond=0).isoformat()


def rel(path: Path) -> str:
    return str(path.relative_to(REPO_ROOT)).replace("\\", "/")


def build_entry(path: Path, role: str, area: str, notes: str) -> Entry:
    stat = path.stat()
    return Entry(
        path=rel(path),
        role=role,
        area=area,
        notes=notes,
        size_bytes=stat.st_size,
        modified_utc=utc_iso(stat.st_mtime),
    )


def keep_existing(paths: Iterable[Path]) -> List[Path]:
    return [p for p in paths if p.exists() and p.is_file()]


def main() -> None:
    package_json = REPO_ROOT / "package.json"
    package = json.loads(package_json.read_text(encoding="utf-8"))

    docs_files = keep_existing(
        [
            REPO_ROOT / "docs" / "fork-plan.md",
            REPO_ROOT / "docs" / "worklog.md",
            REPO_ROOT / "docs" / "dependency-issues.md",
            REPO_ROOT / "docs" / "context-snapshot.md",
            REPO_ROOT / "docs" / "flip-format-reference.md",
            REPO_ROOT / "docs" / "flip-consensus-audit.md",
            REPO_ROOT / "docs" / "flip-challenge-import.md",
            REPO_ROOT / "docs" / "flip-reasoning-paper-optimizations.md",
            REPO_ROOT / "docs" / "deep-research-integration.md",
        ]
    )

    ai_backend_files = keep_existing(
        [
            REPO_ROOT / "main" / "ai-providers" / "bridge.js",
            REPO_ROOT / "main" / "ai-providers" / "prompt.js",
            REPO_ROOT / "main" / "ai-providers" / "constants.js",
            REPO_ROOT / "main" / "ai-providers" / "decision.js",
            REPO_ROOT / "main" / "ai-providers" / "profile.js",
            REPO_ROOT / "main" / "ai-providers" / "providers" / "openai.js",
            REPO_ROOT / "main" / "ai-providers" / "providers" / "gemini.js",
            REPO_ROOT / "main" / "ai-providers" / "providers" / "anthropic.js",
            REPO_ROOT / "main" / "ai-providers" / "providers" / "legacy-heuristic.js",
            REPO_ROOT / "main" / "ai-test-unit.js",
        ]
    )

    ai_ui_files = keep_existing(
        [
            REPO_ROOT / "renderer" / "pages" / "flips" / "new.js",
            REPO_ROOT / "renderer" / "pages" / "validation.js",
            REPO_ROOT / "renderer" / "pages" / "settings" / "ai.js",
            REPO_ROOT / "renderer" / "pages" / "settings" / "ai-test-unit.js",
            REPO_ROOT / "renderer" / "screens" / "validation" / "ai" / "solver-orchestrator.js",
            REPO_ROOT / "renderer" / "screens" / "validation" / "ai" / "test-unit-utils.js",
            REPO_ROOT / "renderer" / "screens" / "flips" / "components.js",
            REPO_ROOT / "renderer" / "screens" / "flips" / "machines.js",
        ]
    )

    ops_files = keep_existing(
        [
            REPO_ROOT / "scripts" / "import_flip_challenge.py",
            REPO_ROOT / "scripts" / "audit_flip_consensus.py",
            REPO_ROOT / "scripts" / "preload_ai_test_unit_queue.py",
            REPO_ROOT / "scripts" / "record_ai_test_run.sh",
            REPO_ROOT / "scripts" / "idena_flip_pipeline.py",
            REPO_ROOT / "scripts" / "build_deep_research_index.py",
        ]
    )

    tests_files = keep_existing(
        [
            REPO_ROOT / "main" / "ai-providers" / "bridge.test.js",
            REPO_ROOT / "main" / "ai-providers" / "decision.test.js",
            REPO_ROOT / "main" / "ai-providers" / "profile.test.js",
            REPO_ROOT / "main" / "ai-providers" / "providers" / "openai.test.js",
            REPO_ROOT / "main" / "ai-test-unit.test.js",
        ]
    )

    sections = {
        "docs": [
            build_entry(p, "documentation", "docs", "Project and implementation docs").__dict__
            for p in docs_files
        ],
        "ai_backend": [
            build_entry(p, "backend", "ai", "Main-process AI provider and decision logic").__dict__
            for p in ai_backend_files
        ],
        "ai_ui": [
            build_entry(p, "frontend", "ai", "UI flow for flip builder, validation, and test unit").__dict__
            for p in ai_ui_files
        ],
        "ops_and_data": [
            build_entry(p, "tooling", "ops", "Dataset import, audit, and run capture tools").__dict__
            for p in ops_files
        ],
        "tests": [
            build_entry(p, "tests", "quality", "Focused tests for AI bridge and helpers").__dict__
            for p in tests_files
        ],
    }

    payload = {
        "schema_version": "1.0",
        "generated_at_utc": datetime.now(tz=timezone.utc).replace(microsecond=0).isoformat(),
        "project": {
            "name": package.get("name", ""),
            "product_name": package.get("productName", ""),
            "version": package.get("version", ""),
            "repository": package.get("repository", ""),
        },
        "git": {
            "branch": run_git(["branch", "--show-current"]),
            "head": run_git(["rev-parse", "HEAD"]),
            "head_short": run_git(["rev-parse", "--short", "HEAD"]),
        },
        "entrypoints": {
            "desktop_main": "main/index.js",
            "renderer_flip_builder": "renderer/pages/flips/new.js",
            "renderer_validation": "renderer/pages/validation.js",
            "ai_bridge": "main/ai-providers/bridge.js",
        },
        "quick_start": [
            "npm run start",
            "npm run test -- --runInBand main/ai-providers/bridge.test.js",
            "npm run index:deep-research",
        ],
        "deep_research_hints": [
            "Start with docs/context-snapshot.md and docs/fork-plan.md for architecture and roadmap.",
            "Use docs/worklog.md for chronological implementation evidence and command history.",
            "Use docs/flip-format-reference.md before importing or normalizing flip JSON.",
            "Use main/ai-providers/bridge.js as primary backend entry for solver and generator behavior.",
            "Use renderer/pages/flips/new.js for AI-assisted flip builder UX and queue wiring.",
        ],
        "sections": sections,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"Wrote {rel(OUT_PATH)}")


if __name__ == "__main__":
    main()
