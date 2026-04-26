const {promptTemplate, systemPromptTemplate} = require('./prompt')

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
    expect(prompt).toContain('OPTION A')
    expect(prompt).toContain('OPTION B')
    expect(prompt).not.toContain('LEFT order')
    expect(prompt).not.toContain('RIGHT order')
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
    expect(prompt).toContain('optionAFrames')
    expect(prompt).toContain('optionBFrames')
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

  it('does not ask for skip in forced frame-decision prompts', () => {
    const prompt = promptTemplate({
      hash: 'flip-forced-frame-decision',
      forceDecision: true,
      secondPass: true,
      flipVisionMode: 'frames_two_pass',
      promptPhase: 'decision_from_frame_reasoning',
      frameReasoning:
        '{"optionAStory":"weak","optionBStory":"also weak","reportRisk":false}',
    })

    expect(prompt).toContain('Use only a|b for "answer"')
    expect(prompt).toContain('never return "skip"')
    expect(prompt).not.toContain('Prefer skip when both stories')
  })

  it('uses score-based adjudication in final forced prompts', () => {
    const prompt = promptTemplate({
      hash: 'flip-final-adjudication',
      forceDecision: true,
      secondPass: true,
      finalAdjudication: true,
      flipVisionMode: 'frames_two_pass',
      promptPhase: 'decision_from_frame_reasoning',
      frameReasoning:
        '{"optionAStory":"weak","optionBStory":"slightly stronger","reportRisk":false}',
    })

    expect(prompt).toContain('final adjudication pass')
    expect(prompt).toContain('even 50.5 vs 49.5')
    expect(prompt).toContain('choose the higher score')
    expect(prompt).toContain('Use only a|b for "answer"')
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

  it('provides a system prompt that bans positional bias', () => {
    const systemPrompt = systemPromptTemplate()

    expect(systemPrompt).toContain('Candidate labels such as left/right')
    expect(systemPrompt).toContain('Do not anchor on the first shown candidate')
    expect(systemPrompt).toContain('Return only the requested JSON')
  })
})
