#!/usr/bin/env python3
"""
Apply teacher distillation labels onto an existing candidate-label HF dataset.

This keeps the original prepared training rows intact and replaces only the
candidate-label targets for rows where a teacher label is available.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Dict

from datasets import Dataset, load_from_disk


def load_teacher_rows(path: Path, *, only_correct: bool = False) -> Dict[str, Dict[str, Any]]:
    rows: Dict[str, Dict[str, Any]] = {}
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            item = json.loads(line)
            sample_id = str(item.get("sample_id") or "")
            flip_hash = str(item.get("flip_hash") or "")
            candidate_key = str(item.get("candidate_key") or "")
            if candidate_key not in {"a", "b"}:
                continue
            if only_correct:
                teacher_predicted = str(item.get("teacher_predicted") or "")
                expected_answer = str(item.get("expected_answer") or "")
                teacher_label = str(item.get("teacher_label") or "")
                if teacher_predicted != expected_answer or teacher_label not in {"winner", "loser"}:
                    continue
            teacher_sample_id = sample_id or flip_hash
            if not teacher_sample_id:
                continue
            dataset_sample_id = f"{teacher_sample_id}::candidate-label-{candidate_key}"
            rows[dataset_sample_id] = item
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Apply teacher distillation labels to a prepared candidate-label HF dataset"
    )
    parser.add_argument("--dataset-path", required=True, help="Base candidate-label HF dataset path")
    parser.add_argument("--teacher-jsonl", required=True, help="Teacher distillation JSONL path")
    parser.add_argument("--output-path", required=True, help="Output HF dataset path")
    parser.add_argument("--summary-path", help="Optional JSON summary path")
    parser.add_argument(
        "--only-correct",
        action="store_true",
        help="Apply only teacher rows whose teacher prediction matches the known expected answer",
    )
    args = parser.parse_args()

    dataset_path = Path(args.dataset_path).resolve()
    teacher_path = Path(args.teacher_jsonl).resolve()
    output_path = Path(args.output_path).resolve()
    summary_path = Path(args.summary_path).resolve() if args.summary_path else None

    dataset = load_from_disk(str(dataset_path))
    teacher_rows = load_teacher_rows(teacher_path, only_correct=args.only_correct)

    updated_rows = []
    updated_count = 0
    label_counts: Dict[str, int] = {}
    matched_teacher_sample_ids = set()

    for item in dataset:
        row = dict(item)
        teacher = teacher_rows.get(str(row.get("sample_id") or ""))
        if teacher:
            label = str(teacher.get("teacher_label") or row.get("training_target") or "skip")
            row["training_target"] = label
            row["assistant_target"] = label
            row["teacher_model"] = teacher.get("teacher_model")
            row["teacher_label"] = label
            row["teacher_predicted"] = teacher.get("teacher_predicted")
            row["teacher_selected_candidate"] = teacher.get("teacher_selected_candidate")
            row["teacher_analysis"] = teacher.get("teacher_analysis")
            row["teacher_distilled"] = True
            updated_count += 1
            matched_teacher_sample_ids.add(str(row.get("sample_id") or ""))
            label_counts[label] = label_counts.get(label, 0) + 1
        else:
            row["teacher_distilled"] = False
        updated_rows.append(row)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    Dataset.from_list(updated_rows).save_to_disk(str(output_path))

    summary = {
        "dataset_path": str(dataset_path),
        "teacher_jsonl": str(teacher_path),
        "output_path": str(output_path),
        "input_rows": len(dataset),
        "teacher_rows": len(teacher_rows),
        "updated_rows": updated_count,
        "matched_teacher_rows": len(matched_teacher_sample_ids),
        "unmatched_teacher_rows": max(len(teacher_rows) - len(matched_teacher_sample_ids), 0),
        "teacher_label_counts": label_counts,
        "only_correct": args.only_correct,
    }

    if summary_path:
        summary_path.parent.mkdir(parents=True, exist_ok=True)
        summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
