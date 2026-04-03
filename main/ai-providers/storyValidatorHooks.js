const {extractJsonBlock} = require('./decision')

function createStoryValidatorHooks(hooks = {}) {
  const source = hooks && typeof hooks === 'object' ? hooks : {}
  return {
    ocrTextCheck:
      typeof source.ocrTextCheck === 'function' ? source.ocrTextCheck : null,
    keywordVisibilityCheck:
      typeof source.keywordVisibilityCheck === 'function'
        ? source.keywordVisibilityCheck
        : null,
    alignmentCheck:
      typeof source.alignmentCheck === 'function' ? source.alignmentCheck : null,
    policyRiskCheck:
      typeof source.policyRiskCheck === 'function'
        ? source.policyRiskCheck
        : null,
  }
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  return fallback
}

function normalizeConfidence(value, fallback = 0) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return Math.max(0, Math.min(1, Number(fallback) || 0))
  }
  return Math.max(0, Math.min(1, parsed))
}

function normalizeStringList(value, limit = 8) {
  return Array.isArray(value)
    ? value
        .map((entry) => String(entry || '').trim())
        .filter(Boolean)
        .slice(0, limit)
    : []
}

function normalizeKeywordList(context = {}) {
  const source = Array.isArray(context.keywords)
    ? context.keywords
    : [context.keywordA, context.keywordB]
  return source
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .slice(0, 2)
}

function buildRenderedPanelAuditPrompt(context = {}) {
  const keywordList = normalizeKeywordList(context)
  const panelIndex = Number.isFinite(Number(context.panelIndex))
    ? Number(context.panelIndex) + 1
    : 1
  const storyPanels = Array.isArray(context.storyPanels)
    ? context.storyPanels
        .map((entry, index) => `${index + 1}. ${String(entry || '').trim()}`)
        .join('\n')
    : ''

  return [
    'You are auditing one rendered Idena flip panel.',
    'Return strict JSON only.',
    'Use these layered checks in order:',
    '1. OCR/text leakage',
    '2. keyword visibility',
    '3. panel-story alignment',
    '4. policy risk',
    'Schema:',
    '{',
    '  "ocr_text_check": {',
    '    "passed": true,',
    '    "detected_text": [],',
    '    "confidence": 0.0,',
    '    "retry_recommendation": ""',
    '  },',
    '  "keyword_visibility_check": {',
    '    "passed": true,',
    '    "keywords": [',
    '      {"keyword": "<keyword>", "visible": true, "confidence": 0.0, "notes": ""}',
    '    ],',
    '    "retry_recommendation": ""',
    '  },',
    '  "alignment_check": {',
    '    "passed": true,',
    '    "aligned": true,',
    '    "confidence": 0.0,',
    '    "mismatch_reasons": [],',
    '    "retry_recommendation": ""',
    '  },',
    '  "policy_risk_check": {',
    '    "passed": true,',
    '    "risk_level": "low|medium|high",',
    '    "triggered_categories": [],',
    '    "should_replan": false,',
    '    "should_retry_panel": false,',
    '    "retry_recommendation": ""',
    '  }',
    '}',
    `Panel index: ${panelIndex}`,
    `Planned panel description: ${String(context.panelStory || '').trim() || '-'}`,
    storyPanels ? `Full 4-panel story plan:\n${storyPanels}` : '',
    `Keywords that should be visibly recognizable in this panel: ${keywordList.join(', ') || '-'}`,
    `Current panel prompt intent: ${String(context.panelPrompt || '').trim() || '-'}`,
    'OCR/text leakage rules:',
    '- fail if any readable letters, words, numbers, labels, logos, watermarks, UI text, or signs are visible',
    '- ignore texture that is clearly not readable text',
    'Keyword visibility rules:',
    '- judge whether each keyword is visibly present enough to be recognizable',
    '- if a keyword is weakly implied but not clearly visible, mark visible=false',
    'Alignment rules:',
    '- compare the rendered panel to the planned panel description',
    '- fail if the scene is ambiguous, missing the main event, or visually off-plan',
    'Policy risk rules:',
    '- allow non-graphic tension, fear, suspense, eerie scenes, and safe tool use',
    '- only flag clearly extreme or provider-triggering imagery such as graphic violence, gore, explicit injury, direct weapon harm against a person or animal, torture, dismemberment, or explicit sexual content',
    '- use risk_level=low for ordinary eerie or conflict scenes that remain non-graphic',
  ]
    .filter(Boolean)
    .join('\n')
}

function normalizeOcrTextCheck(value) {
  const item = value && typeof value === 'object' ? value : {}
  const detectedText = normalizeStringList(
    item.detected_text || item.detectedText,
    10
  )
  const passed = normalizeBoolean(
    item.passed,
    detectedText.length < 1 && !normalizeBoolean(item.hasText, false)
  )
  return {
    status: passed ? 'pass' : 'fail',
    passed,
    detectedText,
    confidence: normalizeConfidence(item.confidence, passed ? 0.85 : 0.6),
    retryRecommendation: String(
      item.retry_recommendation || item.retryRecommendation || ''
    ).trim(),
  }
}

function normalizeKeywordVisibilityCheck(value, context = {}) {
  const item = value && typeof value === 'object' ? value : {}
  const expectedKeywords = normalizeKeywordList(context)
  const rawEntries = Array.isArray(item.keywords) ? item.keywords : []
  const normalizedEntries = expectedKeywords.map((keyword) => {
    const matched =
      rawEntries.find((entry) => {
        const candidate =
          entry && typeof entry === 'object'
            ? String(entry.keyword || '').trim().toLowerCase()
            : ''
        return candidate === keyword.toLowerCase()
      }) || {}

    return {
      keyword,
      visible: normalizeBoolean(matched.visible, false),
      confidence: normalizeConfidence(
        matched.confidence,
        normalizeBoolean(matched.visible, false) ? 0.75 : 0.25
      ),
      notes: String(matched.notes || matched.reason || '').trim(),
    }
  })
  const passed = normalizeBoolean(
    item.passed,
    normalizedEntries.length > 0 && normalizedEntries.every((entry) => entry.visible)
  )
  return {
    status: passed ? 'pass' : 'fail',
    passed,
    keywords: normalizedEntries,
    retryRecommendation: String(
      item.retry_recommendation || item.retryRecommendation || ''
    ).trim(),
  }
}

function normalizeAlignmentCheck(value) {
  const item = value && typeof value === 'object' ? value : {}
  const aligned = normalizeBoolean(item.aligned, normalizeBoolean(item.passed, true))
  const mismatchReasons = normalizeStringList(
    item.mismatch_reasons || item.mismatchReasons,
    8
  )
  const passed = normalizeBoolean(
    item.passed,
    aligned && mismatchReasons.length < 1
  )
  return {
    status: passed ? 'pass' : 'fail',
    passed,
    aligned,
    confidence: normalizeConfidence(item.confidence, passed ? 0.8 : 0.45),
    mismatchReasons,
    retryRecommendation: String(
      item.retry_recommendation || item.retryRecommendation || ''
    ).trim(),
  }
}

function normalizePolicyRiskCheck(value) {
  const item = value && typeof value === 'object' ? value : {}
  const normalizedRiskLevel = String(item.risk_level || item.riskLevel || 'low')
    .trim()
    .toLowerCase()
  const riskLevel = ['low', 'medium', 'high'].includes(normalizedRiskLevel)
    ? normalizedRiskLevel
    : 'low'
  const triggeredCategories = normalizeStringList(
    item.triggered_categories || item.triggeredCategories,
    8
  )
  const shouldReplan = normalizeBoolean(item.should_replan || item.shouldReplan, false)
  const shouldRetryPanel = normalizeBoolean(
    item.should_retry_panel || item.shouldRetryPanel,
    riskLevel === 'high' && !shouldReplan
  )
  const passed = normalizeBoolean(
    item.passed,
    riskLevel !== 'high' && !shouldReplan
  )
  return {
    status: passed ? 'pass' : 'fail',
    passed,
    riskLevel,
    triggeredCategories,
    shouldReplan,
    shouldRetryPanel,
    retryRecommendation: String(
      item.retry_recommendation || item.retryRecommendation || ''
    ).trim(),
  }
}

function parseRenderedPanelAudit(rawText, context = {}) {
  const parsed = extractJsonBlock(rawText) || {}
  return {
    ocrTextCheck: normalizeOcrTextCheck(
      parsed.ocr_text_check || parsed.ocrTextCheck
    ),
    keywordVisibilityCheck: normalizeKeywordVisibilityCheck(
      parsed.keyword_visibility_check || parsed.keywordVisibilityCheck,
      context
    ),
    alignmentCheck: normalizeAlignmentCheck(
      parsed.alignment_check || parsed.alignmentCheck
    ),
    policyRiskCheck: normalizePolicyRiskCheck(
      parsed.policy_risk_check || parsed.policyRiskCheck
    ),
  }
}

function createProviderAssistedPanelLayerHandlers(providerAudit) {
  if (typeof providerAudit !== 'function') {
    return {
      ocrTextCheck: null,
      keywordVisibilityCheck: null,
      alignmentCheck: null,
      policyRiskCheck: null,
    }
  }

  const auditCache = new Map()

  async function getCachedAudit(context = {}) {
    const cacheKey =
      String(context.auditCacheKey || '').trim() ||
      `panel-${Number(context.panelIndex) || 0}-${String(
        context.panelStory || ''
      ).slice(0, 120)}`

    if (!auditCache.has(cacheKey)) {
      auditCache.set(
        cacheKey,
        (async () => {
          const promptText = buildRenderedPanelAuditPrompt(context)
          const providerResult = await providerAudit({
            context,
            promptText,
          })
          const rawText =
            typeof providerResult === 'string'
              ? providerResult
              : String(
                  (providerResult && providerResult.rawText) ||
                    (providerResult && providerResult.text) ||
                    ''
                ).trim()
          return parseRenderedPanelAudit(rawText, context)
        })().catch((error) => ({
          error: String((error && error.message) || error || '').trim(),
        }))
      )
    }

    return auditCache.get(cacheKey)
  }

  function createLayerHandler(layerName) {
    return async ({context = {}}) => {
      const audit = await getCachedAudit(context)
      if (!audit || audit.error) {
        return {
          status: 'error',
          detail: audit && audit.error ? audit.error : 'panel_audit_unavailable',
        }
      }
      return audit[layerName] || {status: 'error', detail: 'missing_panel_audit_layer'}
    }
  }

  return {
    ocrTextCheck: createLayerHandler('ocrTextCheck'),
    keywordVisibilityCheck: createLayerHandler('keywordVisibilityCheck'),
    alignmentCheck: createLayerHandler('alignmentCheck'),
    policyRiskCheck: createLayerHandler('policyRiskCheck'),
  }
}

function createRenderedPanelValidatorHooks(hooks = {}, options = {}) {
  const source = hooks && typeof hooks === 'object' ? hooks : {}
  const providerHandlers = createProviderAssistedPanelLayerHandlers(
    options && options.providerAudit
  )

  return {
    ocrTextCheck:
      typeof source.ocrTextCheck === 'function'
        ? source.ocrTextCheck
        : providerHandlers.ocrTextCheck,
    keywordVisibilityCheck:
      typeof source.keywordVisibilityCheck === 'function'
        ? source.keywordVisibilityCheck
        : providerHandlers.keywordVisibilityCheck,
    alignmentCheck:
      typeof source.alignmentCheck === 'function'
        ? source.alignmentCheck
        : providerHandlers.alignmentCheck,
    policyRiskCheck:
      typeof source.policyRiskCheck === 'function'
        ? source.policyRiskCheck
        : providerHandlers.policyRiskCheck,
  }
}

function normalizePanelLayerResult(layerName, value, context = {}) {
  const item = value && typeof value === 'object' ? value : value === true ? {passed: true} : value === false ? {passed: false} : {}
  if (item.status === 'not_configured') {
    return {
      status: 'not_configured',
      passed: true,
    }
  }
  if (item.status === 'error') {
    return {
      status: 'error',
      passed: true,
      detail: String(item.detail || item.reason || '').trim(),
    }
  }

  if (layerName === 'ocr_text_check') {
    return normalizeOcrTextCheck(item)
  }
  if (layerName === 'keyword_visibility_check') {
    return normalizeKeywordVisibilityCheck(item, context)
  }
  if (layerName === 'alignment_check') {
    return normalizeAlignmentCheck(item)
  }
  return normalizePolicyRiskCheck(item)
}

function summarizeRenderedPanelValidatorResults(results = {}) {
  const ocr = results.ocr_text_check || {status: 'not_configured', passed: true}
  const visibility =
    results.keyword_visibility_check || {status: 'not_configured', passed: true}
  const alignment =
    results.alignment_check || {status: 'not_configured', passed: true}
  const policy =
    results.policy_risk_check || {status: 'not_configured', passed: true}

  const failureReasons = []
  let shouldRetryPanel = false
  let shouldReplan = false
  let panelRepairReason = ''

  if (ocr.status === 'fail' || ocr.passed === false) {
    failureReasons.push('ocr_fail')
    shouldRetryPanel = true
    panelRepairReason = panelRepairReason || 'ocr_text_leakage'
  }
  if (visibility.status === 'fail' || visibility.passed === false) {
    failureReasons.push('visibility_fail')
    shouldRetryPanel = true
    panelRepairReason = panelRepairReason || 'keyword_visibility'
  }
  if (alignment.status === 'fail' || alignment.passed === false) {
    failureReasons.push('alignment_fail')
    shouldRetryPanel = true
    panelRepairReason = panelRepairReason || 'alignment_mismatch'
  }
  if (policy.status === 'fail' || policy.passed === false) {
    failureReasons.push('policy_fail')
    shouldRetryPanel = shouldRetryPanel || Boolean(policy.shouldRetryPanel)
    shouldReplan = shouldReplan || Boolean(policy.shouldReplan)
    panelRepairReason = panelRepairReason || 'policy_risk'
  }

  return {
    invoked: Object.values(results).some(
      (item) => item && item.status !== 'not_configured'
    ),
    passed: failureReasons.length < 1,
    failureReasons,
    shouldRetryPanel,
    shouldReplan,
    panelRepairReason,
  }
}

async function runRenderedPanelValidatorHooks({
  hooks = null,
  context = {},
}) {
  const configured = createRenderedPanelValidatorHooks(hooks)
  const hookEntries = [
    ['ocr_text_check', configured.ocrTextCheck],
    ['keyword_visibility_check', configured.keywordVisibilityCheck],
    ['alignment_check', configured.alignmentCheck],
    ['policy_risk_check', configured.policyRiskCheck],
  ]

  const results = {}
  for (const [name, handler] of hookEntries) {
    if (typeof handler !== 'function') {
      results[name] = {status: 'not_configured', passed: true}
      continue
    }

    try {
      // eslint-disable-next-line no-await-in-loop
      const output = await handler({context})
      results[name] = normalizePanelLayerResult(name, output, context)
    } catch (error) {
      results[name] = {
        status: 'error',
        passed: true,
        detail: String((error && error.message) || error || '').trim(),
      }
    }
  }

  return {
    ...results,
    summary: summarizeRenderedPanelValidatorResults(results),
  }
}

function normalizeHookResult(value) {
  if (value === true) {
    return {status: 'pass', detail: '', data: null}
  }
  if (value === false) {
    return {status: 'fail', detail: '', data: null}
  }
  if (!value || typeof value !== 'object') {
    return {status: 'pass', detail: '', data: null}
  }

  const status = String(value.status || value.outcome || 'pass')
    .trim()
    .toLowerCase()
  const normalizedStatus = ['pass', 'warn', 'fail', 'error'].includes(status)
    ? status
    : 'pass'

  return {
    status: normalizedStatus,
    detail: String(value.detail || value.reason || '').trim(),
    data:
      value.data && typeof value.data === 'object' && !Array.isArray(value.data)
        ? value.data
        : null,
  }
}

async function runStoryValidatorHooks({
  hooks = null,
  stories = [],
  context = {},
}) {
  const configured = createStoryValidatorHooks(hooks)
  const hookEntries = [
    ['ocr_text_check', configured.ocrTextCheck],
    ['keyword_visibility_check', configured.keywordVisibilityCheck],
    ['alignment_check', configured.alignmentCheck],
    ['policy_risk_check', configured.policyRiskCheck],
  ]

  const results = {}
  for (const [name, handler] of hookEntries) {
    if (typeof handler !== 'function') {
      results[name] = {status: 'not_configured', detail: '', data: null}
      continue
    }

    try {
      // eslint-disable-next-line no-await-in-loop
      const output = await handler({
        stories,
        context,
      })
      results[name] = normalizeHookResult(output)
    } catch (error) {
      results[name] = {
        status: 'error',
        detail: String((error && error.message) || error || '').trim(),
        data: null,
      }
    }
  }

  return results
}

module.exports = {
  buildRenderedPanelAuditPrompt,
  createRenderedPanelValidatorHooks,
  createStoryValidatorHooks,
  parseRenderedPanelAudit,
  runRenderedPanelValidatorHooks,
  runStoryValidatorHooks,
}
