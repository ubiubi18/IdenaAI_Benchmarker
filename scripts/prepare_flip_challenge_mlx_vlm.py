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
from io import BytesIO
from pathlib import Path
from typing import Dict, Iterable, List, Tuple

from flip_training_ranker import build_historical_signals

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

try:
    from PIL import Image, ImageOps
except ModuleNotFoundError:
    print(
        "Missing dependency: pillow\n"
        "Install with: python3 -m pip install --user pillow",
        file=sys.stderr,
    )
    raise

DATASET_ID = "aplesner-eth/FLIP-Challenge"
TREE_URL = f"https://huggingface.co/api/datasets/{DATASET_ID}/tree/main?recursive=true"
RESOLVE_BASE = f"https://huggingface.co/datasets/{DATASET_ID}/resolve/main"

DEFAULT_PROMPT_TEMPLATE = (
    "You are solving an Idena FLIP validation challenge. "
    "There are four candidate panels for one flip shown in a single 2x2 composite image. "
    "Panel 1 is top-left, panel 2 is top-right, panel 3 is bottom-left, and panel 4 is bottom-right. "
    "Two possible story orders are proposed.\n"
    "LEFT order: panels {left_order}.\n"
    "RIGHT order: panels {right_order}.\n"
    "If neither order tells a coherent story, or the flip should be reported, answer skip.\n"
    "Reply with exactly one lowercase word: left, right, or skip."
)
COMPOSITE_MAX_SIZE = (448, 448)


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


def load_panel_image(raw: bytes) -> Image.Image:
    image = Image.open(BytesIO(raw))
    image = ImageOps.exif_transpose(image)
    return image.convert("RGB")


def resize_to_fit(image: Image.Image, size: Tuple[int, int]) -> Image.Image:
    resized = image.copy()
    resized.thumbnail(size, Image.Resampling.LANCZOS)
    return resized


def build_flip_composite(raw_panels: List[bytes]) -> Image.Image:
    panels = [load_panel_image(raw) for raw in raw_panels]
    cell_width = max(image.width for image in panels)
    cell_height = max(image.height for image in panels)
    canvas = Image.new("RGB", (cell_width * 2, cell_height * 2), "white")

    for index, image in enumerate(panels[:4]):
        fitted = resize_to_fit(image, (cell_width, cell_height))
        row, column = divmod(index, 2)
        x = column * cell_width + (cell_width - fitted.width) // 2
        y = row * cell_height + (cell_height - fitted.height) // 2
        canvas.paste(fitted, (x, y))

    return resize_to_fit(canvas, COMPOSITE_MAX_SIZE)


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
    panel_bytes: List[bytes] = []
    for index, slot in enumerate(slots):
        image_id = images_map.get(slot)
        if image_id not in image_bytes:
            raise ValueError(f"Missing bytes for image_id={image_id} task={task_id}")
        raw = image_bytes[image_id]
        panel_bytes.append(raw)
        ext = guess_extension(raw)
        image_path = task_dir / f"{index + 1}{ext}"
        if not image_path.exists():
            image_path.write_bytes(raw)
        saved_images.append(str(image_path.resolve()))

    composite_path = task_dir / "composite.png"
    if not composite_path.exists():
        build_flip_composite(panel_bytes).save(composite_path, format="PNG")

    prompt = prompt_template.format(
        left_order=format_order(left_stack),
        right_order=format_order(right_stack),
    )
    ranking = build_historical_signals(task_id, task_data)

    return {
        "schema_version": "idena.flip-training.v1",
        "flip_hash": task_id,
        "images": [str(composite_path.resolve())],
        "panel_images": saved_images,
        "messages": [
            {
                "role": "user",
                "content": [
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
        "training_weight": ranking.training_weight,
        "ranking_source": ranking.ranking_source,
        "source": {
            "kind": ranking.source_kind,
            "name": ranking.source_name,
            "priority": ranking.source_priority,
        },
        "audit": ranking.to_dict(),
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
    ranking_sources: Dict[str, int] = {}
    training_weights: List[float] = []
    for item in records:
        answer = item["expected_answer"]
        counts_by_answer[answer] = counts_by_answer.get(answer, 0) + 1
        ranking_source = item.get("ranking_source") or "unknown"
        ranking_sources[ranking_source] = ranking_sources.get(ranking_source, 0) + 1
        try:
            training_weights.append(float(item.get("training_weight", 1.0) or 1.0))
        except (TypeError, ValueError):
            training_weights.append(1.0)

    training_weight_summary = {
        "min": round(min(training_weights), 6),
        "max": round(max(training_weights), 6),
        "mean": round(sum(training_weights) / len(training_weights), 6),
    }

    manifest = {
        "schemaVersion": "idena.flip-training.v1",
        "source": DATASET_ID,
        "split": args.split,
        "count": len(records),
        "skip": args.skip_flips,
        "max": args.max_flips,
        "malformedRows": malformed,
        "countsByAnswer": counts_by_answer,
        "rankingSources": ranking_sources,
        "trainingWeight": training_weight_summary,
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
