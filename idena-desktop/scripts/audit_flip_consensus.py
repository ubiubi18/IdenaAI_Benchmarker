#!/usr/bin/env python3
"""
Audit local AI test-unit runs against FLIP-Challenge human consensus.

Reads:
- ai-benchmark/test-unit-runs.jsonl (run-level summary)
- ai-benchmark/session-metrics.jsonl (per-flip model outputs)
- parquet files in .tmp/flip-challenge/data (for agreed_answer labels)

Writes a JSON audit report with per-flip and aggregate metrics.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional

try:
    import pyarrow.parquet as pq
except ModuleNotFoundError as exc:  # pragma: no cover
    raise SystemExit(
        "Missing dependency: pyarrow\n"
        "Install with: python3 -m pip install --user pyarrow"
    ) from exc


def parse_iso(value: str) -> datetime:
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    return datetime.fromisoformat(text).astimezone(timezone.utc)


def load_jsonl(path: Path) -> List[dict]:
    if not path.exists():
        raise FileNotFoundError(f"File not found: {path}")
    rows = []
    for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if not line:
            continue
        rows.append(json.loads(line))
    return rows


def normalize_consensus_label(value: Optional[str]) -> Optional[str]:
    text = str(value or "").strip().lower()
    if text.startswith("left"):
        return "left"
    if text.startswith("right"):
        return "right"
    if text.startswith("report"):
        return "reported"
    if text.startswith("inappropr"):
        return "inappropriate"
    if text in {"", "-", "none", "unknown"}:
        return None
    return text


@dataclass
class ConsensusItem:
    answer: Optional[str]
    strength: Optional[str]
    raw: List[str]


def build_consensus_map(parquet_files: Iterable[Path]) -> Dict[str, ConsensusItem]:
    consensus: Dict[str, ConsensusItem] = {}
    for parquet_path in parquet_files:
        parquet = pq.ParquetFile(parquet_path)
        for batch in parquet.iter_batches(batch_size=512, columns=["task_id", "task_data"]):
            for row in batch.to_pylist():
                task_id = row.get("task_id")
                if not task_id or task_id in consensus:
                    continue

                task_data = json.loads(row.get("task_data") or "{}")
                agreed = task_data.get("agreed_answer") or []
                if not isinstance(agreed, list):
                    agreed = [str(agreed)]

                answer_raw = agreed[0] if len(agreed) > 0 else None
                strength_raw = agreed[1] if len(agreed) > 1 else None
                consensus[task_id] = ConsensusItem(
                    answer=normalize_consensus_label(answer_raw),
                    strength=str(strength_raw).strip().lower() if strength_raw else None,
                    raw=[str(x) for x in agreed],
                )
    return consensus


def select_run_entries(
    run: dict, session_entries: List[dict], window_minutes: int
) -> List[dict]:
    run_time = parse_iso(run["time"])
    summary = run.get("summary") or {}
    request = run.get("request") or {}
    needed = int(summary.get("totalFlips") or 0)
    provider = request.get("provider")
    model = request.get("model")

    min_time = run_time - timedelta(minutes=window_minutes)

    selected: List[dict] = []
    selected_total = 0

    for entry in reversed(session_entries):
        session = entry.get("session") or {}
        if session.get("type") != "local-test-unit":
            continue
        if provider and entry.get("provider") != provider:
            continue
        if model and entry.get("model") != model:
            continue

        entry_time = parse_iso(entry["time"])
        if entry_time > run_time or entry_time < min_time:
            continue

        selected.append(entry)
        selected_total += int((entry.get("summary") or {}).get("totalFlips") or 0)
        if selected_total >= needed:
            break

    return list(reversed(selected))


def build_report(run: dict, entries: List[dict], consensus_map: Dict[str, ConsensusItem]) -> dict:
    run_summary = run.get("summary") or {}
    request = run.get("request") or {}

    flips = []
    for entry in entries:
        for item in entry.get("flips") or []:
            flips.append(
                {
                    "hash": item.get("hash"),
                    "answer": str(item.get("answer") or "").strip().lower() or None,
                    "confidence": item.get("confidence"),
                    "latencyMs": item.get("latencyMs"),
                    "error": item.get("error"),
                }
            )

    total = len(flips)
    skipped = sum(1 for x in flips if x.get("answer") == "skip")
    rate_limit_errors = sum(
        1
        for x in flips
        if "429" in str(x.get("error") or "") or "rate_limit" in str(x.get("error") or "")
    )

    labeled = 0
    answered_labeled = 0
    correct = 0
    missing_consensus = 0
    detailed = []

    for item in flips:
        task_id = item.get("hash")
        predicted = item.get("answer")
        consensus = consensus_map.get(task_id)

        if not consensus or not consensus.answer:
            missing_consensus += 1
            truth = None
            is_correct = None
        else:
            truth = consensus.answer
            if truth in {"left", "right"}:
                labeled += 1
                if predicted in {"left", "right"}:
                    answered_labeled += 1
                    is_correct = predicted == truth
                    if is_correct:
                        correct += 1
                else:
                    is_correct = False
            else:
                is_correct = None

        detailed.append(
            {
                "hash": task_id,
                "predicted": predicted,
                "consensus": truth,
                "consensusRaw": consensus.raw if consensus else None,
                "consensusStrength": consensus.strength if consensus else None,
                "correct": is_correct,
                "error": item.get("error"),
                "latencyMs": item.get("latencyMs"),
                "confidence": item.get("confidence"),
            }
        )

    accuracy_labeled = (correct / labeled) if labeled else None
    accuracy_answered = (correct / answered_labeled) if answered_labeled else None

    return {
        "run": {
            "time": run.get("time"),
            "provider": request.get("provider"),
            "model": request.get("model"),
            "benchmarkProfile": request.get("benchmarkProfile"),
            "batchSize": request.get("batchSize"),
            "maxFlips": request.get("maxFlips"),
        },
        "runSummary": run_summary,
        "auditSummary": {
            "matchedFlips": total,
            "labeledFlips": labeled,
            "answeredLabeledFlips": answered_labeled,
            "correctLabeledFlips": correct,
            "accuracyOnLabeled": accuracy_labeled,
            "accuracyOnAnsweredLabeled": accuracy_answered,
            "skipped": skipped,
            "rateLimitErrorFlips": rate_limit_errors,
            "missingConsensus": missing_consensus,
        },
        "flips": detailed,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit latest AI run against human consensus.")
    parser.add_argument(
        "--runs-log",
        type=Path,
        default=Path.home() / "Library/Application Support/Idena/ai-benchmark/test-unit-runs.jsonl",
        help="path to test-unit-runs.jsonl",
    )
    parser.add_argument(
        "--session-log",
        type=Path,
        default=Path.home() / "Library/Application Support/Idena/ai-benchmark/session-metrics.jsonl",
        help="path to session-metrics.jsonl",
    )
    parser.add_argument(
        "--parquet-dir",
        type=Path,
        default=Path(".tmp/flip-challenge/data"),
        help="directory containing FLIP-Challenge parquet files",
    )
    parser.add_argument(
        "--run-index",
        type=int,
        default=-1,
        help="run index in runs log (default: -1 for latest)",
    )
    parser.add_argument(
        "--window-minutes",
        type=int,
        default=30,
        help="time window before run end used to collect batch session entries",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="output JSON report path (default: ai-benchmark/audits/auto-generated)",
    )
    args = parser.parse_args()

    runs = load_jsonl(args.runs_log)
    sessions = load_jsonl(args.session_log)
    if not runs:
        raise SystemExit("No runs found")

    run = runs[args.run_index]

    parquet_files = sorted(args.parquet_dir.glob("*.parquet"))
    if not parquet_files:
        raise SystemExit(f"No parquet files found in {args.parquet_dir}")

    consensus = build_consensus_map(parquet_files)
    run_entries = select_run_entries(run, sessions, args.window_minutes)
    report = build_report(run, run_entries, consensus)

    if args.output:
        out_path = args.output
    else:
        ts = run["time"].replace(":", "").replace("-", "")
        out_path = (
            Path.home()
            / "Library/Application Support/Idena/ai-benchmark/audits"
            / f"audit-{ts}.json"
        )

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    summary = report["auditSummary"]
    print("Saved audit report:", out_path)
    print(
        "matched={matched} labeled={labeled} answered={answered} correct={correct} "
        "accuracy_labeled={acc_labeled} accuracy_answered={acc_answered} "
        "skipped={skipped} rate_limit_errors={rate_limit}".format(
            matched=summary["matchedFlips"],
            labeled=summary["labeledFlips"],
            answered=summary["answeredLabeledFlips"],
            correct=summary["correctLabeledFlips"],
            acc_labeled=summary["accuracyOnLabeled"],
            acc_answered=summary["accuracyOnAnsweredLabeled"],
            skipped=summary["skipped"],
            rate_limit=summary["rateLimitErrorFlips"],
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

