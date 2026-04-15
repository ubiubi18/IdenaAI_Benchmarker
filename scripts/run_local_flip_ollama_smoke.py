#!/usr/bin/env python3
"""
Run a small local FLIP smoke benchmark against an Ollama vision model.

This is intended for quick local comparison of runtime prompt modes before
larger training/evaluation work. It operates on decoded FLIP JSON in the shape:

{
  "flips": [
    {
      "hash": "...",
      "images": ["data:image/...", ...],
      "orders": [[...], [...]],
      "expectedAnswer": "left|right|skip"
    }
  ]
}
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple


DEFAULT_MODEL = "qwen2.5vl:7b"
DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434/api/chat"
DEFAULT_TIMEOUT_SECONDS = 120
DIRECT_DECISION_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "answer": {
            "type": "string",
            "enum": ["a", "b", "skip"],
        },
        "confidence": {
            "type": "number",
            "minimum": 0,
            "maximum": 1,
        },
        "reasoning": {
            "type": "string",
        },
    },
    "required": ["answer", "confidence"],
}
TWO_PASS_REASONING_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "firstFrames": {
            "type": "array",
            "minItems": 4,
            "maxItems": 4,
            "items": {
                "type": "object",
                "properties": {
                    "caption": {"type": "string"},
                    "text": {"type": "string"},
                    "translation": {"type": "string"},
                },
                "required": ["caption", "text", "translation"],
            },
        },
        "secondFrames": {
            "type": "array",
            "minItems": 4,
            "maxItems": 4,
            "items": {
                "type": "object",
                "properties": {
                    "caption": {"type": "string"},
                    "text": {"type": "string"},
                    "translation": {"type": "string"},
                },
                "required": ["caption", "text", "translation"],
            },
        },
        "firstStory": {"type": "string"},
        "secondStory": {"type": "string"},
        "coherenceFirst": {"type": "integer", "minimum": 0, "maximum": 100},
        "coherenceSecond": {"type": "integer", "minimum": 0, "maximum": 100},
        "reportRisk": {"type": "boolean"},
        "reportReason": {"type": "string"},
    },
    "required": [
        "firstFrames",
        "secondFrames",
        "firstStory",
        "secondStory",
        "coherenceFirst",
        "coherenceSecond",
        "reportRisk",
        "reportReason",
    ],
}
CANDIDATE_ANALYSIS_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "frames": {
            "type": "array",
            "minItems": 4,
            "maxItems": 4,
            "items": {
                "type": "object",
                "properties": {
                    "caption": {"type": "string"},
                    "text": {"type": "string"},
                    "translation": {"type": "string"},
                },
                "required": ["caption", "text", "translation"],
            },
        },
        "story": {"type": "string"},
        "chronologyScore": {"type": "integer", "minimum": 0, "maximum": 40},
        "entityConsistencyScore": {"type": "integer", "minimum": 0, "maximum": 30},
        "causalScore": {"type": "integer", "minimum": 0, "maximum": 30},
        "textRequired": {"type": "boolean"},
        "sequenceMarkersPresent": {"type": "boolean"},
        "inappropriateContent": {"type": "boolean"},
        "reportReason": {"type": "string"},
    },
    "required": [
        "frames",
        "story",
        "chronologyScore",
        "entityConsistencyScore",
        "causalScore",
        "textRequired",
        "sequenceMarkersPresent",
        "inappropriateContent",
        "reportReason",
    ],
}
STRUCTURED_COMPARE_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "optionA": {
            "type": "object",
            "properties": {
                "story": {"type": "string"},
                "chronologyScore": {"type": "integer", "minimum": 0, "maximum": 40},
                "entityConsistencyScore": {"type": "integer", "minimum": 0, "maximum": 30},
                "causalScore": {"type": "integer", "minimum": 0, "maximum": 30},
            },
            "required": ["story", "chronologyScore", "entityConsistencyScore", "causalScore"],
        },
        "optionB": {
            "type": "object",
            "properties": {
                "story": {"type": "string"},
                "chronologyScore": {"type": "integer", "minimum": 0, "maximum": 40},
                "entityConsistencyScore": {"type": "integer", "minimum": 0, "maximum": 30},
                "causalScore": {"type": "integer", "minimum": 0, "maximum": 30},
            },
            "required": ["story", "chronologyScore", "entityConsistencyScore", "causalScore"],
        },
        "textRequired": {"type": "boolean"},
        "sequenceMarkersPresent": {"type": "boolean"},
        "inappropriateContent": {"type": "boolean"},
        "answer": {"type": "string", "enum": ["a", "b", "skip"]},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "reasoning": {"type": "string"},
    },
    "required": [
        "optionA",
        "optionB",
        "textRequired",
        "sequenceMarkersPresent",
        "inappropriateContent",
        "answer",
        "confidence",
    ],
}


def hash_score(text: str) -> int:
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    return int(digest[:16], 16)


def strip_data_url(data_url: str) -> str:
    if not isinstance(data_url, str) or "," not in data_url:
        raise ValueError("Expected image data URL")
    prefix, payload = data_url.split(",", 1)
    if not prefix.startswith("data:image/"):
        raise ValueError("Expected image data URL")
    return payload


def normalize_expected_answer(value: Any) -> Optional[str]:
    raw = str(value or "").strip().lower()
    if raw in {"left", "l"}:
        return "left"
    if raw in {"right", "r"}:
        return "right"
    if raw in {"skip", "report", "reported", "inappropriate"}:
        return "skip"
    return None


def normalize_candidate_answer(value: Any) -> Optional[str]:
    text = str(value or "").strip().lower()
    if not text:
        return None

    first_token = text.split()[0]
    if first_token in {"a", "b", "skip", "left", "right"}:
        return first_token
    if text.startswith("option a") or text.startswith("candidate a"):
        return "a"
    if text.startswith("option b") or text.startswith("candidate b"):
        return "b"
    if first_token in {"report", "reported", "inappropriate"}:
        return "skip"
    return None


def extract_json_block(raw_text: str) -> Dict[str, Any]:
    text = str(raw_text or "").strip()
    if not text:
        raise ValueError("Empty response")

    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.S)
    if fenced:
        return json.loads(fenced.group(1))

    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        return json.loads(text[start : end + 1])

    raise ValueError("No JSON object found")


def extract_answer_from_text(raw_text: str) -> Optional[str]:
    text = str(raw_text or "").strip().lower()
    if not text:
        return None

    parsed = None
    try:
        parsed = extract_json_block(text)
    except Exception:
        parsed = None

    if isinstance(parsed, dict):
        direct = normalize_candidate_answer(parsed.get("answer"))
        if direct:
            return direct

    answer_field = re.search(
        r'"answer"\s*:\s*"?(a|b|skip|left|right|option a|option b|candidate a|candidate b)"?',
        text,
        re.I,
    )
    if answer_field:
        return normalize_candidate_answer(answer_field.group(1))

    explicit = re.search(
        r"\b(answer|choose|pick|select|option)\b[^.\n:]*\b(a|b|skip|left|right)\b",
        text,
        re.I,
    )
    if explicit:
        return normalize_candidate_answer(explicit.group(2))

    compact = re.match(r"^\s*(a|b|skip|left|right)\b", text, re.I)
    if compact:
        return normalize_candidate_answer(compact.group(1))

    return None


def extract_confidence_from_text(raw_text: str) -> Optional[float]:
    text = str(raw_text or "").strip()
    if not text:
        return None

    try:
        parsed = extract_json_block(text)
    except Exception:
        parsed = None

    if isinstance(parsed, dict):
        value = parsed.get("confidence")
        if isinstance(value, (int, float)):
            return max(0.0, min(float(value), 1.0))

    match = re.search(r'"confidence"\s*:\s*([0-9]*\.?[0-9]+)', text, re.I)
    if match:
        try:
            return max(0.0, min(float(match.group(1)), 1.0))
        except ValueError:
            return None
    return None


def to_canonical_answer(candidate_answer: Optional[str], option_a_maps_to: str) -> Optional[str]:
    if candidate_answer in {None, ""}:
        return None
    if candidate_answer == "skip":
        return "skip"
    if candidate_answer == "left":
        return "left"
    if candidate_answer == "right":
        return "right"

    opposite = "right" if option_a_maps_to == "left" else "left"
    if candidate_answer == "a":
        return option_a_maps_to
    if candidate_answer == "b":
        return opposite
    return None


def build_direct_prompt(
    flip_hash: str,
    force_decision: bool,
    first_candidate_label: str,
    second_candidate_label: str,
) -> str:
    return f"""
You are solving an Idena short-session flip benchmark.
You are given 8 ordered frame images:
- Images 1-4 belong to the first shown candidate: OPTION {first_candidate_label} (in temporal order)
- Images 5-8 belong to the second shown candidate: OPTION {second_candidate_label} (in temporal order)

Task:
1) Inspect each frame separately and identify the main actors, action, and visible state.
2) If readable text exists, transcribe it and translate it to English if needed.
3) Build one short story summary for OPTION {first_candidate_label} and one for OPTION {second_candidate_label}.
4) Compare the two candidate stories using chronology, visible cause -> effect, and consistent entities.
5) Decide which candidate is more coherent.
6) Return JSON only.

Allowed JSON schema:
{{"answer":"a|b|skip","confidence":0.0,"reasoning":"short optional note"}}

Rules:
- Use only {"a|b" if force_decision else "a|b|skip"} for "answer"
- "confidence" must be between 0 and 1
- Candidate labels are runtime labels only. Do not use label identity or first-vs-second position as a hint.
- If solving clearly requires reading text, or visible order labels/numbers/letters/arrows/captions are drawn on the images, treat the flip as report-worthy and return skip unless forceDecision forbids it.
- If inappropriate, NSFW, or graphic violent content is present, treat the flip as report-worthy and return skip unless forceDecision forbids it.
- Keep reasoning concise and factual and mention one concrete visual cue
{"- You must choose a or b unless the flip is clearly report-worthy." if force_decision else '- If both candidates are ambiguous, equally weak, or clearly report-worthy, return "skip".'}

Flip hash: {flip_hash}
""".strip()


def build_structured_compare_prompt(flip_hash: str) -> str:
    return f"""
You are solving an Idena short-session flip benchmark.
You are given 8 ordered frame images:
- Images 1-4 belong to OPTION A in temporal order
- Images 5-8 belong to OPTION B in temporal order

Task:
1) Inspect each frame separately.
2) Build one short factual story summary for OPTION A and one for OPTION B.
3) Score each option using only:
   - chronologyScore from 0 to 40
   - entityConsistencyScore from 0 to 30
   - causalScore from 0 to 30
4) Mark textRequired=true only if readable text is necessary to solve the flip rather than merely present.
5) Mark sequenceMarkersPresent=true only for visible order labels, numbers, letters, arrows, captions, or explicit sequence markers drawn on the images.
6) Mark inappropriateContent=true only for actually inappropriate, NSFW, or graphic violent content.
7) Choose the better story, or skip if both are too weak or clearly report-worthy.
8) Return JSON only.

Allowed JSON schema:
{{
  "optionA": {{
    "story": "...",
    "chronologyScore": 0,
    "entityConsistencyScore": 0,
    "causalScore": 0
  }},
  "optionB": {{
    "story": "...",
    "chronologyScore": 0,
    "entityConsistencyScore": 0,
    "causalScore": 0
  }},
  "textRequired": false,
  "sequenceMarkersPresent": false,
  "inappropriateContent": false,
  "answer": "a|b|skip",
  "confidence": 0.0,
  "reasoning": "short optional note"
}}

Rules:
- Candidate labels are arbitrary and not hints
- Base the answer on visible chronology, consistent entities, and visible cause -> effect
- Prefer skip when the scores are close and the stories are both weak
- Keep reasoning concise and factual and mention one concrete visual cue

Flip hash: {flip_hash}
""".strip()


def build_two_pass_reasoning_prompt(
    flip_hash: str,
    first_candidate_label: str,
    second_candidate_label: str,
) -> str:
    return f"""
You are solving an Idena flip benchmark in analysis mode.
You are given 8 ordered frame images:
- Images 1-4 belong to OPTION {first_candidate_label} (in temporal order)
- Images 5-8 belong to OPTION {second_candidate_label} (in temporal order)

Task:
1) For each frame, write one short factual caption.
2) Extract any readable text from each frame and translate it to English if needed.
3) Build one concise story summary for OPTION {first_candidate_label} and OPTION {second_candidate_label}.
4) Estimate one coherence score from 0 to 100 for OPTION {first_candidate_label} and OPTION {second_candidate_label}.
5) Flag report risk if the flip is clearly report-worthy.
6) Return JSON only.

Allowed JSON schema:
{{
  "firstFrames":[
    {{"caption":"...", "text":"...", "translation":"..."}},
    {{"caption":"...", "text":"...", "translation":"..."}},
    {{"caption":"...", "text":"...", "translation":"..."}},
    {{"caption":"...", "text":"...", "translation":"..."}}
  ],
  "secondFrames":[
    {{"caption":"...", "text":"...", "translation":"..."}},
    {{"caption":"...", "text":"...", "translation":"..."}},
    {{"caption":"...", "text":"...", "translation":"..."}},
    {{"caption":"...", "text":"...", "translation":"..."}}
  ],
  "firstStory":"...",
  "secondStory":"...",
  "coherenceFirst":0,
  "coherenceSecond":0,
  "reportRisk": false,
  "reportReason":""
}}

Rules:
- Keep each frame caption short and factual
- Use "" for text and translation when no readable text exists
- Keep story summaries concise
- coherence scores must be integers between 0 and 100
- Set reportRisk=true if reading text is required to solve the flip
- Set reportRisk=true if visible order labels, numbers, letters, arrows, captions, or sequence markers appear on the images
- Set reportRisk=true if the flip contains inappropriate, NSFW, or graphic violent content
- Candidate labels are arbitrary. Do not use position as a hint.

Flip hash: {flip_hash}
""".strip()


def build_two_pass_decision_prompt(
    flip_hash: str,
    analysis_json: str,
    force_decision: bool,
) -> str:
    return f"""
You are solving an Idena short-session flip benchmark.
You are given structured analysis JSON for two candidate stories.

Task:
1) Read the captions, extracted text, translations, story summaries, coherence scores, and report flags.
2) If reportRisk is true, return skip unless the report signal is clearly invalid.
3) Otherwise, choose the story with the better coherence and clearer causal chain.
4) Prefer skip when both stories are similarly weak or ambiguous.
5) Return JSON only.

Allowed JSON schema:
{{"answer":"a|b|skip","confidence":0.0,"reasoning":"short optional note"}}

Rules:
- Use only {"a|b" if force_decision else "a|b|skip"} for "answer"
- "confidence" must be between 0 and 1
- Reasoning must cite one key caption or reportability signal
{"- You must choose a or b unless the flip is clearly report-worthy." if force_decision else '- If the candidates are too close or clearly report-worthy, return "skip".'}

Flip hash: {flip_hash}

Pre-analysis JSON:
{analysis_json}
""".strip()


def build_candidate_analysis_prompt(flip_hash: str, candidate_label: str) -> str:
    return f"""
You are analyzing one candidate story for an Idena flip benchmark.
You are given 4 ordered frame images for OPTION {candidate_label}.

Task:
1) Inspect each frame separately and write one short factual caption.
2) Extract any readable text from each frame and translate it to English if needed.
3) Build one concise story summary for the 4-frame sequence.
4) Score the candidate using three components only:
   - chronologyScore from 0 to 40
   - entityConsistencyScore from 0 to 30
   - causalScore from 0 to 30
5) Set textRequired=true only if readable text is necessary to solve the flip rather than just present.
6) Set sequenceMarkersPresent=true only if visible order labels, numbers, letters, arrows, captions, or explicit sequence markers appear on the images.
7) Set inappropriateContent=true only for actually inappropriate, NSFW, or graphic violent content. Ordinary sadness, injury-free accidents, cemeteries, funerals, hospitals, or death themes alone are not enough.
6) Return JSON only.

Allowed JSON schema:
{{
  "frames":[
    {{"caption":"...", "text":"...", "translation":"..."}},
    {{"caption":"...", "text":"...", "translation":"..."}},
    {{"caption":"...", "text":"...", "translation":"..."}},
    {{"caption":"...", "text":"...", "translation":"..."}}
  ],
  "story":"...",
  "chronologyScore":0,
  "entityConsistencyScore":0,
  "causalScore":0,
  "textRequired": false,
  "sequenceMarkersPresent": false,
  "inappropriateContent": false,
  "reportReason":""
}}

Rules:
- Keep captions short and factual
- Use "" for text and translation when there is no readable text
- Candidate label identity is arbitrary and not a hint
- Score only this candidate story; do not infer anything about any competing candidate
- Keep scores conservative and evidence-based

Flip hash: {flip_hash}
""".strip()


def call_ollama_chat(
    model: str,
    prompt: str,
    images: List[str],
    timeout_seconds: int,
    response_format: Optional[Any] = None,
    num_predict: int = 256,
) -> Tuple[str, int]:
    payload: Dict[str, Any] = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": prompt,
                "images": images,
            }
        ],
        "stream": False,
        "options": {
            "temperature": 0,
            "num_predict": max(32, min(int(num_predict), 2048)),
        },
    }
    if response_format:
        payload["format"] = response_format

    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        DEFAULT_OLLAMA_URL,
        data=body,
        headers={"Content-Type": "application/json"},
    )

    start = time.time()
    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            data = json.load(response)
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Ollama HTTP {error.code}: {detail}") from error

    latency_ms = int(round((time.time() - start) * 1000))
    message = data.get("message") or {}
    text = str(message.get("content") or data.get("response") or "").strip()
    return text, latency_ms


def prepare_candidates(
    flip: Dict[str, Any], forced_first_candidate_key: Optional[str] = None
) -> Dict[str, Any]:
    images = [strip_data_url(item) for item in (flip.get("images") or [])]
    orders = list(flip.get("orders") or [])
    if len(images) < 4 or len(orders) < 2:
        raise ValueError("Flip is missing images or candidate orders")

    left_order = [int(item) for item in orders[0][:4]]
    right_order = [int(item) for item in orders[1][:4]]
    if any(index < 0 or index >= len(images) for index in left_order + right_order):
        raise ValueError("Flip order references an image index outside the source image list")
    left_images = [images[index] for index in left_order]
    right_images = [images[index] for index in right_order]

    option_a_maps_to = "left" if hash_score(f"{flip['hash']}:candidate-a") % 2 == 0 else "right"
    option_a_images = left_images if option_a_maps_to == "left" else right_images
    option_b_images = right_images if option_a_maps_to == "left" else left_images
    if forced_first_candidate_key in {"a", "b"}:
        first_candidate_key = forced_first_candidate_key
    else:
        first_candidate_key = (
            "a" if hash_score(f"{flip['hash']}:candidate-presentation") % 2 == 0 else "b"
        )
    second_candidate_key = "b" if first_candidate_key == "a" else "a"
    ordered_images = (
        option_a_images + option_b_images
        if first_candidate_key == "a"
        else option_b_images + option_a_images
    )

    return {
        "option_a_maps_to": option_a_maps_to,
        "option_a_images": option_a_images,
        "option_b_images": option_b_images,
        "first_candidate_key": first_candidate_key,
        "second_candidate_key": second_candidate_key,
        "ordered_images": ordered_images,
    }


def run_direct_mode(
    model: str,
    flip: Dict[str, Any],
    timeout_seconds: int,
    forced_first_candidate_key: Optional[str] = None,
) -> Dict[str, Any]:
    prepared = prepare_candidates(flip, forced_first_candidate_key)
    prompt = build_direct_prompt(
        flip["hash"],
        False,
        prepared["first_candidate_key"].upper(),
        prepared["second_candidate_key"].upper(),
    )
    raw_text, latency_ms = call_ollama_chat(
        model,
        prompt,
        prepared["ordered_images"],
        timeout_seconds,
        response_format=DIRECT_DECISION_SCHEMA,
        num_predict=192,
    )
    candidate_answer = extract_answer_from_text(raw_text)
    confidence = extract_confidence_from_text(raw_text)
    answer = to_canonical_answer(candidate_answer, prepared["option_a_maps_to"])
    return {
        "mode": "native_direct_ab",
        "hash": flip["hash"],
        "latencyMs": latency_ms,
        "candidateAnswer": candidate_answer,
        "answer": answer,
        "confidence": confidence,
        "optionAMapsTo": prepared["option_a_maps_to"],
        "firstCandidateKey": prepared["first_candidate_key"],
        "reasoning": raw_text[:1200],
    }


def run_direct_swap_consensus_mode(
    model: str, flip: Dict[str, Any], timeout_seconds: int
) -> Dict[str, Any]:
    direct_a_first = run_direct_mode(model, flip, timeout_seconds, forced_first_candidate_key="a")
    direct_b_first = run_direct_mode(model, flip, timeout_seconds, forced_first_candidate_key="b")

    answer_a = normalize_expected_answer(direct_a_first.get("answer"))
    answer_b = normalize_expected_answer(direct_b_first.get("answer"))
    confidence_a = float(direct_a_first.get("confidence") or 0.0)
    confidence_b = float(direct_b_first.get("confidence") or 0.0)
    confidence_gap = abs(confidence_a - confidence_b)

    if answer_a and answer_a == answer_b:
        final_answer = answer_a
        source = "agreement"
    elif answer_a and answer_b and confidence_gap >= 0.15:
        stronger = direct_a_first if confidence_a > confidence_b else direct_b_first
        final_answer = normalize_expected_answer(stronger.get("answer"))
        source = "stronger_confidence"
    else:
        final_answer = "skip"
        source = "disagreement_skip"

    candidate_answer = None
    if final_answer:
        candidate_answer = "a" if final_answer == direct_a_first.get("answer") else "b"

    return {
        "mode": "native_direct_swap_consensus",
        "hash": flip["hash"],
        "latencyMs": int(direct_a_first["latencyMs"]) + int(direct_b_first["latencyMs"]),
        "candidateAnswer": candidate_answer,
        "answer": final_answer,
        "confidence": round(max(confidence_a, confidence_b), 4),
        "confidenceGap": round(confidence_gap, 4),
        "decisionSource": source,
        "runAFirst": direct_a_first,
        "runBFirst": direct_b_first,
    }


def run_structured_compare_mode(
    model: str, flip: Dict[str, Any], timeout_seconds: int
) -> Dict[str, Any]:
    prepared = prepare_candidates(flip, forced_first_candidate_key="a")
    prompt = build_structured_compare_prompt(flip["hash"])
    raw_text, latency_ms = call_ollama_chat(
        model,
        prompt,
        prepared["ordered_images"],
        timeout_seconds,
        response_format=STRUCTURED_COMPARE_SCHEMA,
        num_predict=512,
    )
    parsed = extract_json_block(raw_text)
    candidate_answer = normalize_candidate_answer(parsed.get("answer"))
    answer = to_canonical_answer(candidate_answer, prepared["option_a_maps_to"])
    option_a = parsed.get("optionA") or {}
    option_b = parsed.get("optionB") or {}
    coherence_a = (
        int(option_a.get("chronologyScore", 0))
        + int(option_a.get("entityConsistencyScore", 0))
        + int(option_a.get("causalScore", 0))
    )
    coherence_b = (
        int(option_b.get("chronologyScore", 0))
        + int(option_b.get("entityConsistencyScore", 0))
        + int(option_b.get("causalScore", 0))
    )
    return {
        "mode": "native_structured_compare",
        "hash": flip["hash"],
        "latencyMs": latency_ms,
        "candidateAnswer": candidate_answer,
        "answer": answer,
        "confidence": parsed.get("confidence"),
        "optionAMapsTo": prepared["option_a_maps_to"],
        "firstCandidateKey": prepared["first_candidate_key"],
        "coherenceA": coherence_a,
        "coherenceB": coherence_b,
        "textRequired": bool(parsed.get("textRequired")),
        "sequenceMarkersPresent": bool(parsed.get("sequenceMarkersPresent")),
        "inappropriateContent": bool(parsed.get("inappropriateContent")),
        "reasoning": str(parsed.get("reasoning") or "")[:1200],
        "analysis": parsed,
    }


def run_two_pass_mode(model: str, flip: Dict[str, Any], timeout_seconds: int) -> Dict[str, Any]:
    prepared = prepare_candidates(flip)
    reasoning_prompt = build_two_pass_reasoning_prompt(
        flip["hash"],
        prepared["first_candidate_key"].upper(),
        prepared["second_candidate_key"].upper(),
    )
    reasoning_raw, latency_reasoning_ms = call_ollama_chat(
        model,
        reasoning_prompt,
        prepared["ordered_images"],
        timeout_seconds,
        response_format=TWO_PASS_REASONING_SCHEMA,
        num_predict=1024,
    )
    analysis = extract_json_block(reasoning_raw)
    decision_prompt = build_two_pass_decision_prompt(
        flip["hash"],
        json.dumps(analysis, ensure_ascii=False),
        False,
    )
    decision_raw, latency_decision_ms = call_ollama_chat(
        model,
        decision_prompt,
        [],
        timeout_seconds,
        response_format=DIRECT_DECISION_SCHEMA,
        num_predict=192,
    )
    candidate_answer = extract_answer_from_text(decision_raw)
    answer = to_canonical_answer(candidate_answer, prepared["option_a_maps_to"])
    return {
        "mode": "native_two_pass",
        "hash": flip["hash"],
        "latencyMs": latency_reasoning_ms + latency_decision_ms,
        "latencyReasoningMs": latency_reasoning_ms,
        "latencyDecisionMs": latency_decision_ms,
        "candidateAnswer": candidate_answer,
        "answer": answer,
        "optionAMapsTo": prepared["option_a_maps_to"],
        "firstCandidateKey": prepared["first_candidate_key"],
        "reasoning": decision_raw[:1200],
        "analysis": analysis,
    }


def run_separate_candidate_scoring_mode(
    model: str, flip: Dict[str, Any], timeout_seconds: int
) -> Dict[str, Any]:
    prepared = prepare_candidates(flip)
    per_candidate: Dict[str, Any] = {}
    total_latency_ms = 0

    for candidate_key in ("a", "b"):
        prompt = build_candidate_analysis_prompt(flip["hash"], candidate_key.upper())
        raw_text, latency_ms = call_ollama_chat(
            model,
            prompt,
            prepared[f"option_{candidate_key}_images"],
            timeout_seconds,
            response_format=CANDIDATE_ANALYSIS_SCHEMA,
            num_predict=768,
        )
        analysis = extract_json_block(raw_text)
        total_latency_ms += latency_ms
        per_candidate[candidate_key] = {
            "latencyMs": latency_ms,
            "analysis": analysis,
        }

    analysis_a = per_candidate["a"]["analysis"]
    analysis_b = per_candidate["b"]["analysis"]
    coherence_a = (
        int(analysis_a.get("chronologyScore", 0))
        + int(analysis_a.get("entityConsistencyScore", 0))
        + int(analysis_a.get("causalScore", 0))
    )
    coherence_b = (
        int(analysis_b.get("chronologyScore", 0))
        + int(analysis_b.get("entityConsistencyScore", 0))
        + int(analysis_b.get("causalScore", 0))
    )
    report_risk = (
        bool(analysis_a.get("textRequired"))
        or bool(analysis_b.get("textRequired"))
        or bool(analysis_a.get("sequenceMarkersPresent"))
        or bool(analysis_b.get("sequenceMarkersPresent"))
        or bool(analysis_a.get("inappropriateContent"))
        or bool(analysis_b.get("inappropriateContent"))
    )
    report_reason = str(analysis_a.get("reportReason") or analysis_b.get("reportReason") or "")
    score_margin = abs(coherence_a - coherence_b)

    candidate_answer: Optional[str]
    if report_risk:
        candidate_answer = "skip"
    elif score_margin < 5:
        candidate_answer = "skip"
    else:
        candidate_answer = "a" if coherence_a > coherence_b else "b"

    answer = to_canonical_answer(candidate_answer, prepared["option_a_maps_to"])
    return {
        "mode": "native_separate_candidate_scoring",
        "hash": flip["hash"],
        "latencyMs": total_latency_ms,
        "candidateAnswer": candidate_answer,
        "answer": answer,
        "optionAMapsTo": prepared["option_a_maps_to"],
        "firstCandidateKey": prepared["first_candidate_key"],
        "scoreMargin": score_margin,
        "coherenceA": coherence_a,
        "coherenceB": coherence_b,
        "reportRisk": report_risk,
        "reportReason": report_reason,
        "analysisA": analysis_a,
        "analysisB": analysis_b,
    }


def load_flips(path: Path) -> List[Dict[str, Any]]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(raw, dict) and isinstance(raw.get("flips"), list):
        return list(raw["flips"])
    if isinstance(raw, list):
        return list(raw)
    raise ValueError(f"Unsupported JSON shape in {path}")


def summarize(results: Iterable[Dict[str, Any]]) -> Dict[str, Any]:
    items = list(results)
    expected_counter = Counter()
    predicted_counter = Counter()
    candidate_counter = Counter()
    correct = 0
    labeled = 0
    latencies = []

    for item in items:
        expected = normalize_expected_answer(item.get("expectedAnswer"))
        answer = normalize_expected_answer(item.get("answer"))
        candidate_answer = normalize_candidate_answer(item.get("candidateAnswer"))
        if expected:
            expected_counter[expected] += 1
            labeled += 1
        if answer:
            predicted_counter[answer] += 1
        if candidate_answer in {"a", "b"}:
            candidate_counter[candidate_answer] += 1
        if expected and answer == expected:
            correct += 1
        if isinstance(item.get("latencyMs"), int):
            latencies.append(item["latencyMs"])

    dominant = max(candidate_counter.values()) if candidate_counter else 0
    total_candidates = sum(candidate_counter.values())
    candidate_slot_bias_score = (
        round(dominant / total_candidates - 0.5, 4) if total_candidates else 0.0
    )

    return {
        "totalFlips": len(items),
        "labeled": labeled,
        "correct": correct,
        "accuracy": round(correct / labeled, 4) if labeled else 0.0,
        "expected_counts": dict(expected_counter),
        "predicted_counts": dict(predicted_counter),
        "candidate_counts": dict(candidate_counter),
        "candidate_slot_bias_score": candidate_slot_bias_score,
        "latency": {
            "totalMs": sum(latencies),
            "meanMs": round(sum(latencies) / len(latencies), 1) if latencies else 0.0,
            "maxMs": max(latencies) if latencies else 0,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Run a local FLIP smoke benchmark against Ollama")
    parser.add_argument(
        "--input",
        default="samples/flips/flip-challenge-test-5-decoded-labeled.json",
        help="decoded FLIP JSON file",
    )
    parser.add_argument("--model", default=DEFAULT_MODEL, help="Ollama model id")
    parser.add_argument(
        "--mode",
        choices=[
            "native_direct_ab",
            "native_direct_swap_consensus",
            "native_structured_compare",
            "native_two_pass",
            "native_separate_candidate_scoring",
        ],
        default="native_direct_ab",
        help="benchmark mode",
    )
    parser.add_argument("--max-flips", type=int, default=5, help="max flips to evaluate")
    parser.add_argument(
        "--timeout-seconds",
        type=int,
        default=DEFAULT_TIMEOUT_SECONDS,
        help="per-request timeout",
    )
    parser.add_argument(
        "--output",
        default="",
        help="optional path to write the benchmark report JSON",
    )
    args = parser.parse_args()

    flips = load_flips(Path(args.input))
    selected = flips[: max(1, args.max_flips)]
    results = []

    for flip in selected:
        expected = normalize_expected_answer(flip.get("expectedAnswer"))
        try:
            if args.mode == "native_two_pass":
                result = run_two_pass_mode(args.model, flip, args.timeout_seconds)
            elif args.mode == "native_direct_swap_consensus":
                result = run_direct_swap_consensus_mode(args.model, flip, args.timeout_seconds)
            elif args.mode == "native_structured_compare":
                result = run_structured_compare_mode(args.model, flip, args.timeout_seconds)
            elif args.mode == "native_separate_candidate_scoring":
                result = run_separate_candidate_scoring_mode(
                    args.model, flip, args.timeout_seconds
                )
            else:
                result = run_direct_mode(args.model, flip, args.timeout_seconds)
            result["expectedAnswer"] = expected
            result["isCorrect"] = expected is not None and result.get("answer") == expected
        except Exception as error:  # noqa: BLE001
            result = {
                "mode": args.mode,
                "hash": flip.get("hash"),
                "expectedAnswer": expected,
                "answer": None,
                "candidateAnswer": None,
                "isCorrect": False,
                "error": str(error),
            }
        results.append(result)

    report = {
        "model": args.model,
        "mode": args.mode,
        "input": str(Path(args.input).resolve()),
        "summary": summarize(results),
        "results": results,
    }

    if args.output:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")

    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
