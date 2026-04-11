# Flip Format Reference (Desktop AI Test Unit)

## Source paths
- `$WORKSPACE/IdenaAI/renderer/shared/api/dna.js`
- `$WORKSPACE/IdenaAI/renderer/screens/flips/utils.js`
- `$WORKSPACE/IdenaAI/renderer/screens/validation/machine.js`
- `$WORKSPACE/IdenaAI/renderer/screens/validation/ai/test-unit-utils.js`
- `$WORKSPACE/IdenaAI/idena-go/api/flip_api.go`

## Protocol-side request/response shapes

### `flip_submit` request payload (desktop -> node)
```json
{
  "publicHex": "0x...",
  "privateHex": "0x...",
  "pairId": 0
}
```

How those hex values are built in desktop (`flipToHex`):
- `publicHex = rlp([firstTwoImagesAsBytes])`
- `privateHex = rlp([lastTwoImagesAsBytes, orders])`

### `flip_get` response payload (node -> desktop)
```json
{
  "hex": "0x...",
  "privateHex": "0x..."
}
```

Desktop decode behavior (`decodeFlip`):
- if `privateHex` exists and is not `0x`:
  - decode `publicHex || hex` as public image list
  - decode `privateHex` as `[privateImages, orders]`
- else:
  - decode `hex` as `[images, orders]`

## Accepted JSON input for AI Test Unit

### 1) AI-ready format
```json
[
  {
    "hash": "local-1",
    "leftImage": "data:image/png;base64,...",
    "rightImage": "data:image/png;base64,..."
  }
]
```

### 2) Protocol-style decrypted format
```json
[
  {
    "hash": "Qm...",
    "hex": "0x...",
    "privateHex": "0x..."
  }
]
```

or

```json
[
  {
    "hash": "Qm...",
    "publicHex": "0x...",
    "privateHex": "0x..."
  }
]
```

### 3) Decoded format
```json
[
  {
    "hash": "decoded-1",
    "images": [
      "data:image/png;base64,...",
      "data:image/png;base64,...",
      "data:image/png;base64,...",
      "data:image/png;base64,..."
    ],
    "orders": [
      [0, 1, 2, 3],
      [1, 2, 3, 0]
    ]
  }
]
```

## Accepted wrapper envelopes
- raw array: `[...]`
- object list: `{ "flips": [...] }`
- RPC single result: `{ "result": { ...flipObject... } }`
- RPC result list: `{ "result": [...] }`
- RPC nested list: `{ "result": { "flips": [...] } }`
- map payload: `{ "flipA": { ...flipObject... }, "flipB": { ...flipObject... } }`

## Important caveat
- Encrypted raw flip blobs from `flip_getRaw` are not directly usable for AI solving unless decrypted first.
