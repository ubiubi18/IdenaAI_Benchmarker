#!/usr/bin/env python3
"""
Preload idena-desktop AI test unit queue from decoded/import JSON files.

Input supported:
- {"flips":[{hash,images,orders}, ...]}    (decoded format)
- {"flips":[{hash,leftImage,rightImage}, ...]}  (ai-ready format)
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import random
import time
from pathlib import Path
from typing import Iterable, List, Optional

from PIL import Image


def decode_data_url(data_url: str) -> bytes:
    if not data_url.startswith("data:") or "," not in data_url:
        raise ValueError("Expected data URL")
    _, payload = data_url.split(",", 1)
    return base64.b64decode(payload)


def image_to_data_url_png(image: Image.Image) -> str:
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    encoded = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def draw_contain(image: Image.Image, width: int, height: int) -> Image.Image:
    src = image.convert("RGB")
    ratio = min(width / src.width, height / src.height)
    draw_w = max(1, int(src.width * ratio))
    draw_h = max(1, int(src.height * ratio))
    resized = src.resize((draw_w, draw_h), Image.LANCZOS)
    frame = Image.new("RGB", (width, height), (0, 0, 0))
    offset = ((width - draw_w) // 2, (height - draw_h) // 2)
    frame.paste(resized, offset)
    return frame


def compose_story_image(images: List[str], order: List[int]) -> str:
    ordered_sources = [images[i] for i in order if 0 <= i < len(images)]
    if not ordered_sources:
        raise ValueError("No ordered images")

    frame_w, frame_h = 512, 384
    canvas = Image.new("RGB", (frame_w, frame_h * len(ordered_sources)), (0, 0, 0))

    for idx, source in enumerate(ordered_sources):
        data = decode_data_url(source)
        with Image.open(io.BytesIO(data)) as img:
            frame = draw_contain(img, frame_w, frame_h)
        canvas.paste(frame, (0, frame_h * idx))

    return image_to_data_url_png(canvas)


def normalize_expected_answer(value: Optional[str]) -> Optional[str]:
    raw = str(value or "").strip().lower()
    if not raw:
        return None
    if raw in ("left", "l"):
        return "left"
    if raw in ("right", "r"):
        return "right"
    if raw in ("skip", "report", "inappropriate"):
        return "skip"
    return None


def normalize_flip(item: dict, index: int) -> dict:
    hash_value = str(item.get("hash") or f"imported-{index}").strip()
    expected_answer = normalize_expected_answer(item.get("expectedAnswer"))
    expected_strength = str(item.get("expectedStrength") or "").strip() or None

    if item.get("leftImage") and item.get("rightImage"):
        result = {
            "hash": hash_value,
            "leftImage": str(item["leftImage"]),
            "rightImage": str(item["rightImage"]),
        }
        if expected_answer:
            result["expectedAnswer"] = expected_answer
        if expected_strength:
            result["expectedStrength"] = expected_strength
        return result

    images = item.get("images")
    orders = item.get("orders")
    if not isinstance(images, list) or not isinstance(orders, list) or len(orders) < 2:
        raise ValueError("Flip must contain either left/right images or decoded images/orders")

    left_order = orders[0] if isinstance(orders[0], list) else []
    right_order = orders[1] if isinstance(orders[1], list) else []

    left_image = compose_story_image(images, [int(x) for x in left_order])
    right_image = compose_story_image(images, [int(x) for x in right_order])

    result = {
        "hash": hash_value,
        "leftImage": left_image,
        "rightImage": right_image,
    }
    if expected_answer:
        result["expectedAnswer"] = expected_answer
    if expected_strength:
        result["expectedStrength"] = expected_strength
    return result


def load_flips(path: Path) -> List[dict]:
    with path.open("r", encoding="utf-8") as fp:
        raw = json.load(fp)

    if isinstance(raw, list):
        flips = raw
    elif isinstance(raw, dict) and isinstance(raw.get("flips"), list):
        flips = raw["flips"]
    else:
        raise ValueError(f"Unsupported JSON structure in {path}")

    result = []
    for idx, item in enumerate(flips):
        result.append(normalize_flip(item, idx))
    return result


def ensure_queue(path: Path) -> List[dict]:
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8") as fp:
        obj = json.load(fp)
    return obj if isinstance(obj, list) else []


def queue_entry(flip: dict, source: str) -> dict:
    now_ms = int(time.time() * 1000)
    entry = {
        "id": f"{now_ms}-{random.randint(100000, 999999)}",
        "source": source,
        "addedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "hash": flip["hash"],
        "leftImage": flip["leftImage"],
        "rightImage": flip["rightImage"],
        "meta": {"importedBy": "preload_ai_test_unit_queue.py"},
    }
    if flip.get("expectedAnswer"):
        entry["expectedAnswer"] = flip["expectedAnswer"]
    if flip.get("expectedStrength"):
        entry["expectedStrength"] = flip["expectedStrength"]
    return entry


def main() -> int:
    parser = argparse.ArgumentParser(description="Preload AI test unit queue")
    parser.add_argument("--input", nargs="+", required=True, help="input JSON file(s)")
    parser.add_argument(
        "--queue-path",
        default=str(Path.home() / "Library/Application Support/Idena/ai-benchmark/test-unit-flips.json"),
        help="queue file path",
    )
    parser.add_argument("--source", default="flip-challenge-import", help="queue source label")
    parser.add_argument(
        "--replace",
        action="store_true",
        help="replace existing queue instead of appending",
    )
    parser.add_argument(
        "--max-total",
        type=int,
        default=0,
        help="max flips to add across all inputs (0 = unlimited)",
    )
    args = parser.parse_args()

    queue_path = Path(args.queue_path)
    queue_path.parent.mkdir(parents=True, exist_ok=True)
    queue = [] if args.replace else ensure_queue(queue_path)

    added = 0
    for input_path in [Path(p) for p in args.input]:
        flips = load_flips(input_path)
        for flip in flips:
            queue.append(queue_entry(flip, args.source))
            added += 1
            if args.max_total > 0 and added >= args.max_total:
                break
        print(f"Loaded {min(len(flips), added)} from {input_path}")
        if args.max_total > 0 and added >= args.max_total:
            break

    with queue_path.open("w", encoding="utf-8") as fp:
        json.dump(queue, fp, ensure_ascii=False, indent=2)

    print(f"Queue path: {queue_path}")
    print(f"Queue size: {len(queue)}")
    print(f"Added now: {added}")
    print("In app: click 'Reload queue' in Settings -> AI Test Unit")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
