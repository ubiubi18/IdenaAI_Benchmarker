function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
}

function normalizeKeywordList(value) {
  return (Array.isArray(value) ? value : [])
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .slice(0, 2)
}

function stripDataUrl(dataUrl) {
  const value = String(dataUrl || '').trim()
  const match = value.match(/^data:.*?;base64,(.*)$/)
  return match ? String(match[1] || '').trim() : value
}

function buildImageFingerprint(dataUrl) {
  const payload = stripDataUrl(dataUrl)
  if (!payload) return ''
  const mid = Math.max(0, Math.floor(payload.length / 2) - 48)
  return [
    payload.length,
    payload.slice(0, 96),
    payload.slice(mid, mid + 96),
    payload.slice(-96),
  ].join('|')
}

function computeFingerprintSimilarity(left, right) {
  if (!left || !right) return 0
  if (left === right) return 1

  const maxLength = Math.max(left.length, right.length)
  if (maxLength < 1) return 0

  let matches = 0
  const limit = Math.min(left.length, right.length)
  for (let index = 0; index < limit; index += 1) {
    if (left[index] === right[index]) {
      matches += 1
    }
  }

  return matches / maxLength
}

function createEmptyRenderedStoryMetrics() {
  return {
    rendered_story_accept: 0,
    rendered_story_repair: 0,
    rendered_story_reject: 0,
    switched_to_alternative_option: 0,
    panel_repair_count: 0,
    rendered_near_duplicate_fail: 0,
    rendered_alignment_fail: 0,
  }
}

function mergeRenderedStoryMetrics(left = {}, right = {}) {
  const merged = createEmptyRenderedStoryMetrics()
  Object.keys(merged).forEach((key) => {
    merged[key] =
      (Number.isFinite(Number(left[key])) ? Number(left[key]) : 0) +
      (Number.isFinite(Number(right[key])) ? Number(right[key]) : 0)
  })
  return merged
}

function normalizePanelIndices(values) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => Number.parseInt(value, 10))
        .filter((value) => Number.isFinite(value) && value >= 0 && value < 4)
    )
  ).sort((a, b) => a - b)
}

function evaluateRenderedStoryFeedback({
  storyPanels = [],
  renderedPanels = [],
  textAuditByPanel = [],
  validatorAuditByPanel = [],
  keywords = [],
  hasAlternativeOption = false,
}) {
  const normalizedPanels = (Array.isArray(storyPanels) ? storyPanels : [])
    .map((panel) => String(panel || '').trim())
    .slice(0, 4)
  while (normalizedPanels.length < 4) {
    normalizedPanels.push('')
  }
  const rendered = Array.isArray(renderedPanels) ? renderedPanels.slice(0, 4) : []
  while (rendered.length < 4) {
    rendered.push({})
  }
  const normalizedKeywords = normalizeKeywordList(keywords)

  const keywordCoverage = normalizedKeywords.reduce((acc, keyword) => {
    acc[keyword] = 0
    return acc
  }, {})
  let visibilityEvidenceSeen = false
  const visibilityFailPanels = []
  const alignmentFailPanels = []
  const textLeakPanels = []
  const nearDuplicatePairs = []
  const repairPanels = new Set()

  rendered.forEach((panel, index) => {
    const audit =
      validatorAuditByPanel[index] && typeof validatorAuditByPanel[index] === 'object'
        ? validatorAuditByPanel[index]
        : {}
    const visibility =
      audit.keyword_visibility_check &&
      typeof audit.keyword_visibility_check === 'object'
        ? audit.keyword_visibility_check
        : {}
    const keywordEntries = Array.isArray(visibility.keywords)
      ? visibility.keywords
      : []
    if (
      keywordEntries.length > 0 ||
      visibility.passed === false ||
      visibility.status === 'fail'
    ) {
      visibilityEvidenceSeen = true
    }
    const aligned =
      audit.alignment_check && typeof audit.alignment_check === 'object'
        ? audit.alignment_check
        : {}
    const ocr =
      audit.ocr_text_check && typeof audit.ocr_text_check === 'object'
        ? audit.ocr_text_check
        : {}
    const textAudit =
      textAuditByPanel[index] && typeof textAuditByPanel[index] === 'object'
        ? textAuditByPanel[index]
        : {}

    normalizedKeywords.forEach((keyword) => {
      const entry = keywordEntries.find(
        (item) =>
          normalizeText(item && item.keyword) === normalizeText(keyword)
      )
      if (
        entry &&
        entry.visible === true &&
        Number(entry.confidence) >= 0.55
      ) {
        keywordCoverage[keyword] += 1
      }
    })

    if (
      visibility.passed === false ||
      visibility.status === 'fail'
    ) {
      visibilityFailPanels.push(index)
      repairPanels.add(index)
    }

    if (
      aligned.passed === false ||
      aligned.status === 'fail'
    ) {
      alignmentFailPanels.push(index)
      repairPanels.add(index)
    }

    if (
      textAudit.hasText === true ||
      ocr.passed === false ||
      ocr.status === 'fail'
    ) {
      textLeakPanels.push(index)
      repairPanels.add(index)
    }
  })

  const fingerprints = rendered.map((panel) =>
    buildImageFingerprint(panel && panel.imageDataUrl)
  )
  for (let leftIndex = 0; leftIndex < fingerprints.length - 1; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < fingerprints.length; rightIndex += 1) {
      const similarity = computeFingerprintSimilarity(
        fingerprints[leftIndex],
        fingerprints[rightIndex]
      )
      if (similarity >= 0.985) {
        nearDuplicatePairs.push({
          left: leftIndex,
          right: rightIndex,
          similarity,
        })
      }
    }
  }

  const consecutiveNearDuplicates = nearDuplicatePairs.filter(
    (pair) => pair.right === pair.left + 1
  )
  consecutiveNearDuplicates.forEach((pair) => {
    repairPanels.add(pair.right)
  })

  const missingKeywords = visibilityEvidenceSeen
    ? normalizedKeywords.filter((keyword) => keywordCoverage[keyword] < 1)
    : []
  const weakKeywordCoverage = visibilityEvidenceSeen
    ? normalizedKeywords.filter((keyword) => keywordCoverage[keyword] < 2)
    : []

  const failureReasons = []
  if (textLeakPanels.length > 0) {
    failureReasons.push('text_leakage')
  }
  if (visibilityFailPanels.length > 0 || missingKeywords.length > 0) {
    failureReasons.push('keyword_clarity')
  }
  if (alignmentFailPanels.length > 0) {
    failureReasons.push('rendered_alignment')
  }
  if (nearDuplicatePairs.length > 0) {
    failureReasons.push('rendered_near_duplicate')
  }
  if (consecutiveNearDuplicates.length > 0) {
    failureReasons.push('causal_progression_ambiguity')
  }

  const severeKeywordFailure =
    missingKeywords.length > 0 || visibilityFailPanels.length >= 2
  const severeAlignmentFailure = alignmentFailPanels.length >= 2
  const severeRepetition = consecutiveNearDuplicates.length > 0
  const repairPanelIndices = normalizePanelIndices(Array.from(repairPanels))

  let score = 100
  score -= textLeakPanels.length * 18
  score -= visibilityFailPanels.length * 16
  score -= missingKeywords.length * 22
  score -= alignmentFailPanels.length * 20
  score -= nearDuplicatePairs.length * 24
  score -= weakKeywordCoverage.length * 6
  score = Math.max(0, Math.min(100, score))

  let verdict = 'accept_rendered_story'
  if (failureReasons.length > 0) {
    if (repairPanelIndices.length === 1 && !severeKeywordFailure && !severeAlignmentFailure && !severeRepetition) {
      verdict = 'repair_selected_panels'
    } else if (
      hasAlternativeOption &&
      (severeKeywordFailure || severeAlignmentFailure || severeRepetition || repairPanelIndices.length >= 2)
    ) {
      verdict = 'reject_story_and_use_alternative_option'
    } else if (repairPanelIndices.length > 0 && repairPanelIndices.length <= 2) {
      verdict = 'repair_selected_panels'
    } else {
      verdict = 'replan_story'
    }
  }

  return {
    verdict,
    score,
    failureReasons,
    repairPanelIndices,
    missingKeywords,
    weakKeywordCoverage,
    textLeakPanels,
    visibilityFailPanels,
    alignmentFailPanels,
    nearDuplicatePairs,
    consecutiveNearDuplicates,
    metrics: {
      keywordCoverage,
      textLeakPanelCount: textLeakPanels.length,
      visibilityFailCount: visibilityFailPanels.length,
      alignmentFailCount: alignmentFailPanels.length,
      nearDuplicatePairCount: nearDuplicatePairs.length,
      renderedNearDuplicateFail: nearDuplicatePairs.length > 0,
      renderedAlignmentFail: alignmentFailPanels.length > 0,
    },
  }
}

function recordRenderedStoryMetrics(metrics, report) {
  const target =
    metrics && typeof metrics === 'object' ? metrics : createEmptyRenderedStoryMetrics()
  const item = report && typeof report === 'object' ? report : {}

  if (item.verdict === 'accept_rendered_story') {
    target.rendered_story_accept += 1
  } else if (item.verdict === 'repair_selected_panels') {
    target.rendered_story_repair += 1
    target.panel_repair_count += normalizePanelIndices(item.repairPanelIndices).length
  } else if (
    item.verdict === 'reject_story_and_use_alternative_option' ||
    item.verdict === 'replan_story'
  ) {
    target.rendered_story_reject += 1
  }

  if (item.metrics && item.metrics.renderedNearDuplicateFail) {
    target.rendered_near_duplicate_fail += 1
  }
  if (item.metrics && item.metrics.renderedAlignmentFail) {
    target.rendered_alignment_fail += 1
  }

  return target
}

function buildRenderedStoryRepairGuidance(report, context = {}) {
  const item = report && typeof report === 'object' ? report : {}
  const keywordA = String(context.keywordA || '').trim()
  const keywordB = String(context.keywordB || '').trim()
  const guidance = {}

  normalizePanelIndices(item.repairPanelIndices).forEach((panelIndex) => {
    const lines = []

    if (
      Array.isArray(item.textLeakPanels) &&
      item.textLeakPanels.includes(panelIndex)
    ) {
      lines.push(
        'Story-level repair: remove all readable text, labels, logos, and watermark-like markings from this panel.'
      )
    }
    if (
      Array.isArray(item.visibilityFailPanels) &&
      item.visibilityFailPanels.includes(panelIndex)
    ) {
      lines.push(
        `Story-level repair: make "${keywordA}" and "${keywordB}" more unmistakable and visually recognizable in this panel.`
      )
    }
    if (
      Array.isArray(item.alignmentFailPanels) &&
      item.alignmentFailPanels.includes(panelIndex)
    ) {
      lines.push(
        'Story-level repair: follow the planned panel event literally and show the intended action and consequence more clearly.'
      )
    }
    if (
      Array.isArray(item.consecutiveNearDuplicates) &&
      item.consecutiveNearDuplicates.some((pair) => pair.right === panelIndex)
    ) {
      lines.push(
        'Story-level repair: differentiate this panel from the previous one with a clearly different composition and visible state change.'
      )
    }

    if (lines.length > 0) {
      guidance[panelIndex] = lines.join('\n')
    }
  })

  return guidance
}

module.exports = {
  buildRenderedStoryRepairGuidance,
  createEmptyRenderedStoryMetrics,
  evaluateRenderedStoryFeedback,
  mergeRenderedStoryMetrics,
  recordRenderedStoryMetrics,
}
