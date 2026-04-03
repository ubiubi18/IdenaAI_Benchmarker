const {selectSensePair} = require('./senseSelector')

describe('senseSelector', () => {
  it('prefers emotional shock with a visible ghost', () => {
    const result = selectSensePair({keywordA: 'shock', keywordB: 'ghost'})

    expect(result.used_raw_keyword_fallback).toBe(false)
    expect(result.selected_pair).toMatchObject({
      keyword_1_sense_id: 'shock_emotional_startle',
      keyword_2_sense_id: 'ghost_visible_spirit',
      weak_pair: false,
    })
    expect(result.compatibility_scores[0]).toMatchObject({
      keyword_1_sense_id: 'shock_emotional_startle',
      keyword_2_sense_id: 'ghost_visible_spirit',
    })
  })

  it('rejects abstract low-concreteness senses from the curated dictionary', () => {
    const result = selectSensePair({keywordA: 'shock', keywordB: 'ghost'})

    expect(result.rejected_senses.keyword_1).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sense_id: 'shock_abstract_surprise',
          rejection_reason: 'low_visual_concreteness',
        }),
      ])
    )
    expect(result.rejected_senses.keyword_2).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sense_id: 'ghost_social_disappearance',
          rejection_reason: 'low_visual_concreteness',
        }),
      ])
    )
  })
})
