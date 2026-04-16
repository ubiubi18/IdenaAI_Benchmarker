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
import copy
import json
import os
import sys
import tempfile
import urllib.request
from io import BytesIO
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

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
    from PIL import Image, ImageDraw, ImageFont, ImageOps
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

DEFAULT_COMPOSITE_PROMPT_TEMPLATE = (
    "You are solving an Idena FLIP validation challenge. "
    "There are four candidate panels for one flip shown in a single 2x2 composite image. "
    "Panel 1 is top-left, panel 2 is top-right, panel 3 is bottom-left, and panel 4 is bottom-right. "
    "Two possible story orders are proposed.\n"
    "The first shown candidate is OPTION {first_candidate_label}: panels {first_candidate_order}.\n"
    "The second shown candidate is OPTION {second_candidate_label}: panels {second_candidate_order}.\n"
    "Important:\n"
    "- Candidate labels are randomized and the first shown candidate changes across examples. Do not use label identity or position as a hint.\n"
    "Required thinking steps:\n"
    "1) Inspect each panel separately and mentally caption the actors, action, and visible state.\n"
    '2) If any readable text appears, transcribe it as TEXT:\"...\" and translate it to English if needed.\n'
    "3) Mentally simulate OPTION A and OPTION B as chronological stories.\n"
    "4) Choose the option with the clearest causal chain and most consistent entity progression.\n"
    "Reportability rules:\n"
    "- If solving clearly requires reading text, treat the flip as report-worthy.\n"
    "- If visible order labels, letters, numbers, arrows, captions, or sequence markers are drawn on the images, treat the flip as report-worthy.\n"
    "- If inappropriate, NSFW, or graphic violent content is present, treat the flip as report-worthy.\n"
    "If neither order tells a coherent story, or the flip should be reported, answer skip.\n"
    "Reply with exactly one lowercase token: a, b, or skip."
)
DEFAULT_NATIVE_FRAMES_PROMPT_TEMPLATE = (
    "You are solving an Idena FLIP validation challenge. "
    "You are given eight native frame images in order.\n"
    "Images 1-4 belong to the first shown candidate: OPTION {first_candidate_label} in temporal order.\n"
    "Images 5-8 belong to the second shown candidate: OPTION {second_candidate_label} in temporal order.\n"
    "Important:\n"
    "- Candidate labels are randomized and the first shown candidate changes across examples. Do not use label identity, order, or first-vs-second position as a hint.\n"
    "Required thinking steps:\n"
    "1) Inspect each frame separately and mentally caption the main actors, actions, and visible state changes.\n"
    '2) If any readable text appears, transcribe it as TEXT:\"...\" and translate it to English if needed.\n'
    "3) Build one short story summary for OPTION A and one for OPTION B.\n"
    "4) Compare coherence using common-sense chronology, visible cause -> effect links, and consistent entities across frames.\n"
    "Reportability rules:\n"
    "- If solving clearly requires reading text, treat the flip as report-worthy.\n"
    "- If visible order labels, letters, numbers, arrows, captions, or sequence markers are drawn on the images, treat the flip as report-worthy.\n"
    "- If inappropriate, NSFW, or graphic violent content is present, treat the flip as report-worthy.\n"
    "Choose the more coherent chronological story.\n"
    "If neither story tells a coherent story, or the flip should be reported, answer skip.\n"
    "Reply with exactly one lowercase token: a, b, or skip."
)
STRUCTURED_COMPARE_NATIVE_FRAMES_PROMPT_TEMPLATE = (
    "You are solving an Idena FLIP validation challenge. "
    "You are given eight native frame images in order.\n"
    "Images 1-4 belong to the first shown candidate: OPTION {first_candidate_label} in temporal order.\n"
    "Images 5-8 belong to the second shown candidate: OPTION {second_candidate_label} in temporal order.\n"
    "Important:\n"
    "- Candidate labels are randomized across examples. OPTION A or OPTION B may be shown first. Do not use label identity or first-vs-second position as a hint.\n"
    "- Your answer token refers to candidate identity, not position. If OPTION B is better, answer b even when it is shown first.\n"
    "Required thinking steps:\n"
    "1) Inspect every frame separately and identify the main actors, action, and visible state.\n"
    '2) If readable text exists, transcribe it as TEXT:\"...\" and translate it to English if needed.\n'
    "3) Build one short factual story summary for OPTION A and one for OPTION B.\n"
    "4) Score both candidates independently using chronology (0-40), entityConsistency (0-30), and causality (0-30).\n"
    "5) Compare the totals and choose the stronger candidate only if the advantage is clear.\n"
    "Reportability rules:\n"
    "- If solving clearly requires reading text, answer skip.\n"
    "- If visible order labels, letters, numbers, arrows, captions, or sequence markers are drawn on the images, answer skip.\n"
    "- If inappropriate, NSFW, or graphic violent content is present, answer skip.\n"
    "Return JSON only with this exact schema:\n"
    '{{"optionA":{{"story":"...","chronology":0,"entityConsistency":0,"causality":0}},'
    '"optionB":{{"story":"...","chronology":0,"entityConsistency":0,"causality":0}},'
    '"textRequired":false,"sequenceMarkersPresent":false,"inappropriateContent":false,'
    '"answer":"a|b|skip"}}'
)
CANDIDATE_ANALYSIS_NATIVE_FRAMES_PROMPT_TEMPLATE = (
    "You are solving an Idena FLIP validation challenge. "
    "You are given four native frame images in temporal order for one candidate story.\n"
    "Required thinking steps:\n"
    "1) Inspect every frame separately and identify the main actors, action, and visible state.\n"
    '2) If readable text exists, transcribe it as TEXT:\"...\" and translate it to English if needed.\n'
    "3) Build one short factual story summary for this candidate only.\n"
    "4) Score this candidate independently using chronology (0-40), entityConsistency (0-30), and causality (0-30).\n"
    "5) If the candidate is report-worthy or depends on visible text or sequence markers, mark that explicitly.\n"
    "Return JSON only with this exact schema:\n"
    '{{"story":"...","chronology":0,"entityConsistency":0,"causality":0,'
    '"textRequired":false,"sequenceMarkersPresent":false,"inappropriateContent":false,'
    '"quality":"strong|weak|invalid"}}'
)
CANDIDATE_LABEL_NATIVE_FRAMES_PROMPT_TEMPLATE = (
    "You are solving an Idena FLIP validation challenge. "
    "You are given four native frame images in temporal order for one candidate story.\n"
    "Required thinking steps:\n"
    "1) Inspect every frame separately and identify the main actors, action, and visible state.\n"
    '2) If readable text exists, transcribe it as TEXT:\"...\" and translate it to English if needed.\n'
    "3) Decide whether this candidate is a likely winner, a likely loser, or should be skipped because it is ambiguous or report-worthy.\n"
    "4) Do not compare label identity, slot position, or anything outside these four frames.\n"
    "Reportability rules:\n"
    "- If solving clearly requires reading text, answer skip.\n"
    "- If visible order labels, letters, numbers, arrows, captions, or sequence markers are drawn on the images, answer skip.\n"
    "- If inappropriate, NSFW, or graphic violent content is present, answer skip.\n"
    "Reply with exactly one lowercase token: winner, loser, or skip."
)
RUNTIME_ALIGNED_NATIVE_FRAMES_PROMPT_TEMPLATE = (
    "You are solving an Idena FLIP validation challenge. "
    "You are given eight native frame images in order.\n"
    "Images 1-4 belong to the first shown candidate: OPTION {first_candidate_label} in temporal order.\n"
    "Images 5-8 belong to the second shown candidate: OPTION {second_candidate_label} in temporal order.\n"
    "Important:\n"
    "- Candidate labels are randomized across examples. OPTION A or OPTION B may be shown first. Do not use label identity or first-vs-second position as a hint.\n"
    "- Your answer token refers to candidate identity, not position. If OPTION B is better, answer b even when it is shown first.\n"
    "Required thinking steps:\n"
    "1) Inspect every frame separately and identify the main actors, action, and visible state.\n"
    '2) If readable text exists, transcribe it as TEXT:\"...\" and translate it to English if needed.\n'
    "3) Build one short factual story summary for OPTION A and one for OPTION B.\n"
    "4) Compare the two candidate stories using chronology, visible cause -> effect, and consistent entities across frames.\n"
    "5) Prefer the candidate that shows a clearer event sequence rather than a loose collection of related pictures.\n"
    "Reportability rules:\n"
    "- If solving clearly requires reading text, answer skip.\n"
    "- If visible order labels, letters, numbers, arrows, captions, or sequence markers are drawn on the images, answer skip.\n"
    "- If inappropriate, NSFW, or graphic violent content is present, answer skip.\n"
    "If both candidates are similarly weak, ambiguous, or clearly report-worthy, answer skip.\n"
    "Reply with exactly one lowercase token: a, b, or skip."
)
PROMPT_FAMILIES = {
    "default_composite": DEFAULT_COMPOSITE_PROMPT_TEMPLATE,
    "default_native_frames": DEFAULT_NATIVE_FRAMES_PROMPT_TEMPLATE,
    "candidate_analysis_native_frames_v1": CANDIDATE_ANALYSIS_NATIVE_FRAMES_PROMPT_TEMPLATE,
    "candidate_label_native_frames_v1": CANDIDATE_LABEL_NATIVE_FRAMES_PROMPT_TEMPLATE,
    "structured_compare_native_frames_v1": STRUCTURED_COMPARE_NATIVE_FRAMES_PROMPT_TEMPLATE,
    "runtime_aligned_native_frames_v2": RUNTIME_ALIGNED_NATIVE_FRAMES_PROMPT_TEMPLATE,
}
COMPOSITE_MAX_SIZE = (448, 448)
NATIVE_FRAME_MAX_SIZE = (128, 128)
HUMAN_ANNOTATION_MODES = {"none", "weight_boost", "followup_reasoning", "hybrid"}
ANNOTATION_TIER_RANK = {
    "reject": 0,
    "bronze": 1,
    "silver": 2,
    "gold": 3,
}
BASE_HUMAN_WEIGHT_BONUS = {
    "reject": 0.0,
    "bronze": 0.15,
    "silver": 0.35,
    "gold": 0.6,
}


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


def choose_option_a_mapping(task_id: str) -> str:
    score = sum(ord(character) for character in str(task_id or ""))
    return "left" if score % 2 == 0 else "right"


def choose_first_presented_candidate(task_id: str) -> str:
    score = sum(ord(character) for character in f"{task_id}:presentation")
    return "a" if score % 2 == 0 else "b"


def bounded_score(base: int, task_id: str, salt: str, minimum: int, maximum: int) -> int:
    score = sum(ord(character) for character in f"{task_id}:{salt}")
    jitter = (score % 5) - 2
    return max(minimum, min(maximum, base + jitter))


def build_structured_compare_target(
    *,
    task_id: str,
    training_target: str,
    expected_strength: str,
) -> str:
    normalized_target = str(training_target or "").strip().lower()
    normalized_strength = str(expected_strength or "").strip().lower()
    is_strong = normalized_strength == "strong"

    stronger_base = {"chronology": 34 if is_strong else 30, "entity": 25 if is_strong else 22, "causality": 24 if is_strong else 20}
    weaker_base = {"chronology": 16 if is_strong else 18, "entity": 11 if is_strong else 13, "causality": 9 if is_strong else 11}
    skip_base = {"chronology": 19, "entity": 15, "causality": 13}

    def build_option_payload(option_label: str) -> dict:
        if normalized_target == "skip":
            chronology = bounded_score(skip_base["chronology"], task_id, f"{option_label}:chrono:skip", 0, 40)
            entity = bounded_score(skip_base["entity"], task_id, f"{option_label}:entity:skip", 0, 30)
            causality = bounded_score(skip_base["causality"], task_id, f"{option_label}:causal:skip", 0, 30)
            story = "Frames stay ambiguous or report-worthy, so this candidate does not justify a confident story choice."
        else:
            is_selected = normalized_target == option_label
            base = stronger_base if is_selected else weaker_base
            chronology = bounded_score(base["chronology"], task_id, f"{option_label}:chrono", 0, 40)
            entity = bounded_score(base["entity"], task_id, f"{option_label}:entity", 0, 30)
            causality = bounded_score(base["causality"], task_id, f"{option_label}:causal", 0, 30)
            story = (
                "Frames form a clearer step-by-step story with more consistent entities and stronger cause/effect links."
                if is_selected
                else "Frames feel less coherent, weaker in chronology, or less consistent in the visible cause/effect chain."
            )
        return {
            "story": story,
            "chronology": chronology,
            "entityConsistency": entity,
            "causality": causality,
        }

    payload = {
        "optionA": build_option_payload("a"),
        "optionB": build_option_payload("b"),
        "textRequired": False,
        "sequenceMarkersPresent": False,
        "inappropriateContent": False,
        "answer": normalized_target if normalized_target in {"a", "b", "skip"} else "skip",
    }
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=False)


def build_candidate_analysis_target(
    *,
    task_id: str,
    candidate_label: str,
    candidate_role: str,
    expected_strength: str,
) -> str:
    normalized_role = str(candidate_role or "").strip().lower()
    normalized_strength = str(expected_strength or "").strip().lower()
    is_strong = normalized_strength == "strong"

    if normalized_role == "winner":
        base = {
            "chronology": 34 if is_strong else 30,
            "entityConsistency": 25 if is_strong else 22,
            "causality": 24 if is_strong else 20,
            "quality": "strong",
        }
        story = "Frames form a clearer step-by-step story with more consistent entities and stronger visible cause/effect links."
    elif normalized_role == "loser":
        base = {
            "chronology": 16 if is_strong else 18,
            "entityConsistency": 11 if is_strong else 13,
            "causality": 9 if is_strong else 11,
            "quality": "weak",
        }
        story = "Frames feel less coherent, weaker in chronology, or less consistent in the visible cause/effect chain."
    else:
        base = {
            "chronology": 19,
            "entityConsistency": 15,
            "causality": 13,
            "quality": "invalid",
        }
        story = "Frames stay ambiguous or report-worthy, so this candidate does not justify a confident story judgment."

    payload = {
        "story": story,
        "chronology": bounded_score(
            base["chronology"],
            task_id,
            f"{candidate_label}:chrono:candidate",
            0,
            40,
        ),
        "entityConsistency": bounded_score(
            base["entityConsistency"],
            task_id,
            f"{candidate_label}:entity:candidate",
            0,
            30,
        ),
        "causality": bounded_score(
            base["causality"],
            task_id,
            f"{candidate_label}:causal:candidate",
            0,
            30,
        ),
        "textRequired": False,
        "sequenceMarkersPresent": False,
        "inappropriateContent": False,
        "quality": base["quality"],
    }
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=False)


def load_panel_image(raw: bytes) -> Image.Image:
    image = Image.open(BytesIO(raw))
    image = ImageOps.exif_transpose(image)
    return image.convert("RGB")


def resize_to_fit(image: Image.Image, size: Tuple[int, int]) -> Image.Image:
    resized = image.copy()
    resized.thumbnail(size, Image.Resampling.LANCZOS)
    return resized


def load_number_overlay_font(size: int) -> ImageFont.ImageFont:
    try:
        return ImageFont.truetype("DejaVuSans-Bold.ttf", size)
    except Exception:
        return ImageFont.load_default()


def draw_panel_number_overlays(image: Image.Image) -> Image.Image:
    draw = ImageDraw.Draw(image)
    width, height = image.size
    cell_width = width / 2
    cell_height = height / 2
    padding = max(8, int(min(width, height) * 0.025))
    font_size = max(18, int(min(cell_width, cell_height) * 0.14))
    font = load_number_overlay_font(font_size)

    for index in range(4):
        row, column = divmod(index, 2)
        label = str(index + 1)
        bbox = draw.textbbox((0, 0), label, font=font)
        text_width = bbox[2] - bbox[0]
        text_height = bbox[3] - bbox[1]
        badge_width = text_width + padding * 2
        badge_height = text_height + padding
        x0 = int(column * cell_width + padding)
        y0 = int(row * cell_height + padding)
        x1 = x0 + badge_width
        y1 = y0 + badge_height
        draw.rounded_rectangle(
            (x0, y0, x1, y1),
            radius=max(6, padding // 2),
            fill=(0, 0, 0),
            outline=(255, 255, 255),
            width=max(1, padding // 5),
        )
        draw.text(
            (x0 + padding, y0 + max(2, padding // 4)),
            label,
            font=font,
            fill=(255, 255, 255),
        )

    return image


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

    composite = resize_to_fit(canvas, COMPOSITE_MAX_SIZE)
    return draw_panel_number_overlays(composite)


def build_training_messages(
    prompt_template: str,
    option_a_order: List[int],
    option_b_order: List[int],
    first_candidate_key: str,
    training_target: str,
    image_count: int,
) -> List[dict]:
    normalized_first_candidate = (
        "a" if str(first_candidate_key or "").strip().lower() == "a" else "b"
    )
    second_candidate_key = (
        "b" if normalized_first_candidate == "a" else "a"
    )
    prompt = prompt_template.format(
        option_a_order=format_order(option_a_order),
        option_b_order=format_order(option_b_order),
        first_candidate_label=normalized_first_candidate.upper(),
        second_candidate_label=second_candidate_key.upper(),
        first_candidate_order=format_order(
            option_a_order
            if normalized_first_candidate == "a"
            else option_b_order
        ),
        second_candidate_order=format_order(
            option_b_order
            if normalized_first_candidate == "a"
            else option_a_order
        ),
    )
    return [
        {
            "role": "user",
            "content": [{"type": "image"} for _ in range(max(1, image_count))]
            + [{"type": "text", "text": prompt}],
        },
        {
            "role": "assistant",
            "content": [{"type": "text", "text": training_target}],
        },
    ]


def build_candidate_analysis_messages(
    prompt_template: str,
    training_target: str,
    image_count: int,
) -> List[dict]:
    prompt = prompt_template.format()
    return [
        {
            "role": "user",
            "content": [{"type": "image"} for _ in range(max(1, image_count))]
            + [{"type": "text", "text": prompt}],
        },
        {
            "role": "assistant",
            "content": [{"type": "text", "text": training_target}],
        },
    ]


def build_candidate_label_messages(
    prompt_template: str,
    training_target: str,
    image_count: int,
) -> List[dict]:
    prompt = prompt_template.format()
    return [
        {
            "role": "user",
            "content": [{"type": "image"} for _ in range(max(1, image_count))]
            + [{"type": "text", "text": prompt}],
        },
        {
            "role": "assistant",
            "content": [{"type": "text", "text": training_target}],
        },
    ]


def normalize_image_mode(value: str) -> str:
    mode = str(value or "").strip().lower().replace("-", "_")
    if mode in {"composite", "native_frames"}:
        return mode
    raise ValueError(f"Unsupported image mode: {value}")


def resolve_prompt_template(
    *,
    prompt_family: str,
    prompt_template: str,
    image_mode: str,
) -> Tuple[str, str]:
    family = str(prompt_family or "").strip().lower()
    if family == "auto":
        if prompt_template != DEFAULT_COMPOSITE_PROMPT_TEMPLATE:
            return prompt_template, "custom"
        if normalize_image_mode(image_mode) == "native_frames":
            return DEFAULT_NATIVE_FRAMES_PROMPT_TEMPLATE, "default_native_frames"
        return DEFAULT_COMPOSITE_PROMPT_TEMPLATE, "default_composite"

    if family not in PROMPT_FAMILIES:
        raise ValueError(f"Unsupported prompt family: {prompt_family}")
    return PROMPT_FAMILIES[family], family


def load_jsonl(path: Path) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            rows.append(json.loads(line))
    return rows


def normalize_human_annotation_mode(value: str) -> str:
    mode = str(value or "none").strip().lower().replace("-", "_")
    if mode not in HUMAN_ANNOTATION_MODES:
        raise ValueError(f"Unsupported human annotation mode: {value}")
    return mode


def tier_meets_minimum(tier: str, minimum_tier: str) -> bool:
    return ANNOTATION_TIER_RANK.get(str(tier or "").strip().lower(), 0) >= ANNOTATION_TIER_RANK.get(
        str(minimum_tier or "").strip().lower(),
        ANNOTATION_TIER_RANK["bronze"],
    )


def select_preferred_annotation(
    current: Optional[Dict[str, Any]],
    candidate: Dict[str, Any],
) -> Dict[str, Any]:
    if current is None:
        return candidate

    current_key = (
        float(current.get("annotation_quality_score") or 0.0),
        int(current.get("rationale_length") or 0),
    )
    candidate_key = (
        float(candidate.get("annotation_quality_score") or 0.0),
        int(candidate.get("rationale_length") or 0),
    )
    return candidate if candidate_key > current_key else current


def load_human_annotation_index(
    path: Optional[Path],
    *,
    minimum_tier: str = "bronze",
) -> Dict[str, Dict[str, Any]]:
    if not path:
        return {}

    index: Dict[str, Dict[str, Any]] = {}
    for row in load_jsonl(path):
        if not bool(row.get("training_useful", True)):
            continue
        tier = str(row.get("annotation_quality_tier") or "").strip().lower()
        if not tier_meets_minimum(tier, minimum_tier):
            continue

        keys = [
            str(row.get("sample_id") or "").strip(),
            str(row.get("flip_hash") or "").strip(),
            str(row.get("task_id") or "").strip(),
        ]
        for key in keys:
            if not key:
                continue
            index[key] = select_preferred_annotation(index.get(key), row)

    return index


def should_apply_human_weight_boost(mode: str) -> bool:
    return normalize_human_annotation_mode(mode) in {"weight_boost", "hybrid"}


def should_apply_human_followup(mode: str) -> bool:
    return normalize_human_annotation_mode(mode) in {"followup_reasoning", "hybrid"}


def build_human_teacher_followup_prompt(record: Dict[str, Any]) -> str:
    prompt_family = str(record.get("prompt_family") or "").strip().lower()
    if prompt_family == "candidate_label_native_frames_v1":
        return (
            "Human teacher follow-up: briefly explain why this candidate should be "
            "treated as winner, loser, or skip using only concrete visual cues."
        )
    if prompt_family == "candidate_analysis_native_frames_v1":
        return (
            "Human teacher follow-up: briefly explain the main coherence strengths "
            "or weaknesses of this candidate using concrete visual cues."
        )
    return (
        "Human teacher follow-up: briefly explain why the selected story is the "
        "better answer, and mention text/reportability concerns if they matter."
    )


def summarize_human_annotation(record: Dict[str, Any], annotation: Dict[str, Any]) -> str:
    reasons: List[str] = []
    why_answer = str(annotation.get("why_answer") or "").strip()
    if why_answer:
        reasons.append(why_answer)

    final_answer = str(annotation.get("final_answer") or "").strip().lower()
    candidate_maps_to = str(record.get("candidate_maps_to") or "").strip().lower()
    candidate_label = str(record.get("candidate_label") or "").strip().upper()

    if candidate_label and candidate_maps_to:
        if final_answer == "skip":
            reasons.insert(
                0,
                f"Human teacher review marks candidate {candidate_label} as skip because the flip is ambiguous or report-worthy.",
            )
        elif final_answer == candidate_maps_to:
            reasons.insert(
                0,
                f"Human teacher review marks candidate {candidate_label} as the better story.",
            )
        else:
            reasons.insert(
                0,
                f"Human teacher review marks candidate {candidate_label} as the weaker story.",
            )
    elif final_answer:
        reasons.insert(0, f"Human teacher review says the correct answer is {final_answer}.")

    if bool(annotation.get("text_required")):
        reasons.append("Reading visible text is required to solve this flip.")
    if bool(annotation.get("sequence_markers_present")):
        reasons.append("Visible sequence markers are present in the images.")
    if bool(annotation.get("report_required")):
        report_reason = str(annotation.get("report_reason") or "").strip()
        if report_reason:
            reasons.append(f"Reportability note: {report_reason}")
        else:
            reasons.append("The flip should be reported instead of solved normally.")

    if not reasons:
        reasons.append("Human teacher confirms the decision using common-sense chronology and visual coherence.")

    return " ".join(item.strip() for item in reasons if item.strip())[:900]


def human_weight_multiplier(annotation: Dict[str, Any], scale: float) -> float:
    tier = str(annotation.get("annotation_quality_tier") or "").strip().lower()
    bonus = BASE_HUMAN_WEIGHT_BONUS.get(tier, 0.0)
    return 1.0 + (max(scale, 0.0) * bonus)


def attach_human_annotation(
    record: Dict[str, Any],
    annotation_index: Dict[str, Dict[str, Any]],
    *,
    human_annotation_mode: str,
    human_weight_scale: float,
) -> Dict[str, Any]:
    mode = normalize_human_annotation_mode(human_annotation_mode)
    if mode == "none" or not annotation_index:
        return record

    annotation = None
    for key in (
        str(record.get("sample_id") or "").strip(),
        str(record.get("flip_hash") or "").strip(),
    ):
        if key and key in annotation_index:
            annotation = annotation_index[key]
            break

    if not annotation:
        return {
            **record,
            "human_annotation_available": False,
        }

    next_record = {
        **record,
        "human_annotation_available": True,
        "human_annotation_quality_tier": annotation.get("annotation_quality_tier"),
        "human_annotation_quality_score": annotation.get("annotation_quality_score"),
        "human_annotation_reasoning_tags": list(annotation.get("reasoning_tags") or []),
    }

    if should_apply_human_weight_boost(mode):
        next_record["training_weight"] = round(
            float(record.get("training_weight") or 1.0)
            * human_weight_multiplier(annotation, human_weight_scale),
            6,
        )
        base_source = str(record.get("ranking_source") or "baseline").strip()
        next_record["ranking_source"] = f"{base_source}+human_teacher_boost"

    if should_apply_human_followup(mode):
        original_messages = copy.deepcopy(record.get("messages") or [])
        if original_messages:
            next_record["evaluation_messages"] = [copy.deepcopy(original_messages[0])]
        next_record["messages"] = original_messages + [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": build_human_teacher_followup_prompt(record),
                    }
                ],
            },
            {
                "role": "assistant",
                "content": [
                    {
                        "type": "text",
                        "text": summarize_human_annotation(record, annotation),
                    }
                ],
            },
        ]

    return next_record


def build_candidate_frame_images(
    *,
    saved_images: List[str],
    candidate_stack: List[int],
) -> List[str]:
    return [
        saved_images[index]
        for index in candidate_stack
        if 0 <= index < len(saved_images)
    ]


def build_training_images(
    *,
    image_mode: str,
    composite_path: Path,
    option_a_frame_images: List[str],
    option_b_frame_images: List[str],
    first_candidate_key: str,
) -> List[str]:
    normalized_mode = normalize_image_mode(image_mode)
    normalized_first_candidate = (
        "a" if str(first_candidate_key or "").strip().lower() == "a" else "b"
    )

    if normalized_mode == "native_frames":
        return (
            option_a_frame_images + option_b_frame_images
            if normalized_first_candidate == "a"
            else option_b_frame_images + option_a_frame_images
        )

    return [str(composite_path.resolve())]


def build_training_record(
    task_id: str,
    task_data: dict,
    image_bytes: Dict[str, bytes],
    images_dir: Path,
    prompt_template: str,
    prompt_family: str,
    image_mode: str,
) -> List[dict]:
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
    resized_training_images: List[str] = []
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

        resized_image_path = task_dir / f"train-{index + 1}.png"
        if not resized_image_path.exists():
            resized_image = resize_to_fit(load_panel_image(raw), NATIVE_FRAME_MAX_SIZE)
            resized_image.save(resized_image_path, format="PNG")
        resized_training_images.append(str(resized_image_path.resolve()))

    composite_path = task_dir / "composite.png"
    if not composite_path.exists():
        build_flip_composite(panel_bytes).save(composite_path, format="PNG")

    ranking = build_historical_signals(task_id, task_data)
    option_a_maps_to = choose_option_a_mapping(task_id)
    option_b_maps_to = "right" if option_a_maps_to == "left" else "left"
    option_a_order = left_stack if option_a_maps_to == "left" else right_stack
    option_b_order = right_stack if option_a_maps_to == "left" else left_stack
    first_candidate_key = choose_first_presented_candidate(task_id)
    candidate_saved_images = (
        resized_training_images
        if normalize_image_mode(image_mode) == "native_frames"
        else saved_images
    )
    left_frame_images = build_candidate_frame_images(
        saved_images=candidate_saved_images,
        candidate_stack=left_stack,
    )
    right_frame_images = build_candidate_frame_images(
        saved_images=candidate_saved_images,
        candidate_stack=right_stack,
    )
    option_a_frame_images = (
        left_frame_images if option_a_maps_to == "left" else right_frame_images
    )
    option_b_frame_images = (
        right_frame_images if option_a_maps_to == "left" else left_frame_images
    )
    training_images = build_training_images(
        image_mode=image_mode,
        composite_path=composite_path,
        option_a_frame_images=option_a_frame_images,
        option_b_frame_images=option_b_frame_images,
        first_candidate_key=first_candidate_key,
    )
    training_target = (
        "a"
        if expected_answer == option_a_maps_to
        else "b"
        if expected_answer == option_b_maps_to
        else "skip"
    )
    if prompt_family in {
        "candidate_analysis_native_frames_v1",
        "candidate_label_native_frames_v1",
    }:
        candidate_specs = [
            ("a", option_a_maps_to, option_a_order, option_a_frame_images),
            ("b", option_b_maps_to, option_b_order, option_b_frame_images),
        ]
        candidate_records = []
        for candidate_label, candidate_maps_to, candidate_order, candidate_images in candidate_specs:
            candidate_role = (
                "winner"
                if expected_answer == candidate_maps_to
                else "skip"
                if expected_answer == "skip"
                else "loser"
            )
            assistant_target = (
                candidate_role
                if prompt_family == "candidate_label_native_frames_v1"
                else build_candidate_analysis_target(
                    task_id=task_id,
                    candidate_label=candidate_label,
                    candidate_role=candidate_role,
                    expected_strength=expected_strength or "",
                )
            )
            message_builder = (
                build_candidate_label_messages
                if prompt_family == "candidate_label_native_frames_v1"
                else build_candidate_analysis_messages
            )
            candidate_records.append(
                {
                    "schema_version": "idena.flip-training.v1",
                    "sample_id": f"{task_id}::candidate-{candidate_label}",
                    "flip_hash": task_id,
                    "flip_group_id": task_id,
                    "prompt_variant": "candidate-analysis",
                    "prompt_family": prompt_family,
                    "images": list(candidate_images),
                    "panel_images": saved_images,
                    "left_frame_images": left_frame_images,
                    "right_frame_images": right_frame_images,
                    "training_image_mode": "native_frames",
                    "messages": message_builder(
                        prompt_template,
                        assistant_target,
                        len(candidate_images),
                    ),
                    "training_target": candidate_role,
                    "assistant_target": assistant_target,
                    "expected_answer": expected_answer,
                    "expected_strength": expected_strength or "",
                    "candidate_label": candidate_label,
                    "candidate_maps_to": candidate_maps_to,
                    "candidate_order": candidate_order,
                    "option_a_maps_to": option_a_maps_to,
                    "option_b_maps_to": option_b_maps_to,
                    "option_a_order": option_a_order,
                    "option_b_order": option_b_order,
                    "option_a_frame_images": option_a_frame_images,
                    "option_b_frame_images": option_b_frame_images,
                    "training_weight": ranking.training_weight,
                    "ranking_source": ranking.ranking_source,
                    "source": {
                        "kind": ranking.source_kind,
                        "name": ranking.source_name,
                        "priority": ranking.source_priority,
                    },
                    "audit": ranking.to_dict(),
                }
            )
        return candidate_records

    assistant_target = (
        build_structured_compare_target(
            task_id=task_id,
            training_target=training_target,
            expected_strength=expected_strength or "",
        )
        if prompt_family == "structured_compare_native_frames_v1"
        else training_target
    )
    canonical_record = {
        "schema_version": "idena.flip-training.v1",
        "sample_id": task_id,
        "flip_hash": task_id,
        "prompt_variant": "canonical",
        "prompt_family": prompt_family,
        "images": training_images,
        "panel_images": saved_images,
        "left_frame_images": left_frame_images,
        "right_frame_images": right_frame_images,
        "training_image_mode": normalize_image_mode(image_mode),
        "messages": build_training_messages(
            prompt_template,
            option_a_order,
            option_b_order,
            first_candidate_key,
            assistant_target,
            len(training_images),
        ),
        "training_target": training_target,
        "assistant_target": assistant_target,
        "expected_answer": expected_answer,
        "expected_strength": expected_strength or "",
        "left_order": left_stack,
        "right_order": right_stack,
        "option_a_maps_to": option_a_maps_to,
        "option_b_maps_to": option_b_maps_to,
        "option_a_order": option_a_order,
        "option_b_order": option_b_order,
        "first_candidate_key": first_candidate_key,
        "second_candidate_key": "b" if first_candidate_key == "a" else "a",
        "option_a_frame_images": option_a_frame_images,
        "option_b_frame_images": option_b_frame_images,
        "training_weight": ranking.training_weight,
        "ranking_source": ranking.ranking_source,
        "source": {
            "kind": ranking.source_kind,
            "name": ranking.source_name,
            "priority": ranking.source_priority,
        },
        "audit": ranking.to_dict(),
    }
    return [canonical_record]


def build_swapped_training_record(record: dict, prompt_template: str) -> dict:
    option_a_maps_to = record["option_b_maps_to"]
    option_b_maps_to = record["option_a_maps_to"]
    option_a_order = list(record["option_b_order"])
    option_b_order = list(record["option_a_order"])
    option_a_frame_images = list(record.get("option_b_frame_images") or [])
    option_b_frame_images = list(record.get("option_a_frame_images") or [])
    first_candidate_key = (
        "b"
        if str(record.get("first_candidate_key") or "").strip().lower() == "a"
        else "a"
    )
    expected_answer = record["expected_answer"]
    swapped_target = (
        "a"
        if expected_answer == option_a_maps_to
        else "b"
        if expected_answer == option_b_maps_to
        else "skip"
    )
    prompt_family = str(record.get("prompt_family") or "").strip().lower()
    assistant_target = (
        build_structured_compare_target(
            task_id=record["flip_hash"],
            training_target=swapped_target,
            expected_strength=record.get("expected_strength") or "",
        )
        if prompt_family == "structured_compare_native_frames_v1"
        else swapped_target
    )
    training_image_mode = normalize_image_mode(
        record.get("training_image_mode", "composite")
    )
    images = (
        build_training_images(
            image_mode=training_image_mode,
            composite_path=Path(record["images"][0]),
            option_a_frame_images=option_a_frame_images,
            option_b_frame_images=option_b_frame_images,
            first_candidate_key=first_candidate_key,
        )
        if training_image_mode == "native_frames"
        else list(record["images"])
    )
    swapped = {
        **record,
        "sample_id": f'{record["flip_hash"]}::swap',
        "prompt_variant": "swapped-orders",
        "images": images,
        "left_frame_images": list(record["left_frame_images"]),
        "right_frame_images": list(record["right_frame_images"]),
        "option_a_frame_images": option_a_frame_images,
        "option_b_frame_images": option_b_frame_images,
        "messages": build_training_messages(
            prompt_template,
            option_a_order,
            option_b_order,
            first_candidate_key,
            assistant_target,
            len(images),
        ),
        "training_target": swapped_target,
        "assistant_target": assistant_target,
        "option_a_maps_to": option_a_maps_to,
        "option_b_maps_to": option_b_maps_to,
        "option_a_order": option_a_order,
        "option_b_order": option_b_order,
        "first_candidate_key": first_candidate_key,
        "second_candidate_key": "b" if first_candidate_key == "a" else "a",
    }
    return swapped


def process_parquet_files(
    parquet_files: Iterable[Path],
    max_flips: int,
    skip_flips: int,
    images_dir: Path,
    prompt_template: str,
    prompt_family: str,
    image_mode: str,
    augment_swap_orders: bool,
    human_annotation_index: Optional[Dict[str, Dict[str, Any]]] = None,
    human_annotation_mode: str = "none",
    human_weight_scale: float = 1.0,
) -> Tuple[List[dict], int]:
    tasks: Dict[str, dict] = {}
    completed_task_ids = set()
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
                if task_id in completed_task_ids:
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
                        flip_records = build_training_record(
                            task_id,
                            record["task_data"],
                            record["image_bytes"],
                            images_dir,
                            prompt_template,
                            prompt_family,
                            image_mode,
                        )
                        if (
                            augment_swap_orders
                            and prompt_family
                            not in {
                                "candidate_analysis_native_frames_v1",
                                "candidate_label_native_frames_v1",
                            }
                        ):
                            flip_records.extend(
                                build_swapped_training_record(item, prompt_template)
                                for item in list(flip_records)
                            )
                        if human_annotation_index:
                            flip_records = [
                                attach_human_annotation(
                                    item,
                                    human_annotation_index,
                                    human_annotation_mode=human_annotation_mode,
                                    human_weight_scale=human_weight_scale,
                                )
                                for item in flip_records
                            ]
                        if produced >= skip_flips:
                            completed.extend(flip_records)
                        produced += 1
                        completed_task_ids.add(task_id)
                    except Exception:
                        malformed += 1
                    del tasks[task_id]

                    if produced >= max_flips:
                        return completed, malformed

    return completed, malformed


def write_jsonl(path: Path, rows: List[dict]) -> None:
    with path.open("w", encoding="utf-8") as fp:
        for row in rows:
            fp.write(json.dumps(row, ensure_ascii=False))
            fp.write("\n")


def balance_records_by_expected_answer(
    records: List[dict],
    labels: Tuple[str, ...] = ("left", "right"),
) -> tuple[List[dict], dict | None]:
    buckets: Dict[str, List[dict]] = {label: [] for label in labels}
    passthrough: List[dict] = []

    for record in records:
        answer = str(record.get("expected_answer") or "").strip().lower()
        if answer in buckets:
            buckets[answer].append(record)
        else:
            passthrough.append(record)

    if not all(buckets[label] for label in labels):
        return records, None

    target_count = min(len(buckets[label]) for label in labels)
    balanced: List[dict] = []
    selected_by_label: Dict[str, int] = {}

    for label in labels:
        selected = sorted(
            buckets[label],
            key=lambda item: (
                str(item.get("flip_hash") or ""),
                str(item.get("sample_id") or ""),
            ),
        )[:target_count]
        selected_by_label[label] = len(selected)
        balanced.extend(selected)

    balanced.extend(passthrough)
    balanced.sort(
        key=lambda item: (
            str(item.get("flip_hash") or ""),
            str(item.get("sample_id") or ""),
        )
    )
    return balanced, {
        "enabled": True,
        "labels": list(labels),
        "targetCountPerLabel": target_count,
        "selectedByLabel": selected_by_label,
        "passthroughCount": len(passthrough),
    }


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
        default=DEFAULT_COMPOSITE_PROMPT_TEMPLATE,
        help="prompt template used for each training example",
    )
    parser.add_argument(
        "--prompt-family",
        choices=sorted(PROMPT_FAMILIES.keys()) + ["auto"],
        default="auto",
        help="named prompt family to use instead of a raw template (default: auto)",
    )
    parser.add_argument(
        "--image-mode",
        choices=["composite", "native_frames"],
        default="composite",
        help="training image mode: composite or native_frames (default: composite)",
    )
    parser.add_argument(
        "--augment-swap-orders",
        action="store_true",
        help=(
            "duplicate each flip with left/right orders swapped so the model "
            "cannot rely on a fixed option position shortcut"
        ),
    )
    parser.add_argument(
        "--balance-canonical-answers",
        action="store_true",
        help=(
            "subsample left/right examples to a balanced count after preparation; "
            "useful for fixed validation slices"
        ),
    )
    parser.add_argument(
        "--human-annotations-jsonl",
        type=Path,
        help="Optional normalized human-teacher annotation JSONL to blend into training records",
    )
    parser.add_argument(
        "--human-annotation-mode",
        choices=sorted(HUMAN_ANNOTATION_MODES),
        default="none",
        help=(
            "How human annotations should affect prepared records: none, weight_boost, "
            "followup_reasoning, or hybrid"
        ),
    )
    parser.add_argument(
        "--human-min-quality-tier",
        choices=["bronze", "silver", "gold"],
        default="bronze",
        help="Minimum human annotation quality tier accepted for training augmentation",
    )
    parser.add_argument(
        "--human-weight-scale",
        type=float,
        default=1.0,
        help="Scale factor applied to human quality-based training-weight boosts",
    )
    args = parser.parse_args()
    selected_image_mode = normalize_image_mode(args.image_mode)
    human_annotation_mode = normalize_human_annotation_mode(args.human_annotation_mode)

    if args.max_flips < 1:
        print("--max-flips must be >= 1", file=sys.stderr)
        return 2
    if args.skip_flips < 0:
        print("--skip-flips must be >= 0", file=sys.stderr)
        return 2

    prompt_template, prompt_family = resolve_prompt_template(
        prompt_family=args.prompt_family,
        prompt_template=args.prompt_template,
        image_mode=selected_image_mode,
    )
    human_annotation_index = load_human_annotation_index(
        args.human_annotations_jsonl.resolve()
        if args.human_annotations_jsonl
        else None,
        minimum_tier=args.human_min_quality_tier,
    )

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
        prompt_template,
        prompt_family,
        selected_image_mode,
        args.augment_swap_orders,
        human_annotation_index,
        human_annotation_mode,
        args.human_weight_scale,
    )

    if not records:
        print("No completed flips were produced", file=sys.stderr)
        return 1

    balancing_summary = None
    if args.balance_canonical_answers:
        records, balancing_summary = balance_records_by_expected_answer(records)

    dataset = Dataset.from_list(records)
    dataset.save_to_disk(str(hf_dataset_dir))
    write_jsonl(jsonl_path, records)

    counts_by_answer: Dict[str, int] = {}
    counts_by_training_target: Dict[str, int] = {}
    counts_by_first_candidate: Dict[str, int] = {}
    ranking_sources: Dict[str, int] = {}
    training_weights: List[float] = []
    human_annotation_summary = {
        "available": 0,
        "followupReasoning": 0,
        "qualityTiers": {},
    }
    for item in records:
        answer = item["expected_answer"]
        counts_by_answer[answer] = counts_by_answer.get(answer, 0) + 1
        training_target = item.get("training_target") or "unknown"
        counts_by_training_target[training_target] = (
            counts_by_training_target.get(training_target, 0) + 1
        )
        ranking_source = item.get("ranking_source") or "unknown"
        ranking_sources[ranking_source] = ranking_sources.get(ranking_source, 0) + 1
        first_candidate = item.get("first_candidate_key") or "unknown"
        counts_by_first_candidate[first_candidate] = (
            counts_by_first_candidate.get(first_candidate, 0) + 1
        )
        try:
            training_weights.append(float(item.get("training_weight", 1.0) or 1.0))
        except (TypeError, ValueError):
            training_weights.append(1.0)
        if item.get("human_annotation_available"):
            human_annotation_summary["available"] += 1
            tier = str(item.get("human_annotation_quality_tier") or "unknown")
            human_annotation_summary["qualityTiers"][tier] = (
                human_annotation_summary["qualityTiers"].get(tier, 0) + 1
            )
            if item.get("evaluation_messages"):
                human_annotation_summary["followupReasoning"] += 1

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
        "promptAugmentation": {
            "swapOrders": bool(args.augment_swap_orders),
        },
        "promptFamily": prompt_family,
        "humanAnnotations": {
            "mode": human_annotation_mode,
            "path": str(args.human_annotations_jsonl.resolve())
            if args.human_annotations_jsonl
            else None,
            "minimumTier": args.human_min_quality_tier,
            "weightScale": args.human_weight_scale,
            "indexSize": len(human_annotation_index),
            "applied": human_annotation_summary,
        },
        "balancing": balancing_summary
        or {
            "enabled": False,
        },
        "imageMode": selected_image_mode,
        "countsByAnswer": counts_by_answer,
        "countsByTrainingTarget": counts_by_training_target,
        "countsByFirstCandidate": counts_by_first_candidate,
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
                "countsByTrainingTarget": counts_by_training_target,
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
