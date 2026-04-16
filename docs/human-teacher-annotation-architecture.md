# Human Teacher Annotation Architecture

This is the first practical slice of the "humans as teacher" path for `IdenaAI`.

## Goal

Use small post-consensus batches of real session flips as a decentralized human teaching loop:

- each epoch exports a bounded batch such as `20-30` flips
- each flip already has blockchain consensus, so the final answer is anchored
- humans contribute richer supervision:
  - per-panel captions
  - candidate-story summaries
  - text-required / sequence-marker flags
  - reportability judgment
  - short explanation of the final answer

The model should learn from these richer explanations instead of learning only `left/right/skip` shortcuts.

## Privacy model

The existing Local AI capture index remains metadata-only by default.

The new human-teacher path is explicit opt-in:

1. validation capture stores safe metadata only
2. human-teacher package build fetches the local-node flip payloads on demand
3. exported task bundles decode those payloads into panel PNGs outside the app database

That keeps raw images out of the long-lived capture index while still allowing human annotation when the operator requests it.

## New package type

The app now supports a reviewable package under:

- `local-ai/human-teacher/epoch-<epoch>-tasks.json`

Package properties:

- `packageType = local-ai-human-teacher-tasks`
- `reviewStatus = draft|reviewed|approved|rejected`
- `annotationReady = true` only when approved
- `items` are bounded and sorted for human review, default batch size `30`

Each item contains:

- flip identity and epoch metadata
- consensus answer and strength
- local-node payload path
- training weight / ranking source
- safe word metadata
- annotation hints and pending status

## Export / import workflow

### 1. Build the app package

Use the Local AI manager path:

- `buildHumanTeacherPackage({epoch, batchSize, includePackage})`

Recommended defaults:

- `batchSize: 30`
- `fetchFlipPayloads: true`
- `requireFlipPayloads: true`
- `rankingPolicy.sourcePriority: local-node-first`

### 2. Export human tasks

```bash
node scripts/export_human_teacher_tasks.js \
  --package-path /absolute/path/to/epoch-123-tasks.json \
  --output-dir /absolute/path/to/human-teacher-epoch-123 \
  --take 30
```

Output:

- `tasks.jsonl`
- `annotations.template.jsonl`
- per-task folders with:
  - `panel-1.png` .. `panel-4.png`
  - `README.md` with instructions and the annotation JSON template

### 3. Collect human annotations

Humans fill rows based on `annotations.template.jsonl`.

Required reasoning fields:

- `frame_captions[4]`
- `option_a_summary`
- `option_b_summary`
- `text_required`
- `sequence_markers_present`
- `report_required`
- `final_answer`
- `why_answer`

### 4. Normalize imports

```bash
python3 scripts/import_human_teacher_annotations.py \
  --task-manifest /absolute/path/to/human-teacher-epoch-123/tasks.jsonl \
  --annotations-jsonl /absolute/path/to/annotated.jsonl \
  --output-jsonl /absolute/path/to/human-teacher-epoch-123/normalized.jsonl
```

The normalized output is the stable interface for later training ingestion.

## What this solves now

- real epoch-bounded human teaching batches
- safe default capture storage
- explicit payload-backed export for annotation
- stable import format for future training integration

## What is still missing

- in-app annotation UI
- direct training ingestion of normalized human annotations
- conflict resolution / aggregation across multiple annotators
- reward accounting for decentralized annotation work

## Recommended next step

Train against normalized human-teacher labels on a small gold subset before scaling more AI-teacher distillation.
