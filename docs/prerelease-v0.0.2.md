# IdenaAI v0.0.2 prerelease note

This is a source-level prerelease note only. No formal GitHub release, tag, or
binary package was prepared as part of this update.

The note covers the push window from April 12, 2026 to April 13, 2026
(`Europe/Berlin`) and explains what the recent GitHub pushes were about before
the visible app version was renamed to `IdenaAI v0.0.2`.

## What changed overall

The last 48 hours were mainly about four areas:

- turning the fork into a cleaner standalone desktop app with its own runtime
  paths and current Electron baseline
- integrating Local AI review and training-package flows
- embedding and then hardening `idena.social` inside the desktop app
- fixing the vendored contract test path so it works with Node 20 and
  `idena-go v1.1.2`

## Push summary by theme

### 1. Embedded social integration and follow-up UI fixes

Early April 12, 2026 pushes focused on getting `idena.social` embedded inside
the desktop app and then making it usable on desktop layouts:

- `9e82942` integrated local `idena.social` into the app
- `662070b`, `6b1fe22`, `9affa62`, `c01c64f`, `9b019b6`, `d5b1521`, and
  `30e2036` were follow-up layout and UX fixes for width, responsiveness,
  composer behavior, post actions, and history fallback
- `31dc7b5` later rebased the embedded integration onto upstream
  `idena.social v4.0.0` and `idena.social-ui v10.0.2`

In practice, this was a rapid iteration cycle: integrate first, then fix the
desktop UX, then update the embedded upstream versions.

### 2. Local AI package review and research tooling

Another set of April 12, 2026 pushes added and refined Local AI package review
flows and supporting project docs:

- `cacdc5e` added Local AI MVP docs, wiring, and research-index updates
- `786019e` added the Local AI training package review and export UI
- `b0feddc` added local review status for AI training packages
- `61719f1` added a federated-ready marker for approved AI packages
- `46431d7` pushed the remaining Local AI integration changes
- `84e0732` refreshed the deep research index

These pushes were about turning the AI tooling from an experiment into a more
coherent review/export workflow.

### 3. Desktop runtime modernization

Several pushes on April 12, 2026 tightened the base desktop runtime itself:

- `97366b6` modernized the desktop runtime for current macOS in IdenaAI
- `ae2dc5e` fixed preload timing for invite storage
- `ce4091a` isolated IdenaAI app data and bootstrap behavior from the benchmark
  fork
- `9808ece` refreshed defaults and Electron runtime docs
- `b3a31e6` fixed Electron 9 install reproducibility on Apple Silicon for
  compatibility with older install paths still referenced by the repo history

This group was about making the fork act like its own app instead of a thin
overlay on top of the benchmark workspace.

### 4. Contract test and toolchain fixes

The vendored smart-contract test path also received two focused fixes on
April 12, 2026:

- `0f5d96e` fixed the contract test toolchain on Node 20
- `e5124fc` fixed the local contract runner path so the vendored suite works
  with `idena-go v1.1.2`

That work replaced the fragile external-runner assumption with a bundled local
runner flow for the vendored `idena.social-contract` tests.

### 5. Security and RPC hardening on April 13, 2026

The April 13, 2026 push sequence was mostly a hardening pass on the Electron
bridge, node startup path, and embedded social RPC handling:

- `003af12` hardened the Electron bridge and Local AI inputs
- `67966c2` broadened the desktop feed and assisted node peers
- `35ebe69` proxied embedded social traffic through the desktop host
- `b8c0482` restricted the embedded RPC proxy surface
- `3721423` moved the embedded social RPC proxy into the main process
- `4fa5649` proxied renderer node calls through main
- `ae17125` stopped trusting the renderer's internal RPC key
- `c5dcd32` restored the built-in node startup bridge after the main-process
  rerouting and trust reduction

This sequence was not random churn. It was a layered rewrite to move sensitive
node and RPC behavior away from renderer trust and back behind main-process
controlled boundaries.

## Why this became v0.0.2

`v0.0.2` marks the first source snapshot in this fork where all of the
following are present together:

- the standalone IdenaAI runtime/data-path split
- the Local AI review/export work from April 12, 2026
- the updated embedded `idena.social` stack
- the Node 20 plus `idena-go v1.1.2` contract test fixes
- the April 13, 2026 bridge and RPC hardening pass

Again, this is only a documented source snapshot. No real public release was
prepared from it.
