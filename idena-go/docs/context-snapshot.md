# Context Snapshot (Chain)

## Branch and commits
- Branch: `research/benchmark-chain`
- Latest commit:
  - `3736460` `docs: reanchor chain plan to v1.1.2 and ui-first sequencing`

## Anchor
- Upstream: `v1.1.2`

## Current state
- No chain consensus code changes yet.
- Plan and worklog docs initialized.

## Next protocol implementation targets
1. Previous-epoch eligibility (`>95%`) for mining and flip publishing.
2. Report-count suspension (`>1` reported flip in session, configurable).
3. Bootstrap ramp (`80 -> 90 -> 95`) to avoid early stall.
4. Deterministic enforcement in mempool/block validation and proposer checks.
5. RPC exposure for desktop:
   - `previousEpochScore`
   - `canMineNextEpoch`
   - `canPublishFlipsNextEpoch`
   - `suspendedByReportedFlips`
