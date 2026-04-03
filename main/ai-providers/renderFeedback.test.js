const {
  buildRenderedStoryRepairGuidance,
  evaluateRenderedStoryFeedback,
} = require('./renderFeedback')

function makePanel(imageDataUrl) {
  return {imageDataUrl}
}

describe('render feedback loop', () => {
  test('repairs a single weak panel when only one rendered panel is misaligned', () => {
    const result = evaluateRenderedStoryFeedback({
      storyPanels: [
        'A calm person enters a hallway with a cup.',
        'A ghost appears and the person jolts in shock.',
        'The cup drops and water spreads.',
        'The person backs away from the puddle.',
      ],
      renderedPanels: [
        makePanel('data:image/png;base64,AAA='),
        makePanel('data:image/png;base64,BBB='),
        makePanel('data:image/png;base64,CCC='),
        makePanel('data:image/png;base64,DDD='),
      ],
      textAuditByPanel: [{}, {}, {}, {}],
      validatorAuditByPanel: [
        {},
        {
          alignment_check: {
            passed: false,
            status: 'fail',
          },
        },
        {},
        {},
      ],
      keywords: ['shock', 'ghost'],
      hasAlternativeOption: false,
    })

    expect(result.verdict).toBe('repair_selected_panels')
    expect(result.repairPanelIndices).toEqual([1])
    expect(result.failureReasons).toContain('rendered_alignment')
    expect(result.metrics.renderedAlignmentFail).toBe(true)

    expect(
      buildRenderedStoryRepairGuidance(result, {
        keywordA: 'shock',
        keywordB: 'ghost',
      })
    ).toEqual(
      expect.objectContaining({
        1: expect.stringContaining(
          'follow the planned panel event literally'
        ),
      })
    )
  })

  test('switches away from repeated near-duplicate rendered panels when an alternative exists', () => {
    const result = evaluateRenderedStoryFeedback({
      storyPanels: [
        'A person reaches a basement door with a flashlight.',
        'The ghost appears on the stairs.',
        'The flashlight falls while the ghost remains visible.',
        'The person backs away from the stairs.',
      ],
      renderedPanels: [
        makePanel('data:image/png;base64,AAAA1111'),
        makePanel('data:image/png;base64,SAME2222'),
        makePanel('data:image/png;base64,SAME2222'),
        makePanel('data:image/png;base64,DDDD4444'),
      ],
      textAuditByPanel: [{}, {}, {}, {}],
      validatorAuditByPanel: [{}, {}, {}, {}],
      keywords: ['shock', 'ghost'],
      hasAlternativeOption: true,
    })

    expect(result.verdict).toBe('reject_story_and_use_alternative_option')
    expect(result.failureReasons).toEqual(
      expect.arrayContaining([
        'rendered_near_duplicate',
        'causal_progression_ambiguity',
      ])
    )
    expect(result.nearDuplicatePairs).toEqual([
      expect.objectContaining({left: 1, right: 2}),
    ])
    expect(result.repairPanelIndices).toEqual([2])
  })
})
