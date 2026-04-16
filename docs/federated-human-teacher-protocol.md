# Federated Human-Teacher Protocol Draft

This document turns the current `IdenaAI` human-teacher and federated-update
ideas into one concrete protocol draft.

It is still a draft, but it is intentionally specific enough to guide:

- app storage and export formats
- committee-side verification logic
- on-chain commitment shape
- future contract and P2P transport work

This protocol is anchored to the current repository direction:

- human-teacher annotation is explicit, bounded, and post-consensus
- local training uses small adapter-style deltas
- transport of large artifacts is identity-gated and manifest-driven
- consensus should converge to one canonical network model per round

It does **not** assume anonymous open model exchange.

## Versioning

- Protocol id: `idenaai-federated-human-teacher`
- Draft version: `1`
- Artifact hashes: `sha256`
- Round id format: `epoch-<epoch>-round-<sequence>`

## Goal

For each round, the network should produce exactly one canonical result:

- one accepted annotation pool hash
- one accepted committee attestation hash
- one approved global adapter hash
- one approved distribution manifest hash

Local nodes may train temporary personal adapters, but those are not network
truth. Only the approved round result is canonical.

## Actors

### 1. Contributors

Real Idena identities that:

- annotate post-consensus flips
- optionally train local adapters from those annotations
- submit annotation bundles and optionally adapter bundles

### 2. Committee

A bounded verifier set that:

- validates submissions against the round manifest
- rejects malformed, contradictory, or abusive contributions
- aggregates accepted annotation bundles
- either retrains or approves the next canonical adapter
- signs the round attestation

### 3. Seeders

Peers that distribute approved artifacts only after the committee result is
anchored.

## Canonical protocol decision

`v1` is **annotation-led**, not adapter-averaging-led.

That means:

- annotation submissions are the primary consensus object
- adapter submissions are optional supporting artifacts
- the committee is allowed to use accepted adapters as diagnostics, baselines,
  or merge candidates
- but the canonical `nextGlobalAdapterHash` is produced by a committee-approved
  training run over the accepted annotation pool

This avoids order-dependent drift and keeps the network result deterministic.

Direct peer adapter averaging can be added later as `v2`, but it should not be
the initial consensus rule.

## Round structure

Each round is tied to one epoch and one parent canonical model state.

### Phase 0. Round announcement

The round starts with a signed round manifest that defines:

- `roundId`
- `epoch`
- `parentRoundHash`
- `baseModelHash`
- `parentGlobalAdapterHash`
- `benchmarkManifestHash`
- `annotationSchemaHash`
- submission deadlines
- committee set or committee set hash
- merge policy id

No submission is valid unless it references this exact round manifest hash.

### Phase 1. Annotation collection

Contributors produce normalized annotation bundles from:

- post-consensus real session flips
- or approved developer/test slices if the round explicitly allows them

Requirements:

- no raw image payloads in long-lived federated artifacts
- task ids must resolve to the round’s approved flip/task universe
- each row must include final answer and short human rationale

### Phase 2. Local training

Contributors may train local adapters against:

- the parent global adapter
- the accepted round base model
- local human-teacher annotations

Local training is optional. A contributor may submit:

- annotation bundle only
- adapter bundle only
- or both

### Phase 3. Submission freeze

After the submission deadline:

- no new annotation bundles are accepted
- no new adapter bundles are accepted
- the committee freezes the candidate set by hash

### Phase 4. Committee verification

The committee verifies submissions, aggregates accepted annotations, and
produces:

- accepted annotation manifest
- accepted adapter manifest
- committee attestation

### Phase 5. Canonical training / selection

For `v1`, the committee produces the canonical adapter by:

1. building one accepted annotation pool
2. training from the parent model state with a published training recipe
3. evaluating on the frozen benchmark manifest
4. selecting the best committee-approved run

Adapter submissions from contributors can still be evaluated and ranked, but
they do not directly become canonical unless the round policy explicitly allows
that.

### Phase 6. On-chain commitment

The network anchors only compact hashes on-chain:

- round manifest hash
- accepted annotation manifest hash
- accepted adapter manifest hash
- committee attestation hash
- next global adapter hash
- distribution manifest hash

### Phase 7. Distribution

After on-chain commitment, peers may distribute:

- the approved global adapter
- the approved distribution manifest
- any approved auxiliary metadata

using the identity-gated transport model from
[docs/federated-model-distribution.md](docs/federated-model-distribution.md).

## Annotation submission format

Annotation submissions are **data-first** and **privacy-constrained**.

Required properties:

- bound to one `roundManifestHash`
- signed by the contributor identity
- contain only normalized annotation rows or their artifact hash
- reference known `taskId` / `sampleId` / `flipHash`
- include local provenance fields but no raw flip bytes

Core annotation row fields:

- `task_id`
- `sample_id`
- `flip_hash`
- `epoch`
- `final_answer`
- `why_answer`
- `text_required`
- `sequence_markers_present`
- `report_required`
- `report_reason`
- optional richer fields:
  - `frame_captions`
  - `option_a_summary`
  - `option_b_summary`
  - `confidence`

Submission-level policy:

- one identity can submit at most one annotation bundle per round per bundle id
- duplicate rows for the same task are allowed across different identities
- raw panel images, `data:` URLs, RLP payloads, or private/public hex blobs are
  forbidden

## Adapter submission format

Adapter submissions are **artifact manifests**, not entire model dumps.

They must reference:

- `baseModelHash`
- `parentGlobalAdapterHash`
- `roundManifestHash`
- `trainingConfigHash`
- `adapterSha256`

They must also include:

- evaluation summary against the round benchmark manifest
- artifact metadata
- governance / audit metadata
- identity signature

Allowed adapter artifact types for `v1`:

- LoRA / PEFT-style adapter deltas
- other small mergeable deltas only if the round manifest explicitly allows
  them

Forbidden for `v1`:

- full base-weight uploads as consensus submissions
- opaque, unverifiable training outputs with no benchmark summary

## Merge rules

### Annotation merge rule

The committee constructs one canonical annotation pool:

1. reject invalid bundles
2. group rows by `task_id`
3. keep only rows that match the round task universe
4. compute annotator weighting from:
   - chain consensus agreement
   - internal consistency
   - prior committee-approved reputation
5. merge repeated rows per task with the round’s configured aggregation method

Default `v1` aggregation:

- `best_single` if there is not enough multi-annotator coverage
- `deepfunding` weighted merge when enough repeated annotations exist

The merged output for each task is exactly one canonical training row.

### Adapter merge rule

For `v1`, adapter submissions are **ranked and verified**, but the next
canonical adapter is produced by committee retraining from the accepted
annotation pool.

So the `v1` merge rule is:

- do **not** average arbitrary peer adapters directly
- use accepted adapters only as:
  - evidence
  - ablation baselines
  - optional committee candidate runs

This keeps consensus deterministic and avoids order-sensitive drift.

### Future `v2` adapter aggregation

If direct adapter aggregation is introduced later, the minimum rule should be:

- same `baseModelHash`
- same `parentGlobalAdapterHash`
- same `trainingConfigHash`
- benchmark deltas above threshold
- outlier rejection by norm and metric deviation
- deterministic merge weights published in the round attestation

But that is explicitly out of scope for `v1`.

## Committee verification

The committee verifies every submission against the round manifest.

Minimum checks:

- schema valid
- identity valid and allowed
- signature valid
- round hash matches
- no forbidden raw payload fields
- artifact hashes match declared hashes
- contributor not excluded by round governance rules
- benchmark summary present for adapter bundles

Additional checks for annotations:

- task ids exist in round universe
- answer format valid
- rationale fields present
- no impossible duplicates inside one bundle

Additional checks for adapters:

- adapter artifact exists
- base / parent hashes match the round
- benchmark summary references the correct benchmark manifest
- metrics are internally consistent

Committee threshold:

- a bundle is accepted only if the round policy threshold is reached
- recommended default: `2/3` of committee signatures

The committee attestation must include:

- accepted bundle ids
- rejected bundle ids with reasons
- annotation aggregation summary
- next canonical adapter hash
- benchmark result summary
- committee signature list

## On-chain hashes and manifests

Only hashes and compact commitments should go on-chain.

### Required on-chain commitments

- `roundManifestHash`
- `acceptedAnnotationManifestHash`
- `acceptedAdapterManifestHash`
- `committeeAttestationHash`
- `nextGlobalAdapterHash`
- `distributionManifestHash`

### Optional on-chain commitments

- `acceptedAnnotationRowRoot`
- `acceptedContributorSetHash`
- `benchmarkResultHash`
- `committeeSetHash`

### Off-chain manifests

The heavy objects remain off-chain:

- round manifest JSON
- annotation bundle manifests
- adapter bundle manifests
- committee attestation JSON
- distribution manifest JSON
- artifact chunk manifests

The on-chain layer anchors truth; the off-chain layer carries detail.

## Determinism requirements

To keep AI consensus stable:

- one round manifest hash defines the round
- one accepted annotation manifest hash defines the training pool
- one committee attestation hash defines the verifier result
- one next global adapter hash defines the next public AI state

Nodes may keep personal local adapters, but those do not define canonical
network state.

## Submission policy summary

### Annotation-only contributor

- submits normalized annotation bundle
- no adapter needed
- still influences canonical next round through the annotation pool

### Annotation + adapter contributor

- submits normalized annotation bundle
- optionally submits adapter bundle and eval summary
- adapter may influence committee evaluation, but canonical `v1` still comes
  from committee-approved retraining

## Interaction with current repository code

This draft is designed to fit the repository’s current direction:

- `main/local-ai/manager.js`
  human-teacher collection and normalized annotation export
- `main/local-ai/federated.js`
  metadata-first update bundle logic and audit/governance fields
- `scripts/*human_teacher*`
  normalization and training-prep flow

The current bundle helper already contains useful fields such as:

- base model hash
- adapter hash
- training config hash
- governance metadata
- redundancy policy fields

The next implementation step should be to evolve those fields toward the schema
files linked below instead of inventing a second incompatible bundle format.

## Schema files

- [docs/protocol/federated-round-manifest.schema.json](protocol/federated-round-manifest.schema.json)
- [docs/protocol/annotation-submission.schema.json](protocol/annotation-submission.schema.json)
- [docs/protocol/adapter-submission.schema.json](protocol/adapter-submission.schema.json)
- [docs/protocol/committee-attestation.schema.json](protocol/committee-attestation.schema.json)
- [docs/protocol/on-chain-round-commitment.schema.json](protocol/on-chain-round-commitment.schema.json)

## Recommended implementation order

1. Freeze round manifest format.
2. Freeze annotation bundle format.
3. Add committee attestation generation and verification.
4. Bind `main/local-ai/federated.js` bundle fields to the adapter schema.
5. Anchor compact round commitments on-chain.
6. Only then add real network transport and committee execution.
