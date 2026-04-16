#!/usr/bin/env python3
"""
Export a prepared FLIP dataset into a provider-agnostic teacher request pack.

Each prepared flip example becomes two request rows:
- candidate A analysis
- candidate B analysis

The output pack contains:
- manifest.jsonl
- prompts.json
- copied image files under images/
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path
from typing import Any, Dict, List, Set

from datasets import load_from_disk

from run_local_flip_ollama_smoke import CANDIDATE_ANALYSIS_SCHEMA, build_candidate_analysis_prompt


def sort_key(row: Dict[str, Any], sort_by: str) -> tuple:
    if sort_by == "weight_desc":
        return (-float(row.get("training_weight") or 0.0), str(row.get("flip_hash") or ""))
    if sort_by == "weight_asc":
        return (float(row.get("training_weight") or 0.0), str(row.get("flip_hash") or ""))
    return (str(row.get("sample_id") or row.get("flip_hash") or ""),)


def copy_images(
    image_paths: List[str], output_dir: Path, request_id: str, candidate_key: str
) -> List[str]:
    rel_paths: List[str] = []
    for index, source in enumerate(image_paths, start=1):
        src_path = Path(source).resolve()
        ext = src_path.suffix or ".png"
        rel_path = Path("images") / request_id / f"{candidate_key}-{index}{ext}"
        dest_path = output_dir / rel_path
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src_path, dest_path)
        rel_paths.append(str(rel_path))
    return rel_paths


def validate_candidate_images(row: Dict[str, Any], candidate_key: str) -> List[str]:
    image_paths = list(row.get(f"option_{candidate_key}_frame_images") or [])
    if len(image_paths) != 4:
        sample_id = str(row.get("sample_id") or row.get("flip_hash") or "unknown")
        raise ValueError(
            f"Expected 4 frame images for sample {sample_id} candidate {candidate_key}, got {len(image_paths)}"
        )
    return image_paths


def main() -> int:
    parser = argparse.ArgumentParser(description="Export a prepared FLIP dataset into a teacher request pack")
    parser.add_argument("--dataset-path", required=True, help="Prepared HF dataset path")
    parser.add_argument("--output-dir", required=True, help="Output directory for the teacher request pack")
    parser.add_argument("--take", type=int, default=0, help="Optional max examples after filtering/sorting")
    parser.add_argument(
        "--expected-strength",
        choices=["Strong", "Weak"],
        help="Optional expected_strength filter",
    )
    parser.add_argument("--min-weight", type=float, default=None, help="Optional minimum training_weight")
    parser.add_argument(
        "--sort-by",
        choices=["none", "weight_desc", "weight_asc"],
        default="none",
        help="Sort order before taking rows",
    )
    args = parser.parse_args()

    dataset_path = Path(args.dataset_path).resolve()
    output_dir = Path(args.output_dir).resolve()
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

    output_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = output_dir / "manifest.jsonl"
    prompts_path = output_dir / "prompts.json"

    prompt_catalog = {
        "candidate_analysis_v1": {
            "schema": CANDIDATE_ANALYSIS_SCHEMA,
            "description": "Analyze one 4-frame candidate story and return structured chronology/entity/causality fields.",
        }
    }
    seen_request_ids: Set[str] = set()

    with manifest_path.open("w", encoding="utf-8") as handle:
        for row in rows:
            flip_hash = str(row.get("flip_hash") or "")
            sample_id = str(row.get("sample_id") or flip_hash)
            for candidate_key in ("a", "b"):
                request_id = f"{sample_id}::candidate-{candidate_key}"
                if request_id in seen_request_ids:
                    raise ValueError(f"Duplicate teacher request_id generated: {request_id}")
                seen_request_ids.add(request_id)
                candidate_label = candidate_key.upper()
                image_paths = validate_candidate_images(row, candidate_key)
                relative_images = copy_images(image_paths, output_dir, request_id, candidate_key)
                item = {
                    "request_id": request_id,
                    "sample_id": sample_id,
                    "flip_hash": flip_hash,
                    "candidate_key": candidate_key,
                    "candidate_maps_to": row.get(f"option_{candidate_key}_maps_to"),
                    "expected_answer": row.get("expected_answer"),
                    "expected_strength": row.get("expected_strength"),
                    "training_weight": row.get("training_weight"),
                    "ranking_source": row.get("ranking_source"),
                    "prompt_id": "candidate_analysis_v1",
                    "prompt": build_candidate_analysis_prompt(flip_hash, candidate_label),
                    "response_schema": CANDIDATE_ANALYSIS_SCHEMA,
                    "images": relative_images,
                }
                handle.write(json.dumps(item, ensure_ascii=False) + "\n")

    prompts_path.write_text(json.dumps(prompt_catalog, indent=2), encoding="utf-8")

    summary = {
        "dataset_path": str(dataset_path),
        "output_dir": str(output_dir),
        "examples": len(rows),
        "requests": len(rows) * 2,
        "expected_strength": args.expected_strength,
        "min_weight": args.min_weight,
        "sort_by": args.sort_by,
        "take": args.take,
    }
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
