#!/usr/bin/env python3
"""
Estimate FLIP training cost for cloud GPU runs.

This is intentionally simple:
- 1 training step ~= 1 prepared example at batch_size=1
- total runtime ~= examples * seconds_per_step * epochs * runs
- cost ~= runtime_hours * hourly_rate

Rates change over time. Prefer --hourly-rate for authoritative planning.
Service/GPU presets are convenience defaults only.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass


@dataclass(frozen=True)
class RatePreset:
    service: str
    gpu: str
    hourly_rate: float


RATE_PRESETS = {
    ("lambda", "a10"): RatePreset("lambda", "a10", 1.29),
    ("lambda", "a100"): RatePreset("lambda", "a100", 1.99),
    ("lambda", "h100"): RatePreset("lambda", "h100", 3.29),
    ("modal", "a10"): RatePreset("modal", "a10", 1.10),
    ("modal", "a100"): RatePreset("modal", "a100", 2.50),
    ("modal", "h100"): RatePreset("modal", "h100", 3.95),
    ("hf_jobs", "a10g"): RatePreset("hf_jobs", "a10g", 1.00),
    ("hf_jobs", "a100"): RatePreset("hf_jobs", "a100", 2.50),
    ("hf_jobs", "h200"): RatePreset("hf_jobs", "h200", 5.00),
}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Estimate FLIP cloud training time and cost."
    )
    parser.add_argument("--examples", type=int, required=True)
    parser.add_argument("--seconds-per-step", type=float, required=True)
    parser.add_argument("--epochs", type=int, default=1)
    parser.add_argument("--runs", type=int, default=1)
    parser.add_argument("--service", type=str, default="")
    parser.add_argument("--gpu", type=str, default="")
    parser.add_argument("--hourly-rate", type=float, default=0.0)
    parser.add_argument(
        "--overhead-hours",
        type=float,
        default=0.0,
        help="Optional setup/download overhead per run.",
    )
    return parser


def resolve_hourly_rate(args) -> tuple[float, str]:
    if args.hourly_rate > 0:
        return args.hourly_rate, "manual"

    key = (args.service.strip().lower(), args.gpu.strip().lower())
    preset = RATE_PRESETS.get(key)
    if preset:
        return preset.hourly_rate, f"preset:{preset.service}/{preset.gpu}"

    raise SystemExit(
        "No hourly rate available. Pass --hourly-rate or a known --service/--gpu preset."
    )


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    hourly_rate, rate_source = resolve_hourly_rate(args)

    seconds_per_run = args.examples * args.seconds_per_step * args.epochs
    hours_per_run = seconds_per_run / 3600.0 + args.overhead_hours
    total_hours = hours_per_run * args.runs
    total_cost = total_hours * hourly_rate

    result = {
        "examples": args.examples,
        "secondsPerStep": args.seconds_per_step,
        "epochs": args.epochs,
        "runs": args.runs,
        "hourlyRate": round(hourly_rate, 6),
        "rateSource": rate_source,
        "hoursPerRun": round(hours_per_run, 4),
        "totalHours": round(total_hours, 4),
        "estimatedTotalCost": round(total_cost, 4),
    }

    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
