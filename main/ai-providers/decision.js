function tryParseJson(value) {
  try {
    return JSON.parse(value)
  } catch (error) {
    return null
  }
}

function findJsonBlockEnd(text, startIndex) {
  const opening = text[startIndex]
  const openingToClosing = {
    '{': '}',
    '[': ']',
  }
  const firstClosing = openingToClosing[opening]
  if (!firstClosing) return -1

  const stack = [firstClosing]
  let inString = false
  let isEscaped = false

  for (let index = startIndex + 1; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (isEscaped) {
        isEscaped = false
      } else if (char === '\\') {
        isEscaped = true
      } else if (char === '"') {
        inString = false
      }
    } else if (char === '"') {
      inString = true
    } else if (char === '{') {
      stack.push('}')
    } else if (char === '[') {
      stack.push(']')
    } else if (char === '}' || char === ']') {
      if (!stack.length || stack[stack.length - 1] !== char) {
        return -1
      }
      stack.pop()
      if (!stack.length) {
        return index
      }
    }
  }

  return -1
}

function extractJsonBlock(rawText) {
  const text = String(rawText || '').trim()
  if (!text) {
    throw new Error('Empty provider response')
  }

  const direct = tryParseJson(text)
  if (direct !== null) {
    return direct
  }

  const fencedMatches = text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)
  for (const match of fencedMatches) {
    const candidate = String((match && match[1]) || '').trim()
    if (candidate) {
      const parsed = tryParseJson(candidate)
      if (parsed !== null) {
        return parsed
      }
    }
  }

  for (let start = 0; start < text.length; start += 1) {
    const char = text[start]
    if (char === '{' || char === '[') {
      const end = findJsonBlockEnd(text, start)
      if (end >= 0) {
        const candidate = text.slice(start, end + 1)
        const parsed = tryParseJson(candidate)
        if (parsed !== null) {
          return parsed
        }
      }
    }
  }

  throw new Error('Provider response does not contain JSON')
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
