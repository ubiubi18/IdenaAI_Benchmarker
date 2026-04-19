#!/usr/bin/env python3
"""
Prepare developer human-teacher annotations as a local MLX-VLM training dataset.

This bridges the app's bundled flip demo/developer samples into the same
`save_to_disk()` dataset format used by the existing MLX training scripts.
"""

from __future__ import annotations

import argparse
import base64
import copy
import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

try:
    from datasets import Dataset
except ModuleNotFoundError:
    raise SystemExit(
        "Missing dependency: datasets\n"
        "Install it in the training environment before using this script."
    )

from prepare_flip_challenge_mlx_vlm import (
    PROMPT_FAMILIES,
    build_flip_composite,
    build_training_images,
    build_training_messages,
    choose_first_presented_candidate,
    choose_option_a_mapping,
    normalize_image_mode,
    resolve_prompt_template,
)

DATA_URL_RE = re.compile(r"^data:(image/[a-zA-Z0-9.+-]+);base64,(.+)$", re.DOTALL)
TASK_ID_RE = re.compile(r"^demo:(?P<sample>[^:]+):(?P<index>\d+)$")
VALID_ANSWERS = {"left", "right", "skip"}
PROMPT_FAMILY_CHOICES = sorted(PROMPT_FAMILIES.keys()) + ["auto"]
HUMAN_TEACHER_SYSTEM_PROMPT = (
    "Use human-teacher guidance without collapsing into a left-only or right-only bias. "
    "Candidate order, first-vs-second position, and display slot are not evidence. "
    "Compare candidate identity and the actual visual chronology instead of where a candidate appears. "
    "Prefer left or right only when the visible sequence, readable text, reportability cues, "
    "or explicit human annotation meaningfully support that side. "
    "If the evidence is weak or conflicting, stay cautious and abstain instead of defaulting to the first shown candidate."
)


def trim_text(value: Any, max_length: int = 2000) -> str:
    return str(value or "").strip()[:max_length]


def normalize_bool(value: Any) -> Optional[bool]:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return value
    raw = str(value).strip().lower()
    if raw in {"true", "1", "yes"}:
        return True
    if raw in {"false", "0", "no"}:
        return False
    return None


def normalize_confidence(value: Any) -> Optional[int]:
    if value is None or value == "":
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if not (parsed >= 0):
        return None
    if parsed <= 1:
        return max(1, min(5, round(parsed * 4 + 1)))
    if parsed > 5:
        return None
    return int(round(parsed))


def safe_slug(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]+", "-", trim_text(value, 256)).strip("-")


def decode_image_data_url(data_url: str) -> Tuple[bytes, str]:
    match = DATA_URL_RE.match(trim_text(data_url, 10_000_000))
    if not match:
        raise ValueError("Invalid image data URL")
    mime_type, encoded = match.groups()
    extension = {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/webp": ".webp",
        "image/gif": ".gif",
    }.get(mime_type, ".bin")
    return base64.b64decode(encoded), extension


def read_jsonl(path: Path) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    if not path.exists():
        return rows
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            raw = line.strip()
            if not raw:
                continue
            rows.append(json.loads(raw))
    return rows


def parse_task_reference(task_id: str) -> Tuple[Optional[str], Optional[int]]:
    match = TASK_ID_RE.match(trim_text(task_id, 256))
    if not match:
        return None, None
    sample_name = match.group("sample")
    try:
        index = int(match.group("index"))
    except ValueError:
        return sample_name, None
    return sample_name, index


def load_sample(sample_json_path: Path) -> Dict[str, Any]:
    payload = json.loads(sample_json_path.read_text(encoding="utf-8"))
    flips = payload.get("flips") or []
    if not isinstance(flips, list) or not flips:
        raise ValueError("Sample JSON does not contain any flips")
    return payload


def build_flip_index(sample_payload: Dict[str, Any], sample_name: str) -> Dict[str, Dict[str, Any]]:
    flips = sample_payload.get("flips") or []
    by_task_id: Dict[str, Dict[str, Any]] = {}
    by_hash: Dict[str, Dict[str, Any]] = {}
    for zero_index, flip in enumerate(flips):
        absolute_index = zero_index + 1
        task_id = f"demo:{sample_name}:{absolute_index}"
        record = {
            "task_id": task_id,
            "flip_hash": trim_text(flip.get("hash"), 512) or task_id,
            "images": list(flip.get("images") or []),
            "orders": list(flip.get("orders") or []),
            "expected_answer": trim_text(flip.get("expectedAnswer"), 16).lower() or None,
            "expected_strength": trim_text(flip.get("expectedStrength"), 64) or None,
        }
        by_task_id[task_id] = record
        by_hash[record["flip_hash"]] = record
    return {"byTaskId": by_task_id, "byHash": by_hash}


def resolve_flip_record(
    annotation_row: Dict[str, Any],
    sample_name: str,
    flip_index: Dict[str, Dict[str, Dict[str, Any]]],
) -> Optional[Dict[str, Any]]:
    task_id = trim_text(annotation_row.get("task_id"), 256)
    task_sample_name, _ = parse_task_reference(task_id)
    if task_sample_name and task_sample_name != sample_name:
        return None
    if task_id and task_id in flip_index["byTaskId"]:
        return flip_index["byTaskId"][task_id]
    flip_hash = trim_text(annotation_row.get("flip_hash"), 512)
    if flip_hash and flip_hash in flip_index["byHash"]:
        return flip_index["byHash"][flip_hash]
    return None


def normalize_panel_references(value: Any) -> List[Dict[str, Any]]:
    references = value if isinstance(value, list) else []
    by_code: Dict[str, Dict[str, Any]] = {}
    for index, raw in enumerate(references[:3]):
        if not isinstance(raw, dict):
            continue
        code = trim_text(raw.get("code") or ["A", "B", "C"][index], 4).upper()
        if code not in {"A", "B", "C"}:
            continue
        panel_index = raw.get("panel_index", raw.get("panelIndex"))
        try:
            panel_index = int(panel_index)
        except (TypeError, ValueError):
            panel_index = None
        if panel_index is not None and not (0 <= panel_index <= 3):
            panel_index = None
        by_code[code] = {
            "code": code,
            "description": trim_text(raw.get("description"), 160),
            "panel_index": panel_index,
        }
    normalized = []
    for code in ("A", "B", "C"):
        normalized.append(by_code.get(code, {"code": code, "description": "", "panel_index": None}))
    return normalized


def summarize_panel_references(references: List[Dict[str, Any]]) -> str:
    labels = []
    for reference in references:
        code = reference.get("code")
        description = trim_text(reference.get("description"), 160)
        panel_index = reference.get("panel_index")
        if not description and panel_index is None:
            continue
        parts = [str(code or "").upper()]
        if description:
            parts.append(f"= {description}")
        if panel_index is not None:
            parts.append(f"(panel {int(panel_index) + 1})")
        labels.append(" ".join(parts).strip())
    return "; ".join(labels)


def normalize_ai_annotation(value: Any) -> Dict[str, Any]:
    raw = value if isinstance(value, dict) else {}
    final_answer = trim_text(raw.get("final_answer") or raw.get("finalAnswer"), 16).lower()
    rating = trim_text(raw.get("rating"), 32).lower()
    def normalize_list(input_value: Any, max_items: int, max_length: int) -> List[str]:
        items: List[Any] = []
        if isinstance(input_value, list):
            items = input_value
        elif isinstance(input_value, dict):
            items = [
                item
                for _, item in sorted(
                    input_value.items(),
                    key=lambda item: (
                        not str(item[0]).isdigit(),
                        int(item[0]) if str(item[0]).isdigit() else str(item[0]),
                    ),
                )
            ]

        next_items = [trim_text(item, max_length) for item in items[:max_items]]
        while len(next_items) < max_items:
            next_items.append("")
        return next_items

    return {
        "generated_at": trim_text(raw.get("generated_at") or raw.get("generatedAt"), 64),
        "runtime_backend": trim_text(raw.get("runtime_backend") or raw.get("runtimeBackend"), 64),
        "runtime_type": trim_text(raw.get("runtime_type") or raw.get("runtimeType"), 64),
        "model": trim_text(raw.get("model"), 256),
        "vision_model": trim_text(raw.get("vision_model") or raw.get("visionModel"), 256),
        "ordered_panel_descriptions": normalize_list(
            raw.get("ordered_panel_descriptions") or raw.get("orderedPanelDescriptions"),
            8,
            280,
        ),
        "ordered_panel_text": normalize_list(
            raw.get("ordered_panel_text") or raw.get("orderedPanelText"),
            8,
            200,
        ),
        "option_a_story_analysis": trim_text(
            raw.get("option_a_story_analysis") or raw.get("optionAStoryAnalysis"),
            500,
        ),
        "option_b_story_analysis": trim_text(
            raw.get("option_b_story_analysis") or raw.get("optionBStoryAnalysis"),
            500,
        ),
        "final_answer": final_answer if final_answer in VALID_ANSWERS else "",
        "why_answer": trim_text(raw.get("why_answer") or raw.get("whyAnswer"), 900),
        "confidence": normalize_confidence(raw.get("confidence")),
        "text_required": normalize_bool(raw.get("text_required") if "text_required" in raw else raw.get("textRequired")),
        "sequence_markers_present": normalize_bool(
            raw.get("sequence_markers_present")
            if "sequence_markers_present" in raw
            else raw.get("sequenceMarkersPresent")
        ),
        "report_required": normalize_bool(
            raw.get("report_required") if "report_required" in raw else raw.get("reportRequired")
        ),
        "report_reason": trim_text(raw.get("report_reason") or raw.get("reportReason"), 400),
        "option_a_summary": trim_text(raw.get("option_a_summary") or raw.get("optionASummary"), 400),
        "option_b_summary": trim_text(raw.get("option_b_summary") or raw.get("optionBSummary"), 400),
        "rating": rating if rating in {"good", "bad", "wrong"} else "",
    }


def normalize_benchmark_review(annotation: Dict[str, Any]) -> Dict[str, Any]:
    raw = (
        annotation.get("benchmark_review")
        if isinstance(annotation.get("benchmark_review"), dict)
        else annotation.get("benchmarkReview")
        if isinstance(annotation.get("benchmarkReview"), dict)
        else {}
    )
    correction = raw.get("correction") if isinstance(raw.get("correction"), dict) else {}
    context = raw.get("context") if isinstance(raw.get("context"), dict) else {}

    return {
        "context": {
            "expected_answer": trim_text(
                context.get("expected_answer") or context.get("expectedAnswer"), 16
            ).lower(),
            "ai_prediction": trim_text(
                context.get("ai_prediction") or context.get("aiPrediction"), 16
            ).lower(),
            "baseline_prediction": trim_text(
                context.get("baseline_prediction") or context.get("baselinePrediction"), 16
            ).lower(),
            "change_type": trim_text(
                context.get("change_type") or context.get("changeType"), 64
            )
            .lower()
            .replace(" ", "_"),
            "benchmark_flips": context.get("benchmark_flips")
            if context.get("benchmark_flips") is not None
            else context.get("benchmarkFlips"),
        },
        "correction": {
            "issue_type": trim_text(
                correction.get("issue_type")
                or correction.get("issueType")
                or annotation.get("benchmark_review_issue_type")
                or annotation.get("benchmarkReviewIssueType"),
                64,
            )
            .lower()
            .replace(" ", "_"),
            "failure_note": trim_text(
                correction.get("failure_note")
                or correction.get("failureNote")
                or annotation.get("benchmark_review_failure_note")
                or annotation.get("benchmarkReviewFailureNote"),
                900,
            ),
            "retraining_hint": trim_text(
                correction.get("retraining_hint")
                or correction.get("retrainingHint")
                or annotation.get("benchmark_review_retraining_hint")
                or annotation.get("benchmarkReviewRetrainingHint"),
                900,
            ),
            "include_for_training": normalize_bool(
                correction.get("include_for_training")
                if "include_for_training" in correction
                else correction.get("includeForTraining")
                if "includeForTraining" in correction
                else annotation.get("benchmark_review_include_for_training")
                if "benchmark_review_include_for_training" in annotation
                else annotation.get("benchmarkReviewIncludeForTraining")
            ),
        },
    }


def build_human_reasoning_summary(annotation: Dict[str, Any]) -> str:
    final_answer = trim_text(annotation.get("final_answer"), 16).lower()
    why_answer = trim_text(annotation.get("why_answer"), 900)
    confidence = normalize_confidence(annotation.get("confidence"))
    text_required = normalize_bool(annotation.get("text_required"))
    sequence_markers = normalize_bool(annotation.get("sequence_markers_present"))
    report_required = normalize_bool(annotation.get("report_required"))
    report_reason = trim_text(annotation.get("report_reason"), 400)
    ai_annotation = normalize_ai_annotation(annotation.get("ai_annotation") or annotation.get("aiAnnotation"))
    benchmark_review = normalize_benchmark_review(annotation)
    ai_annotation_feedback = trim_text(
        annotation.get("ai_annotation_feedback") or annotation.get("aiAnnotationFeedback"),
        600,
    )
    references = summarize_panel_references(
        normalize_panel_references(annotation.get("panel_references"))
    )

    parts = []
    if final_answer in VALID_ANSWERS:
        parts.append(f"The human teacher chose {final_answer.upper()}.")
    if why_answer:
        parts.append(f"Why: {why_answer}")
    if confidence is not None:
        parts.append(f"Confidence: {confidence}/5.")
    if text_required is True:
        parts.append("Readable text was required.")
    if sequence_markers is True:
        parts.append("Visible sequence markers were present.")
    if report_required is True:
        if report_reason:
            parts.append(f"Report note: {report_reason}")
        else:
            parts.append("The flip should be reported instead of solved normally.")
    if ai_annotation.get("final_answer") in VALID_ANSWERS:
        parts.append(f"AI draft before human correction chose {ai_annotation['final_answer'].upper()}.")
    panel_descriptions = [
        item for item in ai_annotation.get("ordered_panel_descriptions", []) if item
    ]
    if panel_descriptions:
        parts.append(
            "AI draft panel observations: "
            + " ".join(
                f"P{index + 1}: {item}."
                for index, item in enumerate(ai_annotation["ordered_panel_descriptions"])
                if item
            )[:700]
        )
    panel_text = [item for item in ai_annotation.get("ordered_panel_text", []) if item]
    if panel_text:
        parts.append(
            "AI draft text clues: "
            + " ".join(
                f"P{index + 1}: {item}."
                for index, item in enumerate(ai_annotation["ordered_panel_text"])
                if item
            )[:500]
        )
    if ai_annotation.get("option_a_story_analysis"):
        parts.append(f"AI draft LEFT analysis: {ai_annotation['option_a_story_analysis']}")
    if ai_annotation.get("option_b_story_analysis"):
        parts.append(f"AI draft RIGHT analysis: {ai_annotation['option_b_story_analysis']}")
    if ai_annotation.get("why_answer"):
        parts.append(f"AI draft reasoning: {ai_annotation['why_answer']}")
    if ai_annotation.get("rating") == "good":
        parts.append("The human rated the AI draft as good.")
    elif ai_annotation.get("rating") == "bad":
        parts.append("The human rated the AI draft as bad.")
    elif ai_annotation.get("rating") == "wrong":
        parts.append("The human rated the AI draft as completely wrong.")
    if ai_annotation_feedback:
        parts.append(f"Human correction to the AI draft: {ai_annotation_feedback}")
    if references:
        parts.append(f"Panel references: {references}.")
    if benchmark_review["correction"]["include_for_training"] is True:
        if benchmark_review["correction"]["issue_type"]:
            parts.append(
                "Benchmark review issue: "
                + benchmark_review["correction"]["issue_type"].replace("_", " ")
                + "."
            )
        if benchmark_review["correction"]["failure_note"]:
            parts.append(
                f"Benchmark review failure note: {benchmark_review['correction']['failure_note']}"
            )
        if benchmark_review["correction"]["retraining_hint"]:
            parts.append(
                f"Benchmark review retraining hint: {benchmark_review['correction']['retraining_hint']}"
            )
    if not parts:
        parts.append("Human teacher supplied a valid answer without extra notes.")
    return " ".join(part.strip() for part in parts if part.strip())[:1200]


def build_human_followup_prompt() -> str:
    return (
        "Human teacher follow-up: learn the human reasoning for this same flip, "
        "including any reportability flags, text requirements, confidence, optional "
        "A/B/C panel references, and any explicit correction of a bad AI draft."
    )


def compute_training_weight(annotation: Dict[str, Any], consensus_answer: Optional[str]) -> float:
    confidence = normalize_confidence(annotation.get("confidence")) or 3
    final_answer = trim_text(annotation.get("final_answer"), 16).lower()
    weight = 1.0 + max(0, confidence - 1) * 0.12
    if consensus_answer and final_answer == consensus_answer:
        weight += 0.25
    return round(weight, 6)


def build_record(
    *,
    task_id: str,
    flip_record: Dict[str, Any],
    annotation: Dict[str, Any],
    task_dir: Path,
    prompt_template: str,
    prompt_family: str,
    image_mode: str,
    human_teacher_system_prompt: str,
) -> Dict[str, Any]:
    final_answer = trim_text(annotation.get("final_answer"), 16).lower()
    if final_answer not in VALID_ANSWERS:
        raise ValueError(f"Unsupported final answer for {task_id}: {final_answer}")

    image_paths: List[str] = []
    raw_panels: List[bytes] = []
    for index, image_data_url in enumerate((flip_record.get("images") or [])[:4]):
        raw_bytes, extension = decode_image_data_url(image_data_url)
        raw_panels.append(raw_bytes)
        image_path = task_dir / f"panel-{index + 1}{extension}"
        if not image_path.exists():
            image_path.write_bytes(raw_bytes)
        image_paths.append(str(image_path.resolve()))

    if len(image_paths) != 4:
        raise ValueError(f"Expected 4 panels for {task_id}, got {len(image_paths)}")

    composite_path = task_dir / "composite.png"
    if not composite_path.exists():
        build_flip_composite(raw_panels).save(composite_path, format="PNG")

    orders = list(flip_record.get("orders") or [])
    left_stack = list(orders[0] if len(orders) > 0 and isinstance(orders[0], list) else [0, 1, 2, 3])
    right_stack = list(orders[1] if len(orders) > 1 and isinstance(orders[1], list) else [0, 1, 2, 3])

    option_a_maps_to = choose_option_a_mapping(task_id)
    option_b_maps_to = "right" if option_a_maps_to == "left" else "left"
    option_a_order = left_stack if option_a_maps_to == "left" else right_stack
    option_b_order = right_stack if option_a_maps_to == "left" else left_stack
    left_frame_images = [image_paths[index] for index in left_stack if 0 <= index < len(image_paths)]
    right_frame_images = [image_paths[index] for index in right_stack if 0 <= index < len(image_paths)]
    option_a_frame_images = left_frame_images if option_a_maps_to == "left" else right_frame_images
    option_b_frame_images = right_frame_images if option_a_maps_to == "left" else left_frame_images
    first_candidate_key = choose_first_presented_candidate(task_id)
    training_images = build_training_images(
        image_mode=image_mode,
        composite_path=composite_path,
        option_a_frame_images=option_a_frame_images,
        option_b_frame_images=option_b_frame_images,
        first_candidate_key=first_candidate_key,
    )
    training_target = (
        "a"
        if final_answer == option_a_maps_to
        else "b"
        if final_answer == option_b_maps_to
        else "skip"
    )
    base_messages = build_training_messages(
        prompt_template,
        option_a_order,
        option_b_order,
        first_candidate_key,
        training_target,
        len(training_images),
    )
    evaluation_messages = [
        {
            "role": "system",
            "content": [{"type": "text", "text": human_teacher_system_prompt}],
        },
        copy.deepcopy(base_messages[0]),
    ]
    messages = [
        {
            "role": "system",
            "content": [{"type": "text", "text": human_teacher_system_prompt}],
        },
        *list(base_messages),
    ] + [
        {
            "role": "user",
            "content": [{"type": "text", "text": build_human_followup_prompt()}],
        },
        {
            "role": "assistant",
            "content": [
                {"type": "text", "text": build_human_reasoning_summary(annotation)}
            ],
        },
    ]
    panel_references = normalize_panel_references(annotation.get("panel_references"))
    confidence = normalize_confidence(annotation.get("confidence"))
    ai_annotation = normalize_ai_annotation(annotation.get("ai_annotation") or annotation.get("aiAnnotation"))
    benchmark_review = normalize_benchmark_review(annotation)
    ai_annotation_feedback = trim_text(
        annotation.get("ai_annotation_feedback") or annotation.get("aiAnnotationFeedback"),
        600,
    )
    consensus_answer = trim_text(
        annotation.get("consensus_answer") or flip_record.get("expected_answer"), 16
    ).lower() or None

    return {
        "schema_version": "idena.flip-training.v1",
        "sample_id": task_id,
        "flip_hash": flip_record.get("flip_hash") or task_id,
        "prompt_variant": "developer-human-teacher",
        "prompt_family": prompt_family,
        "images": training_images,
        "panel_images": image_paths,
        "left_frame_images": left_frame_images,
        "right_frame_images": right_frame_images,
        "training_image_mode": normalize_image_mode(image_mode),
        "messages": messages,
        "evaluation_messages": evaluation_messages,
        "training_target": training_target,
        "assistant_target": training_target,
        "expected_answer": final_answer,
        "consensus_answer": consensus_answer,
        "human_matches_consensus": bool(consensus_answer and final_answer == consensus_answer),
        "expected_strength": flip_record.get("expected_strength") or "",
        "left_order": left_stack,
        "right_order": right_stack,
        "option_a_maps_to": option_a_maps_to,
        "option_b_maps_to": option_b_maps_to,
        "option_a_order": option_a_order,
        "option_b_order": option_b_order,
        "first_candidate_key": first_candidate_key,
        "second_candidate_key": "b" if first_candidate_key == "a" else "a",
        "option_a_frame_images": option_a_frame_images,
        "option_b_frame_images": option_b_frame_images,
        "training_weight": compute_training_weight(annotation, consensus_answer),
        "ranking_source": "developer_human_teacher",
        "human_annotation_available": True,
        "human_annotation_quality_tier": (
            "gold" if confidence and confidence >= 5 else "silver" if confidence and confidence >= 4 else "bronze"
        ),
        "human_annotation_quality_score": confidence,
        "human_annotation_reasoning_tags": [
            tag
            for tag, enabled in (
                ("text_required", normalize_bool(annotation.get("text_required")) is True),
                (
                    "sequence_markers_present",
                    normalize_bool(annotation.get("sequence_markers_present")) is True,
                ),
                ("report_required", normalize_bool(annotation.get("report_required")) is True),
                (
                    "panel_references",
                    any(
                        reference.get("description") or reference.get("panel_index") is not None
                        for reference in panel_references
                    ),
                ),
            )
            if enabled
        ],
        "annotator": trim_text(annotation.get("annotator"), 256) or None,
        "why_answer": trim_text(annotation.get("why_answer"), 900),
        "confidence": confidence,
        "ai_annotation": ai_annotation,
        "ai_annotation_rating": ai_annotation.get("rating") or "",
        "ai_annotation_feedback": ai_annotation_feedback,
        "benchmark_review": benchmark_review,
        "benchmark_review_issue_type": benchmark_review["correction"]["issue_type"],
        "benchmark_review_failure_note": benchmark_review["correction"]["failure_note"],
        "benchmark_review_retraining_hint": benchmark_review["correction"]["retraining_hint"],
        "benchmark_review_include_for_training": benchmark_review["correction"]["include_for_training"],
        "text_required": normalize_bool(annotation.get("text_required")),
        "sequence_markers_present": normalize_bool(annotation.get("sequence_markers_present")),
        "report_required": normalize_bool(annotation.get("report_required")),
        "report_reason": trim_text(annotation.get("report_reason"), 400),
        "panel_references": panel_references,
    }


def write_jsonl(path: Path, rows: List[Dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False))
            handle.write("\n")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Prepare developer human-teacher annotations for MLX-VLM training"
    )
    parser.add_argument("--sample-name", required=True)
    parser.add_argument("--sample-json-path", type=Path, required=True)
    parser.add_argument("--annotations-jsonl", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument(
        "--prompt-family",
        choices=PROMPT_FAMILY_CHOICES,
        default="runtime_aligned_native_frames_v2",
    )
    parser.add_argument(
        "--prompt-template",
        type=str,
        default=PROMPT_FAMILIES["runtime_aligned_native_frames_v2"],
    )
    parser.add_argument(
        "--image-mode",
        choices=["composite", "native_frames"],
        default="native_frames",
    )
    parser.add_argument(
        "--human-teacher-system-prompt",
        type=str,
        default=HUMAN_TEACHER_SYSTEM_PROMPT,
    )
    args = parser.parse_args()

    sample_name = trim_text(args.sample_name, 256)
    if not sample_name:
        raise SystemExit("sample name is required")

    output_dir = args.output_dir.resolve()
    images_dir = output_dir / "images"
    hf_dataset_dir = output_dir / "hf-dataset"
    jsonl_path = output_dir / "train.jsonl"
    manifest_path = output_dir / "manifest.json"
    output_dir.mkdir(parents=True, exist_ok=True)

    prompt_template, prompt_family = resolve_prompt_template(
        prompt_family=args.prompt_family,
        prompt_template=args.prompt_template,
        image_mode=args.image_mode,
    )
    human_teacher_system_prompt = (
        trim_text(args.human_teacher_system_prompt, 8000)
        or HUMAN_TEACHER_SYSTEM_PROMPT
    )
    sample_payload = load_sample(args.sample_json_path.resolve())
    flip_index = build_flip_index(sample_payload, sample_name)
    annotation_rows = read_jsonl(args.annotations_jsonl.resolve())

    records: List[Dict[str, Any]] = []
    unmatched = 0
    invalid = 0
    counts_by_answer: Dict[str, int] = {}

    for annotation_row in annotation_rows:
        flip_record = resolve_flip_record(annotation_row, sample_name, flip_index)
        if not flip_record:
            unmatched += 1
            continue
        task_id = flip_record["task_id"]
        task_dir = images_dir / safe_slug(task_id)
        task_dir.mkdir(parents=True, exist_ok=True)
        try:
            record = build_record(
                task_id=task_id,
                flip_record=flip_record,
                annotation=annotation_row,
                task_dir=task_dir,
                prompt_template=prompt_template,
                prompt_family=prompt_family,
                image_mode=args.image_mode,
                human_teacher_system_prompt=human_teacher_system_prompt,
            )
        except Exception:
            invalid += 1
            continue
        records.append(record)
        answer = record["expected_answer"]
        counts_by_answer[answer] = counts_by_answer.get(answer, 0) + 1

    if not records:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": "no_training_records",
                    "sampleName": sample_name,
                    "unmatchedAnnotations": unmatched,
                    "invalidAnnotations": invalid,
                },
                indent=2,
            )
        )
        return 1

    dataset = Dataset.from_list(records)
    dataset.save_to_disk(str(hf_dataset_dir))
    write_jsonl(jsonl_path, records)

    manifest = {
        "schemaVersion": "idena.flip-training.v1",
        "source": "developer-human-teacher",
        "sampleName": sample_name,
        "sampleJsonPath": str(args.sample_json_path.resolve()),
        "annotationsJsonl": str(args.annotations_jsonl.resolve()),
        "count": len(records),
        "unmatchedAnnotations": unmatched,
        "invalidAnnotations": invalid,
        "promptFamily": prompt_family,
        "imageMode": normalize_image_mode(args.image_mode),
        "humanTeacherSystemPrompt": human_teacher_system_prompt,
        "countsByAnswer": counts_by_answer,
        "hfDatasetPath": str(hf_dataset_dir),
        "jsonlPath": str(jsonl_path),
        "imagesPath": str(images_dir),
    }
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps({"ok": True, **manifest}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
