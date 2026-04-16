#!/usr/bin/env python3
"""
Normalize human-teacher annotations exported from task bundles.

Input:
- task manifest JSONL from export_human_teacher_tasks.js
- annotation JSONL filled by humans

Output:
- normalized JSONL that keeps task metadata plus validated human labels
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Dict, List, Optional


VALID_FINAL_ANSWERS = {"left", "right", "skip"}
QUALITY_TIERS = ("reject", "bronze", "silver", "gold")


def load_jsonl(path: Path) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            rows.append(json.loads(line))
    return rows


def normalize_text(value: Any, *, max_length: int = 2000) -> str:
    return str(value or "").strip()[:max_length]


def normalize_bool(value: Any) -> Optional[bool]:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return value
    raw = str(value).strip().lower()
    if raw in {"true", "yes", "1"}:
        return True
    if raw in {"false", "no", "0"}:
        return False
    return None


def normalize_confidence(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if parsed < 0 or parsed > 1:
        return None
    return parsed


def normalize_captions(value: Any) -> List[str]:
    if not isinstance(value, list):
        return []
    return [normalize_text(item, max_length=400) for item in value[:4]]


def validate_final_answer(value: Any) -> str:
    raw = normalize_text(value, max_length=16).lower()
    if raw not in VALID_FINAL_ANSWERS:
        raise ValueError(f"Invalid final_answer: {raw or 'empty'}")
    return raw


def build_reasoning_tags(annotation_row: Dict[str, Any]) -> List[str]:
    tags: List[str] = []
    if normalize_bool(annotation_row.get("text_required")) is True:
        tags.append("needs_text")
    if normalize_bool(annotation_row.get("sequence_markers_present")) is True:
        tags.append("sequence_markers")
    if normalize_bool(annotation_row.get("report_required")) is True:
        tags.append("report_required")

    why_answer = normalize_text(annotation_row.get("why_answer"))
    if why_answer:
        tags.append("has_rationale")

    frame_captions = normalize_captions(annotation_row.get("frame_captions"))
    if sum(1 for item in frame_captions if item.strip()) >= 3:
        tags.append("dense_frame_notes")

    return tags


def compute_quality_metrics(
    *,
    task_row: Dict[str, Any],
    annotation_row: Dict[str, Any],
    captions: List[str],
    final_answer: str,
) -> Dict[str, Any]:
    consensus_answer = normalize_text(task_row.get("final_answer"), max_length=16).lower()
    consensus_match = bool(consensus_answer and final_answer == consensus_answer)
    why_answer = normalize_text(annotation_row.get("why_answer"))
    report_reason = normalize_text(annotation_row.get("report_reason"))
    option_a_summary = normalize_text(annotation_row.get("option_a_summary"))
    option_b_summary = normalize_text(annotation_row.get("option_b_summary"))
    text_required = normalize_bool(annotation_row.get("text_required"))
    sequence_markers_present = normalize_bool(
        annotation_row.get("sequence_markers_present")
    )
    report_required = normalize_bool(annotation_row.get("report_required"))

    caption_coverage = sum(1 for item in captions if item.strip())
    summary_coverage = sum(
        1 for item in [option_a_summary, option_b_summary] if item.strip()
    )
    rationale_length = len(why_answer)

    quality_score = 0.0
    if consensus_match:
        quality_score += 3.0
    else:
        quality_score -= 2.0
    if rationale_length >= 24:
        quality_score += 2.0
    elif rationale_length > 0:
        quality_score += 1.0
    if caption_coverage >= 4:
        quality_score += 2.0
    elif caption_coverage >= 2:
        quality_score += 1.0
    if summary_coverage == 2:
        quality_score += 1.0
    if text_required is not None:
        quality_score += 0.5
    if sequence_markers_present is not None:
        quality_score += 0.5
    if report_required is not None:
        quality_score += 0.5
    if report_required is True and report_reason:
        quality_score += 1.0

    if not consensus_match:
        quality_tier = "reject"
    elif quality_score >= 7.0:
        quality_tier = "gold"
    elif quality_score >= 4.0:
        quality_tier = "silver"
    else:
        quality_tier = "bronze"

    return {
        "consensus_match": consensus_match,
        "caption_coverage": caption_coverage,
        "summary_coverage": summary_coverage,
        "rationale_length": rationale_length,
        "quality_score": round(quality_score, 3),
        "quality_tier": quality_tier,
        "training_useful": quality_tier != "reject",
        "reasoning_tags": build_reasoning_tags(annotation_row),
    }


def normalize_annotation(task_row: Dict[str, Any], annotation_row: Dict[str, Any]) -> Dict[str, Any]:
    captions = normalize_captions(annotation_row.get("frame_captions"))
    if len(captions) != 4:
        raise ValueError("frame_captions must contain 4 entries")

    final_answer = validate_final_answer(annotation_row.get("final_answer"))
    quality = compute_quality_metrics(
        task_row=task_row,
        annotation_row=annotation_row,
        captions=captions,
        final_answer=final_answer,
    )

    return {
        "task_id": task_row["task_id"],
        "sample_id": task_row.get("sample_id") or task_row.get("task_id"),
        "flip_hash": task_row.get("flip_hash"),
        "epoch": task_row.get("epoch"),
        "annotator": normalize_text(annotation_row.get("annotator"), max_length=256) or None,
        "frame_captions": captions,
        "option_a_summary": normalize_text(annotation_row.get("option_a_summary")),
        "option_b_summary": normalize_text(annotation_row.get("option_b_summary")),
        "text_required": normalize_bool(annotation_row.get("text_required")),
        "sequence_markers_present": normalize_bool(
            annotation_row.get("sequence_markers_present")
        ),
        "report_required": normalize_bool(annotation_row.get("report_required")),
        "report_reason": normalize_text(annotation_row.get("report_reason")),
        "final_answer": final_answer,
        "why_answer": normalize_text(annotation_row.get("why_answer")),
        "confidence": normalize_confidence(annotation_row.get("confidence")),
        "consensus_answer": task_row.get("final_answer"),
        "consensus_strength": task_row.get("consensus_strength"),
        "training_weight": task_row.get("training_weight"),
        "ranking_source": task_row.get("ranking_source"),
        "left_order": list(task_row.get("left_order") or []),
        "right_order": list(task_row.get("right_order") or []),
        "words": task_row.get("words") or {},
        "selected_order": task_row.get("selected_order"),
        "consensus_match": quality["consensus_match"],
        "caption_coverage": quality["caption_coverage"],
        "summary_coverage": quality["summary_coverage"],
        "rationale_length": quality["rationale_length"],
        "annotation_quality_score": quality["quality_score"],
        "annotation_quality_tier": quality["quality_tier"],
        "training_useful": quality["training_useful"],
        "reasoning_tags": quality["reasoning_tags"],
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Normalize human-teacher annotation JSONL against an exported task manifest"
    )
    parser.add_argument("--task-manifest", required=True, help="tasks.jsonl from export_human_teacher_tasks.js")
    parser.add_argument("--annotations-jsonl", required=True, help="Filled human annotation JSONL")
    parser.add_argument("--output-jsonl", required=True, help="Normalized output JSONL path")
    parser.add_argument("--summary-path", help="Optional JSON summary path")
    args = parser.parse_args()

    task_manifest_path = Path(args.task_manifest).resolve()
    annotations_path = Path(args.annotations_jsonl).resolve()
    output_path = Path(args.output_jsonl).resolve()
    summary_path = Path(args.summary_path).resolve() if args.summary_path else None

    task_rows = load_jsonl(task_manifest_path)
    annotation_rows = load_jsonl(annotations_path)
    task_by_id = {str(row.get("task_id") or ""): row for row in task_rows}

    normalized_rows: List[Dict[str, Any]] = []
    unmatched_annotations = 0
    invalid_annotations = 0
    seen_task_ids = set()

    for annotation_row in annotation_rows:
        task_id = str(annotation_row.get("task_id") or "").strip()
        if not task_id or task_id not in task_by_id:
            unmatched_annotations += 1
            continue

        try:
            normalized = normalize_annotation(task_by_id[task_id], annotation_row)
        except ValueError:
            invalid_annotations += 1
            continue

        normalized_rows.append(normalized)
        seen_task_ids.add(task_id)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as handle:
        for row in normalized_rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")

    summary = {
        "task_manifest": str(task_manifest_path),
        "annotations_jsonl": str(annotations_path),
        "output_jsonl": str(output_path),
        "task_rows": len(task_rows),
        "annotation_rows": len(annotation_rows),
        "normalized_rows": len(normalized_rows),
        "missing_annotations": max(len(task_rows) - len(seen_task_ids), 0),
        "unmatched_annotations": unmatched_annotations,
        "invalid_annotations": invalid_annotations,
        "qualityTierCounts": {
            tier: sum(
                1
                for row in normalized_rows
                if str(row.get("annotation_quality_tier") or "") == tier
            )
            for tier in QUALITY_TIERS
        },
    }

    if summary_path:
        summary_path.parent.mkdir(parents=True, exist_ok=True)
        summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
