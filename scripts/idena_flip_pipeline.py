#!/usr/bin/env python3
"""Idena 4-panel flip generation pipeline.

This module implements a production-grade architecture with four phases:
1) Semantic pre-processing (interpretation compiler)
2) Constrained story planning with strict structured outputs
3) Refusal-aware recovery logic
4) Post-generation multimodal vision validation gate

The implementation is intentionally provider-agnostic and includes placeholder
integration hooks for OpenAI/Gemini and open-source vision tooling
(GroundingDINO/Florence-2, OCR, CLIP/VLM alignment).
"""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional, Protocol, Sequence, Tuple

try:
    from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
except ImportError as exc:  # pragma: no cover
    raise RuntimeError(
        "pydantic>=2.6 is required. Install with: pip install 'pydantic>=2.6'"
    ) from exc


# ---------------------------
# Constants and taxonomies
# ---------------------------

RISK_BEARING_NOUNS = {
    "chainsaw",
    "gun",
    "poison",
    "knife",
    "fire",
    "acid",
    "explosive",
    "syringe",
}

ACTOR_HINTS = {
    "clown",
    "person",
    "human",
    "teacher",
    "nurse",
    "doctor",
    "worker",
    "child",
    "chef",
    "artist",
    "dog",
    "cat",
}

TOOL_HINTS = {
    "chainsaw",
    "hammer",
    "wrench",
    "knife",
    "paintbrush",
    "saw",
    "drill",
    "spoon",
    "shovel",
}

LOCATION_HINTS = {
    "workshop",
    "kitchen",
    "garden",
    "studio",
    "school",
    "park",
    "garage",
    "festival",
    "hospital",
    "museum",
}

CONCEPT_TO_PHYSICAL = {
    "freedom": "broken metal chain",
    "justice": "balanced scale statue",
    "time": "large hourglass",
    "hope": "sprouting green plant",
    "peace": "white dove figurine",
    "memory": "photo album",
}

SAFE_USE_CONTEXT_MAP = {
    "chainsaw": "woodworking studio with protective gear, cutting a wooden log on a stable bench",
    "gun": "certified sport range with paper targets and instructor supervision",
    "poison": "chemistry lab safety demonstration with sealed, labeled sample vials",
    "knife": "culinary school kitchen slicing vegetables on a cutting board",
    "fire": "controlled workshop using a supervised kiln or small forge",
    "acid": "laboratory neutralization experiment with face shield and gloves",
    "explosive": "science classroom using inert training props only",
    "syringe": "medical skills lab using training manikins and sterile simulation tools",
}

SAFE_ZONES_ESCALATION = [
    "bright culinary training kitchen",
    "theatrical prop-building workshop",
    "community craft classroom",
    "public maker-space with safety instructor",
]

BASE_NEGATIVE_CONSTRAINTS = (
    "no text, no letters, no numbers, no sequence labels, no watermark, "
    "no logos, no gore, no blood, no violence"
)


# ---------------------------
# Data models (Pydantic)
# ---------------------------


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SemanticRole(str, Enum):
    ACTOR = "actor"
    TOOL = "tool"
    OBJECT = "object"
    LOCATION = "location"
    CONCEPT_REPRESENTATION = "concept_representation"


class RiskLevel(str, Enum):
    NEUTRAL = "neutral"
    RISK_BEARING = "risk-bearing"


class ProviderName(str, Enum):
    OPENAI = "openai"
    GEMINI = "gemini"


class KeywordAnalysis(StrictModel):
    keyword: str
    normalized_keyword: str
    role: SemanticRole
    risk_level: RiskLevel
    safe_use_context: str
    compiled_visible: str


class DisjointRoles(StrictModel):
    actor: str
    tool: str
    object: str
    location: str
    intent: str


class SemanticPlan(StrictModel):
    keyword_1_analysis: KeywordAnalysis
    keyword_2_analysis: KeywordAnalysis
    roles: DisjointRoles
    safe_use_constraints: List[str] = Field(default_factory=list)
    required_visibles: List[str] = Field(default_factory=list)

    @field_validator("required_visibles")
    @classmethod
    def validate_required_visibles(cls, value: List[str]) -> List[str]:
        if len(value) < 2:
            raise ValueError("required_visibles must include both keywords (or compiled representations)")
        return value


class PanelSpec(StrictModel):
    panel_number: int = Field(ge=1, le=4)
    scene_description: str = Field(min_length=10)
    action: str = Field(min_length=8)
    required_visibles: List[str] = Field(min_length=2)
    negative_constraints: str = Field(min_length=10)


class StoryDraft(StrictModel):
    panels: List[PanelSpec] = Field(min_length=4, max_length=4)

    @model_validator(mode="after")
    def validate_panel_sequence(self) -> "StoryDraft":
        expected = [1, 2, 3, 4]
        actual = [panel.panel_number for panel in self.panels]
        if actual != expected:
            raise ValueError(f"panel_number sequence must be {expected}, got {actual}")
        return self


class LLMStructuredResponse(StrictModel):
    parsed_payload: Optional[Dict[str, Any]] = None
    refusal: bool = False
    finish_reason: Optional[str] = None
    raw_response: Optional[Dict[str, Any]] = None


class DetectionBox(StrictModel):
    label: str
    confidence: float = Field(ge=0.0, le=1.0)
    # Normalized coordinates in range [0, 1]
    x_min: float = Field(ge=0.0, le=1.0)
    y_min: float = Field(ge=0.0, le=1.0)
    x_max: float = Field(ge=0.0, le=1.0)
    y_max: float = Field(ge=0.0, le=1.0)

    @property
    def area_ratio(self) -> float:
        width = max(0.0, self.x_max - self.x_min)
        height = max(0.0, self.y_max - self.y_min)
        return width * height


class PanelValidationResult(StrictModel):
    panel_number: int
    visibility_ok: bool
    typography_ok: bool
    causality_ok: bool
    passed: bool
    reasons: List[str] = Field(default_factory=list)


class PipelineResult(StrictModel):
    semantic_plan: SemanticPlan
    story: StoryDraft
    panel_image_paths: List[str] = Field(default_factory=list)
    panel_validation: List[PanelValidationResult] = Field(default_factory=list)


# ---------------------------
# Exceptions
# ---------------------------


class SafetyRefusalError(RuntimeError):
    """Raised when provider blocks generation for safety reasons."""


# ---------------------------
# Protocols / interfaces
# ---------------------------


class StructuredLLMClient(Protocol):
    def generate_structured(
        self,
        *,
        provider: ProviderName,
        system_prompt: str,
        user_prompt: str,
        provider_schema_config: Dict[str, Any],
        semantic_plan: SemanticPlan,
    ) -> LLMStructuredResponse:
        ...


class DiffusionBackend(Protocol):
    def generate_panel_image(self, *, prompt: str, panel_number: int, output_dir: Path) -> Path:
        ...


class VisionBackend(Protocol):
    def detect_open_vocabulary(self, *, image_path: Path, query: str) -> List[DetectionBox]:
        ...

    def run_ocr(self, *, image_path: Path) -> List[str]:
        ...

    def caption_image(self, *, image_path: Path) -> str:
        ...

    def clip_similarity(self, *, text_a: str, text_b: str) -> float:
        ...


# ---------------------------
# Provider placeholder hooks
# ---------------------------


def call_openai_structured_output(
    *,
    system_prompt: str,
    user_prompt: str,
    response_format: Dict[str, Any],
) -> LLMStructuredResponse:
    """Placeholder for OpenAI strict structured output call.

    Expected pattern (SDK-specific):
    - response_format={"type":"json_schema","json_schema":{"name":"...","strict":true,"schema":...}}
    - Check refusal metadata and return parsed payload if present.
    """
    raise NotImplementedError("Integrate OpenAI SDK call here (strict json_schema)")


def call_gemini_structured_output(
    *,
    system_prompt: str,
    user_prompt: str,
    generation_config: Dict[str, Any],
) -> LLMStructuredResponse:
    """Placeholder for Gemini structured output call.

    Expected pattern:
    - responseMimeType="application/json"
    - responseSchema=<JSON schema>
    - propertyOrdering set for deterministic chronology.
    - Check finishReason == "SAFETY".
    """
    raise NotImplementedError("Integrate Gemini API call here (responseSchema + propertyOrdering)")


class MockStructuredLLMClient:
    """Deterministic local client used until real provider adapters are wired."""

    def generate_structured(
        self,
        *,
        provider: ProviderName,
        system_prompt: str,
        user_prompt: str,
        provider_schema_config: Dict[str, Any],
        semantic_plan: SemanticPlan,
    ) -> LLMStructuredResponse:
        del provider, system_prompt, user_prompt, provider_schema_config

        # Simulate refusal if unsafe context is still missing for risk-bearing terms.
        analyses = [semantic_plan.keyword_1_analysis, semantic_plan.keyword_2_analysis]
        has_risk_without_safe_context = any(
            a.risk_level == RiskLevel.RISK_BEARING and "N/A" in a.safe_use_context for a in analyses
        )
        if has_risk_without_safe_context:
            return LLMStructuredResponse(refusal=True, finish_reason="SAFETY")

        payload = _deterministic_story_payload(semantic_plan)
        return LLMStructuredResponse(parsed_payload=payload, refusal=False, finish_reason="STOP")


# ---------------------------
# Semantic pre-processing
# ---------------------------


def _tokenize(keyword: str) -> List[str]:
    return re.findall(r"[a-zA-Z]+", keyword.lower())


def _contains_any_hint(keyword: str, hints: Sequence[str]) -> bool:
    tokens = set(_tokenize(keyword))
    return any(hint in tokens for hint in hints) or keyword.lower() in hints


def _is_risk_keyword(keyword: str) -> bool:
    tokens = set(_tokenize(keyword))
    return any(tok in RISK_BEARING_NOUNS for tok in tokens)


def _classify_role(keyword: str) -> SemanticRole:
    normalized = keyword.strip().lower()
    if normalized in CONCEPT_TO_PHYSICAL:
        return SemanticRole.CONCEPT_REPRESENTATION
    if _contains_any_hint(normalized, ACTOR_HINTS):
        return SemanticRole.ACTOR
    if _contains_any_hint(normalized, TOOL_HINTS):
        return SemanticRole.TOOL
    if _contains_any_hint(normalized, LOCATION_HINTS):
        return SemanticRole.LOCATION
    return SemanticRole.OBJECT


def _compile_concept(keyword: str) -> str:
    normalized = keyword.strip().lower()
    return CONCEPT_TO_PHYSICAL.get(normalized, keyword)


def _safe_use_context_for_keyword(keyword: str, risk_level: RiskLevel) -> str:
    if risk_level == RiskLevel.NEUTRAL:
        return "N/A"
    normalized = keyword.strip().lower()
    for token in _tokenize(normalized):
        if token in SAFE_USE_CONTEXT_MAP:
            return SAFE_USE_CONTEXT_MAP[token]
    return "supervised educational setting with PPE and non-living materials"


def _dedupe_or_replace(value: str, used: set, fallback: str) -> str:
    normalized = value.strip().lower()
    if normalized and normalized not in used:
        used.add(normalized)
        return value
    normalized_fallback = fallback.strip().lower()
    if normalized_fallback not in used:
        used.add(normalized_fallback)
        return fallback
    i = 2
    while f"{normalized_fallback}-{i}" in used:
        i += 1
    unique = f"{fallback} {i}"
    used.add(unique.strip().lower())
    return unique


def _resolve_disjoint_roles(analysis_1: KeywordAnalysis, analysis_2: KeywordAnalysis) -> DisjointRoles:
    analyses = [analysis_1, analysis_2]

    actor_candidate = next((a.keyword for a in analyses if a.role == SemanticRole.ACTOR), "adult person")
    tool_candidate = next((a.keyword for a in analyses if a.role == SemanticRole.TOOL), "hand tool")
    location_candidate = next(
        (a.keyword for a in analyses if a.role == SemanticRole.LOCATION),
        "well-lit workshop",
    )

    object_candidates = [
        a.compiled_visible
        for a in analyses
        if a.role in {SemanticRole.OBJECT, SemanticRole.CONCEPT_REPRESENTATION}
    ]
    object_candidate = object_candidates[0] if object_candidates else "wooden material"

    # If a risk-bearing tool exists, prioritize explicit safe-use location.
    risk_context = [a.safe_use_context for a in analyses if a.risk_level == RiskLevel.RISK_BEARING]
    if risk_context and location_candidate == "well-lit workshop":
        location_candidate = "supervised craft studio"

    used: set = set()
    actor = _dedupe_or_replace(actor_candidate, used, "adult person")
    tool = _dedupe_or_replace(tool_candidate, used, "safe hand tool")
    obj = _dedupe_or_replace(object_candidate, used, "craft material")
    location = _dedupe_or_replace(location_candidate, used, "training workspace")

    intent = _build_harmless_intent(actor=actor, tool=tool, obj=obj, location=location)

    return DisjointRoles(actor=actor, tool=tool, object=obj, location=location, intent=intent)


def _build_harmless_intent(*, actor: str, tool: str, obj: str, location: str) -> str:
    if "chainsaw" in tool.lower():
        return (
            f"{actor} safely shapes {obj} into a decorative sculpture in {location} "
            "under supervision"
        )
    if "knife" in tool.lower():
        return f"{actor} prepares food by safely cutting {obj} in {location}"
    return f"{actor} completes a harmless craft task using {tool} on {obj} in {location}"


def plan_semantic_roles(
    keyword_1: str,
    keyword_2: str,
) -> SemanticPlan:
    """Phase 1: interpretation compiler with disjoint role assignment."""

    def analyze(keyword: str) -> KeywordAnalysis:
        normalized = keyword.strip().lower()
        role = _classify_role(normalized)
        risk_level = RiskLevel.RISK_BEARING if _is_risk_keyword(normalized) else RiskLevel.NEUTRAL
        safe_context = _safe_use_context_for_keyword(normalized, risk_level)
        compiled_visible = _compile_concept(normalized)
        return KeywordAnalysis(
            keyword=keyword,
            normalized_keyword=normalized,
            role=role,
            risk_level=risk_level,
            safe_use_context=safe_context,
            compiled_visible=compiled_visible,
        )

    analysis_1 = analyze(keyword_1)
    analysis_2 = analyze(keyword_2)

    roles = _resolve_disjoint_roles(analysis_1, analysis_2)
    safe_use_constraints = [
        c
        for c in [analysis_1.safe_use_context, analysis_2.safe_use_context]
        if c != "N/A"
    ]
    if not safe_use_constraints:
        safe_use_constraints.append("every scene is benign, supervised, and focused on everyday activity")

    required_visibles = [analysis_1.compiled_visible, analysis_2.compiled_visible]

    return SemanticPlan(
        keyword_1_analysis=analysis_1,
        keyword_2_analysis=analysis_2,
        roles=roles,
        safe_use_constraints=safe_use_constraints,
        required_visibles=required_visibles,
    )


# ---------------------------
# Structured output planning
# ---------------------------


def _inject_property_ordering(schema: Dict[str, Any]) -> Dict[str, Any]:
    """Recursively add Gemini propertyOrdering to object nodes."""
    if schema.get("type") == "object" and "properties" in schema:
        ordered_keys = list(schema["properties"].keys())
        schema["propertyOrdering"] = ordered_keys
        for value in schema["properties"].values():
            if isinstance(value, dict):
                _inject_property_ordering(value)
    if schema.get("type") == "array" and isinstance(schema.get("items"), dict):
        _inject_property_ordering(schema["items"])
    return schema


def _build_provider_schema_config(provider: ProviderName) -> Dict[str, Any]:
    base_schema = StoryDraft.model_json_schema()

    if provider == ProviderName.OPENAI:
        return {
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "idena_flip_story_schema",
                    "strict": True,
                    "schema": base_schema,
                },
            }
        }

    # Gemini
    gemini_schema = _inject_property_ordering(json.loads(json.dumps(base_schema)))
    return {
        "generation_config": {
            "responseMimeType": "application/json",
            "responseSchema": gemini_schema,
        }
    }


def _build_story_system_prompt() -> str:
    return (
        "You are a flip-story planner for a 4-panel visual puzzle. "
        "Output must strictly follow the JSON schema. "
        "Panels must be temporally causal: before -> initiation -> climax -> after. "
        "Both required visible keywords must be physically present and clearly visible. "
        "No typography in images: no text, letters, numbers, labels, watermarks. "
        "All actions must be safe, harmless, and non-violent."
    )


def _build_story_user_prompt(
    *,
    roles: DisjointRoles,
    safe_use_constraints: Sequence[str],
    required_visibles: Sequence[str],
) -> str:
    safe_lines = "\n".join(f"- {constraint}" for constraint in safe_use_constraints)
    visibles = ", ".join(required_visibles)
    return (
        "Build exactly 4 panels with concrete physical actions.\n"
        f"Roles:\n- actor: {roles.actor}\n- tool: {roles.tool}\n- object: {roles.object}\n"
        f"- location: {roles.location}\n- intent: {roles.intent}\n"
        f"Required visibles in all panels: {visibles}\n"
        "Safe-use constraints:\n"
        f"{safe_lines}\n"
        f"Global negative constraints: {BASE_NEGATIVE_CONSTRAINTS}"
    )


def _deterministic_story_payload(semantic_plan: SemanticPlan) -> Dict[str, Any]:
    role = semantic_plan.roles
    visibles = semantic_plan.required_visibles

    return {
        "panels": [
            {
                "panel_number": 1,
                "scene_description": (
                    f"In {role.location}, {role.actor} stands near {role.object} with {role.tool} visible on a workbench"
                ),
                "action": f"{role.actor} inspects {role.object} and prepares {role.tool} for a safe task",
                "required_visibles": visibles,
                "negative_constraints": BASE_NEGATIVE_CONSTRAINTS,
            },
            {
                "panel_number": 2,
                "scene_description": (
                    f"The same {role.location} with clear view of {role.actor}, {role.tool}, and {role.object}"
                ),
                "action": f"{role.actor} starts the harmless process described by the intent",
                "required_visibles": visibles,
                "negative_constraints": BASE_NEGATIVE_CONSTRAINTS,
            },
            {
                "panel_number": 3,
                "scene_description": "Close-up angle where both required keyword objects are clearly visible",
                "action": f"{role.actor} performs the core safe action using {role.tool} on {role.object}",
                "required_visibles": visibles,
                "negative_constraints": BASE_NEGATIVE_CONSTRAINTS,
            },
            {
                "panel_number": 4,
                "scene_description": f"Final scene in {role.location} showing the completed result",
                "action": f"{role.actor} presents the finished harmless outcome",
                "required_visibles": visibles,
                "negative_constraints": BASE_NEGATIVE_CONSTRAINTS,
            },
        ]
    }


def draft_story(
    roles: DisjointRoles,
    safe_use_constraints: Sequence[str],
    *,
    required_visibles: Sequence[str],
    llm_client: StructuredLLMClient,
    semantic_plan: SemanticPlan,
    provider: ProviderName = ProviderName.OPENAI,
) -> StoryDraft:
    """Phase 2: constrained story planning with strict JSON schema."""
    schema_config = _build_provider_schema_config(provider)
    system_prompt = _build_story_system_prompt()
    user_prompt = _build_story_user_prompt(
        roles=roles,
        safe_use_constraints=safe_use_constraints,
        required_visibles=required_visibles,
    )

    response = llm_client.generate_structured(
        provider=provider,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        provider_schema_config=schema_config,
        semantic_plan=semantic_plan,
    )

    if response.refusal or (response.finish_reason or "").upper() == "SAFETY":
        raise SafetyRefusalError("Provider returned safety refusal during story planning")

    if not response.parsed_payload:
        raise RuntimeError("Structured response missing parsed payload")

    return StoryDraft.model_validate(response.parsed_payload)


# ---------------------------
# Refusal-aware recovery
# ---------------------------


def replan_safe_context(semantic_plan: SemanticPlan, attempt_index: int) -> SemanticPlan:
    """Phase 3: reinterpret and sanitize context, then re-run planning."""
    escalated_zone = SAFE_ZONES_ESCALATION[min(attempt_index - 1, len(SAFE_ZONES_ESCALATION) - 1)]

    updated = semantic_plan.model_copy(deep=True)
    updated.roles.location = escalated_zone
    updated.roles.intent = (
        f"create a harmless craft outcome in {escalated_zone} with supervision and protective equipment"
    )

    constraints = list(updated.safe_use_constraints)
    constraints.append(
        f"all actions occur in {escalated_zone}, supervised, no threat, no injury, no aggressive movement"
    )
    updated.safe_use_constraints = constraints

    for keyword_analysis in [updated.keyword_1_analysis, updated.keyword_2_analysis]:
        if keyword_analysis.risk_level == RiskLevel.RISK_BEARING:
            keyword_analysis.safe_use_context = (
                f"{escalated_zone} with PPE, non-living materials only, instructional safe-use demonstration"
            )

    return updated


# ---------------------------
# Prompt rendering + diffusion
# ---------------------------


def build_panel_prompt(panel: PanelSpec, semantic_plan: SemanticPlan) -> str:
    role = semantic_plan.roles
    safe_constraints = ", ".join(semantic_plan.safe_use_constraints)
    required_vis = ", ".join(panel.required_visibles)

    return (
        f"Scene: {panel.scene_description}. "
        f"Action: {panel.action}. "
        f"Actor: {role.actor}. Tool: {role.tool}. Object: {role.object}. Location: {role.location}. "
        f"Intent: {role.intent}. Required visibles: {required_vis}. "
        f"Safe-use constraints: {safe_constraints}. "
        f"Negative constraints: {panel.negative_constraints}."
    )


def amplify_typography_negative_constraints(panel: PanelSpec) -> PanelSpec:
    extra = "absolutely no typography, no alphanumeric characters, no signage, no labels"
    merged = f"{panel.negative_constraints}, {extra}"
    return panel.model_copy(update={"negative_constraints": merged})


# ---------------------------
# Vision validation stack
# ---------------------------


def run_grounding_dino_or_florence_detection(*, image_path: Path, query: str) -> List[DetectionBox]:
    """Placeholder for open-vocabulary detection inference.

    Expected implementation:
    - GroundingDINO / Florence-2 inference endpoint or local model
    - Return normalized bounding boxes + confidence for the requested query
    """
    raise NotImplementedError("Integrate open-vocabulary detector (GroundingDINO/Florence-2)")


def run_ocr_scan(*, image_path: Path) -> List[str]:
    """Placeholder for OCR (e.g., PaddleOCR / EasyOCR / Tesseract)."""
    raise NotImplementedError("Integrate OCR scan")


def run_vlm_caption(*, image_path: Path) -> str:
    """Placeholder for dense caption generation via VLM."""
    raise NotImplementedError("Integrate VLM caption inference")


def run_clip_similarity(*, text_a: str, text_b: str) -> float:
    """Placeholder for CLIP-style semantic alignment score in [0, 1]."""
    raise NotImplementedError("Integrate CLIP similarity scoring")


class PlaceholderVisionBackend:
    """Backend wiring class with explicit TODOs for production inference."""

    def detect_open_vocabulary(self, *, image_path: Path, query: str) -> List[DetectionBox]:
        return run_grounding_dino_or_florence_detection(image_path=image_path, query=query)

    def run_ocr(self, *, image_path: Path) -> List[str]:
        return run_ocr_scan(image_path=image_path)

    def caption_image(self, *, image_path: Path) -> str:
        return run_vlm_caption(image_path=image_path)

    def clip_similarity(self, *, text_a: str, text_b: str) -> float:
        return run_clip_similarity(text_a=text_a, text_b=text_b)


class VisionValidationGate:
    def __init__(
        self,
        backend: VisionBackend,
        *,
        min_confidence: float = 0.35,
        min_bbox_area_ratio: float = 0.02,
        min_action_alignment: float = 0.24,
    ) -> None:
        self.backend = backend
        self.min_confidence = min_confidence
        self.min_bbox_area_ratio = min_bbox_area_ratio
        self.min_action_alignment = min_action_alignment

    def validate_panel(self, *, image_path: Path, panel: PanelSpec) -> PanelValidationResult:
        reasons: List[str] = []

        visibility_ok = True
        for keyword in panel.required_visibles:
            detections = self.backend.detect_open_vocabulary(image_path=image_path, query=keyword)
            best = max(detections, key=lambda d: d.confidence, default=None)
            if best is None:
                visibility_ok = False
                reasons.append(f"missing keyword visibility: '{keyword}'")
                continue
            if best.confidence < self.min_confidence:
                visibility_ok = False
                reasons.append(
                    f"low confidence for '{keyword}': {best.confidence:.2f} < {self.min_confidence:.2f}"
                )
            if best.area_ratio < self.min_bbox_area_ratio:
                visibility_ok = False
                reasons.append(
                    f"visibility gap for '{keyword}': bbox area {best.area_ratio:.3f} < {self.min_bbox_area_ratio:.3f}"
                )

        typography_ok = True
        ocr_lines = self.backend.run_ocr(image_path=image_path)
        if any(re.search(r"[A-Za-z0-9]", line) for line in ocr_lines):
            typography_ok = False
            reasons.append("typography detected (letters/numbers/labels present)")

        caption = self.backend.caption_image(image_path=image_path)
        alignment = self.backend.clip_similarity(text_a=panel.action, text_b=caption)
        causality_ok = alignment >= self.min_action_alignment
        if not causality_ok:
            reasons.append(
                f"causality mismatch: action-caption alignment {alignment:.2f} < {self.min_action_alignment:.2f}"
            )

        passed = visibility_ok and typography_ok and causality_ok
        return PanelValidationResult(
            panel_number=panel.panel_number,
            visibility_ok=visibility_ok,
            typography_ok=typography_ok,
            causality_ok=causality_ok,
            passed=passed,
            reasons=reasons,
        )


# ---------------------------
# Orchestrator
# ---------------------------


@dataclass
class FlipGenerationPipeline:
    llm_client: StructuredLLMClient
    diffusion_backend: Optional[DiffusionBackend] = None
    vision_gate: Optional[VisionValidationGate] = None
    provider: ProviderName = ProviderName.OPENAI
    max_story_replans: int = 2
    max_panel_regens: int = 2

    def generate(
        self,
        *,
        keyword_1: str,
        keyword_2: str,
        output_dir: Path,
    ) -> PipelineResult:
        output_dir.mkdir(parents=True, exist_ok=True)

        semantic_plan = plan_semantic_roles(keyword_1, keyword_2)

        story: Optional[StoryDraft] = None
        current_plan = semantic_plan

        for attempt in range(self.max_story_replans + 1):
            try:
                story = draft_story(
                    roles=current_plan.roles,
                    safe_use_constraints=current_plan.safe_use_constraints,
                    required_visibles=current_plan.required_visibles,
                    llm_client=self.llm_client,
                    semantic_plan=current_plan,
                    provider=self.provider,
                )
                semantic_plan = current_plan
                break
            except SafetyRefusalError:
                if attempt >= self.max_story_replans:
                    raise
                current_plan = replan_safe_context(current_plan, attempt_index=attempt + 1)

        if story is None:
            raise RuntimeError("Story planning failed before story creation")

        # If no image backends are connected yet, return story-only output.
        if self.diffusion_backend is None or self.vision_gate is None:
            return PipelineResult(semantic_plan=semantic_plan, story=story)

        panel_image_paths: List[str] = []
        panel_validation: List[PanelValidationResult] = []

        for panel in story.panels:
            current_panel = panel
            chosen_image: Optional[Path] = None
            chosen_validation: Optional[PanelValidationResult] = None

            for regen_attempt in range(self.max_panel_regens + 1):
                prompt = build_panel_prompt(current_panel, semantic_plan)
                image_path = self.diffusion_backend.generate_panel_image(
                    prompt=prompt,
                    panel_number=current_panel.panel_number,
                    output_dir=output_dir,
                )

                validation = self.vision_gate.validate_panel(image_path=image_path, panel=current_panel)

                chosen_image = image_path
                chosen_validation = validation

                if validation.passed:
                    break

                if not validation.typography_ok:
                    current_panel = amplify_typography_negative_constraints(current_panel)

                if regen_attempt >= self.max_panel_regens:
                    break

            if chosen_image is None or chosen_validation is None:
                raise RuntimeError(f"Panel {panel.panel_number} generation failed unexpectedly")

            panel_image_paths.append(str(chosen_image))
            panel_validation.append(chosen_validation)

        return PipelineResult(
            semantic_plan=semantic_plan,
            story=story,
            panel_image_paths=panel_image_paths,
            panel_validation=panel_validation,
        )


# ---------------------------
# CLI
# ---------------------------


def main() -> None:
    parser = argparse.ArgumentParser(description="Idena 4-panel flip generation pipeline")
    parser.add_argument("keyword_1", type=str, help="First keyword")
    parser.add_argument("keyword_2", type=str, help="Second keyword")
    parser.add_argument(
        "--provider",
        type=str,
        default="openai",
        choices=[p.value for p in ProviderName],
        help="Structured output provider",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("./flip_output"),
        help="Directory for generated panel images",
    )
    parser.add_argument(
        "--story-only",
        action="store_true",
        help="Run only semantic + story phases (no diffusion/vision backends)",
    )
    args = parser.parse_args()

    llm_client = MockStructuredLLMClient()
    diffusion_backend = None
    vision_gate = None

    if not args.story_only:
        # Keep explicit until inference backends are integrated.
        diffusion_backend = None
        vision_gate = None

    pipeline = FlipGenerationPipeline(
        llm_client=llm_client,
        diffusion_backend=diffusion_backend,
        vision_gate=vision_gate,
        provider=ProviderName(args.provider),
    )

    result = pipeline.generate(
        keyword_1=args.keyword_1,
        keyword_2=args.keyword_2,
        output_dir=args.output_dir,
    )

    print(json.dumps(result.model_dump(), indent=2))


if __name__ == "__main__":
    main()
