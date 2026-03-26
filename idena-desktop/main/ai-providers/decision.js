function extractJsonBlock(rawText) {
  const text = String(rawText || '').trim()
  if (!text) {
    throw new Error('Empty provider response')
  }

  const full = text.match(/\{[\s\S]*\}/)
  if (!full) {
    throw new Error('Provider response does not contain JSON')
  }

  return JSON.parse(full[0])
}

function normalizeAnswer(answer) {
  const value = String(answer || '')
    .trim()
    .toLowerCase()

  if (['left', 'l', '1'].includes(value)) {
    return 'left'
  }

  if (['right', 'r', '2'].includes(value)) {
    return 'right'
  }

  return 'skip'
}

function normalizeConfidence(confidence) {
  const value = Number(confidence)
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.min(1, value))
}

function normalizeDecision(parsed) {
  return {
    answer: normalizeAnswer(parsed && parsed.answer),
    confidence: normalizeConfidence(parsed && parsed.confidence),
    reasoning:
      typeof (parsed && parsed.reasoning) === 'string'
        ? parsed.reasoning.slice(0, 240)
        : undefined,
  }
}

function stripDataUrl(dataUrl) {
  const value = String(dataUrl || '')
  const match = value.match(/^data:(.*?);base64,(.*)$/)
  if (!match) {
    throw new Error('Image payload must be a base64 data URL')
  }

  return {
    mimeType: match[1] || 'image/png',
    data: match[2],
  }
}

module.exports = {
  extractJsonBlock,
  normalizeAnswer,
  normalizeConfidence,
  normalizeDecision,
  stripDataUrl,
}
