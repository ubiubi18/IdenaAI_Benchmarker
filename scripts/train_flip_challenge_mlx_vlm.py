#!/usr/bin/env python3
"""
Train a local MLX-VLM LoRA adapter from a prepared FLIP-Challenge dataset.

Unlike `python -m mlx_vlm.lora`, this wrapper loads a local dataset created with
`Dataset.save_to_disk()`, which fits the FLIP preparation flow in this repo.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import mlx.core as mx
import mlx.nn as nn
import mlx.optimizers as optim
import numpy as np
from datasets import load_from_disk
from tqdm import tqdm
from transformers.models.qwen2.tokenization_qwen2 import Qwen2Tokenizer

from mlx_vlm.trainer import (
    Dataset,
    Trainer,
    find_all_linear_names,
    get_peft_model,
    save_adapter,
)
from mlx_vlm.utils import load, load_image_processor


SAFE_FALLBACK_MODEL_PATH = "mlx-community/Qwen2-VL-2B-Instruct-4bit"
RECOMMENDED_MAC_MODEL_PATH = "mlx-community/Qwen2.5-VL-7B-Instruct-4bit"


def patch_qwen_tokenizer_vocab() -> None:
    """Bridge mlx_vlm's detokenizer expectation for slow Qwen tokenizers.

    mlx_vlm currently assumes tokenizer.vocab exists. Slow Qwen tokenizers expose
    get_vocab() instead, so training dies during processor setup unless we add
    the compatibility property first.
    """

    if not hasattr(Qwen2Tokenizer, "vocab"):
        Qwen2Tokenizer.vocab = property(lambda self: self.get_vocab())


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


class WeightedDataset(Dataset):
    def __init__(self, *args, sample_weight_column: str = "training_weight", **kwargs):
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


class WeightedTrainer(Trainer):
    def loss_fn(self, model, batch):
        pixel_values = batch["pixel_values"]
        input_ids = batch["input_ids"]
        attention_mask = batch["attention_mask"]
        sample_weights = batch.get("sample_weights")
        lengths = mx.sum(attention_mask, axis=1)
        labels = input_ids[:, 1:]

        batch_size, seq_length = input_ids.shape

        if self.train_on_completions:
            weight_mask = mx.ones_like(attention_mask)

            assistant_response_index = np.where(input_ids == self.assistant_id)[1]
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

        length_mask = mx.arange(input_ids.shape[1])[None, :] < lengths[:, None]
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


def main(args) -> int:
    dataset_path = Path(args.dataset_path).resolve()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    patch_qwen_tokenizer_vocab()

    print(f"Loading model from {args.model_path}")
    model, processor = load(
        args.model_path,
        trust_remote_code=True,
        use_fast=False,
    )
    config = model.config.__dict__
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

    print("Setting up optimizer")
    optimizer = optim.Adam(learning_rate=args.learning_rate)

    print("Setting up trainer")
    trainer = WeightedTrainer(model, optimizer)
    model.train()

    steps_per_epoch = args.steps or max(1, len(dataset) // args.batch_size)
    print(
        f"Training for epochs={args.epochs} batch_size={args.batch_size} "
        f"steps_per_epoch={steps_per_epoch}"
    )
    print(f"Sample weighting: {json.dumps(weight_summary, sort_keys=True)}")

    history = []
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

    adapter_file = output_dir / "adapters.safetensors"
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
        "learning_rate": args.learning_rate,
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
        default=SAFE_FALLBACK_MODEL_PATH,
        help=(
            "MLX model repo or local path used as the base model. "
            f"Safe fallback: {SAFE_FALLBACK_MODEL_PATH}. "
            f"Recommended upgrade on stronger Macs: {RECOMMENDED_MAC_MODEL_PATH}."
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
