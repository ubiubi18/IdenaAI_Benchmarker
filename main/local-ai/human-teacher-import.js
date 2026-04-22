const fs = require('fs-extra')
const path = require('path')

const VALID_FINAL_ANSWERS = new Set(['left', 'right', 'skip'])

function trimText(value, maxLength = 2000) {
  return String(value || '')
    .trim()
    .slice(0, maxLength)
}

function normalizeBool(value) {
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

function normalizeConfidence(value) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return null
  }

  const parsed = Number.parseFloat(value)

  if (!Number.isFinite(parsed) || parsed < 0) {
    return null
  }

  if (parsed <= 1) {
    return Math.min(5, Math.max(1, Math.round(parsed * 4 + 1)))
  }

  if (parsed > 5) {
    return null
  }

  return Math.round(parsed)
}

function normalizeBenchmarkReviewIssueType(value) {
  const next = trimText(value, 64).toLowerCase().replace(/\s+/gu, '_')

  return [
    'wrong_answer',
    'missed_text',
    'sequence_confusion',
    'reportability_miss',
    'weak_reasoning',
    'panel_read_failure',
    'ambiguous_flip',
    'other',
  ].includes(next)
    ? next
    : ''
}

function normalizeCaptions(value) {
  const captions = Array.isArray(value)
    ? value.slice(0, 4).map((item) => trimText(item, 400))
    : []

  while (captions.length < 4) {
    captions.push('')
  }

  return captions
}

function normalizeOptionalEpoch(value) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return null
  }

  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizePanelReferenceIndex(value) {
  const parsed = Number.parseInt(value, 10)

  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 3) {
    return null
  }

  if (parsed <= 1) {
    return Math.min(5, Math.max(1, Math.round(parsed * 4 + 1)))
  }

  if (parsed > 5) {
    return null
  }

  return Math.round(parsed)
}

function normalizePanelReferenceCoordinate(value) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return null
  }

  const parsed = Number.parseFloat(value)

  if (!Number.isFinite(parsed)) {
    return null
  }

  return Math.max(0, Math.min(1, parsed))
}

function normalizePanelReferences(value) {
  let source = []

  if (Array.isArray(value)) {
    source = value
  } else if (value && typeof value === 'object') {
    source = ['A', 'B', 'C'].map((code) => {
      const raw =
        value[code] ||
        value[code.toLowerCase()] ||
        value[String(code || '').toUpperCase()] ||
        {}

      return typeof raw === 'string' ? {code, description: raw} : {code, ...raw}
    })
  }
  const byCode = new Map(
    source
      .map((entry, index) => {
        const code = String(entry?.code || ['A', 'B', 'C'][index] || '')
          .trim()
          .toUpperCase()

        return [code, entry]
      })
      .filter(([code]) => ['A', 'B', 'C'].includes(code))
  )

  return ['A', 'B', 'C'].map((code) => {
    const raw = byCode.get(code) || {}
    const panelIndex = normalizePanelReferenceIndex(
      raw.panel_index ?? raw.panelIndex
    )

    return {
      code,
      description: trimText(raw.description, 160),
      panel_index: panelIndex,
      x: panelIndex === null ? null : normalizePanelReferenceCoordinate(raw.x),
      y: panelIndex === null ? null : normalizePanelReferenceCoordinate(raw.y),
    }
  })
}

function readAnnotationField(annotationRow, snakeKey, camelKey) {
  if (Object.prototype.hasOwnProperty.call(annotationRow, snakeKey)) {
    return annotationRow[snakeKey]
  }

  if (Object.prototype.hasOwnProperty.call(annotationRow, camelKey)) {
    return annotationRow[camelKey]
  }

  return undefined
}

function validateFinalAnswer(value) {
  const answer = trimText(value, 16).toLowerCase()

  if (!VALID_FINAL_ANSWERS.has(answer)) {
    throw new Error(`Invalid final_answer: ${answer || 'empty'}`)
  }

  return answer
}

async function loadJsonl(filePath) {
  const targetPath = path.resolve(String(filePath || '').trim())

  if (!targetPath) {
    throw new Error('filePath is required')
  }

  const raw = await fs.readFile(targetPath, 'utf8')

  return raw
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function normalizeAiAnnotation(value, expectedTaskId = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const normalizeList = (input, maxItems, maxLength) => {
    let items = []

    if (Array.isArray(input)) {
      items = input
    } else if (input && typeof input === 'object') {
      items = Object.entries(input)
        .sort(([left], [right]) => Number(left) - Number(right))
        .map(([_key, item]) => item)
    }

    const nextList = items
      .slice(0, maxItems)
      .map((item) => trimText(item, maxLength))

    while (nextList.length < maxItems) {
      nextList.push('')
    }

    return nextList
  }

  const rating = String(value.rating || '')
    .trim()
    .toLowerCase()
  const normalizedTaskId = trimText(value.task_id || value.taskId, 256)
  const rawFinalAnswer = trimText(value.final_answer || value.finalAnswer, 16)
  const finalAnswer = ['left', 'right', 'skip'].includes(
    rawFinalAnswer.toLowerCase()
  )
    ? rawFinalAnswer.toLowerCase()
    : null

  if (
    expectedTaskId &&
    normalizedTaskId &&
    normalizedTaskId !== String(expectedTaskId).trim()
  ) {
    throw new Error('AI annotation task_id does not match task_id')
  }

  const next = {
    task_id: String(expectedTaskId || normalizedTaskId || '').trim() || null,
    generated_at: trimText(value.generated_at || value.generatedAt, 64) || null,
    runtime_backend:
      trimText(value.runtime_backend || value.runtimeBackend, 64) || null,
    runtime_type: trimText(value.runtime_type || value.runtimeType, 64) || null,
    model: trimText(value.model, 256) || null,
    vision_model:
      trimText(value.vision_model || value.visionModel, 256) || null,
    ordered_panel_descriptions: normalizeList(
      value.ordered_panel_descriptions || value.orderedPanelDescriptions,
      8,
      280
    ),
    ordered_panel_text: normalizeList(
      value.ordered_panel_text || value.orderedPanelText,
      8,
      200
    ),
    option_a_story_analysis:
      trimText(
        value.option_a_story_analysis || value.optionAStoryAnalysis,
        500
      ) || '',
    option_b_story_analysis:
      trimText(
        value.option_b_story_analysis || value.optionBStoryAnalysis,
        500
      ) || '',
    final_answer: finalAnswer,
    why_answer: trimText(value.why_answer || value.whyAnswer, 900),
    confidence: normalizeConfidence(value.confidence),
    text_required: normalizeBool(value.text_required ?? value.textRequired),
    sequence_markers_present: normalizeBool(
      value.sequence_markers_present ?? value.sequenceMarkersPresent
    ),
    report_required: normalizeBool(
      value.report_required ?? value.reportRequired
    ),
    report_reason: trimText(value.report_reason || value.reportReason, 400),
    option_a_summary: trimText(
      value.option_a_summary || value.optionASummary,
      400
    ),
    option_b_summary: trimText(
      value.option_b_summary || value.optionBSummary,
      400
    ),
    rating: ['good', 'bad', 'wrong'].includes(rating) ? rating : '',
  }

  const {task_id: _taskId, ...contentFields} = next

  return Object.values(contentFields).some((item) =>
    Array.isArray(item)
      ? item.some((entry) => entry !== null && entry !== '')
      : item !== null && item !== ''
  )
    ? next
    : null
}

function validateAnnotationTaskBinding(taskRow, annotationRow) {
  const taskId = trimText(taskRow.task_id, 256)
  const sampleId = trimText(taskRow.sample_id || taskId, 256)
  const flipHash = trimText(taskRow.flip_hash, 512)
  const consensusAnswer = trimText(taskRow.final_answer, 16).toLowerCase()
  const expectedEpoch = normalizeOptionalEpoch(taskRow.epoch)

  if (trimText(annotationRow.task_id, 256) !== taskId) {
    throw new Error('Annotation task_id does not match manifest task_id')
  }

  const annotationSampleId = trimText(annotationRow.sample_id, 256)
  if (annotationSampleId && annotationSampleId !== sampleId) {
    throw new Error('Annotation sample_id does not match manifest sample_id')
  }

  const annotationFlipHash = trimText(annotationRow.flip_hash, 512)
  if (annotationFlipHash && annotationFlipHash !== flipHash) {
    throw new Error('Annotation flip_hash does not match manifest flip_hash')
  }

  const annotationConsensusAnswer = trimText(
    annotationRow.consensus_answer,
    16
  ).toLowerCase()
  if (
    annotationConsensusAnswer &&
    consensusAnswer &&
    annotationConsensusAnswer !== consensusAnswer
  ) {
    throw new Error(
      'Annotation consensus_answer does not match manifest consensus answer'
    )
  }

  const annotationEpoch = normalizeOptionalEpoch(annotationRow.epoch)
  if (
    annotationEpoch !== null &&
    expectedEpoch !== null &&
    annotationEpoch !== expectedEpoch
  ) {
    throw new Error('Annotation epoch does not match manifest epoch')
  }
}

function assertCompleteHumanTeacherAnnotation({
  textRequired,
  sequenceMarkersPresent,
  reportRequired,
  reportReason,
  whyAnswer,
  confidence,
}) {
  if (textRequired === null) {
    throw new Error('text_required is required')
  }

  if (sequenceMarkersPresent === null) {
    throw new Error('sequence_markers_present is required')
  }

  if (reportRequired === null) {
    throw new Error('report_required is required')
  }

  if (reportRequired === true && !reportReason) {
    throw new Error('report_reason is required when report_required is true')
  }

  if (!whyAnswer) {
    throw new Error('why_answer is required')
  }

  if (confidence === null) {
    throw new Error('confidence is required')
  }
}

function normalizeAnnotation(taskRow, annotationRow) {
  validateAnnotationTaskBinding(taskRow, annotationRow)
  const frameCaptions = normalizeCaptions(annotationRow.frame_captions)
  const optionASummary = trimText(annotationRow.option_a_summary)
  const optionBSummary = trimText(annotationRow.option_b_summary)
  const textRequired = normalizeBool(annotationRow.text_required)
  const sequenceMarkersPresent = normalizeBool(
    annotationRow.sequence_markers_present
  )
  const reportRequired = normalizeBool(annotationRow.report_required)
  const reportReason = trimText(annotationRow.report_reason)
  const whyAnswer = trimText(annotationRow.why_answer)
  const confidence = normalizeConfidence(annotationRow.confidence)
  let benchmarkReviewSource = {}
  if (
    annotationRow.benchmark_review &&
    typeof annotationRow.benchmark_review === 'object' &&
    !Array.isArray(annotationRow.benchmark_review)
  ) {
    benchmarkReviewSource = annotationRow.benchmark_review
  } else if (
    annotationRow.benchmarkReview &&
    typeof annotationRow.benchmarkReview === 'object' &&
    !Array.isArray(annotationRow.benchmarkReview)
  ) {
    benchmarkReviewSource = annotationRow.benchmarkReview
  }
  const benchmarkReviewCorrection =
    benchmarkReviewSource.correction &&
    typeof benchmarkReviewSource.correction === 'object' &&
    !Array.isArray(benchmarkReviewSource.correction)
      ? benchmarkReviewSource.correction
      : {}
  let benchmarkReviewIssueTypeSource
  if (typeof benchmarkReviewCorrection.issue_type !== 'undefined') {
    benchmarkReviewIssueTypeSource = benchmarkReviewCorrection.issue_type
  } else if (typeof benchmarkReviewCorrection.issueType !== 'undefined') {
    benchmarkReviewIssueTypeSource = benchmarkReviewCorrection.issueType
  } else {
    benchmarkReviewIssueTypeSource = readAnnotationField(
      annotationRow,
      'benchmark_review_issue_type',
      'benchmarkReviewIssueType'
    )
  }
  let benchmarkReviewFailureNoteSource
  if (typeof benchmarkReviewCorrection.failure_note !== 'undefined') {
    benchmarkReviewFailureNoteSource = benchmarkReviewCorrection.failure_note
  } else if (typeof benchmarkReviewCorrection.failureNote !== 'undefined') {
    benchmarkReviewFailureNoteSource = benchmarkReviewCorrection.failureNote
  } else {
    benchmarkReviewFailureNoteSource = readAnnotationField(
      annotationRow,
      'benchmark_review_failure_note',
      'benchmarkReviewFailureNote'
    )
  }
  let benchmarkReviewRetrainingHintSource
  if (typeof benchmarkReviewCorrection.retraining_hint !== 'undefined') {
    benchmarkReviewRetrainingHintSource =
      benchmarkReviewCorrection.retraining_hint
  } else if (typeof benchmarkReviewCorrection.retrainingHint !== 'undefined') {
    benchmarkReviewRetrainingHintSource =
      benchmarkReviewCorrection.retrainingHint
  } else {
    benchmarkReviewRetrainingHintSource = readAnnotationField(
      annotationRow,
      'benchmark_review_retraining_hint',
      'benchmarkReviewRetrainingHint'
    )
  }
  let benchmarkReviewIncludeForTrainingSource
  if (typeof benchmarkReviewCorrection.include_for_training !== 'undefined') {
    benchmarkReviewIncludeForTrainingSource =
      benchmarkReviewCorrection.include_for_training
  } else if (
    typeof benchmarkReviewCorrection.includeForTraining !== 'undefined'
  ) {
    benchmarkReviewIncludeForTrainingSource =
      benchmarkReviewCorrection.includeForTraining
  } else {
    benchmarkReviewIncludeForTrainingSource = readAnnotationField(
      annotationRow,
      'benchmark_review_include_for_training',
      'benchmarkReviewIncludeForTraining'
    )
  }
  const finalAnswer = validateFinalAnswer(annotationRow.final_answer)
  const benchmarkReviewIssueType = normalizeBenchmarkReviewIssueType(
    benchmarkReviewIssueTypeSource
  )
  const benchmarkReviewFailureNote = trimText(
    benchmarkReviewFailureNoteSource,
    900
  )
  const benchmarkReviewRetrainingHint = trimText(
    benchmarkReviewRetrainingHintSource,
    900
  )
  const benchmarkReviewIncludeForTraining = normalizeBool(
    benchmarkReviewIncludeForTrainingSource
  )
  const benchmarkReviewContext =
    benchmarkReviewSource.context &&
    typeof benchmarkReviewSource.context === 'object' &&
    !Array.isArray(benchmarkReviewSource.context)
      ? benchmarkReviewSource.context
      : {}

  assertCompleteHumanTeacherAnnotation({
    textRequired,
    sequenceMarkersPresent,
    reportRequired,
    reportReason,
    whyAnswer,
    confidence,
  })

  return {
    task_id: taskRow.task_id,
    sample_id: taskRow.sample_id || taskRow.task_id,
    flip_hash: taskRow.flip_hash || null,
    epoch: taskRow.epoch ?? null,
    annotator: trimText(annotationRow.annotator, 256) || null,
    frame_captions: frameCaptions,
    option_a_summary: optionASummary,
    option_b_summary: optionBSummary,
    ai_annotation: normalizeAiAnnotation(
      annotationRow.ai_annotation || annotationRow.aiAnnotation,
      taskRow.task_id
    ),
    ai_annotation_feedback: trimText(
      annotationRow.ai_annotation_feedback ||
        annotationRow.aiAnnotationFeedback,
      600
    ),
    panel_references: normalizePanelReferences(
      annotationRow.panel_references || annotationRow.panelReferences
    ),
    text_required: textRequired,
    sequence_markers_present: sequenceMarkersPresent,
    report_required: reportRequired,
    report_reason: reportReason,
    final_answer: finalAnswer,
    why_answer: whyAnswer,
    confidence,
    benchmark_review: {
      context: {
        expected_answer: trimText(
          benchmarkReviewContext.expected_answer ??
            benchmarkReviewContext.expectedAnswer,
          16
        ).toLowerCase(),
        ai_prediction: trimText(
          benchmarkReviewContext.ai_prediction ??
            benchmarkReviewContext.aiPrediction,
          16
        ).toLowerCase(),
        baseline_prediction: trimText(
          benchmarkReviewContext.baseline_prediction ??
            benchmarkReviewContext.baselinePrediction,
          16
        ).toLowerCase(),
        previous_prediction: trimText(
          benchmarkReviewContext.previous_prediction ??
            benchmarkReviewContext.previousPrediction,
          16
        ).toLowerCase(),
        benchmark_flips:
          benchmarkReviewContext.benchmark_flips ??
          benchmarkReviewContext.benchmarkFlips ??
          null,
        evaluated_at: trimText(
          benchmarkReviewContext.evaluated_at ??
            benchmarkReviewContext.evaluatedAt,
          64
        ),
        change_type: trimText(
          benchmarkReviewContext.change_type ??
            benchmarkReviewContext.changeType,
          64
        )
          .toLowerCase()
          .replace(/\s+/gu, '_'),
        ai_correct: normalizeBool(
          benchmarkReviewContext.ai_correct ?? benchmarkReviewContext.aiCorrect
        ),
      },
      correction: {
        issue_type: benchmarkReviewIssueType,
        failure_note: benchmarkReviewFailureNote,
        retraining_hint: benchmarkReviewRetrainingHint,
        include_for_training: benchmarkReviewIncludeForTraining,
      },
    },
    benchmark_review_issue_type: benchmarkReviewIssueType,
    benchmark_review_failure_note: benchmarkReviewFailureNote,
    benchmark_review_retraining_hint: benchmarkReviewRetrainingHint,
    benchmark_review_include_for_training: benchmarkReviewIncludeForTraining,
    consensus_answer: taskRow.final_answer || null,
    consensus_strength: taskRow.consensus_strength || null,
    training_weight:
      Number.isFinite(Number(taskRow.training_weight)) &&
      Number(taskRow.training_weight) > 0
        ? Number(taskRow.training_weight)
        : null,
    ranking_source: taskRow.ranking_source || null,
    left_order: Array.isArray(taskRow.left_order) ? taskRow.left_order : [],
    right_order: Array.isArray(taskRow.right_order) ? taskRow.right_order : [],
    words:
      taskRow.words &&
      typeof taskRow.words === 'object' &&
      !Array.isArray(taskRow.words)
        ? taskRow.words
        : {},
    selected_order: taskRow.selected_order || null,
  }
}

async function importHumanTeacherAnnotations({
  taskManifestPath,
  annotationsJsonlPath,
  outputJsonlPath,
  summaryPath,
} = {}) {
  const resolvedTaskManifestPath = path.resolve(
    String(taskManifestPath || '').trim()
  )
  const resolvedAnnotationsPath = path.resolve(
    String(annotationsJsonlPath || '').trim()
  )
  const resolvedOutputPath = path.resolve(String(outputJsonlPath || '').trim())
  const resolvedSummaryPath = summaryPath
    ? path.resolve(String(summaryPath || '').trim())
    : null

  if (
    !resolvedTaskManifestPath ||
    !resolvedAnnotationsPath ||
    !resolvedOutputPath
  ) {
    throw new Error(
      'taskManifestPath, annotationsJsonlPath, and outputJsonlPath are required'
    )
  }

  const taskRows = await loadJsonl(resolvedTaskManifestPath)
  const annotationRows = await loadJsonl(resolvedAnnotationsPath)
  const taskById = new Map(
    taskRows
      .map((row) => [String(row && row.task_id ? row.task_id : '').trim(), row])
      .filter(([taskId]) => taskId)
  )

  const normalizedRows = []
  const seenTaskIds = new Set()
  const duplicateTaskCounts = annotationRows.reduce((counts, annotationRow) => {
    const taskId = String(
      annotationRow && annotationRow.task_id ? annotationRow.task_id : ''
    ).trim()

    if (taskId && taskById.has(taskId)) {
      counts.set(taskId, (counts.get(taskId) || 0) + 1)
    }

    return counts
  }, new Map())
  let unmatchedAnnotations = 0
  let invalidAnnotations = 0
  let duplicateAnnotations = 0

  annotationRows.forEach((annotationRow) => {
    const taskId = String(
      annotationRow && annotationRow.task_id ? annotationRow.task_id : ''
    ).trim()

    if (!taskId || !taskById.has(taskId)) {
      unmatchedAnnotations += 1
      return
    }

    if ((duplicateTaskCounts.get(taskId) || 0) > 1) {
      duplicateAnnotations += 1
      return
    }

    try {
      const normalized = normalizeAnnotation(
        taskById.get(taskId),
        annotationRow
      )
      normalizedRows.push(normalized)
      seenTaskIds.add(taskId)
    } catch {
      invalidAnnotations += 1
    }
  })

  const summary = {
    taskManifest: resolvedTaskManifestPath,
    annotationsJsonl: resolvedAnnotationsPath,
    outputJsonl: resolvedOutputPath,
    summaryPath: resolvedSummaryPath,
    taskRows: taskRows.length,
    annotationRows: annotationRows.length,
    normalizedRows: normalizedRows.length,
    missingAnnotations: Math.max(taskRows.length - seenTaskIds.size, 0),
    unmatchedAnnotations,
    invalidAnnotations,
    duplicateAnnotations,
  }

  await fs.ensureDir(path.dirname(resolvedOutputPath))
  await fs.writeFile(
    resolvedOutputPath,
    `${normalizedRows.map((row) => JSON.stringify(row)).join('\n')}\n`,
    'utf8'
  )

  if (resolvedSummaryPath) {
    await fs.ensureDir(path.dirname(resolvedSummaryPath))
    await fs.writeJson(resolvedSummaryPath, summary, {spaces: 2})
  }

  return {
    ...summary,
    rows: normalizedRows,
  }
}

module.exports = {
  importHumanTeacherAnnotations,
}
