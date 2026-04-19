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


def normalize_benchmark_review_issue_type(value: Any) -> str:
    raw = normalize_text(value, max_length=64).lower().replace(" ", "_")
    if raw in {
        "wrong_answer",
        "missed_text",
        "sequence_confusion",
        "reportability_miss",
        "weak_reasoning",
        "panel_read_failure",
        "ambiguous_flip",
        "other",
    }:
        return raw
    return ""


def normalize_captions(value: Any) -> List[str]:
    captions = (
        [normalize_text(item, max_length=400) for item in value[:4]]
        if isinstance(value, list)
        else []
    )
    while len(captions) < 4:
        captions.append("")
    return captions


def count_filled_entries(value: List[str]) -> int:
    return sum(1 for item in value if normalize_text(item))


def normalize_optional_epoch(value: Any) -> Optional[int]:
    if value is None or value == "":
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed


def validate_final_answer(value: Any) -> str:
    raw = normalize_text(value, max_length=16).lower()
    if raw not in VALID_FINAL_ANSWERS:
        raise ValueError(f"Invalid final_answer: {raw or 'empty'}")
    return raw


def validate_task_binding(task_row: Dict[str, Any], annotation_row: Dict[str, Any]) -> None:
    task_id = normalize_text(task_row.get("task_id"), max_length=256)
    sample_id = normalize_text(
        task_row.get("sample_id") or task_row.get("task_id"), max_length=256
    )
    flip_hash = normalize_text(task_row.get("flip_hash"), max_length=512)
    consensus_answer = normalize_text(task_row.get("final_answer"), max_length=16).lower()
    expected_epoch = normalize_optional_epoch(task_row.get("epoch"))

    if normalize_text(annotation_row.get("task_id"), max_length=256) != task_id:
        raise ValueError("Annotation task_id does not match manifest task_id")

    annotation_sample_id = normalize_text(annotation_row.get("sample_id"), max_length=256)
    if annotation_sample_id and annotation_sample_id != sample_id:
        raise ValueError("Annotation sample_id does not match manifest sample_id")

    annotation_flip_hash = normalize_text(annotation_row.get("flip_hash"), max_length=512)
    if annotation_flip_hash and annotation_flip_hash != flip_hash:
        raise ValueError("Annotation flip_hash does not match manifest flip_hash")

    annotation_consensus_answer = normalize_text(
        annotation_row.get("consensus_answer"), max_length=16
    ).lower()
    if (
        annotation_consensus_answer
        and consensus_answer
        and annotation_consensus_answer != consensus_answer
    ):
        raise ValueError(
            "Annotation consensus_answer does not match manifest consensus answer"
        )

    annotation_epoch = normalize_optional_epoch(annotation_row.get("epoch"))
    if (
        annotation_epoch is not None
        and expected_epoch is not None
        and annotation_epoch != expected_epoch
    ):
        raise ValueError("Annotation epoch does not match manifest epoch")


def assert_complete_annotation(
    *,
    text_required: Optional[bool],
    sequence_markers_present: Optional[bool],
    report_required: Optional[bool],
    report_reason: str,
    why_answer: str,
    confidence: Optional[float],
) -> None:
    if text_required is None:
        raise ValueError("text_required is required")
    if sequence_markers_present is None:
        raise ValueError("sequence_markers_present is required")
    if report_required is None:
        raise ValueError("report_required is required")
    if report_required is True and not report_reason:
        raise ValueError("report_reason is required when report_required is true")
    if not why_answer:
        raise ValueError("why_answer is required")
    if confidence is None:
        raise ValueError("confidence is required")


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
    validate_task_binding(task_row, annotation_row)
    captions = normalize_captions(annotation_row.get("frame_captions"))
    option_a_summary = normalize_text(annotation_row.get("option_a_summary"))
    option_b_summary = normalize_text(annotation_row.get("option_b_summary"))
    text_required = normalize_bool(annotation_row.get("text_required"))
    sequence_markers_present = normalize_bool(
        annotation_row.get("sequence_markers_present")
    )
    report_required = normalize_bool(annotation_row.get("report_required"))
    report_reason = normalize_text(annotation_row.get("report_reason"))
    final_answer = validate_final_answer(annotation_row.get("final_answer"))
    why_answer = normalize_text(annotation_row.get("why_answer"))
    confidence = normalize_confidence(annotation_row.get("confidence"))
    benchmark_review_source = (
        annotation_row.get("benchmark_review")
        if isinstance(annotation_row.get("benchmark_review"), dict)
        else annotation_row.get("benchmarkReview")
        if isinstance(annotation_row.get("benchmarkReview"), dict)
        else {}
    )
    benchmark_review_correction = (
        benchmark_review_source.get("correction")
        if isinstance(benchmark_review_source.get("correction"), dict)
        else {}
    )
    benchmark_review_issue_type_value = (
        benchmark_review_correction["issue_type"]
        if "issue_type" in benchmark_review_correction
        else benchmark_review_correction.get("issueType")
        if "issueType" in benchmark_review_correction
        else annotation_row["benchmark_review_issue_type"]
        if "benchmark_review_issue_type" in annotation_row
        else annotation_row.get("benchmarkReviewIssueType")
    )
    benchmark_review_issue_type = normalize_benchmark_review_issue_type(
        benchmark_review_issue_type_value
    )
    benchmark_review_failure_note_value = (
        benchmark_review_correction["failure_note"]
        if "failure_note" in benchmark_review_correction
        else benchmark_review_correction.get("failureNote")
        if "failureNote" in benchmark_review_correction
        else annotation_row["benchmark_review_failure_note"]
        if "benchmark_review_failure_note" in annotation_row
        else annotation_row.get("benchmarkReviewFailureNote")
    )
    benchmark_review_failure_note = normalize_text(
        benchmark_review_failure_note_value,
        max_length=900,
    )
    benchmark_review_retraining_hint_value = (
        benchmark_review_correction["retraining_hint"]
        if "retraining_hint" in benchmark_review_correction
        else benchmark_review_correction.get("retrainingHint")
        if "retrainingHint" in benchmark_review_correction
        else annotation_row["benchmark_review_retraining_hint"]
        if "benchmark_review_retraining_hint" in annotation_row
        else annotation_row.get("benchmarkReviewRetrainingHint")
    )
    benchmark_review_retraining_hint = normalize_text(
        benchmark_review_retraining_hint_value,
        max_length=900,
    )
    benchmark_review_include_for_training_value = (
        benchmark_review_correction["include_for_training"]
        if "include_for_training" in benchmark_review_correction
        else benchmark_review_correction.get("includeForTraining")
        if "includeForTraining" in benchmark_review_correction
        else annotation_row["benchmark_review_include_for_training"]
        if "benchmark_review_include_for_training" in annotation_row
        else annotation_row.get("benchmarkReviewIncludeForTraining")
    )
    benchmark_review_include_for_training = normalize_bool(
        benchmark_review_include_for_training_value
    )
    benchmark_review_context = (
        benchmark_review_source.get("context")
        if isinstance(benchmark_review_source.get("context"), dict)
        else {}
    )
    assert_complete_annotation(
        text_required=text_required,
        sequence_markers_present=sequence_markers_present,
        report_required=report_required,
        report_reason=report_reason,
        why_answer=why_answer,
        confidence=confidence,
    )
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
        "option_a_summary": option_a_summary,
        "option_b_summary": option_b_summary,
        "text_required": text_required,
        "sequence_markers_present": sequence_markers_present,
        "report_required": report_required,
        "report_reason": report_reason,
        "final_answer": final_answer,
        "why_answer": why_answer,
        "confidence": confidence,
        "benchmark_review": {
            "context": {
                "expected_answer": normalize_text(
                    benchmark_review_context.get("expected_answer")
                    or benchmark_review_context.get("expectedAnswer"),
                    max_length=16,
                ).lower(),
                "ai_prediction": normalize_text(
                    benchmark_review_context.get("ai_prediction")
                    or benchmark_review_context.get("aiPrediction"),
                    max_length=16,
                ).lower(),
                "baseline_prediction": normalize_text(
                    benchmark_review_context.get("baseline_prediction")
                    or benchmark_review_context.get("baselinePrediction"),
                    max_length=16,
                ).lower(),
                "previous_prediction": normalize_text(
                    benchmark_review_context.get("previous_prediction")
                    or benchmark_review_context.get("previousPrediction"),
                    max_length=16,
                ).lower(),
                "benchmark_flips": benchmark_review_context.get("benchmark_flips")
                if benchmark_review_context.get("benchmark_flips") is not None
                else benchmark_review_context.get("benchmarkFlips"),
                "evaluated_at": normalize_text(
                    benchmark_review_context.get("evaluated_at")
                    or benchmark_review_context.get("evaluatedAt"),
                    max_length=64,
                ),
                "change_type": normalize_text(
                    benchmark_review_context.get("change_type")
                    or benchmark_review_context.get("changeType"),
                    max_length=64,
                )
                .lower()
                .replace(" ", "_"),
                "ai_correct": normalize_bool(
                    benchmark_review_context.get("ai_correct")
                    if "ai_correct" in benchmark_review_context
                    else benchmark_review_context.get("aiCorrect")
                ),
            },
            "correction": {
                "issue_type": benchmark_review_issue_type,
                "failure_note": benchmark_review_failure_note,
                "retraining_hint": benchmark_review_retraining_hint,
                "include_for_training": benchmark_review_include_for_training,
            },
        },
        "benchmark_review_issue_type": benchmark_review_issue_type,
        "benchmark_review_failure_note": benchmark_review_failure_note,
        "benchmark_review_retraining_hint": benchmark_review_retraining_hint,
        "benchmark_review_include_for_training": benchmark_review_include_for_training,
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
    duplicate_annotations = 0
    seen_task_ids = set()
    task_counts: Dict[str, int] = {}
    for row in annotation_rows:
        task_id = str(row.get("task_id") or "").strip()
        if task_id and task_id in task_by_id:
            task_counts[task_id] = task_counts.get(task_id, 0) + 1
    duplicate_task_ids = {
        task_id for task_id, count in task_counts.items() if count > 1
    }

    for annotation_row in annotation_rows:
        task_id = str(annotation_row.get("task_id") or "").strip()
        if not task_id or task_id not in task_by_id:
            unmatched_annotations += 1
            continue

        if task_id in duplicate_task_ids:
            duplicate_annotations += 1
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
        "duplicate_annotations": duplicate_annotations,
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
