#!/usr/bin/env python3
"""
Build a machine-readable repository index for ChatGPT connector ingestion.

Output:
  docs/chatgpt-connector-index.json
"""

from __future__ import annotations

import hashlib
import json
import subprocess
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, List, Optional


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "chatgpt-connector-index.json"


@dataclass
class FileEntry:
    path: str
    area: str
    role: str
    size_bytes: int
    sha256_12: str
    modified_utc: str
    notes: str


def rel(path: Path) -> str:
    return str(path.relative_to(ROOT)).replace("\\", "/")


def iso_utc(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).replace(microsecond=0).isoformat()


def exists(paths: Iterable[Path]) -> List[Path]:
    return [p for p in paths if p.exists() and p.is_file()]


def digest_12(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()[:12]


def mk_entry(path: Path, area: str, role: str, notes: str) -> FileEntry:
    st = path.stat()
    return FileEntry(
        path=rel(path),
        area=area,
        role=role,
        size_bytes=st.st_size,
        sha256_12=digest_12(path),
        modified_utc=iso_utc(st.st_mtime),
        notes=notes,
    )


def git_output(cwd: Path, args: List[str]) -> Optional[str]:
    try:
        return (
            subprocess.check_output(["git", *args], cwd=cwd, stderr=subprocess.DEVNULL)
            .decode("utf-8", errors="replace")
            .strip()
        )
    except Exception:
        return None


def git_meta(cwd: Path) -> dict:
    return {
        "path": rel(cwd),
        "branch": git_output(cwd, ["branch", "--show-current"]),
        "head": git_output(cwd, ["rev-parse", "HEAD"]),
        "head_short": git_output(cwd, ["rev-parse", "--short", "HEAD"]),
        "origin": git_output(cwd, ["remote", "get-url", "origin"]),
        "upstream": git_output(cwd, ["remote", "get-url", "upstream"]),
    }


def main() -> None:
    repo_name = ROOT.name
    now = datetime.now(tz=timezone.utc).replace(microsecond=0).isoformat()

    root_docs = exists(
        [
            ROOT / "README.md",
            ROOT / "LICENSE",
            ROOT / "docs" / "audit-manifest.md",
            ROOT / "docs" / "deep-research-integration.md",
            ROOT / "docs" / "private-repo-codex-context.md",
            ROOT / "docs" / "deep-research-private-notes.md",
        ]
    )

    desktop_core = exists(
        [
            ROOT / "main" / "index.js",
            ROOT / "main" / "ai-providers" / "bridge.js",
            ROOT / "renderer" / "pages" / "flips" / "new.js",
            ROOT / "renderer" / "pages" / "validation.js",
            ROOT / "docs" / "context-snapshot.md",
            ROOT / "docs" / "fork-plan.md",
            ROOT / "docs" / "worklog.md",
        ]
    )

    go_core = exists(
        [
            ROOT / "idena-go" / "main.go",
            ROOT / "idena-go" / "go.mod",
            ROOT / "idena-go" / "docs" / "context-snapshot.md",
            ROOT / "idena-go" / "docs" / "fork-plan.md",
            ROOT / "idena-go" / "docs" / "worklog.md",
        ]
    )

    tools = exists(
        [
            ROOT / "scripts" / "build_deep_research_index.py",
            ROOT / "scripts" / "build_chatgpt_connector_index.py",
            ROOT / "scripts" / "import_flip_challenge.py",
            ROOT / "scripts" / "audit_flip_consensus.py",
            ROOT / "scripts" / "preload_ai_test_unit_queue.py",
        ]
    )

    samples = sorted((ROOT / "samples").glob("**/*.json"))
    sample_subset = samples[:30]

    entries = []
    entries.extend(
        mk_entry(p, "root", "documentation", "Top-level repo docs")
        for p in root_docs
    )
    entries.extend(
        mk_entry(p, "desktop", "core", "Desktop AI benchmark and UI flow")
        for p in desktop_core
    )
    entries.extend(
        mk_entry(p, "chain", "core", "Node/chain fork sources and docs")
        for p in go_core
    )
    entries.extend(
        mk_entry(p, "tooling", "scripts", "Reproducibility and dataset tools")
        for p in tools
    )
    entries.extend(
        mk_entry(p, "samples", "data", "Sample labeled flips for audit/testing")
        for p in sample_subset
    )

    subrepos = []
    for d in [ROOT, ROOT / "idena-go"]:
        if (d / ".git").exists():
            subrepos.append(git_meta(d))

    payload = {
        "schema_version": "1.0",
        "generated_at_utc": now,
        "repository": {
            "name": repo_name,
            "relative_root": ".",
            "development_remote": git_output(ROOT, ["remote", "get-url", "origin"]),
            "reference_remote": git_output(ROOT, ["remote", "get-url", "upstream"]),
        },
        "git_context": subrepos,
        "connector_target": "chatgpt-deep-research",
        "quick_start": [
            "git remote -v",
            "git status --short --branch",
            "npm run index:deep-research",
            "python3 scripts/preload_ai_test_unit_queue.py --help",
            "python3 scripts/build_chatgpt_connector_index.py",
        ],
        "sections": {
            "root_docs_count": len(root_docs),
            "desktop_core_count": len(desktop_core),
            "go_core_count": len(go_core),
            "tooling_count": len(tools),
            "sample_json_count_total": len(samples),
            "sample_json_indexed": len(sample_subset),
        },
        "files": [asdict(e) for e in entries],
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {rel(OUT)}")


if __name__ == "__main__":
    main()
