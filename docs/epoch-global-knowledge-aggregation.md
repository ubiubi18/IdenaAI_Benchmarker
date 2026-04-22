# Epoch Global Knowledge Aggregation Idea

## Status

This document is an idea capture only.

- It is not committed product scope.
- It is not a training requirement.
- It is meant to preserve the concept and a possible implementation backlog
  for later review.

## Problem

The current Local AI and human-teacher work is strong on bounded, explicit
supervision, but it is still mostly centered on flip tasks and local model
behavior.

There is a separate problem:

- how to retain broad model capabilities over time
- how to patch areas where the model is uncertain without blindly ingesting web
  noise
- how to turn user uncertainty signals into higher-quality global knowledge
  inputs

The idea here is to add a parallel `global knowledge` path that runs once per
epoch and stays separate from ordinary user memory.

## Core Idea

When the AI cannot answer a user question confidently without a hallucination
risk, it should be allowed to mark that question as a candidate for later human
review.

That candidate question can then enter an epoch-bounded committee flow:

1. collect unresolved or weakly answered questions from many user sessions
2. de-duplicate and rank them by usefulness
3. ask a committee of humans to answer independently
4. require short reasoning and optional sources
5. aggregate the responses into a structured, evidence-aware knowledge record
6. package those records into a per-epoch `global knowledge pack`
7. expose that pack for retrieval by local or global AI systems
8. optionally distill the pack into later training runs

The important design choice is that `training is optional`.

The first value comes from:

- uncertainty capture
- human curation
- structured aggregation
- retrieval with provenance

Training on top of that can happen later if quality and trust are high enough.

## Why This Exists

This idea tries to preserve useful capabilities without depending only on:

- a larger base model
- raw web ingestion
- naive majority voting

It also keeps a hard distinction between:

- `personal memory`: what one user cares about
- `global knowledge`: reusable, cross-user factual or conceptual context

One meaningful user prompt per session can help personalization, but it is not
enough to maintain world knowledge. This proposal focuses on the second part.

## Design Principles

### 1. Start from model uncertainty

The collection loop should begin when the model knows it is weak, uncertain, or
likely to hallucinate.

Examples:

- the answer would require current world knowledge
- the question is niche and underrepresented
- the model generated multiple competing answers
- the system classified the answer as low-confidence or poorly grounded

### 2. Prefer human-curated evidence over raw web ingestion

Humans may search the web, but the system should store:

- the human answer
- the reasoning
- the cited sources
- the uncertainty

That is better than ingesting one scraped web fact per session.

### 3. Keep answers independent before aggregation

Committee members should answer independently to reduce anchoring and herd
effects.

### 4. Aggregate claims, not just final sentences

The system should compare:

- which claims agree
- which claims conflict
- what evidence supports each claim
- which committee members are historically well calibrated

### 5. Treat the result as a knowledge pack first

The first stable output should be an epoch-level artifact that can be retrieved,
audited, versioned, and rejected if quality is poor.

Training should consume only approved packs, and only if explicitly enabled.

## Proposed Flow

### Phase 1. Session-level capture

During normal use, the AI may emit an internal unresolved-question record when:

- it declined to answer
- it answered with low confidence
- the user corrected a weak answer
- the answer required external grounding the local runtime did not have

Each session may contribute at most a bounded number of unresolved questions.
A strict option is:

- `max 1 global-knowledge candidate per session`

This keeps the queue useful and limits spam.

### Phase 2. Epoch queue building

At epoch boundaries, the system builds a candidate queue by:

- de-duplicating semantically similar questions
- removing low-signal or private questions
- clustering related questions into topics
- ranking by frequency, utility, and capability impact

The output is an `epoch unresolved question set`.

### Phase 3. Committee answering

Selected questions are sent to human committee members.

Each answer should include:

- proposed answer
- confidence score
- short reasoning
- optional citations
- open uncertainty or counterarguments

Humans who do not know the answer may search the web, but the final stored unit
is still the human-curated answer package, not raw scraped text.

### Phase 4. Aggregation

The committee output is turned into a structured record:

- canonical question
- competing claims
- consensus answer if strong
- disagreement summary if unresolved
- evidence list
- source provenance
- calibration weights
- confidence score
- quality flags

This becomes one item in the epoch `global knowledge pack`.

### Phase 5. Distribution and use

The `global knowledge pack` can be:

- retrieved locally during inference
- shared across trusted nodes
- pinned by content hash
- versioned per epoch
- filtered by domain or trust score

### Phase 6. Optional training

If enabled, a later training or distillation job may consume approved knowledge
packs.

This is intentionally optional because retrieval may already provide most of the
benefit without risking irreversible model contamination.

## Suggested Artifact Model

Each epoch may produce:

- `epoch-unresolved-question-set.json`
- `epoch-committee-answer-pack.jsonl`
- `epoch-global-knowledge-pack.json`
- `epoch-global-knowledge-eval.json`

High-level fields for a knowledge item:

- `knowledge_id`
- `epoch`
- `domain`
- `question`
- `normalized_question`
- `consensus_status`
- `answer_summary`
- `claims[]`
- `counterclaims[]`
- `evidence[]`
- `committee_responses[]`
- `source_refs[]`
- `confidence`
- `calibration_weight`
- `retrieval_enabled`
- `training_eligible`
- `training_enabled`

`training_enabled` should default to `false`.

## Quality And Safety Constraints

### Human committee is not automatic truth

The committee should improve curation, but it should not be treated as an
infallible oracle.

Failure modes:

- repeated social bias
- shared bad sources
- coordinated manipulation
- majority error on niche topics
- false certainty on ambiguous questions

### Required safeguards

- independent answering before discussion
- provenance for factual claims
- per-member calibration tracking
- domain-specific trust weights
- explicit `unresolved` state when agreement is weak
- rejection of low-quality or citation-free packs for training use

### Privacy boundary

Questions sourced from user sessions should be normalized before entering the
global queue.

The global knowledge path should avoid:

- private user data
- personally identifying details
- secret prompts
- session-specific sensitive context

## Relationship To Existing Work

This idea extends, but should remain separate from:

- [docs/human-teacher-annotation-architecture.md](./human-teacher-annotation-architecture.md)
- [docs/federated-human-teacher-protocol.md](./federated-human-teacher-protocol.md)
- [docs/local-ai-mvp-architecture.md](./local-ai-mvp-architecture.md)

Those documents are currently closer to task supervision, annotation, and
federated model update flows. This proposal is about capability retention and
global knowledge refresh.

## Backlog Tasks

These tasks are intentionally staged so the system can deliver value before any
training step exists.

### Phase A. Capture and queueing

- [ ] Add an unresolved-question schema for session-level capture.
- [ ] Add a low-confidence / hallucination-risk signal in the local runtime
      pipeline.
- [ ] Store unresolved questions in bounded local epoch storage.
- [ ] Add de-duplication and semantic clustering for unresolved questions.
- [ ] Add filters to strip private or session-specific details before queueing.
- [ ] Add ranking logic for `frequency`, `novelty`, `capability impact`, and
      `retrieval value`.

### Phase B. Human committee flow

- [ ] Define a committee answer schema with answer, confidence, reasoning, and
      citations.
- [ ] Build export tooling for an epoch unresolved-question set.
- [ ] Build import tooling for committee answer packs.
- [ ] Enforce independent answering before any aggregation step.
- [ ] Add per-member calibration tracking and historical quality scoring.
- [ ] Add support for `unresolved`, `contested`, and `consensus` outcomes.

### Phase C. Knowledge aggregation

- [ ] Define the epoch global knowledge pack schema.
- [ ] Implement claim-level aggregation instead of sentence-level averaging.
- [ ] Add provenance and evidence normalization.
- [ ] Add confidence scoring for each aggregated knowledge item.
- [ ] Add quality gates that can block low-trust items from retrieval or
      training eligibility.
- [ ] Add content-hash versioning so packs can be pinned and shared safely.

### Phase D. Retrieval integration

- [ ] Add a retrieval path that can query epoch knowledge packs during local
      inference.
- [ ] Allow domain filtering such as science, politics, art, or general
      knowledge.
- [ ] Surface provenance and confidence to the model at retrieval time.
- [ ] Add ranking that prefers newer, higher-confidence, better-supported
      entries.
- [ ] Add a toggle to disable global knowledge retrieval entirely.

### Phase E. Evaluation

- [ ] Build a benchmark from previously unresolved questions.
- [ ] Measure whether retrieval from knowledge packs reduces hallucinations.
- [ ] Measure whether capability retention improves across epochs.
- [ ] Track precision, disagreement rate, and citation coverage.
- [ ] Compare committee-curated packs against plain web retrieval.

### Phase F. Optional training and distillation

- [ ] Add a config gate so training from knowledge packs is explicitly opt-in.
- [ ] Mark each knowledge item with `training_eligible` separately from
      `retrieval_enabled`.
- [ ] Build a distillation/export format from approved knowledge items.
- [ ] Require evaluation wins before enabling any training on these packs.
- [ ] Support `retrieval-only mode` as the default deployment posture.
- [ ] Keep a rollback path so knowledge-pack training can be disabled without
      affecting retrieval.

## Initial Recommendation

If this idea is pursued later, the safest order is:

1. uncertainty capture
2. committee answer collection
3. epoch knowledge pack aggregation
4. retrieval-only use
5. evaluation
6. optional training only after quality is demonstrated

That sequence keeps the system useful even if training is never enabled.

## Open Questions

- Should unresolved questions be collected automatically, or only when the user
  explicitly opts in?
- Should the committee be open to all nodes, reputation-gated, or identity
  bounded?
- Should some domains require stronger evidence thresholds than others?
- Should one question per session be mandatory, optional, or only triggered by
  model uncertainty?
- Should local nodes be allowed to keep private knowledge packs that never
  enter a shared global flow?
