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
import json
import subprocess
import sys
from pathlib import Path
from typing import Dict, List


MODE_MAPPING = {
    "baseline": "none",
    "weight_boost": "weight_boost",
    "followup_reasoning": "followup_reasoning",
    "hybrid": "hybrid",
}


def run_command(command: List[str]) -> None:
    print("$", " ".join(command))
    subprocess.run(command, check=True)


def load_json(path: Path) -> Dict:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


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
    parser.add_argument("--human-weight-scale", type=float, default=1.0)
    parser.add_argument(
        "--modes",
        nargs="+",
        default=["baseline", "weight_boost", "followup_reasoning", "hybrid"],
        choices=sorted(MODE_MAPPING.keys()),
        help="Experiment modes to run",
    )
    parser.add_argument("--model-path", default="mlx-community/Qwen2-VL-2B-Instruct-4bit")
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
    args = parser.parse_args()

    output_root = Path(args.output_root).resolve()
    output_root.mkdir(parents=True, exist_ok=True)

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
        "trainSplit": args.train_split,
        "maxFlips": args.max_flips,
        "promptFamily": args.prompt_family,
        "imageMode": args.image_mode,
        "modes": [],
    }

    for mode_key in args.modes:
        human_mode = MODE_MAPPING[mode_key]
        if human_mode != "none" and not human_annotations_path:
            raise ValueError(
                f"Mode {mode_key} requires --human-annotations-jsonl"
            )

        prepared_dir = output_root / "prepared" / mode_key
        run_dir = output_root / "runs" / mode_key
        eval_path = output_root / "evals" / f"{mode_key}-{args.eval_output_suffix}"

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
                "humanAnnotationMode": human_mode,
                "preparedManifest": manifest,
                "runSummary": run_summary,
                "evaluation": eval_summary,
                "paths": {
                    "preparedDir": str(prepared_dir),
                    "runDir": str(run_dir),
                    "evalPath": str(eval_path) if args.eval_dataset_path else None,
                },
            }
        )

    summary_path = output_root / "matrix-summary.json"
    summary_path.write_text(json.dumps(matrix_summary, indent=2), encoding="utf-8")
    print(json.dumps({"ok": True, "summaryPath": str(summary_path)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
