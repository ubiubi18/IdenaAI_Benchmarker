/* eslint-disable react/prop-types */
import React from 'react'
import {
  Alert,
  Badge,
  Box,
  Flex,
  Image,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Progress,
  SimpleGrid,
  Stack,
  Text,
  useToast,
} from '@chakra-ui/react'
import {useRouter} from 'next/router'
import {useTranslation} from 'react-i18next'
import SettingsLayout from '../../screens/settings/layout'
import {SettingsSection} from '../../screens/settings/components'
import {PrimaryButton, SecondaryButton} from '../../shared/components/button'
import {rewardWithConfetti} from '../../shared/utils/onboarding'
import {
  useSettingsDispatch,
  useSettingsState,
} from '../../shared/providers/settings-context'
import {
  DEFAULT_DEVELOPER_AI_DRAFT_TRIGGER_MODE,
  DEFAULT_DEVELOPER_AI_DRAFT_ANSWER_WINDOW_TOKENS,
  DEFAULT_DEVELOPER_AI_DRAFT_CONTEXT_WINDOW_TOKENS,
  DEFAULT_DEVELOPER_AI_DRAFT_QUESTION_WINDOW_CHARS,
  DEFAULT_DEVELOPER_LOCAL_TRAINING_BATCH_SIZE,
  DEFAULT_DEVELOPER_LOCAL_TRAINING_EPOCHS,
  DEFAULT_DEVELOPER_LOCAL_TRAINING_LORA_RANK,
  DEFAULT_DEVELOPER_LOCAL_BENCHMARK_SIZE,
  DEFAULT_DEVELOPER_LOCAL_TRAINING_PROFILE,
  DEFAULT_DEVELOPER_LOCAL_TRAINING_THERMAL_MODE,
  DEFAULT_HUMAN_TEACHER_SYSTEM_PROMPT,
  DEVELOPER_LOCAL_BENCHMARK_SIZE_OPTIONS,
  normalizeDeveloperAiDraftAnswerWindowTokens,
  normalizeDeveloperAiDraftContextWindowTokens,
  normalizeDeveloperAiDraftTriggerMode,
  normalizeDeveloperAiDraftQuestionWindowChars,
  normalizeDeveloperLocalTrainingBatchSize,
  normalizeDeveloperLocalTrainingEpochs,
  normalizeDeveloperLocalTrainingLoraRank,
  normalizeDeveloperLocalBenchmarkSize,
  normalizeDeveloperLocalTrainingProfile,
  normalizeDeveloperLocalTrainingThermalMode,
  resolveDeveloperLocalTrainingProfileModelPath,
  resolveDeveloperLocalTrainingProfileRuntimeModel,
  resolveDeveloperLocalTrainingProfileRuntimeVisionModel,
  resolveDeveloperLocalTrainingThermalModeCooldowns,
} from '../../shared/utils/local-ai-settings'
import {
  FormLabel,
  Input,
  Select,
  Textarea,
  Toast,
} from '../../shared/components/components'
import {useEpochState} from '../../shared/providers/epoch-context'

const HUMAN_TEACHER_SET_LIMIT = 30
const AUTO_SAVE_DELAY_MS = 2500
const PANEL_REFERENCE_CODES = ['A', 'B', 'C']
const AI_ANNOTATION_RATINGS = ['good', 'bad', 'wrong']
const AI_DRAFT_PANEL_COUNT = 8

function describeDeveloperLocalTrainingProfile(profile, t) {
  return {
    label: t('Fixed local Qwen lane'),
    detail: t(
      'idena.vibe now uses one local lane here only: qwen3.5:9b at runtime and mlx-community/Qwen3.5-9B-MLX-4bit for local training.'
    ),
  }
}

function describeDeveloperLocalTrainingThermalMode(mode, t) {
  const {
    mode: normalizedMode,
    stepCooldownMs,
    epochCooldownMs,
  } = resolveDeveloperLocalTrainingThermalModeCooldowns(mode)

  switch (normalizedMode) {
    case 'full_speed':
      return {
        mode: normalizedMode,
        label: t('Full speed'),
        detail: t(
          'Runs each local training step without extra cooling pauses. Fastest, hottest option.'
        ),
        stepCooldownMs,
        epochCooldownMs,
      }
    case 'cool':
      return {
        mode: normalizedMode,
        label: t('Cool and slower'),
        detail: t(
          'Adds longer cooling gaps between training steps and epochs to lower sustained heat on this Mac.'
        ),
        stepCooldownMs,
        epochCooldownMs,
      }
    case 'balanced':
    default:
      return {
        mode: 'balanced',
        label: t('Balanced cooling'),
        detail: t(
          'Adds short pauses between local training steps so the MacBook runs cooler while still finishing in reasonable time.'
        ),
        stepCooldownMs,
        epochCooldownMs,
      }
  }
}

function describeDeveloperLocalBenchmarkSizeOption(size, t) {
  switch (Number(size)) {
    case 50:
      return t('50 flips (quickest)')
    case 200:
      return t('200 flips (stronger check, slower)')
    case 100:
    default:
      return t('100 flips (balanced)')
  }
}

function describeDeveloperAiDraftWindowTone({
  contextWindowTokens,
  questionWindowChars,
  answerWindowTokens,
}) {
  if (
    contextWindowTokens >= 16384 ||
    questionWindowChars >= 2400 ||
    answerWindowTokens >= 1024
  ) {
    return {
      tone: 'orange',
    }
  }

  if (
    contextWindowTokens > 0 &&
    contextWindowTokens <= 4096 &&
    answerWindowTokens <= 384
  ) {
    return {
      tone: 'blue',
    }
  }

  return {
    tone: 'green',
  }
}

function describeDeveloperLocalTrainingBudgetTone({
  batchSize,
  epochs,
  loraRank,
  thermalMode,
}) {
  if (
    batchSize >= 2 ||
    epochs >= 3 ||
    loraRank >= 12 ||
    thermalMode === 'full_speed'
  ) {
    return {tone: 'orange'}
  }

  if (epochs <= 1 && loraRank <= 6 && thermalMode === 'cool') {
    return {tone: 'blue'}
  }

  return {tone: 'green'}
}

function createAiDraftRuntimeResolution(overrides = {}) {
  return {
    status: 'idle',
    requestedModel: '',
    activeModel: '',
    fallbackModel: '',
    fallbackUsed: false,
    fallbackReason: '',
    installHint: '',
    availableModels: [],
    lastError: '',
    ...overrides,
  }
}

function resolveAiDraftRuntimeResolution({
  requestedModel = '',
  fallbackModel: _fallbackModel = '',
  availableModels = [],
} = {}) {
  const requested = String(requestedModel || '').trim()
  const models = Array.isArray(availableModels)
    ? availableModels.map((item) => String(item || '').trim()).filter(Boolean)
    : []

  if (requested && models.includes(requested)) {
    return createAiDraftRuntimeResolution({
      status: 'ready',
      requestedModel: requested,
      activeModel: requested,
      fallbackModel: '',
      availableModels: models,
      installHint: `ollama pull ${requested}`,
    })
  }

  return createAiDraftRuntimeResolution({
    status: requested ? 'missing' : 'idle',
    requestedModel: requested,
    activeModel: '',
    fallbackModel: '',
    fallbackReason: requested
      ? `${requested} is not installed in Ollama on this machine yet.`
      : '',
    installHint: requested ? `ollama pull ${requested}` : '',
    availableModels: models,
  })
}

function createEmptyPanelReference(code) {
  return {
    code,
    description: '',
    panel_index: null,
    x: null,
    y: null,
  }
}

function normalizePanelReferenceIndex(value) {
  const parsed = Number.parseInt(value, 10)

  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 3) {
    return null
  }

  return parsed
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
    source = PANEL_REFERENCE_CODES.map((code) => {
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
        const code = String(entry?.code || PANEL_REFERENCE_CODES[index] || '')
          .trim()
          .toUpperCase()

        return [code, entry]
      })
      .filter(([code]) => PANEL_REFERENCE_CODES.includes(code))
  )

  return PANEL_REFERENCE_CODES.map((code) => {
    const raw = byCode.get(code) || {}
    const panelIndex = normalizePanelReferenceIndex(
      raw.panel_index ?? raw.panelIndex
    )

    return {
      ...createEmptyPanelReference(code),
      description: String(raw.description || '')
        .trim()
        .slice(0, 160),
      panel_index: panelIndex,
      x: panelIndex === null ? null : normalizePanelReferenceCoordinate(raw.x),
      y: panelIndex === null ? null : normalizePanelReferenceCoordinate(raw.y),
    }
  })
}

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

function normalizeAiAnnotationDraft(annotation = {}) {
  const next =
    annotation && typeof annotation === 'object' && !Array.isArray(annotation)
      ? {
          ...createEmptyAiAnnotationDraft(),
          ...annotation,
        }
      : createEmptyAiAnnotationDraft()
  const finalAnswer = String(next.final_answer ?? next.finalAnswer ?? '')
    .trim()
    .toLowerCase()
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
      next.ordered_panel_descriptions ?? next.orderedPanelDescriptions,
      {
        maxItems: AI_DRAFT_PANEL_COUNT,
        maxLength: 280,
      }
    ),
    ordered_panel_text: normalizeAiAnnotationDraftList(
      next.ordered_panel_text ?? next.orderedPanelText,
      {
        maxItems: AI_DRAFT_PANEL_COUNT,
        maxLength: 200,
      }
    ),
    option_a_story_analysis: String(
      next.option_a_story_analysis ?? next.optionAStoryAnalysis ?? ''
    )
      .trim()
      .slice(0, 500),
    option_b_story_analysis: String(
      next.option_b_story_analysis ?? next.optionBStoryAnalysis ?? ''
    )
      .trim()
      .slice(0, 500),
    final_answer: ['left', 'right', 'skip'].includes(finalAnswer)
      ? finalAnswer
      : '',
    why_answer: String(next.why_answer ?? next.whyAnswer ?? '')
      .trim()
      .slice(0, 900),
    confidence: normalizeAiAnnotationConfidence(next.confidence),
    text_required:
      Object.prototype.hasOwnProperty.call(next, 'text_required') ||
      Object.prototype.hasOwnProperty.call(next, 'textRequired')
        ? next.text_required ?? next.textRequired
        : null,
    sequence_markers_present:
      Object.prototype.hasOwnProperty.call(next, 'sequence_markers_present') ||
      Object.prototype.hasOwnProperty.call(next, 'sequenceMarkersPresent')
        ? next.sequence_markers_present ?? next.sequenceMarkersPresent
        : null,
    report_required:
      Object.prototype.hasOwnProperty.call(next, 'report_required') ||
      Object.prototype.hasOwnProperty.call(next, 'reportRequired')
        ? next.report_required ?? next.reportRequired
        : null,
    report_reason: String(next.report_reason ?? next.reportReason ?? '')
      .trim()
      .slice(0, 400),
    option_a_summary: String(next.option_a_summary ?? next.optionASummary ?? '')
      .trim()
      .slice(0, 400),
    option_b_summary: String(next.option_b_summary ?? next.optionBSummary ?? '')
      .trim()
      .slice(0, 400),
    rating: normalizeAiAnnotationRating(next.rating),
  }

  return hasAiAnnotationContent(normalized) ? normalized : null
}

function isAiAnnotationBoundToTask(aiAnnotation, task = {}) {
  const taskId = String(task?.taskId || task?.task_id || '').trim()
  const annotationTaskId = String(
    aiAnnotation?.task_id ?? aiAnnotation?.taskId ?? ''
  ).trim()

  return Boolean(taskId && annotationTaskId && taskId === annotationTaskId)
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
    next.generated_at ||
      next.runtime_backend ||
      next.runtime_type ||
      next.model ||
      next.vision_model ||
      hasAiAnnotationListContent(next.ordered_panel_descriptions) ||
      hasAiAnnotationListContent(next.ordered_panel_text) ||
      next.option_a_story_analysis ||
      next.option_b_story_analysis ||
      next.final_answer ||
      next.why_answer ||
      next.option_a_summary ||
      next.option_b_summary ||
      next.rating ||
      next.report_reason ||
      next.text_required !== null ||
      next.sequence_markers_present !== null ||
      next.report_required !== null ||
      next.confidence !== ''
  )
}

function hasPanelReferenceContent(reference = {}) {
  return Boolean(
    String(reference.description || '').trim() || reference.panel_index !== null
  )
}

function formatErrorMessage(error) {
  const raw = String((error && error.message) || error || '').trim()
  const prefix = /Error invoking remote method '[^']+':\s*/i
  const message = raw.replace(prefix, '').trim()

  if (
    /No handler registered for 'localAi\.(?:loadHumanTeacherDemoWorkspace|loadHumanTeacherDemoTask|saveHumanTeacherDemoDraft|finalizeHumanTeacherDemoChunk|runHumanTeacherDeveloperComparison|loadHumanTeacherAnnotationWorkspace|loadHumanTeacherAnnotationTask|saveHumanTeacherAnnotationDraft|importHumanTeacherAnnotations|exportHumanTeacherTasks|chat)'/i.test(
      message
    )
  ) {
    return 'This human-teacher feature is not available in the running main process yet. Fully restart idena.vibe and try again.'
  }

  if (/Local AI human-teacher bridge is unavailable/i.test(message)) {
    return 'The human-teacher bridge is unavailable in this build. Fully restart idena.vibe and try again.'
  }

  if (
    /Developer human-teacher .* blocked while a validation session is running/i.test(
      message
    )
  ) {
    return 'Developer flip training is unavailable while a validation session is running. Save your notes and return after validation ends.'
  }

  return message || 'Unknown error'
}

function extractTrainingFailureReason(result) {
  const source =
    result && typeof result === 'object' && !Array.isArray(result) ? result : {}
  const rawError =
    source.error &&
    typeof source.error === 'object' &&
    !Array.isArray(source.error)
      ? source.error
      : null

  const candidates = [
    source.failureReason,
    source.message,
    source.reason,
    source.lastError,
    rawError?.message,
    typeof source.error === 'string' ? source.error : null,
    source.details,
    source.stderr,
    source.status,
  ]

  for (const candidate of candidates) {
    const message = String(candidate || '').trim()

    if (message) {
      return message.slice(0, 400)
    }
  }

  return ''
}

function isTrainingUnsupportedReason(reason) {
  return /not implemented by this Local AI sidecar/i.test(
    String(reason || '').trim()
  )
}

function normalizeReviewStatus(value) {
  const status = String(value || '')
    .trim()
    .toLowerCase()
  switch (status) {
    case 'approved':
    case 'rejected':
    case 'reviewed':
      return status
    default:
      return 'draft'
  }
}

function describeHumanTeacherPackage(t, result = {}) {
  const taskPackage =
    result && result.package && typeof result.package === 'object'
      ? result.package
      : null
  const eligibleCount = Number(result && result.eligibleCount) || 0
  const inconsistencyFlags = Array.isArray(taskPackage?.inconsistencyFlags)
    ? taskPackage.inconsistencyFlags
    : []

  if (!taskPackage) {
    return {
      label: t('Unavailable'),
      tone: 'gray',
      detail: t('No human-teacher annotation set exists for this epoch yet.'),
    }
  }

  if (normalizeReviewStatus(taskPackage.reviewStatus) === 'rejected') {
    return {
      label: t('Skipped'),
      tone: 'gray',
      detail: t(
        'You chose not to annotate this epoch. Federated updates still work normally; you just do not contribute annotation learnings for this annotation set.'
      ),
    }
  }

  if (eligibleCount > 0) {
    return {
      label:
        normalizeReviewStatus(taskPackage.reviewStatus) === 'approved'
          ? t('Ready to annotate')
          : t('Ready for review'),
      tone:
        normalizeReviewStatus(taskPackage.reviewStatus) === 'approved'
          ? 'green'
          : 'orange',
      detail: t(
        'Consensus-backed flips are available for voluntary human annotation one flip at a time.'
      ),
    }
  }

  if (inconsistencyFlags.includes('contains_unresolved_captures')) {
    return {
      label: t('Waiting for consensus'),
      tone: 'blue',
      detail: t(
        'The app has captures for this epoch, but final consensus is not ready yet for enough flips.'
      ),
    }
  }

  if (inconsistencyFlags.includes('contains_incomplete_metadata')) {
    return {
      label: t('Waiting for payloads'),
      tone: 'blue',
      detail: t(
        'Consensus is available, but payload-backed flips are not ready yet for export.'
      ),
    }
  }

  return {
    label: t('No eligible flips'),
    tone: 'gray',
    detail: t(
      'No voluntary annotation set is available for this epoch right now.'
    ),
  }
}

function createEmptyAnnotationDraft() {
  return {
    annotator: '',
    frame_captions: ['', '', '', ''],
    option_a_summary: '',
    option_b_summary: '',
    ai_annotation: null,
    ai_annotation_feedback: '',
    panel_references: PANEL_REFERENCE_CODES.map((code) =>
      createEmptyPanelReference(code)
    ),
    text_required: null,
    sequence_markers_present: null,
    report_required: null,
    report_reason: '',
    final_answer: '',
    why_answer: '',
    confidence: '',
  }
}

function normalizeAnnotationDraft(annotation = {}) {
  const next = {
    ...createEmptyAnnotationDraft(),
    ...(annotation && typeof annotation === 'object' ? annotation : {}),
  }
  const captions = Array.isArray(next.frame_captions)
    ? next.frame_captions.slice(0, 4)
    : []

  while (captions.length < 4) {
    captions.push('')
  }

  return {
    ...next,
    frame_captions: captions.map((item) => String(item || '')),
    annotator: String(next.annotator || ''),
    option_a_summary: String(next.option_a_summary || ''),
    option_b_summary: String(next.option_b_summary || ''),
    ai_annotation: normalizeAiAnnotationDraft(
      next.ai_annotation ?? next.aiAnnotation
    ),
    ai_annotation_feedback: String(
      next.ai_annotation_feedback ?? next.aiAnnotationFeedback ?? ''
    )
      .trim()
      .slice(0, 600),
    panel_references: normalizePanelReferences(
      next.panel_references ?? next.panelReferences
    ),
    text_required:
      Object.prototype.hasOwnProperty.call(next, 'text_required') ||
      Object.prototype.hasOwnProperty.call(next, 'textRequired')
        ? next.text_required ?? next.textRequired
        : null,
    sequence_markers_present:
      Object.prototype.hasOwnProperty.call(next, 'sequence_markers_present') ||
      Object.prototype.hasOwnProperty.call(next, 'sequenceMarkersPresent')
        ? next.sequence_markers_present ?? next.sequenceMarkersPresent
        : null,
    report_required:
      Object.prototype.hasOwnProperty.call(next, 'report_required') ||
      Object.prototype.hasOwnProperty.call(next, 'reportRequired')
        ? next.report_required ?? next.reportRequired
        : null,
    report_reason: String(next.report_reason ?? ''),
    final_answer: String(next.final_answer ?? ''),
    why_answer: String(next.why_answer ?? ''),
    confidence:
      next.confidence === null || typeof next.confidence === 'undefined'
        ? ''
        : String(next.confidence),
  }
}

function hasDraftContent(annotation = {}) {
  const next = normalizeAnnotationDraft(annotation)
  return Boolean(
    next.annotator ||
      next.frame_captions.some((item) => String(item || '').trim()) ||
      next.option_a_summary.trim() ||
      next.option_b_summary.trim() ||
      hasAiAnnotationContent(next.ai_annotation) ||
      next.ai_annotation_feedback.trim() ||
      next.panel_references.some((reference) =>
        hasPanelReferenceContent(reference)
      ) ||
      next.report_reason.trim() ||
      next.final_answer.trim() ||
      next.why_answer.trim() ||
      next.text_required !== null ||
      next.sequence_markers_present !== null ||
      next.report_required !== null ||
      next.confidence !== ''
  )
}

function getAnnotationCompletionState(annotation = {}) {
  const next = normalizeAnnotationDraft(annotation)
  const filledFrameCaptions = next.frame_captions.filter((item) =>
    String(item || '').trim()
  ).length
  const hasDecision = Boolean(next.final_answer.trim())
  const hasReason = Boolean(next.why_answer.trim())
  const hasTextDecision = next.text_required !== null
  const hasSequenceDecision = next.sequence_markers_present !== null
  const hasReportDecision = next.report_required !== null
  const hasReportReason =
    next.report_required !== true || Boolean(next.report_reason.trim())
  const hasConfidence = next.confidence !== ''
  const hasOptionASummary = Boolean(next.option_a_summary.trim())
  const hasOptionBSummary = Boolean(next.option_b_summary.trim())
  const hasStorySummaries = hasOptionASummary && hasOptionBSummary
  const hasFrameCaptions = filledFrameCaptions === 4
  const checks = [
    hasDecision,
    hasReason,
    hasTextDecision,
    hasSequenceDecision,
    hasReportDecision && hasReportReason,
    hasConfidence,
    hasFrameCaptions,
    hasStorySummaries,
  ]

  return {
    filledFrameCaptions,
    hasDecision,
    hasReason,
    hasTextDecision,
    hasSequenceDecision,
    hasReportDecision,
    hasReportReason,
    hasConfidence,
    hasOptionASummary,
    hasOptionBSummary,
    hasStorySummaries,
    hasFrameCaptions,
    completedChecks: checks.filter(Boolean).length,
    totalChecks: checks.length,
    remainingChecks: checks.filter((item) => !item).length,
    requiredDetailComplete: hasFrameCaptions && hasStorySummaries,
    isComplete: checks.every(Boolean),
  }
}

function isCompleteDraft(annotation = {}) {
  return getAnnotationCompletionState(annotation).isComplete
}

function normalizePanelOrder(order = [], panelCount = 0) {
  const normalizedOrder = Array.isArray(order)
    ? order
        .map((value) => Number.parseInt(value, 10))
        .filter(
          (value, index, values) =>
            Number.isFinite(value) &&
            value >= 0 &&
            value < panelCount &&
            values.indexOf(value) === index
        )
    : []

  if (normalizedOrder.length === panelCount && panelCount > 0) {
    return normalizedOrder
  }

  return Array.from({length: panelCount}, (_unused, index) => index)
}

function getOrderedPanels(task = {}, order = []) {
  const safeTask = task && typeof task === 'object' ? task : {}
  const panels = Array.isArray(safeTask.panels) ? safeTask.panels : []
  const effectiveOrder = normalizePanelOrder(order, panels.length)
  const panelsByIndex = new Map(
    panels
      .map((panel) => [Number(panel.index), panel])
      .filter(([index]) => Number.isFinite(index))
  )

  return effectiveOrder
    .map((index) => panelsByIndex.get(Number(index)))
    .filter(Boolean)
}

function parseAiAnnotationResponse(text = '') {
  const raw = String(text || '').trim()

  if (!raw) {
    throw new Error('Local AI returned an empty draft response.')
  }

  const direct = () => JSON.parse(raw)
  const fromFence = () => {
    const match = raw.match(/```(?:json)?\s*([\s\S]+?)\s*```/iu)
    if (!match) {
      throw new Error('No JSON object found in the Local AI draft response.')
    }
    return JSON.parse(String(match[1] || '').trim())
  }

  try {
    return direct()
  } catch {
    return fromFence()
  }
}

function buildAiAnnotationSystemPrompt(basePrompt = '') {
  const prefix = String(basePrompt || '').trim()

  return [
    prefix || DEFAULT_HUMAN_TEACHER_SYSTEM_PROMPT,
    'You are generating a developer-only draft annotation for human review.',
    'Use explicit structured observations instead of hidden reasoning.',
    'Inspect every ordered panel before choosing a side.',
    'Do not collapse into a left-only or right-only habit.',
    'Return JSON only.',
  ]
    .filter(Boolean)
    .join(' ')
}

function buildAiAnnotationUserPrompt() {
  return [
    'Draft a human-teacher annotation for this Idena FLIP.',
    'Images 1-4 show the LEFT candidate in temporal order.',
    'Images 5-8 show the RIGHT candidate in temporal order.',
    'Describe each ordered panel concretely before you decide.',
    'Extract only readable visible text. If no text is readable, use an empty string for that panel.',
    'Then compare the LEFT and RIGHT stories and decide which side forms the better chronology.',
    'Use skip if the flip is ambiguous, report-worthy, or lacks a clear better story.',
    'Keep every field concrete and fairly short. Do not invent hidden details or unreadable text.',
    'Return JSON only with this exact schema:',
    '{"ordered_panel_descriptions":["panel 1","panel 2","panel 3","panel 4","panel 5","panel 6","panel 7","panel 8"],"ordered_panel_text":["text in panel 1 or empty","text in panel 2 or empty","text in panel 3 or empty","text in panel 4 or empty","text in panel 5 or empty","text in panel 6 or empty","text in panel 7 or empty","text in panel 8 or empty"],"option_a_story_analysis":"short LEFT story analysis","option_b_story_analysis":"short RIGHT story analysis","final_answer":"left|right|skip","why_answer":"...","confidence":1|2|3|4|5,"text_required":true|false,"sequence_markers_present":true|false,"report_required":true|false,"report_reason":"...","option_a_summary":"short LEFT story summary","option_b_summary":"short RIGHT story summary"}',
    'ordered_panel_descriptions must contain exactly 8 entries and ordered_panel_text must contain exactly 8 entries.',
    'If report_required is false, report_reason must be an empty string.',
  ].join(' ')
}

function buildStoredAiAnnotation(aiAnnotation, result = {}, task = {}) {
  const normalized = normalizeAiAnnotationDraft({
    ...aiAnnotation,
    task_id: String(task?.taskId || task?.task_id || '').trim(),
    generated_at: new Date().toISOString(),
    runtime_backend: result.runtimeBackend || result.runtime_backend || '',
    runtime_type: result.runtimeType || result.runtime_type || '',
    model: result.model || '',
    vision_model: result.visionModel || result.vision_model || '',
  })

  if (!normalized) {
    throw new Error('Local AI returned an empty draft annotation.')
  }

  return normalized
}

function applyAiAnnotationToDraft(currentDraft, aiAnnotation) {
  return normalizeAnnotationDraft({
    ...currentDraft,
    ai_annotation: aiAnnotation,
    final_answer: aiAnnotation.final_answer || '',
    why_answer: aiAnnotation.why_answer || '',
    confidence: aiAnnotation.confidence || '',
    text_required: aiAnnotation.text_required,
    sequence_markers_present: aiAnnotation.sequence_markers_present,
    report_required: aiAnnotation.report_required,
    report_reason: aiAnnotation.report_reason || '',
    option_a_summary: aiAnnotation.option_a_summary || '',
    option_b_summary: aiAnnotation.option_b_summary || '',
  })
}

function looksLikePureAiPrefillDraft(draft = {}, aiAnnotation = null) {
  if (!hasAiAnnotationContent(aiAnnotation)) {
    return false
  }

  const normalizedDraft = normalizeAnnotationDraft(draft)
  const normalizedAiAnnotation = normalizeAiAnnotationDraft(aiAnnotation)

  if (!normalizedAiAnnotation) {
    return false
  }

  return Boolean(
    !String(normalizedDraft.annotator || '').trim() &&
      !normalizedDraft.frame_captions.some((item) =>
        String(item || '').trim()
      ) &&
      !normalizedDraft.panel_references.some((reference) =>
        hasPanelReferenceContent(reference)
      ) &&
      String(normalizedDraft.option_a_summary || '').trim() ===
        String(normalizedAiAnnotation.option_a_summary || '').trim() &&
      String(normalizedDraft.option_b_summary || '').trim() ===
        String(normalizedAiAnnotation.option_b_summary || '').trim() &&
      String(normalizedDraft.final_answer || '').trim() ===
        String(normalizedAiAnnotation.final_answer || '').trim() &&
      String(normalizedDraft.why_answer || '').trim() ===
        String(normalizedAiAnnotation.why_answer || '').trim() &&
      String(normalizedDraft.confidence || '').trim() ===
        String(normalizedAiAnnotation.confidence || '').trim() &&
      normalizedDraft.text_required === normalizedAiAnnotation.text_required &&
      normalizedDraft.sequence_markers_present ===
        normalizedAiAnnotation.sequence_markers_present &&
      normalizedDraft.report_required ===
        normalizedAiAnnotation.report_required &&
      String(normalizedDraft.report_reason || '').trim() ===
        String(normalizedAiAnnotation.report_reason || '').trim()
  )
}

function sanitizeLoadedAnnotationDraftForTask(task = {}, annotation = {}) {
  const normalizedDraft = normalizeAnnotationDraft(annotation)

  if (!hasAiAnnotationContent(normalizedDraft.ai_annotation)) {
    return normalizedDraft
  }

  if (isAiAnnotationBoundToTask(normalizedDraft.ai_annotation, task)) {
    return normalizedDraft
  }

  if (
    looksLikePureAiPrefillDraft(normalizedDraft, normalizedDraft.ai_annotation)
  ) {
    return normalizeAnnotationDraft({
      ...normalizedDraft,
      ai_annotation: null,
      ai_annotation_feedback: '',
      option_a_summary: '',
      option_b_summary: '',
      text_required: null,
      sequence_markers_present: null,
      report_required: null,
      report_reason: '',
      final_answer: '',
      why_answer: '',
      confidence: '',
    })
  }

  return normalizeAnnotationDraft({
    ...normalizedDraft,
    ai_annotation: null,
    ai_annotation_feedback: '',
  })
}

function formatDecisionLabel(value, t) {
  const next = String(value || '')
    .trim()
    .toLowerCase()
  if (next === 'left') {
    return t('LEFT')
  }
  if (next === 'right') {
    return t('RIGHT')
  }
  if (next === 'skip') {
    return t('SKIP')
  }
  return t('Unknown')
}

function getDraftStatusLabel(annotation, t) {
  if (annotation && typeof annotation === 'object' && annotation.isComplete) {
    return t('Complete')
  }

  if (annotation && typeof annotation === 'object' && annotation.hasDraft) {
    return t('Draft')
  }

  const nextAnnotation = annotation || {}

  if (isCompleteDraft(nextAnnotation)) {
    return t('Complete')
  }

  if (hasDraftContent(nextAnnotation)) {
    return t('Draft')
  }

  return t('Pending')
}

function getDraftHelperText(annotation, t) {
  if (annotation && typeof annotation === 'object' && annotation.isComplete) {
    return t('This flip looks complete.')
  }

  if (annotation && typeof annotation === 'object' && annotation.hasDraft) {
    return t('This flip has unsaved or incomplete draft content.')
  }

  const nextAnnotation = annotation || {}
  const completion = getAnnotationCompletionState(nextAnnotation)

  if (completion.isComplete) {
    return t('This flip looks complete.')
  }

  if (hasDraftContent(nextAnnotation)) {
    return t('This flip still needs {{count}} required item(s).', {
      count: completion.remainingChecks,
    })
  }

  return t('No annotation content yet.')
}

function buildAnnotationDraftKey({
  annotationSourceMode = 'epoch',
  epoch = '',
  demoSampleName = '',
  demoOffset = 0,
  developerOffset = 0,
  selectedTaskId = '',
} = {}) {
  const taskId = String(selectedTaskId || '').trim()

  if (!taskId) {
    return ''
  }

  if (annotationSourceMode === 'developer') {
    return `developer:${demoSampleName}:${developerOffset}:${taskId}`
  }

  if (annotationSourceMode === 'demo') {
    return `demo:${demoSampleName}:${demoOffset}:${taskId}`
  }

  return `epoch:${String(epoch || '').trim()}:${taskId}`
}

const DEMO_SAMPLE_OPTIONS = [
  {
    value: 'flip-challenge-test-5-decoded-labeled',
    label: 'Quick demo (5 flips)',
  },
  {
    value: 'flip-challenge-test-20-decoded-labeled',
    label: 'Larger demo (20 flips)',
  },
]
const DEVELOPER_TRAINING_SAMPLE_OPTIONS = [
  {
    value: 'flip-challenge-test-20-decoded-labeled',
    label: 'Bundled FLIP sample (20 flips)',
  },
  {
    value: 'flip-challenge-test-5-decoded-labeled',
    label: 'Small bundled sample (5 flips)',
  },
]
const DEVELOPER_TRAINING_CHUNK_SIZE = 5

function pickPreferredTaskId(workspace, preferredTaskId = '') {
  const tasks =
    workspace && Array.isArray(workspace.tasks) ? workspace.tasks : []

  if (!tasks.length) {
    return ''
  }

  if (
    preferredTaskId &&
    tasks.some((task) => task.taskId === preferredTaskId)
  ) {
    return preferredTaskId
  }

  const nextIncompleteTask = tasks.find((task) => !task.isComplete)
  return nextIncompleteTask ? nextIncompleteTask.taskId : tasks[0].taskId
}

function formatOrder(order = []) {
  return Array.isArray(order) && order.length
    ? order.map((item) => Number(item) + 1).join(', ')
    : 'n/a'
}

function getCurrentFlipLabel(t, index, total) {
  if (
    !Number.isFinite(index) ||
    index < 0 ||
    !Number.isFinite(total) ||
    total <= 0
  ) {
    return t('No flip selected')
  }

  return t('Flip {{current}} of {{total}}', {
    current: index + 1,
    total,
  })
}

function formatSuccessRate(value) {
  const parsed = Number(value)

  if (!Number.isFinite(parsed) || parsed < 0) {
    return 'n/a'
  }

  return `${(parsed * 100).toFixed(1)}%`
}

function formatPercentMetric(value, digits = 0) {
  const parsed = Number(value)

  if (!Number.isFinite(parsed) || parsed < 0) {
    return 'n/a'
  }

  return `${parsed.toFixed(digits)}%`
}

function formatGiB(value) {
  const parsed = Number(value)

  if (!Number.isFinite(parsed) || parsed < 0) {
    return 'n/a'
  }

  return `${parsed.toFixed(1)} GiB`
}

function formatMinutes(value) {
  const parsed = Number.parseInt(value, 10)

  if (!Number.isFinite(parsed) || parsed < 0) {
    return 'n/a'
  }

  if (parsed < 60) {
    return `${parsed}m`
  }

  const hours = Math.floor(parsed / 60)
  const minutes = parsed % 60

  return `${hours}h ${minutes}m`
}

function getTelemetryToneProps(tone = 'gray') {
  switch (tone) {
    case 'red':
      return {
        borderColor: 'red.100',
        bg: 'red.50',
      }
    case 'orange':
      return {
        borderColor: 'orange.100',
        bg: 'orange.50',
      }
    case 'yellow':
      return {
        borderColor: 'yellow.100',
        bg: 'yellow.50',
      }
    case 'green':
      return {
        borderColor: 'green.100',
        bg: 'green.50',
      }
    case 'blue':
      return {
        borderColor: 'blue.100',
        bg: 'blue.50',
      }
    case 'purple':
      return {
        borderColor: 'purple.100',
        bg: 'purple.50',
      }
    case 'gray':
    default:
      return {
        borderColor: 'gray.100',
        bg: 'gray.50',
      }
  }
}

function describeDeveloperThermalTelemetry(system, t) {
  const thermal =
    system &&
    typeof system.thermal === 'object' &&
    !Array.isArray(system.thermal)
      ? system.thermal
      : {}
  const pressure = String(thermal.pressure || 'unavailable').trim()
  const cpuSpeedLimit = Number(thermal.cpuSpeedLimit)
  const schedulerLimit = Number(thermal.schedulerLimit)
  const thermalLevel = Number(thermal.thermalLevel)
  const detailParts = []

  if (Number.isFinite(cpuSpeedLimit)) {
    detailParts.push(
      t('CPU speed limit {{value}}%', {
        value: cpuSpeedLimit,
      })
    )
  }

  if (Number.isFinite(schedulerLimit)) {
    detailParts.push(
      t('Scheduler limit {{value}}%', {
        value: schedulerLimit,
      })
    )
  }

  if (Number.isFinite(thermalLevel)) {
    detailParts.push(
      t('Thermal level {{value}}', {
        value: thermalLevel,
      })
    )
  }

  if (!thermal.available) {
    return {
      title: t('Thermal pressure'),
      value: t('Unavailable'),
      detail: t('macOS thermal telemetry has not been reported yet.'),
      tone: 'gray',
    }
  }

  if (pressure === 'limited') {
    return {
      title: t('Thermal pressure'),
      value: t('Limited'),
      detail:
        detailParts.join(' · ') ||
        t('macOS is already applying heat-related performance limits.'),
      tone: 'red',
    }
  }

  if (pressure === 'elevated') {
    return {
      title: t('Thermal pressure'),
      value: t('Elevated'),
      detail:
        detailParts.join(' · ') ||
        t(
          'macOS has recorded thermal warnings even without an active speed cap.'
        ),
      tone: 'orange',
    }
  }

  return {
    title: t('Thermal pressure'),
    value: t('Nominal'),
    detail:
      detailParts.join(' · ') ||
      t('No active thermal throttling is reported right now.'),
    tone: 'green',
  }
}

function describeDeveloperComputeTelemetry(system, t) {
  const cpuUsagePercent = Number(system?.cpuUsagePercent)
  const loadAveragePerCore1m = Number(system?.loadAveragePerCore1m)
  const loadAverage5m = Number(system?.loadAverage5m)
  const cpuCoreCount = Number(system?.cpuCoreCount)
  let tone = 'gray'

  if (
    (Number.isFinite(cpuUsagePercent) && cpuUsagePercent >= 85) ||
    (Number.isFinite(loadAveragePerCore1m) && loadAveragePerCore1m >= 1)
  ) {
    tone = 'red'
  } else if (
    (Number.isFinite(cpuUsagePercent) && cpuUsagePercent >= 65) ||
    (Number.isFinite(loadAveragePerCore1m) && loadAveragePerCore1m >= 0.75)
  ) {
    tone = 'orange'
  } else if (
    (Number.isFinite(cpuUsagePercent) && cpuUsagePercent >= 35) ||
    (Number.isFinite(loadAveragePerCore1m) && loadAveragePerCore1m >= 0.4)
  ) {
    tone = 'yellow'
  } else if (
    Number.isFinite(cpuUsagePercent) ||
    Number.isFinite(loadAveragePerCore1m)
  ) {
    tone = 'green'
  }

  const detailParts = []

  if (Number.isFinite(loadAveragePerCore1m) && loadAveragePerCore1m >= 0) {
    detailParts.push(
      t('1m load/core {{value}}', {
        value: loadAveragePerCore1m.toFixed(2),
      })
    )
  }

  if (Number.isFinite(loadAverage5m) && loadAverage5m >= 0) {
    detailParts.push(
      t('5m load {{value}}', {
        value: loadAverage5m.toFixed(2),
      })
    )
  }

  if (Number.isFinite(cpuCoreCount) && cpuCoreCount > 0) {
    detailParts.push(
      t('{{count}} cores', {
        count: cpuCoreCount,
      })
    )
  }

  let value = t('Unavailable')

  if (Number.isFinite(cpuUsagePercent)) {
    value = t('{{value}} CPU', {
      value: formatPercentMetric(cpuUsagePercent),
    })
  } else if (Number.isFinite(loadAveragePerCore1m)) {
    value = t('{{value}} load/core', {
      value: loadAveragePerCore1m.toFixed(2),
    })
  }

  return {
    title: t('Compute load'),
    value,
    detail:
      detailParts.join(' · ') ||
      t('CPU telemetry will appear after the next sample.'),
    tone,
  }
}

function describeDeveloperMemoryTelemetry(system, t) {
  const memoryUsagePercent = Number(system?.memoryUsagePercent)
  const memoryUsedGiB = formatGiB(system?.memoryUsedGiB)
  const memoryTotalGiB = formatGiB(system?.memoryTotalGiB)
  const appMemoryRssMb = Number(system?.appMemoryRssMb)
  let tone = 'gray'

  if (Number.isFinite(memoryUsagePercent) && memoryUsagePercent >= 85) {
    tone = 'red'
  } else if (Number.isFinite(memoryUsagePercent) && memoryUsagePercent >= 75) {
    tone = 'orange'
  } else if (Number.isFinite(memoryUsagePercent) && memoryUsagePercent >= 60) {
    tone = 'yellow'
  } else if (Number.isFinite(memoryUsagePercent)) {
    tone = 'blue'
  }

  return {
    title: t('Memory pressure'),
    value: Number.isFinite(memoryUsagePercent)
      ? t('{{value}} used', {
          value: formatPercentMetric(memoryUsagePercent),
        })
      : memoryUsedGiB,
    detail: t('{{used}} of {{total}} system · app RSS {{rss}} MB', {
      used: memoryUsedGiB,
      total: memoryTotalGiB,
      rss: Number.isFinite(appMemoryRssMb) ? appMemoryRssMb : 'n/a',
    }),
    tone,
  }
}

function describeDeveloperPowerTelemetry(system, t) {
  const battery =
    system &&
    typeof system.battery === 'object' &&
    !Array.isArray(system.battery)
      ? system.battery
      : {}
  const percent = Number(battery.percent)
  let tone = 'gray'

  if (battery.available && battery.isCharging === false) {
    if (Number.isFinite(percent) && percent < 20) {
      tone = 'red'
    } else if (Number.isFinite(percent) && percent < 50) {
      tone = 'orange'
    } else {
      tone = 'yellow'
    }
  } else if (battery.available && battery.isCharging === true) {
    tone = 'green'
  }

  const detailParts = []

  if (battery.state) {
    detailParts.push(String(battery.state).trim())
  }

  if (
    Number.isFinite(battery.timeRemainingMinutes) &&
    battery.timeRemainingMinutes >= 0
  ) {
    detailParts.push(
      t('{{value}} remaining', {
        value: formatMinutes(battery.timeRemainingMinutes),
      })
    )
  }

  if (!detailParts.length && battery.source) {
    detailParts.push(String(battery.source).trim())
  }

  if (!battery.available) {
    return {
      title: t('Power source'),
      value: t('Unavailable'),
      detail: t('Battery telemetry is not exposed on this system.'),
      tone,
    }
  }

  const batteryPercentLabel = Number.isFinite(percent)
    ? `${percent}%`
    : t('Battery')
  let value = batteryPercentLabel

  if (battery.isCharging === true) {
    value = t('{{value}} charging', {
      value: batteryPercentLabel,
    })
  } else if (battery.isCharging === false) {
    value = t('{{value}} battery', {
      value: batteryPercentLabel,
    })
  }

  return {
    title: t('Power source'),
    value,
    detail:
      detailParts.join(' · ') ||
      t('Long local runs on battery increase drain and battery wear.'),
    tone,
  }
}

function describeDeveloperTelemetryNotice({
  telemetry,
  thermalSummary,
  isBusy,
  t,
}) {
  const system =
    telemetry &&
    typeof telemetry.system === 'object' &&
    !Array.isArray(telemetry.system)
      ? telemetry.system
      : {}
  const thermal =
    system &&
    typeof system.thermal === 'object' &&
    !Array.isArray(system.thermal)
      ? system.thermal
      : {}
  const battery =
    system &&
    typeof system.battery === 'object' &&
    !Array.isArray(system.battery)
      ? system.battery
      : {}
  const cpuSpeedLimit = Number(thermal.cpuSpeedLimit)
  const batteryPercent = Number(battery.percent)
  const cpuUsagePercent = Number(system.cpuUsagePercent)
  const memoryUsagePercent = Number(system.memoryUsagePercent)

  if (String(thermal.pressure || '').trim() === 'limited') {
    return {
      status: 'warning',
      message: Number.isFinite(cpuSpeedLimit)
        ? t(
            'macOS is already limiting CPU speed to {{value}}%. Another local run will be slower and add more heat.',
            {
              value: cpuSpeedLimit,
            }
          )
        : t(
            'macOS is already thermally limiting this machine. Another local run will compete with that heat cap.'
          ),
    }
  }

  if (battery.available && battery.isCharging === false) {
    return {
      status: 'warning',
      message: Number.isFinite(batteryPercent)
        ? t(
            'This Mac is on battery at {{value}}. Long local runs trade remaining runtime and battery wear for convenience.',
            {
              value: `${batteryPercent}%`,
            }
          )
        : t(
            'This Mac is on battery. Long local runs trade remaining runtime and battery wear for convenience.'
          ),
    }
  }

  if (
    Number.isFinite(cpuUsagePercent) &&
    cpuUsagePercent >= 80 &&
    Number.isFinite(memoryUsagePercent) &&
    memoryUsagePercent >= 80
  ) {
    return {
      status: 'info',
      message: t(
        'This machine is already busy on both CPU and memory, so local training will compete harder with the rest of the desktop.'
      ),
    }
  }

  return {
    status: 'info',
    message: isBusy
      ? t(
          'These numbers refresh live while local training or the holdout comparison is running.'
        )
      : t(
          '{{label}} keeps this pilot path slower but cooler by inserting pauses between steps and epochs.',
          {
            label: thermalSummary?.label || t('Balanced cooling'),
          }
        ),
  }
}

function LocalTrainingImpactStatCard({title, value, detail, tone = 'gray'}) {
  const toneProps = getTelemetryToneProps(tone)

  return (
    <Box
      borderWidth="1px"
      borderColor={toneProps.borderColor}
      borderRadius="md"
      px={3}
      py={3}
      bg={toneProps.bg}
    >
      <Stack spacing={1}>
        <Text color="muted" fontSize="xs">
          {title}
        </Text>
        <Text fontWeight={700}>{value}</Text>
        <Text color="muted" fontSize="xs">
          {detail}
        </Text>
      </Stack>
    </Box>
  )
}

function getLocalTrainingJourneyToneStyles(tone) {
  switch (tone) {
    case 'green':
      return {
        borderColor: 'green.100',
        bg: 'green.50',
        badgeScheme: 'green',
      }
    case 'orange':
      return {
        borderColor: 'orange.100',
        bg: 'orange.50',
        badgeScheme: 'orange',
      }
    case 'red':
      return {
        borderColor: 'red.100',
        bg: 'red.50',
        badgeScheme: 'red',
      }
    case 'purple':
      return {
        borderColor: 'purple.100',
        bg: 'purple.50',
        badgeScheme: 'purple',
      }
    case 'blue':
    default:
      return {
        borderColor: 'blue.100',
        bg: 'blue.50',
        badgeScheme: 'blue',
      }
  }
}

function LocalTrainingJourneyPanel({
  title,
  subtitle,
  chunkCompletedCount = 0,
  chunkTotalCount = 0,
  pendingCount = 0,
  annotatedCount = 0,
  trainedCount = 0,
  latestComparison = null,
  benchmarkSize = 100,
  canRunLocalTraining = true,
  isTrainingActive = false,
  isComparisonActive = false,
  lastTraining = null,
  totalUpdates = 0,
  coolingFloorMs = 0,
  epochs = 1,
  batchSize = 1,
  loraRank = 10,
  t,
}) {
  const chunkProgressValue =
    chunkTotalCount > 0
      ? Math.max(
          0,
          Math.min(
            100,
            Math.round(
              (chunkCompletedCount / Math.max(1, chunkTotalCount)) * 100
            )
          )
        )
      : 0
  const chunkIsComplete =
    chunkTotalCount > 0 && chunkCompletedCount >= chunkTotalCount
  const hasWorkToTeach =
    chunkIsComplete ||
    pendingCount > 0 ||
    annotatedCount > 0 ||
    trainedCount > 0
  const lastTrainingStatus = String(lastTraining?.status || '').trim()
  const latestAccuracy =
    latestComparison && typeof latestComparison.accuracy === 'number'
      ? formatSuccessRate(latestComparison.accuracy)
      : null
  const latestEvaluatedAt = latestComparison?.evaluatedAt
    ? formatTimestamp(latestComparison.evaluatedAt)
    : null

  let overallBadgeLabel = t('Start with 5 flips')
  let overallBadgeScheme = 'blue'

  if (!canRunLocalTraining) {
    overallBadgeLabel = t('Training backend missing')
    overallBadgeScheme = 'orange'
  } else if (isTrainingActive) {
    overallBadgeLabel = t('Training now')
    overallBadgeScheme = 'blue'
  } else if (isComparisonActive) {
    overallBadgeLabel = t('Testing now')
    overallBadgeScheme = 'purple'
  } else if (chunkTotalCount > 0 && !chunkIsComplete) {
    overallBadgeLabel = t('Finish this 5-flip chunk')
    overallBadgeScheme = 'blue'
  } else if (chunkIsComplete || pendingCount > 0) {
    overallBadgeLabel = t('Ready to train')
    overallBadgeScheme = 'orange'
  } else if (latestComparison) {
    overallBadgeLabel = t('Last run checked')
    overallBadgeScheme = 'green'
  } else if (trainedCount > 0) {
    overallBadgeLabel = t('Already trained')
    overallBadgeScheme = 'green'
  }

  let teachStep = {
    title: t('1. Teach 5 flips'),
    statusLabel: t('Start here'),
    tone: 'blue',
    detail: t('Open the next 5 flips and answer them one by one.'),
    footnote: t('Nothing trains yet. You are only teaching.'),
    progressValue: null,
  }

  if (chunkTotalCount > 0) {
    teachStep = chunkIsComplete
      ? {
          title: t('1. Teach 5 flips'),
          statusLabel: t('Done'),
          tone: 'green',
          detail: t('All {{count}} flips in this chunk are finished.', {
            count: chunkTotalCount,
          }),
          footnote: t('This chunk is ready for local training.'),
          progressValue: 100,
        }
      : {
          title: t('1. Teach 5 flips'),
          statusLabel: t('Now'),
          tone: 'blue',
          detail: t('{{done}} of {{total}} flips in this chunk are finished.', {
            done: chunkCompletedCount,
            total: chunkTotalCount,
          }),
          footnote: t('Finish all 5 before the training button matters.'),
          progressValue: chunkProgressValue,
        }
  } else if (hasWorkToTeach) {
    teachStep = {
      title: t('1. Teach 5 flips'),
      statusLabel: t('Done before'),
      tone: 'green',
      detail: t(
        'Earlier chunks are already saved. Open another 5 flips when you want to teach more.'
      ),
      footnote: t('Saved answers so far: {{count}}.', {
        count: formatCountMetric(annotatedCount),
      }),
      progressValue: null,
    }
  }

  let trainingStep = {
    title: t('2. Let your computer practice'),
    statusLabel: t('Waiting'),
    tone: 'blue',
    detail: t('Training starts after the first full 5-flip chunk is ready.'),
    footnote: t(
      'This run uses {{updates}} small update rounds with at least {{cooling}} of planned cooling pauses.',
      {
        updates: formatCountMetric(totalUpdates),
        cooling: formatDurationMs(coolingFloorMs),
      }
    ),
  }

  if (!canRunLocalTraining) {
    trainingStep = {
      title: t('2. Let your computer practice'),
      statusLabel: t('Unavailable'),
      tone: 'orange',
      detail: t(
        'This desktop still needs a working local training backend before it can run the pilot here.'
      ),
      footnote: t(
        'Your saved flips stay local and can still be exported later.'
      ),
    }
  } else if (isTrainingActive) {
    trainingStep = {
      title: t('2. Let your computer practice'),
      statusLabel: t('Now'),
      tone: 'blue',
      detail: t(
        'This local run is practicing on the saved chunk right now. The active model changes only if the whole run finishes successfully.'
      ),
      footnote: t(
        '{{updates}} update rounds · {{epochs}} epoch passes · batch {{batch}} · rank {{rank}} · minimum cooling {{cooling}}',
        {
          updates: formatCountMetric(totalUpdates),
          epochs: formatCountMetric(epochs),
          batch: formatCountMetric(batchSize),
          rank: formatCountMetric(loraRank),
          cooling: formatDurationMs(coolingFloorMs),
        }
      ),
    }
  } else if (lastTrainingStatus === 'failed' && pendingCount > 0) {
    trainingStep = {
      title: t('2. Let your computer practice'),
      statusLabel: t('Needs retry'),
      tone: 'red',
      detail: t(
        'The last training try stopped, so your newest saved flips are still waiting to be learned.'
      ),
      footnote: t('{{count}} saved flips are still waiting.', {
        count: formatCountMetric(pendingCount),
      }),
    }
  } else if (chunkIsComplete || pendingCount > 0) {
    trainingStep = {
      title: t('2. Let your computer practice'),
      statusLabel: t('Next'),
      tone: 'orange',
      detail: t(
        'This run is ready. When you start it, the computer practices on the saved chunk before the app checks the result.'
      ),
      footnote: t(
        '{{updates}} update rounds · {{epochs}} epoch passes · batch {{batch}} · rank {{rank}} · minimum cooling {{cooling}}',
        {
          updates: formatCountMetric(totalUpdates),
          epochs: formatCountMetric(epochs),
          batch: formatCountMetric(batchSize),
          rank: formatCountMetric(loraRank),
          cooling: formatDurationMs(coolingFloorMs),
        }
      ),
    }
  } else if (trainedCount > 0) {
    trainingStep = {
      title: t('2. Let your computer practice'),
      statusLabel: t('Done'),
      tone: 'green',
      detail: t(
        '{{count}} flips are already inside the active local model from earlier runs.',
        {
          count: formatCountMetric(trainedCount),
        }
      ),
      footnote: t('New saved flips will wait here until the next run.'),
    }
  }

  let testStep = {
    title: t('3. Check if it got better'),
    statusLabel: t('Waiting'),
    tone: 'blue',
    detail: t('A test score appears after the first trained run.'),
    footnote: t(
      'The app uses {{count}} unseen flips here, so it does not reuse the teaching flips.',
      {
        count: formatCountMetric(benchmarkSize),
      }
    ),
  }

  if (isComparisonActive) {
    testStep = {
      title: t('3. Check if it got better'),
      statusLabel: t('Now'),
      tone: 'purple',
      detail: t(
        'The app is testing the model on {{count}} unseen flips right now.',
        {
          count: formatCountMetric(benchmarkSize),
        }
      ),
      footnote: t(
        'This checks progress without reusing the same 5 teaching flips.'
      ),
    }
  } else if (latestComparison) {
    testStep = {
      title: t('3. Check if it got better'),
      statusLabel: t('Done'),
      tone: 'green',
      detail: latestAccuracy
        ? t('Last test score: {{accuracy}} on {{count}} unseen flips.', {
            accuracy: latestAccuracy,
            count: formatCountMetric(benchmarkSize),
          })
        : t('A benchmark result was saved for {{count}} unseen flips.', {
            count: formatCountMetric(benchmarkSize),
          }),
      footnote:
        latestEvaluatedAt ||
        t('The next run can be compared against this result later.'),
    }
  } else if (
    canRunLocalTraining &&
    (chunkIsComplete || pendingCount > 0 || trainedCount > 0)
  ) {
    testStep = {
      title: t('3. Check if it got better'),
      statusLabel: t('Next'),
      tone: 'orange',
      detail: t(
        'After training, the app checks {{count}} unseen flips so you can see whether the score moved up or down.',
        {
          count: formatCountMetric(benchmarkSize),
        }
      ),
      footnote: t('This is the easiest way to tell if a run helped or not.'),
    }
  }

  const steps = [teachStep, trainingStep, testStep]

  return (
    <Box borderWidth="1px" borderColor="gray.100" borderRadius="2xl" p={4}>
      <Stack spacing={3}>
        <Flex
          justify="space-between"
          align={['flex-start', 'center']}
          direction={['column', 'row']}
          gap={2}
        >
          <Box>
            <Text fontWeight={600}>{title}</Text>
            <Text color="muted" fontSize="sm">
              {subtitle}
            </Text>
          </Box>
          <Badge colorScheme={overallBadgeScheme} borderRadius="full" px={2}>
            {overallBadgeLabel}
          </Badge>
        </Flex>

        <SimpleGrid columns={[1, 3]} spacing={3}>
          {steps.map((step) => {
            const styles = getLocalTrainingJourneyToneStyles(step.tone)

            return (
              <Box
                key={step.title}
                borderWidth="1px"
                borderColor={styles.borderColor}
                borderRadius="xl"
                bg={styles.bg}
                px={3}
                py={3}
              >
                <Stack spacing={2}>
                  <Flex justify="space-between" align="center" gap={2}>
                    <Text fontWeight={700}>{step.title}</Text>
                    <Badge colorScheme={styles.badgeScheme} borderRadius="full">
                      {step.statusLabel}
                    </Badge>
                  </Flex>
                  <Text fontSize="sm">{step.detail}</Text>
                  {typeof step.progressValue === 'number' ? (
                    <Progress
                      size="sm"
                      value={step.progressValue}
                      colorScheme={styles.badgeScheme}
                      borderRadius="full"
                    />
                  ) : null}
                  <Text color="muted" fontSize="xs">
                    {step.footnote}
                  </Text>
                </Stack>
              </Box>
            )
          })}
        </SimpleGrid>

        <Box
          borderWidth="1px"
          borderColor="gray.100"
          borderRadius="xl"
          px={3}
          py={3}
          bg="gray.50"
        >
          <Stack spacing={1}>
            <Text fontSize="sm" fontWeight={600}>
              {t('Plain-language key')}
            </Text>
            <Text color="muted" fontSize="xs">
              {t(
                'Saved answers = flips you already labeled. Waiting to learn = saved flips not inside the model yet. Already learned = flips already trained into the active model.'
              )}
            </Text>
          </Stack>
        </Box>
      </Stack>
    </Box>
  )
}

function LocalTrainingImpactPanel({
  telemetry,
  telemetryError,
  thermalSummary,
  isBusy,
  t,
}) {
  const system =
    telemetry &&
    typeof telemetry.system === 'object' &&
    !Array.isArray(telemetry.system)
      ? telemetry.system
      : {}
  const stats = [
    describeDeveloperThermalTelemetry(system, t),
    describeDeveloperComputeTelemetry(system, t),
    describeDeveloperMemoryTelemetry(system, t),
    describeDeveloperPowerTelemetry(system, t),
  ]
  const note = describeDeveloperTelemetryNotice({
    telemetry,
    thermalSummary,
    isBusy,
    t,
  })

  return (
    <Box borderWidth="1px" borderColor="gray.100" borderRadius="md" p={4}>
      <Stack spacing={3}>
        <Flex
          justify="space-between"
          align={['flex-start', 'center']}
          direction={['column', 'row']}
          gap={2}
        >
          <Box>
            <Text fontWeight={600}>{t('Thermal and compute impact')}</Text>
            <Text color="muted" fontSize="sm">
              {isBusy
                ? t(
                    'Live machine stats while local training or the holdout comparison is active.'
                  )
                : t(
                    'Live machine stats for this desktop before you launch another local training run.'
                  )}
            </Text>
          </Box>
          <Badge
            borderRadius="full"
            px={2}
            py={1}
            bg={isBusy ? 'blue.50' : 'gray.100'}
            color={isBusy ? 'blue.600' : 'gray.600'}
          >
            {isBusy ? t('Live sampling') : t('Standby sampling')}
          </Badge>
        </Flex>

        {telemetryError ? (
          <Alert status="warning" borderRadius="md">
            <Text fontSize="sm">{telemetryError}</Text>
          </Alert>
        ) : null}

        {telemetry ? (
          <>
            <SimpleGrid columns={[1, 2, 4]} spacing={3}>
              {stats.map((stat) => (
                <LocalTrainingImpactStatCard
                  key={stat.title}
                  title={stat.title}
                  value={stat.value}
                  detail={stat.detail}
                  tone={stat.tone}
                />
              ))}
            </SimpleGrid>
            <Box
              borderWidth="1px"
              borderColor={
                note.status === 'warning' ? 'orange.100' : 'blue.100'
              }
              borderRadius="md"
              px={3}
              py={2}
              bg={note.status === 'warning' ? 'orange.50' : 'blue.50'}
            >
              <Text fontSize="sm">{note.message}</Text>
            </Box>
            <Text color="muted" fontSize="xs">
              {t('Last sample')}: {formatTimestamp(telemetry.collectedAt)} ·{' '}
              {t('Heat mode')}: {thermalSummary?.label || t('Balanced cooling')}
              {thermalSummary
                ? ` · ${t(
                    '{{stepMs}} ms between steps, {{epochMs}} ms between epochs',
                    {
                      stepMs: thermalSummary.stepCooldownMs,
                      epochMs: thermalSummary.epochCooldownMs,
                    }
                  )}`
                : ''}
            </Text>
          </>
        ) : (
          <Box
            borderWidth="1px"
            borderColor="gray.100"
            borderRadius="md"
            px={3}
            py={3}
            bg="gray.50"
          >
            <Text color="muted" fontSize="sm">
              {t('Waiting for the first local system telemetry sample.')}
            </Text>
          </Box>
        )}
      </Stack>
    </Box>
  )
}

function formatTimestamp(value) {
  const raw = String(value || '').trim()

  if (!raw) {
    return 'n/a'
  }

  const parsed = new Date(raw)

  if (!Number.isFinite(parsed.getTime())) {
    return raw
  }

  return parsed.toLocaleString()
}

function formatCompactTimestamp(value) {
  const raw = String(value || '').trim()

  if (!raw) {
    return 'n/a'
  }

  const parsed = new Date(raw)

  if (!Number.isFinite(parsed.getTime())) {
    return raw
  }

  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

function formatCountMetric(value) {
  const parsed = Number.parseInt(value, 10)

  if (!Number.isFinite(parsed) || parsed < 0) {
    return 'n/a'
  }

  return parsed.toLocaleString()
}

function formatDurationMs(value) {
  const parsed = Number.parseInt(value, 10)

  if (!Number.isFinite(parsed) || parsed < 0) {
    return 'n/a'
  }

  if (parsed < 1000) {
    return `${parsed} ms`
  }

  if (parsed < 60 * 1000) {
    return `${(parsed / 1000).toFixed(1)} s`
  }

  return formatMinutes(Math.ceil(parsed / (60 * 1000)))
}

function clampPercent(value) {
  const parsed = Number(value)

  if (!Number.isFinite(parsed)) {
    return null
  }

  return Math.max(0, Math.min(100, parsed * 100))
}

function getWorkspaceCountsAfterSave(
  workspace,
  selectedTaskId,
  annotation = {}
) {
  const tasks =
    workspace && Array.isArray(workspace.tasks) ? workspace.tasks : []

  if (!tasks.length || !selectedTaskId) {
    return {
      total: 0,
      draftedCount: 0,
      completedCount: 0,
      remainingCount: 0,
      allComplete: false,
    }
  }

  const hasDraft = hasDraftContent(annotation)
  const isComplete = isCompleteDraft(annotation)
  const nextTasks = tasks.map((task) =>
    task.taskId === selectedTaskId
      ? {
          ...task,
          hasDraft,
          isComplete,
        }
      : task
  )
  const draftedCount = nextTasks.filter((task) => task.hasDraft).length
  const completedCount = nextTasks.filter((task) => task.isComplete).length
  const total = nextTasks.length

  return {
    total,
    draftedCount,
    completedCount,
    remainingCount: Math.max(total - completedCount, 0),
    allComplete: total > 0 && completedCount === total,
  }
}

function InterviewPrompt({title, children}) {
  return (
    <Box borderWidth="1px" borderColor="gray.100" borderRadius="xl" p={4}>
      <Box
        bg="blue.50"
        borderWidth="1px"
        borderColor="blue.100"
        borderRadius="lg"
        px={3}
        py={2}
        mb={3}
      >
        <Text fontSize="sm" fontWeight={600} color="blue.500">
          idena.vibe
        </Text>
        <Text mt={1}>{title}</Text>
      </Box>
      <Box>{children}</Box>
    </Box>
  )
}

function CompletionChecklistCard({item, t}) {
  return (
    <Box
      borderWidth="1px"
      borderColor={item.done ? 'green.100' : 'gray.100'}
      borderRadius="lg"
      px={3}
      py={2}
      bg={item.done ? 'green.50' : 'gray.50'}
    >
      <Flex justify="space-between" align="flex-start" gap={2}>
        <Box>
          <Text fontSize="xs" color="muted">
            {item.label}
          </Text>
          <Text fontSize="xs" color="muted" mt={1}>
            {item.detail}
          </Text>
        </Box>
        <Badge
          colorScheme={item.done ? 'green' : 'gray'}
          variant={item.done ? 'solid' : 'subtle'}
          borderRadius="full"
          px={2}
        >
          {item.done ? t('Done') : t('Needed')}
        </Badge>
      </Flex>
    </Box>
  )
}

function BooleanChoiceField({
  title,
  description = '',
  value = null,
  onChange,
  trueLabel,
  falseLabel,
  t,
}) {
  let statusText = t('Choose one answer.')

  if (value === true) {
    statusText = t('Saved as: yes')
  } else if (value === false) {
    statusText = t('Saved as: no')
  }

  return (
    <Box
      borderWidth="1px"
      borderColor={value === null ? 'gray.100' : 'blue.100'}
      borderRadius="lg"
      px={3}
      py={3}
      bg={value === null ? 'white' : 'blue.50'}
    >
      <Stack spacing={2}>
        <Box>
          <Text fontWeight={600}>{title}</Text>
          {description ? (
            <Text color="muted" fontSize="sm" mt={1}>
              {description}
            </Text>
          ) : null}
        </Box>
        <Stack direction={['column', 'row']} spacing={2} flexWrap="wrap">
          {value === true ? (
            <PrimaryButton onClick={() => onChange(true)}>
              {trueLabel}
            </PrimaryButton>
          ) : (
            <SecondaryButton onClick={() => onChange(true)}>
              {trueLabel}
            </SecondaryButton>
          )}
          {value === false ? (
            <PrimaryButton onClick={() => onChange(false)}>
              {falseLabel}
            </PrimaryButton>
          ) : (
            <SecondaryButton onClick={() => onChange(false)}>
              {falseLabel}
            </SecondaryButton>
          )}
        </Stack>
        <Text color="muted" fontSize="xs">
          {statusText}
        </Text>
      </Stack>
    </Box>
  )
}

function AiChatBubble({messageRole = 'assistant', label, meta = '', children}) {
  const isUser = messageRole === 'user'

  return (
    <Flex justify={isUser ? 'flex-end' : 'flex-start'}>
      <Box
        maxW={['100%', '92%']}
        borderWidth="1px"
        borderColor={isUser ? 'blue.100' : 'gray.100'}
        borderRadius="2xl"
        px={4}
        py={3}
        bg={isUser ? 'blue.50' : 'white'}
      >
        <Text
          fontSize="xs"
          fontWeight={700}
          color={isUser ? 'blue.600' : 'gray.600'}
        >
          {label}
        </Text>
        {meta ? (
          <Text color="muted" fontSize="xs" mt={1}>
            {meta}
          </Text>
        ) : null}
        <Box mt={2}>{children}</Box>
      </Box>
    </Flex>
  )
}

function AiUserPromptMessage({text, t}) {
  if (!String(text || '').trim()) {
    return null
  }

  return (
    <AiChatBubble
      messageRole="user"
      label={t('You')}
      meta={t('Last correction or follow-up sent to the AI')}
    >
      <Text fontSize="sm" whiteSpace="pre-wrap">
        {text}
      </Text>
    </AiChatBubble>
  )
}

function AiAssistantDraftMessage({
  annotation,
  panelDescriptions = [],
  panelText = [],
  runtimeModelLabel = '',
  trainingModelLabel = '',
  onRate,
  t,
}) {
  if (!annotation) {
    return null
  }

  const ratingOptions = [
    {value: 'good', label: t('Good')},
    {value: 'bad', label: t('Bad')},
    {value: 'wrong', label: t('Wrong')},
  ]

  return (
    <AiChatBubble
      label={t('Local AI')}
      meta={t('Structured draft for this flip')}
    >
      <Stack spacing={3}>
        <Flex gap={2} flexWrap="wrap">
          <Badge colorScheme="blue" borderRadius="full" px={2}>
            {t('Answer')}: {formatDecisionLabel(annotation.final_answer, t)}
          </Badge>
          <Badge colorScheme="gray" borderRadius="full" px={2}>
            {t('Confidence')}: {annotation.confidence || '?'} / 5
          </Badge>
        </Flex>

        <Text color="muted" fontSize="xs" wordBreak="break-all">
          {t(
            'Runtime model {{draftModel}} · Local training model {{trainingModel}}',
            {
              draftModel: annotation.model || runtimeModelLabel || t('unknown'),
              trainingModel: trainingModelLabel || t('unknown'),
            }
          )}
        </Text>

        {annotation.why_answer ? (
          <Text fontSize="sm" whiteSpace="pre-wrap">
            {annotation.why_answer}
          </Text>
        ) : null}

        {hasAiAnnotationListContent(panelDescriptions) ? (
          <Box
            borderWidth="1px"
            borderColor="gray.100"
            borderRadius="xl"
            px={3}
            py={3}
            bg="gray.50"
          >
            <Text fontSize="xs" fontWeight={700} mb={2}>
              {t('Ordered panel observations')}
            </Text>
            <Stack spacing={1}>
              {panelDescriptions.map((item, index) =>
                item ? (
                  <Text key={`ai-panel-${index}`} fontSize="xs" color="muted">
                    {t('Panel {{index}}', {
                      index: index + 1,
                    })}
                    : {item}
                  </Text>
                ) : null
              )}
            </Stack>
          </Box>
        ) : null}

        {hasAiAnnotationListContent(panelText) ? (
          <Box
            borderWidth="1px"
            borderColor="gray.100"
            borderRadius="xl"
            px={3}
            py={3}
            bg="gray.50"
          >
            <Text fontSize="xs" fontWeight={700} mb={2}>
              {t('Visible text by panel')}
            </Text>
            <Stack spacing={1}>
              {panelText.map((item, index) =>
                item ? (
                  <Text key={`ai-text-${index}`} fontSize="xs" color="muted">
                    {t('Panel {{index}}', {
                      index: index + 1,
                    })}
                    : {item}
                  </Text>
                ) : null
              )}
            </Stack>
          </Box>
        ) : null}

        {annotation.option_a_story_analysis ||
        annotation.option_b_story_analysis ? (
          <Box
            borderWidth="1px"
            borderColor="gray.100"
            borderRadius="xl"
            px={3}
            py={3}
            bg="gray.50"
          >
            <Text fontSize="xs" fontWeight={700} mb={2}>
              {t('Story comparison')}
            </Text>
            <Stack spacing={1}>
              {annotation.option_a_story_analysis ? (
                <Text fontSize="xs" color="muted">
                  {t('LEFT analysis')}: {annotation.option_a_story_analysis}
                </Text>
              ) : null}
              {annotation.option_b_story_analysis ? (
                <Text fontSize="xs" color="muted">
                  {t('RIGHT analysis')}: {annotation.option_b_story_analysis}
                </Text>
              ) : null}
            </Stack>
          </Box>
        ) : null}

        {annotation.option_a_summary || annotation.option_b_summary ? (
          <Box
            borderWidth="1px"
            borderColor="gray.100"
            borderRadius="xl"
            px={3}
            py={3}
            bg="gray.50"
          >
            <Text fontSize="xs" fontWeight={700} mb={2}>
              {t('Story summaries')}
            </Text>
            <Stack spacing={1}>
              {annotation.option_a_summary ? (
                <Text fontSize="xs" color="muted">
                  {t('LEFT summary')}: {annotation.option_a_summary}
                </Text>
              ) : null}
              {annotation.option_b_summary ? (
                <Text fontSize="xs" color="muted">
                  {t('RIGHT summary')}: {annotation.option_b_summary}
                </Text>
              ) : null}
            </Stack>
          </Box>
        ) : null}

        <Box>
          <Text color="muted" fontSize="xs" mb={2}>
            {t('Rate this AI draft')}
          </Text>
          <Stack direction={['column', 'row']} spacing={2} flexWrap="wrap">
            {ratingOptions.map((option) =>
              annotation.rating === option.value ? (
                <PrimaryButton
                  key={option.value}
                  onClick={() => onRate(option.value)}
                >
                  {option.label}
                </PrimaryButton>
              ) : (
                <SecondaryButton
                  key={option.value}
                  onClick={() => onRate(option.value)}
                >
                  {option.label}
                </SecondaryButton>
              )
            )}
          </Stack>
        </Box>
      </Stack>
    </AiChatBubble>
  )
}

function SuccessRateHistoryChart({entries = [], t}) {
  const chartEntries = React.useMemo(
    () =>
      entries
        .filter((entry) => Number.isFinite(Number(entry?.accuracy)))
        .slice()
        .reverse(),
    [entries]
  )

  if (!chartEntries.length) {
    return null
  }

  const width = 640
  const height = 220
  const paddingLeft = 42
  const paddingRight = 16
  const paddingTop = 16
  const paddingBottom = 32
  const innerWidth = width - paddingLeft - paddingRight
  const innerHeight = height - paddingTop - paddingBottom
  const gridValues = [0, 25, 50, 75, 100]

  const points = chartEntries.map((entry, index) => {
    const percentage = clampPercent(entry.accuracy) || 0
    const x =
      chartEntries.length === 1
        ? paddingLeft + innerWidth / 2
        : paddingLeft + (innerWidth * index) / (chartEntries.length - 1)
    const y = paddingTop + ((100 - percentage) / 100) * innerHeight

    return {
      ...entry,
      percentage,
      x,
      y,
      runNumber: index + 1,
    }
  })

  const polylinePoints = points
    .map((point) => `${point.x},${point.y}`)
    .join(' ')
  const latestPoint = points[points.length - 1]

  return (
    <Box borderWidth="1px" borderColor="gray.100" borderRadius="md" p={3}>
      <Stack spacing={3}>
        <Flex justify="space-between" align="center" flexWrap="wrap" gap={2}>
          <Box>
            <Text fontSize="sm" fontWeight={600}>
              {t('Success-rate trend')}
            </Text>
            <Text color="muted" fontSize="xs">
              {t(
                'The same validation holdout for this benchmark size is appended here after each new comparison run.'
              )}
            </Text>
          </Box>
          <Text color="muted" fontSize="xs">
            {t('Runs')}: {points.length} · {t('Latest')}:{' '}
            {formatSuccessRate(latestPoint?.accuracy)}
          </Text>
        </Flex>

        <Box overflowX="auto">
          <svg
            width="100%"
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={t('Developer training success rate over time')}
          >
            {gridValues.map((value) => {
              const y = paddingTop + ((100 - value) / 100) * innerHeight

              return (
                <g key={value}>
                  <line
                    x1={paddingLeft}
                    y1={y}
                    x2={width - paddingRight}
                    y2={y}
                    stroke="#E2E8F0"
                    strokeWidth="1"
                  />
                  <text
                    x={paddingLeft - 8}
                    y={y + 4}
                    textAnchor="end"
                    fontSize="11"
                    fill="#718096"
                  >
                    {value}%
                  </text>
                </g>
              )
            })}

            <line
              x1={paddingLeft}
              y1={paddingTop + innerHeight}
              x2={width - paddingRight}
              y2={paddingTop + innerHeight}
              stroke="#CBD5E0"
              strokeWidth="1.2"
            />

            {points.length > 1 ? (
              <polyline
                fill="none"
                stroke="#4C7CF0"
                strokeWidth="3"
                strokeLinejoin="round"
                strokeLinecap="round"
                points={polylinePoints}
              />
            ) : null}

            {points.map((point, index) => (
              <g key={`${point.evaluatedAt || point.resultPath || index}`}>
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={index === points.length - 1 ? 5 : 4}
                  fill={index === points.length - 1 ? '#2B6CB0' : '#4C7CF0'}
                >
                  <title>
                    {`${t('Run')} ${point.runNumber}: ${formatSuccessRate(
                      point.accuracy
                    )} · ${Number(point.correct) || 0} / ${
                      Number(point.totalFlips) || 0
                    } · ${formatTimestamp(point.evaluatedAt)}`}
                  </title>
                </circle>
                <text
                  x={point.x}
                  y={height - 10}
                  textAnchor="middle"
                  fontSize="11"
                  fill="#718096"
                >
                  {point.runNumber}
                </text>
              </g>
            ))}
          </svg>
        </Box>

        <Flex gap={2} flexWrap="wrap">
          {points
            .slice(-4)
            .reverse()
            .map((point) => (
              <Box
                key={`summary-${point.runNumber}-${point.evaluatedAt || ''}`}
                borderWidth="1px"
                borderColor="gray.100"
                borderRadius="md"
                px={3}
                py={2}
                bg="gray.50"
                minW="120px"
              >
                <Text fontSize="xs" fontWeight={700}>
                  {t('Run')} {point.runNumber}
                </Text>
                <Text fontSize="sm" fontWeight={600}>
                  {formatSuccessRate(point.accuracy)}
                </Text>
                <Text color="muted" fontSize="xs">
                  {Number(point.correct) || 0} / {Number(point.totalFlips) || 0}
                </Text>
                <Text color="muted" fontSize="xs">
                  {formatCompactTimestamp(point.evaluatedAt)}
                </Text>
              </Box>
            ))}
        </Flex>
      </Stack>
    </Box>
  )
}

export default function AiHumanTeacherPage() {
  const {t} = useTranslation()
  const router = useRouter()
  const toast = useToast()
  const {localAi} = useSettingsState()
  const {updateLocalAiSettings} = useSettingsDispatch()
  const epochState = useEpochState()
  const queryEpoch = String(router.query?.epoch || '').trim()
  const fallbackEpoch = React.useMemo(() => {
    const nextEpochNumber = Number(epochState?.epoch)
    return Number.isFinite(nextEpochNumber) && nextEpochNumber > 0
      ? String(nextEpochNumber - 1)
      : ''
  }, [epochState?.epoch])
  const currentEpoch = React.useMemo(() => {
    const nextEpoch = Number(epochState?.epoch)
    return Number.isFinite(nextEpoch) ? nextEpoch : null
  }, [epochState?.epoch])
  const currentPeriod = React.useMemo(
    () => String(epochState?.currentPeriod || '').trim(),
    [epochState?.currentPeriod]
  )
  const queryAction = String(router.query?.action || '')
    .trim()
    .toLowerCase()
  const isDeveloperMode = React.useMemo(() => {
    const raw = String(router.query?.developer || '')
      .trim()
      .toLowerCase()
    return ['1', 'true', 'yes', 'developer'].includes(raw)
  }, [router.query?.developer])
  const queryDemoSample = String(router.query?.sample || '').trim()
  const autoStartKeyRef = React.useRef('')
  const shouldFlushAutosaveRef = React.useRef(false)
  const localPilotTrainingRef = React.useRef(null)

  const [epoch, setEpoch] = React.useState(queryEpoch || fallbackEpoch)
  const [result, setResult] = React.useState(null)
  const [exportResult, setExportResult] = React.useState(null)
  const [importResult, setImportResult] = React.useState(null)
  const [annotationSourceMode, setAnnotationSourceMode] =
    React.useState('epoch')
  const [demoSampleName, setDemoSampleName] = React.useState(
    queryDemoSample ||
      (isDeveloperMode
        ? DEVELOPER_TRAINING_SAMPLE_OPTIONS[0].value
        : DEMO_SAMPLE_OPTIONS[0].value)
  )
  const [workspace, setWorkspace] = React.useState(null)
  const [selectedTaskId, setSelectedTaskId] = React.useState('')
  const [taskDetail, setTaskDetail] = React.useState(null)
  const [annotationDraft, setAnnotationDraft] = React.useState(
    createEmptyAnnotationDraft()
  )
  const [error, setError] = React.useState('')
  const [isLoading, setIsLoading] = React.useState(false)
  const [isUpdating, setIsUpdating] = React.useState(false)
  const [isExporting, setIsExporting] = React.useState(false)
  const [isImporting, setIsImporting] = React.useState(false)
  const [isWorkspaceLoading, setIsWorkspaceLoading] = React.useState(false)
  const [isTaskLoading, setIsTaskLoading] = React.useState(false)
  const [isSavingTask, setIsSavingTask] = React.useState(false)
  const [isFinalizingDeveloperChunk, setIsFinalizingDeveloperChunk] =
    React.useState(false)
  const [isRunningDeveloperComparison, setIsRunningDeveloperComparison] =
    React.useState(false)
  const [isGeneratingAiDraft, setIsGeneratingAiDraft] = React.useState(false)
  const [showReferenceTool, setShowReferenceTool] = React.useState(false)
  const [showAdvancedFields, setShowAdvancedFields] = React.useState(false)
  const [demoSessionState, setDemoSessionState] = React.useState(null)
  const [demoOffset, setDemoOffset] = React.useState(0)
  const [developerSessionState, setDeveloperSessionState] = React.useState(null)
  const [developerOffset, setDeveloperOffset] = React.useState(0)
  const [developerTelemetry, setDeveloperTelemetry] = React.useState(null)
  const [developerTelemetryError, setDeveloperTelemetryError] =
    React.useState('')
  const [isPromptToolsOpen, setIsPromptToolsOpen] = React.useState(false)
  const [isPromptEditingUnlocked, setIsPromptEditingUnlocked] =
    React.useState(false)
  const [showPromptResetConfirm, setShowPromptResetConfirm] =
    React.useState(false)
  const [developerPromptDraft, setDeveloperPromptDraft] = React.useState(
    DEFAULT_HUMAN_TEACHER_SYSTEM_PROMPT
  )
  const [aiReplyDraftByTaskId, setAiReplyDraftByTaskId] = React.useState({})
  const [_developerActionResult, setDeveloperActionResult] =
    React.useState(null)
  const [chunkDecisionDialog, setChunkDecisionDialog] = React.useState({
    isOpen: false,
    mode: '',
  })
  const [contributionDialog, setContributionDialog] = React.useState({
    isOpen: false,
    mode: '',
  })
  const [isExportingContributionBundle, setIsExportingContributionBundle] =
    React.useState(false)
  const [externalContributionBundle, setExternalContributionBundle] =
    React.useState(null)
  const [externalContributionError, setExternalContributionError] =
    React.useState('')
  const [lastPersistedDraft, setLastPersistedDraft] = React.useState({
    key: '',
    snapshot: '',
  })
  const [aiDraftRuntimeResolution, setAiDraftRuntimeResolution] =
    React.useState(() => createAiDraftRuntimeResolution())
  const [autosaveMeta, setAutosaveMeta] = React.useState({
    status: 'idle',
    savedAt: null,
    error: '',
  })
  const lastAutoDraftTaskIdRef = React.useRef('')

  React.useEffect(() => {
    if (queryEpoch) {
      setEpoch(queryEpoch)
    } else if (!epoch && fallbackEpoch) {
      setEpoch(fallbackEpoch)
    }
  }, [epoch, fallbackEpoch, queryEpoch])

  React.useEffect(() => {
    if (queryDemoSample) {
      setDemoSampleName(queryDemoSample)
    }
  }, [queryDemoSample])

  React.useEffect(() => {
    if (queryDemoSample) {
      return
    }

    setDemoSampleName(
      (current) =>
        current ||
        (isDeveloperMode
          ? DEVELOPER_TRAINING_SAMPLE_OPTIONS[0].value
          : DEMO_SAMPLE_OPTIONS[0].value)
    )
  }, [isDeveloperMode, queryDemoSample])

  const ensureBridge = React.useCallback(() => {
    if (
      !global.localAi ||
      typeof global.localAi.loadHumanTeacherPackage !== 'function'
    ) {
      throw new Error('Local AI human-teacher bridge is unavailable')
    }

    return global.localAi
  }, [])

  const refreshDeveloperTelemetry = React.useCallback(async () => {
    if (
      !isDeveloperMode ||
      !global.localAi ||
      typeof global.localAi.getDeveloperTelemetry !== 'function'
    ) {
      return null
    }

    try {
      const nextTelemetry = await global.localAi.getDeveloperTelemetry()
      setDeveloperTelemetry(nextTelemetry || null)
      setDeveloperTelemetryError('')
      return nextTelemetry
    } catch (nextError) {
      setDeveloperTelemetryError(formatErrorMessage(nextError))
      return null
    }
  }, [isDeveloperMode])

  const savedDeveloperPromptOverride = React.useMemo(
    () => String(localAi?.developerHumanTeacherSystemPrompt || '').trim(),
    [localAi?.developerHumanTeacherSystemPrompt]
  )
  const effectiveDeveloperPrompt = React.useMemo(
    () => savedDeveloperPromptOverride || DEFAULT_HUMAN_TEACHER_SYSTEM_PROMPT,
    [savedDeveloperPromptOverride]
  )
  const hasCustomDeveloperPrompt = Boolean(savedDeveloperPromptOverride)
  const developerLocalTrainingProfile = normalizeDeveloperLocalTrainingProfile(
    localAi?.developerLocalTrainingProfile ||
      DEFAULT_DEVELOPER_LOCAL_TRAINING_PROFILE
  )
  const developerLocalTrainingThermalMode =
    normalizeDeveloperLocalTrainingThermalMode(
      localAi?.developerLocalTrainingThermalMode ||
        DEFAULT_DEVELOPER_LOCAL_TRAINING_THERMAL_MODE
    )
  const developerLocalBenchmarkSize = normalizeDeveloperLocalBenchmarkSize(
    localAi?.developerLocalBenchmarkSize ||
      DEFAULT_DEVELOPER_LOCAL_BENCHMARK_SIZE
  )
  const developerAiDraftTriggerMode = normalizeDeveloperAiDraftTriggerMode(
    localAi?.developerAiDraftTriggerMode ||
      DEFAULT_DEVELOPER_AI_DRAFT_TRIGGER_MODE
  )
  const developerAiDraftContextWindowTokens =
    normalizeDeveloperAiDraftContextWindowTokens(
      localAi?.developerAiDraftContextWindowTokens ||
        DEFAULT_DEVELOPER_AI_DRAFT_CONTEXT_WINDOW_TOKENS
    )
  const developerAiDraftQuestionWindowChars =
    normalizeDeveloperAiDraftQuestionWindowChars(
      localAi?.developerAiDraftQuestionWindowChars ||
        DEFAULT_DEVELOPER_AI_DRAFT_QUESTION_WINDOW_CHARS
    )
  const developerAiDraftAnswerWindowTokens =
    normalizeDeveloperAiDraftAnswerWindowTokens(
      localAi?.developerAiDraftAnswerWindowTokens ||
        DEFAULT_DEVELOPER_AI_DRAFT_ANSWER_WINDOW_TOKENS
    )
  const developerLocalTrainingEpochs = normalizeDeveloperLocalTrainingEpochs(
    localAi?.developerLocalTrainingEpochs ||
      DEFAULT_DEVELOPER_LOCAL_TRAINING_EPOCHS
  )
  const developerLocalTrainingBatchSize =
    normalizeDeveloperLocalTrainingBatchSize(
      localAi?.developerLocalTrainingBatchSize ||
        DEFAULT_DEVELOPER_LOCAL_TRAINING_BATCH_SIZE
    )
  const developerLocalTrainingLoraRank =
    normalizeDeveloperLocalTrainingLoraRank(
      localAi?.developerLocalTrainingLoraRank ||
        DEFAULT_DEVELOPER_LOCAL_TRAINING_LORA_RANK
    )
  const developerLocalTrainingModelPath =
    resolveDeveloperLocalTrainingProfileModelPath(developerLocalTrainingProfile)
  const developerRequestedRuntimeModel =
    resolveDeveloperLocalTrainingProfileRuntimeModel(
      developerLocalTrainingProfile
    )
  const developerRequestedRuntimeVisionModel =
    resolveDeveloperLocalTrainingProfileRuntimeVisionModel(
      developerLocalTrainingProfile
    )
  const developerLocalTrainingProfileSummary = React.useMemo(
    () =>
      describeDeveloperLocalTrainingProfile(developerLocalTrainingProfile, t),
    [developerLocalTrainingProfile, t]
  )
  const developerLocalTrainingThermalSummary = React.useMemo(
    () =>
      describeDeveloperLocalTrainingThermalMode(
        developerLocalTrainingThermalMode,
        t
      ),
    [developerLocalTrainingThermalMode, t]
  )
  const localDraftRequestedRuntimeModelLabel = React.useMemo(
    () =>
      developerRequestedRuntimeVisionModel ||
      developerRequestedRuntimeModel ||
      t('current local runtime model'),
    [developerRequestedRuntimeModel, developerRequestedRuntimeVisionModel, t]
  )
  const localDraftActiveRuntimeModelLabel = React.useMemo(
    () =>
      aiDraftRuntimeResolution.activeModel ||
      localDraftRequestedRuntimeModelLabel ||
      t('current local runtime model'),
    [
      aiDraftRuntimeResolution.activeModel,
      localDraftRequestedRuntimeModelLabel,
      t,
    ]
  )
  const showDraftRuntimeInstallHint = Boolean(
    aiDraftRuntimeResolution.installHint
  )
  let localDraftRuntimeStatusHint = null

  if (showDraftRuntimeInstallHint) {
    localDraftRuntimeStatusHint = (
      <Text color="muted" fontSize="xs" wordBreak="break-all">
        {t('Install hint')}: {aiDraftRuntimeResolution.installHint}
      </Text>
    )
  }
  const shareHumanTeacherAnnotationsWithNetwork = Boolean(
    localAi?.shareHumanTeacherAnnotationsWithNetwork
  )
  const autoTriggerAiDraft = developerAiDraftTriggerMode === 'automatic'
  const developerAiDraftWindowTone = React.useMemo(
    () =>
      describeDeveloperAiDraftWindowTone({
        contextWindowTokens: developerAiDraftContextWindowTokens,
        questionWindowChars: developerAiDraftQuestionWindowChars,
        answerWindowTokens: developerAiDraftAnswerWindowTokens,
      }).tone,
    [
      developerAiDraftAnswerWindowTokens,
      developerAiDraftContextWindowTokens,
      developerAiDraftQuestionWindowChars,
    ]
  )
  const developerAiDraftWindowStyles = React.useMemo(() => {
    switch (developerAiDraftWindowTone) {
      case 'orange':
        return {
          borderColor: 'orange.100',
          bg: 'orange.50',
          badgeScheme: 'orange',
          badgeLabel: t('Roomier and heavier'),
        }
      case 'blue':
        return {
          borderColor: 'blue.100',
          bg: 'blue.50',
          badgeScheme: 'blue',
          badgeLabel: t('Tighter and faster'),
        }
      case 'green':
      default:
        return {
          borderColor: 'green.100',
          bg: 'green.50',
          badgeScheme: 'green',
          badgeLabel: t('Balanced'),
        }
    }
  }, [developerAiDraftWindowTone, t])
  const developerLocalTrainingUpdatesPerEpoch = React.useMemo(
    () =>
      Math.max(
        1,
        Math.ceil(
          DEVELOPER_TRAINING_CHUNK_SIZE / developerLocalTrainingBatchSize
        )
      ),
    [developerLocalTrainingBatchSize]
  )
  const developerLocalTrainingTotalUpdates = React.useMemo(
    () => developerLocalTrainingUpdatesPerEpoch * developerLocalTrainingEpochs,
    [developerLocalTrainingEpochs, developerLocalTrainingUpdatesPerEpoch]
  )
  const developerLocalTrainingCoolingFloorMs = React.useMemo(
    () =>
      developerLocalTrainingTotalUpdates *
        developerLocalTrainingThermalSummary.stepCooldownMs +
      developerLocalTrainingEpochs *
        developerLocalTrainingThermalSummary.epochCooldownMs,
    [
      developerLocalTrainingEpochs,
      developerLocalTrainingThermalSummary.epochCooldownMs,
      developerLocalTrainingThermalSummary.stepCooldownMs,
      developerLocalTrainingTotalUpdates,
    ]
  )
  const developerLocalTrainingRankRatio = React.useMemo(
    () =>
      Math.max(
        0.1,
        developerLocalTrainingLoraRank /
          DEFAULT_DEVELOPER_LOCAL_TRAINING_LORA_RANK
      ),
    [developerLocalTrainingLoraRank]
  )
  const developerLocalTrainingBudgetTone = React.useMemo(
    () =>
      describeDeveloperLocalTrainingBudgetTone({
        batchSize: developerLocalTrainingBatchSize,
        epochs: developerLocalTrainingEpochs,
        loraRank: developerLocalTrainingLoraRank,
        thermalMode: developerLocalTrainingThermalMode,
      }).tone,
    [
      developerLocalTrainingBatchSize,
      developerLocalTrainingEpochs,
      developerLocalTrainingLoraRank,
      developerLocalTrainingThermalMode,
    ]
  )
  const developerLocalTrainingBudgetStyles = React.useMemo(() => {
    switch (developerLocalTrainingBudgetTone) {
      case 'orange':
        return {
          borderColor: 'orange.100',
          bg: 'orange.50',
          badgeScheme: 'orange',
          badgeLabel: t('Heavier local run'),
        }
      case 'blue':
        return {
          borderColor: 'blue.100',
          bg: 'blue.50',
          badgeScheme: 'blue',
          badgeLabel: t('Lighter participation'),
        }
      case 'green':
      default:
        return {
          borderColor: 'green.100',
          bg: 'green.50',
          badgeScheme: 'green',
          badgeLabel: t('Balanced pilot'),
        }
    }
  }, [developerLocalTrainingBudgetTone, t])
  const developerTelemetryIsBusy =
    isFinalizingDeveloperChunk || isRunningDeveloperComparison

  React.useEffect(() => {
    if (!isDeveloperMode) {
      setDeveloperTelemetry(null)
      setDeveloperTelemetryError('')
      return undefined
    }

    const refreshIntervalMs =
      isFinalizingDeveloperChunk || isRunningDeveloperComparison ? 3000 : 10000

    const refreshNow = async () => {
      await refreshDeveloperTelemetry()
    }

    refreshNow()
    const intervalId = window.setInterval(refreshNow, refreshIntervalMs)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [
    isDeveloperMode,
    isFinalizingDeveloperChunk,
    isRunningDeveloperComparison,
    refreshDeveloperTelemetry,
  ])

  React.useEffect(() => {
    const runtimeBackend = String(localAi?.runtimeBackend || '').trim()

    if (
      !isDeveloperMode ||
      localAi?.enabled !== true ||
      runtimeBackend !== 'ollama-direct'
    ) {
      return
    }

    const currentModel = String(localAi?.model || '').trim()
    const currentVisionModel = String(localAi?.visionModel || '').trim()

    if (
      currentModel === developerRequestedRuntimeModel &&
      currentVisionModel === developerRequestedRuntimeVisionModel
    ) {
      return
    }

    updateLocalAiSettings({
      model: developerRequestedRuntimeModel,
      visionModel: developerRequestedRuntimeVisionModel,
    })
  }, [
    developerRequestedRuntimeModel,
    developerRequestedRuntimeVisionModel,
    isDeveloperMode,
    localAi?.enabled,
    localAi?.model,
    localAi?.runtimeBackend,
    localAi?.visionModel,
    updateLocalAiSettings,
  ])

  React.useEffect(() => {
    let isCancelled = false

    const requestedModel =
      developerRequestedRuntimeVisionModel || developerRequestedRuntimeModel

    if (!isDeveloperMode) {
      setAiDraftRuntimeResolution(createAiDraftRuntimeResolution())
      return undefined
    }

    if (localAi?.enabled !== true) {
      setAiDraftRuntimeResolution(
        createAiDraftRuntimeResolution({
          status: 'disabled',
          requestedModel,
          fallbackModel: '',
          fallbackReason: '',
          installHint: requestedModel ? `ollama pull ${requestedModel}` : '',
        })
      )
      return undefined
    }

    if (String(localAi?.runtimeBackend || '').trim() !== 'ollama-direct') {
      setAiDraftRuntimeResolution(
        createAiDraftRuntimeResolution({
          status: 'unsupported_backend',
          requestedModel,
          fallbackModel: '',
          lastError: t(
            'The current Local AI runtime backend is not Ollama, so the requested Qwen runtime family cannot be verified here.'
          ),
          installHint: requestedModel ? `ollama pull ${requestedModel}` : '',
        })
      )
      return undefined
    }

    setAiDraftRuntimeResolution((current) =>
      createAiDraftRuntimeResolution({
        ...current,
        status: 'loading',
        requestedModel,
        fallbackModel: '',
        installHint: requestedModel ? `ollama pull ${requestedModel}` : '',
      })
    )
    ;(async () => {
      try {
        const bridge = ensureBridge()
        const modelListResult = await bridge.listModels({
          allowRuntimeStart: false,
          baseUrl: localAi?.baseUrl,
          runtimeBackend: localAi?.runtimeBackend,
          runtimeType: localAi?.runtimeType,
          timeoutMs: 10000,
        })

        if (isCancelled) {
          return
        }

        if (!modelListResult?.ok) {
          setAiDraftRuntimeResolution(
            createAiDraftRuntimeResolution({
              status: 'unavailable',
              requestedModel,
              fallbackModel: '',
              lastError: String(
                modelListResult?.lastError || modelListResult?.error || ''
              ).trim(),
              installHint: requestedModel
                ? `ollama pull ${requestedModel}`
                : '',
            })
          )
          return
        }

        setAiDraftRuntimeResolution(
          resolveAiDraftRuntimeResolution({
            requestedModel,
            availableModels: modelListResult.models,
          })
        )
      } catch (runtimeError) {
        if (isCancelled) {
          return
        }

        setAiDraftRuntimeResolution(
          createAiDraftRuntimeResolution({
            status: 'error',
            requestedModel,
            fallbackModel: '',
            lastError: String(
              (runtimeError && runtimeError.message) || runtimeError || ''
            ).trim(),
            installHint: requestedModel ? `ollama pull ${requestedModel}` : '',
          })
        )
      }
    })()

    return () => {
      isCancelled = true
    }
  }, [
    developerRequestedRuntimeModel,
    developerRequestedRuntimeVisionModel,
    ensureBridge,
    isDeveloperMode,
    localAi?.baseUrl,
    localAi?.enabled,
    localAi?.runtimeBackend,
    localAi?.runtimeType,
    t,
  ])

  React.useEffect(() => {
    if (!isPromptEditingUnlocked) {
      setDeveloperPromptDraft(effectiveDeveloperPrompt)
    }
  }, [effectiveDeveloperPrompt, isPromptEditingUnlocked])

  const openPromptTools = React.useCallback(() => {
    setIsPromptToolsOpen(true)
    setShowPromptResetConfirm(false)
  }, [])

  const closePromptTools = React.useCallback(() => {
    setIsPromptToolsOpen(false)
    setIsPromptEditingUnlocked(false)
    setShowPromptResetConfirm(false)
    setDeveloperPromptDraft(effectiveDeveloperPrompt)
  }, [effectiveDeveloperPrompt])

  const unlockPromptEditing = React.useCallback(() => {
    setIsPromptToolsOpen(true)
    setIsPromptEditingUnlocked(true)
    setShowPromptResetConfirm(false)
    setDeveloperPromptDraft(effectiveDeveloperPrompt)
  }, [effectiveDeveloperPrompt])

  const applyDeveloperPrompt = React.useCallback(() => {
    const normalizedPrompt = String(developerPromptDraft || '').trim()

    if (!normalizedPrompt) {
      toast({
        render: () => (
          <Toast title={t('Prompt cannot be empty')}>
            {t(
              'Use the app default prompt or enter a complete custom human-teacher system prompt before applying.'
            )}
          </Toast>
        ),
      })
      return
    }

    updateLocalAiSettings({
      developerHumanTeacherSystemPrompt:
        normalizedPrompt === DEFAULT_HUMAN_TEACHER_SYSTEM_PROMPT
          ? ''
          : normalizedPrompt,
    })
    setIsPromptEditingUnlocked(false)
    setShowPromptResetConfirm(false)
    setDeveloperPromptDraft(normalizedPrompt)
    const appliedPromptMessage =
      normalizedPrompt === DEFAULT_HUMAN_TEACHER_SYSTEM_PROMPT
        ? t(
            'The developer human-teacher trainer will use the app default prompt.'
          )
        : t(
            'The developer human-teacher trainer will use your custom system prompt on the next training run.'
          )
    toast({
      render: () => (
        <Toast title={t('Developer prompt updated')}>
          {appliedPromptMessage}
        </Toast>
      ),
    })
  }, [developerPromptDraft, t, toast, updateLocalAiSettings])

  const resetDeveloperPromptToDefault = React.useCallback(() => {
    updateLocalAiSettings({
      developerHumanTeacherSystemPrompt: '',
    })
    setIsPromptEditingUnlocked(false)
    setShowPromptResetConfirm(false)
    setDeveloperPromptDraft(DEFAULT_HUMAN_TEACHER_SYSTEM_PROMPT)
    toast({
      render: () => (
        <Toast title={t('Developer prompt reset')}>
          {t(
            'The developer human-teacher trainer is back on the app default system prompt.'
          )}
        </Toast>
      ),
    })
  }, [t, toast, updateLocalAiSettings])

  const openChunkDecisionDialog = React.useCallback((mode) => {
    setChunkDecisionDialog({
      isOpen: true,
      mode,
    })
  }, [])

  const closeChunkDecisionDialog = React.useCallback(() => {
    setChunkDecisionDialog({
      isOpen: false,
      mode: '',
    })
  }, [])

  const openContributionDialog = React.useCallback((mode) => {
    setContributionDialog({
      isOpen: true,
      mode,
    })
  }, [])

  const closeContributionDialog = React.useCallback(() => {
    if (isExportingContributionBundle) {
      return
    }

    setContributionDialog({
      isOpen: false,
      mode: '',
    })
  }, [isExportingContributionBundle])

  const openLocalPilotTrainingDialog = React.useCallback(() => {
    openContributionDialog('local')
  }, [openContributionDialog])

  const scrollToLocalPilotTraining = React.useCallback(() => {
    const nextNode = localPilotTrainingRef.current

    if (nextNode && typeof nextNode.scrollIntoView === 'function') {
      nextNode.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    }
  }, [])

  const enableAnnotationSharing = React.useCallback(() => {
    if (!shareHumanTeacherAnnotationsWithNetwork) {
      updateLocalAiSettings({
        shareHumanTeacherAnnotationsWithNetwork: true,
      })
      toast({
        render: () => (
          <Toast title={t('Annotation-sharing consent saved')}>
            {t(
              'The app stored your future network-sharing consent locally. The later P2P exchange flow can reuse it without asking again.'
            )}
          </Toast>
        ),
      })
    }

    openContributionDialog('share')
  }, [
    openContributionDialog,
    shareHumanTeacherAnnotationsWithNetwork,
    t,
    toast,
    updateLocalAiSettings,
  ])

  const exportExternalTrainingBundle = React.useCallback(async () => {
    const nextAnnotatedCount =
      Number(developerSessionState?.annotatedCount) || 0

    if (nextAnnotatedCount <= 0) {
      toast({
        render: () => (
          <Toast title={t('No completed annotations yet')}>
            {t(
              'Complete at least one developer flip before exporting an external GPU training bundle.'
            )}
          </Toast>
        ),
      })
      return
    }

    openContributionDialog('external')
    setIsExportingContributionBundle(true)
    setExternalContributionError('')
    setExternalContributionBundle(null)

    try {
      const nextBundle = await ensureBridge().exportHumanTeacherDeveloperBundle(
        {
          sampleName: demoSampleName,
          runtimeBackend: localAi?.runtimeBackend,
          runtimeType: localAi?.runtimeType,
          baseUrl: localAi?.baseUrl,
          model: localAi?.model,
          visionModel: localAi?.visionModel,
          developerHumanTeacherSystemPrompt: effectiveDeveloperPrompt,
        }
      )

      setExternalContributionBundle(nextBundle)
    } catch (nextError) {
      setExternalContributionError(formatErrorMessage(nextError))
    } finally {
      setIsExportingContributionBundle(false)
    }
  }, [
    demoSampleName,
    developerSessionState?.annotatedCount,
    effectiveDeveloperPrompt,
    ensureBridge,
    localAi?.baseUrl,
    localAi?.model,
    localAi?.runtimeBackend,
    localAi?.runtimeType,
    localAi?.visionModel,
    openContributionDialog,
    t,
    toast,
  ])

  const loadPackage = React.useCallback(
    async ({forceRebuild = false} = {}) => {
      const nextEpoch = String(epoch || '').trim()

      if (!nextEpoch) {
        setError(
          t('Enter an epoch before loading a human-teacher annotation set.')
        )
        setResult(null)
        return
      }

      setIsLoading(true)
      setError('')
      setExportResult(null)
      setImportResult(null)
      setAnnotationSourceMode('epoch')
      setWorkspace(null)
      setSelectedTaskId('')
      setTaskDetail(null)
      setAnnotationDraft(createEmptyAnnotationDraft())
      closeChunkDecisionDialog()
      setDemoSessionState(null)
      setDemoOffset(0)

      try {
        const bridge = ensureBridge()
        let nextResult = null

        if (!forceRebuild) {
          try {
            nextResult = await bridge.loadHumanTeacherPackage({
              epoch: nextEpoch,
              currentEpoch,
            })
          } catch (loadError) {
            const message = formatErrorMessage(loadError)
            if (!/human teacher package is unavailable/i.test(message)) {
              throw loadError
            }
          }
        }

        if (!nextResult) {
          nextResult = await bridge.buildHumanTeacherPackage({
            epoch: nextEpoch,
            currentEpoch,
            batchSize: HUMAN_TEACHER_SET_LIMIT,
            includePackage: true,
            fetchFlipPayloads: true,
            requireFlipPayloads: true,
          })
        }

        setResult(nextResult)
      } catch (nextError) {
        setResult(null)
        setError(formatErrorMessage(nextError))
      } finally {
        setIsLoading(false)
      }
    },
    [closeChunkDecisionDialog, currentEpoch, ensureBridge, epoch, t]
  )

  React.useEffect(() => {
    if (!isDeveloperMode && epoch) {
      loadPackage()
    }
  }, [epoch, isDeveloperMode, loadPackage])

  const updateReviewStatus = React.useCallback(
    async (nextReviewStatus) => {
      const nextEpoch = String(epoch || '').trim()

      if (!nextEpoch) {
        setError(t('Enter an epoch before updating the annotation status.'))
        return
      }

      setIsUpdating(true)
      setError('')

      try {
        const nextResult = await ensureBridge().updateHumanTeacherPackageReview(
          {
            epoch: nextEpoch,
            currentEpoch,
            reviewStatus: nextReviewStatus,
          }
        )
        setResult(nextResult)
      } catch (nextError) {
        setError(formatErrorMessage(nextError))
      } finally {
        setIsUpdating(false)
      }
    },
    [currentEpoch, ensureBridge, epoch, t]
  )

  const exportTasks = React.useCallback(async () => {
    const nextEpoch = String(epoch || '').trim()

    if (!nextEpoch) {
      setError(t('Enter an epoch before exporting the fallback workspace.'))
      return
    }

    setIsExporting(true)
    setError('')
    setImportResult(null)

    try {
      const bridge = ensureBridge()
      let nextResult = result

      if (normalizeReviewStatus(result?.package?.reviewStatus) !== 'approved') {
        nextResult = await bridge.updateHumanTeacherPackageReview({
          epoch: nextEpoch,
          currentEpoch,
          reviewStatus: 'approved',
        })
        setResult(nextResult)
      }

      nextResult = await bridge.exportHumanTeacherTasks({
        epoch: nextEpoch,
        currentEpoch,
      })
      setResult(nextResult)
      setExportResult(nextResult.export || null)
      const workspaceResult = await bridge.loadHumanTeacherAnnotationWorkspace({
        epoch: nextEpoch,
        currentEpoch,
      })
      const nextWorkspace = workspaceResult.workspace || null
      setResult(workspaceResult)
      closeChunkDecisionDialog()
      setWorkspace(nextWorkspace)
      setSelectedTaskId(pickPreferredTaskId(nextWorkspace, selectedTaskId))
    } catch (nextError) {
      setExportResult(null)
      setError(formatErrorMessage(nextError))
    } finally {
      setIsExporting(false)
    }
  }, [
    closeChunkDecisionDialog,
    currentEpoch,
    ensureBridge,
    epoch,
    result,
    selectedTaskId,
    t,
  ])

  const loadWorkspace = React.useCallback(async () => {
    const nextEpoch = String(epoch || '').trim()

    if (!nextEpoch) {
      setError(t('Enter an epoch before opening the annotation set.'))
      return
    }

    setIsWorkspaceLoading(true)
    setError('')

    try {
      const nextResult =
        await ensureBridge().loadHumanTeacherAnnotationWorkspace({
          epoch: nextEpoch,
          currentEpoch,
        })
      const nextWorkspace = nextResult.workspace || null
      setAnnotationSourceMode('epoch')
      setResult(nextResult)
      closeChunkDecisionDialog()
      setDemoSessionState(null)
      setDemoOffset(0)
      setWorkspace(nextWorkspace)
      setSelectedTaskId(pickPreferredTaskId(nextWorkspace, selectedTaskId))
    } catch (nextError) {
      setWorkspace(null)
      setSelectedTaskId('')
      setTaskDetail(null)
      setAnnotationDraft(createEmptyAnnotationDraft())
      setError(formatErrorMessage(nextError))
    } finally {
      setIsWorkspaceLoading(false)
    }
  }, [
    closeChunkDecisionDialog,
    currentEpoch,
    ensureBridge,
    epoch,
    selectedTaskId,
    t,
  ])

  const loadOfflineDemoWorkspace = React.useCallback(
    async ({offsetOverride} = {}) => {
      setIsWorkspaceLoading(true)
      setError('')
      setImportResult(null)

      try {
        const nextResult = await ensureBridge().loadHumanTeacherDemoWorkspace({
          sampleName: demoSampleName,
          offset: offsetOverride,
          batchSize: DEVELOPER_TRAINING_CHUNK_SIZE,
        })
        const nextWorkspace = nextResult.workspace || null
        setAnnotationSourceMode('demo')
        setWorkspace(nextWorkspace)
        setResult(nextResult)
        closeChunkDecisionDialog()
        setDemoSessionState(nextResult.state || null)
        setDemoOffset(Number(nextResult.offset) || 0)
        setDeveloperSessionState(null)
        setDeveloperActionResult(null)
        setSelectedTaskId(pickPreferredTaskId(nextWorkspace, selectedTaskId))

        if (queryAction === 'demo') {
          router.replace('/settings/ai-human-teacher')
        }
      } catch (nextError) {
        setWorkspace(null)
        setSelectedTaskId('')
        setTaskDetail(null)
        setAnnotationDraft(createEmptyAnnotationDraft())
        setDemoSessionState(null)
        setError(formatErrorMessage(nextError))
      } finally {
        setIsWorkspaceLoading(false)
      }
    },
    [
      closeChunkDecisionDialog,
      demoSampleName,
      ensureBridge,
      queryAction,
      router,
      selectedTaskId,
    ]
  )

  const loadDeveloperSession = React.useCallback(
    async ({offsetOverride} = {}) => {
      setIsWorkspaceLoading(true)
      setError('')
      setImportResult(null)

      try {
        const nextResult =
          await ensureBridge().loadHumanTeacherDeveloperSession({
            sampleName: demoSampleName,
            offset: offsetOverride,
            currentPeriod,
          })
        const nextWorkspace = nextResult.workspace || null
        setAnnotationSourceMode('developer')
        setWorkspace(nextWorkspace)
        setResult(nextResult)
        closeChunkDecisionDialog()
        setDemoSessionState(null)
        setDemoOffset(0)
        setDeveloperSessionState(nextResult.state || null)
        setDeveloperOffset(Number(nextResult.offset) || 0)
        setDeveloperActionResult(null)
        setSelectedTaskId(pickPreferredTaskId(nextWorkspace, selectedTaskId))

        if (queryAction === 'start') {
          router.replace('/settings/ai-human-teacher?developer=1')
        }
      } catch (nextError) {
        setWorkspace(null)
        setSelectedTaskId('')
        setTaskDetail(null)
        setAnnotationDraft(createEmptyAnnotationDraft())
        setDeveloperSessionState(null)
        setDeveloperActionResult(null)
        setError(formatErrorMessage(nextError))
      } finally {
        setIsWorkspaceLoading(false)
      }
    },
    [
      currentPeriod,
      demoSampleName,
      ensureBridge,
      queryAction,
      router,
      selectedTaskId,
      closeChunkDecisionDialog,
    ]
  )

  const continueWithLocalPilotTraining = React.useCallback(async () => {
    setContributionDialog({
      isOpen: false,
      mode: '',
    })

    if (!workspace || annotationSourceMode !== 'developer') {
      await loadDeveloperSession()
    }

    if (typeof window !== 'undefined') {
      window.setTimeout(() => {
        scrollToLocalPilotTraining()
      }, 120)
    }
  }, [
    annotationSourceMode,
    loadDeveloperSession,
    scrollToLocalPilotTraining,
    workspace,
  ])

  const startAnnotationFlow = React.useCallback(async () => {
    const nextEpoch = String(epoch || '').trim()

    if (!nextEpoch) {
      setError(t('Enter an epoch before starting annotation.'))
      return
    }

    setIsExporting(true)
    setError('')
    setImportResult(null)

    try {
      const bridge = ensureBridge()
      let nextResult = result

      if (
        normalizeReviewStatus(nextResult?.package?.reviewStatus) !== 'approved'
      ) {
        nextResult = await bridge.updateHumanTeacherPackageReview({
          epoch: nextEpoch,
          currentEpoch,
          reviewStatus: 'approved',
        })
        setResult(nextResult)
      }

      nextResult = await bridge.exportHumanTeacherTasks({
        epoch: nextEpoch,
        currentEpoch,
      })
      setResult(nextResult)
      setExportResult(nextResult.export || null)

      const workspaceResult = await bridge.loadHumanTeacherAnnotationWorkspace({
        epoch: nextEpoch,
        currentEpoch,
      })
      const nextWorkspace = workspaceResult.workspace || null
      setAnnotationSourceMode('epoch')
      setResult(workspaceResult)
      closeChunkDecisionDialog()
      setDemoSessionState(null)
      setDemoOffset(0)
      setWorkspace(nextWorkspace)
      setSelectedTaskId(pickPreferredTaskId(nextWorkspace, selectedTaskId))

      if (queryAction === 'start') {
        router.replace(`/settings/ai-human-teacher?epoch=${nextEpoch}`)
      }
    } catch (nextError) {
      setError(formatErrorMessage(nextError))
    } finally {
      setIsExporting(false)
    }
  }, [
    currentEpoch,
    ensureBridge,
    epoch,
    queryAction,
    result,
    router,
    selectedTaskId,
    t,
    closeChunkDecisionDialog,
  ])

  const loadTask = React.useCallback(
    async (taskId) => {
      const nextEpoch = String(epoch || '').trim()

      if ((!nextEpoch && annotationSourceMode !== 'demo') || !taskId) {
        return
      }

      setIsTaskLoading(true)
      setError('')
      setAnnotationDraft(createEmptyAnnotationDraft())
      setLastPersistedDraft({key: '', snapshot: ''})
      setAutosaveMeta({
        status: 'idle',
        savedAt: null,
        error: '',
      })
      setShowAdvancedFields(false)
      setShowReferenceTool(false)

      try {
        let nextResult = null

        if (annotationSourceMode === 'developer') {
          nextResult = await ensureBridge().loadHumanTeacherDeveloperTask({
            sampleName: demoSampleName,
            offset: developerOffset,
            currentPeriod,
            taskId,
          })
        } else if (annotationSourceMode === 'demo') {
          nextResult = await ensureBridge().loadHumanTeacherDemoTask({
            sampleName: demoSampleName,
            offset: demoOffset,
            taskId,
          })
        } else {
          nextResult = await ensureBridge().loadHumanTeacherAnnotationTask({
            epoch: nextEpoch,
            currentEpoch,
            taskId,
          })
        }

        const nextTask = nextResult.task || null
        const nextDraft = sanitizeLoadedAnnotationDraftForTask(
          nextTask,
          nextTask?.annotation || {}
        )

        setTaskDetail(nextTask)
        setAnnotationDraft(nextDraft)
        setLastPersistedDraft({
          key: buildAnnotationDraftKey({
            annotationSourceMode,
            epoch: nextEpoch,
            demoSampleName,
            demoOffset,
            developerOffset,
            selectedTaskId: taskId,
          }),
          snapshot: JSON.stringify(nextDraft),
        })
        setAutosaveMeta({
          status: 'idle',
          savedAt: null,
          error: '',
        })
        setShowAdvancedFields(false)
        setShowReferenceTool(false)
      } catch (nextError) {
        setTaskDetail(null)
        setAnnotationDraft(createEmptyAnnotationDraft())
        setLastPersistedDraft({key: '', snapshot: ''})
        setAutosaveMeta({
          status: 'idle',
          savedAt: null,
          error: '',
        })
        setError(formatErrorMessage(nextError))
      } finally {
        setIsTaskLoading(false)
      }
    },
    [
      annotationSourceMode,
      currentEpoch,
      currentPeriod,
      demoSampleName,
      demoOffset,
      developerOffset,
      ensureBridge,
      epoch,
    ]
  )

  const taskIds = React.useMemo(
    () =>
      workspace && Array.isArray(workspace.tasks)
        ? workspace.tasks.map((task) => task.taskId)
        : [],
    [workspace]
  )
  const selectedTaskIndex = React.useMemo(
    () => taskIds.indexOf(selectedTaskId),
    [selectedTaskId, taskIds]
  )
  const totalTaskCount = Number(workspace?.taskCount) || taskIds.length || 0
  const currentFlipLabel = React.useMemo(
    () => getCurrentFlipLabel(t, selectedTaskIndex, totalTaskCount),
    [selectedTaskIndex, t, totalTaskCount]
  )
  const completionPercent = React.useMemo(() => {
    if (!totalTaskCount) {
      return 0
    }

    const completedCount = Number(workspace?.completedCount) || 0
    return Math.max(
      0,
      Math.min(100, Math.round((completedCount / totalTaskCount) * 100))
    )
  }, [totalTaskCount, workspace?.completedCount])
  const previousTaskId =
    selectedTaskIndex > 0 ? taskIds[selectedTaskIndex - 1] : ''
  const nextTaskId = React.useMemo(() => {
    if (
      !workspace ||
      !Array.isArray(workspace.tasks) ||
      selectedTaskIndex < 0
    ) {
      return ''
    }

    const remainingTasks = workspace.tasks.slice(selectedTaskIndex + 1)
    const nextIncompleteTask = remainingTasks.find((task) => !task.isComplete)

    if (nextIncompleteTask) {
      return nextIncompleteTask.taskId
    }

    return taskIds[selectedTaskIndex + 1] || ''
  }, [selectedTaskIndex, taskIds, workspace])

  const leftPanels = React.useMemo(
    () => getOrderedPanels(taskDetail, taskDetail?.leftOrder || []),
    [taskDetail]
  )
  const rightPanels = React.useMemo(
    () => getOrderedPanels(taskDetail, taskDetail?.rightOrder || []),
    [taskDetail]
  )
  const activePanelReferences = React.useMemo(
    () =>
      normalizePanelReferences(annotationDraft.panel_references).filter(
        (reference) => hasPanelReferenceContent(reference)
      ),
    [annotationDraft.panel_references]
  )
  const panelReferencesByIndex = React.useMemo(() => {
    const next = new Map()

    normalizePanelReferences(annotationDraft.panel_references).forEach(
      (reference) => {
        if (
          reference.panel_index === null ||
          reference.x === null ||
          reference.y === null
        ) {
          return
        }

        const existing = next.get(reference.panel_index) || []
        existing.push(reference)
        next.set(reference.panel_index, existing)
      }
    )

    return next
  }, [annotationDraft.panel_references])
  const activePanelReferenceSummary = React.useMemo(
    () =>
      activePanelReferences
        .map((reference) =>
          reference.description
            ? `${reference.code} = ${reference.description}`
            : reference.code
        )
        .join(' · '),
    [activePanelReferences]
  )
  const hasDecision = Boolean(annotationDraft.final_answer)
  const hasReason = Boolean(String(annotationDraft.why_answer || '').trim())
  const showPanelReferenceTool =
    showReferenceTool || activePanelReferences.length > 0
  const normalizedDraft = React.useMemo(
    () => normalizeAnnotationDraft(annotationDraft),
    [annotationDraft]
  )
  const annotationCompletionState = React.useMemo(
    () => getAnnotationCompletionState(annotationDraft),
    [annotationDraft]
  )
  const annotationCompletionItems = React.useMemo(
    () => [
      {
        key: 'decision',
        label: t('Answer'),
        done: annotationCompletionState.hasDecision,
        detail: annotationCompletionState.hasDecision
          ? formatDecisionLabel(annotationDraft.final_answer, t)
          : t('Choose LEFT, RIGHT, or SKIP'),
      },
      {
        key: 'reason',
        label: t('Reason'),
        done: annotationCompletionState.hasReason,
        detail: annotationCompletionState.hasReason
          ? t('Reason written')
          : t('Add one short concrete reason'),
      },
      {
        key: 'flags',
        label: t('Decision checks'),
        done:
          annotationCompletionState.hasTextDecision &&
          annotationCompletionState.hasSequenceDecision &&
          annotationCompletionState.hasReportDecision &&
          annotationCompletionState.hasReportReason,
        detail: t('{{done}} / 3 answered', {
          done: [
            annotationCompletionState.hasTextDecision,
            annotationCompletionState.hasSequenceDecision,
            annotationCompletionState.hasReportDecision &&
              annotationCompletionState.hasReportReason,
          ].filter(Boolean).length,
        }),
      },
      {
        key: 'confidence',
        label: t('Confidence'),
        done: annotationCompletionState.hasConfidence,
        detail: annotationCompletionState.hasConfidence
          ? t('{{value}} / 5 selected', {
              value: annotationDraft.confidence,
            })
          : t('Choose one level'),
      },
      {
        key: 'captions',
        label: t('Frame notes'),
        done: annotationCompletionState.hasFrameCaptions,
        detail: t('{{count}} / 4 written', {
          count: annotationCompletionState.filledFrameCaptions,
        }),
      },
      {
        key: 'summaries',
        label: t('Story summaries'),
        done: annotationCompletionState.hasStorySummaries,
        detail: annotationCompletionState.hasStorySummaries
          ? t('LEFT and RIGHT written')
          : t('Write both LEFT and RIGHT'),
      },
    ],
    [
      annotationCompletionState.filledFrameCaptions,
      annotationCompletionState.hasConfidence,
      annotationCompletionState.hasDecision,
      annotationCompletionState.hasFrameCaptions,
      annotationCompletionState.hasReason,
      annotationCompletionState.hasReportDecision,
      annotationCompletionState.hasReportReason,
      annotationCompletionState.hasSequenceDecision,
      annotationCompletionState.hasStorySummaries,
      annotationCompletionState.hasTextDecision,
      annotationDraft.confidence,
      annotationDraft.final_answer,
      t,
    ]
  )
  const taskDetailStatusTone = React.useMemo(() => {
    if (annotationCompletionState.isComplete) {
      return 'green'
    }

    if (hasDraftContent(annotationDraft)) {
      return 'orange'
    }

    return 'gray'
  }, [annotationCompletionState.isComplete, annotationDraft])
  const showRequiredDetailSection =
    showAdvancedFields || !annotationCompletionState.requiredDetailComplete
  const currentAiAnnotation = React.useMemo(() => {
    const nextAiAnnotation = normalizeAiAnnotationDraft(
      annotationDraft.ai_annotation
    )

    return isAiAnnotationBoundToTask(nextAiAnnotation, taskDetail)
      ? nextAiAnnotation
      : null
  }, [annotationDraft.ai_annotation, taskDetail])
  const currentAiPanelDescriptions = React.useMemo(
    () =>
      Array.isArray(currentAiAnnotation?.ordered_panel_descriptions)
        ? currentAiAnnotation.ordered_panel_descriptions
        : [],
    [currentAiAnnotation]
  )
  const currentAiPanelText = React.useMemo(
    () =>
      Array.isArray(currentAiAnnotation?.ordered_panel_text)
        ? currentAiAnnotation.ordered_panel_text
        : [],
    [currentAiAnnotation]
  )
  const currentAiFeedbackText = String(
    annotationDraft.ai_annotation_feedback || ''
  ).trim()
  const currentAiReplyDraft = String(
    aiReplyDraftByTaskId[selectedTaskId] || ''
  ).slice(0, developerAiDraftQuestionWindowChars)
  const hasAiReplyDraft = Boolean(currentAiReplyDraft.trim())
  let aiDraftPrimaryActionLabel = t('Ask AI for first draft')

  if (hasAiReplyDraft) {
    aiDraftPrimaryActionLabel = t('Send to AI')
  } else if (currentAiAnnotation) {
    aiDraftPrimaryActionLabel = t('Re-run AI draft')
  }

  const setCurrentAiReplyDraft = React.useCallback(
    (value) => {
      const taskId = String(selectedTaskId || '').trim()

      if (!taskId) {
        return
      }

      setAiReplyDraftByTaskId((current) => ({
        ...current,
        [taskId]: String(value || '').slice(
          0,
          developerAiDraftQuestionWindowChars
        ),
      }))
    },
    [developerAiDraftQuestionWindowChars, selectedTaskId]
  )
  const requestAiAnnotationDraft = React.useCallback(
    async ({triggerMode = 'manual', followUpPrompt = ''} = {}) => {
      const isAutomaticTrigger = triggerMode === 'automatic'
      const trimmedFollowUpPrompt = String(followUpPrompt || '')
        .trim()
        .slice(0, developerAiDraftQuestionWindowChars)

      if (annotationSourceMode !== 'developer') {
        return false
      }

      if (localAi?.enabled !== true) {
        toast({
          render: () => (
            <Toast title={t('Enable local AI first')}>
              {t(
                'The AI draft button uses the local runtime. Turn on Local AI in AI settings, then try again.'
              )}
            </Toast>
          ),
        })
        return false
      }

      if (!global.localAi || typeof global.localAi.chat !== 'function') {
        toast({
          render: () => (
            <Toast title={t('Local AI chat bridge missing')}>
              {t(
                'This build does not expose the Local AI chat bridge yet. Fully restart idena.vibe and try again.'
              )}
            </Toast>
          ),
        })
        return false
      }

      if (aiDraftRuntimeResolution.status === 'unsupported_backend') {
        toast({
          render: () => (
            <Toast title={t('Unsupported local runtime backend')}>
              {aiDraftRuntimeResolution.lastError ||
                t(
                  'The current Local AI backend is not Ollama, so the requested Qwen runtime family cannot be used for AI drafting here.'
                )}
            </Toast>
          ),
        })
        return false
      }

      const requestedRuntimeModel =
        developerRequestedRuntimeVisionModel || developerRequestedRuntimeModel
      if (!requestedRuntimeModel) {
        toast({
          render: () => (
            <Toast title={t('No runtime model selected')}>
              {t(
                'The fixed local Qwen training lane is not configured yet on this desktop profile.'
              )}
            </Toast>
          ),
        })
        return false
      }

      if (
        !aiDraftRuntimeResolution.activeModel &&
        aiDraftRuntimeResolution.status !== 'loading'
      ) {
        toast({
          render: () => (
            <Toast title={t('Requested runtime model is unavailable')}>
              {aiDraftRuntimeResolution.fallbackReason ||
                t(
                  'The requested runtime model is not installed yet. Install it locally, then try again.'
                )}{' '}
              {aiDraftRuntimeResolution.installHint || ''}
            </Toast>
          ),
        })
        return false
      }

      const orderedImages = [...leftPanels, ...rightPanels]
        .map((panel) => panel?.dataUrl)
        .filter(Boolean)

      if (orderedImages.length !== 8) {
        toast({
          render: () => (
            <Toast title={t('Current flip is missing panel images')}>
              {t(
                'The current flip only exposed {{count}} of 8 ordered panel images, so the local AI draft could not start.',
                {
                  count: orderedImages.length,
                }
              )}
            </Toast>
          ),
        })
        return false
      }

      setIsGeneratingAiDraft(true)
      setError('')

      try {
        const bridge = ensureBridge()
        const runtimeStart = await bridge.start({
          baseUrl: localAi?.baseUrl,
          runtimeBackend: localAi?.runtimeBackend,
          runtimeType: localAi?.runtimeType,
          model: requestedRuntimeModel,
          visionModel: requestedRuntimeModel,
          timeoutMs: 10000,
        })

        if (!runtimeStart?.ok) {
          throw new Error(
            String(runtimeStart?.lastError || '').trim() ||
              t(
                'The local AI runtime could not be started for AI draft generation.'
              )
          )
        }

        const modelListResult = await bridge.listModels({
          baseUrl: localAi?.baseUrl,
          runtimeBackend: localAi?.runtimeBackend,
          runtimeType: localAi?.runtimeType,
          timeoutMs: 10000,
        })

        if (modelListResult?.ok) {
          const runtimeResolution = resolveAiDraftRuntimeResolution({
            requestedModel: requestedRuntimeModel,
            availableModels: modelListResult.models,
          })

          setAiDraftRuntimeResolution(runtimeResolution)

          if (!runtimeResolution.activeModel) {
            throw new Error(
              runtimeResolution.fallbackReason ||
                t(
                  'The requested runtime model is not installed yet. Install it locally, then try again.'
                )
            )
          }
        }

        const aiMessages = [
          {
            role: 'system',
            content: buildAiAnnotationSystemPrompt(effectiveDeveloperPrompt),
          },
          {
            role: 'user',
            content: buildAiAnnotationUserPrompt(),
            images: orderedImages,
          },
        ]

        if (trimmedFollowUpPrompt && currentAiAnnotation) {
          aiMessages.push({
            role: 'assistant',
            content: JSON.stringify(currentAiAnnotation, null, 2),
          })
          aiMessages.push({
            role: 'user',
            content: [
              t(
                'Revise the draft using the human correction below. Keep the same JSON schema and return one full updated JSON object only.'
              ),
              `${t('Human correction')}: ${trimmedFollowUpPrompt}`,
            ].join('\n\n'),
          })
        } else if (trimmedFollowUpPrompt) {
          aiMessages.push({
            role: 'user',
            content: [
              t(
                'Apply this extra human instruction while creating the first draft. Keep the same JSON schema and return one full JSON object only.'
              ),
              `${t('Human instruction')}: ${trimmedFollowUpPrompt}`,
            ].join('\n\n'),
          })
        }

        const aiDraftResult = await bridge.chat({
          baseUrl: localAi?.baseUrl,
          runtimeBackend: localAi?.runtimeBackend,
          runtimeType: localAi?.runtimeType,
          model: requestedRuntimeModel,
          visionModel: requestedRuntimeModel,
          timeoutMs: 45000,
          responseFormat: 'json',
          generationOptions: {
            temperature: 0,
            num_ctx:
              developerAiDraftContextWindowTokens > 0
                ? developerAiDraftContextWindowTokens
                : undefined,
            numPredict: developerAiDraftAnswerWindowTokens,
          },
          messages: aiMessages,
        })

        const aiText = String(
          aiDraftResult?.text || aiDraftResult?.content || ''
        ).trim()

        if (!aiDraftResult?.ok || !aiText) {
          throw new Error(
            String(aiDraftResult?.lastError || '').trim() ||
              t(
                'The local AI runtime did not return a usable annotation draft.'
              )
          )
        }

        const aiAnnotation = buildStoredAiAnnotation(
          parseAiAnnotationResponse(aiText),
          aiDraftResult,
          taskDetail
        )

        setAiDraftRuntimeResolution((current) =>
          createAiDraftRuntimeResolution({
            ...current,
            status: 'ready',
            requestedModel: String(
              aiDraftResult?.requestedModel || requestedRuntimeModel
            ).trim(),
            activeModel: String(
              aiDraftResult?.activeModel ||
                aiDraftResult?.model ||
                requestedRuntimeModel
            ).trim(),
            fallbackModel: '',
            fallbackUsed: false,
            fallbackReason: '',
            availableModels: current.availableModels,
            installHint: `ollama pull ${requestedRuntimeModel}`,
            lastError: '',
          })
        )

        setAnnotationDraft((current) => ({
          ...applyAiAnnotationToDraft(current, aiAnnotation),
          ai_annotation_feedback: trimmedFollowUpPrompt,
        }))
        setShowAdvancedFields(
          Boolean(
            aiAnnotation.option_a_summary || aiAnnotation.option_b_summary
          )
        )
        if (!isAutomaticTrigger) {
          toast({
            render: () => (
              <Toast
                title={
                  trimmedFollowUpPrompt
                    ? t('AI draft updated')
                    : t('AI draft applied')
                }
              >
                {trimmedFollowUpPrompt
                  ? t(
                      'The local AI revised this flip draft with {{model}} using your latest correction.',
                      {
                        model:
                          aiDraftResult?.activeModel ||
                          aiDraftResult?.model ||
                          requestedRuntimeModel,
                      }
                    )
                  : t(
                      'The local AI filled a draft for this flip with {{model}}. Review it, edit it, and tell the AI what it got wrong if needed.',
                      {
                        model:
                          aiDraftResult?.activeModel ||
                          aiDraftResult?.model ||
                          requestedRuntimeModel,
                      }
                    )}
              </Toast>
            ),
          })
        }
        return true
      } catch (draftError) {
        const detail = String(
          (draftError && draftError.message) || draftError || ''
        ).trim()
        toast({
          render: () => (
            <Toast
              title={
                isAutomaticTrigger
                  ? t('Automatic AI draft failed')
                  : t('AI draft failed')
              }
            >
              {detail ||
                t(
                  'The local AI runtime could not produce a draft for this flip.'
                )}
            </Toast>
          ),
        })
        return false
      } finally {
        setIsGeneratingAiDraft(false)
      }
    },
    [
      annotationSourceMode,
      effectiveDeveloperPrompt,
      ensureBridge,
      aiDraftRuntimeResolution.fallbackReason,
      aiDraftRuntimeResolution.installHint,
      aiDraftRuntimeResolution.lastError,
      aiDraftRuntimeResolution.activeModel,
      aiDraftRuntimeResolution.status,
      currentAiAnnotation,
      developerAiDraftAnswerWindowTokens,
      developerAiDraftContextWindowTokens,
      developerAiDraftQuestionWindowChars,
      developerRequestedRuntimeModel,
      developerRequestedRuntimeVisionModel,
      leftPanels,
      localAi?.baseUrl,
      localAi?.enabled,
      localAi?.runtimeBackend,
      localAi?.runtimeType,
      rightPanels,
      taskDetail,
      t,
      toast,
    ]
  )
  const rateCurrentAiDraft = React.useCallback((rating) => {
    setAnnotationDraft((current) => ({
      ...current,
      ai_annotation: {
        ...(normalizeAiAnnotationDraft(current.ai_annotation) ||
          createEmptyAiAnnotationDraft()),
        rating,
      },
    }))
  }, [])
  const submitAiChatPrompt = React.useCallback(async () => {
    const trimmedPrompt = String(currentAiReplyDraft || '').trim()
    const ok = await requestAiAnnotationDraft({
      followUpPrompt: trimmedPrompt,
    })

    if (ok) {
      setCurrentAiReplyDraft('')
    }
  }, [currentAiReplyDraft, requestAiAnnotationDraft, setCurrentAiReplyDraft])
  const handleAiChatComposerKeyDown = React.useCallback(
    async (e) => {
      if (
        e.key !== 'Enter' ||
        e.shiftKey ||
        e.altKey ||
        e.ctrlKey ||
        e.metaKey ||
        e.nativeEvent?.isComposing
      ) {
        return
      }

      e.preventDefault()

      if (isGeneratingAiDraft) {
        return
      }

      await submitAiChatPrompt()
    },
    [isGeneratingAiDraft, submitAiChatPrompt]
  )

  React.useEffect(() => {
    lastAutoDraftTaskIdRef.current = ''
  }, [selectedTaskId])

  React.useEffect(() => {
    const activeTaskId = String(taskDetail?.taskId || '').trim()
    const selectedId = String(selectedTaskId || '').trim()
    const loadedTaskDraft = normalizeAnnotationDraft(
      taskDetail?.annotation || {}
    )

    if (
      !isDeveloperMode ||
      !autoTriggerAiDraft ||
      !activeTaskId ||
      activeTaskId !== selectedId ||
      isTaskLoading ||
      isGeneratingAiDraft ||
      lastAutoDraftTaskIdRef.current === activeTaskId ||
      hasDraftContent(loadedTaskDraft) ||
      hasDraftContent(annotationDraft)
    ) {
      return
    }

    lastAutoDraftTaskIdRef.current = activeTaskId
    requestAiAnnotationDraft({triggerMode: 'automatic'})
  }, [
    annotationDraft,
    autoTriggerAiDraft,
    isDeveloperMode,
    isGeneratingAiDraft,
    isTaskLoading,
    requestAiAnnotationDraft,
    selectedTaskId,
    taskDetail?.annotation,
    taskDetail?.taskId,
  ])

  const currentDraftSnapshot = React.useMemo(
    () => JSON.stringify(normalizedDraft),
    [normalizedDraft]
  )
  const currentDraftKey = React.useMemo(
    () =>
      buildAnnotationDraftKey({
        annotationSourceMode,
        epoch,
        demoSampleName,
        demoOffset,
        developerOffset,
        selectedTaskId,
      }),
    [
      annotationSourceMode,
      demoOffset,
      demoSampleName,
      developerOffset,
      epoch,
      selectedTaskId,
    ]
  )
  const taskDraftMatchesSelectedTask = React.useMemo(() => {
    const loadedTaskId = String(taskDetail?.taskId || '').trim()
    const activeTaskId = String(selectedTaskId || '').trim()

    return Boolean(
      loadedTaskId && activeTaskId && loadedTaskId === activeTaskId
    )
  }, [selectedTaskId, taskDetail?.taskId])
  const hasCurrentDraftContent = React.useMemo(
    () => hasDraftContent(annotationDraft),
    [annotationDraft]
  )
  const hasUnsavedDraftChanges = React.useMemo(
    () =>
      Boolean(
        taskDraftMatchesSelectedTask &&
          currentDraftKey &&
          hasCurrentDraftContent &&
          (lastPersistedDraft.key !== currentDraftKey ||
            lastPersistedDraft.snapshot !== currentDraftSnapshot)
      ),
    [
      currentDraftKey,
      currentDraftSnapshot,
      hasCurrentDraftContent,
      lastPersistedDraft,
      taskDraftMatchesSelectedTask,
    ]
  )
  const completionPreview = React.useMemo(
    () =>
      getWorkspaceCountsAfterSave(workspace, selectedTaskId, annotationDraft),
    [annotationDraft, selectedTaskId, workspace]
  )

  const updatePanelReference = React.useCallback((code, nextPatch) => {
    const nextCode = String(code || '')
      .trim()
      .toUpperCase()

    if (!PANEL_REFERENCE_CODES.includes(nextCode)) {
      return
    }

    setAnnotationDraft((current) => {
      const currentReferences = normalizePanelReferences(
        current.panel_references
      )
      const patch =
        typeof nextPatch === 'function'
          ? nextPatch(
              currentReferences.find((reference) => reference.code === nextCode)
            )
          : nextPatch

      return {
        ...current,
        panel_references: normalizePanelReferences(
          currentReferences.map((reference) =>
            reference.code === nextCode
              ? {
                  ...reference,
                  ...(patch && typeof patch === 'object' ? patch : {}),
                }
              : reference
          )
        ),
      }
    })
  }, [])

  const clearPanelReferencePlacement = React.useCallback(
    (code) => {
      updatePanelReference(code, {
        panel_index: null,
        x: null,
        y: null,
      })
    },
    [updatePanelReference]
  )

  const handlePanelReferenceDragStart = React.useCallback((event, code) => {
    event.dataTransfer.setData('text/plain', String(code || ''))
    event.dataTransfer.effectAllowed = 'move'
  }, [])

  const handlePanelReferenceDragOver = React.useCallback(
    (event) => {
      if (!showPanelReferenceTool) {
        return
      }

      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
    },
    [showPanelReferenceTool]
  )

  const handlePanelReferenceDrop = React.useCallback(
    (event, panelIndex) => {
      if (!showPanelReferenceTool) {
        return
      }

      event.preventDefault()

      const code = String(event.dataTransfer.getData('text/plain') || '')
        .trim()
        .toUpperCase()

      if (!PANEL_REFERENCE_CODES.includes(code)) {
        return
      }

      const rect = event.currentTarget.getBoundingClientRect()
      const width = Math.max(rect.width, 1)
      const height = Math.max(rect.height, 1)
      const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / width))
      const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / height))

      updatePanelReference(code, {
        panel_index: Number(panelIndex),
        x,
        y,
      })
    },
    [showPanelReferenceTool, updatePanelReference]
  )

  const saveTaskDraft = React.useCallback(
    async (options = {}) => {
      const {
        advance = false,
        quiet = false,
        promptOnChunkComplete = true,
        autosave = false,
      } = options
      const nextEpoch = String(epoch || '').trim()

      if ((!nextEpoch && annotationSourceMode !== 'demo') || !selectedTaskId) {
        if (!autosave) {
          setError(t('Select a flip before saving annotation notes.'))
        }
        return null
      }

      setIsSavingTask(true)
      if (autosave) {
        setAutosaveMeta((current) => ({
          status: 'saving',
          savedAt: current.savedAt,
          error: '',
        }))
      } else {
        setError('')
      }

      try {
        let nextResult = null

        if (annotationSourceMode === 'developer') {
          nextResult = await ensureBridge().saveHumanTeacherDeveloperDraft({
            sampleName: demoSampleName,
            offset: developerOffset,
            currentPeriod,
            taskId: selectedTaskId,
            annotation: annotationDraft,
          })
        } else if (annotationSourceMode === 'demo') {
          nextResult = await ensureBridge().saveHumanTeacherDemoDraft({
            sampleName: demoSampleName,
            offset: demoOffset,
            taskId: selectedTaskId,
            annotation: annotationDraft,
          })
        } else {
          nextResult = await ensureBridge().saveHumanTeacherAnnotationDraft({
            epoch: nextEpoch,
            currentEpoch,
            taskId: selectedTaskId,
            annotation: annotationDraft,
          })
        }

        const nextStatus = String(
          nextResult?.task?.annotationStatus || 'pending'
        )
        const nextNormalizedDraft = normalizeAnnotationDraft(annotationDraft)
        const nextDraftKey = buildAnnotationDraftKey({
          annotationSourceMode,
          epoch: nextEpoch,
          demoSampleName,
          demoOffset,
          developerOffset,
          selectedTaskId,
        })
        const completionState = getWorkspaceCountsAfterSave(
          workspace,
          selectedTaskId,
          annotationDraft
        )
        setTaskDetail((current) =>
          current
            ? {
                ...current,
                annotation: normalizeAnnotationDraft(annotationDraft),
              }
            : current
        )
        setWorkspace((current) =>
          current
            ? {
                ...current,
                draftedCount: completionState.draftedCount,
                completedCount: completionState.completedCount,
                tasks: current.tasks.map((task) =>
                  task.taskId === selectedTaskId
                    ? {
                        ...task,
                        hasDraft: hasDraftContent(annotationDraft),
                        isComplete: isCompleteDraft(annotationDraft),
                        annotationStatus: nextStatus,
                      }
                    : task
                ),
              }
            : current
        )
        setResult((current) =>
          current
            ? {
                ...current,
                package:
                  annotationSourceMode === 'demo'
                    ? current.package
                    : nextResult.package || current.package,
              }
            : current
        )
        setLastPersistedDraft({
          key: nextDraftKey,
          snapshot: JSON.stringify(nextNormalizedDraft),
        })
        setAutosaveMeta({
          status: 'saved',
          savedAt: new Date().toISOString(),
          error: '',
        })
        const willOpenChunkDecisionDialog =
          promptOnChunkComplete &&
          !nextTaskId &&
          completionState.allComplete &&
          (annotationSourceMode === 'developer' ||
            annotationSourceMode === 'demo')

        if (!quiet) {
          if (
            isCompleteDraft(annotationDraft) &&
            !willOpenChunkDecisionDialog
          ) {
            rewardWithConfetti({particleCount: 70})
          }
          if (!willOpenChunkDecisionDialog) {
            toast({
              title: isCompleteDraft(annotationDraft)
                ? t('Flip saved')
                : t('Flip draft saved'),
              description:
                advance && nextTaskId
                  ? t('Saved. Moving to the next flip.')
                  : t('Your annotation was saved locally.'),
              status: 'success',
              duration: 2500,
              isClosable: true,
            })
          }
        }

        if (advance && nextTaskId) {
          setSelectedTaskId(nextTaskId)
        }

        if (willOpenChunkDecisionDialog) {
          openChunkDecisionDialog(annotationSourceMode)
        }

        return {
          task: nextResult?.task || null,
          completionState,
        }
      } catch (nextError) {
        const message = formatErrorMessage(nextError)

        if (autosave) {
          setAutosaveMeta((current) => ({
            status: 'error',
            savedAt: current.savedAt,
            error: message,
          }))
        } else {
          setError(message)
        }
        return null
      } finally {
        setIsSavingTask(false)
      }
    },
    [
      annotationSourceMode,
      annotationDraft,
      currentEpoch,
      currentPeriod,
      demoSampleName,
      demoOffset,
      developerOffset,
      ensureBridge,
      epoch,
      nextTaskId,
      openChunkDecisionDialog,
      selectedTaskId,
      t,
      toast,
      workspace,
    ]
  )

  const navigateToTask = React.useCallback(
    async (taskId) => {
      const nextTargetTaskId = String(taskId || '').trim()

      if (!nextTargetTaskId || nextTargetTaskId === selectedTaskId) {
        return
      }

      if (hasUnsavedDraftChanges) {
        const saved = await saveTaskDraft({
          quiet: true,
          promptOnChunkComplete: false,
          autosave: true,
        })

        if (!saved) {
          return
        }
      }

      setSelectedTaskId(nextTargetTaskId)
    },
    [hasUnsavedDraftChanges, saveTaskDraft, selectedTaskId]
  )

  const finalizeDeveloperChunk = React.useCallback(
    async ({trainNow = false, advance = false, exitAfter = false} = {}) => {
      const saved = await saveTaskDraft({
        quiet: true,
        promptOnChunkComplete: false,
      })

      if (!saved) {
        return null
      }

      if (!saved.completionState.allComplete) {
        toast({
          title: t('Flip saved'),
          description: exitAfter
            ? t(
                'Your draft was saved. Complete the remaining flips in this 5-flip chunk before training or moving on.'
              )
            : t(
                'Complete all 5 flips in this chunk before training or loading the next chunk.'
              ),
          status: 'info',
          duration: 3500,
          isClosable: true,
        })

        if (exitAfter) {
          router.push('/ai-chat')
        }

        return null
      }

      setIsFinalizingDeveloperChunk(true)
      setError('')

      try {
        const nextResult =
          await ensureBridge().finalizeHumanTeacherDeveloperChunk({
            sampleName: demoSampleName,
            offset: developerOffset,
            currentPeriod,
            trainNow,
            advance,
            trainingModelPath: developerLocalTrainingModelPath,
            localTrainingProfile: developerLocalTrainingProfile,
            localTrainingThermalMode: developerLocalTrainingThermalMode,
            localTrainingEpochs: developerLocalTrainingEpochs,
            localTrainingBatchSize: developerLocalTrainingBatchSize,
            localTrainingLoraRank: developerLocalTrainingLoraRank,
            evaluationFlips: developerLocalBenchmarkSize,
          })
        setDeveloperActionResult(nextResult)
        setDeveloperSessionState(nextResult.state || null)

        if (advance) {
          await loadDeveloperSession({offsetOverride: nextResult.nextOffset})
          toast({
            title: t('Next 5 flips loaded'),
            description: t(
              'The finished chunk was saved locally. You can keep annotating the next 5 flips now.'
            ),
            status: 'success',
            duration: 3500,
            isClosable: true,
          })
          return nextResult
        }

        if (trainNow) {
          const trainingFailureReason =
            nextResult?.state?.lastTraining?.failureReason ||
            extractTrainingFailureReason(nextResult?.training)

          if (nextResult?.training?.ok) {
            const latestAccuracy = nextResult?.state?.comparison100?.accuracy
            const latestCorrect = nextResult?.state?.comparison100?.correct
            const latestTotal = nextResult?.state?.comparison100?.totalFlips
            toast({
              title: t('Training started'),
              description:
                typeof latestAccuracy === 'number'
                  ? t(
                      'This 5-flip chunk was trained locally and is now part of the active model. Latest success rate: {{accuracy}} ({{correct}} / {{total}}).',
                      {
                        accuracy: formatSuccessRate(latestAccuracy),
                        correct: Number(latestCorrect) || 0,
                        total: Number(latestTotal) || 0,
                      }
                    )
                  : t(
                      'This 5-flip chunk is now part of the active local model.'
                    ),
              status: 'success',
              duration: 4500,
              isClosable: true,
            })
          } else {
            toast({
              title: t('Chunk saved for training'),
              description: trainingFailureReason
                ? t(
                    'Your 5 annotated flips were stored locally, but the active local model is unchanged because training failed. Reason: {{reason}}',
                    {
                      reason: trainingFailureReason,
                    }
                  )
                : t(
                    'Your 5 annotated flips were stored locally, but the active local model is unchanged right now because training did not complete yet.'
                  ),
              status: 'warning',
              duration: 5000,
              isClosable: true,
            })
          }
        } else {
          toast({
            title: t('Chunk saved'),
            description: t(
              'These 5 annotated flips were stored locally. You can train later or continue with the next chunk.'
            ),
            status: 'success',
            duration: 3500,
            isClosable: true,
          })
        }

        await loadDeveloperSession({offsetOverride: nextResult.nextOffset})

        if (exitAfter) {
          router.push('/ai-chat')
        }

        return nextResult
      } catch (nextError) {
        setError(formatErrorMessage(nextError))
        return null
      } finally {
        setIsFinalizingDeveloperChunk(false)
      }
    },
    [
      demoSampleName,
      developerLocalBenchmarkSize,
      developerLocalTrainingBatchSize,
      developerLocalTrainingEpochs,
      developerLocalTrainingLoraRank,
      developerLocalTrainingModelPath,
      developerOffset,
      developerLocalTrainingProfile,
      developerLocalTrainingThermalMode,
      ensureBridge,
      currentPeriod,
      loadDeveloperSession,
      router,
      saveTaskDraft,
      t,
      toast,
    ]
  )

  const finalizeDemoChunk = React.useCallback(
    async ({trainNow = false, advance = false, exitAfter = false} = {}) => {
      const saved = await saveTaskDraft({
        quiet: true,
        promptOnChunkComplete: false,
      })

      if (!saved) {
        return null
      }

      if (!saved.completionState.allComplete) {
        toast({
          title: t('Flip saved'),
          description: exitAfter
            ? t(
                'Your demo draft was saved. Complete the remaining flips in this 5-flip chunk before finishing it.'
              )
            : t(
                'Complete all 5 demo flips in this chunk before loading the next chunk.'
              ),
          status: 'info',
          duration: 3500,
          isClosable: true,
        })

        if (exitAfter) {
          router.push('/ai-chat')
        }

        return null
      }

      setIsFinalizingDeveloperChunk(true)
      setError('')

      try {
        const nextResult = await ensureBridge().finalizeHumanTeacherDemoChunk({
          sampleName: demoSampleName,
          offset: demoOffset,
          trainNow,
          advance,
        })
        const loadedNextChunk =
          Number(nextResult.nextOffset) !== Number(nextResult.offset)
        const nextTitle = trainNow
          ? t('Demo chunk finished')
          : t('Next 5 flips loaded')
        let nextDescription = t(
          'These 5 demo flips were stored locally. You can continue later from the same chunk.'
        )

        if (trainNow) {
          nextDescription = loadedNextChunk
            ? t(
                'The completed demo chunk was saved locally. Demo mode does not train the real model, but the next 5 demo flips are ready.'
              )
            : t(
                'The completed demo chunk was saved locally. Demo mode does not train the real model, and there are no further bundled demo flips in this sample.'
              )
        } else if (advance) {
          nextDescription = loadedNextChunk
            ? t(
                'The finished demo chunk was saved locally. You can keep annotating the next 5 demo flips now.'
              )
            : t(
                'The finished demo chunk was saved locally. There are no further bundled demo flips in this sample.'
              )
        }

        setDemoSessionState(nextResult.state || null)
        setDemoOffset(Number(nextResult.nextOffset ?? nextResult.offset) || 0)

        if (trainNow || advance) {
          await loadOfflineDemoWorkspace({
            offsetOverride: nextResult.nextOffset,
          })
          toast({
            title: nextTitle,
            description: nextDescription,
            status: 'success',
            duration: 4000,
            isClosable: true,
          })
        } else {
          toast({
            title: t('Demo chunk saved'),
            description: t(
              'These 5 demo flips were stored locally. You can continue later from the same chunk.'
            ),
            status: 'success',
            duration: 3500,
            isClosable: true,
          })
        }

        if (exitAfter) {
          router.push('/ai-chat')
        }

        return nextResult
      } catch (nextError) {
        setError(formatErrorMessage(nextError))
        return null
      } finally {
        setIsFinalizingDeveloperChunk(false)
      }
    },
    [
      demoOffset,
      demoSampleName,
      ensureBridge,
      loadOfflineDemoWorkspace,
      router,
      saveTaskDraft,
      t,
      toast,
    ]
  )

  const runDeveloperComparison = React.useCallback(async () => {
    setIsRunningDeveloperComparison(true)
    setError('')

    try {
      const nextResult =
        await ensureBridge().runHumanTeacherDeveloperComparison({
          sampleName: demoSampleName,
          currentPeriod,
          evaluationFlips: developerLocalBenchmarkSize,
        })
      setDeveloperActionResult(nextResult)
      setDeveloperSessionState(nextResult.state || null)

      const latestAccuracy = nextResult?.state?.comparison100?.accuracy
      const latestCorrect = nextResult?.state?.comparison100?.correct
      const latestTotal = nextResult?.state?.comparison100?.totalFlips

      toast({
        title: t('{{count}}-flip comparison finished', {
          count: developerLocalBenchmarkSize,
        }),
        description:
          typeof latestAccuracy === 'number'
            ? t(
                'Latest success rate: {{accuracy}} ({{correct}} / {{total}}).',
                {
                  accuracy: formatSuccessRate(latestAccuracy),
                  correct: Number(latestCorrect) || 0,
                  total: Number(latestTotal) || 0,
                }
              )
            : t(
                'The local runtime finished the comparison request, but no accuracy result was returned yet.'
              ),
        status: 'success',
        duration: 4500,
        isClosable: true,
      })

      return nextResult
    } catch (nextError) {
      const message = formatErrorMessage(nextError)
      setError(message)
      toast({
        title: t('{{count}}-flip comparison failed', {
          count: developerLocalBenchmarkSize,
        }),
        description: message,
        status: 'error',
        duration: 5000,
        isClosable: true,
      })
      return null
    } finally {
      setIsRunningDeveloperComparison(false)
    }
  }, [
    currentPeriod,
    demoSampleName,
    developerLocalBenchmarkSize,
    ensureBridge,
    t,
    toast,
  ])

  const importAnnotations = React.useCallback(async () => {
    const nextEpoch = String(epoch || '').trim()

    if (annotationSourceMode === 'demo') {
      setError(
        t(
          'Offline demo annotations are only for testing and are not imported into training data.'
        )
      )
      return
    }

    if (!nextEpoch) {
      setError(t('Enter an epoch before importing annotations.'))
      return
    }

    setIsImporting(true)
    setError('')

    try {
      const nextResult = await ensureBridge().importHumanTeacherAnnotations({
        epoch: nextEpoch,
        currentEpoch,
      })
      setResult(nextResult)
      setImportResult(nextResult.import || null)
      await loadWorkspace()
    } catch (nextError) {
      setImportResult(null)
      setError(formatErrorMessage(nextError))
    } finally {
      setIsImporting(false)
    }
  }, [
    annotationSourceMode,
    currentEpoch,
    ensureBridge,
    epoch,
    loadWorkspace,
    t,
  ])

  const finishAnnotationSet = React.useCallback(async () => {
    const saved = await saveTaskDraft({quiet: true})

    if (!saved) {
      return
    }

    if (annotationSourceMode === 'demo') {
      toast({
        title: t('Demo flip saved'),
        description: saved.completionState.allComplete
          ? t('The demo set is complete. Demo annotations stay local.')
          : t('{{count}} demo flips are still incomplete in this set.', {
              count: saved.completionState.remainingCount,
            }),
        status: 'success',
        duration: 3500,
        isClosable: true,
      })
      return
    }

    if (!saved.completionState.allComplete) {
      toast({
        title: t('Last flip saved'),
        description: t(
          '{{count}} flips are still incomplete before submission.',
          {count: saved.completionState.remainingCount}
        ),
        status: 'info',
        duration: 3500,
        isClosable: true,
      })
      return
    }

    await importAnnotations()
    toast({
      title: t('Annotations submitted'),
      description: t(
        'The completed annotation set was imported for later training ingestion.'
      ),
      status: 'success',
      duration: 3500,
      isClosable: true,
    })
  }, [annotationSourceMode, importAnnotations, saveTaskDraft, t, toast])

  const packageSummary = describeHumanTeacherPackage(t, result)
  const trimmedDeveloperPromptDraft = String(developerPromptDraft || '').trim()
  const developerPromptMatchesSaved =
    trimmedDeveloperPromptDraft === effectiveDeveloperPrompt
  const developerPromptMatchesDefault =
    trimmedDeveloperPromptDraft === DEFAULT_HUMAN_TEACHER_SYSTEM_PROMPT
  const developerPromptApplyLabel = developerPromptMatchesDefault
    ? t('Apply app default prompt')
    : t('Apply custom prompt')
  const reviewStatus = normalizeReviewStatus(result?.package?.reviewStatus)
  const eligibleCount = Number(result?.eligibleCount) || 0
  const importedAnnotations = result?.package?.importedAnnotations || null
  const isDeveloperSourceMode = annotationSourceMode === 'developer'
  const isDemoMode = annotationSourceMode === 'demo'
  const chunkDecisionMode = chunkDecisionDialog.mode
  const contributionDialogMode = contributionDialog.mode
  const contributionDialogTitle = React.useMemo(() => {
    if (contributionDialogMode === 'share') {
      return t('Share annotations with the network')
    }

    if (contributionDialogMode === 'external') {
      return t('Train on external GPU')
    }

    return t('Train AI on this system (not recommended!)')
  }, [contributionDialogMode, t])
  const isChunkDecisionBusy = isSavingTask || isFinalizingDeveloperChunk
  const demoRemainingCount = Number(demoSessionState?.remainingTaskCount) || 0
  const demoCanAdvance =
    isDemoMode &&
    totalTaskCount > 0 &&
    completionPreview.allComplete &&
    demoRemainingCount > 0 &&
    demoOffset + DEVELOPER_TRAINING_CHUNK_SIZE <
      Number(demoSessionState?.totalAvailableTasks || 0)
  const developerPendingCount =
    Number(developerSessionState?.pendingTrainingCount) || 0
  const developerAnnotatedCount =
    Number(developerSessionState?.annotatedCount) || 0
  const developerCanExportContributionBundle = developerAnnotatedCount > 0
  const developerTrainedCount = Number(developerSessionState?.trainedCount) || 0
  const developerRemainingCount =
    Number(developerSessionState?.remainingTaskCount) || 0
  const developerComparison = developerSessionState?.comparison100 || null
  const developerLastTraining = developerSessionState?.lastTraining || null
  const developerSupportsLocalTraining =
    developerSessionState?.supportsLocalTraining !== false
  const developerActiveTrainingModelPath = String(
    developerSessionState?.activeTrainingModelPath || ''
  ).trim()
  const developerActiveTrainingBackend = String(
    developerSessionState?.activeTrainingBackend || ''
  ).trim()
  const developerActiveLocalTrainingProfile = String(
    developerSessionState?.activeLocalTrainingProfile || ''
  ).trim()
  const developerActiveLocalTrainingThermalMode = String(
    developerSessionState?.activeLocalTrainingThermalMode || ''
  ).trim()
  const developerLastTrainingFailureReason =
    developerLastTraining?.failureReason ||
    extractTrainingFailureReason(developerLastTraining?.result)
  const developerLastAttemptedTrainingModelPath = String(
    developerLastTraining?.result?.modelPath || ''
  ).trim()
  const developerLastAttemptedTrainingBackend = String(
    developerLastTraining?.result?.trainingBackend || ''
  ).trim()
  const developerLastAttemptedTrainingProfile = String(
    developerLastTraining?.result?.localTrainingProfile || ''
  ).trim()
  const developerLastAttemptedTrainingThermalMode = String(
    developerLastTraining?.result?.localTrainingThermalMode || ''
  ).trim()
  const developerActiveTrainingProfileSummary = React.useMemo(
    () =>
      developerActiveLocalTrainingProfile
        ? describeDeveloperLocalTrainingProfile(
            developerActiveLocalTrainingProfile,
            t
          )
        : null,
    [developerActiveLocalTrainingProfile, t]
  )
  const developerActiveTrainingThermalSummary = React.useMemo(
    () =>
      developerActiveLocalTrainingThermalMode
        ? describeDeveloperLocalTrainingThermalMode(
            developerActiveLocalTrainingThermalMode,
            t
          )
        : null,
    [developerActiveLocalTrainingThermalMode, t]
  )
  const developerLastAttemptedTrainingProfileSummary = React.useMemo(
    () =>
      developerLastAttemptedTrainingProfile
        ? describeDeveloperLocalTrainingProfile(
            developerLastAttemptedTrainingProfile,
            t
          )
        : null,
    [developerLastAttemptedTrainingProfile, t]
  )
  const developerLastAttemptedTrainingThermalSummary = React.useMemo(
    () =>
      developerLastAttemptedTrainingThermalMode
        ? describeDeveloperLocalTrainingThermalMode(
            developerLastAttemptedTrainingThermalMode,
            t
          )
        : null,
    [developerLastAttemptedTrainingThermalMode, t]
  )
  const developerTrainingUnsupported =
    !developerSupportsLocalTraining &&
    isTrainingUnsupportedReason(developerLastTrainingFailureReason)
  const developerHasLegacyUnsupportedFailure =
    developerSupportsLocalTraining &&
    isTrainingUnsupportedReason(developerLastTrainingFailureReason)
  const developerDisplayedFailureReason = developerHasLegacyUnsupportedFailure
    ? t(
        'A previous attempt failed on the older sidecar-only training path. Local MLX training is available now, so you can retry training or rerun the benchmark.'
      )
    : developerLastTrainingFailureReason
  const developerModelStatus = React.useMemo(() => {
    if (!isDeveloperMode) {
      return null
    }

    const lastTrainingStatus = String(
      developerLastTraining?.status || ''
    ).trim()
    const lastTrainingAt = developerLastTraining?.at || null

    if (lastTrainingStatus === 'failed') {
      if (developerTrainingUnsupported) {
        return {
          tone: 'warning',
          summary: t('Training backend unavailable'),
          title: t('Current local model: training backend unavailable'),
          detail:
            developerTrainedCount > 0
              ? t(
                  'Your latest 5-flip chunk was saved, but this Local AI runtime can currently chat only. The active model still contains only earlier trained flips.'
                )
              : t(
                  'Your 5 annotated flips were saved locally, but this Local AI runtime can currently chat only. The active model is still the untrained baseline.'
                ),
          reason: t(
            'The current Local AI sidecar does not implement local training yet.'
          ),
        }
      }

      return {
        tone: 'error',
        summary: t('Last training failed'),
        title: t('Current local model: latest training did not apply'),
        detail:
          developerTrainedCount > 0
            ? t(
                'The last training attempt failed{{when}}. Your active model still only includes earlier trained flips, and {{count}} newer annotated flips are still waiting to be trained.',
                {
                  when: lastTrainingAt
                    ? ` ${t('at')} ${formatTimestamp(lastTrainingAt)}`
                    : '',
                  count: developerPendingCount,
                }
              )
            : t(
                'The last training attempt failed{{when}}. Your active model is still the untrained baseline, and {{count}} annotated flips are waiting to be trained.',
                {
                  when: lastTrainingAt
                    ? ` ${t('at')} ${formatTimestamp(lastTrainingAt)}`
                    : '',
                  count: developerPendingCount,
                }
              ),
        reason: developerDisplayedFailureReason,
      }
    }

    if (developerPendingCount > 0 && developerTrainedCount > 0) {
      return {
        tone: 'warning',
        summary: t('Model missing latest flips'),
        title: t('Current local model: partially up to date'),
        detail: t(
          'The active local model already includes {{trained}} trained flips, but {{pending}} newer annotated flips are not inside the model yet.',
          {
            trained: developerTrainedCount,
            pending: developerPendingCount,
          }
        ),
      }
    }

    if (developerPendingCount > 0) {
      return {
        tone: 'warning',
        summary: t('Saved but not trained yet'),
        title: t('Current local model: not trained on your annotations yet'),
        detail: t(
          'You have {{pending}} annotated flips saved locally, but the active local model is still unchanged because those flips have not been trained yet.',
          {
            pending: developerPendingCount,
          }
        ),
      }
    }

    if (developerTrainedCount > 0) {
      return {
        tone: 'success',
        summary: t('Up to date'),
        title: t('Current local model: trained and up to date'),
        detail: t(
          'The active local model already includes all {{trained}} human-annotated flips that were trained so far.',
          {
            trained: developerTrainedCount,
          }
        ),
      }
    }

    if (developerAnnotatedCount > 0) {
      return {
        tone: 'info',
        summary: t('No confirmed training yet'),
        title: t('Current local model: no confirmed training yet'),
        detail: t(
          'You already saved human annotations, but there is no confirmed local training run yet. Until training succeeds, the active model stays unchanged.'
        ),
      }
    }

    return {
      tone: 'info',
      summary: t('Baseline model'),
      title: t('Current local model: baseline'),
      detail: t(
        'No human-teacher flips have been trained into the active local model yet.'
      ),
    }
  }, [
    developerAnnotatedCount,
    developerDisplayedFailureReason,
    developerLastTraining?.at,
    developerLastTraining?.status,
    developerPendingCount,
    developerTrainingUnsupported,
    developerTrainedCount,
    isDeveloperMode,
    t,
  ])
  const developerActiveModelLabel = React.useMemo(() => {
    if (developerActiveTrainingModelPath) {
      return developerActiveTrainingModelPath
    }

    if (developerTrainedCount > 0) {
      return t('Unknown older trained model')
    }

    return t('Baseline only')
  }, [developerActiveTrainingModelPath, developerTrainedCount, t])
  const developerLastFailedAttemptUsesDifferentModel = Boolean(
    developerLastTraining?.status === 'failed' &&
      developerLastAttemptedTrainingModelPath &&
      developerLastAttemptedTrainingModelPath !==
        developerActiveTrainingModelPath
  )
  const developerComparisonHistory = Array.isArray(developerComparison?.history)
    ? developerComparison.history
    : []
  const developerComparisonHistoryForSelectedBenchmark =
    developerComparisonHistory.filter(
      (entry) =>
        Number.parseInt(entry?.totalFlips, 10) === developerLocalBenchmarkSize
    )
  const latestDeveloperComparison =
    developerComparisonHistoryForSelectedBenchmark[0] || null
  const previousDeveloperComparison =
    developerComparisonHistoryForSelectedBenchmark[1] || null
  const developerBestAccuracy =
    developerComparisonHistoryForSelectedBenchmark.some(
      (entry) => typeof entry?.accuracy === 'number'
    )
      ? developerComparisonHistoryForSelectedBenchmark.reduce((best, entry) => {
          if (typeof entry?.accuracy !== 'number') {
            return best
          }

          return best === null ? entry.accuracy : Math.max(best, entry.accuracy)
        }, null)
      : latestDeveloperComparison?.accuracy ?? null
  const developerComparisonStatus = String(
    latestDeveloperComparison?.status ||
      (Number.parseInt(developerComparison?.benchmarkFlips, 10) ===
      developerLocalBenchmarkSize
        ? developerComparison?.status
        : '') ||
      (isRunningDeveloperComparison ? 'running' : 'not_loaded')
  ).trim()
  const developerAccuracyDelta =
    latestDeveloperComparison &&
    previousDeveloperComparison &&
    typeof latestDeveloperComparison.accuracy === 'number' &&
    typeof previousDeveloperComparison.accuracy === 'number'
      ? latestDeveloperComparison.accuracy -
        previousDeveloperComparison.accuracy
      : null
  const developerCanRunComparison =
    isDeveloperMode &&
    developerSupportsLocalTraining &&
    (developerTrainedCount > 0 || developerPendingCount > 0) &&
    !isRunningDeveloperComparison
  const developerCanAdvance =
    isDeveloperMode &&
    totalTaskCount > 0 &&
    completionPreview.allComplete &&
    developerRemainingCount > 0 &&
    developerOffset + DEVELOPER_TRAINING_CHUNK_SIZE <
      Number(developerSessionState?.totalAvailableTasks || 0)
  const developerModelStatusBorderColor = React.useMemo(() => {
    switch (developerModelStatus?.tone) {
      case 'success':
        return 'green.100'
      case 'error':
        return 'red.100'
      case 'warning':
        return 'orange.100'
      default:
        return 'blue.100'
    }
  }, [developerModelStatus?.tone])
  const developerModelStatusBackground = React.useMemo(() => {
    switch (developerModelStatus?.tone) {
      case 'success':
        return 'green.50'
      case 'error':
        return 'red.50'
      case 'warning':
        return 'orange.50'
      default:
        return 'blue.50'
    }
  }, [developerModelStatus?.tone])
  const savePrimaryLabel = nextTaskId ? t('Save and next flip') : t('Save flip')
  const saveDraftLabel = t('Save flip draft')
  const autosaveStatusText = React.useMemo(() => {
    if (autosaveMeta.status === 'saving') {
      return t('Saving draft automatically…')
    }

    if (autosaveMeta.status === 'saved' && autosaveMeta.savedAt) {
      return t(
        'Draft autosaved at {{time}}. It will also try to save when you switch flips or leave this page.',
        {
          time: formatTimestamp(autosaveMeta.savedAt),
        }
      )
    }

    if (autosaveMeta.status === 'error') {
      return t(
        'Automatic draft save failed. Use “Save flip draft” before leaving this page. {{error}}',
        {
          error: autosaveMeta.error,
        }
      )
    }

    return t('Drafts autosave while you work and when you switch flips.')
  }, [autosaveMeta.error, autosaveMeta.savedAt, autosaveMeta.status, t])
  const finishButtonLabel = React.useMemo(() => {
    if (isDeveloperSourceMode) {
      if (nextTaskId) {
        return t('Save and next flip')
      }

      return t('Save and choose next step')
    }

    if (nextTaskId) {
      return t('Save and next flip')
    }

    if (isDemoMode) {
      return t('Save and choose next step')
    }

    return t('Save and submit set')
  }, [isDemoMode, isDeveloperSourceMode, nextTaskId, t])
  const finalFlipHint = React.useMemo(() => {
    if (isDeveloperSourceMode) {
      if (developerCanAdvance) {
        return t(
          'This 5-flip chunk is complete. Saving this flip will open the next-step dialog so you can train now or load the next 5 flips.'
        )
      }

      return t(
        'This 5-flip chunk is complete. Saving this flip will open the next-step dialog so you can train now or save and come back later.'
      )
    }

    if (isDemoMode) {
      if (demoCanAdvance) {
        return t(
          'This 5-flip demo chunk is complete. Saving this flip will open the next-step dialog so you can continue with the next 5 demo flips.'
        )
      }

      return t(
        'This 5-flip demo chunk is complete. Saving this flip will open the next-step dialog so you can close it now or keep working later.'
      )
    }

    if (completionPreview.allComplete) {
      return t(
        'This is the last flip in the current queue. Save it here and the completed set will be submitted automatically.'
      )
    }

    return t(
      'This is the last flip in the current queue. Save it here first; {{count}} flips are still incomplete before submission.',
      {count: completionPreview.remainingCount}
    )
  }, [
    completionPreview.allComplete,
    completionPreview.remainingCount,
    demoCanAdvance,
    developerCanAdvance,
    isDeveloperSourceMode,
    isDemoMode,
    t,
  ])

  React.useEffect(() => {
    if (selectedTaskId) {
      loadTask(selectedTaskId)
    } else {
      setTaskDetail(null)
      setAnnotationDraft(createEmptyAnnotationDraft())
      setLastPersistedDraft({key: '', snapshot: ''})
      setAutosaveMeta({
        status: 'idle',
        savedAt: null,
        error: '',
      })
    }
  }, [loadTask, selectedTaskId])

  React.useEffect(() => {
    shouldFlushAutosaveRef.current =
      hasUnsavedDraftChanges &&
      !isSavingTask &&
      !isTaskLoading &&
      !isFinalizingDeveloperChunk
  }, [
    hasUnsavedDraftChanges,
    isFinalizingDeveloperChunk,
    isSavingTask,
    isTaskLoading,
  ])

  React.useEffect(() => {
    if (
      !hasUnsavedDraftChanges ||
      isSavingTask ||
      isTaskLoading ||
      isFinalizingDeveloperChunk ||
      chunkDecisionDialog.isOpen
    ) {
      return undefined
    }

    const timerId = window.setTimeout(() => {
      saveTaskDraft({
        quiet: true,
        promptOnChunkComplete: false,
        autosave: true,
      }).catch(() => {})
    }, AUTO_SAVE_DELAY_MS)

    return () => {
      window.clearTimeout(timerId)
    }
  }, [
    chunkDecisionDialog.isOpen,
    hasUnsavedDraftChanges,
    isFinalizingDeveloperChunk,
    isSavingTask,
    isTaskLoading,
    saveTaskDraft,
  ])

  React.useEffect(() => {
    const flushAutosave = () => {
      if (!shouldFlushAutosaveRef.current) {
        return
      }

      saveTaskDraft({
        quiet: true,
        promptOnChunkComplete: false,
        autosave: true,
      }).catch(() => {})
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushAutosave()
      }
    }

    window.addEventListener('pagehide', flushAutosave)
    window.addEventListener('beforeunload', flushAutosave)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    router.events.on('routeChangeStart', flushAutosave)

    return () => {
      window.removeEventListener('pagehide', flushAutosave)
      window.removeEventListener('beforeunload', flushAutosave)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      router.events.off('routeChangeStart', flushAutosave)
    }
  }, [router.events, saveTaskDraft])

  React.useEffect(() => {
    const nextEpoch = String(epoch || '').trim()
    const autoStartKey = `${
      isDeveloperMode ? 'developer' : nextEpoch
    }:${queryAction}:${demoSampleName}`

    if (isDeveloperMode) {
      if (queryAction !== 'start') {
        return
      }

      if (autoStartKeyRef.current === autoStartKey) {
        return
      }

      autoStartKeyRef.current = autoStartKey
      loadDeveloperSession()
      return
    }

    if (queryAction === 'demo') {
      if (autoStartKeyRef.current === autoStartKey) {
        return
      }

      autoStartKeyRef.current = autoStartKey
      loadOfflineDemoWorkspace()
      return
    }

    if (!nextEpoch || queryAction !== 'start') {
      return
    }

    if (autoStartKeyRef.current === autoStartKey) {
      return
    }

    autoStartKeyRef.current = autoStartKey
    startAnnotationFlow()
  }, [
    demoSampleName,
    epoch,
    isDeveloperMode,
    loadDeveloperSession,
    loadOfflineDemoWorkspace,
    queryAction,
    startAnnotationFlow,
  ])

  const handleSaveAndExit = React.useCallback(async () => {
    if (isDeveloperSourceMode) {
      await finalizeDeveloperChunk({exitAfter: true})
      return
    }

    if (isDemoMode) {
      await finalizeDemoChunk({exitAfter: true})
      return
    }

    const saved = await saveTaskDraft()

    if (saved) {
      router.push('/settings/ai')
    }
  }, [
    finalizeDemoChunk,
    finalizeDeveloperChunk,
    isDemoMode,
    isDeveloperSourceMode,
    router,
    saveTaskDraft,
  ])

  const handleChunkDecisionAction = React.useCallback(
    async (action) => {
      const mode = chunkDecisionMode
      let nextResult = null

      if (mode === 'developer') {
        if (action === 'train') {
          nextResult = await finalizeDeveloperChunk({trainNow: true})
        } else if (action === 'advance') {
          nextResult = await finalizeDeveloperChunk({advance: true})
        } else if (action === 'exit') {
          nextResult = await finalizeDeveloperChunk({exitAfter: true})
        }
      } else if (mode === 'demo') {
        if (action === 'train') {
          nextResult = await finalizeDemoChunk({trainNow: true})
        } else if (action === 'advance') {
          nextResult = await finalizeDemoChunk({advance: true})
        } else if (action === 'exit') {
          nextResult = await finalizeDemoChunk({exitAfter: true})
        }
      }

      if (nextResult || action === 'exit') {
        closeChunkDecisionDialog()
      }
    },
    [
      chunkDecisionMode,
      closeChunkDecisionDialog,
      finalizeDemoChunk,
      finalizeDeveloperChunk,
    ]
  )

  return (
    <SettingsLayout>
      <Stack spacing={8} mt={8} maxW="3xl">
        <SettingsSection
          title={
            isDeveloperMode
              ? t('Train your AI on flips')
              : t('Human teacher loop')
          }
        >
          <Stack spacing={4}>
            {isDeveloperMode ? (
              <>
                <Alert status="info" borderRadius="md">
                  <Stack spacing={2}>
                    <Text fontWeight={600}>{t('Developer flip training')}</Text>
                    <Text fontSize="sm">
                      {t(
                        'This mode uses a bundled FLIP dataset sample inside the app. You annotate 5 flips at a time, then either train your AI immediately or load the next 5 flips.'
                      )}
                    </Text>
                    <Text fontSize="sm">
                      {t(
                        'Annotated flips are stored locally with a record of which ones were already used for training. This is separate from the real post-session human-teacher loop.'
                      )}
                    </Text>
                  </Stack>
                </Alert>

                <Box
                  borderWidth="1px"
                  borderColor="gray.100"
                  borderRadius="md"
                  p={4}
                >
                  <Stack spacing={3}>
                    <Box>
                      <Text fontWeight={600}>
                        {t('Developer training prompt')}
                      </Text>
                      <Text color="muted" fontSize="sm">
                        {hasCustomDeveloperPrompt
                          ? t(
                              'A custom human-teacher system prompt is active for developer training.'
                            )
                          : t(
                              'Developer training is currently using the app default human-teacher system prompt.'
                            )}
                      </Text>
                    </Box>

                    <Stack isInline spacing={3} flexWrap="wrap">
                      {!isPromptToolsOpen ? (
                        <SecondaryButton onClick={openPromptTools}>
                          {t('Open prompt tools')}
                        </SecondaryButton>
                      ) : (
                        <>
                          {!isPromptEditingUnlocked ? (
                            <PrimaryButton onClick={unlockPromptEditing}>
                              {t('Unlock prompt editing')}
                            </PrimaryButton>
                          ) : null}
                          <SecondaryButton onClick={closePromptTools}>
                            {t('Close prompt tools')}
                          </SecondaryButton>
                        </>
                      )}
                    </Stack>

                    {isPromptToolsOpen ? (
                      <Box
                        borderWidth="1px"
                        borderColor="gray.50"
                        borderRadius="md"
                        bg="gray.50"
                        p={3}
                      >
                        <Stack spacing={3}>
                          <Text fontSize="sm" color="muted">
                            {isPromptEditingUnlocked
                              ? t(
                                  'Editing is unlocked. Changes only apply after you explicitly save them.'
                                )
                              : t(
                                  'Prompt tools are open in safe mode. Unlock editing before changing the training prompt.'
                                )}
                          </Text>

                          <Textarea
                            value={developerPromptDraft}
                            onChange={(e) =>
                              setDeveloperPromptDraft(e.target.value)
                            }
                            minH="180px"
                            isDisabled={!isPromptEditingUnlocked}
                            fontSize="sm"
                          />

                          <Text fontSize="sm" color="muted">
                            {hasCustomDeveloperPrompt
                              ? t(
                                  'Current source: custom prompt. Reset is intentionally hidden behind an extra step.'
                                )
                              : t('Current source: app default prompt.')}
                          </Text>

                          {isPromptEditingUnlocked ? (
                            <Stack isInline spacing={3} flexWrap="wrap">
                              <PrimaryButton
                                onClick={applyDeveloperPrompt}
                                isDisabled={
                                  !trimmedDeveloperPromptDraft ||
                                  developerPromptMatchesSaved
                                }
                              >
                                {developerPromptApplyLabel}
                              </PrimaryButton>
                              <SecondaryButton
                                onClick={() =>
                                  setDeveloperPromptDraft(
                                    effectiveDeveloperPrompt
                                  )
                                }
                                isDisabled={developerPromptMatchesSaved}
                              >
                                {t('Revert draft')}
                              </SecondaryButton>
                              {hasCustomDeveloperPrompt &&
                              showPromptResetConfirm ? (
                                <SecondaryButton
                                  onClick={resetDeveloperPromptToDefault}
                                >
                                  {t('Reset to app default')}
                                </SecondaryButton>
                              ) : null}
                              {hasCustomDeveloperPrompt &&
                              !showPromptResetConfirm ? (
                                <SecondaryButton
                                  onClick={() =>
                                    setShowPromptResetConfirm(true)
                                  }
                                >
                                  {t('Reveal reset option')}
                                </SecondaryButton>
                              ) : null}
                            </Stack>
                          ) : null}
                        </Stack>
                      </Box>
                    ) : null}
                  </Stack>
                </Box>

                <Stack isInline spacing={3} align="end" flexWrap="wrap">
                  <Box minW="280px">
                    <Text fontSize="sm" fontWeight={500} mb={1}>
                      {t('Training sample')}
                    </Text>
                    <Select
                      value={demoSampleName}
                      onChange={(e) => setDemoSampleName(e.target.value)}
                    >
                      {DEVELOPER_TRAINING_SAMPLE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  </Box>
                  <PrimaryButton
                    isDisabled={isWorkspaceLoading}
                    isLoading={isWorkspaceLoading}
                    onClick={() => loadDeveloperSession()}
                  >
                    {workspace && isDeveloperSourceMode
                      ? t('Resume current 5 flips')
                      : t('Start training your AI')}
                  </PrimaryButton>
                  <SecondaryButton onClick={() => router.push('/ai-chat')}>
                    {t('Back to idena.vibe')}
                  </SecondaryButton>
                </Stack>

                <Box
                  borderWidth="1px"
                  borderColor="gray.100"
                  borderRadius="md"
                  p={4}
                >
                  <Stack spacing={4}>
                    <Box>
                      <Text fontWeight={600}>
                        {t('What do you want to do with your annotations?')}
                      </Text>
                      <Text color="muted" fontSize="sm">
                        {t(
                          'Choose whether to keep future network-sharing consent, export a provider-neutral external GPU bundle, or keep using small local pilot training on this system.'
                        )}
                      </Text>
                    </Box>

                    <SimpleGrid columns={[1, 1, 3]} spacing={3}>
                      <Box
                        borderWidth="1px"
                        borderColor="green.100"
                        borderRadius="md"
                        p={3}
                        bg="green.50"
                      >
                        <Stack spacing={3} h="full">
                          <Box>
                            <Text fontWeight={700}>
                              {t('Share annotations with the network')}
                            </Text>
                            <Text color="muted" fontSize="sm" mt={1}>
                              {t(
                                'One click stores your consent locally today so a later P2P sharing and cross-check flow can reuse it.'
                              )}
                            </Text>
                          </Box>
                          <Text color="muted" fontSize="xs">
                            {shareHumanTeacherAnnotationsWithNetwork
                              ? t(
                                  'Current status: sharing consent is already stored on this desktop profile.'
                                )
                              : t(
                                  'Current status: no sharing consent stored yet.'
                                )}
                          </Text>
                          <SecondaryButton
                            mt="auto"
                            onClick={enableAnnotationSharing}
                          >
                            {shareHumanTeacherAnnotationsWithNetwork
                              ? t('Review sharing consent')
                              : t('Allow annotation sharing')}
                          </SecondaryButton>
                        </Stack>
                      </Box>

                      <Box
                        borderWidth="1px"
                        borderColor="blue.100"
                        borderRadius="md"
                        p={3}
                        bg="blue.50"
                      >
                        <Stack spacing={3} h="full">
                          <Box>
                            <Text fontWeight={700}>
                              {t('Train on external GPU')}
                            </Text>
                            <Text color="muted" fontSize="sm" mt={1}>
                              {t(
                                'Recommended for serious runs. The app exports one provider-neutral bundle and opens a simple FAQ right away.'
                              )}
                            </Text>
                          </Box>
                          <Text color="muted" fontSize="xs">
                            {t(
                              'Use this when you want heavier training without heating up this machine.'
                            )}
                          </Text>
                          <PrimaryButton
                            mt="auto"
                            isDisabled={!developerCanExportContributionBundle}
                            isLoading={isExportingContributionBundle}
                            onClick={exportExternalTrainingBundle}
                          >
                            {t('Export external training bundle')}
                          </PrimaryButton>
                        </Stack>
                      </Box>

                      <Box
                        borderWidth="1px"
                        borderColor="orange.100"
                        borderRadius="md"
                        p={3}
                        bg="orange.50"
                      >
                        <Stack spacing={3} h="full">
                          <Box>
                            <Text fontWeight={700}>
                              {t('Train AI on this system (not recommended!)')}
                            </Text>
                            <Text color="muted" fontSize="sm" mt={1}>
                              {t(
                                'Small local chunks are still useful, but this path should stay a personal pilot path instead of the main scaling path.'
                              )}
                            </Text>
                          </Box>
                          <Stack spacing={1}>
                            <Text color="muted" fontSize="xs">
                              {t('Possible for small local experiments')}
                            </Text>
                            <Text color="muted" fontSize="xs">
                              {t(
                                'Not recommended for long or large training runs'
                              )}
                            </Text>
                            <Text color="muted" fontSize="xs">
                              {t('Creates heavy heat and power draw')}
                            </Text>
                            <Text color="muted" fontSize="xs">
                              {t('Can reduce battery health on laptops')}
                            </Text>
                            <Text color="muted" fontSize="xs">
                              {t(
                                'Use a dedicated training machine or external GPU for serious training'
                              )}
                            </Text>
                          </Stack>
                          <SecondaryButton
                            mt="auto"
                            onClick={openLocalPilotTrainingDialog}
                          >
                            {t('Review local pilot training')}
                          </SecondaryButton>
                        </Stack>
                      </Box>
                    </SimpleGrid>
                  </Stack>
                </Box>

                <LocalTrainingImpactPanel
                  telemetry={developerTelemetry}
                  telemetryError={developerTelemetryError}
                  thermalSummary={developerLocalTrainingThermalSummary}
                  isBusy={developerTelemetryIsBusy}
                  t={t}
                />
                <LocalTrainingJourneyPanel
                  title={t('Local training at a glance')}
                  subtitle={t(
                    'The loop is always the same: answer 5 flips, let the computer practice on them, then check whether the score on unseen flips changed.'
                  )}
                  chunkCompletedCount={Number(workspace?.completedCount) || 0}
                  chunkTotalCount={totalTaskCount}
                  pendingCount={developerPendingCount}
                  annotatedCount={developerAnnotatedCount}
                  trainedCount={developerTrainedCount}
                  latestComparison={latestDeveloperComparison}
                  benchmarkSize={developerLocalBenchmarkSize}
                  canRunLocalTraining={developerSupportsLocalTraining}
                  isTrainingActive={isFinalizingDeveloperChunk}
                  isComparisonActive={isRunningDeveloperComparison}
                  lastTraining={developerLastTraining}
                  totalUpdates={developerLocalTrainingTotalUpdates}
                  coolingFloorMs={developerLocalTrainingCoolingFloorMs}
                  epochs={developerLocalTrainingEpochs}
                  batchSize={developerLocalTrainingBatchSize}
                  loraRank={developerLocalTrainingLoraRank}
                  t={t}
                />

                <Box
                  ref={localPilotTrainingRef}
                  borderWidth="1px"
                  borderColor="gray.100"
                  borderRadius="md"
                  p={4}
                >
                  <Stack spacing={2}>
                    <Text fontWeight={600}>
                      {workspace && isDeveloperSourceMode
                        ? t('5-flip chunk ready')
                        : t('No active 5-flip chunk yet')}
                    </Text>
                    <Text color="muted" fontSize="sm">
                      {workspace && isDeveloperSourceMode
                        ? t(
                            'Current chunk: flips {{from}}-{{to}} out of {{total}}.',
                            {
                              from: developerOffset + 1,
                              to: Math.min(
                                developerOffset + totalTaskCount,
                                Number(
                                  developerSessionState?.totalAvailableTasks ||
                                    0
                                )
                              ),
                              total:
                                Number(
                                  developerSessionState?.totalAvailableTasks ||
                                    0
                                ) || totalTaskCount,
                            }
                          )
                        : t(
                            'Click "Start training your AI" to open the next 5 flips from the bundled FLIP developer sample.'
                          )}
                    </Text>
                    <SimpleGrid columns={[1, 2, 4]} spacing={3}>
                      <Box
                        borderWidth="1px"
                        borderColor="gray.100"
                        borderRadius="md"
                        px={3}
                        py={2}
                        bg="gray.50"
                      >
                        <Text color="muted" fontSize="xs">
                          {t('Model state')}
                        </Text>
                        <Text fontWeight={700}>
                          {developerModelStatus?.summary || t('Baseline model')}
                        </Text>
                        <Text color="muted" fontSize="xs">
                          {t('What the computer is using right now.')}
                        </Text>
                      </Box>
                      <Box
                        borderWidth="1px"
                        borderColor="gray.100"
                        borderRadius="md"
                        px={3}
                        py={2}
                        bg="gray.50"
                      >
                        <Text color="muted" fontSize="xs">
                          {t('Saved answers')}
                        </Text>
                        <Text fontWeight={700}>{developerAnnotatedCount}</Text>
                        <Text color="muted" fontSize="xs">
                          {t('Flips you already labeled.')}
                        </Text>
                      </Box>
                      <Box
                        borderWidth="1px"
                        borderColor="gray.100"
                        borderRadius="md"
                        px={3}
                        py={2}
                        bg="gray.50"
                      >
                        <Text color="muted" fontSize="xs">
                          {t('Waiting to learn')}
                        </Text>
                        <Text fontWeight={700}>{developerPendingCount}</Text>
                        <Text color="muted" fontSize="xs">
                          {t('Saved flips not inside the model yet.')}
                        </Text>
                      </Box>
                      <Box
                        borderWidth="1px"
                        borderColor="gray.100"
                        borderRadius="md"
                        px={3}
                        py={2}
                        bg="gray.50"
                      >
                        <Text color="muted" fontSize="xs">
                          {t('Already learned')}
                        </Text>
                        <Text fontWeight={700}>{developerTrainedCount}</Text>
                        <Text color="muted" fontSize="xs">
                          {t('Flips already trained into the active model.')}
                        </Text>
                      </Box>
                    </SimpleGrid>
                    {isFinalizingDeveloperChunk ? (
                      <Box
                        borderWidth="1px"
                        borderColor="blue.100"
                        borderRadius="md"
                        px={3}
                        py={3}
                        bg="blue.50"
                      >
                        <Stack spacing={2}>
                          <Text fontWeight={600}>
                            {t('Training request running')}
                          </Text>
                          <Progress
                            size="sm"
                            isIndeterminate
                            colorScheme="blue"
                          />
                          <Text color="muted" fontSize="sm">
                            {t(
                              'The app is trying to train this 5-flip chunk locally. The active model stays unchanged until this finishes successfully.'
                            )}
                          </Text>
                        </Stack>
                      </Box>
                    ) : null}
                    {isRunningDeveloperComparison ? (
                      <Box
                        borderWidth="1px"
                        borderColor="purple.100"
                        borderRadius="md"
                        px={3}
                        py={3}
                        bg="purple.50"
                      >
                        <Stack spacing={2}>
                          <Text fontWeight={600}>
                            {t('{{count}}-flip comparison running', {
                              count: developerLocalBenchmarkSize,
                            })}
                          </Text>
                          <Progress
                            size="sm"
                            isIndeterminate
                            colorScheme="purple"
                          />
                          <Text color="muted" fontSize="sm">
                            {t(
                              'The app is checking the latest local model against the same {{count}}-flip validation holdout used for earlier runs at this size.',
                              {
                                count: developerLocalBenchmarkSize,
                              }
                            )}
                          </Text>
                        </Stack>
                      </Box>
                    ) : null}
                    {developerModelStatus ? (
                      <Box
                        borderWidth="1px"
                        borderColor={developerModelStatusBorderColor}
                        borderRadius="md"
                        px={4}
                        py={3}
                        bg={developerModelStatusBackground}
                      >
                        <Stack spacing={2}>
                          <Flex
                            justify="space-between"
                            align={['flex-start', 'center']}
                            direction={['column', 'row']}
                            gap={2}
                          >
                            <Stack spacing={1}>
                              <Text fontSize="sm" fontWeight={700}>
                                {developerModelStatus.summary}
                              </Text>
                              <Text fontSize="sm">
                                {developerModelStatus.detail}
                              </Text>
                            </Stack>
                            {developerLastTraining?.at ? (
                              <Text color="muted" fontSize="xs">
                                {formatTimestamp(developerLastTraining.at)}
                              </Text>
                            ) : null}
                          </Flex>
                          {developerLastTraining?.status ? (
                            <Text color="muted" fontSize="xs">
                              {t('Last training status')}:{' '}
                              {developerLastTraining.status}
                            </Text>
                          ) : null}
                          {developerLastFailedAttemptUsesDifferentModel ? (
                            <Text color="muted" fontSize="xs">
                              {t('Last failed attempt used')}:{' '}
                              {developerLastAttemptedTrainingModelPath}
                              {[
                                developerLastAttemptedTrainingProfileSummary?.label ||
                                  '',
                                developerLastAttemptedTrainingThermalSummary?.label ||
                                  '',
                                developerLastAttemptedTrainingBackend || '',
                              ].filter(Boolean).length
                                ? ` · ${[
                                    developerLastAttemptedTrainingProfileSummary?.label ||
                                      '',
                                    developerLastAttemptedTrainingThermalSummary?.label ||
                                      '',
                                    developerLastAttemptedTrainingBackend || '',
                                  ]
                                    .filter(Boolean)
                                    .join(' · ')}`
                                : ''}
                            </Text>
                          ) : null}
                        </Stack>
                      </Box>
                    ) : null}
                    {developerModelStatus?.reason ? (
                      <Box
                        borderWidth="1px"
                        borderColor="red.100"
                        borderRadius="md"
                        px={4}
                        py={3}
                        bg="red.50"
                      >
                        <Stack spacing={1}>
                          <Text fontSize="sm" fontWeight={700}>
                            {t('Why the last training stopped')}
                          </Text>
                          <Text fontSize="sm">
                            {developerModelStatus.reason}
                          </Text>
                        </Stack>
                      </Box>
                    ) : null}
                    <SimpleGrid columns={[1, 3]} spacing={3}>
                      <Box
                        borderWidth="1px"
                        borderColor="gray.100"
                        borderRadius="md"
                        px={3}
                        py={2}
                      >
                        <Text color="muted" fontSize="xs">
                          {t('Draft runtime model')}
                        </Text>
                        <Text fontWeight={700}>
                          {localDraftActiveRuntimeModelLabel}
                        </Text>
                        <Text color="muted" fontSize="xs">
                          {t('Requested')}:{' '}
                          {localDraftRequestedRuntimeModelLabel}
                        </Text>
                        <Text color="muted" fontSize="xs">
                          {t(
                            'This local draft path is locked to the requested Qwen3.5 runtime. If that model is missing, drafting should stop instead of silently switching to an older runtime.'
                          )}
                        </Text>
                      </Box>
                      <Box
                        borderWidth="1px"
                        borderColor="gray.100"
                        borderRadius="md"
                        px={3}
                        py={2}
                      >
                        <Text color="muted" fontSize="xs">
                          {t('Active trained model')}
                        </Text>
                        <Text fontWeight={700}>
                          {developerActiveModelLabel}
                        </Text>
                        {(developerActiveTrainingProfileSummary ||
                          developerActiveTrainingThermalSummary ||
                          developerActiveTrainingBackend) && (
                          <Text color="muted" fontSize="xs">
                            {[
                              developerActiveTrainingProfileSummary?.label ||
                                '',
                              developerActiveTrainingThermalSummary?.label ||
                                '',
                              developerActiveTrainingBackend || '',
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </Text>
                        )}
                      </Box>
                      <Box
                        borderWidth="1px"
                        borderColor="gray.100"
                        borderRadius="md"
                        px={3}
                        py={2}
                      >
                        <Text color="muted" fontSize="xs">
                          {t('Next training model')}
                        </Text>
                        <Text fontWeight={700}>
                          {developerLocalTrainingModelPath}
                        </Text>
                        <Text color="muted" fontSize="xs">
                          {developerLocalTrainingProfileSummary.label}
                        </Text>
                        <Text color="muted" fontSize="xs">
                          {developerLocalTrainingThermalSummary.label}
                        </Text>
                      </Box>
                    </SimpleGrid>
                    <SimpleGrid columns={[1, 3]} spacing={3}>
                      <Box
                        borderWidth="1px"
                        borderColor="gray.100"
                        borderRadius="md"
                        px={3}
                        py={2}
                      >
                        <Text color="muted" fontSize="xs">
                          {t('Last test score')}
                        </Text>
                        <Text fontWeight={700}>
                          {latestDeveloperComparison
                            ? formatSuccessRate(
                                latestDeveloperComparison.accuracy
                              )
                            : 'n/a'}
                        </Text>
                        <Text color="muted" fontSize="xs">
                          {t('How the latest unseen-flip test went.')}
                        </Text>
                      </Box>
                      <Box
                        borderWidth="1px"
                        borderColor="gray.100"
                        borderRadius="md"
                        px={3}
                        py={2}
                      >
                        <Text color="muted" fontSize="xs">
                          {t('Best test score')}
                        </Text>
                        <Text fontWeight={700}>
                          {latestDeveloperComparison
                            ? formatSuccessRate(developerBestAccuracy)
                            : 'n/a'}
                        </Text>
                        <Text color="muted" fontSize="xs">
                          {t('The strongest score saved for this test size.')}
                        </Text>
                      </Box>
                      <Box
                        borderWidth="1px"
                        borderColor="gray.100"
                        borderRadius="md"
                        px={3}
                        py={2}
                      >
                        <Text color="muted" fontSize="xs">
                          {t('{{count}}-flip test status', {
                            count: developerLocalBenchmarkSize,
                          })}
                        </Text>
                        <Text fontWeight={700}>
                          {developerComparisonStatus}
                        </Text>
                        <Text color="muted" fontSize="xs">
                          {t(
                            'Shows whether the latest check is waiting, running, or saved.'
                          )}
                        </Text>
                      </Box>
                    </SimpleGrid>
                    {latestDeveloperComparison ? (
                      <Text color="muted" fontSize="xs">
                        {t('Last evaluated')}:{' '}
                        {formatTimestamp(latestDeveloperComparison.evaluatedAt)}
                        {developerAccuracyDelta !== null
                          ? ` · ${t('Change vs previous')}: ${
                              developerAccuracyDelta >= 0 ? '+' : ''
                            }${(developerAccuracyDelta * 100).toFixed(1)} pts`
                          : ''}
                      </Text>
                    ) : (
                      <Text color="muted" fontSize="sm">
                        {!developerSupportsLocalTraining
                          ? t(
                              'No benchmark result yet because the current Local AI runtime cannot train or run the held-out comparison.'
                            )
                          : t(
                              'No benchmark result yet for the selected {{count}}-flip holdout. After training succeeds, run that local comparison to audit the latest model without reusing the training flips.',
                              {
                                count: developerLocalBenchmarkSize,
                              }
                            )}
                      </Text>
                    )}
                    <Stack isInline spacing={2} flexWrap="wrap">
                      <PrimaryButton
                        isDisabled={!developerCanRunComparison}
                        isLoading={isRunningDeveloperComparison}
                        onClick={runDeveloperComparison}
                      >
                        {t('Run {{count}}-flip comparison now', {
                          count: developerLocalBenchmarkSize,
                        })}
                      </PrimaryButton>
                    </Stack>
                    {developerComparisonHistoryForSelectedBenchmark.length ? (
                      <SuccessRateHistoryChart
                        entries={developerComparisonHistoryForSelectedBenchmark}
                        t={t}
                      />
                    ) : null}
                    <Text color="muted" fontSize="xs">
                      {t('Current local pilot preset')}:{' '}
                      {developerLocalTrainingProfileSummary.label} ·{' '}
                      {developerLocalTrainingModelPath}
                    </Text>
                    <Text color="muted" fontSize="xs">
                      {t('Current training heat mode')}:{' '}
                      {developerLocalTrainingThermalSummary.label} ·{' '}
                      {t(
                        '{{stepMs}} ms between steps, {{epochMs}} ms between epochs',
                        {
                          stepMs:
                            developerLocalTrainingThermalSummary.stepCooldownMs,
                          epochMs:
                            developerLocalTrainingThermalSummary.epochCooldownMs,
                        }
                      )}
                    </Text>
                    <Text color="muted" fontSize="xs">
                      {t('Current local run budget')}:{' '}
                      {developerLocalTrainingBudgetStyles.badgeLabel} ·{' '}
                      {t(
                        '{{epochs}} epoch passes · batch {{batch}} · LoRA rank {{rank}} · {{updates}} updates each epoch · {{total}} total updates · minimum added cooling {{cooling}}',
                        {
                          epochs: formatCountMetric(
                            developerLocalTrainingEpochs
                          ),
                          batch: formatCountMetric(
                            developerLocalTrainingBatchSize
                          ),
                          rank: formatCountMetric(
                            developerLocalTrainingLoraRank
                          ),
                          updates: formatCountMetric(
                            developerLocalTrainingUpdatesPerEpoch
                          ),
                          total: formatCountMetric(
                            developerLocalTrainingTotalUpdates
                          ),
                          cooling: formatDurationMs(
                            developerLocalTrainingCoolingFloorMs
                          ),
                        }
                      )}
                    </Text>
                    <Text color="muted" fontSize="xs">
                      {t('Chunk size')}: {DEVELOPER_TRAINING_CHUNK_SIZE} ·{' '}
                      {t('Benchmark size')}: {developerLocalBenchmarkSize} ·{' '}
                      {t(
                        'The same validation holdout is reused for this size so later runs stay comparable.'
                      )}
                    </Text>
                  </Stack>
                </Box>
              </>
            ) : (
              <>
                <Alert status="info" borderRadius="md">
                  <Stack spacing={2}>
                    <Text fontWeight={600}>
                      {t('Voluntary post-session teaching')}
                    </Text>
                    <Text fontSize="sm">
                      {t(
                        'This annotation set starts only after the validation session is over and final consensus exists. Skipping it does not block incoming federated updates; it only means you do not share annotation learnings for this epoch.'
                      )}
                    </Text>
                    <Text fontSize="sm">
                      {t(
                        'The app opens one flip at a time from a capped annotation set. The exported workspace remains available as a fallback and import path.'
                      )}
                    </Text>
                    <Text fontSize="sm">
                      {t(
                        'Each annotation set is capped at 30 flips. You can also load an offline demo set from bundled sample flips. Demo annotations stay local and are never used for training.'
                      )}
                    </Text>
                  </Stack>
                </Alert>

                {isDemoMode ? (
                  <Alert status="warning" borderRadius="md">
                    <Stack spacing={1}>
                      <Text fontWeight={600}>{t('Offline demo mode')}</Text>
                      <Text fontSize="sm">
                        {t(
                          'This annotator session uses bundled sample flips for testing only. Drafts are stored locally in a separate demo workspace and are not imported into training data.'
                        )}
                      </Text>
                    </Stack>
                  </Alert>
                ) : null}

                <Stack isInline spacing={3} align="end" flexWrap="wrap">
                  <Box minW="220px">
                    <Text fontSize="sm" fontWeight={500} mb={1}>
                      {t('Epoch')}
                    </Text>
                    <Input
                      value={epoch}
                      onChange={(e) => setEpoch(e.target.value)}
                      placeholder={t('Previous epoch')}
                    />
                  </Box>
                  <PrimaryButton
                    isLoading={isLoading}
                    onClick={() => loadPackage({forceRebuild: true})}
                  >
                    {t('Refresh set')}
                  </PrimaryButton>
                  <SecondaryButton onClick={() => router.push('/settings/ai')}>
                    {t('Back to AI')}
                  </SecondaryButton>
                </Stack>

                <Stack isInline spacing={3} align="end" flexWrap="wrap">
                  <Box minW="280px">
                    <Text fontSize="sm" fontWeight={500} mb={1}>
                      {t('Offline demo sample')}
                    </Text>
                    <Select
                      value={demoSampleName}
                      onChange={(e) => setDemoSampleName(e.target.value)}
                    >
                      {DEMO_SAMPLE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  </Box>
                  <SecondaryButton
                    isDisabled={isWorkspaceLoading}
                    isLoading={isWorkspaceLoading && isDemoMode}
                    onClick={loadOfflineDemoWorkspace}
                  >
                    {t('Load offline demo')}
                  </SecondaryButton>
                </Stack>

                <Box
                  borderWidth="1px"
                  borderColor="gray.100"
                  borderRadius="md"
                  p={4}
                >
                  <Stack spacing={2}>
                    <Text fontWeight={600}>{packageSummary.label}</Text>
                    <Text color="muted" fontSize="sm">
                      {packageSummary.detail}
                    </Text>
                    {result?.packagePath ? (
                      <Text color="muted" fontSize="xs">
                        {t('Package path')}: {result.packagePath}
                      </Text>
                    ) : null}
                    <Text color="muted" fontSize="sm">
                      {isDemoMode
                        ? `${t('Review status')}: ${t('demo')}`
                        : `${t('Review status')}: ${reviewStatus}`}
                    </Text>
                    <Text color="muted" fontSize="sm">
                      {t('Eligible')}:{' '}
                      {isDemoMode
                        ? Number(workspace?.taskCount) || 0
                        : eligibleCount}
                      {' / '}
                      {HUMAN_TEACHER_SET_LIMIT}
                    </Text>
                    <Text color="muted" fontSize="sm">
                      {t('Excluded')}: {Number(result?.excludedCount) || 0}
                    </Text>
                    {importedAnnotations ? (
                      <Text color="muted" fontSize="sm">
                        {t('Imported annotations')}:{' '}
                        {Number(importedAnnotations.normalizedRows) || 0}
                      </Text>
                    ) : null}
                    {Array.isArray(result?.package?.inconsistencyFlags) &&
                    result.package.inconsistencyFlags.length ? (
                      <Text color="muted" fontSize="xs">
                        {t('Flags')}:{' '}
                        {result.package.inconsistencyFlags.join(', ')}
                      </Text>
                    ) : null}
                  </Stack>
                </Box>
              </>
            )}

            {error ? (
              <Alert status="error" borderRadius="md">
                <Text fontSize="sm">{error}</Text>
              </Alert>
            ) : null}

            {isDeveloperMode ? null : (
              <Stack isInline spacing={2} flexWrap="wrap">
                <PrimaryButton
                  isDisabled={
                    isDemoMode ||
                    isUpdating ||
                    isExporting ||
                    eligibleCount <= 0
                  }
                  isLoading={isExporting}
                  onClick={startAnnotationFlow}
                >
                  {reviewStatus === 'approved'
                    ? t('Open current flip')
                    : t('Start one-by-one annotation')}
                </PrimaryButton>
                <SecondaryButton
                  isDisabled={isDemoMode || isUpdating}
                  onClick={() => updateReviewStatus('draft')}
                >
                  {t('Keep as draft')}
                </SecondaryButton>
                <SecondaryButton
                  isDisabled={isDemoMode || isUpdating}
                  onClick={() => updateReviewStatus('rejected')}
                >
                  {t('Skip this epoch')}
                </SecondaryButton>
                <SecondaryButton
                  isDisabled={isDemoMode || isExporting || eligibleCount <= 0}
                  isLoading={isExporting}
                  onClick={exportTasks}
                >
                  {t('Export fallback workspace')}
                </SecondaryButton>
                <SecondaryButton
                  isDisabled={
                    isDemoMode || isImporting || reviewStatus !== 'approved'
                  }
                  isLoading={isImporting}
                  onClick={importAnnotations}
                >
                  {t('Import completed annotations')}
                </SecondaryButton>
                <SecondaryButton
                  isDisabled={
                    isDemoMode
                      ? isWorkspaceLoading
                      : isWorkspaceLoading ||
                        reviewStatus !== 'approved' ||
                        eligibleCount <= 0
                  }
                  isLoading={isWorkspaceLoading}
                  onClick={
                    isDemoMode ? loadOfflineDemoWorkspace : loadWorkspace
                  }
                >
                  {isDemoMode
                    ? t('Reload demo workspace')
                    : t('Open fallback workspace')}
                </SecondaryButton>
              </Stack>
            )}

            {!isDeveloperMode && exportResult ? (
              <Box
                borderWidth="1px"
                borderColor="green.100"
                borderRadius="md"
                p={4}
              >
                <Stack spacing={1}>
                  <Text fontWeight={600}>{t('Fallback workspace ready')}</Text>
                  <Text color="muted" fontSize="sm">
                    {t(
                      'The app exported a local workspace with decoded panels, a manifest, and an annotation template.'
                    )}
                  </Text>
                  <Text color="muted" fontSize="sm">
                    {t('Flips')}: {Number(exportResult.tasks) || 0}
                  </Text>
                  <Text color="muted" fontSize="xs">
                    {t('Output directory')}: {exportResult.outputDir}
                  </Text>
                  <Text color="muted" fontSize="xs">
                    {t('Task manifest')}: {exportResult.manifestPath}
                  </Text>
                  <Text color="muted" fontSize="xs">
                    {t('Annotation template')}: {exportResult.templatePath}
                  </Text>
                  <Text color="muted" fontSize="xs">
                    {t('Fill-in file')}: {exportResult.filledPath}
                  </Text>
                </Stack>
              </Box>
            ) : null}

            {!isDeveloperMode && importResult ? (
              <Box
                borderWidth="1px"
                borderColor="blue.100"
                borderRadius="md"
                p={4}
              >
                <Stack spacing={1}>
                  <Text fontWeight={600}>{t('Annotations imported')}</Text>
                  <Text color="muted" fontSize="sm">
                    {t(
                      'The app normalized completed annotation rows from the fallback workspace and stored them for later training ingestion.'
                    )}
                  </Text>
                  <Text color="muted" fontSize="sm">
                    {t('Normalized rows')}:{' '}
                    {Number(importResult.normalizedRows) || 0}
                  </Text>
                  <Text color="muted" fontSize="sm">
                    {t('Missing rows')}:{' '}
                    {Number(importResult.missingAnnotations) || 0}
                  </Text>
                  <Text color="muted" fontSize="sm">
                    {t('Invalid rows')}:{' '}
                    {Number(importResult.invalidAnnotations) || 0}
                  </Text>
                  <Text color="muted" fontSize="xs">
                    {t('Imported file')}: {importResult.annotationsPath}
                  </Text>
                  <Text color="muted" fontSize="xs">
                    {t('Normalized output')}: {importResult.normalizedPath}
                  </Text>
                  <Text color="muted" fontSize="xs">
                    {t('Import summary')}: {importResult.summaryPath}
                  </Text>
                </Stack>
              </Box>
            ) : null}

            {workspace ? (
              <Box
                borderWidth="1px"
                borderColor="gray.100"
                borderRadius="md"
                p={4}
              >
                <Stack spacing={4}>
                  <Text fontWeight={600}>
                    {isDeveloperMode
                      ? t('In-app flip trainer')
                      : t('In-app annotator')}
                  </Text>
                  <Text color="muted" fontSize="sm">
                    {isDeveloperMode
                      ? t(
                          'This local pilot path uses 5 bundled FLIP samples at a time. Annotate them one by one, then choose whether to train immediately or load the next 5 flips. Use it for small personal experiments, not for long or large production runs.'
                        )
                      : t(
                          'This uses the selected epoch annotation set. The app keeps you on one current flip at a time and saves your notes flip by flip.'
                        )}
                  </Text>
                  {isDeveloperMode ? (
                    <Text color="muted" fontSize="sm">
                      {t(
                        'Requested draft runtime: {{draftModel}}. Active runtime: {{activeModel}}. Local training model: {{trainingModel}}.',
                        {
                          draftModel: localDraftRequestedRuntimeModelLabel,
                          activeModel: localDraftActiveRuntimeModelLabel,
                          trainingModel: developerLocalTrainingModelPath,
                        }
                      )}
                    </Text>
                  ) : null}
                  <Stack spacing={2}>
                    <Text color="muted" fontSize="sm">
                      {isDeveloperMode ? t('Chunk size') : t('Set size')}:{' '}
                      {totalTaskCount} /{' '}
                      {isDeveloperMode
                        ? DEVELOPER_TRAINING_CHUNK_SIZE
                        : HUMAN_TEACHER_SET_LIMIT}{' '}
                      · {t('Drafted')}: {Number(workspace.draftedCount) || 0} ·{' '}
                      {t('Complete')}: {Number(workspace.completedCount) || 0}
                    </Text>
                    <Box>
                      <Flex justify="space-between" align="center" mb={1}>
                        <Text fontSize="sm" fontWeight={600}>
                          {currentFlipLabel}
                        </Text>
                        <Text color="muted" fontSize="xs">
                          {completionPercent}% {t('done')}
                        </Text>
                      </Flex>
                      <Progress
                        value={completionPercent}
                        size="sm"
                        borderRadius="full"
                        colorScheme="blue"
                      />
                    </Box>
                  </Stack>

                  <Flex gap={4} align="flex-start" flexWrap="wrap">
                    <Box
                      minW="260px"
                      flex="1 1 260px"
                      maxH="560px"
                      overflowY="auto"
                      borderWidth="1px"
                      borderColor="gray.100"
                      borderRadius="md"
                    >
                      <Stack spacing={0}>
                        <Box
                          px={3}
                          py={3}
                          borderBottomWidth="1px"
                          borderBottomColor="gray.50"
                        >
                          <Text fontSize="sm" fontWeight={700}>
                            {isDeveloperMode
                              ? t('Current 5 flips')
                              : t('Flip queue')}
                          </Text>
                          <Text color="muted" fontSize="xs">
                            {isDeveloperMode
                              ? t(
                                  'You can move within this 5-flip chunk, then choose whether to train or load the next 5.'
                                )
                              : t(
                                  'Choose another flip only if you want to jump ahead.'
                                )}
                          </Text>
                        </Box>
                        {workspace.tasks.map((task, index) => {
                          let taskStatusTone = 'gray'

                          if (task.isComplete) {
                            taskStatusTone = 'green'
                          } else if (task.hasDraft) {
                            taskStatusTone = 'orange'
                          }

                          const isSelectedTask = task.taskId === selectedTaskId
                          const isNextQueuedTask = task.taskId === nextTaskId

                          return (
                            <Box
                              key={task.taskId}
                              px={3}
                              py={3}
                              borderBottomWidth="1px"
                              borderBottomColor="gray.50"
                              bg={isSelectedTask ? 'blue.50' : 'transparent'}
                              cursor="pointer"
                              onClick={() => navigateToTask(task.taskId)}
                            >
                              <Flex
                                justify="space-between"
                                align="flex-start"
                                gap={2}
                                mb={1}
                              >
                                <Text fontSize="sm" fontWeight={600}>
                                  {t('Flip')} {index + 1}
                                </Text>
                                <Stack
                                  direction="row"
                                  spacing={1}
                                  flexWrap="wrap"
                                  justify="flex-end"
                                >
                                  {isSelectedTask ? (
                                    <Badge
                                      colorScheme="blue"
                                      borderRadius="full"
                                    >
                                      {t('Current')}
                                    </Badge>
                                  ) : null}
                                  {isNextQueuedTask ? (
                                    <Badge
                                      colorScheme="purple"
                                      borderRadius="full"
                                    >
                                      {t('Next')}
                                    </Badge>
                                  ) : null}
                                  <Badge
                                    colorScheme={taskStatusTone}
                                    borderRadius="full"
                                  >
                                    {getDraftStatusLabel(task, t)}
                                  </Badge>
                                </Stack>
                              </Flex>
                              <Text color="muted" fontSize="xs" noOfLines={1}>
                                {task.flipHash || task.taskId}
                              </Text>
                              <Text color="muted" fontSize="xs" mt={1}>
                                {t('Consensus')}:{' '}
                                {task.consensusAnswer || 'n/a'}
                              </Text>
                            </Box>
                          )
                        })}
                      </Stack>
                    </Box>

                    <Box flex="2 1 640px" minW="320px">
                      {taskDetail ? (
                        <Stack spacing={4}>
                          <Box
                            borderWidth="1px"
                            borderColor="blue.100"
                            bg="blue.50"
                            borderRadius="xl"
                            p={4}
                          >
                            <Text
                              fontSize="sm"
                              fontWeight={700}
                              color="blue.600"
                            >
                              {currentFlipLabel}
                            </Text>
                            <Text fontWeight={600} mt={1}>
                              {taskDetail.flipHash || taskDetail.taskId}
                            </Text>
                            <Text color="muted" fontSize="sm" mt={1}>
                              {t(
                                'Review it like a normal flip test: decide which story order looks more humanly coherent, then explain that judgment briefly.'
                              )}
                            </Text>
                            <Stack
                              direction={['column', 'row']}
                              spacing={2}
                              flexWrap="wrap"
                              mt={3}
                            >
                              <Badge colorScheme="blue" borderRadius="full">
                                {t('Consensus')}:&nbsp;
                                {taskDetail.consensusAnswer || t('Unknown')}
                              </Badge>
                              <Badge
                                colorScheme={taskDetailStatusTone}
                                borderRadius="full"
                              >
                                {getDraftStatusLabel(annotationDraft, t)}
                              </Badge>
                              <Badge colorScheme="purple" borderRadius="full">
                                {t('{{done}} / {{total}} complete', {
                                  done: annotationCompletionState.completedChecks,
                                  total: annotationCompletionState.totalChecks,
                                })}
                              </Badge>
                            </Stack>
                          </Box>

                          <Box
                            borderWidth="1px"
                            borderColor={
                              annotationCompletionState.isComplete
                                ? 'green.100'
                                : 'gray.100'
                            }
                            borderRadius="lg"
                            p={3}
                            bg={
                              annotationCompletionState.isComplete
                                ? 'green.50'
                                : 'gray.50'
                            }
                          >
                            <Stack spacing={3}>
                              <Box>
                                <Text fontWeight={600}>
                                  {annotationCompletionState.isComplete
                                    ? t(
                                        'This flip is ready to save as complete'
                                      )
                                    : t('What is still required for this flip')}
                                </Text>
                                <Text color="muted" fontSize="sm" mt={1}>
                                  {annotationCompletionState.isComplete
                                    ? t(
                                        'All required human-teacher fields are filled. You can save this flip now.'
                                      )
                                    : t(
                                        'Complete these remaining items before this flip counts as fully annotated.'
                                      )}
                                </Text>
                              </Box>
                              <SimpleGrid columns={[1, 2, 3]} spacing={2}>
                                {annotationCompletionItems.map((item) => (
                                  <CompletionChecklistCard
                                    key={item.key}
                                    item={item}
                                    t={t}
                                  />
                                ))}
                              </SimpleGrid>
                            </Stack>
                          </Box>

                          {!nextTaskId && totalTaskCount > 0 ? (
                            <Alert status="info" borderRadius="lg">
                              <Stack spacing={3} w="full">
                                <Text fontSize="sm">{finalFlipHint}</Text>
                                {isDeveloperMode || isDemoMode ? (
                                  <Stack
                                    direction={['column', 'row']}
                                    spacing={2}
                                    flexWrap="wrap"
                                  >
                                    <PrimaryButton
                                      isLoading={isSavingTask}
                                      onClick={() => saveTaskDraft()}
                                    >
                                      {finishButtonLabel}
                                    </PrimaryButton>
                                    <SecondaryButton
                                      isDisabled={
                                        isSavingTask ||
                                        isFinalizingDeveloperChunk
                                      }
                                      onClick={handleSaveAndExit}
                                    >
                                      {t('Save and exit')}
                                    </SecondaryButton>
                                  </Stack>
                                ) : null}
                              </Stack>
                            </Alert>
                          ) : null}

                          <Box
                            borderWidth="1px"
                            borderColor="gray.100"
                            borderRadius="lg"
                            p={3}
                          >
                            <Flex
                              justify="space-between"
                              align={['stretch', 'center']}
                              direction={['column', 'row']}
                              gap={3}
                            >
                              <Box>
                                <Text fontWeight={600}>
                                  {t('Optional A / B / C references')}
                                </Text>
                                <Text color="muted" fontSize="sm">
                                  {t(
                                    'If you want, drag A, B, or C onto a panel image and describe what each letter means. You can mention the letters or their descriptions in your reasoning.'
                                  )}
                                </Text>
                              </Box>
                              <SecondaryButton
                                onClick={() =>
                                  setShowReferenceTool((current) => !current)
                                }
                              >
                                {showPanelReferenceTool
                                  ? t('Hide A / B / C references')
                                  : t('Add A / B / C references')}
                              </SecondaryButton>
                            </Flex>

                            {showPanelReferenceTool ? (
                              <Stack spacing={3} mt={3}>
                                {normalizePanelReferences(
                                  annotationDraft.panel_references
                                ).map((reference) => (
                                  <Box
                                    key={reference.code}
                                    borderWidth="1px"
                                    borderColor="gray.100"
                                    borderRadius="md"
                                    p={3}
                                  >
                                    <Stack spacing={2}>
                                      <Flex
                                        align={['stretch', 'center']}
                                        direction={['column', 'row']}
                                        gap={3}
                                      >
                                        <Flex
                                          align="center"
                                          justify="center"
                                          w="40px"
                                          h="40px"
                                          borderRadius="full"
                                          bg="blue.500"
                                          color="white"
                                          fontWeight={700}
                                          fontSize="lg"
                                          cursor="grab"
                                          draggable
                                          onDragStart={(event) =>
                                            handlePanelReferenceDragStart(
                                              event,
                                              reference.code
                                            )
                                          }
                                        >
                                          {reference.code}
                                        </Flex>
                                        <Input
                                          value={reference.description}
                                          placeholder={t(
                                            'What does {{code}} point to?',
                                            {code: reference.code}
                                          )}
                                          onChange={(e) =>
                                            updatePanelReference(
                                              reference.code,
                                              {
                                                description:
                                                  e?.target?.value || '',
                                              }
                                            )
                                          }
                                        />
                                        <SecondaryButton
                                          isDisabled={
                                            !hasPanelReferenceContent(reference)
                                          }
                                          onClick={() =>
                                            updatePanelReference(
                                              reference.code,
                                              {
                                                description: '',
                                                panel_index: null,
                                                x: null,
                                                y: null,
                                              }
                                            )
                                          }
                                        >
                                          {t('Clear')}
                                        </SecondaryButton>
                                      </Flex>
                                      <Text color="muted" fontSize="xs">
                                        {reference.panel_index !== null
                                          ? t(
                                              '{{code}} is placed on a panel. Drag it again to move it, or click the marker on the image to remove only the placement.',
                                              {code: reference.code}
                                            )
                                          : t(
                                              'Drag {{code}} onto one of the panel images below if you want to reference a specific object or spot.',
                                              {code: reference.code}
                                            )}
                                      </Text>
                                    </Stack>
                                  </Box>
                                ))}
                              </Stack>
                            ) : null}
                          </Box>

                          <SimpleGrid columns={[1, 2]} spacing={4}>
                            {[
                              {
                                key: 'left',
                                label: t('LEFT story'),
                                order: taskDetail.leftOrder,
                                panels: leftPanels,
                              },
                              {
                                key: 'right',
                                label: t('RIGHT story'),
                                order: taskDetail.rightOrder,
                                panels: rightPanels,
                              },
                            ].map((story) => (
                              <Box
                                key={story.key}
                                borderWidth="1px"
                                borderColor={
                                  annotationDraft.final_answer === story.key
                                    ? 'blue.500'
                                    : 'gray.200'
                                }
                                borderRadius="xl"
                                p={3}
                                bg={
                                  annotationDraft.final_answer === story.key
                                    ? 'rgba(87,143,255,0.06)'
                                    : 'white'
                                }
                                cursor="pointer"
                                onClick={() =>
                                  setAnnotationDraft((current) => ({
                                    ...current,
                                    final_answer: story.key,
                                  }))
                                }
                              >
                                <Flex justify="space-between" align="center">
                                  <Box>
                                    <Text fontWeight={700}>{story.label}</Text>
                                    <Text color="muted" fontSize="xs">
                                      {t('Order')}: {formatOrder(story.order)}
                                    </Text>
                                  </Box>
                                  <Text
                                    color={
                                      annotationDraft.final_answer === story.key
                                        ? 'blue.500'
                                        : 'muted'
                                    }
                                    fontSize="xs"
                                    fontWeight={600}
                                  >
                                    {annotationDraft.final_answer === story.key
                                      ? t('Selected')
                                      : t('Tap to choose')}
                                  </Text>
                                </Flex>

                                <Stack spacing={3} mt={3}>
                                  {story.panels.map((panel, panelIndex) => (
                                    <Box
                                      key={panel.id}
                                      borderWidth="1px"
                                      borderColor="gray.100"
                                      borderRadius="lg"
                                      overflow="hidden"
                                      bg="gray.50"
                                    >
                                      <Box
                                        position="relative"
                                        onDragOver={
                                          handlePanelReferenceDragOver
                                        }
                                        onDrop={(event) =>
                                          handlePanelReferenceDrop(
                                            event,
                                            panel.index
                                          )
                                        }
                                      >
                                        <Image
                                          src={panel.dataUrl}
                                          alt={panel.id}
                                          objectFit="contain"
                                          w="full"
                                          maxH="180px"
                                          bg="gray.50"
                                        />
                                        {(
                                          panelReferencesByIndex.get(
                                            Number(panel.index)
                                          ) || []
                                        ).map((reference) => (
                                          <Flex
                                            key={`${panel.id}-${reference.code}`}
                                            position="absolute"
                                            left={`${
                                              (reference.x ?? 0.5) * 100
                                            }%`}
                                            top={`${
                                              (reference.y ?? 0.5) * 100
                                            }%`}
                                            transform="translate(-50%, -50%)"
                                            align="center"
                                            justify="center"
                                            w="32px"
                                            h="32px"
                                            borderRadius="full"
                                            bg="blue.500"
                                            color="white"
                                            fontWeight={700}
                                            fontSize="sm"
                                            boxShadow="md"
                                            cursor={
                                              showPanelReferenceTool
                                                ? 'pointer'
                                                : 'default'
                                            }
                                            onClick={() =>
                                              showPanelReferenceTool
                                                ? clearPanelReferencePlacement(
                                                    reference.code
                                                  )
                                                : null
                                            }
                                            title={
                                              reference.description
                                                ? `${reference.code}: ${reference.description}`
                                                : reference.code
                                            }
                                          >
                                            {reference.code}
                                          </Flex>
                                        ))}
                                      </Box>
                                      <Box px={3} py={2} bg="white">
                                        <Text fontSize="xs" color="muted">
                                          {t('Step')} {panelIndex + 1}
                                        </Text>
                                      </Box>
                                    </Box>
                                  ))}
                                </Stack>
                              </Box>
                            ))}
                          </SimpleGrid>

                          <Stack spacing={3}>
                            {isDeveloperSourceMode ? (
                              <Box
                                borderWidth="1px"
                                borderColor="gray.100"
                                borderRadius="2xl"
                                p={4}
                                bg="white"
                              >
                                <Stack spacing={4}>
                                  <Box>
                                    <Text fontWeight={600}>
                                      {t('AI draft chat')}
                                    </Text>
                                    <Text color="muted" fontSize="sm">
                                      {t(
                                        'Use the local AI to prefill this flip, then keep refining it in the same place like a normal chat.'
                                      )}
                                    </Text>
                                    <Text color="muted" fontSize="xs" mt={1}>
                                      {t(
                                        'This draft is locked to the same local Qwen lane as training. Runtime model: {{draftModel}}. Local training model: {{trainingModel}}.',
                                        {
                                          draftModel:
                                            localDraftRequestedRuntimeModelLabel,
                                          trainingModel:
                                            developerLocalTrainingModelPath,
                                        }
                                      )}
                                    </Text>
                                  </Box>

                                  <Box maxW="320px">
                                    <Text
                                      color="muted"
                                      fontSize="xs"
                                      fontWeight={600}
                                      mb={1}
                                    >
                                      {t('AI draft trigger')}
                                    </Text>
                                    <Select
                                      size="sm"
                                      value={developerAiDraftTriggerMode}
                                      onChange={(e) =>
                                        updateLocalAiSettings({
                                          developerAiDraftTriggerMode:
                                            e.target.value,
                                        })
                                      }
                                    >
                                      <option value="manual">
                                        {t('Trigger AI draft manually')}
                                      </option>
                                      <option value="automatic">
                                        {t('Trigger AI draft automatically')}
                                      </option>
                                    </Select>
                                    <Text color="muted" fontSize="xs" mt={1}>
                                      {autoTriggerAiDraft
                                        ? t(
                                            'Each fresh empty flip will clear first, then request a new AI draft automatically.'
                                          )
                                        : t(
                                            'Each new flip starts empty. Use the chat composer only when you want a fresh AI draft or revision.'
                                          )}
                                    </Text>
                                  </Box>

                                  <Box
                                    borderWidth="1px"
                                    borderColor={
                                      developerAiDraftWindowStyles.borderColor
                                    }
                                    borderRadius="2xl"
                                    bg={developerAiDraftWindowStyles.bg}
                                    px={3}
                                    py={3}
                                  >
                                    <Stack spacing={3}>
                                      <Flex
                                        justify="space-between"
                                        align={['flex-start', 'center']}
                                        direction={['column', 'row']}
                                        gap={2}
                                      >
                                        <Box>
                                          <Text fontWeight={600}>
                                            {t('Conversation window ownership')}
                                          </Text>
                                          <Text color="muted" fontSize="sm">
                                            {t(
                                              'These three local-only windows decide how much the AI can keep, how much you can send in one turn, and how much room the answer gets back.'
                                            )}
                                          </Text>
                                        </Box>
                                        <Badge
                                          colorScheme={
                                            developerAiDraftWindowStyles.badgeScheme
                                          }
                                          borderRadius="full"
                                          px={2}
                                        >
                                          {
                                            developerAiDraftWindowStyles.badgeLabel
                                          }
                                        </Badge>
                                      </Flex>

                                      <SimpleGrid columns={[1, 3]} spacing={3}>
                                        <Box>
                                          <FormLabel mb={1}>
                                            {t('Context window')}
                                          </FormLabel>
                                          <Input
                                            type="number"
                                            min={0}
                                            max={32768}
                                            step={1024}
                                            value={
                                              developerAiDraftContextWindowTokens >
                                              0
                                                ? String(
                                                    developerAiDraftContextWindowTokens
                                                  )
                                                : ''
                                            }
                                            placeholder={t(
                                              'Auto runtime default'
                                            )}
                                            onChange={(e) =>
                                              updateLocalAiSettings({
                                                developerAiDraftContextWindowTokens:
                                                  e.target.value
                                                    ? Number.parseInt(
                                                        e.target.value,
                                                        10
                                                      )
                                                    : 0,
                                              })
                                            }
                                          />
                                          <Text
                                            color="muted"
                                            fontSize="xs"
                                            mt={1}
                                          >
                                            {t(
                                              'Larger context keeps more of the flip instructions, current draft, and your correction together, but it uses more RAM and can make the Mac slower and hotter.'
                                            )}
                                          </Text>
                                        </Box>

                                        <Box>
                                          <FormLabel mb={1}>
                                            {t('Question window')}
                                          </FormLabel>
                                          <Input
                                            type="number"
                                            min={240}
                                            max={4000}
                                            step={120}
                                            value={String(
                                              developerAiDraftQuestionWindowChars
                                            )}
                                            onChange={(e) =>
                                              updateLocalAiSettings({
                                                developerAiDraftQuestionWindowChars:
                                                  Number.parseInt(
                                                    e.target.value,
                                                    10
                                                  ),
                                              })
                                            }
                                          />
                                          <Text
                                            color="muted"
                                            fontSize="xs"
                                            mt={1}
                                          >
                                            {t(
                                              'This caps how much of your typed instruction or correction reaches the AI in one turn. Smaller keeps prompts cleaner and faster; larger keeps more nuance.'
                                            )}
                                          </Text>
                                        </Box>

                                        <Box>
                                          <FormLabel mb={1}>
                                            {t('Answer window')}
                                          </FormLabel>
                                          <Input
                                            type="number"
                                            min={128}
                                            max={2048}
                                            step={64}
                                            value={String(
                                              developerAiDraftAnswerWindowTokens
                                            )}
                                            onChange={(e) =>
                                              updateLocalAiSettings({
                                                developerAiDraftAnswerWindowTokens:
                                                  Number.parseInt(
                                                    e.target.value,
                                                    10
                                                  ),
                                              })
                                            }
                                          />
                                          <Text
                                            color="muted"
                                            fontSize="xs"
                                            mt={1}
                                          >
                                            {t(
                                              'This is the maximum reply budget. Smaller answers return faster and ramble less; larger answers give the AI more room for summaries and structured reasoning.'
                                            )}
                                          </Text>
                                        </Box>
                                      </SimpleGrid>

                                      <Text color="muted" fontSize="xs">
                                        {t(
                                          'Current window mix: {{context}} context tokens · {{question}} question chars · {{answer}} answer tokens.',
                                          {
                                            context:
                                              developerAiDraftContextWindowTokens >
                                              0
                                                ? formatCountMetric(
                                                    developerAiDraftContextWindowTokens
                                                  )
                                                : t('runtime default'),
                                            question: formatCountMetric(
                                              developerAiDraftQuestionWindowChars
                                            ),
                                            answer: formatCountMetric(
                                              developerAiDraftAnswerWindowTokens
                                            ),
                                          }
                                        )}
                                      </Text>
                                    </Stack>
                                  </Box>

                                  <Box
                                    borderWidth="1px"
                                    borderColor="gray.100"
                                    borderRadius="2xl"
                                    bg="gray.50"
                                    px={3}
                                    py={3}
                                  >
                                    <Stack spacing={3}>
                                      {!currentAiFeedbackText &&
                                      !currentAiAnnotation ? (
                                        <AiChatBubble
                                          label={t('Local AI')}
                                          meta={t('Ready for the first draft')}
                                        >
                                          <Text fontSize="sm">
                                            {t(
                                              'Ask for a first draft, or type one instruction first if you want the AI to focus on something specific in the flip.'
                                            )}
                                          </Text>
                                        </AiChatBubble>
                                      ) : null}

                                      <AiUserPromptMessage
                                        text={currentAiFeedbackText}
                                        t={t}
                                      />

                                      <AiAssistantDraftMessage
                                        annotation={currentAiAnnotation}
                                        panelDescriptions={
                                          currentAiPanelDescriptions
                                        }
                                        panelText={currentAiPanelText}
                                        runtimeModelLabel={
                                          localDraftActiveRuntimeModelLabel
                                        }
                                        trainingModelLabel={
                                          developerLocalTrainingModelPath
                                        }
                                        onRate={rateCurrentAiDraft}
                                        t={t}
                                      />
                                    </Stack>
                                  </Box>

                                  <Box
                                    borderWidth="1px"
                                    borderColor="gray.100"
                                    borderRadius="2xl"
                                    bg="white"
                                    px={3}
                                    py={3}
                                  >
                                    <Stack spacing={3}>
                                      <Text color="muted" fontSize="xs">
                                        {currentAiAnnotation
                                          ? t(
                                              'Reply below to correct the draft, ask for a revision, or request a fresh read from the panels.'
                                            )
                                          : t(
                                              'Optionally add one instruction for the first draft, then press Enter to send.'
                                            )}
                                      </Text>
                                      <Textarea
                                        minH="96px"
                                        maxLength={
                                          developerAiDraftQuestionWindowChars
                                        }
                                        placeholder={
                                          currentAiAnnotation
                                            ? t(
                                                'Tell the AI what to revise. Press Enter to send, or Shift+Enter for a new line.'
                                              )
                                            : t(
                                                'Optional: tell the AI what to focus on before the first draft. Press Enter to send.'
                                              )
                                        }
                                        value={currentAiReplyDraft}
                                        onChange={(e) =>
                                          setCurrentAiReplyDraft(
                                            e?.target?.value || ''
                                          )
                                        }
                                        onKeyDown={handleAiChatComposerKeyDown}
                                      />
                                      <Flex
                                        justify="space-between"
                                        align={['flex-start', 'center']}
                                        direction={['column', 'row']}
                                        gap={3}
                                      >
                                        <Stack spacing={1}>
                                          <Text color="muted" fontSize="xs">
                                            {t(
                                              'Enter sends to the AI. Shift+Enter adds a new line.'
                                            )}
                                          </Text>
                                          <Text color="muted" fontSize="xs">
                                            {t('{{count}} / {{limit}} chars', {
                                              count: currentAiReplyDraft.length,
                                              limit:
                                                developerAiDraftQuestionWindowChars,
                                            })}
                                          </Text>
                                        </Stack>
                                        <Stack
                                          direction={['column', 'row']}
                                          spacing={2}
                                          flexWrap="wrap"
                                        >
                                          {currentAiAnnotation ? (
                                            <SecondaryButton
                                              onClick={() =>
                                                requestAiAnnotationDraft()
                                              }
                                              isDisabled={isGeneratingAiDraft}
                                            >
                                              {t('Fresh draft from panels')}
                                            </SecondaryButton>
                                          ) : null}
                                          <PrimaryButton
                                            onClick={submitAiChatPrompt}
                                            isLoading={isGeneratingAiDraft}
                                            loadingText={
                                              hasAiReplyDraft
                                                ? t('Sending')
                                                : t('Drafting')
                                            }
                                          >
                                            {aiDraftPrimaryActionLabel}
                                          </PrimaryButton>
                                        </Stack>
                                      </Flex>
                                    </Stack>
                                  </Box>
                                </Stack>
                              </Box>
                            ) : null}

                            <InterviewPrompt
                              title={t(
                                'Which side feels more correct to you as a human looking at this flip?'
                              )}
                            >
                              <Stack
                                direction={['column', 'row']}
                                spacing={2}
                                flexWrap="wrap"
                              >
                                {annotationDraft.final_answer === 'left' ? (
                                  <PrimaryButton
                                    onClick={() =>
                                      setAnnotationDraft((current) => ({
                                        ...current,
                                        final_answer: 'left',
                                      }))
                                    }
                                  >
                                    {t('LEFT chosen')}
                                  </PrimaryButton>
                                ) : (
                                  <SecondaryButton
                                    onClick={() =>
                                      setAnnotationDraft((current) => ({
                                        ...current,
                                        final_answer: 'left',
                                      }))
                                    }
                                  >
                                    {t('Choose LEFT')}
                                  </SecondaryButton>
                                )}

                                {annotationDraft.final_answer === 'right' ? (
                                  <PrimaryButton
                                    onClick={() =>
                                      setAnnotationDraft((current) => ({
                                        ...current,
                                        final_answer: 'right',
                                      }))
                                    }
                                  >
                                    {t('RIGHT chosen')}
                                  </PrimaryButton>
                                ) : (
                                  <SecondaryButton
                                    onClick={() =>
                                      setAnnotationDraft((current) => ({
                                        ...current,
                                        final_answer: 'right',
                                      }))
                                    }
                                  >
                                    {t('Choose RIGHT')}
                                  </SecondaryButton>
                                )}

                                {annotationDraft.final_answer === 'skip' ? (
                                  <PrimaryButton
                                    onClick={() =>
                                      setAnnotationDraft((current) => ({
                                        ...current,
                                        final_answer: 'skip',
                                      }))
                                    }
                                  >
                                    {t('Skip chosen')}
                                  </PrimaryButton>
                                ) : (
                                  <SecondaryButton
                                    onClick={() =>
                                      setAnnotationDraft((current) => ({
                                        ...current,
                                        final_answer: 'skip',
                                      }))
                                    }
                                  >
                                    {t('Skip this flip')}
                                  </SecondaryButton>
                                )}
                              </Stack>
                            </InterviewPrompt>

                            {hasDecision ? (
                              <InterviewPrompt
                                title={t(
                                  'Why would a normal human choose that answer? Keep it short and concrete.'
                                )}
                              >
                                <Textarea
                                  placeholder={t(
                                    'For example: the LEFT story has a clear sequence, while the RIGHT side mixes unrelated scenes.'
                                  )}
                                  value={annotationDraft.why_answer}
                                  onChange={(e) => {
                                    const nextValue = e?.target?.value || ''

                                    setAnnotationDraft((current) => ({
                                      ...current,
                                      why_answer: nextValue,
                                    }))
                                  }}
                                />
                                {activePanelReferences.length ? (
                                  <Text color="muted" fontSize="xs" mt={2}>
                                    {t(
                                      'Optional references available: {{references}}. You can mention the letters or the descriptions in your reason.',
                                      {
                                        references: activePanelReferenceSummary,
                                      }
                                    )}
                                  </Text>
                                ) : null}
                              </InterviewPrompt>
                            ) : null}

                            {hasDecision && hasReason ? (
                              <InterviewPrompt
                                title={t(
                                  'Answer the remaining judgment checks before saving this flip.'
                                )}
                              >
                                <Stack spacing={3}>
                                  <BooleanChoiceField
                                    title={t(
                                      'Did you need readable text to judge this flip?'
                                    )}
                                    description={t(
                                      'Answer yes if the visible words changed your decision. Otherwise answer no.'
                                    )}
                                    value={annotationDraft.text_required}
                                    onChange={(value) =>
                                      setAnnotationDraft((current) => ({
                                        ...current,
                                        text_required: value,
                                      }))
                                    }
                                    trueLabel={t('Yes, text mattered')}
                                    falseLabel={t('No, text was not needed')}
                                    t={t}
                                  />
                                  <BooleanChoiceField
                                    title={t(
                                      'Were explicit sequence markers present?'
                                    )}
                                    description={t(
                                      'Use yes for arrows, numbering, or other obvious ordering cues.'
                                    )}
                                    value={
                                      annotationDraft.sequence_markers_present
                                    }
                                    onChange={(value) =>
                                      setAnnotationDraft((current) => ({
                                        ...current,
                                        sequence_markers_present: value,
                                      }))
                                    }
                                    trueLabel={t('Yes, markers were present')}
                                    falseLabel={t('No, no markers')}
                                    t={t}
                                  />
                                </Stack>
                              </InterviewPrompt>
                            ) : null}

                            {hasDecision && hasReason ? (
                              <InterviewPrompt
                                title={t(
                                  'Does this flip need a report because it breaks the rules or depends on disallowed cues?'
                                )}
                              >
                                <Stack spacing={3}>
                                  <BooleanChoiceField
                                    title={t('Should this flip be reported?')}
                                    description={t(
                                      'Choose yes only if it depends on disallowed cues or otherwise breaks the rules.'
                                    )}
                                    value={annotationDraft.report_required}
                                    onChange={(value) =>
                                      setAnnotationDraft((current) => ({
                                        ...current,
                                        report_required: value,
                                        report_reason:
                                          value === true
                                            ? current.report_reason
                                            : '',
                                      }))
                                    }
                                    trueLabel={t('Yes, report this flip')}
                                    falseLabel={t('No, do not report')}
                                    t={t}
                                  />

                                  {annotationDraft.report_required === true ? (
                                    <Textarea
                                      placeholder={t(
                                        'Short reason for why this should be reported.'
                                      )}
                                      value={annotationDraft.report_reason}
                                      onChange={(e) => {
                                        const nextValue = e?.target?.value || ''

                                        setAnnotationDraft((current) => ({
                                          ...current,
                                          report_reason: nextValue,
                                        }))
                                      }}
                                    />
                                  ) : null}
                                </Stack>
                              </InterviewPrompt>
                            ) : null}

                            {hasDecision && hasReason ? (
                              <InterviewPrompt
                                title={t(
                                  'How confident are you in that judgment? Choose one level before saving this flip.'
                                )}
                              >
                                <Select
                                  value={annotationDraft.confidence}
                                  onChange={(e) => {
                                    const nextValue = e?.target?.value || ''

                                    setAnnotationDraft((current) => ({
                                      ...current,
                                      confidence: nextValue,
                                    }))
                                  }}
                                >
                                  <option value="">
                                    {t('Choose confidence')}
                                  </option>
                                  <option value="1">{t('Low')}</option>
                                  <option value="2">{t('Rather low')}</option>
                                  <option value="3">{t('Medium')}</option>
                                  <option value="4">{t('High')}</option>
                                  <option value="5">{t('Very high')}</option>
                                </Select>
                              </InterviewPrompt>
                            ) : null}

                            <Box
                              borderWidth="1px"
                              borderColor="gray.100"
                              borderRadius="lg"
                              p={3}
                            >
                              <Flex
                                justify="space-between"
                                align="center"
                                gap={3}
                              >
                                <Box>
                                  <Text fontWeight={600}>
                                    {annotationCompletionState.requiredDetailComplete
                                      ? t('Required detail is complete')
                                      : t(
                                          'Required detail for a complete flip'
                                        )}
                                  </Text>
                                  <Text color="muted" fontSize="sm">
                                    {annotationCompletionState.requiredDetailComplete
                                      ? t(
                                          'You already filled the required frame notes and both story summaries. You can review them here before saving.'
                                        )
                                      : t(
                                          'Frame notes and both short story summaries are part of the required human-teacher record for this flip.'
                                        )}
                                  </Text>
                                </Box>
                                {annotationCompletionState.requiredDetailComplete ? (
                                  <SecondaryButton
                                    onClick={() =>
                                      setShowAdvancedFields(
                                        (current) => !current
                                      )
                                    }
                                  >
                                    {showRequiredDetailSection
                                      ? t('Hide detail')
                                      : t('Review detail')}
                                  </SecondaryButton>
                                ) : (
                                  <Badge
                                    colorScheme="orange"
                                    borderRadius="full"
                                  >
                                    {t('{{count}} item(s) left', {
                                      count: [
                                        !annotationCompletionState.hasFrameCaptions,
                                        !annotationCompletionState.hasStorySummaries,
                                      ].filter(Boolean).length,
                                    })}
                                  </Badge>
                                )}
                              </Flex>

                              {showRequiredDetailSection ? (
                                <Stack spacing={3} mt={3}>
                                  <InterviewPrompt
                                    title={t(
                                      'Add one short factual note for each panel.'
                                    )}
                                  >
                                    <Stack spacing={3}>
                                      {annotationDraft.frame_captions.map(
                                        (caption, index) => (
                                          <Box key={`caption-${index}`}>
                                            <FormLabel>
                                              {t('Frame note')} {index + 1}
                                            </FormLabel>
                                            <Input
                                              value={caption}
                                              onChange={(e) => {
                                                const nextValue =
                                                  e?.target?.value || ''

                                                setAnnotationDraft(
                                                  (current) => ({
                                                    ...current,
                                                    frame_captions:
                                                      current.frame_captions.map(
                                                        (item, itemIndex) =>
                                                          itemIndex === index
                                                            ? nextValue
                                                            : item
                                                      ),
                                                  })
                                                )
                                              }}
                                            />
                                          </Box>
                                        )
                                      )}
                                    </Stack>
                                  </InterviewPrompt>

                                  <InterviewPrompt
                                    title={t(
                                      'Write one short summary for the LEFT story and one for the RIGHT story.'
                                    )}
                                  >
                                    <Stack spacing={3}>
                                      <Box>
                                        <FormLabel>
                                          {t('LEFT summary')}
                                        </FormLabel>
                                        <Textarea
                                          value={
                                            annotationDraft.option_a_summary
                                          }
                                          onChange={(e) => {
                                            const nextValue =
                                              e?.target?.value || ''

                                            setAnnotationDraft((current) => ({
                                              ...current,
                                              option_a_summary: nextValue,
                                            }))
                                          }}
                                        />
                                      </Box>

                                      <Box>
                                        <FormLabel>
                                          {t('RIGHT summary')}
                                        </FormLabel>
                                        <Textarea
                                          value={
                                            annotationDraft.option_b_summary
                                          }
                                          onChange={(e) => {
                                            const nextValue =
                                              e?.target?.value || ''

                                            setAnnotationDraft((current) => ({
                                              ...current,
                                              option_b_summary: nextValue,
                                            }))
                                          }}
                                        />
                                      </Box>

                                      <Box>
                                        <FormLabel>{t('Annotator')}</FormLabel>
                                        <Input
                                          value={annotationDraft.annotator}
                                          onChange={(e) => {
                                            const nextValue =
                                              e?.target?.value || ''

                                            setAnnotationDraft((current) => ({
                                              ...current,
                                              annotator: nextValue,
                                            }))
                                          }}
                                        />
                                        <Text
                                          color="muted"
                                          fontSize="xs"
                                          mt={1}
                                        >
                                          {t(
                                            'Optional. Use this only if you want to tag who wrote the annotation on this desktop profile.'
                                          )}
                                        </Text>
                                      </Box>
                                    </Stack>
                                  </InterviewPrompt>
                                </Stack>
                              ) : null}
                            </Box>

                            <Stack isInline spacing={2} flexWrap="wrap">
                              <PrimaryButton
                                isLoading={isSavingTask}
                                onClick={() =>
                                  nextTaskId
                                    ? saveTaskDraft({advance: true})
                                    : saveTaskDraft()
                                }
                              >
                                {savePrimaryLabel}
                              </PrimaryButton>
                              {isDeveloperMode || isDemoMode ? (
                                <>
                                  <SecondaryButton
                                    isDisabled={isSavingTask || !selectedTaskId}
                                    isLoading={isFinalizingDeveloperChunk}
                                    onClick={() => saveTaskDraft()}
                                  >
                                    {nextTaskId
                                      ? saveDraftLabel
                                      : finishButtonLabel}
                                  </SecondaryButton>
                                  <SecondaryButton
                                    isDisabled={
                                      isSavingTask || isFinalizingDeveloperChunk
                                    }
                                    onClick={handleSaveAndExit}
                                  >
                                    {t('Save and exit')}
                                  </SecondaryButton>
                                </>
                              ) : (
                                <SecondaryButton
                                  isDisabled={
                                    isSavingTask ||
                                    (!nextTaskId && !selectedTaskId)
                                  }
                                  onClick={() =>
                                    nextTaskId
                                      ? saveTaskDraft()
                                      : finishAnnotationSet()
                                  }
                                >
                                  {nextTaskId
                                    ? saveDraftLabel
                                    : finishButtonLabel}
                                </SecondaryButton>
                              )}
                              <SecondaryButton
                                isDisabled={!previousTaskId || isTaskLoading}
                                onClick={() => navigateToTask(previousTaskId)}
                              >
                                {t('Previous flip')}
                              </SecondaryButton>
                              <SecondaryButton
                                isDisabled={!nextTaskId || isTaskLoading}
                                onClick={() => navigateToTask(nextTaskId)}
                              >
                                {t('Next flip')}
                              </SecondaryButton>
                              <SecondaryButton
                                isDisabled={isTaskLoading}
                                onClick={() => loadTask(selectedTaskId)}
                              >
                                {t('Reload flip')}
                              </SecondaryButton>
                              <Text
                                color="muted"
                                fontSize="sm"
                                alignSelf="center"
                              >
                                {getDraftHelperText(annotationDraft, t)}
                              </Text>
                            </Stack>
                            <Text color="muted" fontSize="xs">
                              {autosaveStatusText}
                            </Text>
                          </Stack>
                        </Stack>
                      ) : (
                        <Box
                          borderWidth="1px"
                          borderColor="gray.100"
                          borderRadius="md"
                          p={4}
                        >
                          <Text color="muted" fontSize="sm">
                            {isTaskLoading
                              ? t('Loading flip...')
                              : t('Select a flip to annotate.')}
                          </Text>
                        </Box>
                      )}
                    </Box>
                  </Flex>
                </Stack>
              </Box>
            ) : null}

            <Modal
              isOpen={chunkDecisionDialog.isOpen}
              onClose={
                isChunkDecisionBusy ? () => {} : closeChunkDecisionDialog
              }
              closeOnOverlayClick={false}
              closeOnEsc={!isChunkDecisionBusy}
              isCentered
            >
              <ModalOverlay />
              <ModalContent>
                <ModalHeader>
                  {chunkDecisionDialog.mode === 'demo'
                    ? t('5 demo flips complete')
                    : t('5 flips complete')}
                </ModalHeader>
                <ModalBody>
                  <Stack spacing={3}>
                    <Text>
                      {chunkDecisionDialog.mode === 'demo'
                        ? t(
                            'This 5-flip demo chunk is complete. Demo training is paused until you explicitly start it here. Choose whether to simulate training now or keep demo training stopped for now.'
                          )
                        : t(
                            'This 5-flip training chunk is complete. Local training is paused until you explicitly start it here. Choose whether to start training now or keep training stopped for now.'
                          )}
                    </Text>
                    <Text color="muted" fontSize="sm">
                      {chunkDecisionDialog.mode === 'demo'
                        ? t(
                            'Demo mode never changes your real model. It only lets you test the full chunk workflow locally.'
                          )
                        : t(
                            'If you do not press "Start training now", this chunk stays saved locally and can be trained later.'
                          )}
                    </Text>
                  </Stack>
                </ModalBody>
                <ModalFooter>
                  <Stack spacing={2} w="full">
                    <PrimaryButton
                      isLoading={isChunkDecisionBusy}
                      isDisabled={
                        isChunkDecisionBusy ||
                        (chunkDecisionDialog.mode === 'developer' &&
                          developerTrainingUnsupported)
                      }
                      onClick={() => handleChunkDecisionAction('train')}
                    >
                      {chunkDecisionDialog.mode === 'demo'
                        ? t('Start demo training now')
                        : t('Start training now')}
                    </PrimaryButton>
                    {chunkDecisionDialog.mode === 'developer' &&
                    developerTrainingUnsupported ? (
                      <Text color="muted" fontSize="sm">
                        {t(
                          'Training is unavailable in the current Local AI runtime. Your annotations stay saved locally until a trainable backend exists.'
                        )}
                      </Text>
                    ) : null}
                    {(
                      chunkDecisionDialog.mode === 'developer'
                        ? developerCanAdvance
                        : demoCanAdvance
                    ) ? (
                      <SecondaryButton
                        isDisabled={isChunkDecisionBusy}
                        onClick={() => handleChunkDecisionAction('advance')}
                      >
                        {chunkDecisionDialog.mode === 'demo'
                          ? t(
                              'Keep demo training stopped and annotate 5 more flips'
                            )
                          : t(
                              'Keep training stopped and annotate 5 more flips'
                            )}
                      </SecondaryButton>
                    ) : null}
                    <SecondaryButton
                      isDisabled={isChunkDecisionBusy}
                      onClick={() => handleChunkDecisionAction('exit')}
                    >
                      {chunkDecisionDialog.mode === 'demo'
                        ? t('Keep demo training stopped and save and close')
                        : t('Keep training stopped and save and close')}
                    </SecondaryButton>
                  </Stack>
                </ModalFooter>
              </ModalContent>
            </Modal>

            <Modal
              isOpen={contributionDialog.isOpen}
              onClose={closeContributionDialog}
              closeOnOverlayClick={!isExportingContributionBundle}
              closeOnEsc={!isExportingContributionBundle}
              isCentered
              size="xl"
            >
              <ModalOverlay />
              <ModalContent>
                <ModalHeader>{contributionDialogTitle}</ModalHeader>
                <ModalBody>
                  {contributionDialogMode === 'share' ? (
                    <Stack spacing={4}>
                      <Text>
                        {shareHumanTeacherAnnotationsWithNetwork
                          ? t(
                              'Your future annotation-sharing consent is already stored on this desktop profile.'
                            )
                          : t(
                              'The app can store your future annotation-sharing consent locally with one click.'
                            )}
                      </Text>
                      <Box
                        borderWidth="1px"
                        borderColor="green.100"
                        borderRadius="md"
                        px={4}
                        py={3}
                        bg="green.50"
                      >
                        <Stack spacing={2}>
                          <Text fontWeight={700}>
                            {t('What this means today')}
                          </Text>
                          <Text fontSize="sm">
                            {t(
                              'This only stores your consent for a later P2P sharing and cross-check flow. It does not upload anything yet, and it does not touch wallet secrets or your whole desktop profile.'
                            )}
                          </Text>
                          <Text fontSize="sm">
                            {t(
                              'When the network-sharing transport exists later, the app can reuse this consent without asking you again every time.'
                            )}
                          </Text>
                        </Stack>
                      </Box>
                      <Text color="muted" fontSize="sm">
                        {t(
                          'The eventual goal is that normal users can contribute annotation work with one safe click, while stronger nodes handle the larger public training jobs.'
                        )}
                      </Text>
                    </Stack>
                  ) : null}

                  {contributionDialogMode === 'external' ? (
                    <Stack spacing={4}>
                      <Text>
                        {t(
                          'This is the recommended path for serious training runs. The app exports one provider-neutral bundle, then you can use any managed jobs provider, GPU pod provider, or cloud VM.'
                        )}
                      </Text>

                      {isExportingContributionBundle ? (
                        <Box
                          borderWidth="1px"
                          borderColor="blue.100"
                          borderRadius="md"
                          px={4}
                          py={3}
                          bg="blue.50"
                        >
                          <Stack spacing={2}>
                            <Text fontWeight={700}>
                              {t('Preparing external training bundle')}
                            </Text>
                            <Progress
                              size="sm"
                              isIndeterminate
                              colorScheme="blue"
                            />
                            <Text color="muted" fontSize="sm">
                              {t(
                                'The app is packaging your normalized annotations, manifest, and README into one folder now.'
                              )}
                            </Text>
                          </Stack>
                        </Box>
                      ) : null}

                      {externalContributionError ? (
                        <Alert status="error" borderRadius="md">
                          <Stack spacing={1}>
                            <Text fontWeight={700}>
                              {t('Bundle export failed')}
                            </Text>
                            <Text fontSize="sm">
                              {externalContributionError}
                            </Text>
                          </Stack>
                        </Alert>
                      ) : null}

                      {externalContributionBundle ? (
                        <>
                          <Box
                            borderWidth="1px"
                            borderColor="blue.100"
                            borderRadius="md"
                            px={4}
                            py={3}
                            bg="blue.50"
                          >
                            <Stack spacing={2}>
                              <Text fontWeight={700}>{t('Bundle ready')}</Text>
                              <Text fontSize="sm">
                                {t(
                                  'Upload this whole folder to the machine or provider you want to use.'
                                )}
                              </Text>
                              <Text
                                color="muted"
                                fontSize="xs"
                                wordBreak="break-all"
                              >
                                {externalContributionBundle.outputDir}
                              </Text>
                            </Stack>
                          </Box>

                          <Stack spacing={2}>
                            <Text fontWeight={700}>
                              {t('Simple path for normal users')}
                            </Text>
                            <Text fontSize="sm">
                              {t(
                                '1. Rent one GPU computer from any managed jobs provider, GPU pod provider, or cloud VM.'
                              )}
                            </Text>
                            <Text fontSize="sm">
                              {t(
                                '2. Upload this whole folder to that machine.'
                              )}
                            </Text>
                            <Text fontSize="sm">
                              {t(
                                '3. Start with a benchmark-only smoke run before doing a longer training run.'
                              )}
                            </Text>
                            <Text fontSize="sm">
                              {t(
                                '4. For serious training, use the recommended MLX base {{model}}.',
                                {
                                  model:
                                    externalContributionBundle.recommendedTrainingModel,
                                }
                              )}
                            </Text>
                            <Text fontSize="sm">
                              {t(
                                '5. If that is too heavy, fall back to {{strongFallback}} or {{safeFallback}}.',
                                {
                                  strongFallback:
                                    externalContributionBundle.strongerFallbackTrainingModel,
                                  safeFallback:
                                    externalContributionBundle.safeFallbackTrainingModel,
                                }
                              )}
                            </Text>
                            <Text fontSize="sm">
                              {t(
                                '6. After training, run the fixed held-out comparison on {{count}} unseen flips and keep the result JSON plus the adapter artifact together.',
                                {
                                  count:
                                    externalContributionBundle.recommendedBenchmarkFlips,
                                }
                              )}
                            </Text>
                          </Stack>

                          <SimpleGrid columns={[1, 2]} spacing={3}>
                            <Box
                              borderWidth="1px"
                              borderColor="gray.100"
                              borderRadius="md"
                              px={3}
                              py={2}
                              bg="gray.50"
                            >
                              <Text color="muted" fontSize="xs">
                                {t('Annotated rows')}
                              </Text>
                              <Text fontWeight={700}>
                                {Number(
                                  externalContributionBundle.annotatedCount
                                ) || 0}
                              </Text>
                            </Box>
                            <Box
                              borderWidth="1px"
                              borderColor="gray.100"
                              borderRadius="md"
                              px={3}
                              py={2}
                              bg="gray.50"
                            >
                              <Text color="muted" fontSize="xs">
                                {t('Benchmark size')}
                              </Text>
                              <Text fontWeight={700}>
                                {Number(
                                  externalContributionBundle.recommendedBenchmarkFlips
                                ) || 0}
                              </Text>
                            </Box>
                          </SimpleGrid>

                          <Box
                            borderWidth="1px"
                            borderColor="gray.100"
                            borderRadius="md"
                            px={4}
                            py={3}
                            bg="gray.50"
                          >
                            <Stack spacing={1}>
                              <Text fontSize="sm" fontWeight={700}>
                                {t('Important files')}
                              </Text>
                              <Text
                                color="muted"
                                fontSize="xs"
                                wordBreak="break-all"
                              >
                                {t('Bundle folder')}:{' '}
                                {externalContributionBundle.outputDir}
                              </Text>
                              <Text
                                color="muted"
                                fontSize="xs"
                                wordBreak="break-all"
                              >
                                {t('Manifest')}:{' '}
                                {externalContributionBundle.manifestPath}
                              </Text>
                              <Text
                                color="muted"
                                fontSize="xs"
                                wordBreak="break-all"
                              >
                                {t('README')}:{' '}
                                {externalContributionBundle.readmePath}
                              </Text>
                              <Text
                                color="muted"
                                fontSize="xs"
                                wordBreak="break-all"
                              >
                                {t('Annotations')}:{' '}
                                {externalContributionBundle.annotationsPath}
                              </Text>
                            </Stack>
                          </Box>
                        </>
                      ) : null}
                    </Stack>
                  ) : null}

                  {contributionDialogMode === 'local' ? (
                    <Stack spacing={4}>
                      <Text>
                        {t(
                          'Local training is still useful right after your own small annotation chunk, especially if you want one quick personal experiment on this machine.'
                        )}
                      </Text>
                      <LocalTrainingJourneyPanel
                        title={t('What this local run looks like')}
                        subtitle={t(
                          'First you finish 5 flips. Then the computer practices on just those 5. Then the app checks whether the score on unseen flips changed.'
                        )}
                        chunkCompletedCount={
                          Number(workspace?.completedCount) || 0
                        }
                        chunkTotalCount={totalTaskCount}
                        pendingCount={developerPendingCount}
                        annotatedCount={developerAnnotatedCount}
                        trainedCount={developerTrainedCount}
                        latestComparison={latestDeveloperComparison}
                        benchmarkSize={developerLocalBenchmarkSize}
                        canRunLocalTraining={developerSupportsLocalTraining}
                        isTrainingActive={isFinalizingDeveloperChunk}
                        isComparisonActive={isRunningDeveloperComparison}
                        lastTraining={developerLastTraining}
                        totalUpdates={developerLocalTrainingTotalUpdates}
                        coolingFloorMs={developerLocalTrainingCoolingFloorMs}
                        epochs={developerLocalTrainingEpochs}
                        batchSize={developerLocalTrainingBatchSize}
                        loraRank={developerLocalTrainingLoraRank}
                        t={t}
                      />
                      <Box
                        borderWidth="1px"
                        borderColor="orange.100"
                        borderRadius="md"
                        px={4}
                        py={3}
                        bg="orange.50"
                      >
                        <Stack spacing={2}>
                          <Text fontWeight={700}>
                            {t('Before you continue')}
                          </Text>
                          <Text fontSize="sm">
                            {t('Possible for small local experiments')}
                          </Text>
                          <Text fontSize="sm">
                            {t(
                              'Not recommended for long or large training runs'
                            )}
                          </Text>
                          <Text fontSize="sm">
                            {t('Creates heavy heat and power draw')}
                          </Text>
                          <Text fontSize="sm">
                            {t('Can reduce battery health on laptops')}
                          </Text>
                          <Text fontSize="sm">
                            {t(
                              'Use a dedicated training machine or external GPU for serious training'
                            )}
                          </Text>
                        </Stack>
                      </Box>
                      <Box
                        borderWidth="1px"
                        borderColor="gray.100"
                        borderRadius="md"
                        px={4}
                        py={3}
                      >
                        <Stack spacing={2}>
                          <FormLabel>{t('Local training lane')}</FormLabel>
                          <Text color="muted" fontSize="sm">
                            {developerLocalTrainingProfileSummary.detail}
                          </Text>
                          <Text
                            color="muted"
                            fontSize="xs"
                            wordBreak="break-all"
                          >
                            {t('Training model')}:{' '}
                            {developerLocalTrainingModelPath}
                          </Text>
                          <Text
                            color="muted"
                            fontSize="xs"
                            wordBreak="break-all"
                          >
                            {t('Locked runtime model')}:{' '}
                            {localDraftRequestedRuntimeModelLabel}
                          </Text>
                          <Box maxW="320px">
                            <FormLabel mb={1}>
                              {t('Local benchmark size')}
                            </FormLabel>
                            <Select
                              size="sm"
                              value={String(developerLocalBenchmarkSize)}
                              onChange={(e) =>
                                updateLocalAiSettings({
                                  developerLocalBenchmarkSize: Number.parseInt(
                                    e.target.value,
                                    10
                                  ),
                                })
                              }
                            >
                              {DEVELOPER_LOCAL_BENCHMARK_SIZE_OPTIONS.map(
                                (size) => (
                                  <option key={size} value={String(size)}>
                                    {describeDeveloperLocalBenchmarkSizeOption(
                                      size,
                                      t
                                    )}
                                  </option>
                                )
                              )}
                            </Select>
                            <Text color="muted" fontSize="xs" mt={1}>
                              {t(
                                'This benchmark always uses a separate validation holdout and never reuses the flips you just trained on.'
                              )}
                            </Text>
                          </Box>
                          <Box maxW="320px">
                            <FormLabel mb={1}>
                              {t('Training heat mode')}
                            </FormLabel>
                            <Select
                              size="sm"
                              value={developerLocalTrainingThermalMode}
                              onChange={(e) =>
                                updateLocalAiSettings({
                                  developerLocalTrainingThermalMode:
                                    e.target.value,
                                })
                              }
                            >
                              <option value="full_speed">
                                {t('Full speed')}
                              </option>
                              <option value="balanced">
                                {t('Balanced cooling')}
                              </option>
                              <option value="cool">
                                {t('Cool and slower')}
                              </option>
                            </Select>
                            <Text color="muted" fontSize="xs" mt={1}>
                              {developerLocalTrainingThermalSummary.detail}
                            </Text>
                            <Text color="muted" fontSize="xs" mt={1}>
                              {t(
                                'This inserts {{stepMs}} ms between training steps and {{epochMs}} ms between epochs.',
                                {
                                  stepMs:
                                    developerLocalTrainingThermalSummary.stepCooldownMs,
                                  epochMs:
                                    developerLocalTrainingThermalSummary.epochCooldownMs,
                                }
                              )}
                            </Text>
                          </Box>
                          <Box
                            borderWidth="1px"
                            borderColor={
                              developerLocalTrainingBudgetStyles.borderColor
                            }
                            borderRadius="2xl"
                            bg={developerLocalTrainingBudgetStyles.bg}
                            px={3}
                            py={3}
                          >
                            <Stack spacing={3}>
                              <Flex
                                justify="space-between"
                                align={['flex-start', 'center']}
                                direction={['column', 'row']}
                                gap={2}
                              >
                                <Box>
                                  <Text fontWeight={600}>
                                    {t('Training budget ownership')}
                                  </Text>
                                  <Text color="muted" fontSize="sm">
                                    {t(
                                      'These three knobs decide how heavy the local pilot becomes on this machine. Smaller settings make weaker computers slower but more able to participate.'
                                    )}
                                  </Text>
                                </Box>
                                <Badge
                                  colorScheme={
                                    developerLocalTrainingBudgetStyles.badgeScheme
                                  }
                                  borderRadius="full"
                                  px={2}
                                >
                                  {
                                    developerLocalTrainingBudgetStyles.badgeLabel
                                  }
                                </Badge>
                              </Flex>

                              <SimpleGrid columns={[1, 3]} spacing={3}>
                                <Box>
                                  <FormLabel mb={1}>{t('Epochs')}</FormLabel>
                                  <Input
                                    type="number"
                                    min={1}
                                    max={6}
                                    step={1}
                                    value={String(developerLocalTrainingEpochs)}
                                    onChange={(e) =>
                                      updateLocalAiSettings({
                                        developerLocalTrainingEpochs: e.target
                                          .value
                                          ? Number.parseInt(e.target.value, 10)
                                          : DEFAULT_DEVELOPER_LOCAL_TRAINING_EPOCHS,
                                      })
                                    }
                                  />
                                  <Text color="muted" fontSize="xs" mt={1}>
                                    {t(
                                      'Each extra epoch repeats the same 5-flip chunk one more time. That can improve the adapter, but total time and heat scale up directly.'
                                    )}
                                  </Text>
                                </Box>

                                <Box>
                                  <FormLabel mb={1}>
                                    {t('Batch size')}
                                  </FormLabel>
                                  <Input
                                    type="number"
                                    min={1}
                                    max={4}
                                    step={1}
                                    value={String(
                                      developerLocalTrainingBatchSize
                                    )}
                                    onChange={(e) =>
                                      updateLocalAiSettings({
                                        developerLocalTrainingBatchSize: e
                                          .target.value
                                          ? Number.parseInt(e.target.value, 10)
                                          : DEFAULT_DEVELOPER_LOCAL_TRAINING_BATCH_SIZE,
                                      })
                                    }
                                  />
                                  <Text color="muted" fontSize="xs" mt={1}>
                                    {t(
                                      'Batch size is the biggest memory lever. Batch 1 is the easiest on weak machines, but it creates more update steps and takes longer.'
                                    )}
                                  </Text>
                                </Box>

                                <Box>
                                  <FormLabel mb={1}>{t('LoRA rank')}</FormLabel>
                                  <Input
                                    type="number"
                                    min={4}
                                    max={16}
                                    step={2}
                                    value={String(
                                      developerLocalTrainingLoraRank
                                    )}
                                    onChange={(e) =>
                                      updateLocalAiSettings({
                                        developerLocalTrainingLoraRank: e.target
                                          .value
                                          ? Number.parseInt(e.target.value, 10)
                                          : DEFAULT_DEVELOPER_LOCAL_TRAINING_LORA_RANK,
                                      })
                                    }
                                  />
                                  <Text color="muted" fontSize="xs" mt={1}>
                                    {t(
                                      'Lower rank keeps the adapter lighter and easier to fit into memory, but it also reduces how much change each run can carry.'
                                    )}
                                  </Text>
                                </Box>
                              </SimpleGrid>

                              <Text color="muted" fontSize="xs">
                                {t(
                                  'Current math for this 5-flip chunk: {{updates}} updates per epoch, {{total}} total updates this run, and at least {{cooling}} of intentional cooling pauses before raw compute time.',
                                  {
                                    updates: formatCountMetric(
                                      developerLocalTrainingUpdatesPerEpoch
                                    ),
                                    total: formatCountMetric(
                                      developerLocalTrainingTotalUpdates
                                    ),
                                    cooling: formatDurationMs(
                                      developerLocalTrainingCoolingFloorMs
                                    ),
                                  }
                                )}
                              </Text>
                              <Text color="muted" fontSize="xs">
                                {t(
                                  'Current adapter rank is {{percent}}% of the default local rank 10. Weak machines should usually stay at batch 1, drop rank toward 4-6, and use a cooler heat mode if they want to contribute safely.',
                                  {
                                    percent: formatCountMetric(
                                      Math.round(
                                        developerLocalTrainingRankRatio * 100
                                      )
                                    ),
                                  }
                                )}
                              </Text>
                            </Stack>
                          </Box>
                          {localDraftRuntimeStatusHint}
                        </Stack>
                      </Box>
                      <LocalTrainingImpactPanel
                        telemetry={developerTelemetry}
                        telemetryError={developerTelemetryError}
                        thermalSummary={developerLocalTrainingThermalSummary}
                        isBusy={developerTelemetryIsBusy}
                        t={t}
                      />
                      {!developerSupportsLocalTraining ? (
                        <Alert status="warning" borderRadius="md">
                          <Text fontSize="sm">
                            {t(
                              'This desktop profile still needs a working local training backend before the pilot path can run here.'
                            )}
                          </Text>
                        </Alert>
                      ) : null}
                      <Text color="muted" fontSize="sm">
                        {t(
                          'Recommended use: annotate a small chunk, run one local pilot, inspect the result, and move anything serious to a dedicated trainer or external GPU.'
                        )}
                      </Text>
                    </Stack>
                  ) : null}
                </ModalBody>
                <ModalFooter>
                  <Stack spacing={2} w="full">
                    {contributionDialogMode === 'external' ? (
                      <>
                        {externalContributionError ? (
                          <PrimaryButton
                            isLoading={isExportingContributionBundle}
                            onClick={exportExternalTrainingBundle}
                          >
                            {t('Try export again')}
                          </PrimaryButton>
                        ) : null}
                        {externalContributionBundle ? (
                          <PrimaryButton onClick={closeContributionDialog}>
                            {t('I have the bundle')}
                          </PrimaryButton>
                        ) : null}
                        <SecondaryButton
                          isDisabled={isExportingContributionBundle}
                          onClick={closeContributionDialog}
                        >
                          {t('Close')}
                        </SecondaryButton>
                      </>
                    ) : null}

                    {contributionDialogMode === 'share' ? (
                      <PrimaryButton onClick={closeContributionDialog}>
                        {t('Keep this consent')}
                      </PrimaryButton>
                    ) : null}

                    {contributionDialogMode === 'local' ? (
                      <>
                        <PrimaryButton
                          isDisabled={!developerSupportsLocalTraining}
                          onClick={continueWithLocalPilotTraining}
                        >
                          {t('Continue with local pilot training')}
                        </PrimaryButton>
                        <SecondaryButton onClick={closeContributionDialog}>
                          {t('Close')}
                        </SecondaryButton>
                      </>
                    ) : null}
                  </Stack>
                </ModalFooter>
              </ModalContent>
            </Modal>
          </Stack>
        </SettingsSection>
      </Stack>
    </SettingsLayout>
  )
}
