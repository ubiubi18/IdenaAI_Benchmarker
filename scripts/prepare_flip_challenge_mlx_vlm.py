#!/usr/bin/env python3
"""
Prepare the Hugging Face FLIP-Challenge dataset for local MLX-VLM LoRA training.

This script:
1. Downloads parquet shards from https://huggingface.co/datasets/aplesner-eth/FLIP-Challenge
2. Extracts completed flips with four panel images
3. Saves images as regular files on disk
4. Writes a local Hugging Face dataset (`save_to_disk`) with `images` and `messages`
5. Writes a JSONL mirror for easy inspection

The resulting dataset is designed for local staged training on Apple Silicon.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from pathlib import Path
from typing import Dict, Iterable, List, Tuple

try:
    import pyarrow.parquet as pq
except ModuleNotFoundError:
    print(
        "Missing dependency: pyarrow\n"
        "Install with: python3 -m pip install --user pyarrow",
        file=sys.stderr,
    )
    raise

try:
    from datasets import Dataset
except ModuleNotFoundError:
    print(
        "Missing dependency: datasets\n"
        "Install with: python3 -m pip install --user datasets",
        file=sys.stderr,
    )
    raise

DATASET_ID = "aplesner-eth/FLIP-Challenge"
TREE_URL = f"https://huggingface.co/api/datasets/{DATASET_ID}/tree/main?recursive=true"
RESOLVE_BASE = f"https://huggingface.co/datasets/{DATASET_ID}/resolve/main"

DEFAULT_PROMPT_TEMPLATE = (
    "You are solving an Idena FLIP validation challenge. "
    "There are four candidate panels for one flip. "
    "Two possible story orders are proposed.\n"
    "LEFT order: panels {left_order}.\n"
    "RIGHT order: panels {right_order}.\n"
    "If neither order tells a coherent story, or the flip should be reported, answer skip.\n"
    "Reply with exactly one lowercase word: left, right, or skip."
)


def fetch_json(url: str):
    with urllib.request.urlopen(url, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


def list_parquet_paths(split: str) -> List[str]:
    items = fetch_json(TREE_URL)
    paths = []
    for item in items:
        path = item.get("path", "")
        if not path.endswith(".parquet"):
            continue
        if split == "all":
            paths.append(path)
        elif f"/{split}-" in path:
            paths.append(path)
    return sorted(paths)


def download_file(url: str, dst: Path) -> None:
    if dst.exists() and dst.stat().st_size > 0:
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(url, timeout=120) as response, dst.open("wb") as fp:
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            fp.write(chunk)


def guess_extension(data: bytes) -> str:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if data.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if data.startswith(b"GIF87a") or data.startswith(b"GIF89a"):
        return ".gif"
    if len(data) >= 12 and data[0:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    return ".bin"


def sorted_slot_keys(images_map: Dict[str, str]) -> List[str]:
    def parse_key(value: str) -> Tuple[int, str]:
        try:
            return (int(value), value)
        except ValueError:
            return (10_000, value)

    return [k for _, k in sorted((parse_key(k) for k in images_map.keys()))]


def format_order(order: List[int]) -> str:
    return ", ".join(str(index + 1) for index in order)


def build_training_record(
    task_id: str,
    task_data: dict,
    image_bytes: Dict[str, bytes],
    images_dir: Path,
    prompt_template: str,
) -> dict:
    images_map = task_data.get("images") or {}
    if not isinstance(images_map, dict):
        raise ValueError(f"Invalid images map for {task_id}")

    slots = sorted_slot_keys(images_map)
    if len(slots) < 4:
        raise ValueError(f"Task {task_id} has less than 4 image slots")

    left_stack = [int(x) for x in task_data.get("left_stack", [])]
    right_stack = [int(x) for x in task_data.get("right_stack", [])]
    if not left_stack or not right_stack:
        raise ValueError(f"Task {task_id} has invalid stack order")

    agreed_answer = task_data.get("agreed_answer")
    expected_answer = None
    expected_strength = None
    if isinstance(agreed_answer, list) and agreed_answer:
        if len(agreed_answer) > 0 and isinstance(agreed_answer[0], str):
            normalized = agreed_answer[0].strip().lower()
            if normalized in ("left", "l"):
                expected_answer = "left"
            elif normalized in ("right", "r"):
                expected_answer = "right"
            elif normalized in ("report", "inappropriate", "skip"):
                expected_answer = "skip"
        if len(agreed_answer) > 1 and isinstance(agreed_answer[1], str):
            expected_strength = agreed_answer[1].strip()

    if not expected_answer:
        raise ValueError(f"Task {task_id} has no agreed answer")

    task_dir = images_dir / task_id
    task_dir.mkdir(parents=True, exist_ok=True)

    saved_images: List[str] = []
    for index, slot in enumerate(slots):
        image_id = images_map.get(slot)
        if image_id not in image_bytes:
            raise ValueError(f"Missing bytes for image_id={image_id} task={task_id}")
        raw = image_bytes[image_id]
        ext = guess_extension(raw)
        image_path = task_dir / f"{index + 1}{ext}"
        if not image_path.exists():
            image_path.write_bytes(raw)
        saved_images.append(str(image_path.resolve()))

    prompt = prompt_template.format(
        left_order=format_order(left_stack),
        right_order=format_order(right_stack),
    )

    return {
        "flip_hash": task_id,
        "images": saved_images,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "image"},
                    {"type": "image"},
                    {"type": "image"},
                    {"type": "image"},
                    {"type": "text", "text": prompt},
                ],
            },
            {
                "role": "assistant",
                "content": [{"type": "text", "text": expected_answer}],
            },
        ],
        "expected_answer": expected_answer,
        "expected_strength": expected_strength or "",
        "left_order": left_stack,
        "right_order": right_stack,
    }


def process_parquet_files(
    parquet_files: Iterable[Path],
    max_flips: int,
    skip_flips: int,
    images_dir: Path,
    prompt_template: str,
) -> Tuple[List[dict], int]:
    tasks: Dict[str, dict] = {}
    completed: List[dict] = []
    malformed = 0
    produced = 0

    for parquet_path in parquet_files:
        parquet = pq.ParquetFile(parquet_path)
        for batch in parquet.iter_batches(
            batch_size=512, columns=["task_id", "task_data", "image_id", "image"]
        ):
            for row in batch.to_pylist():
                task_id = row.get("task_id")
                if not task_id:
                    malformed += 1
                    continue

                record = tasks.get(task_id)
                if record is None:
                    try:
                        task_data = json.loads(row.get("task_data") or "{}")
                    except json.JSONDecodeError:
                        malformed += 1
                        continue

                    record = {"task_data": task_data, "image_bytes": {}}
                    tasks[task_id] = record

                image_id = row.get("image_id")
                image_obj = row.get("image") or {}
                bytes_value = image_obj.get("bytes") if isinstance(image_obj, dict) else None
                if image_id and isinstance(bytes_value, (bytes, bytearray)):
                    record["image_bytes"][image_id] = bytes(bytes_value)

                images_map = (record["task_data"] or {}).get("images") or {}
                if not isinstance(images_map, dict) or not images_map:
                    continue

                needed = set(images_map.values())
                if needed and needed.issubset(record["image_bytes"].keys()):
                    try:
                        flip = build_training_record(
                            task_id,
                            record["task_data"],
                            record["image_bytes"],
                            images_dir,
                            prompt_template,
                        )
                        if produced >= skip_flips:
                            completed.append(flip)
                        produced += 1
                    except Exception:
                        malformed += 1
                    del tasks[task_id]

                    if len(completed) >= max_flips:
                        return completed, malformed

    return completed, malformed


def write_jsonl(path: Path, rows: List[dict]) -> None:
    with path.open("w", encoding="utf-8") as fp:
        for row in rows:
            fp.write(json.dumps(row, ensure_ascii=False))
            fp.write("\n")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Prepare FLIP-Challenge as a local MLX-VLM LoRA dataset"
    )
    parser.add_argument(
        "--split",
        choices=["train", "validation", "test", "all"],
        default="train",
        help="dataset split to use for output (default: train)",
    )
    parser.add_argument(
        "--max-flips",
        type=int,
        default=500,
        help="maximum number of completed flips to export (default: 500)",
    )
    parser.add_argument(
        "--skip-flips",
        type=int,
        default=0,
        help="number of completed flips to skip before export (default: 0)",
    )
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=Path(".tmp/flip-challenge"),
        help="where parquet files are cached (default: .tmp/flip-challenge)",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        required=True,
        help="output directory for the prepared training dataset",
    )
    parser.add_argument(
        "--prompt-template",
        type=str,
        default=DEFAULT_PROMPT_TEMPLATE,
        help="prompt template used for each training example",
    )
    args = parser.parse_args()

    if args.max_flips < 1:
        print("--max-flips must be >= 1", file=sys.stderr)
        return 2
    if args.skip_flips < 0:
        print("--skip-flips must be >= 0", file=sys.stderr)
        return 2

    parquet_paths = list_parquet_paths(args.split)
    if not parquet_paths:
        print(f"No parquet files found for split={args.split}", file=sys.stderr)
        return 1

    output_dir = args.output_dir.resolve()
    images_dir = output_dir / "images"
    hf_dataset_dir = output_dir / "hf-dataset"
    jsonl_path = output_dir / "train.jsonl"
    manifest_path = output_dir / "manifest.json"
    output_dir.mkdir(parents=True, exist_ok=True)

    local_files: List[Path] = []
    for rel_path in parquet_paths:
        url = f"{RESOLVE_BASE}/{rel_path}"
        local = args.cache_dir / rel_path
        print(f"Downloading (if needed): {rel_path}")
        download_file(url, local)
        local_files.append(local)

    print(f"Processing split={args.split} max={args.max_flips} skip={args.skip_flips}")
    records, malformed = process_parquet_files(
        local_files,
        args.max_flips,
        args.skip_flips,
        images_dir,
        args.prompt_template,
    )

    if not records:
        print("No completed flips were produced", file=sys.stderr)
        return 1

    dataset = Dataset.from_list(records)
    dataset.save_to_disk(str(hf_dataset_dir))
    write_jsonl(jsonl_path, records)

    counts_by_answer: Dict[str, int] = {}
    for item in records:
        answer = item["expected_answer"]
        counts_by_answer[answer] = counts_by_answer.get(answer, 0) + 1

    manifest = {
        "source": DATASET_ID,
        "split": args.split,
        "count": len(records),
        "skip": args.skip_flips,
        "max": args.max_flips,
        "malformedRows": malformed,
        "countsByAnswer": counts_by_answer,
        "hfDatasetPath": str(hf_dataset_dir),
        "jsonlPath": str(jsonl_path),
        "imagesPath": str(images_dir),
    }
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print(
        json.dumps(
            {
                "ok": True,
                "count": len(records),
                "hfDatasetPath": str(hf_dataset_dir),
                "jsonlPath": str(jsonl_path),
                "manifestPath": str(manifest_path),
                "countsByAnswer": counts_by_answer,
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
