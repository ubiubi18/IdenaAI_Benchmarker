# Audit Manifest

Snapshot date: 2026-03-26

## Component origins

### idena-desktop
- Upstream base tag: `v0.39.1`
- Working branch name used during development: `research/benchmark-desktop`
- Snapshot includes local branch modifications.

### idena-go
- Upstream base tag: `v1.1.2`
- Working branch name used during development: `research/benchmark-chain`
- Snapshot includes local branch modifications.
- Contains replace directive:
  - `replace github.com/idena-network/idena-wasm-binding => ../idena-wasm-binding`

### idena-wasm-binding
- Included as source + static artifacts for reproducible builds.
- Included arm64 artifact checksum:
  - `lib/libidena_wasm_darwin_arm64.a`
  - sha256: `39d6a3a217d6d11f6d6719cfb8a44851ecb5f5d5781b90242f8dbb0ee6df8e20`

### idena-wasm
- Included as source for rebuilding wasm artifacts.

## Notes

- Local caches/build artifacts are intentionally excluded.
- This bundle is for audit/review and reproducibility, not a security-certified release.
- ChatGPT connector/deep-research indexing can be regenerated with:
  - `python3 scripts/build_chatgpt_connector_index.py`
  - output: `docs/chatgpt-connector-index.json`
