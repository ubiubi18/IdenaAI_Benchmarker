# Fork Plan (Desktop) - UI-First AI Benchmark

## Anchors and branches
- `idena-go`: `v1.1.2` on `research/benchmark-chain`
- `idena-desktop`: `v0.39.1` on `research/benchmark-desktop`

## Locked scope for current milestone
- UI-first implementation starts in `idena-desktop`.
- Provider support: OpenAI + Gemini.
- Benchmark modes:
  - strict default (fixed session budget and bounded requests)
  - custom research mode (overrides with metadata logging)
- API keys are session-only by default (in-memory, not persisted to settings).

## Implemented in this step
1. Main-process AI bridge and provider adapters.
2. Renderer settings state for `aiSolver` profile.
3. New settings route `/settings/ai` for provider/model/profile/key management.
4. Validation short-session AI helper integration:
   - one-click solve button
   - optional auto-run per short session (`session-auto` mode)
5. Local benchmark metrics logging in user data.

## Next desktop steps
1. Add explicit benchmark warning banner in global layout (not only settings screen).
2. Add validation UI cards showing provider/model/latency outcome per flip.
3. Add adapter tests and orchestration deadline tests.
4. Add export/import format for local benchmark logs.

## Next chain steps (after desktop MVP)
1. Implement previous-epoch eligibility in `idena-go v1.1.2`:
   - `canMineNextEpoch`
   - `canPublishFlipsNextEpoch`
2. Implement report suspension rule (`reportedFlipsInSession > 1`, configurable).
3. Implement bootstrap ramp config and enforcement points.
4. Extend RPC identity payload fields for desktop visibility.
