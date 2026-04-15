# FLIP Training Ranking Architecture

This document defines the intended training-ranking architecture for `IdenaAI`.

## Goal

The FLIP training pipeline must support two distinct data sources:

1. **Historical FLIP-Challenge data**
   - source: `aplesner-eth/FLIP-Challenge`
   - purpose: broad base training on older consensus-labeled flips

2. **Modern session data**
   - source: flips collected from recent/current epochs
   - purpose: adapt the local model to the current validation environment

The ranking logic used for training must live inside `IdenaAI` and must **not**
depend on external community scripts going forward.

Those repositories remain useful references for:
- signal discovery
- field naming
- leaderboard ideas
- manual verification

But they are not part of the runtime dependency chain.

## Source priority

For **modern flips**, ranking must follow this source order:

1. **Own local node / own local indexer** (primary)
2. **Public indexer** (fallback only)

The public indexer is allowed only when the local collector is unavailable or
incomplete. It must never be the required default dependency for modern ranking.

## Why a local indexer is needed

Direct node RPC is the authoritative local source, but not every training and
ranking signal is exposed in a ready-made form from plain RPC responses.

Modern training needs a local collector/indexer layer that can aggregate:
- per-flip metadata
- per-author penalty history
- consensus/reward-related signals
- local node state

and normalize all of that into a stable internal schema.

## Unified training schema

Historical and modern examples should share one manifest format:

- `schema_version`
- `source.kind`
- `source.name`
- `source.priority`
- `flip_hash`
- `cid`
- `tx_hash`
- `block`
- `epoch`
- `author`
- `consensus_label`
- `consensus_strength`
- `votes_left`
- `votes_right`
- `votes_reported`
- `grade_score`
- `grade`
- `status`
- `wrong_words_votes`
- `short_resp_count`
- `long_resp_count`
- `with_private_part`
- `author_bad_reason`
- `author_bad_wrong_words`
- `author_repeat_report_offenses`
- `author_extra_flip_count`
- `training_weight`
- `excluded`
- `exclusion_reason`

Historical examples may not populate every field, but the field layout should
still be stable so the trainer does not need separate code paths per source.

## Weighting policy

Modern flips should use weighted training, not flat training.

### Positive signals

- strong consensus
- high `gradeScore`
- qualified or weakly qualified status
- low report pressure
- low wrong-words pressure
- clean author history

### Negative signals

- author appears in `Authors/Bad` with `WrongWords`
- many reported votes
- many wrong-words votes
- repeated report/problem history for the author
- extra-flip behavior from the author in the epoch

## Exclusion toggles

The Local AI settings should eventually expose explicit policy switches such as:

- exclude bad authors
- exclude repeat report offenders
- downweight extra flips
- require qualified/weakly qualified status
- prefer local node ranking over public fallback

These toggles should shape `training_weight` and `excluded` decisions rather
than force one global hardcoded rule.

## Current implementation status

Implemented now:
- internal ranking helper:
  - `scripts/flip_training_ranker.py`
- historical FLIP-Challenge prep now emits normalized training metadata:
  - `scripts/prepare_flip_challenge_mlx_vlm.py`
- modern local-node-first collector:
  - `scripts/collect_modern_flip_training_candidates.py`
- default Local AI ranking-policy shape:
  - `renderer/shared/utils/local-ai-settings.js`

Not implemented yet:
- weighted loss consumption inside the trainer
- Local AI settings UI for ranking/exclusion controls

## Practical rule

Going forward:

- do not call the external ranking scripts from the training pipeline
- do not make modern training depend on those repos
- use internal `IdenaAI` code for ranking and normalization
- use the external repos only as reference material when matching or validating
  signal definitions
