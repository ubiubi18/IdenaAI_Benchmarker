#!/usr/bin/env python3
"""
Convert Hugging Face FLIP-Challenge parquet rows into idena-desktop AI test-unit JSON.

Output format matches renderer JSON ingest path:
{
  "flips": [
    {
      "hash": "...",
      "images": ["data:image/...;base64,...", ... 4 items],
      "orders": [[...], [...]]
    }
  ]
}
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import tempfile
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

DATASET_ID = "aplesner-eth/FLIP-Challenge"
TREE_URL = f"https://huggingface.co/api/datasets/{DATASET_ID}/tree/main?recursive=true"
RESOLVE_BASE = f"https://huggingface.co/datasets/{DATASET_ID}/resolve/main"


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


def is_valid_cached_download(path: Path) -> bool:
    if not path.exists() or path.stat().st_size <= 0:
        return False

    if path.suffix != ".parquet":
        return True

    if path.stat().st_size < 8:
        return False

    with path.open("rb") as fp:
        fp.seek(-4, os.SEEK_END)
        return fp.read(4) == b"PAR1"


def download_file(url: str, dst: Path) -> None:
    if is_valid_cached_download(dst):
        return

    dst.parent.mkdir(parents=True, exist_ok=True)
    temp_path = None

    try:
        with tempfile.NamedTemporaryFile(
            mode="wb", delete=False, dir=dst.parent, prefix=f".{dst.name}.", suffix=".tmp"
        ) as tmp_fp:
            temp_path = Path(tmp_fp.name)
            with urllib.request.urlopen(url, timeout=120) as response:
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    tmp_fp.write(chunk)

        if not is_valid_cached_download(temp_path):
            raise RuntimeError(f"Incomplete download for {dst.name}")

        os.replace(temp_path, dst)
    finally:
        if temp_path and temp_path.exists():
            temp_path.unlink(missing_ok=True)


def guess_mime(data: bytes) -> str:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"GIF87a") or data.startswith(b"GIF89a"):
        return "image/gif"
    if len(data) >= 12 and data[0:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return "application/octet-stream"


def to_data_url(data: bytes) -> str:
    mime = guess_mime(data)
    encoded = base64.b64encode(data).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def sorted_slot_keys(images_map: Dict[str, str]) -> List[str]:
    def parse_key(value: str) -> Tuple[int, str]:
        try:
            return (int(value), value)
        except ValueError:
            return (10_000, value)

    return [k for _, k in sorted((parse_key(k) for k in images_map.keys()))]


def build_flip(task_id: str, task_data: dict, image_bytes: Dict[str, bytes]) -> dict:
    images_map = task_data.get("images") or {}
    if not isinstance(images_map, dict):
        raise ValueError(f"Invalid images map for {task_id}")

    slots = sorted_slot_keys(images_map)
    if len(slots) < 4:
        raise ValueError(f"Task {task_id} has less than 4 image slots")

    ordered_images: List[str] = []
    for slot in slots:
        image_id = images_map.get(slot)
        if image_id not in image_bytes:
            raise ValueError(f"Missing bytes for image_id={image_id} task={task_id}")
        ordered_images.append(to_data_url(image_bytes[image_id]))

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

    result = {
        "hash": task_id,
        "images": ordered_images,
        "orders": [left_stack, right_stack],
    }
    if expected_answer:
        result["expectedAnswer"] = expected_answer
    if expected_strength:
        result["expectedStrength"] = expected_strength
    return result


def process_parquet_files(
    parquet_files: Iterable[Path], max_flips: int, skip_flips: int
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
                        flip = build_flip(task_id, record["task_data"], record["image_bytes"])
                        if produced >= skip_flips:
                            completed.append(flip)
                        produced += 1
                    except Exception:
                        malformed += 1
                    del tasks[task_id]

                    if len(completed) >= max_flips:
                        return completed, malformed

    return completed, malformed


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Import FLIP-Challenge dataset into idena-desktop test-unit JSON"
    )
    parser.add_argument(
        "--split",
        choices=["train", "validation", "test", "all"],
        default="test",
        help="dataset split to use (default: test)",
    )
    parser.add_argument(
        "--max-flips",
        type=int,
        default=200,
        help="maximum number of completed flips to export (default: 200)",
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
        "--output",
        type=Path,
        default=None,
        help="output json file path",
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

    local_files: List[Path] = []
    for rel_path in parquet_paths:
        url = f"{RESOLVE_BASE}/{rel_path}"
        local = args.cache_dir / rel_path
        print(f"Downloading (if needed): {rel_path}")
        download_file(url, local)
        local_files.append(local)

    print("Converting rows...")
    flips, malformed = process_parquet_files(
        local_files, args.max_flips, args.skip_flips
    )
    if not flips:
        print("No flips were converted", file=sys.stderr)
        return 1

    output_path = (
        args.output
        if args.output
        else Path("data")
        / f"flip-challenge-{args.split}-{len(flips)}-decoded.json"
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)

    payload = {
        "source": DATASET_ID,
        "split": args.split,
        "count": len(flips),
        "skip": args.skip_flips,
        "flips": flips,
        "malformedRows": malformed,
    }

    with output_path.open("w", encoding="utf-8") as fp:
        json.dump(payload, fp, ensure_ascii=False)

    print(f"Saved: {output_path}")
    print(f"Flips: {len(flips)}")
    print(f"Malformed rows skipped: {malformed}")
    print("Import this file in app: Settings -> AI Test Unit -> Load JSON file")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
