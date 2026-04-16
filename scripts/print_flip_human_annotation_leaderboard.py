#!/usr/bin/env python3
"""
Print a compact leaderboard from a human-annotation matrix summary.

This reads the `matrix-summary.json` produced by
`run_flip_human_annotation_matrix.py` and prints:
1. overall best runs on key metrics
2. best runs grouped by training mode
3. best runs grouped by aggregation mode
4. a sorted run leaderboard table
"""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional


METRIC_DIRECTIONS = {
    "accuracy": "max",
    "accuracy_on_answered": "max",
    "answered_fraction": "max",
    "swap_consistency_rate": "max",
    "candidate_slot_bias_score": "min",
}

METRIC_LABELS = {
    "accuracy": "Accuracy",
    "accuracy_on_answered": "AnsweredAcc",
    "answered_fraction": "AnsweredFrac",
    "swap_consistency_rate": "SwapCons",
    "candidate_slot_bias_score": "SlotBias",
}

PERCENT_METRICS = {
    "accuracy",
    "accuracy_on_answered",
    "answered_fraction",
    "swap_consistency_rate",
}


def load_json(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def format_metric(metric_name: str, value: Optional[float]) -> str:
    if value is None:
        return "-"
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return str(value)
    if metric_name in PERCENT_METRICS:
        return f"{numeric * 100:.1f}%"
    return f"{numeric:.4f}"


def coerce_rows(summary: Dict[str, Any]) -> List[Dict[str, Any]]:
    comparisons = summary.get("comparisons") or {}
    rows = comparisons.get("rows")
    if isinstance(rows, list) and rows:
        return list(rows)

    fallback_rows: List[Dict[str, Any]] = []
    for row in summary.get("modes") or []:
        fallback_rows.append(
            {
                "runKey": row.get("runKey") or row.get("name"),
                "mode": row.get("humanAnnotationMode"),
                "aggregation": row.get("humanAnnotationAggregation"),
                "metrics": row.get("metrics") or {},
            }
        )
    return fallback_rows


def sort_rows(rows: List[Dict[str, Any]], metric_name: str) -> List[Dict[str, Any]]:
    direction = METRIC_DIRECTIONS.get(metric_name, "max")
    present = [
        row for row in rows if row.get("metrics", {}).get(metric_name) is not None
    ]
    missing = [
        row for row in rows if row.get("metrics", {}).get(metric_name) is None
    ]
    present.sort(
        key=lambda row: float(row["metrics"][metric_name]),
        reverse=(direction == "max"),
    )
    return present + missing


def build_table_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    table_rows: List[Dict[str, str]] = []
    for row in rows:
        metrics = row.get("metrics") or {}
        table_rows.append(
            {
                "Run": str(row.get("runKey") or "-"),
                "Mode": str(row.get("mode") or "-"),
                "Agg": str(row.get("aggregation") or "-"),
                "Accuracy": format_metric("accuracy", metrics.get("accuracy")),
                "AnsweredAcc": format_metric(
                    "accuracy_on_answered",
                    metrics.get("accuracy_on_answered"),
                ),
                "AnsweredFrac": format_metric(
                    "answered_fraction",
                    metrics.get("answered_fraction"),
                ),
                "SwapCons": format_metric(
                    "swap_consistency_rate",
                    metrics.get("swap_consistency_rate"),
                ),
                "SlotBias": format_metric(
                    "candidate_slot_bias_score",
                    metrics.get("candidate_slot_bias_score"),
                ),
            }
        )
    return table_rows


def table_headers() -> List[str]:
    return [
        "Run",
        "Mode",
        "Agg",
        "Accuracy",
        "AnsweredAcc",
        "AnsweredFrac",
        "SwapCons",
        "SlotBias",
    ]


def build_text_table(rows: List[Dict[str, Any]]) -> str:
    table_rows = build_table_rows(rows)
    headers = table_headers()
    widths = {
        header: max(len(header), *(len(str(row[header])) for row in table_rows))
        if table_rows
        else len(header)
        for header in headers
    }

    def render_line(values: Dict[str, str]) -> str:
        return "  ".join(str(values[header]).ljust(widths[header]) for header in headers)

    lines = [render_line({header: header for header in headers})]
    lines.append("  ".join("-" * widths[header] for header in headers))
    lines.extend(render_line(row) for row in table_rows)
    return "\n".join(lines)


def build_markdown_table(rows: List[Dict[str, Any]]) -> str:
    table_rows = build_table_rows(rows)
    headers = table_headers()
    lines = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join("---" for _ in headers) + " |",
    ]
    for row in table_rows:
        lines.append("| " + " | ".join(str(row[header]) for header in headers) + " |")
    return "\n".join(lines)


def build_tsv_table(rows: List[Dict[str, Any]]) -> str:
    table_rows = build_table_rows(rows)
    headers = table_headers()
    lines = ["\t".join(headers)]
    for row in table_rows:
        lines.append("\t".join(str(row[header]) for header in headers))
    return "\n".join(lines)


def build_csv_table(rows: List[Dict[str, Any]]) -> str:
    table_rows = build_table_rows(rows)
    headers = table_headers()
    output: List[str] = []

    class ListWriter:
        def write(self, value: str) -> int:
            output.append(value)
            return len(value)

    writer = csv.DictWriter(ListWriter(), fieldnames=headers, lineterminator="\n")
    writer.writeheader()
    writer.writerows(table_rows)
    return "".join(output)


def render_overall_best(summary: Dict[str, Any]) -> List[str]:
    lines = ["Overall best:"]
    overall = ((summary.get("comparisons") or {}).get("overallBest") or {})
    for metric_name in METRIC_DIRECTIONS:
        item = overall.get(metric_name)
        if not item:
            continue
        lines.append(
            f"- {METRIC_LABELS[metric_name]}: {item.get('runKey')} "
            f"({item.get('mode')}/{item.get('aggregation')}) = "
            f"{format_metric(metric_name, item.get('value'))}"
        )
    return lines


def render_group_best(
    *,
    title: str,
    group_mapping: Dict[str, Any],
    winner_label: str,
) -> List[str]:
    lines = [title]
    for group_name in sorted(group_mapping):
        best = (group_mapping[group_name] or {}).get("best") or {}
        if not best:
            lines.append(f"- {group_name}: no comparable metrics")
            continue

        fragments = []
        for metric_name in ("accuracy", "swap_consistency_rate", "candidate_slot_bias_score"):
            item = best.get(metric_name)
            if not item:
                continue
            fragments.append(
                f"{METRIC_LABELS[metric_name]} -> {item.get('runKey')} "
                f"({item.get(winner_label)}) {format_metric(metric_name, item.get('value'))}"
            )
        lines.append(f"- {group_name}: " + "; ".join(fragments))
    return lines


def filter_rows(
    rows: List[Dict[str, Any]],
    *,
    mode_filter: Optional[str],
    aggregation_filter: Optional[str],
) -> List[Dict[str, Any]]:
    filtered = rows
    if mode_filter:
        filtered = [
            row for row in filtered if str(row.get("mode") or "") == mode_filter
        ]
    if aggregation_filter:
        filtered = [
            row
            for row in filtered
            if str(row.get("aggregation") or "") == aggregation_filter
        ]
    return filtered


def print_text_report(
    *,
    summary_path: Path,
    summary: Dict[str, Any],
    rows: List[Dict[str, Any]],
    sort_by: str,
) -> None:
    print(f"Summary: {summary_path}")
    print(
        "Context: "
        f"split={summary.get('trainSplit')} "
        f"maxFlips={summary.get('maxFlips')} "
        f"promptFamily={summary.get('promptFamily')} "
        f"imageMode={summary.get('imageMode')}"
    )
    print("")
    for line in render_overall_best(summary):
        print(line)
    print("")
    for line in render_group_best(
        title="Best by mode:",
        group_mapping=((summary.get("comparisons") or {}).get("byMode") or {}),
        winner_label="aggregation",
    ):
        print(line)
    print("")
    for line in render_group_best(
        title="Best by aggregation:",
        group_mapping=((summary.get("comparisons") or {}).get("byAggregation") or {}),
        winner_label="mode",
    ):
        print(line)
    print("")
    print(f"Leaderboard sorted by {METRIC_LABELS[sort_by]}:")
    print(build_text_table(rows))


def render_output(
    *,
    summary_path: Path,
    summary: Dict[str, Any],
    rows: List[Dict[str, Any]],
    sort_by: str,
    output_format: str,
) -> str:
    if output_format == "json":
        return json.dumps(
            {
                "summaryPath": str(summary_path),
                "sortBy": sort_by,
                "rows": build_table_rows(rows),
            },
            indent=2,
        )
    if output_format == "markdown":
        return build_markdown_table(rows)
    if output_format == "tsv":
        return build_tsv_table(rows)
    if output_format == "csv":
        return build_csv_table(rows)

    lines: List[str] = []
    lines.append(f"Summary: {summary_path}")
    lines.append(
        "Context: "
        f"split={summary.get('trainSplit')} "
        f"maxFlips={summary.get('maxFlips')} "
        f"promptFamily={summary.get('promptFamily')} "
        f"imageMode={summary.get('imageMode')}"
    )
    lines.append("")
    lines.extend(render_overall_best(summary))
    lines.append("")
    lines.extend(
        render_group_best(
            title="Best by mode:",
            group_mapping=((summary.get("comparisons") or {}).get("byMode") or {}),
            winner_label="aggregation",
        )
    )
    lines.append("")
    lines.extend(
        render_group_best(
            title="Best by aggregation:",
            group_mapping=((summary.get("comparisons") or {}).get("byAggregation") or {}),
            winner_label="mode",
        )
    )
    lines.append("")
    lines.append(f"Leaderboard sorted by {METRIC_LABELS[sort_by]}:")
    lines.append(build_text_table(rows))
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Print a leaderboard from a FLIP human-annotation matrix summary"
    )
    parser.add_argument(
        "--summary-path",
        required=True,
        help="Path to matrix-summary.json generated by run_flip_human_annotation_matrix.py",
    )
    parser.add_argument(
        "--sort-by",
        choices=sorted(METRIC_DIRECTIONS.keys()),
        default="accuracy",
        help="Metric used for the main run table ordering",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Optional maximum number of leaderboard rows to print",
    )
    parser.add_argument(
        "--mode",
        choices=sorted(["baseline", "weight_boost", "followup_reasoning", "hybrid"]),
        help="Optional filter for one human-annotation mode",
    )
    parser.add_argument(
        "--aggregation",
        choices=["best_single", "deepfunding"],
        help="Optional filter for one aggregation mode",
    )
    parser.add_argument(
        "--format",
        choices=["text", "markdown", "tsv", "csv", "json"],
        default="text",
        help="Output format",
    )
    parser.add_argument(
        "--output",
        help="Optional output file path. When omitted, prints to stdout.",
    )
    args = parser.parse_args()

    summary_path = Path(args.summary_path).resolve()
    summary = load_json(summary_path)
    rows = filter_rows(
        coerce_rows(summary),
        mode_filter=args.mode,
        aggregation_filter=args.aggregation,
    )
    rows = sort_rows(rows, args.sort_by)
    if args.limit > 0:
        rows = rows[: args.limit]

    rendered = render_output(
        summary_path=summary_path,
        summary=summary,
        rows=rows,
        sort_by=args.sort_by,
        output_format=args.format,
    )
    if args.output:
        output_path = Path(args.output).resolve()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(rendered + ("" if rendered.endswith("\n") else "\n"), encoding="utf-8")
        print(str(output_path))
        return 0

    print(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
