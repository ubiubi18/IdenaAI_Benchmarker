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
import re
import sys
import tempfile
import urllib.request
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

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
DEFAULT_PUBLIC_INDEXER_URL = "https://api.idena.io/api"


def fetch_json(url: str):
    with urllib.request.urlopen(url, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


def trim_text(value: Any) -> str:
    return str(value or "").strip()


def safe_int(value: Any, default: int = 0) -> int:
    try:
        if value is None or value == "":
            return default
        return int(value)
    except Exception:
        return default


def safe_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None or value == "":
            return default
        return float(value)
    except Exception:
        return default


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


def normalize_epoch_from_details(details: Any) -> Optional[int]:
    if not isinstance(details, dict):
        return None

    raw_epoch = trim_text(details.get("Epoch:") or details.get("epoch"))
    if not raw_epoch:
        return None

    match = re.search(r"(\d+)", raw_epoch)
    if not match:
        return None

    return safe_int(match.group(1), 0) or None


def normalize_details_record(details: Any) -> Dict[str, Any]:
    source = details if isinstance(details, dict) else {}
    block = trim_text(source.get("Block:") or source.get("block"))
    return {
        "author": trim_text(source.get("Author:") or source.get("author")) or None,
        "epoch": normalize_epoch_from_details(source),
        "size": trim_text(source.get("Size:") or source.get("size")) or None,
        "createdAt": trim_text(source.get("Created:") or source.get("created")) or None,
        "block": safe_int(block, 0) or block or None,
        "tx": trim_text(source.get("Tx:") or source.get("tx")) or None,
    }


def normalize_public_words(value: Any) -> List[Dict[str, str]]:
    words = value if isinstance(value, dict) else {}
    items = []

    for key in ("word1", "word2"):
        entry = words.get(key) if isinstance(words.get(key), dict) else {}
        name = trim_text(entry.get("name"))
        desc = trim_text(entry.get("desc"))
        if name or desc:
            items.append({"name": name, "desc": desc})

    return items[:2]


def normalize_public_flip_entry(value: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(value, dict):
        return None

    cid = trim_text(value.get("cid"))
    if not cid:
        return None

    return {
        "cid": cid,
        "author": trim_text(value.get("author")) or None,
        "epoch": safe_int(value.get("epoch"), 0) or None,
        "shortRespCount": safe_int(value.get("shortRespCount")),
        "longRespCount": safe_int(value.get("longRespCount")),
        "status": trim_text(value.get("status")) or None,
        "answer": trim_text(value.get("answer")) or None,
        "wrongWords": bool(value.get("wrongWords")),
        "wrongWordsVotes": safe_int(value.get("wrongWordsVotes")),
        "withPrivatePart": bool(value.get("withPrivatePart")),
        "grade": safe_int(value.get("grade"), 0) if value.get("grade") is not None else None,
        "gradeScore": safe_float(value.get("gradeScore"), 0.0)
        if value.get("gradeScore") is not None
        else None,
        "timestamp": trim_text(value.get("timestamp")) or None,
        "words": normalize_public_words(value.get("words")),
    }


class PublicIndexerCache:
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")
        self.epoch_entries: Dict[int, Dict[str, Dict[str, Any]]] = {}

    def get_epoch_entries(self, epoch: int) -> Dict[str, Dict[str, Any]]:
        if epoch in self.epoch_entries:
            return self.epoch_entries[epoch]

        entries: Dict[str, Dict[str, Any]] = {}
        continuation_token = None

        while True:
            query = f"limit=100{f'&continuationToken={continuation_token}' if continuation_token else ''}"
            url = f"{self.base_url}/Epoch/{epoch}/Flips?{query}"
            payload = fetch_json(url)
            items = payload.get("result") or []

            for item in items:
                normalized = normalize_public_flip_entry(item)
                if normalized:
                    entries[normalized["cid"]] = normalized

            continuation_token = trim_text(payload.get("continuationToken"))
            if not continuation_token:
                break

        self.epoch_entries[epoch] = entries
        print(f"Indexed public flip metadata for epoch {epoch}: {len(entries)} flips")
        return entries

    def get_flip(self, task_id: str, task_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        details = normalize_details_record(task_data.get("details"))
        epoch = details.get("epoch")
        if not epoch:
            return None

        cid = trim_text(task_id)
        if cid.startswith("_flip_"):
            cid = cid[len("_flip_") :]
        if not cid:
            return None

        return self.get_epoch_entries(epoch).get(cid)


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


def build_flip(
    task_id: str,
    task_data: dict,
    image_bytes: Dict[str, bytes],
    *,
    split: str,
    public_entry: Optional[Dict[str, Any]] = None,
) -> dict:
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
    votes = task_data.get("votes") or {}
    consensus_votes = None
    if isinstance(votes, dict):
        try:
            left_votes = int(votes.get("Left") or votes.get("left") or 0)
        except (TypeError, ValueError):
            left_votes = 0
        try:
            right_votes = int(votes.get("Right") or votes.get("right") or 0)
        except (TypeError, ValueError):
            right_votes = 0
        try:
            reported_votes = int(
                votes.get("Reported")
                or votes.get("reported")
                or votes.get("skip")
                or votes.get("inappropriate")
                or 0
            )
        except (TypeError, ValueError):
            reported_votes = 0
        total_votes = left_votes + right_votes + reported_votes
        if total_votes > 0:
            consensus_votes = {
                "left": left_votes,
                "right": right_votes,
                "reported": reported_votes,
                "total": total_votes,
            }

    result = {
        "hash": task_id,
        "images": ordered_images,
        "orders": [left_stack, right_stack],
        "sourceDataset": DATASET_ID,
        "sourceSplit": split,
    }
    if expected_answer:
        result["expectedAnswer"] = expected_answer
        result["consensusAnswer"] = expected_answer
    if expected_strength:
        result["expectedStrength"] = expected_strength
        result["consensusStrength"] = expected_strength
    if consensus_votes:
        result["consensusVotes"] = consensus_votes

    details = normalize_details_record(task_data.get("details"))
    public_words = (
        list(public_entry.get("words") or [])
        if isinstance(public_entry, dict)
        else []
    )
    if public_words:
        result["words"] = public_words

    source_stats = {
        "epoch": (public_entry or {}).get("epoch") or details.get("epoch"),
        "author": (public_entry or {}).get("author") or details.get("author"),
        "status": (public_entry or {}).get("status"),
        "shortRespCount": (public_entry or {}).get("shortRespCount"),
        "longRespCount": (public_entry or {}).get("longRespCount"),
        "wrongWords": (public_entry or {}).get("wrongWords"),
        "wrongWordsVotes": (public_entry or {}).get("wrongWordsVotes"),
        "withPrivatePart": (public_entry or {}).get("withPrivatePart"),
        "grade": (public_entry or {}).get("grade"),
        "gradeScore": (public_entry or {}).get("gradeScore"),
        "createdAt": details.get("createdAt"),
        "block": details.get("block"),
        "tx": details.get("tx"),
    }
    normalized_source_stats = {
        key: value
        for key, value in source_stats.items()
        if value not in (None, "", [])
    }
    if normalized_source_stats:
        result["sourceStats"] = normalized_source_stats

    return result


def process_parquet_files(
    parquet_files: Iterable[Path],
    *,
    split: str,
    max_flips: int,
    skip_flips: int,
    public_indexer_cache: Optional[PublicIndexerCache],
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
                        flip = build_flip(
                            task_id,
                            record["task_data"],
                            record["image_bytes"],
                            split=split,
                            public_entry=public_indexer_cache.get_flip(
                                task_id, record["task_data"]
                            )
                            if public_indexer_cache
                            else None,
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


def write_output_payload(output_path: Path, payload: Dict[str, Any], chunk_size: int) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)

    flips = list(payload.get("flips") or [])
    if chunk_size > 0 and len(flips) > chunk_size:
        part_entries = []
        for index in range(0, len(flips), chunk_size):
            part_number = (index // chunk_size) + 1
            part_flips = flips[index : index + chunk_size]
            part_path = output_path.with_name(
                f"{output_path.stem}.part-{part_number}{output_path.suffix}"
            )
            with part_path.open("w", encoding="utf-8") as fp:
                json.dump(
                    {
                        "source": payload.get("source"),
                        "split": payload.get("split"),
                        "count": len(part_flips),
                        "skip": payload.get("skip"),
                        "flips": part_flips,
                        "malformedRows": payload.get("malformedRows"),
                    },
                    fp,
                    ensure_ascii=False,
                )
            part_entries.append({"file": part_path.name, "count": len(part_flips)})

        manifest = {
            key: value
            for key, value in payload.items()
            if key != "flips"
        }
        manifest["parts"] = part_entries

        with output_path.open("w", encoding="utf-8") as fp:
            json.dump(manifest, fp, ensure_ascii=False)
        return

    with output_path.open("w", encoding="utf-8") as fp:
        json.dump(payload, fp, ensure_ascii=False)


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
    parser.add_argument(
        "--public-indexer-url",
        default=DEFAULT_PUBLIC_INDEXER_URL,
        help="public Idena indexer API base URL for keyword/stat enrichment",
    )
    parser.add_argument(
        "--disable-public-indexer-enrichment",
        action="store_true",
        help="disable public Idena indexer enrichment for keywords and flip stats",
    )
    parser.add_argument(
        "--chunk-size",
        type=int,
        default=0,
        help="optional number of flips per output part file when writing large exports",
    )
    args = parser.parse_args()

    if args.max_flips < 1:
        print("--max-flips must be >= 1", file=sys.stderr)
        return 2
    if args.skip_flips < 0:
        print("--skip-flips must be >= 0", file=sys.stderr)
        return 2
    if args.chunk_size < 0:
        print("--chunk-size must be >= 0", file=sys.stderr)
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
    public_indexer_cache = (
        None
        if args.disable_public_indexer_enrichment
        else PublicIndexerCache(args.public_indexer_url)
    )
    flips, malformed = process_parquet_files(
        local_files,
        split=args.split,
        max_flips=args.max_flips,
        skip_flips=args.skip_flips,
        public_indexer_cache=public_indexer_cache,
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
    payload = {
        "source": DATASET_ID,
        "split": args.split,
        "count": len(flips),
        "skip": args.skip_flips,
        "flips": flips,
        "malformedRows": malformed,
    }

    write_output_payload(output_path, payload, args.chunk_size)

    print(f"Saved: {output_path}")
    print(f"Flips: {len(flips)}")
    print(f"Malformed rows skipped: {malformed}")
    print("Import this file in app: Settings -> AI Test Unit -> Load JSON file")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
