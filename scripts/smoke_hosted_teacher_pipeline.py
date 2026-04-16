#!/usr/bin/env python3
"""
Run a local smoke test for the hosted teacher pipeline.

This script verifies that the following path works end to end:
- export teacher request pack from a prepared dataset
- simulate hosted responses from an existing teacher eval report
- import hosted responses back into summary + distillation artifacts
- apply distilled labels onto a candidate-label HF dataset
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List

from datasets import load_from_disk


def run(args: List[str]) -> None:
    subprocess.run(args, check=True)


def load_json(path: Path) -> Dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_simulated_responses(
    *,
    report_path: Path,
    dataset_path: Path,
    output_path: Path,
) -> None:
    report = load_json(report_path)
    dataset = load_from_disk(str(dataset_path))
    rows = [dict(item) for item in dataset]
    results = list(report.get("results") or [])
    if len(rows) != len(results):
        raise ValueError(
            f"Report/results length mismatch: dataset has {len(rows)} rows but report has {len(results)} results"
        )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as handle:
        for row, result in zip(rows, results):
            analyses = result.get("candidateAnalyses") or {}
            sample_id = str(row.get("sample_id") or row.get("flip_hash") or "")
            if not sample_id:
                raise ValueError("Dataset row is missing sample_id/flip_hash")
            for candidate_key in ("a", "b"):
                payload = {
                    "request_id": f"{sample_id}::candidate-{candidate_key}",
                    "model": report.get("model"),
                    "analysis": analyses.get(candidate_key),
                    "latency_ms": int((result.get("latencyMs") or 0) / 2),
                }
                handle.write(json.dumps(payload, ensure_ascii=False) + "\n")


def count_jsonl(path: Path) -> int:
    with path.open("r", encoding="utf-8") as handle:
        return sum(1 for line in handle if line.strip())


def main() -> int:
    parser = argparse.ArgumentParser(description="Smoke-test the hosted teacher FLIP pipeline")
    parser.add_argument("--prepared-dataset", required=True, help="Prepared dataset used for teacher export")
    parser.add_argument("--teacher-report", required=True, help="Local teacher eval report used to simulate hosted responses")
    parser.add_argument("--candidate-label-dataset", required=True, help="Candidate-label HF dataset for apply step")
    parser.add_argument("--output-dir", required=True, help="Output directory for smoke artifacts")
    parser.add_argument("--expected-strength", choices=["Strong", "Weak"], help="Optional export filter")
    parser.add_argument("--min-weight", type=float, default=None, help="Optional export minimum weight")
    parser.add_argument("--sort-by", choices=["none", "weight_desc", "weight_asc"], default="none")
    parser.add_argument("--take", type=int, default=0, help="Optional max rows")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[1]
    prepared_dataset = Path(args.prepared_dataset).resolve()
    teacher_report = Path(args.teacher_report).resolve()
    candidate_label_dataset = Path(args.candidate_label_dataset).resolve()
    output_dir = Path(args.output_dir).resolve()
    pack_dir = output_dir / "teacher-pack"
    responses_path = output_dir / "simulated-responses.jsonl"
    summary_output = output_dir / "imported-summary.json"
    distill_output = output_dir / "imported-distill.jsonl"
    apply_output = output_dir / "applied-labels" / "hf-dataset"
    apply_summary = output_dir / "applied-labels" / "summary.json"

    export_cmd = [
        sys.executable,
        str(repo_root / "scripts" / "export_teacher_request_pack.py"),
        "--dataset-path",
        str(prepared_dataset),
        "--output-dir",
        str(pack_dir),
        "--sort-by",
        args.sort_by,
    ]
    if args.expected_strength:
        export_cmd.extend(["--expected-strength", args.expected_strength])
    if args.min_weight is not None:
        export_cmd.extend(["--min-weight", str(args.min_weight)])
    if args.take > 0:
        export_cmd.extend(["--take", str(args.take)])
    run(export_cmd)

    write_simulated_responses(
        report_path=teacher_report,
        dataset_path=prepared_dataset,
        output_path=responses_path,
    )

    run(
        [
            sys.executable,
            str(repo_root / "scripts" / "import_teacher_response_pack.py"),
            "--manifest",
            str(pack_dir / "manifest.jsonl"),
            "--responses",
            str(responses_path),
            "--summary-output",
            str(summary_output),
            "--distill-output",
            str(distill_output),
        ]
    )

    run(
        [
            sys.executable,
            str(repo_root / "scripts" / "apply_teacher_distillation_labels.py"),
            "--dataset-path",
            str(candidate_label_dataset),
            "--teacher-jsonl",
            str(distill_output),
            "--output-path",
            str(apply_output),
            "--summary-path",
            str(apply_summary),
            "--only-correct",
        ]
    )

    summary = load_json(summary_output)
    apply = load_json(apply_summary)
    result = {
        "examples": summary.get("examples"),
        "distill_rows": count_jsonl(distill_output),
        "accuracy": summary.get("accuracy"),
        "candidate_counts": summary.get("candidate_counts"),
        "candidate_slot_bias_score": summary.get("candidate_slot_bias_score"),
        "updated_rows": apply.get("updated_rows"),
        "matched_teacher_rows": apply.get("matched_teacher_rows"),
        "unmatched_teacher_rows": apply.get("unmatched_teacher_rows"),
        "output_dir": str(output_dir),
    }
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
