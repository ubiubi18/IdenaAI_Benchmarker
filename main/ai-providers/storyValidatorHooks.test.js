const {
  buildRenderedPanelAuditPrompt,
  createRenderedPanelValidatorHooks,
  parseRenderedPanelAudit,
  runRenderedPanelValidatorHooks,
} = require('./storyValidatorHooks')

describe('storyValidatorHooks', () => {
  it('parses OCR leakage failures into a retryable validator result', async () => {
    const hooks = createRenderedPanelValidatorHooks(
      {},
      {
        providerAudit: jest.fn().mockResolvedValue({
          rawText: JSON.stringify({
            ocr_text_check: {
              passed: false,
              detected_text: ['EXIT', 'A12'],
              confidence: 0.96,
              retry_recommendation: 'remove the sign',
            },
            keyword_visibility_check: {
              passed: true,
              keywords: [
                {keyword: 'shock', visible: true, confidence: 0.9, notes: ''},
                {keyword: 'ghost', visible: true, confidence: 0.88, notes: ''},
              ],
            },
            alignment_check: {
              passed: true,
              aligned: true,
              confidence: 0.84,
              mismatch_reasons: [],
            },
            policy_risk_check: {
              passed: true,
              risk_level: 'low',
              triggered_categories: [],
              should_replan: false,
              should_retry_panel: false,
            },
          }),
        }),
      }
    )

    const result = await runRenderedPanelValidatorHooks({
      hooks,
      context: {
        panelIndex: 1,
        panelStory: 'A ghost appears behind a startled person.',
        storyPanels: [
          'A person walks calmly.',
          'A ghost appears behind a startled person.',
          'The person drops a cup.',
          'Water spreads on the floor.',
        ],
        keywords: ['shock', 'ghost'],
        panelPrompt: 'Show the ghost clearly.',
      },
    })

    expect(result.ocr_text_check).toMatchObject({
      status: 'fail',
      passed: false,
      detectedText: ['EXIT', 'A12'],
      confidence: 0.96,
      retryRecommendation: 'remove the sign',
    })
    expect(result.summary).toMatchObject({
      invoked: true,
      passed: false,
      failureReasons: ['ocr_fail'],
      shouldRetryPanel: true,
      shouldReplan: false,
      panelRepairReason: 'ocr_text_leakage',
    })
  })

  it('flags missing keyword visibility per keyword with structured output', async () => {
    const result = await runRenderedPanelValidatorHooks({
      hooks: {
        ocrTextCheck: jest.fn().mockResolvedValue({passed: true}),
        keywordVisibilityCheck: jest.fn().mockResolvedValue({
          passed: false,
          keywords: [
            {keyword: 'shock', visible: true, confidence: 0.91, notes: ''},
            {
              keyword: 'ghost',
              visible: false,
              confidence: 0.19,
              notes: 'ghost is too faint to recognize',
            },
          ],
          retry_recommendation: 'make the ghost body larger',
        }),
        alignmentCheck: jest
          .fn()
          .mockResolvedValue({passed: true, aligned: true}),
        policyRiskCheck: jest.fn().mockResolvedValue({
          passed: true,
          risk_level: 'low',
        }),
      },
      context: {
        keywords: ['shock', 'ghost'],
      },
    })

    expect(result.keyword_visibility_check).toMatchObject({
      status: 'fail',
      passed: false,
      retryRecommendation: 'make the ghost body larger',
    })
    expect(result.keyword_visibility_check.keywords).toEqual([
      {
        keyword: 'shock',
        visible: true,
        confidence: 0.91,
        notes: '',
      },
      {
        keyword: 'ghost',
        visible: false,
        confidence: 0.19,
        notes: 'ghost is too faint to recognize',
      },
    ])
    expect(result.summary.failureReasons).toEqual(['visibility_fail'])
    expect(result.summary.panelRepairReason).toBe('keyword_visibility')
  })

  it('flags panel-story alignment failures with mismatch reasons', async () => {
    const result = await runRenderedPanelValidatorHooks({
      hooks: {
        ocrTextCheck: jest.fn().mockResolvedValue({passed: true}),
        keywordVisibilityCheck: jest.fn().mockResolvedValue({
          passed: true,
          keywords: [
            {keyword: 'shock', visible: true, confidence: 0.8},
            {keyword: 'ghost', visible: true, confidence: 0.82},
          ],
        }),
        alignmentCheck: jest.fn().mockResolvedValue({
          passed: false,
          aligned: false,
          confidence: 0.22,
          mismatch_reasons: [
            'ghost missing from scene',
            'cup drop not visible',
          ],
          retry_recommendation: 'show the ghost and the falling cup',
        }),
        policyRiskCheck: jest.fn().mockResolvedValue({
          passed: true,
          risk_level: 'low',
        }),
      },
      context: {
        keywords: ['shock', 'ghost'],
      },
    })

    expect(result.alignment_check).toMatchObject({
      status: 'fail',
      passed: false,
      aligned: false,
      confidence: 0.22,
      mismatchReasons: ['ghost missing from scene', 'cup drop not visible'],
      retryRecommendation: 'show the ghost and the falling cup',
    })
    expect(result.summary.failureReasons).toEqual(['alignment_fail'])
    expect(result.summary.shouldRetryPanel).toBe(true)
  })

  it('keeps non-graphic eerie conflict at low policy risk', () => {
    const result = parseRenderedPanelAudit(
      JSON.stringify({
        ocr_text_check: {passed: true, detected_text: []},
        keyword_visibility_check: {
          passed: true,
          keywords: [
            {keyword: 'shock', visible: true, confidence: 0.77},
            {keyword: 'ghost', visible: true, confidence: 0.8},
          ],
        },
        alignment_check: {
          passed: true,
          aligned: true,
          confidence: 0.81,
          mismatch_reasons: [],
        },
        policy_risk_check: {
          passed: true,
          risk_level: 'low',
          triggered_categories: [],
          should_replan: false,
          should_retry_panel: false,
          retry_recommendation: '',
        },
      }),
      {
        keywords: ['shock', 'ghost'],
      }
    )

    expect(result.policyRiskCheck).toMatchObject({
      status: 'pass',
      passed: true,
      riskLevel: 'low',
      triggeredCategories: [],
      shouldReplan: false,
      shouldRetryPanel: false,
    })
  })

  it('builds a prompt that requests layered JSON-only panel auditing', () => {
    const prompt = buildRenderedPanelAuditPrompt({
      panelIndex: 1,
      panelStory: 'A visible ghost appears behind a startled person.',
      storyPanels: [
        'A person walks calmly.',
        'A visible ghost appears behind a startled person.',
        'The person drops a cup.',
        'Water spreads across the floor.',
      ],
      keywords: ['shock', 'ghost'],
      panelPrompt: 'show the ghost clearly with no text',
    })

    expect(prompt).toContain('Return strict JSON only.')
    expect(prompt).toContain('1. OCR/text leakage')
    expect(prompt).toContain('2. keyword visibility')
    expect(prompt).toContain('3. panel-story alignment')
    expect(prompt).toContain('4. policy risk')
    expect(prompt).toContain(
      'Keywords that should be visibly recognizable in this panel: shock, ghost'
    )
    expect(prompt).toContain(
      'allow non-graphic tension, fear, suspense, eerie scenes, and safe tool use'
    )
  })
})
