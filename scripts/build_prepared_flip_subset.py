#!/usr/bin/env python3
"""
Build a filtered/sorted subset of a prepared FLIP HF dataset.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Dict, List

from datasets import Dataset, load_from_disk


def sort_key(row: Dict[str, Any], sort_by: str) -> tuple:
    if sort_by == "weight_desc":
        return (-float(row.get("training_weight") or 0.0), str(row.get("flip_hash") or ""))
    if sort_by == "weight_asc":
        return (float(row.get("training_weight") or 0.0), str(row.get("flip_hash") or ""))
    return (str(row.get("sample_id") or row.get("flip_hash") or ""),)


def main() -> int:
    parser = argparse.ArgumentParser(description="Build a filtered/sorted subset of a prepared FLIP HF dataset")
    parser.add_argument("--dataset-path", required=True, help="Input HF dataset path")
    parser.add_argument("--output-path", required=True, help="Output HF dataset path")
    parser.add_argument("--take", type=int, default=0, help="Optional max rows after filtering/sorting")
    parser.add_argument(
        "--expected-strength",
        choices=["Strong", "Weak"],
        help="Optional expected_strength filter",
    )
    parser.add_argument(
        "--min-weight",
        type=float,
        default=None,
        help="Optional minimum training_weight filter",
    )
    parser.add_argument(
        "--sort-by",
        choices=["none", "weight_desc", "weight_asc"],
        default="none",
        help="Sort order for selected rows",
    )
    args = parser.parse_args()

    dataset_path = Path(args.dataset_path).resolve()
    output_path = Path(args.output_path).resolve()
    dataset = load_from_disk(str(dataset_path))
    rows: List[Dict[str, Any]] = [dict(item) for item in dataset]

    if args.expected_strength:
        rows = [row for row in rows if str(row.get("expected_strength") or "") == args.expected_strength]

    if args.min_weight is not None:
        rows = [row for row in rows if float(row.get("training_weight") or 0.0) >= args.min_weight]

    if args.sort_by != "none":
        rows.sort(key=lambda row: sort_key(row, args.sort_by))

    if args.take > 0:
        rows = rows[: min(args.take, len(rows))]

    output_path.parent.mkdir(parents=True, exist_ok=True)
    Dataset.from_list(rows).save_to_disk(str(output_path))

    summary = {
        "dataset_path": str(dataset_path),
        "output_path": str(output_path),
        "rows": len(rows),
        "expected_strength": args.expected_strength,
        "min_weight": args.min_weight,
        "sort_by": args.sort_by,
        "take": args.take,
    }
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
