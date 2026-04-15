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

import mlx.optimizers as optim
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


def patch_qwen_tokenizer_vocab() -> None:
    """Bridge mlx_vlm's detokenizer expectation for slow Qwen tokenizers.

    mlx_vlm currently assumes tokenizer.vocab exists. Slow Qwen tokenizers expose
    get_vocab() instead, so training dies during processor setup unless we add
    the compatibility property first.
    """

    if not hasattr(Qwen2Tokenizer, "vocab"):
        Qwen2Tokenizer.vocab = property(lambda self: self.get_vocab())


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

    dataset = Dataset(
        raw_dataset,
        config,
        processor,
        image_processor=image_processor,
        image_resize_shape=args.image_resize_shape,
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
    trainer = Trainer(model, optimizer)
    model.train()

    steps_per_epoch = args.steps or max(1, len(dataset) // args.batch_size)
    print(
        f"Training for epochs={args.epochs} batch_size={args.batch_size} "
        f"steps_per_epoch={steps_per_epoch}"
    )

    history = []
    for epoch in range(args.epochs):
        progress_bar = tqdm(range(steps_per_epoch), position=0, leave=True)
        for step in progress_bar:
            start = step * args.batch_size
            end = (step + 1) * args.batch_size
            batch = dataset[start:end]
            loss = trainer.train_step(batch)
            loss_value = float(loss.item())
            progress_bar.update(1)
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
        default="mlx-community/Qwen2-VL-2B-Instruct-4bit",
        help="MLX model repo or local path used as the base model",
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

    raise SystemExit(main(parser.parse_args()))
