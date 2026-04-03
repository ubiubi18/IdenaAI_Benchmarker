# FLIP-Challenge Import (Hugging Face)

## Source dataset
- https://huggingface.co/datasets/aplesner-eth/FLIP-Challenge

## Purpose
Convert FLIP-Challenge parquet data into the desktop AI test-unit JSON format accepted by:
- `Settings -> AI Test Unit -> Load JSON file`

Output format:
```json
{
  "flips": [
    {
      "hash": "_flip_...",
      "images": ["data:image/...;base64,...", "...", "...", "..."],
      "orders": [[...], [...]],
      "expectedAnswer": "left|right|skip",
      "expectedStrength": "Strong|Weak"
    }
  ]
}
```

`expectedAnswer` is used by the AI benchmark UI to compute post-run success rate.

## Import script
- `$WORKSPACE/idena-desktop/scripts/import_flip_challenge.py`

## One-time dependency
```bash
python3 -m pip install --user pyarrow
```

## Example imports
Generate first 200 test flips:
```bash
cd $WORKSPACE/idena-desktop
python3 scripts/import_flip_challenge.py --split test --max-flips 200 --output data/flip-challenge-test-200-decoded.json
```

Generate next chunk (200-399):
```bash
cd $WORKSPACE/idena-desktop
python3 scripts/import_flip_challenge.py --split test --skip-flips 200 --max-flips 200 --output data/flip-challenge-test-200-to-399-decoded.json
```

Generate multiple chunks:
```bash
cd $WORKSPACE/idena-desktop
for SKIP in 0 200 400 600 800; do
  if [ "$SKIP" -eq 0 ]; then
    OUT="data/flip-challenge-test-200-decoded.json"
  else
    OUT="data/flip-challenge-test-${SKIP}-to-$((SKIP+199))-decoded.json"
  fi
  python3 scripts/import_flip_challenge.py --split test --skip-flips "$SKIP" --max-flips 200 --output "$OUT"
done
```

## UI import workflow
1. Start desktop app.
2. Open `Settings -> AI Test Unit`.
3. Click `Load JSON file` and select one chunk file.
4. Click `Add JSON to queue`.
5. Repeat with more chunks.
6. Run with `Run queue`.

## Practical note
- Each 200-flip chunk is roughly `38-44 MB`.
- Chunked import is recommended to avoid UI freezes and long single-run parse/compose times.

## Imported locally in this workspace
Generated files under:
- `$WORKSPACE/idena-desktop/data`

Current test split exports:
- `flip-challenge-test-200-decoded.json`
- `flip-challenge-test-200-to-399-decoded.json`
- `flip-challenge-test-400-to-599-decoded.json`
- `flip-challenge-test-600-to-799-decoded.json`
- `flip-challenge-test-800-to-999-decoded.json`
- `flip-challenge-test-1000-to-1199-decoded.json`
- `flip-challenge-test-1200-to-1399-decoded.json`
- `flip-challenge-test-1400-to-1599-decoded.json`
- `flip-challenge-test-1600-to-1799-decoded.json`

Total converted test flips in these chunks: `1752`.
