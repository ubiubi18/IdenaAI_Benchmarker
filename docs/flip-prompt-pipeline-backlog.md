# FLIP Prompt And Pipeline Backlog

## Scope

This backlog is derived from the local PDF review of:

- External prompt/pipeline optimization PDF review provided by the user

It is written for the real `IdenaAI` repo, not the benchmarker. The main diagnosis from that document matches the current code findings:

- the system is not failing mainly because "vision is impossible"
- the system is still vulnerable to candidate-slot shortcuts
- prompt improvements matter, but prompt changes alone are not enough
- data presentation, inference structure, scoring, and calibration all need coordinated work

## Current State Snapshot

- Composite and native-frame FLIP dataset building exists in [scripts/prepare_flip_challenge_mlx_vlm.py](../scripts/prepare_flip_challenge_mlx_vlm.py).
- Local runtime prompt families exist in [main/ai-providers/prompt.js](../main/ai-providers/prompt.js) and [main/ai-providers/bridge.js](../main/ai-providers/bridge.js).
- Weighted ranking exists in [scripts/flip_training_ranker.py](../scripts/flip_training_ranker.py).
- Native-frame training already improved held-out accuracy versus older collapsed runs.
- The latest important failure pattern is still candidate-slot collapse, not just canonical `left/right` collapse.

## Priority 0

- [ ] Rewrite every FLIP prompt contract to make frame inspection, OCR, translation, story summary, and coherence comparison explicit.
- [ ] Randomize candidate presentation order in both training and inference, not only canonical answer remapping.
- [ ] Add explicit instrumentation to detect candidate-slot collapse in every evaluation report.
- [ ] Add a separate-candidate scoring path so the model can judge one story at a time instead of always choosing between A and B in one prompt.

## Prompt Family Rewrite

### Training Prompts

- [ ] Rewrite the native-frame training prompt in [scripts/prepare_flip_challenge_mlx_vlm.py](../scripts/prepare_flip_challenge_mlx_vlm.py).
  - Force frame-by-frame mental captioning.
  - Force OCR and translation when text is visible.
  - Force one-sentence story summaries for both candidates.
  - Force explicit coherence comparison before answering.
  - Force explicit reportability gating before allowing `skip`.
- [ ] Rewrite the composite training prompt in [scripts/prepare_flip_challenge_mlx_vlm.py](../scripts/prepare_flip_challenge_mlx_vlm.py).
  - Force panel-by-panel inspection.
  - Warn that `A/B` are arbitrary.
  - Explicitly forbid positional shortcuts.
  - Include OCR/translation instructions.
  - Include reportability instructions.
- [ ] Standardize training outputs on `a|b|skip` only.
- [ ] Add a versioned prompt-family field to every prepared dataset manifest.

### Runtime Prompts

- [ ] Rewrite the local runtime neutral A/B prompt in [main/ai-providers/bridge.js](../main/ai-providers/bridge.js).
  - Frame-by-frame inspection first.
  - OCR and translation if text exists.
  - One-sentence story summary for each candidate.
  - Coherence comparison with visible cause/effect.
  - Very short factual reasoning tied to one concrete visual cue.
- [ ] Rewrite the composite and frames single-pass prompts in [main/ai-providers/prompt.js](../main/ai-providers/prompt.js) to match the new reasoning contract.
- [ ] Rewrite the two-pass prompt family in [main/ai-providers/prompt.js](../main/ai-providers/prompt.js).
  - Pass 1 should output captions, OCR text, translations, summaries, coherence scores, and report-risk flags.
  - Pass 2 should decide from that JSON only.
- [ ] Ensure all runtime prompt families share the same reportability criteria.

## Candidate Order And Anti-Bias Augmentation

- [ ] Randomize which candidate is shown first in the native-frame input.
- [ ] Randomize which candidate is described first in the textual prompt.
- [ ] Randomize whether `OPTION A` or `OPTION B` appears first in composite prompts.
- [ ] Randomize answer-token declaration order where the model sees allowed outputs.
- [ ] Keep A/B swap augmentation as a guaranteed paired transform for every eligible training example.
- [ ] Add manifest counters for:
  - [ ] candidate-first distribution
  - [ ] candidate-second distribution
  - [ ] canonical answer distribution
  - [ ] candidate answer distribution
- [ ] Add a unit test that proves swap augmentation inverts targets correctly.
- [ ] Add a regression test that flags any dataset build where candidate position and target label are overly correlated.

## Native-Frame Pipeline

- [ ] Keep native-frame mode as the primary FLIP research path.
- [ ] Preserve original panel files for audit and resized panel copies for efficient training.
- [ ] Add a native-frame prompt family that is independent from composite assumptions.
- [ ] Add native-frame-specific augmentation that changes candidate block order without breaking within-candidate chronology.
- [ ] Add smoke tests that validate native-frame task assembly, resized assets, and candidate ordering metadata.
- [ ] Add a benchmark harness for native-frame latency on local hardware and paid GPU hardware.

## OCR And Text Handling

- [ ] Improve OCR handling for FLIP analysis, not only general screenshot chat.
- [ ] Add OCR text and translation fields into pass-1 analysis JSON.
- [ ] Add a boolean distinction between:
  - [ ] text visible
  - [ ] text required to solve
- [ ] Add tests for:
  - [ ] short labels
  - [ ] multi-language text
  - [ ] tiny overlay text
  - [ ] partially legible text
  - [ ] text-independent flips that still contain incidental words
- [ ] Add runtime logging for whether OCR influenced the final answer.

## Reportability Logic

- [ ] Encode Idena reportability rules consistently in training, runtime, and evaluation.
- [ ] Treat text-dependent solving as report-risk.
- [ ] Treat numbers, letters, arrows, and explicit order labels on images as report-risk.
- [ ] Treat inappropriate, NSFW, or graphic violence as report-risk.
- [ ] Keep `skip` as a justified exception, not a default convenience answer.
- [ ] Distinguish ambiguous flips from clearly report-worthy flips in evaluator output.
- [ ] Add report-related confusion metrics to evaluation reports.

## Separate Candidate Scoring

- [ ] Implement a candidate-only analysis mode that scores one story at a time.
- [ ] Add a prompt family that receives only one candidate and returns:
  - [ ] captions
  - [ ] OCR/translation
  - [ ] story summary
  - [ ] coherence score
  - [ ] report-risk flag
- [ ] Add deterministic comparison logic in code:
  - [ ] higher score wins
  - [ ] small gap can trigger `skip`
  - [ ] report-risk can force `skip`
- [ ] Add a tie-breaker pass only when needed.
- [ ] Add this mode to runtime solver orchestration in [main/ai-providers/bridge.js](../main/ai-providers/bridge.js).
- [ ] Add this mode to the evaluator in [scripts/evaluate_flip_challenge_mlx_vlm.py](../scripts/evaluate_flip_challenge_mlx_vlm.py).

## Bias Diagnostics

- [ ] Add `candidate_counts` to every evaluation report if not already present everywhere.
- [ ] Add a dedicated `candidate_slot_bias_score` metric.
- [ ] Add swap-run consistency evaluation:
  - [ ] run once with A then B
  - [ ] run once with B then A
  - [ ] remap both to canonical answer
  - [ ] lower confidence or return `skip` if inconsistent
- [ ] Add runtime logging for:
  - [ ] candidate chosen
  - [ ] canonical remap
  - [ ] swap plan
  - [ ] OCR used
  - [ ] report-risk triggered
- [ ] Add a diagnostic mode that estimates answer-token prior directly from repeated swapped runs.
- [ ] Add a cheap PriDe-like debug analysis to estimate and monitor option-token prior.

## Evaluation

- [ ] Evaluate every run on a fixed holdout set with the same prompt family version pinned.
- [ ] Support all evaluation modes in [scripts/evaluate_flip_challenge_mlx_vlm.py](../scripts/evaluate_flip_challenge_mlx_vlm.py):
  - [ ] composite direct
  - [ ] native direct
  - [ ] two-pass
  - [ ] separate candidate scoring
- [ ] Add per-mode comparison tables.
- [ ] Add confusion matrices for:
  - [ ] canonical answer
  - [ ] candidate answer
  - [ ] skip/report behavior
- [ ] Add calibration reports that compare confidence against correctness.
- [ ] Add strong-consensus-only and weak-consensus-only evaluation slices.
- [ ] Add report-risk slices.
- [ ] Add evaluation on side-swapped variants of the same holdout flips.

## Consensus Weighting And Confidence

- [ ] Keep strong/weak consensus weighting in [scripts/flip_training_ranker.py](../scripts/flip_training_ranker.py).
- [ ] Extend prepared examples with confidence targets derived from vote margin where feasible.
- [ ] If moving to structured-output SFT, add confidence as a trained field instead of prompt-only free text.
- [ ] Penalize weak-consensus examples in calibration reports.
- [ ] Compare weighted vs unweighted vs confidence-supervised runs on the same holdouts.

## Training Data Builder

- [ ] Add explicit fields to prepared examples:
  - [ ] `promptFamily`
  - [ ] `candidatePresentationOrder`
  - [ ] `candidateAnswer`
  - [ ] `canonicalAnswer`
  - [ ] `reportRisk`
  - [ ] `reportReason`
  - [ ] `trainingWeight`
  - [ ] `consensusStrength`
  - [ ] `votesLeft`
  - [ ] `votesRight`
  - [ ] `votesReported`
- [ ] Ensure every swapped example stores the relationship to its original example.
- [ ] Validate that every augmentation keeps audit metadata intact.
- [ ] Add build-time integrity checks for duplicated or contradictory examples.

## Local Runtime And UX

- [ ] Add AI settings toggles for:
  - [ ] direct solve
  - [ ] caption-first solve
  - [ ] separate candidate scoring
  - [ ] strict reportability mode
- [ ] Show a compact debug summary in validation mode:
  - [ ] candidate chosen
  - [ ] canonical answer
  - [ ] confidence
  - [ ] report-risk
  - [ ] OCR used
- [ ] Add a developer-only panel to inspect the exact prompt family used for a solve.
- [ ] Add a sample-flip benchmark page or panel for quick regression checks without entering validation flow.

## Ensembles

- [ ] Only build ensembles from meaningfully different voters.
- [ ] Include at least one caption-first path in ensemble experiments.
- [ ] Include separate-candidate scoring as one ensemble voter.
- [ ] Track per-voter calibration and disagreement.
- [ ] Penalize ensemble confidence when voters disagree on canonical answer after swap normalization.
- [ ] Compare naive vote aggregation against historically calibrated weighting.

## Training Infrastructure

- [ ] Keep MLX for smoke runs and lightweight local experiments.
- [ ] Port the FLIP training path to a Linux/CUDA trainer for cloud GPUs.
- [ ] Mirror prompt families and augmentation logic between MLX and CUDA trainers.
- [ ] Keep evaluation output format identical between local and cloud paths.
- [ ] Add run presets for:
  - [ ] smoke
  - [ ] medium subset
  - [ ] full corpus
  - [ ] native-frame heavy
- [ ] Add cost-tracking hooks for paid runs.

## Research And Documentation

- [ ] Expand [docs/flip-reasoning-paper-optimizations.md](./flip-reasoning-paper-optimizations.md) into a maintained summary of what has been implemented versus what remains.
- [ ] Add a document explaining candidate-slot bias and why canonical left/right balance is insufficient.
- [ ] Add a document explaining reportability logic and how it differs from ambiguity.
- [ ] Add a document describing the canonical evaluation protocol so runs remain comparable.
- [ ] Add a "known failure patterns" note with concrete examples:
  - [ ] always B
  - [ ] always second slot
  - [ ] overuse of skip
  - [ ] OCR-triggered false reports

## Suggested Execution Order

1. Rewrite prompt families.
2. Implement true candidate presentation randomization in training and inference.
3. Add bias diagnostics and swap consistency checks.
4. Implement separate candidate scoring.
5. Re-evaluate existing adapters under the new diagnostics.
6. Launch the next serious native-frame training run.
7. Add ensemble calibration and cloud/CUDA parity.

## Definition Of Done For The Next Meaningful Milestone

- No prompt family still relies on implicit candidate-position hints.
- Candidate-slot bias is explicitly measured in every evaluation report.
- At least one inference path scores candidates separately rather than voting A-vs-B directly.
- Swap-run consistency is implemented and logged.
- A native-frame run improves held-out accuracy without collapsing to one candidate slot.
