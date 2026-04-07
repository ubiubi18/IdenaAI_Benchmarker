# Third-Party Notices

This repository is a bundled research workspace, not a single-license upstream
project. Review this file before preparing a public release.

| Component                                            | Path                               | License / notice                                                                                                            |
| ---------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Active desktop app fork and AI benchmark helper code | `main/`, `renderer/`, root scripts | MIT. See `LICENSE` and `LICENSES/MIT.txt`.                                                                                  |
| Idena node source snapshot                           | `idena-go/`                        | LGPL-3.0. See `idena-go/LICENSE` and `LICENSES/LGPL-3.0.txt`.                                                               |
| Idena wasm Go binding snapshot                       | `idena-wasm-binding/`              | LGPL-3.0. See `idena-wasm-binding/LICENSE` and `LICENSES/LGPL-3.0.txt`.                                                     |
| Idena wasm runtime source snapshot                   | `idena-wasm/`                      | Bundled source snapshot. Verify upstream license metadata before publishing a formal binary release.                        |
| Sample flip data                                     | `samples/flips/`                   | Research sample material bundled for reproducibility. Verify distribution constraints before public dataset redistribution. |

## Release Notes

- Keep component license files in place when distributing this bundle.
- Do not describe the entire repository as MIT-only.
- Large static libraries in `idena-wasm-binding/lib/` may be better handled via
  release artifacts or Git LFS for a polished public release.
- The active Electron desktop app currently lives at the repository root; the
  historical `idena-desktop/` folder layout is no longer the active app path.
