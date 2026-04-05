const {
  buildStoryPromptExemplarLines,
  resolveStoryPromptVariant,
  STORY_PROMPT_VARIANTS,
} = require('./storyPromptExemplars')

describe('story prompt exemplars', () => {
  test('resolves provider-specific prompt variants', () => {
    expect(resolveStoryPromptVariant('openai')).toBe(
      STORY_PROMPT_VARIANTS.OPENAI_LIKE
    )
    expect(resolveStoryPromptVariant('gemini')).toBe(
      STORY_PROMPT_VARIANTS.GEMINI
    )
    expect(resolveStoryPromptVariant('anthropic')).toBe(
      STORY_PROMPT_VARIANTS.ANTHROPIC
    )
  })

  test('builds compact exemplar lines with positive and negative guidance', () => {
    const result = buildStoryPromptExemplarLines({
      provider: 'openai',
      fastMode: false,
      enabled: true,
    })

    expect(result).toMatchObject({
      enabled: true,
      variant: STORY_PROMPT_VARIANTS.OPENAI_LIKE,
    })
    expect(result.lines.join('\n')).toContain('Positive:')
    expect(result.lines.join('\n')).toContain('Negative:')
    expect(result.lines.join('\n')).toContain(
      'The person observes the final result.'
    )
    expect(result.lines.join('\n')).toContain('curtain tears loose')
    expect(result.lines.join('\n')).toContain('instead of defaulting to spills')
    expect(result.lines.join('\n')).not.toContain(
      'Do not include inappropriate, sexual, violent, or shocking content.'
    )
  })

  test('can disable exemplar injection cleanly for experiments', () => {
    const result = buildStoryPromptExemplarLines({
      provider: 'gemini',
      fastMode: true,
      enabled: false,
    })

    expect(result).toEqual({
      enabled: false,
      variant: STORY_PROMPT_VARIANTS.GEMINI,
      lines: [],
    })
  })
})
