#!/usr/bin/env python3
"""
Evaluate a prepared FLIP dataset with a local Ollama vision model.

This script is intended as a bridge toward teacher-style supervision:
- it reads prepared HF datasets produced by prepare_flip_challenge_mlx_vlm.py
- it deduplicates candidate-label rows down to one row per flip presentation
- it runs a stronger local Ollama vision model on each candidate separately
- it compares the candidates in code and reports canonical accuracy
"""

from __future__ import annotations

import argparse
import base64
import json
from collections import Counter
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple

from datasets import load_from_disk

from run_local_flip_ollama_smoke import (
    DEFAULT_MODEL,
    build_candidate_analysis_prompt,
    build_direct_prompt,
    call_ollama_chat,
    extract_answer_from_text,
)


def dedupe_prepared_examples(rows: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    deduped: List[Dict[str, Any]] = []
    seen = set()
    for row in rows:
        key = (
            str(row.get("flip_hash") or ""),
            tuple(row.get("option_a_order") or []),
            tuple(row.get("option_b_order") or []),
            str(row.get("expected_answer") or ""),
            str(row.get("option_a_maps_to") or ""),
            str(row.get("option_b_maps_to") or ""),
        )
        if key in seen:
            continue
        seen.add(key)
        deduped.append(row)
    return deduped


def encode_image_path(path: str) -> str:
    data = Path(path).read_bytes()
    return base64.b64encode(data).decode("ascii")


def parse_structured_payload(value: Any) -> Dict[str, Any] | None:
    if isinstance(value, dict):
        return value

    text = str(value or "").strip()
    if not text:
        return None

    candidates = [text]
    if "```" in text:
        candidates.extend(
            segment.strip()
            for segment in text.split("```")
            if segment.strip().startswith("{")
        )

    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        candidates.append(text[start : end + 1])

    for candidate in candidates:
        try:
            payload = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            return payload

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


def analyze_candidate(
    *,
    model: str,
    flip_hash: str,
    candidate_label: str,
    image_paths: List[str],
    timeout_seconds: int,
) -> Tuple[Dict[str, Any], int]:
    prompt = build_candidate_analysis_prompt(flip_hash, candidate_label.upper())
    images = [encode_image_path(path) for path in image_paths]
    raw_text, latency_ms = call_ollama_chat(
        model,
        prompt,
        images,
        timeout_seconds,
        response_format=None,
        num_predict=512,
    )
    parsed = parse_structured_payload(raw_text) or fallback_candidate_analysis(raw_text)
    return parsed, latency_ms


def run_direct_compare(
    *,
    model: str,
    example: Dict[str, Any],
    timeout_seconds: int,
    first_candidate_key: str = "a",
) -> Tuple[str, str | None, str, int]:
    flip_hash = str(example.get("flip_hash") or "")
    normalized_first = "a" if str(first_candidate_key or "").lower() == "a" else "b"
    second_candidate_key = "b" if normalized_first == "a" else "a"
    prompt = build_direct_prompt(
        flip_hash=flip_hash,
        force_decision=False,
        first_candidate_label=normalized_first.upper(),
        second_candidate_label=second_candidate_key.upper(),
    )
    first_images = list(example.get(f"option_{normalized_first}_frame_images") or [])
    second_images = list(example.get(f"option_{second_candidate_key}_frame_images") or [])
    image_paths = first_images + second_images
    images = [encode_image_path(path) for path in image_paths]
    raw_text, latency_ms = call_ollama_chat(
        model,
        prompt,
        images,
        timeout_seconds,
        response_format=None,
        num_predict=256,
    )
    candidate_answer = extract_answer_from_text(raw_text)
    if candidate_answer == "a":
        predicted = str(example.get(f"option_{normalized_first}_maps_to") or "skip")
    elif candidate_answer == "b":
        predicted = str(example.get(f"option_{second_candidate_key}_maps_to") or "skip")
    elif candidate_answer == "skip":
        predicted = "skip"
    else:
        predicted = "skip"
        candidate_answer = None
    return predicted, candidate_answer, raw_text, latency_ms


def run_direct_compare_swap_consensus(
    *,
    model: str,
    example: Dict[str, Any],
    timeout_seconds: int,
) -> Tuple[str, str | None, Dict[str, Any], int]:
    first_pred, first_selected, first_raw, latency_a = run_direct_compare(
        model=model,
        example=example,
        timeout_seconds=timeout_seconds,
        first_candidate_key="a",
    )
    second_pred, second_selected, second_raw, latency_b = run_direct_compare(
        model=model,
        example=example,
        timeout_seconds=timeout_seconds,
        first_candidate_key="b",
    )

    if first_pred == second_pred:
        return (
            first_pred,
            first_selected if first_pred != "skip" else None,
            {
                "aFirst": {"predicted": first_pred, "selectedCandidate": first_selected, "rawResponse": first_raw},
                "bFirst": {"predicted": second_pred, "selectedCandidate": second_selected, "rawResponse": second_raw},
            },
            latency_a + latency_b,
        )

    return (
        "skip",
        None,
        {
            "aFirst": {"predicted": first_pred, "selectedCandidate": first_selected, "rawResponse": first_raw},
            "bFirst": {"predicted": second_pred, "selectedCandidate": second_selected, "rawResponse": second_raw},
        },
        latency_a + latency_b,
    )


def compute_candidate_score(analysis: Dict[str, Any]) -> int:
    if any(
        bool(analysis.get(field))
        for field in ("textRequired", "sequenceMarkersPresent", "inappropriateContent")
    ):
        return -1
    return int(analysis.get("chronologyScore") or 0) + int(
        analysis.get("entityConsistencyScore") or 0
    ) + int(analysis.get("causalScore") or 0)


def compare_candidates(example: Dict[str, Any], analysis_a: Dict[str, Any], analysis_b: Dict[str, Any]) -> str:
    score_a = compute_candidate_score(analysis_a)
    score_b = compute_candidate_score(analysis_b)

    if score_a < 0 and score_b < 0:
        return "skip"
    if score_a == score_b:
        return "skip"
    if score_a > score_b:
        return str(example.get("option_a_maps_to") or "skip")
    return str(example.get("option_b_maps_to") or "skip")


def infer_selected_candidate(example: Dict[str, Any], predicted: str) -> str | None:
    if predicted == str(example.get("option_a_maps_to") or ""):
        return "a"
    if predicted == str(example.get("option_b_maps_to") or ""):
        return "b"
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description="Evaluate prepared FLIP datasets with Ollama")
    parser.add_argument("--dataset-path", required=True, help="HF dataset path produced by the FLIP prep script")
    parser.add_argument("--model", default=DEFAULT_MODEL, help=f"Ollama model name (default: {DEFAULT_MODEL})")
    parser.add_argument("--timeout-seconds", type=int, default=90, help="per-candidate Ollama timeout in seconds")
    parser.add_argument(
        "--mode",
        choices=[
            "candidate_analysis_compare",
            "direct_compare",
            "direct_compare_swap_consensus",
        ],
        default="candidate_analysis_compare",
        help="teacher evaluation mode",
    )
    parser.add_argument("--take", type=int, default=0, help="optional limit after deduplication")
    parser.add_argument("--output", help="optional output JSON path")
    args = parser.parse_args()

    dataset = load_from_disk(str(Path(args.dataset_path).resolve()))
    rows = [dict(item) for item in dataset]
    deduped = dedupe_prepared_examples(rows)
    if args.take > 0:
        deduped = deduped[: min(args.take, len(deduped))]

    results: List[Dict[str, Any]] = []
    candidate_counts = Counter()
    confusion = Counter()
    correct = 0
    answered = 0
    total_latency_ms = 0

    print(f"Evaluating {len(deduped)} unique flip(s) with model={args.model}")

    for index, example in enumerate(deduped, start=1):
        flip_hash = str(example.get("flip_hash") or f"row-{index}")
        direct_raw_response = None
        if args.mode == "candidate_analysis_compare":
            analysis_a, latency_a = analyze_candidate(
                model=args.model,
                flip_hash=flip_hash,
                candidate_label="a",
                image_paths=list(example.get("option_a_frame_images") or []),
                timeout_seconds=args.timeout_seconds,
            )
            analysis_b, latency_b = analyze_candidate(
                model=args.model,
                flip_hash=flip_hash,
                candidate_label="b",
                image_paths=list(example.get("option_b_frame_images") or []),
                timeout_seconds=args.timeout_seconds,
            )
            total_latency_ms += latency_a + latency_b
            predicted = compare_candidates(example, analysis_a, analysis_b)
            selected_candidate = None
            if predicted == str(example.get("option_a_maps_to")):
                selected_candidate = "a"
            elif predicted == str(example.get("option_b_maps_to")):
                selected_candidate = "b"
            latency_ms = latency_a + latency_b
        elif args.mode == "direct_compare":
            predicted, selected_candidate, direct_raw_response, latency_ms = run_direct_compare(
                model=args.model,
                example=example,
                timeout_seconds=args.timeout_seconds,
            )
            analysis_a = None
            analysis_b = None
        else:
            predicted, selected_candidate, direct_raw_response, latency_ms = run_direct_compare_swap_consensus(
                model=args.model,
                example=example,
                timeout_seconds=args.timeout_seconds,
            )
            analysis_a = None
            analysis_b = None
            selected_candidate = infer_selected_candidate(example, predicted)

        total_latency_ms += latency_ms

        expected = str(example.get("expected_answer") or "skip")
        is_correct = predicted == expected
        if predicted in {"left", "right"}:
            answered += 1
        if is_correct:
            correct += 1

        if selected_candidate:
            candidate_counts[selected_candidate] += 1

        confusion[(expected, predicted)] += 1
        item = {
            "index": index,
            "sampleId": example.get("sample_id"),
            "flipHash": flip_hash,
            "expected": expected,
            "predicted": predicted,
            "selectedCandidate": selected_candidate,
            "candidateAnalyses": {"a": analysis_a, "b": analysis_b}
            if args.mode == "candidate_analysis_compare"
            else None,
            "rawResponse": direct_raw_response,
            "latencyMs": latency_ms,
            "correct": is_correct,
            "optionAMapsTo": example.get("option_a_maps_to"),
            "optionBMapsTo": example.get("option_b_maps_to"),
        }
        results.append(item)
        print(json.dumps(item))

    candidate_answered = candidate_counts.get("a", 0) + candidate_counts.get("b", 0)
    summary = {
        "model": args.model,
        "mode": args.mode,
        "datasetPath": str(Path(args.dataset_path).resolve()),
        "examples": len(deduped),
        "answered": answered,
        "correct": correct,
        "accuracy": round(correct / len(deduped), 6) if deduped else None,
        "accuracy_on_answered": round(correct / answered, 6) if answered else None,
        "candidate_counts": dict(sorted(candidate_counts.items())),
        "candidate_slot_bias_score": (
            round(abs(candidate_counts.get("a", 0) - candidate_counts.get("b", 0)) / candidate_answered, 6)
            if candidate_answered
            else None
        ),
        "mean_latency_ms": round(total_latency_ms / len(deduped), 2) if deduped else None,
        "confusion": {
            f"{truth}->{pred}": count for (truth, pred), count in sorted(confusion.items())
        },
        "results": results,
    }

    if args.output:
        output_path = Path(args.output).resolve()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
