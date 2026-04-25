# IdenaAI Benchmarker NOT PRODUCTION READY, DONT USE!

`IdenaAI` is an experimental desktop fork of `idena-desktop` focused on:
- local and hosted AI integration
- FLIP solving, generation, and benchmarking research
- human-teacher annotation flows
- local runtime and training experiments tied to the desktop app
- validation rehearsal tooling for safer local protocol testing

This is research software, not a hardened wallet release.

## Experimental Warning

Read this part first.

- no warranties
- not audited
- work in progress
- experimental software with breaking changes, wrong behavior, and rough edges
- not suitable for valuable identities, funds, unattended automation, or blind trust
- do not install or run this if you do not understand what it is doing
- use throwaway or low-value Idena addresses only
- do not attach valuable identities to this fork
- use it only on a secured system you control
- do your own research before trusting anything here
- ask an AI agent or a human reviewer to audit the repo and adapt it to your own needs before relying on it

If you are not comfortable reviewing diffs, debugging broken flows, reading logs,
and accepting the possibility of incorrect results, do not use this build.

## Latest Changes

This section should stay current and act as a short roadmap of what has already landed.

- Live Metrics:
  local benchmark/session traces are written under `userData/ai-benchmark/`,
  including `session-metrics.jsonl` and local audit output files.
- Validation rehearsal devnet:
  the app now exposes a private multi-node rehearsal network in `Settings -> Node`
  with seeded FLIP-Challenge flips, background start, restart/stop controls,
  and app-only rehearsal switching.
- Rehearsal validation gating:
  the app now waits until the primary rehearsal node has actually been assigned
  validation hashes before allowing the handoff into validation, and the node
  panel shows assigned short/long-session flip counts on that primary node.
- Rehearsal failure handling:
  if a rehearsal run still reaches short session with no visible validation
  flips, the validation screen now exposes an explicit fresh-restart path
  instead of leaving the user in a silent `0 / 0` dead-end.
- Session-auto validation:
  once enabled, the app is now closer to true no-touch ceremony handling, with
  automatic route entry, provider-readiness retries during validation, ceremony-
  aware AI timing checks, and long-session auto-submit fallback when delayed AI
  report review is unavailable or misses its window.
- Fast report deadline mode:
  automatic report review now reserves the final 3 minutes of long session for a
  fast path. If the countdown is already below that threshold, the app skips
  extra keyword waiting, runs report-review requests in parallel, uses short
  provider timeouts, and still falls back to answer submission if review fails.
- Short/long autosolver timing:
  short session can solve all six flips in parallel, while long session keeps a
  staggered queue so completed answers are applied immediately and slow provider
  calls do not block the rest of the run.
- Validation AI fallback and telemetry:
  uncertain flips now escalate into an annotated frame-review second pass before
  the solver gives up, and unresolved flips are forced into an explicit random
  fallback vote that is surfaced in AI benchmark telemetry together with first-
  pass traces, reasoning, token usage, and price estimates where available.
- Rehearsal result review:
  rehearsal runs now expose end-of-session benchmark stats, optional audit/review
  flows, persistent human annotations by flip hash, and validation AI cost
  tracking on the post-session dashboard.
- Early local-results access:
  once long-session reporting starts, the app now exposes local stats and
  benchmark audit immediately instead of forcing the user to wait through the
  full realistic ceremony tail first; those local results pages stay live while
  the countdown continues and can jump back into validation at any time.
- OpenAI short-session fast mode:
  the app now supports an optional short-session-only OpenAI fast lane using
  `service_tier=priority` and `reasoning_effort=none`, with a visible fallback
  notice if the API shape is rejected or Priority is not actually applied. That
  fallback only affects short session; long session stays on the normal plan.
- Local AI preparations:
  managed runtime trust gating, loopback-only runtime auth, RAM estimation work,
  and pinned manifest verification now cover the active research lanes for
  `Molmo2-O`, `Molmo2-4B`, `InternVL3.5-1B`, and `InternVL3.5-8B`, with the
  lighter `InternVL3.5-1B` lane now validated as a realistic same-provider
  managed-runtime candidate.
- Safety posture:
  none of the above changes make the project production-safe. The repo remains a
  research fork first.

## Current Stage

Current project posture:
- the desktop app is usable for research and controlled local experiments
- AI features remain explicitly experimental
- local AI is still an embryo-stage base-layer effort, not a settled product lane
- no local AI path in this repo should be treated as audited or production-safe
- validation rehearsal support exists to shorten iteration loops, not to guarantee correctness

What works today:
- AI settings and runtime controls inside the app
- provider-based solving, benchmarking, and AI-assisted FLIP generation
- optional short-session-only OpenAI fast mode with a visible fallback back to
  the normal OpenAI plan if the provider API no longer accepts the fast-lane
  request shape
- in-app human-teacher annotation flows and demo/test paths
- local benchmark/session logging for traceability
- managed on-device runtime preparation for current research candidates
- local rehearsal-network controls inside the node settings page
- session-auto validation is now intended to manage ceremony route entry and
  long-session completion without manual babysitting once provider setup is
  genuinely ready
- urgent auto-report is expected to switch into the fast parallel review path
  whenever less than 3 minutes remain in long session
- local FLIP research scripts in `scripts/`

What is still not production-ready:
- packaged end-user release quality
- stable local-model defaults
- unattended on-chain AI automation
- federated-learning / networked training workflows
- polished first-run UX across all local-runtime paths
- a final approved bundled local model strategy

## Live Metrics

The app keeps local benchmark and validation-related metrics so experiments are easier to inspect.

- main local metrics path: `userData/ai-benchmark/`
- key log file: `userData/ai-benchmark/session-metrics.jsonl`
- local audits are written under `userData/ai-benchmark/audits/`
- test-unit queue and run artifacts also live under the same local directory

On macOS, this typically resolves under:

```text
~/Library/Application Support/Idena/ai-benchmark/
```

Treat these files as experimental diagnostics:
- schemas may still change
- entries may be incomplete during crashes or interrupted runs
- do not build production assumptions on top of them yet

## Validation Rehearsal Devnet

The repo now includes an isolated validation rehearsal path inside the desktop app.

What it is:
- a private local multi-node Idena network for rehearsal runs
- seeded with FLIP-Challenge flips for local short-session practice
- separate from mainnet and intended for protocol-flow testing

What you can do from `Settings -> Node`:
- start and use the rehearsal network immediately
- start it in the background without switching the app over yet
- restart a fresh rehearsal network
- stop the rehearsal network

Behavior notes:
- the app can connect to the rehearsal node for the current app session only
- that rehearsal connection is transient and should not overwrite your normal saved node settings
- the app exposes live status and rehearsal-network logs in the same settings panel
- the app now waits for assigned validation hashes on the primary rehearsal node
  before switching into validation, instead of handing over as soon as the
  private network merely looks alive
- the node settings screen shows assigned short/long-session flip counts on the
  primary rehearsal node so the handoff state is visible
- if a rehearsal run still enters validation without flips, the validation page
  should now offer a restart path instead of hanging indefinitely in a silent
  `0 / 0` waiting state
- short-session AI results now remain visible briefly after submission so the
  benchmark telemetry can still be inspected before the UI switches into long
  session
- long-session AI telemetry now shows per-flip decision traces, including raw
  skips, reprompt frame-review passes, random fallback votes, and reasoning
  summaries for those decisions
- rehearsal results can be audited afterwards, or skipped in one click and
  revisited later, with annotations stored for later local-training research
- local stats and benchmark annotation can now open during the long-session
  countdown as soon as reporting is available, instead of only after the full
  post-session wait has ended
- those local results and annotation screens now refresh live from persisted
  validation state while the countdown is still running
- this is still experimental and can still break in edge cases

## Local AI Preparations

Local AI is deliberately conservative right now.

- there is still no permanently approved bundled local base model
- the managed local runtime is a research path, not a final endorsement
- first use asks for an explicit one-time trust approval before installing and starting managed runtime components
- the managed runtime is loopback-only and token-gated
- trusted runtime files and model shards are verified before startup
- RAM estimation and reserve controls are now part of the local-runtime setup flow

Prepared research lanes currently include:
- `allenai/Molmo2-O-7B` as the main managed research runtime
- `allenai/Molmo2-4B` as a more compact managed fallback
- `OpenGVLab/InternVL3_5-1B-HF` as the light same-provider alternative
- `OpenGVLab/InternVL3_5-8B-HF` as a heavier experimental alternative

Advanced users can still point the app at their own local-only:
- Ollama runtime
- MLX / MLX-VLM setup
- Transformers-based server
- `vLLM` endpoint

In short: local AI experiments are enabled, but the broader local-model direction is still being evaluated.

## Session-Auto Validation

`session-auto` is meant to reduce or remove ceremony babysitting, but it is
still experimental and should not be blindly trusted.

Current intended behavior:
- auto-route into the validation flow when the real ceremony reaches the right phase
- retry provider-readiness checks during the session instead of depending on a
  single lucky startup check
- optionally use an OpenAI-only short-session fast lane with Priority
  processing and reduced reasoning effort, while automatically degrading to the
  normal OpenAI plan if the API shape changes or fast-lane handling is rejected
- refuse late AI runs when too little short- or long-session time remains
- escalate uncertain flips into an annotated frame-review second pass instead of
  silently leaving them as skips
- if a flip still cannot be resolved after that second pass, apply a random
  fallback vote and record that fact in telemetry rather than hiding the outcome
- submit long-session answers automatically even when delayed AI report review is
  disabled, unsupported, or fails
- start automatic report review early enough to keep a 3-minute safety window;
  inside that window, use the fast report path with parallel calls, no keyword
  wait loop, no retries, and shorter provider timeouts

Current limitation:
- short session is still the hardest window to hit reliably because image fetch,
  node readiness, and model latency all compete with protocol timing
- you should still assume short-session automation can miss under bad network,
  slow provider, or reconnect-heavy conditions

## Safety and Privacy

Treat this repository as test software and assume mistakes are possible.

Recommended precautions:
- use a low-value or disposable Idena identity
- do not attach valuable identities, valuable wallets, or long-lived production secrets
- keep provider budgets small
- prefer a separate machine, VM, or OS user profile
- use only a secured system you control
- review AI-generated flips manually before publishing on-chain
- review local runtime downloads and diffs before trusting them
- ask an AI agent to audit your local branch and adjust it to your own threat model

If human annotations are later used for shared training, those contributions may
become part of propagated model artifacts. Only contribute material you have the
right to share.

## Install and Run from Source

Prerequisites:
- `git`
- `node` 20.x
- `npm`
- `python3`

On macOS:

```bash
xcode-select --install
brew install git node@20 python@3
brew link --overwrite --force node@20
```

Clone and start:

```bash
git clone https://github.com/ubiubi18/IdenaAI.git
cd IdenaAI
npm install
npm start
```

Optional build:

```bash
npm run build
npm run dist
```

For explicit macOS targets on Apple Silicon:

```bash
npm run pack:mac:arm64
npm run pack:mac:universal
```

Useful checks:

```bash
npm run audit:privacy
npm run audit:electron
npm test
```

## Training Workflow

The local FLIP training stack remains in the repo for research.

It currently supports:
- FLIP-Challenge dataset prep from Hugging Face
- human-teacher annotation import
- local LoRA pilot training experiments
- matrix comparison of baseline vs human-assisted modes
- side-by-side comparison of `best_single` vs `deepfunding`

Important limitation:
- no approved bundled local training base model is currently endorsed by the project

Start here:
- [docs/flip-challenge-local-training.md](docs/flip-challenge-local-training.md)

Related notes:
- [docs/local-ai-mvp-architecture.md](docs/local-ai-mvp-architecture.md)
- [docs/federated-model-distribution.md](docs/federated-model-distribution.md)
- [docs/federated-human-teacher-protocol.md](docs/federated-human-teacher-protocol.md)

## Large bundled artifacts

This repo intentionally carries large static libraries in `idena-wasm-binding/lib/` for reproducible local builds.

It also carries the chunked `samples/flips/flip-challenge-human-teacher-500-balanced.part-*.json` rehearsal sample shards. Those shards keep the local validation rehearsal and benchmark loop reproducible without requiring a network fetch, while staying below GitHub's hard per-file limit.

If public release packaging becomes more formal later:
- keep those files under review before every tag
- consider Git LFS or external release artifacts if the bundle grows further
- make sure `THIRD_PARTY_NOTICES.md` ships with any redistributed binary bundle

## Development History

Very short overview:
- `Phase 1`: desktop fork created to explore AI inside `idena-desktop`
- `Phase 2`: human-teacher annotation and local training research were added
- `Phase 3`: provider benchmarking, solving, and generation were separated from local-model-training semantics
- `Phase 4`: the old local base-model direction was reset and the project returned to embryo stage for local AI while `Molmo2-O` and alternative managed lanes are evaluated
- `Phase 5`: local rehearsal devnet controls, live metrics, and explicit managed-runtime preparation lanes were added to tighten the research loop inside the app

## Related Repo

If you mainly want the off-chain benchmark and training fork, use:
- [IdenaAI_Benchmarker](https://github.com/ubiubi18/IdenaAI_Benchmarker)

## License

MIT. See [LICENSE](LICENSE).
