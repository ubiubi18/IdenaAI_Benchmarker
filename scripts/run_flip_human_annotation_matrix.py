#!/usr/bin/env python3
"""
Run small comparable FLIP training experiments with and without human annotations.

This script keeps the current evaluator untouched and simply orchestrates:
1. prepare dataset
2. train adapter
3. evaluate adapter on the same held-out dataset

The goal is to compare baseline vs human-assisted preparation modes on the same
small FLIP slices.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Dict, List, Optional


MODE_MAPPING = {
    "baseline": "none",
    "weight_boost": "weight_boost",
    "followup_reasoning": "followup_reasoning",
    "hybrid": "hybrid",
}
SAFE_FALLBACK_MODEL_PATH = "mlx-community/Qwen2-VL-2B-Instruct-4bit"
RECOMMENDED_MAC_MODEL_PATH = "mlx-community/Qwen2.5-VL-7B-Instruct-4bit"


def run_command(command: List[str]) -> None:
    print("$", " ".join(command))
    subprocess.run(command, check=True)


def load_json(path: Path) -> Dict:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def epoch_run_key(now: Optional[dt.datetime] = None) -> str:
    current = now or dt.datetime.now(dt.timezone.utc)
    return current.strftime("%Y%m%dT%H%M%SZ")


def prune_epoch_history(epochs_root: Path, keep: int) -> List[str]:
    if keep <= 0 or not epochs_root.exists():
        return []

    epoch_dirs = sorted(
        [path for path in epochs_root.iterdir() if path.is_dir()],
        key=lambda path: path.name,
    )
    removable = epoch_dirs[:-keep]
    removed = []
    for path in removable:
        shutil.rmtree(path)
        removed.append(path.name)
    return removed


def extract_eval_metrics(eval_summary: Optional[Dict]) -> Dict[str, Optional[float]]:
    if not eval_summary:
        return {
            "accuracy": None,
            "accuracy_on_answered": None,
            "answered_fraction": None,
            "candidate_slot_bias_score": None,
            "swap_consistency_rate": None,
        }

    examples = eval_summary.get("examples")
    answered = eval_summary.get("answered")
    try:
        answered_fraction = (
            round(float(answered) / float(examples), 6)
            if examples and answered is not None
            else None
        )
    except (TypeError, ValueError, ZeroDivisionError):
        answered_fraction = None

    swap_consistency = eval_summary.get("swap_consistency") or {}
    return {
        "accuracy": eval_summary.get("accuracy"),
        "accuracy_on_answered": eval_summary.get("accuracy_on_answered"),
        "answered_fraction": answered_fraction,
        "candidate_slot_bias_score": eval_summary.get("candidate_slot_bias_score"),
        "swap_consistency_rate": swap_consistency.get("rate"),
    }


def build_comparisons(mode_rows: List[Dict]) -> Dict[str, object]:
    metrics = [
        ("accuracy", "max"),
        ("accuracy_on_answered", "max"),
        ("answered_fraction", "max"),
        ("swap_consistency_rate", "max"),
        ("candidate_slot_bias_score", "min"),
    ]

    def pick_best(rows: List[Dict], metric_name: str, direction: str) -> Optional[Dict]:
        candidates = [
            row for row in rows if row.get("metrics", {}).get(metric_name) is not None
        ]
        if not candidates:
            return None
        key_fn = lambda row: float(row["metrics"][metric_name])
        return (
            max(candidates, key=key_fn)
            if direction == "max"
            else min(candidates, key=key_fn)
        )

    comparison_rows = [
        {
            "runKey": row["runKey"],
            "mode": row["humanAnnotationMode"],
            "aggregation": row["humanAnnotationAggregation"],
            "metrics": row["metrics"],
        }
        for row in mode_rows
    ]

    by_mode: Dict[str, Dict[str, object]] = {}
    for mode in sorted({row["humanAnnotationMode"] for row in mode_rows}):
        rows = [row for row in mode_rows if row["humanAnnotationMode"] == mode]
        best = {}
        for metric_name, direction in metrics:
            picked = pick_best(rows, metric_name, direction)
            if picked:
                best[metric_name] = {
                    "runKey": picked["runKey"],
                    "aggregation": picked["humanAnnotationAggregation"],
                    "value": picked["metrics"][metric_name],
                }
        by_mode[mode] = {"runs": [row["runKey"] for row in rows], "best": best}

    by_aggregation: Dict[str, Dict[str, object]] = {}
    for aggregation in sorted({row["humanAnnotationAggregation"] for row in mode_rows}):
        rows = [
            row
            for row in mode_rows
            if row["humanAnnotationAggregation"] == aggregation
        ]
        best = {}
        for metric_name, direction in metrics:
            picked = pick_best(rows, metric_name, direction)
            if picked:
                best[metric_name] = {
                    "runKey": picked["runKey"],
                    "mode": picked["humanAnnotationMode"],
                    "value": picked["metrics"][metric_name],
                }
        by_aggregation[aggregation] = {
            "runs": [row["runKey"] for row in rows],
            "best": best,
        }

    overall_best = {}
    for metric_name, direction in metrics:
        picked = pick_best(mode_rows, metric_name, direction)
        if picked:
            overall_best[metric_name] = {
                "runKey": picked["runKey"],
                "mode": picked["humanAnnotationMode"],
                "aggregation": picked["humanAnnotationAggregation"],
                "value": picked["metrics"][metric_name],
            }

    return {
        "rows": comparison_rows,
        "byMode": by_mode,
        "byAggregation": by_aggregation,
        "overallBest": overall_best,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run baseline vs human-assisted FLIP training experiments"
    )
    parser.add_argument("--output-root", required=True, help="Root directory for all experiment outputs")
    parser.add_argument("--train-split", choices=["train", "validation", "test", "all"], default="train")
    parser.add_argument("--max-flips", type=int, default=50, help="Max completed flips to prepare")
    parser.add_argument("--skip-flips", type=int, default=0, help="Completed flips to skip before export")
    parser.add_argument("--prompt-family", default="runtime_aligned_native_frames_v2")
    parser.add_argument("--image-mode", choices=["composite", "native_frames"], default="native_frames")
    parser.add_argument("--augment-swap-orders", action="store_true")
    parser.add_argument("--balance-canonical-answers", action="store_true")
    parser.add_argument("--human-annotations-jsonl", help="Normalized human-teacher annotation JSONL")
    parser.add_argument("--human-min-quality-tier", choices=["bronze", "silver", "gold"], default="bronze")
    parser.add_argument(
        "--human-annotation-aggregation",
        choices=["best_single", "deepfunding"],
        default="best_single",
        help="Default aggregation mode when only one aggregation should be tested",
    )
    parser.add_argument(
        "--human-annotation-aggregations",
        nargs="+",
        choices=["best_single", "deepfunding"],
        help="Optional list of aggregation modes to compare side by side",
    )
    parser.add_argument("--human-weight-scale", type=float, default=1.0)
    parser.add_argument(
        "--modes",
        nargs="+",
        default=["baseline", "weight_boost", "followup_reasoning", "hybrid"],
        choices=sorted(MODE_MAPPING.keys()),
        help="Experiment modes to run",
    )
    parser.add_argument(
        "--model-path",
        default=SAFE_FALLBACK_MODEL_PATH,
        help=(
            "MLX model repo or local path for training and evaluation. "
            f"Safe fallback: {SAFE_FALLBACK_MODEL_PATH}. "
            f"Recommended upgrade on stronger Macs: {RECOMMENDED_MAC_MODEL_PATH}."
        ),
    )
    parser.add_argument("--train-take", type=int, default=0, help="Optional cap on training examples after preparation")
    parser.add_argument("--epochs", type=int, default=1)
    parser.add_argument("--steps", type=int, default=100)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--learning-rate", type=float, default=1e-4)
    parser.add_argument("--lora-rank", type=int, default=10)
    parser.add_argument("--lora-alpha", type=float, default=0.1)
    parser.add_argument("--lora-dropout", type=float, default=0.1)
    parser.add_argument("--sample-weight-column", default="training_weight")
    parser.add_argument("--eval-dataset-path", help="Prepared held-out HF dataset path")
    parser.add_argument("--eval-mode", default="score", choices=["generate", "score", "both", "candidate_compare", "candidate_label_compare"])
    parser.add_argument("--eval-take", type=int, default=0)
    parser.add_argument("--eval-output-suffix", default="eval.json")
    parser.add_argument(
        "--retention-epochs",
        type=int,
        default=3,
        help="How many matrix-result epochs to keep under output-root/epochs (default: 3)",
    )
    args = parser.parse_args()

    output_root = Path(args.output_root).resolve()
    output_root.mkdir(parents=True, exist_ok=True)
    epochs_root = output_root / "epochs"
    epochs_root.mkdir(parents=True, exist_ok=True)
    epoch_key = epoch_run_key()
    epoch_root = epochs_root / epoch_key
    epoch_root.mkdir(parents=True, exist_ok=True)

    script_dir = Path(__file__).resolve().parent
    prepare_script = script_dir / "prepare_flip_challenge_mlx_vlm.py"
    train_script = script_dir / "train_flip_challenge_mlx_vlm.py"
    evaluate_script = script_dir / "evaluate_flip_challenge_mlx_vlm.py"

    human_annotations_path = (
        Path(args.human_annotations_jsonl).resolve()
        if args.human_annotations_jsonl
        else None
    )

    matrix_summary = {
        "outputRoot": str(output_root),
        "epochKey": epoch_key,
        "epochRoot": str(epoch_root),
        "retentionEpochs": args.retention_epochs,
        "modelPath": args.model_path,
        "trainSplit": args.train_split,
        "maxFlips": args.max_flips,
        "promptFamily": args.prompt_family,
        "imageMode": args.image_mode,
        "humanAnnotationAggregations": [],
        "modes": [],
    }

    aggregation_modes = (
        list(dict.fromkeys(args.human_annotation_aggregations))
        if args.human_annotation_aggregations
        else [args.human_annotation_aggregation]
    )
    matrix_summary["humanAnnotationAggregations"] = aggregation_modes

    print(
        json.dumps(
            {
                "stage": "matrix_start",
                "modelPath": args.model_path,
                "trainSplit": args.train_split,
                "maxFlips": args.max_flips,
                "aggregations": aggregation_modes,
            },
            indent=2,
        )
    )

    for mode_key in args.modes:
        human_mode = MODE_MAPPING[mode_key]
        if human_mode != "none" and not human_annotations_path:
            raise ValueError(
                f"Mode {mode_key} requires --human-annotations-jsonl"
            )

        mode_aggregations = ["best_single"] if human_mode == "none" else aggregation_modes

        for aggregation_mode in mode_aggregations:
            run_key = (
                mode_key
                if human_mode == "none"
                else f"{mode_key}__{aggregation_mode}"
            )
            prepared_dir = epoch_root / "prepared" / run_key
            run_dir = epoch_root / "runs" / run_key
            eval_path = epoch_root / "evals" / f"{run_key}-{args.eval_output_suffix}"

            prepare_command = [
                sys.executable,
                str(prepare_script),
                "--split",
                args.train_split,
                "--max-flips",
                str(args.max_flips),
                "--skip-flips",
                str(args.skip_flips),
                "--output-dir",
                str(prepared_dir),
                "--prompt-family",
                args.prompt_family,
                "--image-mode",
                args.image_mode,
                "--human-annotation-mode",
                human_mode,
                "--human-min-quality-tier",
                args.human_min_quality_tier,
                "--human-annotation-aggregation",
                aggregation_mode,
                "--human-weight-scale",
                str(args.human_weight_scale),
            ]
            if args.augment_swap_orders:
                prepare_command.append("--augment-swap-orders")
            if args.balance_canonical_answers:
                prepare_command.append("--balance-canonical-answers")
            if human_annotations_path:
                prepare_command.extend(
                    ["--human-annotations-jsonl", str(human_annotations_path)]
                )

            run_command(prepare_command)

            train_command = [
                sys.executable,
                str(train_script),
                "--dataset-path",
                str(prepared_dir / "hf-dataset"),
                "--model-path",
                args.model_path,
                "--output-dir",
                str(run_dir),
                "--epochs",
                str(args.epochs),
                "--steps",
                str(args.steps),
                "--batch-size",
                str(args.batch_size),
                "--learning-rate",
                str(args.learning_rate),
                "--lora-rank",
                str(args.lora_rank),
                "--lora-alpha",
                str(args.lora_alpha),
                "--lora-dropout",
                str(args.lora_dropout),
                "--sample-weight-column",
                args.sample_weight_column,
            ]
            if args.train_take > 0:
                train_command.extend(["--take", str(args.train_take)])

            run_command(train_command)

            eval_summary = None
            if args.eval_dataset_path:
                eval_command = [
                    sys.executable,
                    str(evaluate_script),
                    "--dataset-path",
                    str(Path(args.eval_dataset_path).resolve()),
                    "--model-path",
                    args.model_path,
                    "--adapter-path",
                    str(run_dir / "adapters.safetensors"),
                    "--mode",
                    args.eval_mode,
                    "--output",
                    str(eval_path),
                ]
                if args.eval_take > 0:
                    eval_command.extend(["--take", str(args.eval_take)])
                run_command(eval_command)
                eval_summary = load_json(eval_path)

            manifest = load_json(prepared_dir / "manifest.json")
            run_summary = load_json(run_dir / "run-summary.json")

            matrix_summary["modes"].append(
                {
                    "name": mode_key,
                    "runKey": run_key,
                    "humanAnnotationMode": human_mode,
                    "humanAnnotationAggregation": aggregation_mode,
                    "metrics": extract_eval_metrics(eval_summary),
                    "preparedManifest": manifest,
                    "runSummary": run_summary,
                    "evaluation": eval_summary,
                    "paths": {
                        "preparedDir": str(prepared_dir),
                        "runDir": str(run_dir),
                        "evalPath": str(eval_path) if args.eval_dataset_path else None,
                    },
                },
            )

    matrix_summary["comparisons"] = build_comparisons(matrix_summary["modes"])
    summary_json = json.dumps(matrix_summary, indent=2)
    summary_path = epoch_root / "matrix-summary.json"
    summary_path.write_text(summary_json, encoding="utf-8")
    latest_summary_path = output_root / "matrix-summary.json"
    latest_summary_path.write_text(summary_json, encoding="utf-8")
    removed_epochs = prune_epoch_history(epochs_root, args.retention_epochs)
    matrix_summary["prunedEpochs"] = removed_epochs
    if removed_epochs:
        summary_json = json.dumps(matrix_summary, indent=2)
        summary_path.write_text(summary_json, encoding="utf-8")
        latest_summary_path.write_text(summary_json, encoding="utf-8")
    print(json.dumps({"ok": True, "summaryPath": str(summary_path)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
