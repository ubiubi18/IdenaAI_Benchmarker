#!/usr/bin/env python3
"""
Internal FLIP training metadata and ranking helpers.

This module intentionally does not depend on external community scripts.
Those repositories are useful references for signal discovery, but the
training pipeline should use its own normalized schema and weighting logic.

Design goals:
1. One schema for historical and modern flips.
2. Local-node / local-indexer should be the primary source for modern epochs.
3. Public indexer data should only be used as a fallback when local indexing
   is unavailable or incomplete.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Dict, Optional


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


def clean_text(value: Any) -> str:
    return str(value or "").strip()


def normalize_consensus_label(value: Any) -> Optional[str]:
    text = clean_text(value).lower()
    if not text:
        return None
    if text in {"left", "l"}:
        return "left"
    if text in {"right", "r"}:
        return "right"
    if text in {"report", "reported"}:
        return "reported"
    if text in {"inappropriate", "skip"}:
        return "skip"
    return text


@dataclass
class RankingPolicy:
    exclude_bad_authors: bool = False
    exclude_repeat_report_offenders: bool = False
    max_repeat_report_offenses: int = 1
    strong_consensus_bonus: float = 0.15
    weak_consensus_penalty: float = 0.10
    reported_vote_penalty_per_vote: float = 0.12
    wrong_words_vote_penalty_per_vote: float = 0.20
    extra_flip_penalty_per_extra_flip: float = 0.08
    bad_author_penalty: float = 0.60
    repeat_report_penalty: float = 0.45
    qualified_status_bonus: float = 0.20
    weakly_qualified_status_bonus: float = 0.08
    reported_status_penalty: float = 0.50
    min_weight: float = 0.05
    max_weight: float = 3.0


def build_ranking_policy(value: Optional[Dict[str, Any]] = None) -> RankingPolicy:
    source = value if isinstance(value, dict) else {}
    return RankingPolicy(
        exclude_bad_authors=bool(source.get("excludeBadAuthors", False)),
        exclude_repeat_report_offenders=bool(
            source.get("excludeRepeatReportOffenders", False)
        ),
        max_repeat_report_offenses=safe_int(
            source.get("maxRepeatReportOffenses"), 1
        ),
        strong_consensus_bonus=safe_float(
            source.get("strongConsensusBonus"), RankingPolicy.strong_consensus_bonus
        ),
        weak_consensus_penalty=safe_float(
            source.get("weakConsensusPenalty"), RankingPolicy.weak_consensus_penalty
        ),
        reported_vote_penalty_per_vote=safe_float(
            source.get("reportedVotePenaltyPerVote"),
            RankingPolicy.reported_vote_penalty_per_vote,
        ),
        wrong_words_vote_penalty_per_vote=safe_float(
            source.get("wrongWordsVotePenaltyPerVote"),
            RankingPolicy.wrong_words_vote_penalty_per_vote,
        ),
        extra_flip_penalty_per_extra_flip=safe_float(
            source.get("extraFlipPenaltyPerExtraFlip"),
            RankingPolicy.extra_flip_penalty_per_extra_flip,
        ),
        bad_author_penalty=safe_float(
            source.get("badAuthorPenalty"), RankingPolicy.bad_author_penalty
        ),
        repeat_report_penalty=safe_float(
            source.get("repeatReportPenalty"), RankingPolicy.repeat_report_penalty
        ),
        qualified_status_bonus=safe_float(
            source.get("qualifiedStatusBonus"), RankingPolicy.qualified_status_bonus
        ),
        weakly_qualified_status_bonus=safe_float(
            source.get("weaklyQualifiedStatusBonus"),
            RankingPolicy.weakly_qualified_status_bonus,
        ),
        reported_status_penalty=safe_float(
            source.get("reportedStatusPenalty"),
            RankingPolicy.reported_status_penalty,
        ),
        min_weight=safe_float(source.get("minWeight"), RankingPolicy.min_weight),
        max_weight=safe_float(source.get("maxWeight"), RankingPolicy.max_weight),
    )


@dataclass
class FlipTrainingSignals:
    source_kind: str
    source_name: str
    source_priority: str
    ranking_source: str
    flip_hash: str = ""
    cid: str = ""
    tx_hash: str = ""
    block: str = ""
    epoch: str = ""
    author: str = ""
    consensus_label: str = ""
    consensus_strength: str = ""
    votes_left: int = 0
    votes_right: int = 0
    votes_reported: int = 0
    grade_score: float = 0.0
    grade: str = ""
    status: str = ""
    wrong_words_votes: int = 0
    short_resp_count: int = 0
    long_resp_count: int = 0
    with_private_part: bool = False
    author_bad_reason: str = ""
    author_bad_wrong_words: bool = False
    author_repeat_report_offenses: int = 0
    author_extra_flip_count: int = 0
    training_weight: float = 1.0
    excluded: bool = False
    exclusion_reason: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def _normalized_status_boost(status: str, policy: RankingPolicy) -> float:
    normalized = clean_text(status).lower()
    if normalized == "qualified":
        return policy.qualified_status_bonus
    if normalized == "weaklyqualified":
        return policy.weakly_qualified_status_bonus
    if normalized in {"reported", "notqualified"}:
        return -policy.reported_status_penalty
    return 0.0


def apply_weighting_policy(
    signals: FlipTrainingSignals, policy: Optional[RankingPolicy] = None
) -> FlipTrainingSignals:
    next_signals = FlipTrainingSignals(**signals.to_dict())
    active_policy = policy or RankingPolicy()

    if (
        active_policy.exclude_bad_authors
        and next_signals.author_bad_wrong_words
    ):
        next_signals.training_weight = 0.0
        next_signals.excluded = True
        next_signals.exclusion_reason = "bad_author_wrong_words"
        return next_signals

    if (
        active_policy.exclude_repeat_report_offenders
        and next_signals.author_repeat_report_offenses
        > active_policy.max_repeat_report_offenses
    ):
        next_signals.training_weight = 0.0
        next_signals.excluded = True
        next_signals.exclusion_reason = "repeat_report_offender"
        return next_signals

    weight = 1.0

    normalized_strength = clean_text(next_signals.consensus_strength).lower()
    if normalized_strength == "strong":
        weight += active_policy.strong_consensus_bonus
    elif normalized_strength == "weak":
        weight -= active_policy.weak_consensus_penalty

    weight += _normalized_status_boost(next_signals.status, active_policy)

    weight -= (
        next_signals.votes_reported * active_policy.reported_vote_penalty_per_vote
    )
    weight -= (
        next_signals.wrong_words_votes
        * active_policy.wrong_words_vote_penalty_per_vote
    )
    weight -= (
        next_signals.author_extra_flip_count
        * active_policy.extra_flip_penalty_per_extra_flip
    )

    if next_signals.author_bad_wrong_words:
        weight -= active_policy.bad_author_penalty

    if next_signals.author_repeat_report_offenses > 0:
        weight -= (
            next_signals.author_repeat_report_offenses
            * active_policy.repeat_report_penalty
        )

    if next_signals.grade_score > 0:
        # Keep modern gradeScore influence conservative and bounded.
        weight += min(next_signals.grade_score / 10.0, 1.0)

    weight = max(active_policy.min_weight, min(active_policy.max_weight, weight))
    next_signals.training_weight = round(weight, 6)
    next_signals.excluded = False
    next_signals.exclusion_reason = ""
    return next_signals


def build_historical_signals(task_id: str, task_data: Dict[str, Any]) -> FlipTrainingSignals:
    votes = task_data.get("votes") or {}
    details = task_data.get("details") or {}
    agreed_answer = task_data.get("agreed_answer") or []

    consensus_label = normalize_consensus_label(agreed_answer[0] if agreed_answer else "")
    consensus_strength = (
        clean_text(agreed_answer[1]) if len(agreed_answer) > 1 else ""
    )

    signals = FlipTrainingSignals(
        source_kind="historical_hf",
        source_name="aplesner-eth/FLIP-Challenge",
        source_priority="historical-consensus",
        ranking_source="historical_consensus_only",
        flip_hash=clean_text(task_id),
        consensus_label=consensus_label or "",
        consensus_strength=consensus_strength,
        votes_left=safe_int(votes.get("Left")),
        votes_right=safe_int(votes.get("Right")),
        votes_reported=safe_int(votes.get("Reported")),
        tx_hash=clean_text(details.get("Tx:")),
        block=clean_text(details.get("Block:")),
        epoch=clean_text(details.get("Epoch:")),
        author=clean_text(details.get("Author:")).lower(),
    )
    return apply_weighting_policy(signals)


def build_modern_signals(
    *,
    cid: str,
    author: str,
    epoch: Any,
    tx_hash: Any = "",
    block: Any = "",
    consensus_label: Any = "",
    consensus_strength: Any = "",
    votes_left: Any = 0,
    votes_right: Any = 0,
    votes_reported: Any = 0,
    grade_score: Any = 0.0,
    grade: Any = "",
    status: Any = "",
    wrong_words_votes: Any = 0,
    short_resp_count: Any = 0,
    long_resp_count: Any = 0,
    with_private_part: Any = False,
    author_bad_reason: Any = "",
    author_bad_wrong_words: Any = False,
    author_repeat_report_offenses: Any = 0,
    author_extra_flip_count: Any = 0,
    ranking_source: str = "local_node_indexer",
    policy: Optional[RankingPolicy] = None,
) -> FlipTrainingSignals:
    signals = FlipTrainingSignals(
        source_kind="modern_epoch_capture",
        source_name="idena-modern-capture",
        source_priority="local-node-first",
        ranking_source=ranking_source,
        cid=clean_text(cid),
        author=clean_text(author).lower(),
        epoch=clean_text(epoch),
        tx_hash=clean_text(tx_hash),
        block=clean_text(block),
        consensus_label=normalize_consensus_label(consensus_label) or "",
        consensus_strength=clean_text(consensus_strength),
        votes_left=safe_int(votes_left),
        votes_right=safe_int(votes_right),
        votes_reported=safe_int(votes_reported),
        grade_score=safe_float(grade_score),
        grade=clean_text(grade),
        status=clean_text(status),
        wrong_words_votes=safe_int(wrong_words_votes),
        short_resp_count=safe_int(short_resp_count),
        long_resp_count=safe_int(long_resp_count),
        with_private_part=bool(with_private_part),
        author_bad_reason=clean_text(author_bad_reason),
        author_bad_wrong_words=bool(author_bad_wrong_words),
        author_repeat_report_offenses=safe_int(author_repeat_report_offenses),
        author_extra_flip_count=safe_int(author_extra_flip_count),
    )
    return apply_weighting_policy(signals, policy)
