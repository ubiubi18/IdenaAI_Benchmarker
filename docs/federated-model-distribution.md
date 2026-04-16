# Federated Model Distribution

This note describes the intended transport layer for distributing large
`IdenaAI` base models and smaller global adapters in a decentralized way
without turning the network into an open CDN.

It is a protocol direction, not a finished implementation.

## Goal

The long-term system should let real Idena identities:

- discover the currently approved base model and adapter hashes
- request missing model artifacts from peers
- download those artifacts over chunked P2P transport
- avoid anonymous abuse and obvious DDoS patterns

At the same time, it should avoid spamming the public social communication layer
with technical model-sync messages.

## Core Idea

Full base-weight download rights should not be public or anonymous.

Instead, the right to request a full base model should be tied to:

- a real Idena identity
- an allowed identity status
- a paid or otherwise rate-limited request message
- a strict per-epoch quota

That gives the system three protections at once:

- identity gating
- economic anti-spam friction
- a public or verifiable audit trail

## Separate Contract

The normal `idena.social` contract should not become a dumping ground for
technical model-distribution posts.

The preferred design is a dedicated contract or protocol-specific channel for
federated AI coordination. That separate contract should carry only structured
technical requests such as:

- current approved model manifest hash
- base-model download requests
- adapter/update announcements
- seeder availability or relay metadata
- signed artifact manifests

This keeps human communication and social discussion separate from machine-sync
traffic.

## Access Policy

P2P model downloads should be allowed only for identities with one of these
statuses:

- `Newbie`
- `Verified`
- `Suspended`
- `Human`

Anonymous peers or identities without valid status should not be allowed to
request large model artifacts.

The access policy can still be tiered:

- `Newbie`: base model allowed, but with tighter bandwidth limits
- `Verified` and `Human`: normal model-download rights
- `Suspended`: optional reduced rights, depending on policy

## Download Rights

The system should separate artifact classes:

- **Base model weights**
  Large, rarely changing artifacts. Most protected.
- **Global adapters**
  Small, frequently changing artifacts. Easier to distribute.
- **Manifests and metadata**
  Tiny artifacts. Cheap to fetch and validate.

Suggested quota policy:

- full base model: `1-2` downloads per identity per epoch
- global adapter: much higher limit
- manifests: effectively unrestricted inside reason

## Request Flow

For a full base-model download, the requester should:

1. Prove control of an Idena identity.
2. Publish a structured download request in the dedicated AI contract.
3. Include the requested base-model hash and current epoch.
4. Wait for a seeder to validate the request and start transfer.

The request should contain at least:

- requester address
- current epoch
- requested `baseModelHash`
- expected `adapterHash` or manifest hash
- optional client version
- nonce or unique request id
- signature

## Seeder Verification

A serving peer should only send large artifacts after checking:

- identity exists and is in an allowed status
- request targets the current approved artifact hash
- request is recent enough
- request quota for that identity has not been exceeded
- local serving budget still allows new transfers

The seeder should also maintain local abuse controls:

- per-identity byte budget
- per-IP or per-subnet budget
- cooldown after repeated failures
- local blocklist for pathological peers

## Transport Rules

Even with identity-gated requests, base weights should not be streamed as one
unbounded blob.

Use:

- content-addressed immutable chunks
- chunk hashes in a signed manifest
- resumable chunk requests
- bounded parallel chunk downloads
- verification after every chunk

That keeps transfers restartable and makes corruption or malicious tampering
easy to reject.

## What Should Be Canonical

Consensus should not be about arbitrary peer weights. The network should only
download artifacts that correspond to an approved manifest.

The canonical state should be:

- `baseModelHash`
- `globalAdapterHash`
- manifest version
- evaluation manifest hash
- optional committee signature or on-chain commitment

P2P is only the transport layer. Consensus about which model is current happens
outside of the transport layer.

## Why This Is Better Than Open Download

An open public endpoint would let anyone:

- request large weights repeatedly
- consume peer bandwidth for free
- turn volunteer nodes into a public mirror

The identity-and-fee-gated model makes abuse much harder because an attacker
would need:

- many real Idena identities
- enough `iDNA` or contract budget to publish requests
- enough epoch quota to keep downloading at scale

That is a much healthier fit for Idena than anonymous artifact serving.

## Early-Stage Practical Version

Before distributing full large base models widely, a simpler first version
should be:

- distribute the base model only rarely, from a smaller seeder set
- distribute small adapters more often through identity-gated P2P
- keep requests tied to the separate AI contract
- keep model manifests signed and immutable

That reduces bandwidth pressure while the protocol is still young.

## Not Implemented Yet

This note does not mean these features already exist. The repository still
needs:

- a dedicated contract or coordination channel for AI sync
- request schema and signature verification
- model manifest format
- chunking and resumable transfer logic
- quota enforcement
- seeder policy controls
- integration with Idena identity status checks

Until then, this document is the target architecture for secure federated model
distribution.
