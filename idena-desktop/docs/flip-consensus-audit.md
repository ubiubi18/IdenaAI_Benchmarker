# FLIP Consensus Audit

This utility audits local AI test-unit runs against FLIP-Challenge human consensus.

## Inputs
- Run summaries:
  - `~/Library/Application Support/Idena/ai-benchmark/test-unit-runs.jsonl`
- Per-flip model outputs:
  - `~/Library/Application Support/Idena/ai-benchmark/session-metrics.jsonl`
- FLIP-Challenge parquet data with `agreed_answer`:
  - `.tmp/flip-challenge/data/*.parquet`

## Command
```bash
cd $WORKSPACE/idena-desktop
python3 scripts/audit_flip_consensus.py --run-index -1 --parquet-dir .tmp/flip-challenge/data
```

## Output
- JSON report path (auto-generated):
  - `~/Library/Application Support/Idena/ai-benchmark/audits/audit-<timestamp>.json`
- Printed summary fields:
  - `matched`
  - `labeled`
  - `answered`
  - `correct`
  - `accuracy_labeled`
  - `accuracy_answered`
  - `skipped`
  - `rate_limit_errors`

## Notes
- `accuracy_labeled` treats skipped flips as not-correct on labeled items.
- `accuracy_answered` evaluates only flips where model answered `left`/`right`.
- For older runs, use `--run-index` (e.g. `-2`) to audit previous entries.
