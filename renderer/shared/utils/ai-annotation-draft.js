const AI_ANNOTATION_RATINGS = ['good', 'bad', 'wrong']
const AI_DRAFT_PANEL_COUNT = 8
const AI_ANNOTATION_WRAPPER_KEYS = [
  'annotation',
  'draft',
  'result',
  'data',
  'json',
  'response',
  'output',
  'content',
]

function createEmptyAiAnnotationDraft() {
  return {
    task_id: '',
    generated_at: '',
    runtime_backend: '',
    runtime_type: '',
    model: '',
    vision_model: '',
    ordered_panel_descriptions: Array.from(
      {length: AI_DRAFT_PANEL_COUNT},
      () => ''
    ),
    ordered_panel_text: Array.from({length: AI_DRAFT_PANEL_COUNT}, () => ''),
    option_a_story_analysis: '',
    option_b_story_analysis: '',
    final_answer: '',
    why_answer: '',
    confidence: '',
    text_required: null,
    sequence_markers_present: null,
    report_required: null,
    report_reason: '',
    option_a_summary: '',
    option_b_summary: '',
    rating: '',
  }
}

function normalizeAiAnnotationRating(value) {
  const next = String(value || '')
    .trim()
    .toLowerCase()

  return AI_ANNOTATION_RATINGS.includes(next) ? next : ''
}

function normalizeAiAnnotationBool(value) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return null
  }

  if (typeof value === 'boolean') {
    return value
  }

  const raw = String(value).trim().toLowerCase()

  if (['true', 'yes', '1'].includes(raw)) {
    return true
  }

  if (['false', 'no', '0'].includes(raw)) {
    return false
  }

  return null
}

function normalizeAiAnnotationConfidence(value) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return ''
  }

  const parsed = Number.parseFloat(value)

  if (!Number.isFinite(parsed) || parsed < 0) {
    return ''
  }

  if (parsed <= 1) {
    return String(Math.min(5, Math.max(1, Math.round(parsed * 4 + 1))))
  }

  if (parsed > 5) {
    return ''
  }

  return String(Math.round(parsed))
}

function normalizeAiAnnotationDraftList(
  value,
  {maxItems = AI_DRAFT_PANEL_COUNT, maxLength = 280} = {}
) {
  let items = []

  if (Array.isArray(value)) {
    items = value
  } else if (value && typeof value === 'object') {
    items = Object.entries(value)
      .sort(([left], [right]) => Number(left) - Number(right))
      .map(([_key, item]) => item)
  }

  const next = items.slice(0, maxItems).map((item) =>
    String(item || '')
      .trim()
      .slice(0, maxLength)
  )

  while (next.length < maxItems) {
    next.push('')
  }

  return next
}

function hasAiAnnotationListContent(value = []) {
  return Array.isArray(value) && value.some((item) => String(item || '').trim())
}

function countAiAnnotationSignalFields(value = {}) {
  const next =
    value && typeof value === 'object' && !Array.isArray(value) ? value : {}

  let score = 0
  const signalKeys = [
    'final_answer',
    'finalAnswer',
    'answer',
    'why_answer',
    'whyAnswer',
    'reason',
    'confidence',
    'text_required',
    'textRequired',
    'sequence_markers_present',
    'sequenceMarkersPresent',
    'report_required',
    'reportRequired',
    'option_a_summary',
    'optionASummary',
    'option_b_summary',
    'optionBSummary',
    'left_summary',
    'leftSummary',
    'right_summary',
    'rightSummary',
    'ordered_panel_descriptions',
    'orderedPanelDescriptions',
    'panel_descriptions',
    'panelDescriptions',
    'ordered_panel_text',
    'orderedPanelText',
    'panel_text',
    'panelText',
  ]

  signalKeys.forEach((key) => {
    const item = next[key]

    if (
      Array.isArray(item) &&
      item.some((entry) => String(entry || '').trim())
    ) {
      score += 2
      return
    }

    if (typeof item === 'boolean') {
      score += 1
      return
    }

    if (
      typeof item === 'number' &&
      Number.isFinite(item) &&
      key === 'confidence'
    ) {
      score += 1
      return
    }

    if (String(item || '').trim()) {
      score += 1
    }
  })

  return score
}

function unwrapAiAnnotationPayload(value, depth = 0) {
  if (depth > 2) {
    return value
  }

  const next =
    value && typeof value === 'object' && !Array.isArray(value) ? value : null

  if (!next) {
    return value
  }

  let bestCandidate = next
  let bestScore = countAiAnnotationSignalFields(next)

  AI_ANNOTATION_WRAPPER_KEYS.forEach((key) => {
    const candidate = unwrapAiAnnotationPayload(next[key], depth + 1)
    const candidateScore = countAiAnnotationSignalFields(candidate)

    if (candidateScore > bestScore) {
      bestCandidate = candidate
      bestScore = candidateScore
    }
  })

  Object.values(next).forEach((candidateValue) => {
    if (
      !candidateValue ||
      typeof candidateValue !== 'object' ||
      Array.isArray(candidateValue)
    ) {
      return
    }

    const candidate = unwrapAiAnnotationPayload(candidateValue, depth + 1)
    const candidateScore = countAiAnnotationSignalFields(candidate)

    if (candidateScore > bestScore) {
      bestCandidate = candidate
      bestScore = candidateScore
    }
  })

  return bestCandidate
}

function normalizeAiAnnotationDraft(annotation = {}) {
  const unwrapped = unwrapAiAnnotationPayload(annotation)
  const next =
    unwrapped && typeof unwrapped === 'object' && !Array.isArray(unwrapped)
      ? {
          ...createEmptyAiAnnotationDraft(),
          ...unwrapped,
        }
      : createEmptyAiAnnotationDraft()
  const finalAnswer = String(next.final_answer ?? next.finalAnswer ?? '')
    .trim()
    .toLowerCase()
  const normalizedFinalAnswer = String(next.answer ?? finalAnswer)
    .trim()
    .toLowerCase()
  const textRequired = normalizeAiAnnotationBool(
    Object.prototype.hasOwnProperty.call(next, 'text_required') ||
      Object.prototype.hasOwnProperty.call(next, 'textRequired')
      ? next.text_required ?? next.textRequired
      : null
  )
  const sequenceMarkersPresent = normalizeAiAnnotationBool(
    Object.prototype.hasOwnProperty.call(next, 'sequence_markers_present') ||
      Object.prototype.hasOwnProperty.call(next, 'sequenceMarkersPresent')
      ? next.sequence_markers_present ?? next.sequenceMarkersPresent
      : null
  )
  const reportRequired = normalizeAiAnnotationBool(
    Object.prototype.hasOwnProperty.call(next, 'report_required') ||
      Object.prototype.hasOwnProperty.call(next, 'reportRequired')
      ? next.report_required ?? next.reportRequired
      : null
  )
  const reportReason = String(
    next.report_reason ??
      next.reportReason ??
      next.report_note ??
      next.reportNote ??
      ''
  )
    .trim()
    .slice(0, 400)

  const normalized = {
    ...createEmptyAiAnnotationDraft(),
    task_id: String(next.task_id ?? next.taskId ?? '')
      .trim()
      .slice(0, 256),
    generated_at: String(next.generated_at ?? next.generatedAt ?? '')
      .trim()
      .slice(0, 64),
    runtime_backend: String(next.runtime_backend ?? next.runtimeBackend ?? '')
      .trim()
      .slice(0, 64),
    runtime_type: String(next.runtime_type ?? next.runtimeType ?? '')
      .trim()
      .slice(0, 64),
    model: String(next.model || '')
      .trim()
      .slice(0, 256),
    vision_model: String(next.vision_model || next.visionModel || '')
      .trim()
      .slice(0, 256),
    ordered_panel_descriptions: normalizeAiAnnotationDraftList(
      next.ordered_panel_descriptions ??
        next.orderedPanelDescriptions ??
        next.panel_descriptions ??
        next.panelDescriptions ??
        next.frame_notes ??
        next.frameNotes,
      {
        maxItems: AI_DRAFT_PANEL_COUNT,
        maxLength: 280,
      }
    ),
    ordered_panel_text: normalizeAiAnnotationDraftList(
      next.ordered_panel_text ??
        next.orderedPanelText ??
        next.panel_text ??
        next.panelText ??
        next.ocr_text ??
        next.ocrText,
      {
        maxItems: AI_DRAFT_PANEL_COUNT,
        maxLength: 200,
      }
    ),
    option_a_story_analysis: String(
      next.option_a_story_analysis ??
        next.optionAStoryAnalysis ??
        next.option_a_analysis ??
        next.optionAAnalysis ??
        next.left_analysis ??
        next.leftAnalysis ??
        ''
    )
      .trim()
      .slice(0, 500),
    option_b_story_analysis: String(
      next.option_b_story_analysis ??
        next.optionBStoryAnalysis ??
        next.option_b_analysis ??
        next.optionBAnalysis ??
        next.right_analysis ??
        next.rightAnalysis ??
        ''
    )
      .trim()
      .slice(0, 500),
    final_answer: ['left', 'right', 'skip'].includes(normalizedFinalAnswer)
      ? normalizedFinalAnswer
      : '',
    why_answer: String(
      next.why_answer ?? next.whyAnswer ?? next.reason ?? next.explanation ?? ''
    )
      .trim()
      .slice(0, 900),
    confidence: normalizeAiAnnotationConfidence(next.confidence),
    text_required: textRequired,
    sequence_markers_present: sequenceMarkersPresent,
    report_required: reportRequired,
    report_reason: reportRequired === false ? '' : reportReason,
    option_a_summary: String(
      next.option_a_summary ??
        next.optionASummary ??
        next.left_summary ??
        next.leftSummary ??
        ''
    )
      .trim()
      .slice(0, 400),
    option_b_summary: String(
      next.option_b_summary ??
        next.optionBSummary ??
        next.right_summary ??
        next.rightSummary ??
        ''
    )
      .trim()
      .slice(0, 400),
    rating: normalizeAiAnnotationRating(next.rating),
  }

  return hasAiAnnotationContent(normalized) ? normalized : null
}

function hasAiAnnotationContent(annotation = {}) {
  const next =
    annotation && typeof annotation === 'object' && !Array.isArray(annotation)
      ? annotation
      : null

  if (!next) {
    return false
  }

  return Boolean(
    hasAiAnnotationListContent(next.ordered_panel_descriptions) ||
      hasAiAnnotationListContent(next.ordered_panel_text) ||
      next.option_a_story_analysis ||
      next.option_b_story_analysis ||
      next.final_answer ||
      next.why_answer ||
      next.confidence ||
      next.text_required !== null ||
      next.sequence_markers_present !== null ||
      next.report_required !== null ||
      next.option_a_summary ||
      next.option_b_summary ||
      next.report_reason
  )
}

function validateAiAnnotationDraft(annotation = {}) {
  const normalizedDraft = normalizeAiAnnotationDraft(annotation)
  const missingFields = []
  const invalidFields = []

  if (!normalizedDraft) {
    return {
      ok: false,
      normalizedDraft: null,
      missingFields: ['draft_object'],
      invalidFields: [],
      diagnosticPreview: '',
    }
  }

  if (!normalizedDraft.final_answer) {
    missingFields.push('final_answer')
  }

  if (!String(normalizedDraft.why_answer || '').trim()) {
    missingFields.push('why_answer')
  }

  if (!String(normalizedDraft.confidence || '').trim()) {
    missingFields.push('confidence')
  }

  if (typeof normalizedDraft.text_required !== 'boolean') {
    missingFields.push('text_required')
  }

  if (typeof normalizedDraft.sequence_markers_present !== 'boolean') {
    missingFields.push('sequence_markers_present')
  }

  if (typeof normalizedDraft.report_required !== 'boolean') {
    missingFields.push('report_required')
  }

  if (!String(normalizedDraft.option_a_summary || '').trim()) {
    missingFields.push('option_a_summary')
  }

  if (!String(normalizedDraft.option_b_summary || '').trim()) {
    missingFields.push('option_b_summary')
  }

  if (!String(normalizedDraft.option_a_story_analysis || '').trim()) {
    missingFields.push('option_a_story_analysis')
  }

  if (!String(normalizedDraft.option_b_story_analysis || '').trim()) {
    missingFields.push('option_b_story_analysis')
  }

  if (
    !Array.isArray(normalizedDraft.ordered_panel_descriptions) ||
    normalizedDraft.ordered_panel_descriptions.length !== AI_DRAFT_PANEL_COUNT
  ) {
    invalidFields.push('ordered_panel_descriptions')
  } else if (
    normalizedDraft.ordered_panel_descriptions.some(
      (item) => !String(item || '').trim()
    )
  ) {
    missingFields.push('ordered_panel_descriptions')
  }

  if (
    !Array.isArray(normalizedDraft.ordered_panel_text) ||
    normalizedDraft.ordered_panel_text.length !== AI_DRAFT_PANEL_COUNT
  ) {
    invalidFields.push('ordered_panel_text')
  }

  if (
    normalizedDraft.report_required === true &&
    !String(normalizedDraft.report_reason || '').trim()
  ) {
    missingFields.push('report_reason')
  }

  if (normalizedDraft.report_required === false) {
    normalizedDraft.report_reason = ''
  }

  return {
    ok: missingFields.length === 0 && invalidFields.length === 0,
    normalizedDraft,
    missingFields: [...new Set(missingFields)],
    invalidFields: [...new Set(invalidFields)],
    diagnosticPreview: getAiAnnotationResponsePreview(
      JSON.stringify(normalizedDraft)
    ),
  }
}

function resolveAiAnnotationDraftResolution({
  initialValue,
  repairedValue,
} = {}) {
  const initialValidation = validateAiAnnotationDraft(initialValue)

  if (initialValidation.ok) {
    return {
      ok: true,
      normalizedDraft: initialValidation.normalizedDraft,
      initialValidation,
      repairValidation: null,
      repairAttempted: false,
      finalValidation: initialValidation,
    }
  }

  if (typeof repairedValue === 'undefined') {
    return {
      ok: false,
      normalizedDraft: null,
      initialValidation,
      repairValidation: null,
      repairAttempted: false,
      finalValidation: initialValidation,
    }
  }

  const repairValidation = validateAiAnnotationDraft(repairedValue)

  return {
    ok: repairValidation.ok,
    normalizedDraft: repairValidation.ok
      ? repairValidation.normalizedDraft
      : null,
    initialValidation,
    repairValidation,
    repairAttempted: true,
    finalValidation: repairValidation,
  }
}

function getValidAiAnnotationDraft(annotation = {}) {
  const validation = validateAiAnnotationDraft(annotation)

  return validation.ok ? validation.normalizedDraft : null
}

function getAiAnnotationResponsePreview(value = '') {
  return String(value || '')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 220)
}

function getAiAnnotationReturnedKeys(value = null) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return []
  }

  return Object.keys(value).slice(0, 12)
}

function createAiAnnotationDraftDiagnostics({
  validationResult = null,
  rawText = '',
  sourceValue = null,
  parsedValue = null,
  repairAttempted = false,
  message = '',
} = {}) {
  return {
    message: String(message || '').trim(),
    missingFields: Array.isArray(validationResult?.missingFields)
      ? validationResult.missingFields
      : [],
    invalidFields: Array.isArray(validationResult?.invalidFields)
      ? validationResult.invalidFields
      : [],
    returnedKeys: getAiAnnotationReturnedKeys(parsedValue || sourceValue),
    preview: getAiAnnotationResponsePreview(rawText),
    repairAttempted,
  }
}

function formatAiAnnotationDraftDiagnosticsMessage(diagnostics = {}) {
  const parts = []

  if (diagnostics.message) {
    parts.push(diagnostics.message)
  }

  if (
    Array.isArray(diagnostics.missingFields) &&
    diagnostics.missingFields.length
  ) {
    parts.push(`Missing fields: ${diagnostics.missingFields.join(', ')}`)
  }

  if (
    Array.isArray(diagnostics.invalidFields) &&
    diagnostics.invalidFields.length
  ) {
    parts.push(`Invalid fields: ${diagnostics.invalidFields.join(', ')}`)
  }

  if (diagnostics.repairAttempted) {
    parts.push('Repair retry failed.')
  }

  if (
    Array.isArray(diagnostics.returnedKeys) &&
    diagnostics.returnedKeys.length
  ) {
    parts.push(`Returned keys: ${diagnostics.returnedKeys.join(', ')}`)
  }

  if (diagnostics.preview) {
    parts.push(`Preview: ${diagnostics.preview}`)
  }

  return parts.join(' ')
}

function buildAiAnnotationRepairPrompt({
  normalizedDraft = null,
  missingFields = [],
  invalidFields = [],
} = {}) {
  const seedDraft = {
    ...createEmptyAiAnnotationDraft(),
    ...(normalizeAiAnnotationDraft(normalizedDraft) || {}),
  }

  return [
    'Your last response was parsed, but it did not satisfy the required JSON contract.',
    'Return one corrected JSON object only. Do not add markdown, prose, or explanations before or after the JSON.',
    'Preserve any fields that are already valid. Fill in every missing or invalid required field.',
    missingFields.length
      ? `Missing required fields: ${missingFields.join(', ')}`
      : '',
    invalidFields.length ? `Invalid fields: ${invalidFields.join(', ')}` : '',
    'Keep the same schema with exactly 8 ordered_panel_descriptions entries and exactly 8 ordered_panel_text entries.',
    'If report_required is false, report_reason must be an empty string.',
    'Here is the partial normalized draft to repair:',
    JSON.stringify(seedDraft, null, 2),
  ]
    .filter(Boolean)
    .join('\n\n')
}

module.exports = {
  AI_DRAFT_PANEL_COUNT,
  createAiAnnotationDraftDiagnostics,
  createEmptyAiAnnotationDraft,
  formatAiAnnotationDraftDiagnosticsMessage,
  getValidAiAnnotationDraft,
  hasAiAnnotationContent,
  hasAiAnnotationListContent,
  normalizeAiAnnotationDraft,
  resolveAiAnnotationDraftResolution,
  validateAiAnnotationDraft,
  buildAiAnnotationRepairPrompt,
}
