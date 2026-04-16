#!/usr/bin/env python3
"""
Convert a prepared FLIP teacher evaluation report into per-candidate distillation rows.

The input is a JSON report produced by evaluate_prepared_flip_ollama.py in
candidate_analysis_compare mode. Each flip result becomes two candidate rows:
- one row for candidate A
- one row for candidate B

Each candidate row gets a teacher label:
- winner
- loser
- skip
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Dict, List

from datasets import load_from_disk


def load_json(path: Path) -> Dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def teacher_label_for_candidate(result: Dict[str, Any], candidate_key: str) -> str:
    predicted = str(result.get("predicted") or "skip")
    if predicted == "skip":
        return "skip"
    maps_to = str(result.get(f"option{candidate_key.upper()}MapsTo") or "")
    return "winner" if maps_to == predicted else "loser"


def build_lookup_key(row: Dict[str, Any]) -> tuple[str, str, str, str]:
    return (
        str(row.get("flip_hash") or row.get("flipHash") or ""),
        str(row.get("expected_answer") or row.get("expected") or ""),
        str(row.get("option_a_maps_to") or row.get("optionAMapsTo") or ""),
        str(row.get("option_b_maps_to") or row.get("optionBMapsTo") or ""),
    )


def load_example_lookup(dataset_path: Path | None) -> Dict[tuple[str, str, str, str], Dict[str, Any]]:
    if dataset_path is None:
        return {}

    dataset = load_from_disk(str(dataset_path))
    lookup: Dict[tuple[str, str, str, str], Dict[str, Any]] = {}
    for item in dataset:
        row = dict(item)
        key = build_lookup_key(row)
        lookup.setdefault(key, row)
    return lookup


def build_distillation_rows(
    report: Dict[str, Any], example_lookup: Dict[tuple[str, str, str, str], Dict[str, Any]]
) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    model = str(report.get("model") or "")

    for result in report.get("results") or []:
        analyses = result.get("candidateAnalyses") or {}
        example = example_lookup.get(build_lookup_key(result), {})
        for candidate_key in ("a", "b"):
            analysis = analyses.get(candidate_key)
            if not isinstance(analysis, dict):
                continue

            sample_id = str(example.get("sample_id") or result.get("sampleId") or result.get("flipHash") or "")

            rows.append(
                {
                    "id": f"{sample_id or 'unknown'}::candidate-{candidate_key}",
                    "sample_id": sample_id,
                    "flip_hash": result.get("flipHash"),
                    "candidate_key": candidate_key,
                    "candidate_frame_images": example.get(
                        f"option_{candidate_key}_frame_images"
                    ),
                    "teacher_model": model,
                    "teacher_predicted": result.get("predicted"),
                    "teacher_label": teacher_label_for_candidate(result, candidate_key),
                    "teacher_selected_candidate": result.get("selectedCandidate"),
                    "expected_answer": result.get("expected"),
                    "option_a_maps_to": result.get("optionAMapsTo"),
                    "option_b_maps_to": result.get("optionBMapsTo"),
                    "teacher_analysis": analysis,
                }
            )

    return rows


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build per-candidate distillation rows from a FLIP teacher evaluation report"
    )
    parser.add_argument("--report", required=True, help="Path to teacher evaluation report JSON")
    parser.add_argument(
        "--dataset-path",
        help="Optional prepared HF dataset path to recover candidate frame image paths",
    )
    parser.add_argument("--output", required=True, help="Output JSONL path")
    args = parser.parse_args()

    report_path = Path(args.report).resolve()
    dataset_path = Path(args.dataset_path).resolve() if args.dataset_path else None
    output_path = Path(args.output).resolve()

    report = load_json(report_path)
    rows = build_distillation_rows(report, load_example_lookup(dataset_path))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")

    summary = {
        "report": str(report_path),
        "output": str(output_path),
        "rows": len(rows),
        "teacher_model": report.get("model"),
        "dataset_path": str(dataset_path) if dataset_path else None,
    }
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
