#!/usr/bin/env python3
"""
Import hosted teacher responses for an exported FLIP request pack.

This bridges the provider-agnostic export pack back into the local FLIP
distillation flow:
- reads the original request manifest
- reads raw response rows keyed by request_id
- parses candidate analysis JSON
- compares candidate A vs candidate B per flip
- writes an evaluation-style summary JSON
- writes per-candidate distillation JSONL
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any, Dict, Iterable, List

from run_local_flip_ollama_smoke import CANDIDATE_ANALYSIS_SCHEMA


def load_jsonl(path: Path) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            text = line.strip()
            if not text:
                continue
            payload = json.loads(text)
            if isinstance(payload, dict):
                rows.append(payload)
    return rows


def response_identifier(row: Dict[str, Any]) -> str:
    return str(row.get("request_id") or row.get("id") or "")


def parse_structured_payload(value: Any) -> Dict[str, Any] | None:
    if isinstance(value, dict):
        return value

    text = str(value or "").strip()
    if not text:
        return None

    candidates = [text]
    if "```" in text:
        candidates.extend(
            segment.strip() for segment in text.split("```") if segment.strip().startswith("{")
        )

    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        candidates.append(text[start : end + 1])

    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            return parsed
    return None


def extract_candidate_analysis(row: Dict[str, Any]) -> Dict[str, Any] | None:
    for key in (
        "analysis",
        "response_json",
        "parsed_response",
        "parsed",
        "output_json",
        "response",
        "content",
        "text",
        "output_text",
    ):
        if key not in row:
            continue
        parsed = parse_structured_payload(row.get(key))
        if isinstance(parsed, dict):
            return parsed
    return None


def fallback_candidate_analysis(raw_text: str) -> Dict[str, Any]:
    return {
        "frames": [
            {"caption": "", "text": "", "translation": ""},
            {"caption": "", "text": "", "translation": ""},
            {"caption": "", "text": "", "translation": ""},
            {"caption": "", "text": "", "translation": ""},
        ],
        "story": "",
        "chronologyScore": 0,
        "entityConsistencyScore": 0,
        "causalScore": 0,
        "textRequired": False,
        "sequenceMarkersPresent": False,
        "inappropriateContent": False,
        "reportReason": "parse_error",
        "_rawResponse": raw_text,
    }


def compute_candidate_score(analysis: Dict[str, Any]) -> int:
    if any(
        bool(analysis.get(field))
        for field in ("textRequired", "sequenceMarkersPresent", "inappropriateContent")
    ):
        return -1
    return (
        int(analysis.get("chronologyScore") or 0)
        + int(analysis.get("entityConsistencyScore") or 0)
        + int(analysis.get("causalScore") or 0)
    )


def compare_candidates(manifest_a: Dict[str, Any], analysis_a: Dict[str, Any], analysis_b: Dict[str, Any]) -> str:
    score_a = compute_candidate_score(analysis_a)
    score_b = compute_candidate_score(analysis_b)

    if score_a < 0 and score_b < 0:
        return "skip"
    if score_a == score_b:
        return "skip"
    if score_a > score_b:
        return str(manifest_a.get("candidate_maps_to") or "skip")
    return str(manifest_a.get("other_candidate_maps_to") or "skip")


def infer_selected_candidate(manifest_a: Dict[str, Any], predicted: str) -> str | None:
    if predicted == str(manifest_a.get("candidate_maps_to") or ""):
        return "a"
    if predicted == str(manifest_a.get("other_candidate_maps_to") or ""):
        return "b"
    return None


def teacher_label_for_candidate(predicted: str, candidate_maps_to: str) -> str:
    if predicted == "skip":
        return "skip"
    return "winner" if predicted == candidate_maps_to else "loser"


def build_manifest_lookup(rows: Iterable[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    by_request_id: Dict[str, Dict[str, Any]] = {}
    by_sample: Dict[str, Dict[str, Dict[str, Any]]] = {}

    for row in rows:
        item = dict(row)
        request_id = str(item.get("request_id") or "")
        sample_id = str(item.get("sample_id") or item.get("flip_hash") or "")
        flip_hash = str(item.get("flip_hash") or "")
        candidate_key = str(item.get("candidate_key") or "").lower()
        if not request_id or candidate_key not in {"a", "b"}:
            continue
        by_request_id[request_id] = item
        by_sample.setdefault(sample_id, {})[candidate_key] = item

    for sample_id, pair in by_sample.items():
        if "a" not in pair or "b" not in pair:
            continue
        pair["a"]["other_candidate_maps_to"] = pair["b"].get("candidate_maps_to")
        pair["b"]["other_candidate_maps_to"] = pair["a"].get("candidate_maps_to")
        pair["a"]["expected_answer"] = pair["a"].get("expected_answer") or pair["b"].get("expected_answer")
        pair["b"]["expected_answer"] = pair["b"].get("expected_answer") or pair["a"].get("expected_answer")
        pair["a"]["expected_strength"] = pair["a"].get("expected_strength") or pair["b"].get("expected_strength")
        pair["b"]["expected_strength"] = pair["b"].get("expected_strength") or pair["a"].get("expected_strength")
        pair["a"]["sample_id"] = sample_id
        pair["b"]["sample_id"] = sample_id
    return by_request_id


def main() -> int:
    parser = argparse.ArgumentParser(description="Import hosted teacher response packs into FLIP distillation artifacts")
    parser.add_argument("--manifest", required=True, help="Request-pack manifest.jsonl path")
    parser.add_argument("--responses", required=True, help="Teacher response JSONL path")
    parser.add_argument("--summary-output", required=True, help="Evaluation-style summary JSON output path")
    parser.add_argument("--distill-output", required=True, help="Per-candidate distillation JSONL output path")
    parser.add_argument("--model", default="", help="Optional teacher model name override")
    parser.add_argument(
        "--allow-missing-responses",
        action="store_true",
        help="Allow request ids in the manifest that have no matching teacher response row",
    )
    args = parser.parse_args()

    manifest_path = Path(args.manifest).resolve()
    responses_path = Path(args.responses).resolve()
    summary_output = Path(args.summary_output).resolve()
    distill_output = Path(args.distill_output).resolve()

    manifest_lookup = build_manifest_lookup(load_jsonl(manifest_path))
    response_rows = load_jsonl(responses_path)
    response_lookup: Dict[str, Dict[str, Any]] = {}
    duplicate_response_ids = Counter()
    for row in response_rows:
        request_id = response_identifier(row)
        if request_id:
            duplicate_response_ids[request_id] += 1
            response_lookup[request_id] = row

    duplicated = sorted(request_id for request_id, count in duplicate_response_ids.items() if count > 1)
    if duplicated:
        raise ValueError(
            f"Teacher response file contains duplicate request ids ({len(duplicated)} duplicates), first: {duplicated[0]}"
        )

    missing_request_ids = sorted(request_id for request_id in manifest_lookup if request_id not in response_lookup)
    if missing_request_ids and not args.allow_missing_responses:
        raise ValueError(
            f"Teacher response file is missing {len(missing_request_ids)} request ids, first: {missing_request_ids[0]}"
        )

    grouped: Dict[str, Dict[str, Dict[str, Any]]] = {}
    for request_id, manifest_row in manifest_lookup.items():
        sample_id = str(manifest_row.get("sample_id") or manifest_row.get("flip_hash") or "")
        candidate_key = str(manifest_row.get("candidate_key") or "").lower()
        grouped.setdefault(sample_id, {})[candidate_key] = {
            "manifest": manifest_row,
            "response": response_lookup.get(request_id),
        }

    results: List[Dict[str, Any]] = []
    distill_rows: List[Dict[str, Any]] = []
    confusion = Counter()
    candidate_counts = Counter()
    answered = 0
    correct = 0
    total_latency_ms = 0
    detected_models = Counter()
    parse_error_count = 0
    missing_response_count = 0

    for index, sample_id in enumerate(sorted(grouped.keys()), start=1):
        pair = grouped[sample_id]
        if "a" not in pair or "b" not in pair:
            continue

        flip_hash = str(pair["a"]["manifest"].get("flip_hash") or "")
        response_a = pair["a"].get("response") or {}
        response_b = pair["b"].get("response") or {}
        if not response_a or not response_b:
            missing_response_count += int(not response_a) + int(not response_b)
        raw_a = str(
            response_a.get("output_text")
            or response_a.get("text")
            or response_a.get("content")
            or response_a.get("response")
            or ""
        )
        raw_b = str(
            response_b.get("output_text")
            or response_b.get("text")
            or response_b.get("content")
            or response_b.get("response")
            or ""
        )
        parsed_a = extract_candidate_analysis(response_a)
        parsed_b = extract_candidate_analysis(response_b)
        analysis_a = parsed_a or fallback_candidate_analysis(raw_a)
        analysis_b = parsed_b or fallback_candidate_analysis(raw_b)
        parse_error_count += int(parsed_a is None) + int(parsed_b is None)

        predicted = compare_candidates(pair["a"]["manifest"], analysis_a, analysis_b)
        selected_candidate = infer_selected_candidate(pair["a"]["manifest"], predicted)
        expected = str(pair["a"]["manifest"].get("expected_answer") or "skip")
        is_correct = predicted == expected
        if predicted in {"left", "right"}:
            answered += 1
        if is_correct:
            correct += 1
        if selected_candidate:
            candidate_counts[selected_candidate] += 1
        confusion[(expected, predicted)] += 1

        latency_ms = int(response_a.get("latency_ms") or 0) + int(response_b.get("latency_ms") or 0)
        total_latency_ms += latency_ms

        teacher_model = (
            args.model
            or str(response_a.get("model") or response_b.get("model") or "")
        )
        if teacher_model:
            detected_models[teacher_model] += 1

        result = {
            "index": index,
            "sampleId": sample_id,
            "flipHash": flip_hash,
            "expected": expected,
            "predicted": predicted,
            "selectedCandidate": selected_candidate,
            "candidateAnalyses": {"a": analysis_a, "b": analysis_b},
            "latencyMs": latency_ms,
            "correct": is_correct,
            "optionAMapsTo": pair["a"]["manifest"].get("candidate_maps_to"),
            "optionBMapsTo": pair["b"]["manifest"].get("candidate_maps_to"),
        }
        results.append(result)

        for candidate_key, analysis, response_row in (
            ("a", analysis_a, response_a),
            ("b", analysis_b, response_b),
        ):
            manifest_row = pair[candidate_key]["manifest"]
            candidate_maps_to = str(manifest_row.get("candidate_maps_to") or "")
            distill_rows.append(
                {
                    "id": str(manifest_row.get("request_id") or f"{sample_id}::candidate-{candidate_key}"),
                    "sample_id": sample_id,
                    "flip_hash": flip_hash,
                    "candidate_key": candidate_key,
                    "candidate_frame_images": manifest_row.get("images"),
                    "teacher_model": teacher_model,
                    "teacher_predicted": predicted,
                    "teacher_label": teacher_label_for_candidate(predicted, candidate_maps_to),
                    "teacher_selected_candidate": selected_candidate,
                    "expected_answer": expected,
                    "option_a_maps_to": pair["a"]["manifest"].get("candidate_maps_to"),
                    "option_b_maps_to": pair["b"]["manifest"].get("candidate_maps_to"),
                    "teacher_analysis": analysis,
                    "teacher_request_id": manifest_row.get("request_id"),
                    "teacher_response_row": response_row,
                }
            )

    candidate_answered = candidate_counts.get("a", 0) + candidate_counts.get("b", 0)
    model_name = args.model
    if not model_name and detected_models:
        model_name = detected_models.most_common(1)[0][0]

    summary = {
        "model": model_name,
        "mode": "hosted_candidate_analysis_compare",
        "manifestPath": str(manifest_path),
        "responsesPath": str(responses_path),
        "examples": len(results),
        "answered": answered,
        "correct": correct,
        "accuracy": round(correct / len(results), 6) if results else None,
        "accuracy_on_answered": round(correct / answered, 6) if answered else None,
        "candidate_counts": dict(sorted(candidate_counts.items())),
        "candidate_slot_bias_score": (
            round(abs(candidate_counts.get("a", 0) - candidate_counts.get("b", 0)) / candidate_answered, 6)
            if candidate_answered
            else None
        ),
        "mean_latency_ms": round(total_latency_ms / len(results), 2) if results else None,
        "response_count": len(response_lookup),
        "missing_response_count": missing_response_count,
        "parse_error_count": parse_error_count,
        "schema": CANDIDATE_ANALYSIS_SCHEMA,
        "confusion": {f"{truth}->{pred}": count for (truth, pred), count in sorted(confusion.items())},
        "results": results,
    }

    summary_output.parent.mkdir(parents=True, exist_ok=True)
    summary_output.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    distill_output.parent.mkdir(parents=True, exist_ok=True)
    with distill_output.open("w", encoding="utf-8") as handle:
        for row in distill_rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")

    print(
        json.dumps(
            {
                "manifest": str(manifest_path),
                "responses": str(responses_path),
                "summary_output": str(summary_output),
                "distill_output": str(distill_output),
                "examples": len(results),
                "distill_rows": len(distill_rows),
                "accuracy": summary.get("accuracy"),
                "teacher_model": model_name,
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
