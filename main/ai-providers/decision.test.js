const {
  extractJsonBlock,
  normalizeAnswer,
  normalizeConfidence,
  normalizeDecision,
  stripDataUrl,
} = require('./decision')

describe('decision helpers', () => {
  it('extracts JSON block from mixed provider response', () => {
    expect(
      extractJsonBlock('Here it is {"answer":"left","confidence":0.7}')
    ).toStrictEqual({
      answer: 'left',
      confidence: 0.7,
    })
  })

  it('extracts JSON from fenced code blocks', () => {
    expect(
      extractJsonBlock('```json\n{"answer":"right","confidence":0.4}\n```')
    ).toStrictEqual({
      answer: 'right',
      confidence: 0.4,
    })
  })

  it('extracts first valid nested JSON object from noisy text', () => {
    expect(
      extractJsonBlock(
        'prefix text {not valid json} and then {"stories":[{"panels":["a","b","c","d"]}]} suffix'
      )
    ).toStrictEqual({
      stories: [{panels: ['a', 'b', 'c', 'd']}],
    })
  })

  it('normalizes answer and confidence bounds', () => {
    expect(normalizeAnswer('R')).toBe('right')
    expect(normalizeAnswer('option a')).toBe('left')
    expect(normalizeAnswer('story 2')).toBe('right')
    expect(normalizeAnswer('unknown')).toBe('skip')
    expect(normalizeConfidence(2)).toBe(1)
    expect(normalizeConfidence(-1)).toBe(0)
  })

  it('normalizes decision payload and reasoning length', () => {
    const longReasoning = 'x'.repeat(500)
    const normalized = normalizeDecision({
      answer: 'l',
      confidence: 0.42,
      reasoning: longReasoning,
    })

    expect(normalized.answer).toBe('left')
    expect(normalized.confidence).toBe(0.42)
    expect(normalized.reasoning).toHaveLength(240)
  })

  it('parses data URL payload', () => {
    expect(stripDataUrl('data:image/png;base64,AAA=')).toStrictEqual({
      mimeType: 'image/png',
      data: 'AAA=',
    })
  })
})
