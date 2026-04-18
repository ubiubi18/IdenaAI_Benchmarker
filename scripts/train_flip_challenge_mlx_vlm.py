#!/usr/bin/env python3
"""
Train a local MLX-VLM LoRA adapter from a prepared FLIP-Challenge dataset.

Unlike `python -m mlx_vlm.lora`, this wrapper loads a local dataset created with
`Dataset.save_to_disk()`, which fits the FLIP preparation flow in this repo.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import time
from pathlib import Path

import mlx.core as mx
import mlx.nn as nn
import mlx.optimizers as optim
import numpy as np
from datasets import load_from_disk
from tqdm import tqdm
from transformers.models.qwen2.tokenization_qwen2 import Qwen2Tokenizer

from mlx_vlm.trainer import find_all_linear_names, get_peft_model, save_adapter
from mlx_vlm.utils import load, load_image_processor

try:
    from mlx_vlm.trainer import Dataset, Trainer

    MODERN_TRAINER_API = False
    VisionDataset = None
    TrainingArgs = None
    train_with_modern_api = None
except ImportError:
    from mlx_vlm.trainer import TrainingArgs, VisionDataset, train as train_with_modern_api

    Dataset = None
    Trainer = None
    MODERN_TRAINER_API = True


SAFE_FALLBACK_MODEL_PATH = "mlx-community/Qwen2-VL-2B-Instruct-4bit"
STRONG_FALLBACK_MODEL_PATH = "mlx-community/Qwen2.5-VL-7B-Instruct-4bit"
RECOMMENDED_MAC_MODEL_PATH = "mlx-community/Qwen3.5-9B-MLX-4bit"


def maybe_sleep_for_cooldown(cooldown_ms: int) -> None:
    if int(cooldown_ms or 0) <= 0:
        return

    time.sleep(float(cooldown_ms) / 1000.0)


def looks_like_qwen35_model_path(value: str) -> bool:
    return "qwen3.5-9b" in str(value or "").strip().lower()


def ensure_model_runtime_support(model_path: str) -> None:
    if not looks_like_qwen35_model_path(model_path):
        return

    if importlib.util.find_spec("mlx_vlm.models.qwen3_5") is not None:
        return

    raise RuntimeError(
        "The selected base model requires mlx-vlm support for qwen3_5, but the "
        "current training environment does not provide that module. "
        "Use Python 3.10+ and install a newer mlx-vlm release in a dedicated "
        "training venv, for example: python3.11 -m venv .tmp/flip-train-venv-py311"
    )


def load_model_and_processor(model_path: str):
    load_kwargs = {
        "trust_remote_code": True,
        "use_fast": False,
    }

    try:
        return load(model_path, **load_kwargs)
    except TypeError as error:
        if "multiple values for keyword argument 'use_fast'" not in str(error):
            raise

    return load(model_path, trust_remote_code=True)


def patch_qwen_tokenizer_vocab() -> None:
    """Bridge mlx_vlm's detokenizer expectation for slow Qwen tokenizers.

    mlx_vlm currently assumes tokenizer.vocab exists. Slow Qwen tokenizers expose
    get_vocab() instead, so training dies during processor setup unless we add
    the compatibility property first.
    """

    if not hasattr(Qwen2Tokenizer, "vocab"):
        Qwen2Tokenizer.vocab = property(lambda self: self.get_vocab())


def resolve_image_token_index(config: dict) -> int:
    direct_candidates = [
        config.get("image_token_index"),
        config.get("image_token_id"),
    ]
    nested_candidates = []
    for nested_key in ("text_config", "vision_config"):
        nested = config.get(nested_key)
        if isinstance(nested, dict):
            nested_candidates.extend(
                [nested.get("image_token_index"), nested.get("image_token_id")]
            )

    for candidate in direct_candidates + nested_candidates:
        if isinstance(candidate, int):
            return candidate
        if isinstance(candidate, float) and float(candidate).is_integer():
            return int(candidate)

    raise KeyError(
        "Model config is missing image_token_index/image_token_id; "
        "cannot prepare MLX-VLM training inputs for this base model"
    )


def normalize_model_config(config: dict) -> dict:
    normalized = dict(config)
    normalized["image_token_index"] = resolve_image_token_index(normalized)
    return normalized


def normalize_sample_weights(value, batch_size: int) -> mx.array:
    if batch_size < 1:
        return mx.array([1.0], dtype=mx.float32)

    if isinstance(value, list):
        weights = [float(item or 1.0) for item in value]
    elif value is None:
        weights = [1.0] * batch_size
    else:
        weights = [float(value or 1.0)]

    if not weights:
        weights = [1.0] * batch_size

    if len(weights) == 1 and batch_size > 1:
        weights = weights * batch_size
    elif len(weights) != batch_size:
        weights = [1.0] * batch_size

    return mx.array(weights, dtype=mx.float32)


def summarize_training_weights(raw_dataset, sample_weight_column: str) -> dict:
    if not sample_weight_column or sample_weight_column not in raw_dataset.column_names:
        return {
            "enabled": False,
            "column": sample_weight_column,
            "count": len(raw_dataset),
            "min": 1.0,
            "max": 1.0,
            "mean": 1.0,
        }

    weights = []
    for value in raw_dataset[sample_weight_column]:
        try:
            weights.append(float(value or 1.0))
        except (TypeError, ValueError):
            weights.append(1.0)

    if not weights:
        weights = [1.0]

    return {
        "enabled": True,
        "column": sample_weight_column,
        "count": len(weights),
        "min": round(min(weights), 6),
        "max": round(max(weights), 6),
        "mean": round(sum(weights) / len(weights), 6),
    }


class WeightedDataset(Dataset if Dataset is not None else VisionDataset):
    def __init__(self, *args, sample_weight_column: str = "training_weight", **kwargs):
        if MODERN_TRAINER_API:
            kwargs.pop("image_processor", None)
        super().__init__(*args, **kwargs)
        self.sample_weight_column = sample_weight_column

    def __getitem__(self, idx):
        batch = super().__getitem__(idx)
        raw_item = self.dataset[idx]
        raw_weights = (
            raw_item.get(self.sample_weight_column)
            if self.sample_weight_column
            and isinstance(raw_item, dict)
            and self.sample_weight_column in raw_item
            else None
        )
        batch["sample_weights"] = normalize_sample_weights(
            raw_weights,
            int(batch["input_ids"].shape[0]),
        )
        return batch


def weighted_vision_language_loss_fn(
    model,
    batch,
    train_on_completions: bool = False,
    assistant_id: int = 77091,
    step_cooldown_ms: int = 0,
):
    maybe_sleep_for_cooldown(step_cooldown_ms)

    pixel_values = batch["pixel_values"]
    input_ids = batch["input_ids"]
    attention_mask = batch["attention_mask"]
    sample_weights = batch.get("sample_weights")

    batch_size, seq_length = input_ids.shape

    if train_on_completions:
        weight_mask = mx.ones_like(attention_mask)

        assistant_response_index = np.full((batch_size,), -1, dtype=np.int32)
        input_ids_np = np.array(input_ids)
        for row_idx, row in enumerate(input_ids_np):
            positions = np.where(row == assistant_id)[0]
            if positions.size > 0:
                assistant_response_index[row_idx] = positions[0]

        range_matrix = mx.repeat(
            mx.expand_dims(mx.arange(seq_length), 0), batch_size, axis=0
        )
        assistant_mask = range_matrix <= mx.array(assistant_response_index).reshape(
            -1, 1
        )
        weight_mask = mx.where(
            assistant_mask, mx.zeros_like(weight_mask), weight_mask
        )[:, 1:]
    else:
        weight_mask = None

    input_ids = input_ids[:, :-1]
    attention_mask = attention_mask[:, :-1]
    lengths = mx.sum(attention_mask, axis=1)
    labels = batch["input_ids"][:, 1:]

    kwargs = {
        k: v
        for k, v in batch.items()
        if k
        not in [
            "input_ids",
            "pixel_values",
            "attention_mask",
            "sample_weights",
        ]
    }

    outputs = model(input_ids, pixel_values, attention_mask, **kwargs)
    logits = outputs.logits.astype(mx.float32)

    if logits.shape[1] < labels.shape[1]:
        pad_length = labels.shape[1] - logits.shape[1]
        pad_width = ((0, 0), (0, pad_length), (0, 0))
        logits = mx.pad(logits, pad_width, mode="constant", constant_values=-100)
    elif logits.shape[1] > labels.shape[1]:
        logits = logits[:, -labels.shape[1] :, :]

    seq_len = input_ids.shape[1]
    lengths = mx.minimum(lengths, seq_len)
    length_mask = mx.arange(seq_len)[None, :] < lengths[:, None]
    ce = (
        nn.losses.cross_entropy(
            logits,
            labels,
            weights=weight_mask,
        )
        * length_mask
    )

    if sample_weights is not None:
        sample_weights = sample_weights.astype(mx.float32).reshape(-1, 1)
        ce = ce * sample_weights
        token_weights = length_mask.astype(mx.float32) * sample_weights
        ntoks = mx.maximum(token_weights.sum(), mx.array(1.0, dtype=mx.float32))
    else:
        ntoks = mx.maximum(
            length_mask.astype(mx.float32).sum(),
            mx.array(1.0, dtype=mx.float32),
        )

    return ce.sum() / ntoks


if not MODERN_TRAINER_API:
    class WeightedTrainer(Trainer):
        def __init__(self, *args, step_cooldown_ms: int = 0, **kwargs):
            super().__init__(*args, **kwargs)
            self.step_cooldown_ms = int(step_cooldown_ms or 0)

        def loss_fn(self, model, batch):
            return weighted_vision_language_loss_fn(
                model,
                batch,
                train_on_completions=self.train_on_completions,
                assistant_id=self.assistant_id,
                step_cooldown_ms=self.step_cooldown_ms,
            )


def main(args) -> int:
    dataset_path = Path(args.dataset_path).resolve()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    patch_qwen_tokenizer_vocab()
    ensure_model_runtime_support(args.model_path)

    print(f"Loading model from {args.model_path}")
    model, processor = load_model_and_processor(args.model_path)
    config = normalize_model_config(model.config.__dict__)
    image_processor = load_image_processor(
        args.model_path,
        trust_remote_code=True,
    )

    print(f"Loading dataset from {dataset_path}")
    raw_dataset = load_from_disk(str(dataset_path))
    if args.take:
        raw_dataset = raw_dataset.select(range(min(args.take, len(raw_dataset))))

    if "messages" not in raw_dataset.column_names:
        raise ValueError("Dataset must have a 'messages' column")
    if "images" not in raw_dataset.column_names:
        raise ValueError("Dataset must have an 'images' column")

    dataset = WeightedDataset(
        raw_dataset,
        config,
        processor,
        image_processor=image_processor,
        image_resize_shape=args.image_resize_shape,
        sample_weight_column=args.sample_weight_column,
    )
    weight_summary = summarize_training_weights(
        raw_dataset, args.sample_weight_column
    )

    print("Setting up LoRA")
    list_of_modules = find_all_linear_names(model.language_model)
    model = get_peft_model(
        model,
        list_of_modules,
        rank=args.lora_rank,
        alpha=args.lora_alpha,
        dropout=args.lora_dropout,
    )

    steps_per_epoch = args.steps or max(1, math.ceil(len(dataset) / args.batch_size))
    total_steps = steps_per_epoch * args.epochs
    print(
        f"Training for epochs={args.epochs} batch_size={args.batch_size} "
        f"steps_per_epoch={steps_per_epoch}"
    )
    print(
        f"Thermal throttle: step_cooldown_ms={args.step_cooldown_ms} "
        f"epoch_cooldown_ms={args.epoch_cooldown_ms}"
    )
    print(f"Sample weighting: {json.dumps(weight_summary, sort_keys=True)}")

    history = []

    adapter_file = output_dir / "adapters.safetensors"
    print("Setting up optimizer")
    optimizer = optim.Adam(learning_rate=args.learning_rate)

    if MODERN_TRAINER_API:
        print("Using mlx_vlm modern trainer API")
        training_args = TrainingArgs(
            batch_size=args.batch_size,
            iters=total_steps,
            steps_per_report=max(1, min(args.print_every, total_steps)),
            steps_per_eval=max(total_steps + 1, 2),
            steps_per_save=max(total_steps, 1),
            adapter_file=str(adapter_file),
            learning_rate=args.learning_rate,
        )
        train_with_modern_api(
            model=model,
            optimizer=optimizer,
            train_dataset=dataset,
            val_dataset=None,
            args=training_args,
            loss_fn=lambda *loss_args, **loss_kwargs: weighted_vision_language_loss_fn(
                *loss_args,
                **loss_kwargs,
                step_cooldown_ms=args.step_cooldown_ms,
            ),
        )
    else:
        print("Using mlx_vlm legacy trainer API")
        trainer = WeightedTrainer(
            model,
            optimizer,
            step_cooldown_ms=args.step_cooldown_ms,
        )
        model.train()

        for epoch in range(args.epochs):
            progress_bar = tqdm(range(steps_per_epoch), position=0, leave=True)
            for step in progress_bar:
                start = step * args.batch_size
                end = (step + 1) * args.batch_size
                batch = dataset[start:end]
                loss = trainer.train_step(batch)
                mx.eval(loss, model, optimizer.state)
                loss_value = float(loss.item())
                progress_bar.set_postfix(
                    {"epoch": epoch + 1, "step": step + 1, "loss": f"{loss_value:.4f}"}
                )

                if step % args.print_every == 0:
                    print(
                        json.dumps(
                            {
                                "epoch": epoch + 1,
                                "step": step + 1,
                                "loss": round(loss_value, 6),
                            }
                        )
                    )

                history.append(
                    {"epoch": epoch + 1, "step": step + 1, "loss": round(loss_value, 6)}
                )

            maybe_sleep_for_cooldown(args.epoch_cooldown_ms)

        print(f"Saving adapter to {adapter_file}")
        save_adapter(model, adapter_file)

    summary = {
        "model_path": args.model_path,
        "dataset_path": str(dataset_path),
        "output_dir": str(output_dir),
        "examples": len(raw_dataset),
        "epochs": args.epochs,
        "batch_size": args.batch_size,
        "steps_per_epoch": steps_per_epoch,
        "total_steps": total_steps,
        "trainer_api": "modern" if MODERN_TRAINER_API else "legacy",
        "learning_rate": args.learning_rate,
        "step_cooldown_ms": args.step_cooldown_ms,
        "epoch_cooldown_ms": args.epoch_cooldown_ms,
        "epoch_cooldown_applied": (not MODERN_TRAINER_API)
        and int(args.epoch_cooldown_ms or 0) > 0,
        "lora_rank": args.lora_rank,
        "lora_alpha": args.lora_alpha,
        "lora_dropout": args.lora_dropout,
        "sample_weighting": weight_summary,
        "final_loss": history[-1]["loss"] if history else None,
        "history_tail": history[-10:],
    }
    (output_dir / "run-summary.json").write_text(
        json.dumps(summary, indent=2), encoding="utf-8"
    )
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Train a local MLX-VLM LoRA adapter on prepared FLIP-Challenge data"
    )
    parser.add_argument(
        "--dataset-path",
        required=True,
        help="Path to the prepared Hugging Face dataset saved with save_to_disk()",
    )
    parser.add_argument(
        "--model-path",
        default=RECOMMENDED_MAC_MODEL_PATH,
        help=(
            "MLX model repo or local path used as the base model. "
            f"Recommended strong-Mac target: {RECOMMENDED_MAC_MODEL_PATH}. "
            f"Stronger fallback: {STRONG_FALLBACK_MODEL_PATH}. "
            f"Safe minimum fallback: {SAFE_FALLBACK_MODEL_PATH}."
        ),
    )
    parser.add_argument(
        "--output-dir",
        required=True,
        help="Directory where the adapter and training summary will be written",
    )
    parser.add_argument(
        "--take",
        type=int,
        default=0,
        help="Optional cap on the number of training examples to use",
    )
    parser.add_argument(
        "--image-resize-shape",
        type=int,
        nargs=2,
        default=None,
        help="Resize images to this shape before training",
    )
    parser.add_argument(
        "--learning-rate",
        type=float,
        default=1e-4,
        help="Learning rate for the optimizer",
    )
    parser.add_argument(
        "--batch-size", type=int, default=1, help="Batch size for training"
    )
    parser.add_argument(
        "--epochs", type=int, default=1, help="Number of epochs to train"
    )
    parser.add_argument(
        "--steps",
        type=int,
        default=0,
        help="Number of steps per epoch (0 = derive from dataset size)",
    )
    parser.add_argument(
        "--print-every", type=int, default=10, help="Print loss every n steps"
    )
    parser.add_argument(
        "--step-cooldown-ms",
        type=int,
        default=0,
        help="Optional pause after each training step to reduce sustained heat",
    )
    parser.add_argument(
        "--epoch-cooldown-ms",
        type=int,
        default=0,
        help="Optional pause after each epoch to reduce sustained heat",
    )
    parser.add_argument(
        "--lora-alpha", type=float, default=0.1, help="LoRA alpha parameter"
    )
    parser.add_argument("--lora-rank", type=int, default=10, help="LoRA rank")
    parser.add_argument("--lora-dropout", type=float, default=0.1, help="LoRA dropout")
    parser.add_argument(
        "--sample-weight-column",
        default="training_weight",
        help="Dataset column used for per-example training weights",
    )

    raise SystemExit(main(parser.parse_args()))
