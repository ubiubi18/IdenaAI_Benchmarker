const {promptTemplate} = require('./prompt')

describe('provider solver prompt template', () => {
  it('uses anti-slot-bias guidance in composite decision mode', () => {
    const prompt = promptTemplate({
      hash: 'flip-composite',
      forceDecision: false,
      flipVisionMode: 'composite',
      promptPhase: 'decision',
    })

    expect(prompt).toContain('Candidate order is never evidence.')
    expect(prompt).toContain(
      'Never choose a side just because it was shown first.'
    )
    expect(prompt).toContain(
      'return "skip" instead of defaulting to the first shown side'
    )
    expect(prompt).not.toMatch(/human-teacher|local training/i)
  })

  it('uses anti-slot-bias guidance in frame reasoning mode', () => {
    const prompt = promptTemplate({
      hash: 'flip-frame-reasoning',
      flipVisionMode: 'frames_two_pass',
      promptPhase: 'frame_reasoning',
    })

    expect(prompt).toContain(
      'Do not let the first listed side inherit a higher coherence score by default'
    )
    expect(prompt).toContain('Candidate order is never evidence.')
    expect(prompt).not.toMatch(/human-teacher|local training/i)
  })

  it('keeps anti-anchor guidance in second-pass review prompts', () => {
    const prompt = promptTemplate({
      hash: 'flip-second-pass',
      forceDecision: true,
      secondPass: true,
      flipVisionMode: 'composite',
      promptPhase: 'decision',
    })

    expect(prompt).toContain('second-pass uncertainty review')
    expect(prompt).toContain(
      'do not anchor on the first listed candidate or your earlier lean'
    )
    expect(prompt).toContain('never because it appeared first')
  })

  it('applies prompt overrides only to decision prompts', () => {
    const decisionPrompt = promptTemplate({
      hash: 'flip-custom',
      promptTemplateOverride: 'Custom solver prompt for {{hash}}',
      promptPhase: 'decision',
    })
    const frameReasoningPrompt = promptTemplate({
      hash: 'flip-custom',
      promptTemplateOverride: 'Custom solver prompt for {{hash}}',
      promptPhase: 'frame_reasoning',
    })

    expect(decisionPrompt).toBe('Custom solver prompt for flip-custom')
    expect(frameReasoningPrompt).not.toBe(
      'Custom solver prompt for flip-custom'
    )
    expect(frameReasoningPrompt).toContain(
      'You are solving an Idena flip benchmark in analysis mode.'
    )
  })
})
