const {STRICT_PROFILE, CUSTOM_LIMITS} = require('./constants')

function clamp(value, [min, max]) {
  return Math.max(min, Math.min(max, value))
}

function toInt(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function sanitizeBenchmarkProfile(payload = {}) {
  if (payload.benchmarkProfile !== 'custom') {
    return {
      ...STRICT_PROFILE,
    }
  }

  return {
    benchmarkProfile: 'custom',
    deadlineMs: clamp(
      toInt(payload.deadlineMs, STRICT_PROFILE.deadlineMs),
      CUSTOM_LIMITS.deadlineMs
    ),
    requestTimeoutMs: clamp(
      toInt(payload.requestTimeoutMs, STRICT_PROFILE.requestTimeoutMs),
      CUSTOM_LIMITS.requestTimeoutMs
    ),
    maxConcurrency: clamp(
      toInt(payload.maxConcurrency, STRICT_PROFILE.maxConcurrency),
      CUSTOM_LIMITS.maxConcurrency
    ),
    maxRetries: clamp(
      toInt(payload.maxRetries, STRICT_PROFILE.maxRetries),
      CUSTOM_LIMITS.maxRetries
    ),
    maxOutputTokens: clamp(
      toInt(payload.maxOutputTokens, STRICT_PROFILE.maxOutputTokens),
      CUSTOM_LIMITS.maxOutputTokens
    ),
  }
}

module.exports = {
  clamp,
  toInt,
  sanitizeBenchmarkProfile,
}
