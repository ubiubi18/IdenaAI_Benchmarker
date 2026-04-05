# Fork Plan (Chain) - Anchor `idena-go v1.1.2`

## Anchor and branch
- Upstream tag: `v1.1.2`
- Branch: `research/benchmark-chain`

## Sequencing decision
- Desktop UI-first AI-helper implementation is prioritized before chain consensus changes.
- Chain work starts immediately after desktop AI-helper MVP is functional and testable.

## Implemented compatibility prerequisite
- Added macOS arm64 build path for `v1.1.2` with WASM enabled by wiring `idena-go` to a local `idena-wasm-binding` module that includes `libidena_wasm_darwin_arm64.a`.
- Desktop inbuilt node can now compile locally on Apple Silicon without disabling WASM execution.
- Setup and rebuild procedure documented in `docs/wasm-arm64-setup.md`.

## Planned chain implementation (next stage)
1. Separate chain identity and bootstrap configuration namespace for benchmark fork.
2. Previous-epoch eligibility enforcement:
   - mine allowed only if previous epoch score `> 0.95`
   - flip publishing allowed only if previous epoch score `> 0.95`
3. Report-based suspension:
   - suspend when `reportedFlipsInSession > 1` (configurable threshold, default `1`).
4. Bootstrap ramp to avoid chain stall:
   - epoch 1-3: `> 80%`
   - epoch 4-6: `> 90%`
   - epoch 7+: `> 95%`
5. Deterministic enforcement at proposer checks, tx validation/mempool, and block validation.
6. RPC exposure for desktop:
   - `previousEpochScore`
   - `canMineNextEpoch`
   - `canPublishFlipsNextEpoch`
   - `suspendedByReportedFlips`
