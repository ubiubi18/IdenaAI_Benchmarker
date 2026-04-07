# Third-Party Notices

This repository is a bundled community research workspace, not a single-license
upstream project. Review this file before preparing a public release.

| Component                                             | Path                               | License / notice                                                                                                            |
| ----------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Active desktop app fork from upstream `idena-desktop` | `main/`, `renderer/`, root scripts | MIT. Keep the original 2020 Idena copyright notice. See `LICENSE` and `LICENSES/MIT.txt`.                                   |
| Community AI benchmark/helper modifications           | `main/`, `renderer/`, root scripts | MIT. Copyright 2026 ubiubi18 and contributors. Created as prompt-driven community research work; not independently audited. |
| Idena node source snapshot                            | `idena-go/`                        | LGPL-3.0. See `idena-go/LICENSE` and `LICENSES/LGPL-3.0.txt`.                                                               |
| Idena wasm Go binding snapshot                        | `idena-wasm-binding/`              | LGPL-3.0. See `idena-wasm-binding/LICENSE` and `LICENSES/LGPL-3.0.txt`.                                                     |
| Idena wasm runtime source snapshot                    | `idena-wasm/`                      | Bundled source snapshot. Verify upstream license metadata before publishing a formal binary release.                        |
| Sample flip data                                      | `samples/flips/`                   | Research sample material bundled for reproducibility. Verify distribution constraints before public dataset redistribution. |

## Release Notes

- Keep component license files in place when distributing this bundle.
- Do not describe the entire repository as MIT-only.
- Do not remove the original Idena MIT copyright notice from upstream desktop
  code.
- The 2026 ubiubi18 MIT notice covers community modifications to the extent the
  contributors own those modifications; it does not relicense LGPL components.
- Large static libraries in `idena-wasm-binding/lib/` may be better handled via
  release artifacts or Git LFS for a polished public release.
- A cleaner release can avoid bundling `idena-go/`, `idena-wasm/`, and
  `idena-wasm-binding/` snapshots and instead document how to fetch/build those
  upstream components separately.
