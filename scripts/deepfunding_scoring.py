#!/usr/bin/env python3
"""
Lightly adapted DeepFunding scoring helpers.

Source inspiration:
- https://github.com/ubiubi18/scoring
- https://github.com/deepfunding/scoring

Kept local so the benchmarker can use the mechanism deterministically without
requiring a separate checkout at runtime.
"""

from __future__ import annotations

from typing import Iterable, List, Sequence, Tuple

try:
    from scipy.optimize import minimize
except ModuleNotFoundError:
    minimize = None


Sample = Tuple[int, int, float]


def cost_function(logits: Sequence[float], samples: Iterable[Sample]) -> float:
    return sum((logits[b] - logits[a] - c) ** 2 for a, b, c in samples)


def find_optimal_weights(
    logits_lists: Sequence[Sequence[float]], samples: Sequence[Sample]
) -> List[float]:
    if minimize is None:
        raise ModuleNotFoundError(
            "Missing dependency: scipy. Install it before using "
            "DeepFunding-based annotation aggregation."
        )
    if not logits_lists:
        return []
    if len(logits_lists) == 1:
        return [1.0]

    def split_cost(weights: Sequence[float]) -> float:
        combined_logits = [
            sum(weight * logits[index] for weight, logits in zip(weights, logits_lists))
            for index in range(len(logits_lists[0]))
        ]
        return cost_function(combined_logits, samples)

    initial_weights = [1.0 / len(logits_lists)] * len(logits_lists)
    constraints = ({"type": "eq", "fun": lambda values: sum(values) - 1.0},)
    bounds = [(0.0, 1.0)] * len(logits_lists)

    result = minimize(
        split_cost,
        initial_weights,
        bounds=bounds,
        constraints=constraints,
    )
    return [float(value) for value in result.x]
