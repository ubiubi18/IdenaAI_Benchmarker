#!/usr/bin/env python3
"""
Evaluate a local MLX-VLM FLIP adapter on a prepared held-out dataset.

This script loads the base model plus an optional LoRA adapter, runs local
generation on prepared FLIP examples, normalizes the answer to left/right/skip,
and writes an evaluation summary plus per-example results.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any, Dict, Optional

import mlx.core as mx
from datasets import load_from_disk
from transformers.models.qwen2.tokenization_qwen2 import Qwen2Tokenizer

from mlx_vlm.utils import generate, load, prepare_inputs


def patch_qwen_tokenizer_vocab() -> None:
    if not hasattr(Qwen2Tokenizer, "vocab"):
        Qwen2Tokenizer.vocab = property(lambda self: self.get_vocab())


def normalize_answer(value: Any) -> Optional[str]:
    text = str(value or "").strip().lower()
    if not text:
        return None

    first_token = text.split()[0]
    if first_token in {"left", "l"}:
        return "left"
    if first_token in {"right", "r"}:
        return "right"
    if first_token in {"skip", "report", "reported", "inappropriate"}:
        return "skip"
    return None


def normalize_adapter_path(value: str) -> Optional[Path]:
    raw = Path(value).expanduser() if value else None
    if not raw:
        return None
    resolved = raw.resolve()
    return resolved.parent if resolved.is_file() else resolved


def extract_images(example: Dict[str, Any]) -> list[str]:
    images = example.get("images") or []
    if not images:
        raise ValueError("Example is missing image paths")
    return [str(item) for item in images]


def count_user_image_placeholders(messages: list[dict]) -> int:
    count = 0
    for message in messages:
        for item in message.get("content") or []:
            if isinstance(item, dict) and item.get("type") == "image":
                count += 1
    return count


def build_generation_inputs(model, processor, example: Dict[str, Any]) -> Dict[str, Any]:
    user_messages = [message for message in (example.get("messages") or []) if message.get("role") == "user"]
    if not user_messages:
        raise ValueError("Example is missing user messages")
    images = extract_images(example)
    image_count = count_user_image_placeholders(user_messages)
    if image_count and image_count != len(images):
        raise ValueError(
            f"Example image count mismatch: prompt expects {image_count}, dataset provides {len(images)}"
        )

    prompt = processor.apply_chat_template(
        user_messages,
        tokenize=False,
        add_generation_prompt=True,
    )
    prepared = prepare_inputs(
        processor,
        images,
        prompt,
        model.config.image_token_index,
    )
    payload = {
        "prompt": prompt,
        "input_ids": prepared["input_ids"],
        "pixel_values": prepared["pixel_values"],
        "mask": prepared["attention_mask"],
    }
    payload.update(
        {
            key: value
            for key, value in prepared.items()
            if key not in {"input_ids", "pixel_values", "attention_mask"}
        }
    )
    return payload


def score_answer_candidates(
    model,
    processor,
    prepared_inputs: Dict[str, Any],
    answer_labels: list[str],
) -> Dict[str, Dict[str, Any]]:
    candidate_scores: Dict[str, Dict[str, Any]] = {}
    extra_kwargs = {
        key: value
        for key, value in prepared_inputs.items()
        if key not in {"prompt", "pixel_values", "input_ids", "mask"}
    }

    for label in answer_labels:
        token_ids = processor.tokenizer.encode(label, add_special_tokens=False)
        if not token_ids:
            continue

        current_input_ids = prepared_inputs["input_ids"]
        current_mask = prepared_inputs["mask"]
        total_logprob = 0.0

        for token_id in token_ids:
            outputs = model(
                current_input_ids,
                prepared_inputs["pixel_values"],
                current_mask,
                **extra_kwargs,
            )
            logits = outputs.logits.astype(mx.float32)
            next_logits = logits[0, -1]
            next_logprob = float(next_logits[token_id] - mx.logsumexp(next_logits))
            total_logprob += next_logprob

            token_array = mx.array([[token_id]], dtype=current_input_ids.dtype)
            current_input_ids = mx.concatenate([current_input_ids, token_array], axis=1)
            current_mask = mx.concatenate(
                [current_mask, mx.ones((1, 1), dtype=current_mask.dtype)], axis=1
            )

        token_count = len(token_ids)
        candidate_scores[label] = {
            "sum_logprob": round(total_logprob, 6),
            "avg_logprob": round(total_logprob / max(token_count, 1), 6),
            "token_count": token_count,
        }

    return candidate_scores


def predict_from_candidate_scores(candidate_scores: Dict[str, Dict[str, Any]]) -> Optional[str]:
    if not candidate_scores:
        return None

    return max(
        candidate_scores.items(),
        key=lambda item: (
            item[1].get("avg_logprob", float("-inf")),
            item[1].get("sum_logprob", float("-inf")),
        ),
    )[0]


def evaluate(args) -> int:
    dataset_path = Path(args.dataset_path).resolve()
    adapter_path = normalize_adapter_path(args.adapter_path)
    output_path = Path(args.output).resolve() if args.output else None

    patch_qwen_tokenizer_vocab()

    print(f"Loading model from {args.model_path}")
    model, processor = load(
        args.model_path,
        adapter_path=str(adapter_path) if adapter_path else None,
        trust_remote_code=True,
        use_fast=False,
    )

    print(f"Loading dataset from {dataset_path}")
    raw_dataset = load_from_disk(str(dataset_path))
    if args.take:
      raw_dataset = raw_dataset.select(range(min(args.take, len(raw_dataset))))

    results = []
    confusion = Counter()
    answered = 0
    correct = 0

    print(f"Evaluating {len(raw_dataset)} example(s)")
    for index, example in enumerate(raw_dataset, start=1):
        prepared_inputs = build_generation_inputs(model, processor, example)
        expected = normalize_answer(example.get("expected_answer"))
        response = ""
        candidate_scores = {}

        if args.mode in {"generate", "both"}:
            response = generate(
                model,
                processor,
                prepared_inputs["prompt"],
                pixel_values=prepared_inputs["pixel_values"],
                input_ids=prepared_inputs["input_ids"],
                mask=prepared_inputs["mask"],
                max_tokens=args.max_tokens,
                temperature=args.temperature,
                verbose=False,
                **{
                    key: value
                    for key, value in prepared_inputs.items()
                    if key not in {"prompt", "pixel_values", "input_ids", "mask"}
                },
            )

        generated_prediction = normalize_answer(response)

        if args.mode in {"score", "both"}:
            candidate_scores = score_answer_candidates(
                model,
                processor,
                prepared_inputs,
                ["left", "right", "skip"],
            )

        scored_prediction = predict_from_candidate_scores(candidate_scores)
        predicted = (
            scored_prediction
            if args.mode == "score"
            else generated_prediction
            if args.mode == "generate"
            else scored_prediction or generated_prediction
        )
        is_correct = expected is not None and predicted == expected

        if predicted is not None:
            answered += 1
        if is_correct:
            correct += 1

        confusion[(expected or "unknown", predicted or "invalid")] += 1

        item = {
            "index": index,
            "flipHash": example.get("flip_hash"),
            "expected": expected,
            "predicted": predicted,
            "generatedPrediction": generated_prediction,
            "scoredPrediction": scored_prediction,
            "rawResponse": response,
            "candidateScores": candidate_scores,
            "correct": is_correct,
            "trainingWeight": example.get("training_weight"),
            "rankingSource": example.get("ranking_source"),
        }
        results.append(item)
        print(json.dumps(item, ensure_ascii=False))

    accuracy = (correct / len(raw_dataset)) if len(raw_dataset) else None
    answered_accuracy = (correct / answered) if answered else None
    summary = {
        "model_path": args.model_path,
        "adapter_path": str(adapter_path) if adapter_path else None,
        "dataset_path": str(dataset_path),
        "examples": len(raw_dataset),
        "answered": answered,
        "correct": correct,
        "accuracy": round(accuracy, 6) if accuracy is not None else None,
        "accuracy_on_answered": round(answered_accuracy, 6)
        if answered_accuracy is not None
        else None,
        "temperature": args.temperature,
        "max_tokens": args.max_tokens,
        "confusion": {
            f"{truth}->{pred}": count for (truth, pred), count in sorted(confusion.items())
        },
        "results": results,
    }

    if output_path:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Evaluate a local MLX-VLM FLIP adapter on prepared held-out data"
    )
    parser.add_argument(
        "--dataset-path",
        required=True,
        help="Path to the prepared Hugging Face dataset saved with save_to_disk()",
    )
    parser.add_argument(
        "--model-path",
        default="mlx-community/Qwen2-VL-2B-Instruct-4bit",
        help="MLX model repo or local path used as the base model",
    )
    parser.add_argument(
        "--adapter-path",
        default="",
        help="Optional path to a LoRA adapter safetensors file",
    )
    parser.add_argument(
        "--take",
        type=int,
        default=0,
        help="Optional cap on the number of evaluation examples to use",
    )
    parser.add_argument(
        "--max-tokens",
        type=int,
        default=8,
        help="Maximum generated tokens per example",
    )
    parser.add_argument(
        "--temperature",
        type=float,
        default=0.0,
        help="Sampling temperature for generation",
    )
    parser.add_argument(
        "--output",
        default="",
        help="Optional JSON report output path",
    )
    parser.add_argument(
        "--mode",
        choices=["generate", "score", "both"],
        default="score",
        help=(
            "Evaluation mode: generate free-form answer, score fixed candidates, "
            "or do both and prefer scored prediction"
        ),
    )

    raise SystemExit(evaluate(parser.parse_args()))
