const LEGACY_HEURISTIC_PROVIDER = 'legacy-heuristic'
const LEGACY_HEURISTIC_MODEL = 'legacy-heuristic-v1'
const LEGACY_HEURISTIC_STRATEGY = 'legacy-heuristic'

function clamp01(value) {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.min(1, value))
}

function normalizeAnswer(answer) {
  const value = String(answer || '')
    .trim()
    .toLowerCase()
  if (value === 'left') return 'left'
  if (value === 'right') return 'right'
  return 'skip'
}

function normalizeFrames(value) {
  if (!Array.isArray(value)) {
    return []
  }
  return value.map((item) => String(item || '').trim()).filter(Boolean)
}

function base64Payload(dataUrl) {
  const text = String(dataUrl || '')
  const match = text.match(/^data:(.*?);base64,(.*)$/)
  return match && match[2] ? match[2] : text
}

function frameFingerprint(frameDataUrl) {
  const data = base64Payload(frameDataUrl)
  if (!data) {
    return []
  }

  const buckets = 16
  const step = Math.max(1, Math.floor(data.length / buckets))
  const fingerprint = []

  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const start = bucket * step
    const end = Math.min(data.length, start + step)
    if (start >= end) {
      fingerprint.push(0)
    } else {
      let sum = 0
      for (let index = start; index < end; index += 3) {
        sum += data.charCodeAt(index)
      }
      fingerprint.push((sum % 1024) / 1024)
    }
  }

  return fingerprint
}

function distance(a, b) {
  const left = Array.isArray(a) ? a : []
  const right = Array.isArray(b) ? b : []
  const length = Math.min(left.length, right.length)
  if (length <= 0) {
    return 1
  }

  let total = 0
  for (let index = 0; index < length; index += 1) {
    total += Math.abs((left[index] || 0) - (right[index] || 0))
  }
  return clamp01(total / length)
}

function mean(values) {
  if (!Array.isArray(values) || !values.length) {
    return 0
  }
  return values.reduce((acc, value) => acc + value, 0) / values.length
}

function variance(values, average) {
  if (!Array.isArray(values) || !values.length) {
    return 0
  }
  return (
    values.reduce((acc, value) => {
      const delta = value - average
      return acc + delta * delta
    }, 0) / values.length
  )
}

function continuityScore(frames) {
  const prepared = normalizeFrames(frames).slice(0, 4)
  if (prepared.length < 2) {
    return null
  }

  const fingerprints = prepared.map((frame) => frameFingerprint(frame))
  const deltas = []
  for (let index = 0; index < fingerprints.length - 1; index += 1) {
    deltas.push(distance(fingerprints[index], fingerprints[index + 1]))
  }

  if (!deltas.length) {
    return null
  }

  const averageDelta = mean(deltas)
  const deltaVariance = variance(deltas, averageDelta)
  const disorder = clamp01(averageDelta + Math.sqrt(deltaVariance) * 0.5)
  const score = clamp01(1 - disorder)

  return {
    score,
    averageDelta,
    deltaVariance,
    frameCount: prepared.length,
  }
}

function hashScore(value) {
  const text = String(value || '')
  let score = 17
  for (let index = 0; index < text.length; index += 1) {
    score = (score * 131 + text.charCodeAt(index)) % 2147483647
  }
  return score
}

function chooseDeterministicSide(hash) {
  return hashScore(hash) % 2 === 0 ? 'left' : 'right'
}

function solveLegacyHeuristicDecision({flip}) {
  const left = continuityScore(flip && flip.leftFrames)
  const right = continuityScore(flip && flip.rightFrames)

  if (left && right) {
    const delta = left.score - right.score
    const absDelta = Math.abs(delta)
    const answer = delta >= 0 ? 'left' : 'right'
    const confidence = clamp01(0.52 + Math.min(0.33, absDelta * 0.7))

    return {
      answer: normalizeAnswer(answer),
      confidence,
      reasoning: `legacy heuristic continuity left=${left.score.toFixed(
        3
      )} right=${right.score.toFixed(3)} delta=${delta.toFixed(3)}`,
    }
  }

  const fallback = chooseDeterministicSide(flip && flip.hash)
  return {
    answer: fallback,
    confidence: 0.51,
    reasoning:
      'legacy heuristic fallback (missing frame-level payload), deterministic side pick',
  }
}

module.exports = {
  LEGACY_HEURISTIC_PROVIDER,
  LEGACY_HEURISTIC_MODEL,
  LEGACY_HEURISTIC_STRATEGY,
  solveLegacyHeuristicDecision,
}
