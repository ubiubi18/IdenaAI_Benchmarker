const {evaluateStoryQuality} = require('./storyQuality')

describe('story quality validation', () => {
  test('rejects weak generic abstract panel language', () => {
    const result = evaluateStoryQuality({
      panels: [
        'A person interacts with a ghost in a hallway.',
        'The person interacts with shock in the same scene.',
        'The person uses shock as a tool beside the ghost.',
        'The person observes the final result.',
      ],
    })

    expect(result.ok).toBe(false)
    expect(result.failures).toEqual(
      expect.arrayContaining(['low_concreteness', 'weak_progression'])
    )
  })

  test('fails when fewer than two panels show external change', () => {
    const result = evaluateStoryQuality({
      panels: [
        'A person stands by a closed door in a hallway.',
        'The person looks at the same closed door.',
        'The person keeps looking at the closed door.',
        'The person remains by the closed door.',
      ],
    })

    expect(result.ok).toBe(false)
    expect(result.metrics.externalChangeCount).toBeLessThan(2)
    expect(result.failures).toContain('weak_progression')
  })

  test('fails when emotion appears without visible consequence', () => {
    const result = evaluateStoryQuality({
      panels: [
        'A person carries a cup through a hallway.',
        'A visible ghost appears and the person looks shocked.',
        'The person stays shocked and stares at the ghost.',
        'The person is still shocked beside the ghost.',
      ],
    })

    expect(result.ok).toBe(false)
    expect(result.failures).toContain('emotional_no_visible_consequence')
  })

  test('detects near-duplicate consecutive panels', () => {
    const result = evaluateStoryQuality({
      panels: [
        'A person places a box on a table.',
        'A person places the same box on the same table again.',
        'A person places the same box on the same table once more.',
        'The box still sits on the table.',
      ],
    })

    expect(result.ok).toBe(false)
    expect(result.failures).toContain('near_duplicate_panels')
    expect(result.metrics.maxConsecutiveSimilarity).toBeGreaterThanOrEqual(0.65)
  })

  test('passes a stronger shock and ghost story with visible progression', () => {
    const result = evaluateStoryQuality({
      panelDetails: [
        {
          role: 'before',
          description: 'A calm person carries a cup through a hallway.',
          stateChangeFromPrevious: 'n/a',
        },
        {
          role: 'trigger',
          description:
            'A visible ghost appears in front of the person and the person jolts in surprise.',
          stateChangeFromPrevious:
            'The hallway now contains a ghost and the person starts to recoil.',
        },
        {
          role: 'reaction',
          description:
            'The cup hits the floor and water spreads while the person steps back.',
          stateChangeFromPrevious:
            'The cup has fallen and water now covers the floor.',
        },
        {
          role: 'after',
          description:
            'The startled person stands away from the puddle while the ghost remains visible.',
          stateChangeFromPrevious:
            'The puddle stays on the floor and the person has retreated.',
        },
      ],
    })

    expect(result.ok).toBe(true)
    expect(result.metrics.externalChangeCount).toBeGreaterThanOrEqual(2)
    expect(result.failures).toHaveLength(0)
  })

  test('allows tense but non-graphic stories with concrete action', () => {
    const result = evaluateStoryQuality({
      panels: [
        'A clown in safety goggles stands beside a chainsaw and a wooden log.',
        'The clown starts cutting the log with the chainsaw on a workbench.',
        'Wood chips scatter as the clown shapes the log into a sculpture.',
        'The clown sets down the chainsaw and presents the finished wooden sculpture.',
      ],
    })

    expect(result.ok).toBe(true)
    expect(result.failures).not.toContain('low_concreteness')
  })
})
