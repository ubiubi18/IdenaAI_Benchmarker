/* eslint-disable react/prop-types */
import React from 'react'
import {
  Alert,
  Badge,
  Box,
  Checkbox,
  Flex,
  HStack,
  Image,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Popover,
  PopoverArrow,
  PopoverBody,
  PopoverContent,
  PopoverTrigger,
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
import {
  InfoButton,
  PrimaryButton,
  SecondaryButton,
} from '../../shared/components/button'
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
  DEVELOPER_BENCHMARK_REVIEW_REQUIRED_FIELD_OPTIONS,
  DEFAULT_DEVELOPER_LOCAL_TRAINING_BATCH_SIZE,
  DEFAULT_DEVELOPER_LOCAL_TRAINING_EPOCHS,
  DEFAULT_DEVELOPER_LOCAL_TRAINING_LORA_RANK,
  DEFAULT_DEVELOPER_LOCAL_BENCHMARK_SIZE,
  DEFAULT_DEVELOPER_LOCAL_BENCHMARK_THERMAL_MODE,
  DEFAULT_DEVELOPER_LOCAL_TRAINING_PROFILE,
  DEFAULT_DEVELOPER_LOCAL_TRAINING_THERMAL_MODE,
  DEFAULT_HUMAN_TEACHER_SYSTEM_PROMPT,
  normalizeDeveloperAiDraftAnswerWindowTokens,
  normalizeDeveloperBenchmarkReviewRequiredFields,
  normalizeDeveloperAiDraftContextWindowTokens,
  normalizeDeveloperAiDraftTriggerMode,
  normalizeDeveloperAiDraftQuestionWindowChars,
  normalizeDeveloperLocalTrainingBatchSize,
  normalizeDeveloperLocalTrainingEpochs,
  normalizeDeveloperLocalTrainingLoraRank,
  normalizeDeveloperLocalBenchmarkSize,
  normalizeDeveloperLocalBenchmarkThermalMode,
  normalizeDeveloperLocalTrainingProfile,
  normalizeDeveloperLocalTrainingThermalMode,
  resolveDeveloperLocalTrainingProfileModelPath,
  resolveDeveloperLocalTrainingProfileRuntimeModel,
  resolveDeveloperLocalTrainingProfileRuntimeVisionModel,
  resolveDeveloperLocalBenchmarkThermalModeCooldowns,
  resolveDeveloperLocalTrainingThermalModeCooldowns,
} from '../../shared/utils/local-ai-settings'
import {
  createEmptyAiAnnotationDraft,
  hasAiAnnotationContent,
  hasAiAnnotationListContent,
  normalizeAiAnnotationDraft,
} from '../../shared/utils/ai-annotation-draft'
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
const BENCHMARK_EXAMPLE_FILTER_OPTIONS = [
  'all',
  'failures',
  'regressed',
  'baseline_better',
  'improved',
  'close_calls',
]
const BENCHMARK_REVIEW_ISSUE_TYPE_OPTIONS = [
  'wrong_answer',
  'missed_text',
  'sequence_confusion',
  'reportability_miss',
  'weak_reasoning',
  'panel_read_failure',
  'ambiguous_flip',
  'other',
]

function HelpPopover({label, children, placement = 'top-end'}) {
  let body = children

  if (Array.isArray(children)) {
    body = (
      <Stack spacing={2}>
        {children.map((item, index) => (
          <Text key={`${label}-${index}`} fontSize="sm">
            {item}
          </Text>
        ))}
      </Stack>
    )
  } else if (typeof children === 'string') {
    body = <Text fontSize="sm">{children}</Text>
  }

  return (
    <Popover trigger="click" placement={placement} isLazy>
      <PopoverTrigger>
        <Box as="span">
          <InfoButton
            aria-label={label}
            display="inline-flex"
            alignSelf="center"
          />
        </Box>
      </PopoverTrigger>
      <PopoverContent
        border="none"
        bg="graphite.500"
        color="white"
        borderRadius="md"
        boxShadow="lg"
        maxW="320px"
      >
        <PopoverArrow bg="graphite.500" />
        <PopoverBody p={3}>{body}</PopoverBody>
      </PopoverContent>
    </Popover>
  )
}

function HeadingWithHelp({
  title,
  helpLabel = '',
  helpContent = null,
  titleProps = {},
  spacing = 2,
}) {
  return (
    <HStack spacing={spacing} align="center">
      <Text {...titleProps}>{title}</Text>
      {helpContent ? (
        <HelpPopover label={helpLabel || title}>{helpContent}</HelpPopover>
      ) : null}
    </HStack>
  )
}

function formatChunkRangeLabel(offset, {chunkSize = 5, totalCount = 0} = {}) {
  const start = Math.max(1, Number(offset) + 1)
  const cappedTotal = Math.max(start, Number(totalCount) || start)
  const end = Math.min(
    start + Math.max(1, Number(chunkSize) || 1) - 1,
    cappedTotal
  )

  return `${start}-${end}`
}

function describeDeveloperLocalTrainingProfile(profile, t) {
  return {
    label: t('Embryo stage'),
    detail: t(
      'No bundled local training base is approved right now. Keep benchmarks and human-teacher notes locally, and treat Molmo2-O as the current research runtime candidate rather than a finished one-click training lane.'
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

function describeDeveloperLocalBenchmarkThermalMode(mode, t) {
  const {mode: normalizedMode, benchmarkCooldownMs} =
    resolveDeveloperLocalBenchmarkThermalModeCooldowns(mode)

  switch (normalizedMode) {
    case 'full_speed':
      return {
        mode: normalizedMode,
        label: t('Fast benchmark'),
        detail: t(
          'Runs unseen-flip checks back to back. Fastest, hottest benchmark option.'
        ),
        benchmarkCooldownMs,
      }
    case 'cool':
      return {
        mode: normalizedMode,
        label: t('Cooler benchmark'),
        detail: t(
          'Adds longer pauses between unseen flips to reduce sustained benchmark heat.'
        ),
        benchmarkCooldownMs,
      }
    case 'balanced':
    default:
      return {
        mode: 'balanced',
        label: t('Balanced benchmark'),
        detail: t(
          'Adds short pauses between unseen flips so the benchmark runs cooler without becoming extremely slow.'
        ),
        benchmarkCooldownMs,
      }
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

function isOllamaLocalRuntimeBackend(value) {
  return (
    String(value || '')
      .trim()
      .toLowerCase() === 'ollama-direct'
  )
}

function supportsAiDraftRuntimeBackend(value) {
  const runtimeBackend = String(value || '')
    .trim()
    .toLowerCase()

  return (
    runtimeBackend === 'ollama-direct' ||
    runtimeBackend === 'local-runtime-service'
  )
}

function resolveAiDraftRuntimeResolution({
  requestedModel = '',
  fallbackModel: _fallbackModel = '',
  availableModels = [],
  runtimeBackend = '',
} = {}) {
  const requested = String(requestedModel || '').trim()
  const models = Array.isArray(availableModels)
    ? availableModels.map((item) => String(item || '').trim()).filter(Boolean)
    : []
  const ollamaBackend = isOllamaLocalRuntimeBackend(runtimeBackend)

  if (requested && models.includes(requested)) {
    return createAiDraftRuntimeResolution({
      status: 'ready',
      requestedModel: requested,
      activeModel: requested,
      fallbackModel: '',
      availableModels: models,
      installHint: ollamaBackend ? `ollama pull ${requested}` : '',
    })
  }

  if (requested && !ollamaBackend && models.length === 0) {
    return createAiDraftRuntimeResolution({
      status: 'ready',
      requestedModel: requested,
      activeModel: requested,
      fallbackModel: '',
      availableModels: models,
      fallbackReason: '',
      installHint: '',
    })
  }

  return createAiDraftRuntimeResolution({
    status: requested ? 'missing' : 'idle',
    requestedModel: requested,
    activeModel: '',
    fallbackModel: '',
    fallbackReason: (() => {
      if (!requested) {
        return ''
      }

      if (ollamaBackend) {
        return `${requested} is not installed in Ollama on this machine yet.`
      }

      return `${requested} was not advertised by the current local runtime service.`
    })(),
    installHint: requested && ollamaBackend ? `ollama pull ${requested}` : '',
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

function isAiAnnotationBoundToTask(aiAnnotation, task = {}) {
  const taskId = String(task?.taskId || task?.task_id || '').trim()
  const annotationTaskId = String(
    aiAnnotation?.task_id ?? aiAnnotation?.taskId ?? ''
  ).trim()

  return Boolean(taskId && annotationTaskId && taskId === annotationTaskId)
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
    return 'This human-teacher feature is not available in the running main process yet. Fully restart IdenaAI and try again.'
  }

  if (/Local AI human-teacher bridge is unavailable/i.test(message)) {
    return 'The local AI human-teacher bridge is unavailable right now. If you are on localhost dev, reload the page and ensure the dev server picked up the browser bridge.'
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
    benchmark_review: {
      context: {
        expected_answer: '',
        ai_prediction: '',
        baseline_prediction: '',
        previous_prediction: '',
        benchmark_flips: null,
        evaluated_at: '',
        change_type: '',
        ai_correct: null,
      },
      correction: {
        issue_type: '',
        failure_note: '',
        retraining_hint: '',
        include_for_training: null,
      },
    },
    benchmark_review_issue_type: '',
    benchmark_review_failure_note: '',
    benchmark_review_retraining_hint: '',
    benchmark_review_include_for_training: null,
  }
}

function normalizeAnnotationDraftBool(value) {
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

function normalizeBenchmarkReviewIssueType(value) {
  const next = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/gu, '_')

  return BENCHMARK_REVIEW_ISSUE_TYPE_OPTIONS.includes(next) ? next : ''
}

function normalizeBenchmarkReviewContextDraft(value = {}) {
  const source =
    value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const expectedAnswer = String(
    source.expected_answer ?? source.expectedAnswer ?? ''
  )
    .trim()
    .toLowerCase()
  const aiPrediction = String(source.ai_prediction ?? source.aiPrediction ?? '')
    .trim()
    .toLowerCase()
  const baselinePrediction = String(
    source.baseline_prediction ?? source.baselinePrediction ?? ''
  )
    .trim()
    .toLowerCase()
  const previousPrediction = String(
    source.previous_prediction ?? source.previousPrediction ?? ''
  )
    .trim()
    .toLowerCase()
  let benchmarkFlips = null
  if (source.benchmark_flips === null || source.benchmarkFlips === null) {
    benchmarkFlips = null
  } else if (
    typeof source.benchmark_flips !== 'undefined' ||
    typeof source.benchmarkFlips !== 'undefined'
  ) {
    benchmarkFlips = normalizeDeveloperLocalBenchmarkSize(
      source.benchmark_flips ?? source.benchmarkFlips
    )
  }

  return {
    expected_answer: ['left', 'right', 'skip'].includes(expectedAnswer)
      ? expectedAnswer
      : '',
    ai_prediction: ['left', 'right', 'skip'].includes(aiPrediction)
      ? aiPrediction
      : '',
    baseline_prediction: ['left', 'right', 'skip'].includes(baselinePrediction)
      ? baselinePrediction
      : '',
    previous_prediction: ['left', 'right', 'skip'].includes(previousPrediction)
      ? previousPrediction
      : '',
    benchmark_flips: benchmarkFlips,
    evaluated_at: String(source.evaluated_at ?? source.evaluatedAt ?? '')
      .trim()
      .slice(0, 64),
    change_type: String(source.change_type ?? source.changeType ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/gu, '_')
      .slice(0, 64),
    ai_correct: normalizeAnnotationDraftBool(
      source.ai_correct ?? source.aiCorrect
    ),
  }
}

function normalizeBenchmarkReviewDraftLayer(
  benchmarkReview = {},
  annotationAliases = {}
) {
  const source =
    benchmarkReview && typeof benchmarkReview === 'object'
      ? benchmarkReview
      : {}
  const aliases =
    annotationAliases && typeof annotationAliases === 'object'
      ? annotationAliases
      : {}
  const correction =
    source.correction && typeof source.correction === 'object'
      ? source.correction
      : {}
  let includeForTrainingSource
  if (typeof correction.include_for_training !== 'undefined') {
    includeForTrainingSource = correction.include_for_training
  } else if (typeof correction.includeForTraining !== 'undefined') {
    includeForTrainingSource = correction.includeForTraining
  } else {
    includeForTrainingSource =
      aliases.benchmark_review_include_for_training ??
      aliases.benchmarkReviewIncludeForTraining
  }

  return {
    context: normalizeBenchmarkReviewContextDraft(
      source.context || source.source || source
    ),
    correction: {
      issue_type: normalizeBenchmarkReviewIssueType(
        correction.issue_type ??
          correction.issueType ??
          aliases.benchmark_review_issue_type ??
          aliases.benchmarkReviewIssueType
      ),
      failure_note: String(
        correction.failure_note ??
          correction.failureNote ??
          aliases.benchmark_review_failure_note ??
          aliases.benchmarkReviewFailureNote ??
          ''
      )
        .trim()
        .slice(0, 900),
      retraining_hint: String(
        correction.retraining_hint ??
          correction.retrainingHint ??
          aliases.benchmark_review_retraining_hint ??
          aliases.benchmarkReviewRetrainingHint ??
          ''
      )
        .trim()
        .slice(0, 900),
      include_for_training: normalizeAnnotationDraftBool(
        includeForTrainingSource
      ),
    },
  }
}

function getBenchmarkReviewRequiredFieldKeys(value = []) {
  return normalizeDeveloperBenchmarkReviewRequiredFields(value, {
    fallbackToDefault: false,
  })
}

function getBenchmarkReviewMissingFields(
  annotation = {},
  requiredFieldKeys = []
) {
  const next = normalizeAnnotationDraft(annotation)
  const required = getBenchmarkReviewRequiredFieldKeys(requiredFieldKeys)
  const missingFields = []

  if (
    required.includes('benchmark_review_issue_type') &&
    !next.benchmark_review_issue_type
  ) {
    missingFields.push('benchmark_review_issue_type')
  }

  if (
    required.includes('benchmark_review_failure_note') &&
    !String(next.benchmark_review_failure_note || '').trim()
  ) {
    missingFields.push('benchmark_review_failure_note')
  }

  if (
    required.includes('benchmark_review_retraining_hint') &&
    !String(next.benchmark_review_retraining_hint || '').trim()
  ) {
    missingFields.push('benchmark_review_retraining_hint')
  }

  if (
    required.includes('benchmark_review_include_for_training') &&
    next.benchmark_review_include_for_training === null
  ) {
    missingFields.push('benchmark_review_include_for_training')
  }

  return missingFields
}

function normalizeAnnotationDraft(annotation = {}) {
  const next = {
    ...createEmptyAnnotationDraft(),
    ...(annotation && typeof annotation === 'object' ? annotation : {}),
  }
  const benchmarkReview = normalizeBenchmarkReviewDraftLayer(
    next.benchmark_review ?? next.benchmarkReview,
    next
  )
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
    benchmark_review: benchmarkReview,
    benchmarkReview,
    benchmark_review_issue_type: benchmarkReview.correction.issue_type,
    benchmark_review_failure_note: benchmarkReview.correction.failure_note,
    benchmark_review_retraining_hint:
      benchmarkReview.correction.retraining_hint,
    benchmark_review_include_for_training:
      benchmarkReview.correction.include_for_training,
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
      next.benchmark_review_issue_type ||
      next.benchmark_review_failure_note.trim() ||
      next.benchmark_review_retraining_hint.trim() ||
      next.benchmark_review_include_for_training !== null ||
      next.text_required !== null ||
      next.sequence_markers_present !== null ||
      next.report_required !== null ||
      next.confidence !== ''
  )
}

function getAnnotationCompletionState(
  annotation = {},
  {benchmarkReviewRequiredFields = []} = {}
) {
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
  ]
  const missingRequiredFields = []

  if (!hasDecision) {
    missingRequiredFields.push('final_answer')
  }

  if (!hasReason) {
    missingRequiredFields.push('why_answer')
  }

  if (!hasTextDecision) {
    missingRequiredFields.push('text_required')
  }

  if (!hasSequenceDecision) {
    missingRequiredFields.push('sequence_markers_present')
  }

  if (!hasReportDecision) {
    missingRequiredFields.push('report_required')
  } else if (!hasReportReason) {
    missingRequiredFields.push('report_reason')
  }

  if (!hasConfidence) {
    missingRequiredFields.push('confidence')
  }
  const benchmarkReviewMissingFields = getBenchmarkReviewMissingFields(
    next,
    benchmarkReviewRequiredFields
  )
  missingRequiredFields.push(...benchmarkReviewMissingFields)
  const hasOptionalDetailContent =
    filledFrameCaptions > 0 || hasOptionASummary || hasOptionBSummary
  const optionalDetailComplete = hasFrameCaptions && hasStorySummaries
  const benchmarkReviewRequirements = getBenchmarkReviewRequiredFieldKeys(
    benchmarkReviewRequiredFields
  )
  const hasBenchmarkReviewRequirements = benchmarkReviewRequirements.length > 0
  const benchmarkReviewComplete = benchmarkReviewMissingFields.length === 0
  const benchmarkReviewCompletedChecks =
    benchmarkReviewRequirements.length - benchmarkReviewMissingFields.length
  if (hasBenchmarkReviewRequirements) {
    checks.push(benchmarkReviewComplete)
  }

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
    benchmarkReviewRequirements,
    benchmarkReviewCompletedChecks,
    benchmarkReviewTotalChecks: benchmarkReviewRequirements.length,
    hasBenchmarkReviewRequirements,
    benchmarkReviewComplete,
    hasOptionalDetailContent,
    optionalDetailComplete,
    missingRequiredFields,
    completedOptionalChecks: [hasFrameCaptions, hasStorySummaries].filter(
      Boolean
    ).length,
    totalOptionalChecks: 2,
    completedChecks: checks.filter(Boolean).length,
    totalChecks: checks.length,
    remainingChecks: checks.filter((item) => !item).length,
    isComplete: checks.every(Boolean),
  }
}

function getRequiredFieldLabel(fieldKey, t) {
  switch (String(fieldKey || '').trim()) {
    case 'final_answer':
      return t('answer')
    case 'why_answer':
      return t('reason')
    case 'text_required':
      return t('text check')
    case 'sequence_markers_present':
      return t('sequence check')
    case 'report_required':
      return t('report check')
    case 'report_reason':
      return t('report reason')
    case 'confidence':
      return t('confidence')
    case 'benchmark_review_issue_type':
      return t('issue type')
    case 'benchmark_review_failure_note':
      return t('failure note')
    case 'benchmark_review_retraining_hint':
      return t('retraining hint')
    case 'benchmark_review_include_for_training':
      return t('retraining choice')
    default:
      return String(fieldKey || '').trim()
  }
}

function formatBenchmarkReviewIssueTypeLabel(value, t) {
  switch (String(value || '').trim()) {
    case 'wrong_answer':
      return t('Wrong answer')
    case 'missed_text':
      return t('Missed text')
    case 'sequence_confusion':
      return t('Sequence confusion')
    case 'reportability_miss':
      return t('Reportability miss')
    case 'weak_reasoning':
      return t('Weak reasoning')
    case 'panel_read_failure':
      return t('Panel read failure')
    case 'ambiguous_flip':
      return t('Ambiguous flip')
    case 'other':
      return t('Other')
    default:
      return t('Not set')
  }
}

function formatMissingRequiredFields(t, fieldKeys = []) {
  const labels = Array.from(
    new Set(
      (Array.isArray(fieldKeys) ? fieldKeys : [])
        .map((fieldKey) => getRequiredFieldLabel(fieldKey, t))
        .filter(Boolean)
    )
  )

  return labels.join(', ')
}

function isCompleteDraft(annotation = {}, options = {}) {
  return getAnnotationCompletionState(annotation, options).isComplete
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

function extractBalancedJsonSlice(text = '', startIndex = 0) {
  const raw = String(text || '')
  const startChar = raw[startIndex]

  if (startChar !== '{' && startChar !== '[') {
    return null
  }

  const closingChar = startChar === '{' ? '}' : ']'
  let depth = 0
  let inString = false
  let isEscaped = false

  for (let index = startIndex; index < raw.length; index += 1) {
    const char = raw[index]

    if (inString) {
      if (isEscaped) {
        isEscaped = false
      } else if (char === '\\') {
        isEscaped = true
      } else if (char === '"') {
        inString = false
      }
    } else if (char === '"') {
      inString = true
    } else if (char === startChar) {
      depth += 1
    } else if (char === closingChar) {
      depth -= 1

      if (depth === 0) {
        return raw.slice(startIndex, index + 1)
      }
    }
  }

  return null
}

function extractJsonFromMixedText(text = '') {
  const raw = String(text || '')
  const openers = new Set(['{', '['])

  for (let index = 0; index < raw.length; index += 1) {
    if (openers.has(raw[index])) {
      const candidate = extractBalancedJsonSlice(raw, index)

      if (candidate) {
        try {
          return JSON.parse(candidate)
        } catch {
          // Keep scanning. Local models sometimes emit one malformed object
          // before the usable JSON body.
        }
      }
    }
  }

  return null
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
      return null
    }
    return JSON.parse(String(match[1] || '').trim())
  }
  const fromMixedText = () => extractJsonFromMixedText(raw)
  const preview = raw.replace(/\s+/gu, ' ').trim().slice(0, 220)

  try {
    return direct()
  } catch {
    try {
      const fenced = fromFence()
      if (fenced) {
        return fenced
      }
    } catch {
      // Fall through to mixed-text extraction.
    }
  }

  const embedded = fromMixedText()

  if (embedded) {
    return embedded
  }

  throw new Error(
    `No JSON object found in the Local AI draft response. Preview: ${
      preview || 'empty response'
    }`
  )
}

const AI_ANNOTATION_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'ordered_panel_descriptions',
    'ordered_panel_text',
    'option_a_story_analysis',
    'option_b_story_analysis',
    'final_answer',
    'why_answer',
    'confidence',
    'text_required',
    'sequence_markers_present',
    'report_required',
    'report_reason',
    'option_a_summary',
    'option_b_summary',
  ],
  properties: {
    ordered_panel_descriptions: {
      type: 'array',
      minItems: 8,
      maxItems: 8,
      items: {type: 'string'},
    },
    ordered_panel_text: {
      type: 'array',
      minItems: 8,
      maxItems: 8,
      items: {type: 'string'},
    },
    option_a_story_analysis: {type: 'string'},
    option_b_story_analysis: {type: 'string'},
    final_answer: {
      type: 'string',
      enum: ['left', 'right', 'skip'],
    },
    why_answer: {type: 'string'},
    confidence: {
      anyOf: [
        {type: 'integer', minimum: 1, maximum: 5},
        {type: 'number', minimum: 1, maximum: 5},
      ],
    },
    text_required: {type: 'boolean'},
    sequence_markers_present: {type: 'boolean'},
    report_required: {type: 'boolean'},
    report_reason: {type: 'string'},
    option_a_summary: {type: 'string'},
    option_b_summary: {type: 'string'},
  },
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
    'Do not add explanations before or after the JSON. Do not wrap the JSON in markdown.',
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
    const keys =
      aiAnnotation &&
      typeof aiAnnotation === 'object' &&
      !Array.isArray(aiAnnotation)
        ? Object.keys(aiAnnotation).slice(0, 12)
        : []
    const keyPreview = keys.length > 0 ? ` Keys: ${keys.join(', ')}` : ''

    throw new Error(
      `Local AI returned a draft object without usable annotation fields.${keyPreview}`
    )
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

function pickPreferredTaskId(
  workspace,
  preferredTaskId = '',
  {allowCompletedPreferred = false} = {}
) {
  const tasks =
    workspace && Array.isArray(workspace.tasks) ? workspace.tasks : []

  if (!tasks.length) {
    return ''
  }

  const preferredTask = preferredTaskId
    ? tasks.find((task) => task.taskId === preferredTaskId)
    : null
  const nextIncompleteTask = tasks.find((task) => !task.isComplete)

  if (
    preferredTask &&
    (allowCompletedPreferred ||
      !preferredTask.isComplete ||
      !nextIncompleteTask)
  ) {
    return preferredTaskId
  }

  return nextIncompleteTask ? nextIncompleteTask.taskId : tasks[0].taskId
}

function getHumanTeacherTaskNumberLabel(taskId = '') {
  const raw = String(taskId || '').trim()

  if (!raw) {
    return ''
  }

  const lastSegment = raw.split(':').pop()
  const parsed = Number.parseInt(lastSegment, 10)

  return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : raw
}

function describeIncompleteWorkspaceTasks(workspace, t) {
  const incompleteTasks =
    workspace && Array.isArray(workspace.tasks)
      ? workspace.tasks.filter((task) => !task.isComplete)
      : []

  if (!incompleteTasks.length) {
    return t('The saved chunk still has unfinished flips.')
  }

  const labels = incompleteTasks
    .slice(0, 5)
    .map((task) => getHumanTeacherTaskNumberLabel(task.taskId))
    .filter(Boolean)
  const detailedItems = incompleteTasks
    .slice(0, 3)
    .map((task) => {
      const taskLabel = getHumanTeacherTaskNumberLabel(task.taskId)
      const missingLabel = formatMissingRequiredFields(
        t,
        task.missingRequiredFields
      )

      if (!taskLabel || !missingLabel) {
        return ''
      }

      return t('Flip {{label}}: {{fields}}', {
        label: taskLabel,
        fields: missingLabel,
      })
    })
    .filter(Boolean)

  if (incompleteTasks.length === 1 && labels[0]) {
    const detailedLabel =
      formatMissingRequiredFields(
        t,
        incompleteTasks[0]?.missingRequiredFields
      ) || t('one or more required answer fields')

    return t(
      'Flip {{label}} still needs {{fields}} before this chunk can train.',
      {
        label: labels[0],
        fields: detailedLabel,
      }
    )
  }

  if (detailedItems.length) {
    return detailedItems.join(' · ')
  }

  if (labels.length && incompleteTasks.length <= 5) {
    return t(
      'Flips {{labels}} still miss one or more required answer fields before this chunk can train.',
      {
        labels: labels.join(', '),
      }
    )
  }

  return t(
    '{{count}} flips in this chunk still miss one or more required answer fields before training can start.',
    {
      count: incompleteTasks.length,
    }
  )
}

function isIncompleteDeveloperChunkError(message = '') {
  return /Complete all 5 developer training flips before committing this chunk/i.test(
    String(message || '')
  )
}

function isIncompleteDemoChunkError(message = '') {
  return /Complete all 5 demo flips before finishing this chunk/i.test(
    String(message || '')
  )
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

function normalizeDeveloperTrainingReadiness(telemetry, t) {
  const source =
    telemetry &&
    typeof telemetry.trainingReadiness === 'object' &&
    !Array.isArray(telemetry.trainingReadiness)
      ? telemetry.trainingReadiness
      : null

  if (!source) {
    return {
      status: 'unknown',
      tone: 'gray',
      label: t('Telemetry unavailable'),
      message: t(
        'The app cannot verify local heat, power, or memory conditions yet.'
      ),
      requiresExplicitOverride: false,
      canStartWithoutOverride: true,
    }
  }

  return {
    status: String(source.status || 'unknown').trim(),
    tone: String(source.tone || 'gray').trim(),
    label: String(source.label || '').trim() || t('Telemetry unavailable'),
    message:
      String(source.message || '').trim() ||
      t('The app cannot verify local heat, power, or memory conditions yet.'),
    requiresExplicitOverride: source.requiresExplicitOverride === true,
    canStartWithoutOverride: source.canStartWithoutOverride !== false,
  }
}

function getTrainingReadinessBadgeScheme(tone = 'gray') {
  switch (tone) {
    case 'red':
      return 'red'
    case 'orange':
      return 'orange'
    case 'yellow':
      return 'yellow'
    case 'green':
      return 'green'
    case 'blue':
      return 'blue'
    default:
      return 'gray'
  }
}

function describeDeveloperThermalTelemetry(system, t) {
  const thermal =
    system &&
    typeof system.thermal === 'object' &&
    !Array.isArray(system.thermal)
      ? system.thermal
      : {}
  const cpuUsagePercent = Number(system?.cpuUsagePercent)
  const gpuUsagePercent = Number(system?.gpuUsagePercent)
  const memoryUsagePercent = Number(system?.memoryUsagePercent)
  const battery =
    system &&
    typeof system.battery === 'object' &&
    !Array.isArray(system.battery)
      ? system.battery
      : {}
  const batteryPercent = Number(battery.percent)
  const pressure = String(thermal.pressure || 'unavailable').trim()
  const cpuSpeedLimit = Number(thermal.cpuSpeedLimit)
  const schedulerLimit = Number(thermal.schedulerLimit)
  const thermalLevel = Number(thermal.thermalLevel)
  const detailParts = []
  const inferredHeatSignals = []

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

  if (Number.isFinite(gpuUsagePercent) && gpuUsagePercent >= 85) {
    inferredHeatSignals.push(
      t('GPU {{value}}', {
        value: formatPercentMetric(gpuUsagePercent),
      })
    )
  }

  if (Number.isFinite(cpuUsagePercent) && cpuUsagePercent >= 70) {
    inferredHeatSignals.push(
      t('CPU {{value}}', {
        value: formatPercentMetric(cpuUsagePercent),
      })
    )
  }

  if (Number.isFinite(memoryUsagePercent) && memoryUsagePercent >= 90) {
    inferredHeatSignals.push(
      t('Memory {{value}}', {
        value: formatPercentMetric(memoryUsagePercent),
      })
    )
  }

  if (
    battery.available &&
    battery.isCharging === false &&
    Number.isFinite(batteryPercent) &&
    batteryPercent <= 20
  ) {
    inferredHeatSignals.push(
      t('Battery {{value}}', {
        value: `${batteryPercent}%`,
      })
    )
  }

  if (!thermal.available) {
    return {
      title: t('Thermal pressure'),
      value: inferredHeatSignals.length
        ? t('Hot under load')
        : t('Unavailable'),
      detail: inferredHeatSignals.length
        ? t(
            'macOS did not expose a thermal flag, but this run still looks hot: {{signals}}.',
            {
              signals: inferredHeatSignals.join(' · '),
            }
          )
        : t('macOS thermal telemetry has not been reported yet.'),
      tone: inferredHeatSignals.length ? 'orange' : 'gray',
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

  if (inferredHeatSignals.length >= 2) {
    return {
      title: t('Thermal pressure'),
      value: t('Hot under load'),
      detail: t(
        'macOS has not raised a throttle flag yet, but this run already looks heat-heavy: {{signals}}.',
        {
          signals: inferredHeatSignals.join(' · '),
        }
      ),
      tone: 'orange',
    }
  }

  if (inferredHeatSignals.length === 1) {
    return {
      title: t('Thermal pressure'),
      value: t('Heating up'),
      detail: t(
        'No macOS throttle flag yet, but this signal already points to a hotter run: {{signals}}.',
        {
          signals: inferredHeatSignals.join(' · '),
        }
      ),
      tone: 'yellow',
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

function describeDeveloperCpuTelemetry(system, t) {
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
    title: t('CPU load'),
    value,
    detail:
      detailParts.join(' · ') ||
      t('CPU telemetry will appear after the next sample.'),
    tone,
  }
}

function describeDeveloperGpuTelemetry(system, t) {
  const gpuUsagePercent = Number(system?.gpuUsagePercent)
  const gpu =
    system && typeof system.gpu === 'object' && !Array.isArray(system.gpu)
      ? system.gpu
      : {}
  const rendererUtilizationPercent = Number(gpu.rendererUtilizationPercent)
  const tilerUtilizationPercent = Number(gpu.tilerUtilizationPercent)
  const detailParts = []
  let tone = 'gray'

  if (Number.isFinite(gpuUsagePercent) && gpuUsagePercent >= 85) {
    tone = 'red'
  } else if (Number.isFinite(gpuUsagePercent) && gpuUsagePercent >= 65) {
    tone = 'orange'
  } else if (Number.isFinite(gpuUsagePercent) && gpuUsagePercent >= 35) {
    tone = 'yellow'
  } else if (Number.isFinite(gpuUsagePercent)) {
    tone = 'green'
  }

  if (Number.isFinite(rendererUtilizationPercent)) {
    detailParts.push(
      t('Renderer {{value}}', {
        value: formatPercentMetric(rendererUtilizationPercent),
      })
    )
  }

  if (Number.isFinite(tilerUtilizationPercent)) {
    detailParts.push(
      t('Tiler {{value}}', {
        value: formatPercentMetric(tilerUtilizationPercent),
      })
    )
  }

  return {
    title: t('GPU load'),
    value: Number.isFinite(gpuUsagePercent)
      ? t('{{value}} GPU', {
          value: formatPercentMetric(gpuUsagePercent),
        })
      : t('Unavailable'),
    detail:
      detailParts.join(' · ') ||
      t('macOS GPU telemetry will appear after the next sample.'),
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
  const keyHelpContent = [
    t('Saved answers: flips you already labeled.'),
    t('Waiting to learn: saved flips not inside the model yet.'),
    t('Already learned: flips already trained into the active model.'),
  ]

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
            <HeadingWithHelp
              title={title}
              titleProps={{fontWeight: 600}}
              helpLabel={t('Local training flow')}
              helpContent={subtitle}
            />
            <Text color="muted" fontSize="sm">
              {t('Teach 5 flips, train, then test.')}
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
            <HeadingWithHelp
              title={t('Plain-language key')}
              titleProps={{fontSize: 'sm', fontWeight: 600}}
              helpLabel={t('Local training counters')}
              helpContent={keyHelpContent}
            />
            <Text color="muted" fontSize="xs">
              {t('Tap the help icon if the counters feel unclear.')}
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
    describeDeveloperCpuTelemetry(system, t),
    describeDeveloperGpuTelemetry(system, t),
    describeDeveloperMemoryTelemetry(system, t),
    describeDeveloperPowerTelemetry(system, t),
  ]
  const note = describeDeveloperTelemetryNotice({
    telemetry,
    thermalSummary,
    isBusy,
    t,
  })
  const trainingReadiness = normalizeDeveloperTrainingReadiness(telemetry, t)
  const readinessToneProps = getTelemetryToneProps(trainingReadiness.tone)

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
            <Box
              borderWidth="1px"
              borderColor={readinessToneProps.borderColor}
              borderRadius="md"
              px={3}
              py={3}
              bg={readinessToneProps.bg}
            >
              <Stack spacing={2}>
                <Flex
                  justify="space-between"
                  align={['flex-start', 'center']}
                  direction={['column', 'row']}
                  gap={2}
                >
                  <Text fontSize="sm" fontWeight={600}>
                    {t('Training readiness')}
                  </Text>
                  <Badge
                    colorScheme={getTrainingReadinessBadgeScheme(
                      trainingReadiness.tone
                    )}
                    borderRadius="full"
                    px={2}
                    py={1}
                  >
                    {trainingReadiness.label}
                  </Badge>
                </Flex>
                <Text fontSize="sm">{trainingReadiness.message}</Text>
                {trainingReadiness.requiresExplicitOverride ? (
                  <Text color="muted" fontSize="xs">
                    {t(
                      'The start button will stay locked until you explicitly confirm that you still want to run one local training pass.'
                    )}
                  </Text>
                ) : null}
              </Stack>
            </Box>
            <SimpleGrid columns={[1, 2, 5]} spacing={3}>
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

function describeDeveloperActiveRun(activeRun, t) {
  if (!activeRun || typeof activeRun !== 'object' || Array.isArray(activeRun)) {
    return null
  }

  const kind = String(activeRun.kind || '')
    .trim()
    .toLowerCase()
  const status = String(activeRun.status || '')
    .trim()
    .toLowerCase()
  const stage = String(activeRun.stage || '')
    .trim()
    .toLowerCase()
  const stageIndex = Number(activeRun.stageIndex)
  const stageCount = Number(activeRun.stageCount)
  const progressPercent = Number(activeRun.progressPercent)
  const currentEpoch = Number(activeRun.currentEpoch)
  const totalEpochs = Number(activeRun.totalEpochs)
  const currentStep = Number(activeRun.currentStep)
  const stepsPerEpoch = Number(activeRun.stepsPerEpoch)
  const totalSteps = Number(activeRun.totalSteps)
  const latestLoss = Number(activeRun.latestLoss)
  const benchmarkCurrent = Number(activeRun.benchmarkCurrent)
  const benchmarkTotal = Number(activeRun.benchmarkTotal)
  const chunkOffset = Number(activeRun.chunkOffset)
  const chunkSize = Number(activeRun.chunkSize)
  const evaluationFlips = Number(activeRun.evaluationFlips)
  const currentFlipHash = String(activeRun.currentFlipHash || '').trim()
  const benchmarkPhase = String(activeRun.benchmarkPhase || '')
    .trim()
    .toLowerCase()
  const message = String(activeRun.message || '').trim()
  const startedAt = String(activeRun.startedAt || '').trim() || null
  const stageStartedAt = String(activeRun.stageStartedAt || '').trim() || null

  let badgeLabel =
    kind === 'comparison' ? t('Benchmark live') : t('Training live')
  let badgeScheme = kind === 'comparison' ? 'purple' : 'blue'
  let title =
    kind === 'comparison' ? t('Local benchmark run') : t('Local training run')
  let detail =
    message ||
    (kind === 'comparison'
      ? t('Running the unseen-flip benchmark now.')
      : t('Training and checking the local model now.'))

  if (status === 'stopping') {
    badgeLabel = t('Stopping')
    badgeScheme = 'red'
    detail = message || t('The app is stopping this local run now.')
  }

  if (stage === 'prepare_training_dataset') {
    title = t('Building the 5-flip training pack')
    detail =
      message ||
      t(
        'The app is turning your saved flip answers into a local training dataset.'
      )
  } else if (stage === 'train_adapter') {
    title = t('Training the local adapter')
    detail =
      message ||
      t(
        'The computer is practicing on this 5-flip pack before the benchmark starts.'
      )
  } else if (stage === 'prepare_holdout') {
    title = t('Preparing the unseen benchmark flips')
    detail =
      message ||
      t(
        'The app is loading the unseen holdout that will be used for the score check.'
      )
  } else if (stage === 'benchmark_baseline') {
    title = t('Benchmarking the baseline model')
    detail =
      message ||
      t('The same unseen flips are being scored with the baseline model first.')
    badgeLabel = t('Baseline benchmark')
    badgeScheme = 'purple'
  } else if (stage === 'benchmark_adapter') {
    title = t('Benchmarking the trained adapter')
    detail =
      message ||
      t(
        'The same unseen flips are now being scored with the freshly trained adapter.'
      )
    badgeLabel = t('Adapter benchmark')
    badgeScheme = kind === 'comparison' ? 'purple' : 'green'
  }

  const summaryParts = []

  if (
    Number.isFinite(stageIndex) &&
    Number.isFinite(stageCount) &&
    stageCount > 0
  ) {
    summaryParts.push(
      t('Stage {{current}} of {{total}}', {
        current: stageIndex,
        total: stageCount,
      })
    )
  }

  if (Number.isFinite(currentEpoch) && Number.isFinite(totalEpochs)) {
    summaryParts.push(
      t('Epoch {{current}} of {{total}}', {
        current: currentEpoch,
        total: totalEpochs,
      })
    )
  }

  if (Number.isFinite(currentStep) && Number.isFinite(stepsPerEpoch)) {
    summaryParts.push(
      t('Step {{current}} of {{total}}', {
        current: currentStep,
        total: stepsPerEpoch,
      })
    )
  }

  if (Number.isFinite(totalSteps) && totalSteps > 0) {
    summaryParts.push(
      t('{{count}} total updates', {
        count: formatCountMetric(totalSteps),
      })
    )
  }

  let benchmarkSummary = t(
    'This benchmark reuses the same unseen holdout for baseline and trained scoring so the score stays comparable.'
  )

  if (Number.isFinite(benchmarkCurrent) && Number.isFinite(benchmarkTotal)) {
    benchmarkSummary = t(
      '{{phase}}: unseen flip {{current}} of {{total}}{{hash}}',
      {
        phase:
          benchmarkPhase === 'adapter' ? t('Adapter pass') : t('Baseline pass'),
        current: benchmarkCurrent,
        total: benchmarkTotal,
        hash: currentFlipHash ? ` · ${currentFlipHash}` : '',
      }
    )
  } else if (Number.isFinite(evaluationFlips)) {
    benchmarkSummary = t(
      'This benchmark reuses the same {{count}} unseen flips for baseline and trained scoring so the score stays comparable.',
      {
        count: evaluationFlips,
      }
    )
  }

  const chunkSummary =
    Number.isFinite(chunkOffset) && Number.isFinite(chunkSize) && chunkSize > 0
      ? t('Teaching chunk: flips {{from}}-{{to}}', {
          from: chunkOffset + 1,
          to: chunkOffset + chunkSize,
        })
      : null

  return {
    badgeLabel,
    badgeScheme,
    title,
    detail,
    progressPercent:
      Number.isFinite(progressPercent) && progressPercent >= 0
        ? Math.min(100, Math.max(0, progressPercent))
        : null,
    summary: summaryParts.join(' · ') || null,
    benchmarkSummary,
    chunkSummary,
    lossLabel:
      Number.isFinite(latestLoss) && latestLoss >= 0
        ? t('Latest loss {{value}}', {
            value: latestLoss.toFixed(4),
          })
        : null,
    startedAt,
    stageStartedAt,
    updatedAt: activeRun.updatedAt || null,
    status,
  }
}

function getDeveloperRunAgeMs(activeRun = null) {
  const updatedAt = String(activeRun?.updatedAt || '').trim()

  if (!updatedAt) {
    return null
  }

  const updatedAtMs = new Date(updatedAt).getTime()

  if (!Number.isFinite(updatedAtMs)) {
    return null
  }

  const ageMs = Date.now() - updatedAtMs
  return ageMs >= 0 ? ageMs : null
}

function getDeveloperRunElapsedMs(activeRun, {preferStage = true} = {}) {
  const raw = String(
    preferStage
      ? activeRun?.stageStartedAt || activeRun?.startedAt || ''
      : activeRun?.startedAt || activeRun?.stageStartedAt || ''
  ).trim()

  if (!raw) {
    return null
  }

  const startedAtMs = new Date(raw).getTime()

  if (!Number.isFinite(startedAtMs)) {
    return null
  }

  const elapsedMs = Date.now() - startedAtMs
  return elapsedMs >= 0 ? elapsedMs : null
}

function formatRuntimeCountdownMs(value) {
  const parsed = Number.parseInt(value, 10)

  if (!Number.isFinite(parsed) || parsed < 0) {
    return 'n/a'
  }

  const totalSeconds = Math.max(1, Math.round(parsed / 1000))

  if (totalSeconds < 60) {
    return `${totalSeconds}s`
  }

  const totalMinutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  if (totalMinutes < 60) {
    return seconds > 0 ? `${totalMinutes}m ${seconds}s` : `${totalMinutes}m`
  }

  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
}

function formatClockTime(value) {
  const raw = String(value || '').trim()

  if (!raw) {
    return 'n/a'
  }

  const parsed = new Date(raw)

  if (!Number.isFinite(parsed.getTime())) {
    return raw
  }

  return parsed.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function describeDeveloperRunEta(activeRun, t) {
  const status = String(activeRun?.status || '')
    .trim()
    .toLowerCase()
  const elapsedMs = getDeveloperRunElapsedMs(activeRun, {preferStage: true})

  if (!elapsedMs || (status !== 'running' && status !== 'stopping')) {
    return {
      available: false,
      title: t('Time estimate'),
      value: t('Waiting'),
      detail: t('The app needs more live progress before it can estimate.'),
      footnote: null,
      remainingMs: null,
      finishAt: null,
    }
  }

  const benchmarkCurrent = Number(activeRun?.benchmarkCurrent)
  const benchmarkTotal = Number(activeRun?.benchmarkTotal)
  const currentEpoch = Number(activeRun?.currentEpoch)
  const currentStep = Number(activeRun?.currentStep)
  const stepsPerEpoch = Number(activeRun?.stepsPerEpoch)
  const totalSteps = Number(activeRun?.totalSteps)
  const progressPercent = Number(activeRun?.progressPercent)

  let fractionComplete = null
  let basisLabel = null

  if (
    Number.isFinite(benchmarkCurrent) &&
    benchmarkCurrent > 0 &&
    Number.isFinite(benchmarkTotal) &&
    benchmarkTotal > 0
  ) {
    fractionComplete = Math.min(1, benchmarkCurrent / benchmarkTotal)
    basisLabel = t(
      'Based on {{current}} of {{total}} benchmark flips so far.',
      {
        current: benchmarkCurrent,
        total: benchmarkTotal,
      }
    )
  } else if (
    Number.isFinite(currentEpoch) &&
    currentEpoch > 0 &&
    Number.isFinite(currentStep) &&
    currentStep > 0 &&
    Number.isFinite(totalSteps) &&
    totalSteps > 0
  ) {
    const normalizedStepsPerEpoch =
      Number.isFinite(stepsPerEpoch) && stepsPerEpoch > 0
        ? stepsPerEpoch
        : totalSteps
    const completedSteps =
      (currentEpoch - 1) * normalizedStepsPerEpoch +
      Math.min(currentStep, normalizedStepsPerEpoch)
    fractionComplete = Math.min(1, completedSteps / totalSteps)
    basisLabel = t('Based on {{current}} of {{total}} update steps so far.', {
      current: completedSteps,
      total: totalSteps,
    })
  } else if (Number.isFinite(progressPercent) && progressPercent > 0) {
    fractionComplete = Math.min(1, progressPercent / 100)
    basisLabel = t('Based on {{percent}} of this stage so far.', {
      percent: formatPercentMetric(progressPercent, 0),
    })
  }

  if (!Number.isFinite(fractionComplete) || fractionComplete <= 0.02) {
    return {
      available: false,
      title: t('Time estimate'),
      value: t('Measuring'),
      detail: t('Elapsed {{elapsed}}', {
        elapsed: formatRuntimeCountdownMs(elapsedMs),
      }),
      footnote: t('The app will estimate once more of this stage is complete.'),
      remainingMs: null,
      finishAt: null,
    }
  }

  const remainingMs = Math.max(
    0,
    Math.round((elapsedMs / fractionComplete) * (1 - fractionComplete))
  )
  const finishAt = new Date(Date.now() + remainingMs).toISOString()

  return {
    available: true,
    title: t('Time estimate'),
    value:
      remainingMs <= 0
        ? t('Finishing now')
        : t('About {{remaining}} left', {
            remaining: formatRuntimeCountdownMs(remainingMs),
          }),
    detail: t('Elapsed {{elapsed}} · finish around {{time}}', {
      elapsed: formatRuntimeCountdownMs(elapsedMs),
      time: formatClockTime(finishAt),
    }),
    footnote: basisLabel,
    remainingMs,
    finishAt,
  }
}

function describeDeveloperRunPlainAction(run, t) {
  if (!run) {
    return t('Waiting for the next local run.')
  }

  if (run.status === 'stopping') {
    return t('The app is stopping the current local run.')
  }

  if (run.title && run.detail) {
    return `${run.title} · ${run.detail}`
  }

  return run.detail || run.title || t('The local run is active.')
}

function describeDeveloperLiveInterpretation({
  telemetry = null,
  activeRun = null,
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
  const cpuUsagePercent = Number(system.cpuUsagePercent)
  const gpuUsagePercent = Number(system.gpuUsagePercent)
  const memoryUsagePercent = Number(system.memoryUsagePercent)
  const cpuSpeedLimit = Number(thermal.cpuSpeedLimit)
  const batteryPercent = Number(battery.percent)
  const runAgeMs = getDeveloperRunAgeMs(activeRun)

  if (
    String(activeRun?.status || '')
      .trim()
      .toLowerCase() === 'stopping'
  ) {
    return {
      tone: 'red',
      message: t(
        'Stop requested. The current Python job is being terminated now.'
      ),
    }
  }

  if (runAgeMs !== null && runAgeMs >= 3 * 60 * 1000) {
    return {
      tone: 'orange',
      message: t(
        'No new progress arrived for {{minutes}} min. This run may be slow or stuck on one flip.',
        {
          minutes: Math.max(1, Math.round(runAgeMs / (60 * 1000))),
        }
      ),
    }
  }

  if (
    String(thermal.pressure || '').trim() === 'limited' ||
    (Number.isFinite(cpuSpeedLimit) && cpuSpeedLimit < 100)
  ) {
    return {
      tone: 'red',
      message: Number.isFinite(cpuSpeedLimit)
        ? t(
            'macOS is heat-limiting the CPU to {{value}}%. Fan noise and slowdown are expected right now.',
            {
              value: cpuSpeedLimit,
            }
          )
        : t(
            'macOS is heat-limiting this Mac right now. Fan noise and slowdown are expected.'
          ),
    }
  }

  if (Number.isFinite(memoryUsagePercent) && memoryUsagePercent >= 90) {
    return {
      tone: 'orange',
      message: t(
        'RAM is almost full. This run may stall or become much slower until memory pressure drops.'
      ),
    }
  }

  if (
    (Number.isFinite(cpuUsagePercent) && cpuUsagePercent >= 70) ||
    (Number.isFinite(gpuUsagePercent) && gpuUsagePercent >= 70)
  ) {
    return {
      tone: 'blue',
      message: t(
        'Heavy compute load is normal here. Heat and fan noise usually rise during this part of the run.'
      ),
    }
  }

  if (battery.available && battery.isCharging === false) {
    return {
      tone: 'orange',
      message: Number.isFinite(batteryPercent)
        ? t(
            'The run is on battery at {{value}}. Expect drain and extra heat until you plug in or stop it.',
            {
              value: `${batteryPercent}%`,
            }
          )
        : t(
            'The run is on battery. Expect drain and extra heat until it stops.'
          ),
    }
  }

  return {
    tone: 'green',
    message: t(
      'The run still looks stable from the latest sample. Watch the progress and heat cards together.'
    ),
  }
}

function LocalTrainingStickyRunConsole({
  activeRun = null,
  telemetry = null,
  totalAvailableTasks = 0,
  onStopNow,
  onStopAfterUnit,
  onUpdateRunControls,
  pendingRunControl = null,
  isStopping = false,
  isUpdatingRunControls = false,
  t,
}) {
  const run = describeDeveloperActiveRun(activeRun, t)

  if (!run) {
    return null
  }

  const system =
    telemetry &&
    typeof telemetry.system === 'object' &&
    !Array.isArray(telemetry.system)
      ? telemetry.system
      : {}
  const stats = [
    describeDeveloperThermalTelemetry(system, t),
    describeDeveloperCpuTelemetry(system, t),
    describeDeveloperGpuTelemetry(system, t),
    describeDeveloperMemoryTelemetry(system, t),
    describeDeveloperPowerTelemetry(system, t),
  ]
  const interpretation = describeDeveloperLiveInterpretation({
    telemetry,
    activeRun,
    t,
  })
  const activeStage = String(activeRun?.stage || '')
    .trim()
    .toLowerCase()
  const activeKind = String(activeRun?.kind || '')
    .trim()
    .toLowerCase()
  const benchmarkPhase =
    activeKind === 'comparison' || activeStage.startsWith('benchmark_')
  const currentRunThermalMode = benchmarkPhase
    ? String(
        activeRun?.benchmarkThermalMode ||
          DEFAULT_DEVELOPER_LOCAL_BENCHMARK_THERMAL_MODE
      ).trim()
    : String(
        activeRun?.trainingThermalMode ||
          DEFAULT_DEVELOPER_LOCAL_TRAINING_THERMAL_MODE
      ).trim()
  const selectedRunThermalMode =
    pendingRunControl &&
    pendingRunControl.benchmarkPhase === benchmarkPhase &&
    String(pendingRunControl.mode || '').trim()
      ? String(pendingRunControl.mode || '').trim()
      : currentRunThermalMode
  const eta = describeDeveloperRunEta(activeRun, t)
  const interpretationTone = getTelemetryToneProps(interpretation.tone)
  const runAgeMs = getDeveloperRunAgeMs(activeRun)
  const staleMinutes =
    runAgeMs !== null ? Math.max(1, Math.round(runAgeMs / (60 * 1000))) : null
  const stopAfterUnitLabel = benchmarkPhase
    ? t('Stop after current flip')
    : t('Stop after current step')
  const stopControlsDisabled =
    isStopping ||
    String(activeRun?.status || '')
      .trim()
      .toLowerCase() === 'stopping'

  return (
    <Box position="sticky" top={0} zIndex={3}>
      <Box
        borderWidth="1px"
        borderColor="blue.100"
        borderRadius="2xl"
        p={4}
        bg="white"
        boxShadow="0 8px 24px rgba(15, 23, 42, 0.08)"
      >
        <Stack spacing={3}>
          <Flex
            justify="space-between"
            align={['flex-start', 'center']}
            direction={['column', 'row']}
            gap={3}
          >
            <Box>
              <Text fontWeight={700}>{run.title}</Text>
              <Text color="muted" fontSize="sm">
                {describeDeveloperRunPlainAction(run, t)}
              </Text>
            </Box>
            <Stack direction={['column', 'row']} spacing={2} align="center">
              {staleMinutes !== null && staleMinutes >= 3 ? (
                <Badge colorScheme="orange" borderRadius="full" px={2}>
                  {t('No update for {{count}} min', {count: staleMinutes})}
                </Badge>
              ) : null}
              <Badge colorScheme={run.badgeScheme} borderRadius="full" px={2}>
                {run.badgeLabel}
              </Badge>
              <SecondaryButton
                onClick={onStopAfterUnit}
                isLoading={isStopping}
                isDisabled={
                  stopControlsDisabled || typeof onStopAfterUnit !== 'function'
                }
                borderColor="orange.200"
                color="orange.700"
                _hover={{bg: 'orange.50'}}
              >
                {isStopping ? t('Stopping…') : stopAfterUnitLabel}
              </SecondaryButton>
              <SecondaryButton
                onClick={onStopNow}
                isLoading={isStopping}
                isDisabled={
                  stopControlsDisabled || typeof onStopNow !== 'function'
                }
                borderColor="red.200"
                color="red.600"
                _hover={{bg: 'red.50'}}
              >
                {isStopping ? t('Stopping…') : t('Cancel now')}
              </SecondaryButton>
            </Stack>
          </Flex>

          <Progress
            size="sm"
            value={run.progressPercent ?? undefined}
            isIndeterminate={!Number.isFinite(run.progressPercent)}
            colorScheme={run.badgeScheme}
            borderRadius="full"
          />

          {typeof onUpdateRunControls === 'function' ? (
            <Flex
              justify="space-between"
              align={['flex-start', 'center']}
              direction={['column', 'row']}
              gap={3}
            >
              <Box>
                <Text color="muted" fontSize="xs">
                  {benchmarkPhase
                    ? t('Benchmark speed now')
                    : t('Training speed now')}
                </Text>
                <Text color="muted" fontSize="xs">
                  {benchmarkPhase
                    ? t('Applies on the next unseen flip.')
                    : t('Applies on the next training step or epoch pause.')}
                </Text>
              </Box>
              <Box minW={['100%', '220px']}>
                <Select
                  size="sm"
                  value={selectedRunThermalMode}
                  onChange={(e) => onUpdateRunControls(e.target.value)}
                  isDisabled={isStopping || isUpdatingRunControls}
                >
                  <option value="full_speed">{t('Full speed')}</option>
                  <option value="balanced">{t('Balanced cooling')}</option>
                  <option value="cool">{t('Cool and slower')}</option>
                </Select>
                {isUpdatingRunControls ? (
                  <Text color="muted" fontSize="xs" mt={1}>
                    {t('Updating live run speed…')}
                  </Text>
                ) : null}
              </Box>
            </Flex>
          ) : null}

          <Text color="muted" fontSize="xs">
            {t(
              'Stopping ends this run. It does not pause it for resume later.'
            )}
          </Text>

          {run.summary ? <Text fontSize="sm">{run.summary}</Text> : null}

          <SimpleGrid columns={[1, 1, 2, 4]} spacing={3}>
            <Box
              borderWidth="1px"
              borderColor="gray.100"
              borderRadius="xl"
              px={3}
              py={3}
              bg="gray.50"
            >
              <Text color="muted" fontSize="xs">
                {t('What is happening now')}
              </Text>
              <Text fontSize="sm" fontWeight={700}>
                {run.benchmarkSummary || run.detail}
              </Text>
            </Box>
            <Box
              borderWidth="1px"
              borderColor="gray.100"
              borderRadius="xl"
              px={3}
              py={3}
              bg="gray.50"
            >
              <Text color="muted" fontSize="xs">
                {t('Current teaching chunk')}
              </Text>
              <Text fontSize="sm" fontWeight={700}>
                {run.chunkSummary || t('No 5-flip chunk is attached here.')}
              </Text>
              {totalAvailableTasks > 0 ? (
                <Text color="muted" fontSize="xs">
                  {t('Bundled sample size {{count}}', {
                    count: totalAvailableTasks,
                  })}
                </Text>
              ) : null}
            </Box>
            <Box
              borderWidth="1px"
              borderColor="gray.100"
              borderRadius="xl"
              px={3}
              py={3}
              bg="gray.50"
            >
              <Text color="muted" fontSize="xs">
                {eta.title}
              </Text>
              <Text fontSize="sm" fontWeight={700}>
                {eta.value}
              </Text>
              <Text color="muted" fontSize="xs">
                {eta.detail}
              </Text>
              {eta.footnote ? (
                <Text color="muted" fontSize="xs" mt={1}>
                  {eta.footnote}
                </Text>
              ) : null}
            </Box>
            <Box
              borderWidth="1px"
              borderColor="gray.100"
              borderRadius="xl"
              px={3}
              py={3}
              bg="gray.50"
            >
              <Text color="muted" fontSize="xs">
                {t('Latest live detail')}
              </Text>
              <Text fontSize="sm" fontWeight={700}>
                {run.lossLabel || t('Waiting for the next loss sample')}
              </Text>
              <Text color="muted" fontSize="xs">
                {run.updatedAt
                  ? `${t('Updated')}: ${formatTimestamp(run.updatedAt)}`
                  : t('Waiting for the first live update.')}
              </Text>
            </Box>
          </SimpleGrid>

          <SimpleGrid columns={[1, 2, 5]} spacing={3}>
            {stats.map((stat) => (
              <LocalTrainingImpactStatCard
                key={`sticky-${stat.title}`}
                title={stat.title}
                value={stat.value}
                detail={stat.detail}
                tone={stat.tone}
              />
            ))}
          </SimpleGrid>

          <Box
            borderWidth="1px"
            borderColor={interpretationTone.borderColor}
            borderRadius="xl"
            px={3}
            py={3}
            bg={interpretationTone.bg}
          >
            <Text fontSize="sm" fontWeight={600}>
              {interpretation.message}
            </Text>
          </Box>
        </Stack>
      </Box>
    </Box>
  )
}

function LocalTrainingRunPanel({activeRun, totalAvailableTasks = 0, t}) {
  const run = describeDeveloperActiveRun(activeRun, t)

  if (!run) {
    return null
  }

  return (
    <Box
      borderWidth="1px"
      borderColor="blue.100"
      borderRadius="md"
      p={4}
      bg="blue.50"
    >
      <Stack spacing={3}>
        <Flex
          justify="space-between"
          align={['flex-start', 'center']}
          direction={['column', 'row']}
          gap={2}
        >
          <Box>
            <Text fontWeight={700}>{run.title}</Text>
            <Text color="muted" fontSize="sm">
              {run.detail}
            </Text>
          </Box>
          <Badge colorScheme={run.badgeScheme} borderRadius="full" px={2}>
            {run.badgeLabel}
          </Badge>
        </Flex>

        <Progress
          size="sm"
          value={run.progressPercent ?? undefined}
          isIndeterminate={!Number.isFinite(run.progressPercent)}
          colorScheme={run.badgeScheme}
          borderRadius="full"
        />

        {run.summary ? <Text fontSize="sm">{run.summary}</Text> : null}

        <SimpleGrid columns={[1, 2, 2]} spacing={3}>
          <Box
            borderWidth="1px"
            borderColor="blue.100"
            borderRadius="md"
            px={3}
            py={2}
            bg="white"
          >
            <Text color="muted" fontSize="xs">
              {t('Current benchmark view')}
            </Text>
            <Text fontSize="sm" fontWeight={600}>
              {run.benchmarkSummary}
            </Text>
          </Box>
          <Box
            borderWidth="1px"
            borderColor="blue.100"
            borderRadius="md"
            px={3}
            py={2}
            bg="white"
          >
            <Text color="muted" fontSize="xs">
              {t('Current teaching chunk')}
            </Text>
            <Text fontSize="sm" fontWeight={600}>
              {run.chunkSummary ||
                t('The page will show the next 5-flip chunk when one is open.')}
            </Text>
            {totalAvailableTasks > 0 && run.chunkSummary ? (
              <Text color="muted" fontSize="xs">
                {t('Total bundled flips in this sample: {{count}}', {
                  count: totalAvailableTasks,
                })}
              </Text>
            ) : null}
          </Box>
        </SimpleGrid>

        <Text color="muted" fontSize="xs">
          {t(
            'Benchmark method: the same unseen holdout is scored twice, first with baseline weights and then with the trained adapter.'
          )}
          {run.lossLabel ? ` · ${run.lossLabel}` : ''}
          {run.updatedAt
            ? ` · ${t('Updated')}: ${formatTimestamp(run.updatedAt)}`
            : ''}
        </Text>
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
  annotation = {},
  options = {}
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
  const completion = getAnnotationCompletionState(annotation, options)
  const {isComplete, missingRequiredFields} = completion
  const nextTasks = tasks.map((task) =>
    task.taskId === selectedTaskId
      ? {
          ...task,
          hasDraft,
          isComplete,
          missingRequiredFields,
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

function getWorkspacePreviewAfterSave(
  workspace,
  selectedTaskId,
  annotation = {},
  options = {}
) {
  const tasks =
    workspace && Array.isArray(workspace.tasks) ? workspace.tasks : []

  if (!tasks.length || !selectedTaskId) {
    return {
      tasks: [],
      firstIncompleteTaskId: '',
      completionState: {
        total: 0,
        draftedCount: 0,
        completedCount: 0,
        remainingCount: 0,
        allComplete: false,
      },
    }
  }

  const hasDraft = hasDraftContent(annotation)
  const completion = getAnnotationCompletionState(annotation, options)
  const {isComplete} = completion
  const {missingRequiredFields} = completion
  const nextTasks = tasks.map((task) =>
    task.taskId === selectedTaskId
      ? {
          ...task,
          hasDraft,
          isComplete,
          missingRequiredFields,
        }
      : task
  )
  const draftedCount = nextTasks.filter((task) => task.hasDraft).length
  const completedCount = nextTasks.filter((task) => task.isComplete).length
  const total = nextTasks.length
  const firstIncompleteTask = nextTasks.find((task) => !task.isComplete)

  return {
    tasks: nextTasks,
    firstIncompleteTaskId: firstIncompleteTask?.taskId || '',
    completionState: {
      total,
      draftedCount,
      completedCount,
      remainingCount: Math.max(total - completedCount, 0),
      allComplete: total > 0 && completedCount === total,
    },
  }
}

function InterviewPrompt({
  title,
  children,
  isMissing = false,
  missingHint = '',
  sectionRef = null,
}) {
  return (
    <Box
      ref={sectionRef}
      borderWidth="1px"
      borderColor={isMissing ? 'orange.200' : 'gray.100'}
      borderRadius="xl"
      p={4}
      bg={isMissing ? 'orange.50' : 'white'}
      scrollMarginTop="120px"
    >
      <Box
        bg={isMissing ? 'orange.100' : 'blue.50'}
        borderWidth="1px"
        borderColor={isMissing ? 'orange.200' : 'blue.100'}
        borderRadius="lg"
        px={3}
        py={2}
        mb={3}
      >
        <Text
          fontSize="sm"
          fontWeight={600}
          color={isMissing ? 'orange.600' : 'blue.500'}
        >
          IdenaAI
        </Text>
        <Text mt={1}>{title}</Text>
      </Box>
      <Box>{children}</Box>
      {isMissing && missingHint ? (
        <Text color="orange.700" fontSize="sm" fontWeight={600} mt={3}>
          {missingHint}
        </Text>
      ) : null}
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
  isMissing = false,
  missingHint = '',
  sectionRef = null,
}) {
  let statusText = t('Choose one answer.')

  if (value === true) {
    statusText = t('Saved as: yes')
  } else if (value === false) {
    statusText = t('Saved as: no')
  }
  let borderColor = 'gray.100'
  let backgroundColor = 'white'

  if (isMissing) {
    borderColor = 'orange.200'
    backgroundColor = 'orange.50'
  } else if (value !== null) {
    borderColor = 'blue.100'
    backgroundColor = 'blue.50'
  }

  return (
    <Box
      ref={sectionRef}
      borderWidth="1px"
      borderColor={borderColor}
      borderRadius="lg"
      px={3}
      py={3}
      bg={backgroundColor}
      scrollMarginTop="120px"
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
        {isMissing && missingHint ? (
          <Text color="orange.700" fontSize="sm" fontWeight={600}>
            {missingHint}
          </Text>
        ) : null}
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
  const currentRuntimeModelLabel =
    runtimeModelLabel || annotation.model || t('unknown')
  const savedDraftModelLabel = String(annotation.model || '').trim()
  const showsLegacyDraftModelHint =
    Boolean(savedDraftModelLabel) &&
    Boolean(runtimeModelLabel) &&
    savedDraftModelLabel !== runtimeModelLabel

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
            'Current local research slot: runtime {{draftModel}} · local training {{trainingModel}}',
            {
              draftModel: currentRuntimeModelLabel,
              trainingModel: trainingModelLabel || t('unknown'),
            }
          )}
        </Text>

        {showsLegacyDraftModelHint ? (
          <Text color="muted" fontSize="xs" wordBreak="break-all">
            {t(
              'This saved draft was generated earlier with {{savedModel}}. Re-run it after you choose a new local base if you want a fresh comparison.',
              {
                savedModel: savedDraftModelLabel,
              }
            )}
          </Text>
        ) : null}

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
              <g key={`${point.evaluatedAt || point.runNumber || index}`}>
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

function formatBenchmarkAnswerLabel(value, t) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()

  if (normalized === 'left') {
    return t('LEFT')
  }

  if (normalized === 'right') {
    return t('RIGHT')
  }

  if (normalized === 'skip') {
    return t('SKIP')
  }

  return t('Unknown')
}

function describeBenchmarkExampleChange(changeType, t) {
  switch (
    String(changeType || '')
      .trim()
      .toLowerCase()
  ) {
    case 'improved':
      return {
        label: t('Improved'),
        scheme: 'green',
        borderColor: 'green.100',
        background: 'green.50',
      }
    case 'regressed':
      return {
        label: t('Regressed'),
        scheme: 'red',
        borderColor: 'red.100',
        background: 'red.50',
      }
    case 'unchanged_wrong':
      return {
        label: t('Still wrong'),
        scheme: 'orange',
        borderColor: 'orange.100',
        background: 'orange.50',
      }
    case 'unchanged_correct':
      return {
        label: t('Still correct'),
        scheme: 'blue',
        borderColor: 'blue.100',
        background: 'blue.50',
      }
    case 'current_wrong':
      return {
        label: t('Wrong in this run'),
        scheme: 'orange',
        borderColor: 'orange.100',
        background: 'orange.50',
      }
    default:
      return {
        label: t('Current example'),
        scheme: 'gray',
        borderColor: 'gray.100',
        background: 'gray.50',
      }
  }
}

function describeBenchmarkRunExampleResult(entry, t) {
  if (!entry) {
    return {
      label: t('No previous run'),
      detail: t(
        'This example was not loaded from an earlier saved comparison.'
      ),
      scheme: 'gray',
    }
  }

  if (entry.correct === true) {
    return {
      label: t('Correct'),
      detail: t('Predicted {{answer}}', {
        answer: formatBenchmarkAnswerLabel(entry.predicted, t),
      }),
      scheme: 'green',
    }
  }

  if (entry.correct === false) {
    return {
      label: t('Wrong'),
      detail: t('Predicted {{answer}}', {
        answer: formatBenchmarkAnswerLabel(entry.predicted, t),
      }),
      scheme: 'red',
    }
  }

  return {
    label: t('No clear answer'),
    detail: t('Predicted {{answer}}', {
      answer: formatBenchmarkAnswerLabel(entry.predicted, t),
    }),
    scheme: 'yellow',
  }
}

function buildBenchmarkExampleIdentity(example, index = 0) {
  return String(
    example?.sampleId ||
      example?.flipHash ||
      example?.reviewTarget?.taskId ||
      `benchmark-example-${index}`
  ).trim()
}

function formatBenchmarkJsonPreview(value) {
  if (!value || typeof value !== 'object') {
    return ''
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return ''
  }
}

function describeBenchmarkInspectorSummary(example, t) {
  if (!example) {
    return ''
  }

  if (example.current?.correct === true) {
    if (example.baseline?.correct === false) {
      return t('The trained adapter corrected a mistake the baseline made.')
    }

    if (example.previous?.correct === false) {
      return t('This benchmark flip improved compared with the last saved run.')
    }

    return t('The trained adapter handled this benchmark flip correctly.')
  }

  if (example.baseline?.correct === true) {
    return t(
      'The trained adapter missed this flip, but the baseline got it right.'
    )
  }

  if (example.previous?.correct === true) {
    return t(
      'The current run regressed on this flip compared with the last saved run.'
    )
  }

  if (
    String(example.current?.predicted || '')
      .trim()
      .toLowerCase() === 'skip'
  ) {
    return t('The model chose SKIP here instead of selecting LEFT or RIGHT.')
  }

  return t('This flip is still a failure case for the current adapter.')
}

function describeBenchmarkReviewAction(example, t) {
  if (!example?.reviewTarget?.taskId) {
    return t(
      'No linked annotation target was found for this benchmark flip yet.'
    )
  }

  return t(
    'Open this flip in the annotation flow, save your human answer, then include it in the next local adapter run.'
  )
}

function normalizeBenchmarkCandidateKey(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
}

function formatBenchmarkCandidateLabel(candidate, detail, t) {
  const key = normalizeBenchmarkCandidateKey(candidate)

  if (!key) {
    return t('Unknown')
  }

  if (key === 'a') {
    return detail?.optionAMapsTo
      ? `A → ${formatBenchmarkAnswerLabel(detail.optionAMapsTo, t)}`
      : t('Candidate A')
  }

  if (key === 'b') {
    return detail?.optionBMapsTo
      ? `B → ${formatBenchmarkAnswerLabel(detail.optionBMapsTo, t)}`
      : t('Candidate B')
  }

  return key.toUpperCase()
}

function readBenchmarkNumericScore(metric = null) {
  if (!metric || typeof metric !== 'object' || Array.isArray(metric)) {
    return null
  }

  const candidates = [
    metric.avg_logprob,
    metric.compareScore,
    metric.score,
    metric.winnerLoserMargin,
    metric.margin,
  ]

  for (const value of candidates) {
    const next = Number(value)
    if (Number.isFinite(next)) {
      return next
    }
  }

  return null
}

function formatBenchmarkNumericScore(value) {
  const next = Number(value)

  if (!Number.isFinite(next)) {
    return ''
  }

  return next.toFixed(Math.abs(next) >= 10 ? 2 : 3)
}

function getBenchmarkTraceLeaderboard(detail = null) {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) {
    return []
  }

  const candidateScores =
    detail.candidateScores &&
    typeof detail.candidateScores === 'object' &&
    !Array.isArray(detail.candidateScores)
      ? Object.entries(detail.candidateScores)
      : []

  if (candidateScores.length) {
    return candidateScores
      .map(([candidate, metric]) => ({
        candidate,
        score: readBenchmarkNumericScore(metric),
      }))
      .filter((entry) => Number.isFinite(entry.score))
      .sort((left, right) => right.score - left.score)
  }

  const candidateAnalyses =
    detail.candidateAnalyses &&
    typeof detail.candidateAnalyses === 'object' &&
    !Array.isArray(detail.candidateAnalyses)
      ? Object.entries(detail.candidateAnalyses)
      : []

  return candidateAnalyses
    .map(([candidate, metric]) => ({
      candidate,
      score: readBenchmarkNumericScore(metric),
    }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => right.score - left.score)
}

function describeBenchmarkTraceStability(detail, t) {
  const leaderboard = getBenchmarkTraceLeaderboard(detail)
  const top = leaderboard[0] || null
  const runnerUp = leaderboard[1] || null
  const margin =
    top && runnerUp
      ? Math.abs(Number(top.score) - Number(runnerUp.score))
      : null
  const generatedPrediction = String(detail?.generatedPrediction || '').trim()
  const scoredPrediction = String(detail?.scoredPrediction || '').trim()
  const hasMismatch =
    generatedPrediction &&
    scoredPrediction &&
    generatedPrediction !== scoredPrediction

  if (hasMismatch) {
    return {
      key: 'generation_mismatch',
      label: t('Generation and scoring disagreed'),
      detail: t(
        'Free-form generation and score-based selection pointed to different answers.'
      ),
      tone: 'orange',
    }
  }

  if (top && runnerUp && Number.isFinite(margin)) {
    return margin < 0.2
      ? {
          key: 'close_call',
          label: t('Very close call'),
          detail: t('{{top}} only led by {{margin}} over {{runnerUp}}.', {
            top: String(top.candidate).toUpperCase(),
            margin: formatBenchmarkNumericScore(margin),
            runnerUp: String(runnerUp.candidate).toUpperCase(),
          }),
          tone: 'orange',
        }
      : {
          key: 'clear_lead',
          label: t('Clear score lead'),
          detail: t('{{top}} led by {{margin}} over {{runnerUp}}.', {
            top: String(top.candidate).toUpperCase(),
            margin: formatBenchmarkNumericScore(margin),
            runnerUp: String(runnerUp.candidate).toUpperCase(),
          }),
          tone: 'green',
        }
  }

  return {
    key: 'trace_only',
    label: t('Trace available'),
    detail: t(
      'The run saved a decision trace, but not a comparable numeric margin.'
    ),
    tone: 'blue',
  }
}

function buildBenchmarkReviewSuggestion(example, t) {
  if (!example) {
    return null
  }

  const detail = example.currentDetails || null
  const stability = describeBenchmarkTraceStability(detail, t)
  const predicted = String(example.current?.predicted || '')
    .trim()
    .toLowerCase()
  const expected = String(example.expected || '')
    .trim()
    .toLowerCase()
  const baselineCorrect = example.baseline?.correct === true
  const previousCorrect = example.previous?.correct === true
  const generatedPrediction = String(detail?.generatedPrediction || '')
    .trim()
    .toLowerCase()
  const scoredPrediction = String(detail?.scoredPrediction || '')
    .trim()
    .toLowerCase()
  const hasMismatch =
    generatedPrediction &&
    scoredPrediction &&
    generatedPrediction !== scoredPrediction

  let issueType = 'wrong_answer'
  let headline = t('Wrong answer')
  let summary = t(
    'The adapter chose {{predicted}} even though the expected answer was {{expected}}.',
    {
      predicted: formatBenchmarkAnswerLabel(predicted, t),
      expected: formatBenchmarkAnswerLabel(expected, t),
    }
  )
  let retrainingHint = t(
    'Write the single cue that separates the expected side from the chosen side, then include that correction in the next retraining run.'
  )

  if (predicted === 'skip' && expected && expected !== 'skip') {
    issueType = 'ambiguous_flip'
    headline = t('Skipped a solvable flip')
    summary = t(
      'The adapter fell back to SKIP instead of choosing the expected {{expected}} answer.',
      {
        expected: formatBenchmarkAnswerLabel(expected, t),
      }
    )
    retrainingHint = t(
      'Emphasize why this flip is still solvable and which concrete cue should beat the model’s urge to skip.'
    )
  } else if (baselineCorrect) {
    issueType = 'weak_reasoning'
    headline = t('Baseline outperformed the adapter')
    summary = t(
      'The trained adapter missed this flip, but the baseline solved it correctly in the same run.'
    )
    retrainingHint = t(
      'Describe what the adapter overfit on and which cue the baseline respected correctly.'
    )
  } else if (previousCorrect) {
    issueType = 'weak_reasoning'
    headline = t('Regression from the last run')
    summary = t(
      'This flip regressed compared with the last saved benchmark run.'
    )
    retrainingHint = t(
      'Point out what changed between the good and bad decision so the next adapter update does not overwrite the earlier success.'
    )
  } else if (hasMismatch) {
    issueType = 'weak_reasoning'
    headline = t('Generation and scoring diverged')
    summary = t(
      'The free-form answer and the score-based answer disagreed on this flip.'
    )
    retrainingHint = t(
      'Write the answer as one consistent judgment and explain the exact cue that should align both generation and scoring.'
    )
  } else if (stability.key === 'close_call') {
    issueType = 'sequence_confusion'
    headline = t('The model was unsure between two stories')
    summary = stability.detail
    retrainingHint = t(
      'Focus your note on the smallest cue that resolves the close call: text order, motion direction, or chronology marker.'
    )
  }

  return {
    issueType,
    headline,
    summary,
    retrainingHint,
    stability,
  }
}

function describeBenchmarkTraceScoreRace(detail, t) {
  const leaderboard = getBenchmarkTraceLeaderboard(detail)
  const top = leaderboard[0] || null
  const runnerUp = leaderboard[1] || null

  if (!top) {
    return {
      value: t('No numeric race'),
      detail: t('This trace did not save comparable candidate scores.'),
      tone: 'gray',
    }
  }

  const topLabel = formatBenchmarkCandidateLabel(top.candidate, detail, t)

  if (!runnerUp) {
    return {
      value: topLabel,
      detail: t('Only one scored candidate was saved for this trace.'),
      tone: 'blue',
    }
  }

  const runnerUpLabel = formatBenchmarkCandidateLabel(
    runnerUp.candidate,
    detail,
    t
  )
  const margin = Math.abs(Number(top.score) - Number(runnerUp.score))
  const isClose = Number.isFinite(margin) && margin < 0.2

  return {
    value: `${topLabel} > ${runnerUpLabel}`,
    detail: t('{{top}} led {{runnerUp}} by {{margin}}.', {
      top: topLabel,
      runnerUp: runnerUpLabel,
      margin: formatBenchmarkNumericScore(margin),
    }),
    tone: isClose ? 'orange' : 'green',
  }
}

function describeBenchmarkExampleFilterLabel(filterKey, t) {
  switch (
    String(filterKey || '')
      .trim()
      .toLowerCase()
  ) {
    case 'failures':
      return t('Failures')
    case 'regressed':
      return t('Regressed')
    case 'baseline_better':
      return t('Baseline better')
    case 'improved':
      return t('Improved')
    case 'close_calls':
      return t('Close calls')
    case 'all':
    default:
      return t('All')
  }
}

function matchesBenchmarkExampleFilter(example, filterKey, t) {
  const normalizedFilter = String(filterKey || '')
    .trim()
    .toLowerCase()

  if (!normalizedFilter || normalizedFilter === 'all') {
    return true
  }

  switch (normalizedFilter) {
    case 'failures':
      return example?.current?.correct === false
    case 'regressed':
      return (
        String(example?.changeType || '')
          .trim()
          .toLowerCase() === 'regressed'
      )
    case 'baseline_better':
      return (
        example?.current?.correct === false &&
        example?.baseline?.correct === true
      )
    case 'improved':
      return (
        String(example?.changeType || '')
          .trim()
          .toLowerCase() === 'improved'
      )
    case 'close_calls':
      return (
        describeBenchmarkTraceStability(example?.currentDetails, t).key ===
        'close_call'
      )
    default:
      return true
  }
}

function applyBenchmarkReviewSuggestionToDraft(
  annotation = {},
  suggestion = null,
  {overwrite = false} = {}
) {
  if (!suggestion) {
    return normalizeAnnotationDraft(annotation)
  }

  const next = normalizeAnnotationDraft(annotation)

  return normalizeAnnotationDraft({
    ...next,
    benchmark_review_issue_type:
      overwrite || !next.benchmark_review_issue_type
        ? suggestion.issueType
        : next.benchmark_review_issue_type,
    benchmark_review_failure_note:
      overwrite || !String(next.benchmark_review_failure_note || '').trim()
        ? suggestion.summary
        : next.benchmark_review_failure_note,
    benchmark_review_retraining_hint:
      overwrite || !String(next.benchmark_review_retraining_hint || '').trim()
        ? suggestion.retrainingHint
        : next.benchmark_review_retraining_hint,
    benchmark_review_include_for_training:
      next.benchmark_review_include_for_training === null
        ? true
        : next.benchmark_review_include_for_training,
  })
}

function mergeBenchmarkReviewContextIntoDraft(
  annotation = {},
  reviewContext = null
) {
  if (!reviewContext || typeof reviewContext !== 'object') {
    return normalizeAnnotationDraft(annotation)
  }

  const next = normalizeAnnotationDraft(annotation)
  const currentBenchmarkReview = normalizeBenchmarkReviewDraftLayer(
    next.benchmark_review,
    next
  )

  return normalizeAnnotationDraft({
    ...next,
    benchmark_review: {
      ...currentBenchmarkReview,
      context: normalizeBenchmarkReviewContextDraft({
        ...currentBenchmarkReview.context,
        expected_answer: reviewContext.expected,
        ai_prediction: reviewContext?.current?.predicted,
        baseline_prediction: reviewContext?.baseline?.predicted,
        previous_prediction: reviewContext?.previous?.predicted,
        benchmark_flips:
          reviewContext?.benchmarkFlips ??
          currentBenchmarkReview.context.benchmark_flips,
        evaluated_at:
          reviewContext?.current?.evaluatedAt ||
          reviewContext?.evaluatedAt ||
          currentBenchmarkReview.context.evaluated_at,
        change_type:
          reviewContext?.changeType ||
          currentBenchmarkReview.context.change_type,
        ai_correct:
          typeof reviewContext?.current?.correct === 'boolean'
            ? reviewContext.current.correct
            : currentBenchmarkReview.context.ai_correct,
      }),
    },
  })
}

function BenchmarkInsightCard({title, value, detail = '', tone = 'blue'}) {
  const toneMap = {
    green: {borderColor: 'green.100', bg: 'green.50'},
    orange: {borderColor: 'orange.100', bg: 'orange.50'},
    red: {borderColor: 'red.100', bg: 'red.50'},
    purple: {borderColor: 'purple.100', bg: 'purple.50'},
    blue: {borderColor: 'blue.100', bg: 'blue.50'},
    gray: {borderColor: 'gray.100', bg: 'gray.50'},
  }
  const palette = toneMap[tone] || toneMap.blue

  return (
    <Box
      borderWidth="1px"
      borderColor={palette.borderColor}
      borderRadius="md"
      p={3}
      bg={palette.bg}
    >
      <Stack spacing={1}>
        <Text color="muted" fontSize="xs">
          {title}
        </Text>
        <Text fontSize="sm" fontWeight={700}>
          {value}
        </Text>
        {detail ? (
          <Text color="muted" fontSize="xs">
            {detail}
          </Text>
        ) : null}
      </Stack>
    </Box>
  )
}

function BenchmarkExampleDecisionTraceCard({title, detail = null, t}) {
  if (!detail) {
    return null
  }

  const scorePreview = formatBenchmarkJsonPreview(detail.candidateScores)
  const parsedPreview = formatBenchmarkJsonPreview(detail.parsedResponse)
  const analysesPreview = formatBenchmarkJsonPreview(detail.candidateAnalyses)
  let detailTone = 'yellow'
  let detailLabel = t('Unclear')

  if (detail.correct === true) {
    detailTone = 'green'
    detailLabel = t('Correct')
  } else if (detail.correct === false) {
    detailTone = 'red'
    detailLabel = t('Wrong')
  }

  return (
    <Box
      borderWidth="1px"
      borderColor="gray.100"
      borderRadius="md"
      p={3}
      bg="white"
    >
      <Stack spacing={3}>
        <Box>
          <Text fontSize="sm" fontWeight={700}>
            {title}
          </Text>
          <HStack spacing={2} mt={2} flexWrap="wrap">
            <Badge colorScheme={detailTone} borderRadius="full">
              {detailLabel}
            </Badge>
            <Badge colorScheme="blue" borderRadius="full">
              {t('Predicted')}:{' '}
              {formatBenchmarkAnswerLabel(detail.predicted, t)}
            </Badge>
            {detail.selectedCandidate ? (
              <Badge colorScheme="purple" borderRadius="full">
                {t('Chosen candidate')}:{' '}
                {String(detail.selectedCandidate).toUpperCase()}
              </Badge>
            ) : null}
          </HStack>
        </Box>

        {(detail.generatedPrediction || detail.scoredPrediction) &&
        detail.generatedPrediction !== detail.predicted ? (
          <Text fontSize="sm">
            {t('Generated')}:{' '}
            {formatBenchmarkAnswerLabel(detail.generatedPrediction, t)}
            {' · '}
            {t('Scored')}:{' '}
            {formatBenchmarkAnswerLabel(detail.scoredPrediction, t)}
          </Text>
        ) : null}

        {detail.rawResponse ? (
          <Box>
            <Text color="muted" fontSize="xs" mb={1}>
              {t('Raw model answer')}
            </Text>
            <Box
              as="pre"
              fontSize="xs"
              whiteSpace="pre-wrap"
              borderWidth="1px"
              borderColor="gray.100"
              borderRadius="md"
              bg="gray.50"
              px={3}
              py={2}
              maxH="180px"
              overflowY="auto"
            >
              {detail.rawResponse}
            </Box>
          </Box>
        ) : null}

        {parsedPreview ? (
          <Box>
            <Text color="muted" fontSize="xs" mb={1}>
              {t('Parsed answer data')}
            </Text>
            <Box
              as="pre"
              fontSize="xs"
              whiteSpace="pre-wrap"
              borderWidth="1px"
              borderColor="gray.100"
              borderRadius="md"
              bg="gray.50"
              px={3}
              py={2}
              maxH="180px"
              overflowY="auto"
            >
              {parsedPreview}
            </Box>
          </Box>
        ) : null}

        {scorePreview ? (
          <Box>
            <Text color="muted" fontSize="xs" mb={1}>
              {t('Answer score table')}
            </Text>
            <Box
              as="pre"
              fontSize="xs"
              whiteSpace="pre-wrap"
              borderWidth="1px"
              borderColor="gray.100"
              borderRadius="md"
              bg="gray.50"
              px={3}
              py={2}
              maxH="180px"
              overflowY="auto"
            >
              {scorePreview}
            </Box>
          </Box>
        ) : null}

        {analysesPreview ? (
          <Box>
            <Text color="muted" fontSize="xs" mb={1}>
              {t('Candidate analysis trace')}
            </Text>
            <Box
              as="pre"
              fontSize="xs"
              whiteSpace="pre-wrap"
              borderWidth="1px"
              borderColor="gray.100"
              borderRadius="md"
              bg="gray.50"
              px={3}
              py={2}
              maxH="220px"
              overflowY="auto"
            >
              {analysesPreview}
            </Box>
          </Box>
        ) : null}
      </Stack>
    </Box>
  )
}

function summarizeBenchmarkExamples(examples = []) {
  return examples.reduce(
    (summary, example) => {
      const changeType = String(example?.changeType || '')
        .trim()
        .toLowerCase()

      if (example?.current?.correct === true) {
        summary.currentCorrectCount += 1
      }

      if (example?.previous?.correct === true) {
        summary.previousCorrectCount += 1
      }

      if (changeType === 'improved') {
        summary.improvedCount += 1
      } else if (changeType === 'regressed') {
        summary.regressedCount += 1
      } else if (changeType === 'unchanged_correct') {
        summary.unchangedCorrectCount += 1
      } else if (changeType === 'unchanged_wrong') {
        summary.unchangedWrongCount += 1
      }

      return summary
    },
    {
      total: examples.length,
      currentCorrectCount: 0,
      previousCorrectCount: 0,
      improvedCount: 0,
      regressedCount: 0,
      unchangedCorrectCount: 0,
      unchangedWrongCount: 0,
    }
  )
}

function BenchmarkExamplesComparisonGraph({examples = [], t}) {
  const summary = summarizeBenchmarkExamples(examples)

  if (!summary.total) {
    return null
  }

  const currentPercent = (summary.currentCorrectCount / summary.total) * 100
  const previousExampleAvailable = examples.some((example) => example?.previous)
  const previousPercent =
    summary.previousCorrectCount > 0 || previousExampleAvailable
      ? (summary.previousCorrectCount / summary.total) * 100
      : null
  const selectedDelta =
    previousPercent === null ? null : currentPercent - previousPercent
  const selectedDeltaLabel =
    selectedDelta === null
      ? t('No earlier saved example set was available for this comparison.')
      : t('Change across these shown examples: {{value}} pts', {
          value: `${selectedDelta >= 0 ? '+' : ''}${selectedDelta.toFixed(1)}`,
        })
  const changeStats = [
    {
      key: 'improved',
      label: t('Improved'),
      count: summary.improvedCount,
      scheme: 'green',
    },
    {
      key: 'regressed',
      label: t('Regressed'),
      count: summary.regressedCount,
      scheme: 'red',
    },
    {
      key: 'still-correct',
      label: t('Still correct'),
      count: summary.unchangedCorrectCount,
      scheme: 'blue',
    },
    {
      key: 'still-wrong',
      label: t('Still wrong'),
      count: summary.unchangedWrongCount,
      scheme: 'orange',
    },
  ]

  return (
    <Box borderWidth="1px" borderColor="gray.100" borderRadius="md" p={3}>
      <Stack spacing={3}>
        <Box>
          <Text fontSize="sm" fontWeight={600}>
            {t('Selected example graph')}
          </Text>
          <Text color="muted" fontSize="xs">
            {t(
              'This graph only compares the example flips shown below, not the whole unseen holdout.'
            )}
          </Text>
        </Box>

        <Stack spacing={3}>
          <Box>
            <Flex justify="space-between" align="center" mb={1} gap={2}>
              <Text fontSize="sm" fontWeight={600}>
                {t('Current run')}
              </Text>
              <Text fontSize="sm" fontWeight={700}>
                {summary.currentCorrectCount} / {summary.total} ·{' '}
                {formatPercentMetric(currentPercent, 1)}
              </Text>
            </Flex>
            <Progress
              value={currentPercent}
              size="sm"
              colorScheme="blue"
              borderRadius="full"
            />
          </Box>

          {previousPercent !== null ? (
            <Box>
              <Flex justify="space-between" align="center" mb={1} gap={2}>
                <Text fontSize="sm" fontWeight={600}>
                  {t('Last run')}
                </Text>
                <Text fontSize="sm" fontWeight={700}>
                  {summary.previousCorrectCount} / {summary.total} ·{' '}
                  {formatPercentMetric(previousPercent, 1)}
                </Text>
              </Flex>
              <Progress
                value={previousPercent}
                size="sm"
                colorScheme="gray"
                borderRadius="full"
              />
            </Box>
          ) : null}
        </Stack>

        <SimpleGrid columns={[2, 2, 4]} spacing={3}>
          {changeStats.map((stat) => (
            <Box
              key={stat.key}
              borderWidth="1px"
              borderColor="gray.100"
              borderRadius="md"
              px={3}
              py={2}
              bg="gray.50"
            >
              <Stack spacing={1}>
                <Text color="muted" fontSize="xs">
                  {stat.label}
                </Text>
                <Badge
                  alignSelf="flex-start"
                  colorScheme={stat.scheme}
                  borderRadius="full"
                >
                  {stat.count}
                </Badge>
              </Stack>
            </Box>
          ))}
        </SimpleGrid>

        <Text color="muted" fontSize="xs">
          {selectedDeltaLabel}
        </Text>
      </Stack>
    </Box>
  )
}

function BenchmarkLiveStatsPanel({
  activeRun = null,
  telemetry = null,
  current = null,
  previous = null,
  t,
}) {
  const run = describeDeveloperActiveRun(activeRun, t)
  const activeRunStatus = String(activeRun?.status || '')
    .trim()
    .toLowerCase()
  const activeRunKind = String(activeRun?.kind || '')
    .trim()
    .toLowerCase()
  const activeRunStage = String(activeRun?.stage || '')
    .trim()
    .toLowerCase()
  const isBenchmarkLive =
    activeRunStatus === 'running' &&
    (activeRunKind === 'comparison' || activeRunStage.startsWith('benchmark_'))
  const system =
    telemetry &&
    typeof telemetry.system === 'object' &&
    !Array.isArray(telemetry.system)
      ? telemetry.system
      : {}
  const deltaAccuracy =
    typeof current?.accuracy === 'number' &&
    typeof previous?.accuracy === 'number'
      ? current.accuracy - previous.accuracy
      : null
  let benchmarkStateDetail = t(
    'Run a benchmark to start collecting live comparison stats.'
  )
  let benchmarkProgressValue = current
    ? formatSuccessRate(current.accuracy)
    : 'n/a'
  let benchmarkProgressDetail = t('No earlier saved run at this size yet.')
  let benchmarkProgressTone = 'gray'

  if (deltaAccuracy !== null) {
    benchmarkProgressTone = deltaAccuracy >= 0 ? 'green' : 'orange'
  }

  if (isBenchmarkLive) {
    benchmarkStateDetail =
      run?.benchmarkSummary ||
      t('The benchmark is scoring unseen flips right now.')
    benchmarkProgressValue =
      typeof run?.progressPercent === 'number'
        ? formatPercentMetric(run.progressPercent, 0)
        : 'n/a'
    benchmarkProgressDetail =
      run?.summary || run?.detail || t('Waiting for the next live update.')
    benchmarkProgressTone = 'blue'
  } else if (current?.evaluatedAt) {
    benchmarkStateDetail = t('Last saved benchmark: {{time}}', {
      time: formatTimestamp(current.evaluatedAt),
    })
  }

  if (deltaAccuracy !== null && !isBenchmarkLive) {
    benchmarkProgressDetail = t('Saved change vs last run: {{value}} pts', {
      value: `${deltaAccuracy >= 0 ? '+' : ''}${(deltaAccuracy * 100).toFixed(
        1
      )}`,
    })
  }

  const benchmarkStateCard = {
    title: t('Benchmark state'),
    value: isBenchmarkLive ? t('Live now') : t('Standby'),
    detail: benchmarkStateDetail,
    tone: isBenchmarkLive ? 'purple' : 'gray',
  }
  const benchmarkProgressCard = {
    title: t('Benchmark progress'),
    value: benchmarkProgressValue,
    detail: benchmarkProgressDetail,
    tone: benchmarkProgressTone,
  }
  const stats = [
    benchmarkStateCard,
    benchmarkProgressCard,
    describeDeveloperThermalTelemetry(system, t),
    describeDeveloperCpuTelemetry(system, t),
    describeDeveloperGpuTelemetry(system, t),
  ]

  return (
    <Box borderWidth="1px" borderColor="gray.100" borderRadius="md" p={3}>
      <Stack spacing={3}>
        <Flex
          justify="space-between"
          align={['flex-start', 'center']}
          direction={['column', 'row']}
          gap={2}
        >
          <Box>
            <Text fontSize="sm" fontWeight={600}>
              {t('Benchmark live stats')}
            </Text>
            <Text color="muted" fontSize="xs">
              {isBenchmarkLive
                ? t(
                    'These stats refresh while the benchmark is running so you can watch the run and the machine together.'
                  )
                : t(
                    'These standby stats show the last machine sample and the latest saved benchmark result.'
                  )}
            </Text>
          </Box>
          <Badge
            colorScheme={isBenchmarkLive ? 'purple' : 'gray'}
            borderRadius="full"
            px={2}
          >
            {isBenchmarkLive ? t('Live') : t('Standby')}
          </Badge>
        </Flex>

        <SimpleGrid columns={[1, 2, 5]} spacing={3}>
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

        {isBenchmarkLive && typeof run?.progressPercent === 'number' ? (
          <Progress
            value={run.progressPercent}
            size="sm"
            colorScheme="purple"
            borderRadius="full"
          />
        ) : null}

        <Text color="muted" fontSize="xs">
          {telemetry?.collectedAt
            ? `${t('Last machine sample')}: ${formatTimestamp(
                telemetry.collectedAt
              )}`
            : t('Machine sampling is waiting for the next telemetry update.')}
        </Text>
      </Stack>
    </Box>
  )
}

function BenchmarkExamplesEmptyState({activeRun = null, telemetry = null, t}) {
  return (
    <Box borderWidth="1px" borderColor="gray.100" borderRadius="md" p={3}>
      <Stack spacing={3}>
        <Box>
          <Text fontSize="sm" fontWeight={600}>
            {t('Benchmark example flips')}
          </Text>
          <Text color="muted" fontSize="xs">
            {t(
              'This area stays visible before the first saved benchmark so you know where the example graph and live comparison stats will appear.'
            )}
          </Text>
        </Box>

        <Box borderWidth="1px" borderColor="gray.100" borderRadius="md" p={3}>
          <Stack spacing={2}>
            <Text fontSize="sm" fontWeight={600}>
              {t('Selected example graph')}
            </Text>
            <Text color="muted" fontSize="sm">
              {t(
                'After the first saved benchmark, this graph will compare the shown example flips from the current run against the last run.'
              )}
            </Text>
            <Progress
              size="sm"
              value={0}
              colorScheme="gray"
              borderRadius="full"
            />
            <Text color="muted" fontSize="xs">
              {t(
                'Nothing is missing here. The app simply does not have a saved benchmark example set yet.'
              )}
            </Text>
          </Stack>
        </Box>

        <BenchmarkLiveStatsPanel
          activeRun={activeRun}
          telemetry={telemetry}
          current={null}
          previous={null}
          t={t}
        />
      </Stack>
    </Box>
  )
}

function DeveloperBenchmarkExamplesPanel({
  data = null,
  benchmarkSize = 100,
  isLoading = false,
  error = '',
  activeRun = null,
  telemetry = null,
  onReviewExample = null,
  t,
}) {
  const examples = React.useMemo(
    () => (Array.isArray(data?.examples) ? data.examples : []),
    [data?.examples]
  )
  const selectedExampleDefaultKey = React.useMemo(() => {
    const failedExample = examples.find(
      (example) => example?.current?.correct === false
    )
    return buildBenchmarkExampleIdentity(failedExample || examples[0], 0)
  }, [examples])
  const [exampleFilter, setExampleFilter] = React.useState('failures')
  const filterOptions = React.useMemo(
    () =>
      BENCHMARK_EXAMPLE_FILTER_OPTIONS.map((filterKey) => ({
        value: filterKey,
        label: describeBenchmarkExampleFilterLabel(filterKey, t),
        count: examples.filter((example) =>
          matchesBenchmarkExampleFilter(example, filterKey, t)
        ).length,
      })),
    [examples, t]
  )
  const filteredExamples = React.useMemo(() => {
    const nextExamples = examples.filter((example) =>
      matchesBenchmarkExampleFilter(example, exampleFilter, t)
    )

    return nextExamples.length ? nextExamples : examples
  }, [exampleFilter, examples, t])
  const [selectedExampleKey, setSelectedExampleKey] = React.useState(
    selectedExampleDefaultKey
  )

  React.useEffect(() => {
    setSelectedExampleKey(selectedExampleDefaultKey)
  }, [selectedExampleDefaultKey])

  const selectedExample = React.useMemo(() => {
    if (!filteredExamples.length) {
      return null
    }

    return (
      filteredExamples.find(
        (example, index) =>
          buildBenchmarkExampleIdentity(example, index) === selectedExampleKey
      ) || filteredExamples[0]
    )
  }, [filteredExamples, selectedExampleKey])
  const selectedExampleStyles = describeBenchmarkExampleChange(
    selectedExample?.changeType,
    t
  )
  const selectedExampleSuggestion = buildBenchmarkReviewSuggestion(
    selectedExample,
    t
  )
  const selectedExampleTraceStability = describeBenchmarkTraceStability(
    selectedExample?.currentDetails,
    t
  )
  const selectedExampleScoreRace = describeBenchmarkTraceScoreRace(
    selectedExample?.currentDetails,
    t
  )
  let selectedExampleCauseTone = 'orange'
  if (selectedExample?.current?.correct === true) {
    selectedExampleCauseTone = 'green'
  } else if (selectedExample?.baseline?.correct === true) {
    selectedExampleCauseTone = 'purple'
  }
  let selectedExampleBaselineClue = {
    value: t('Still needs teaching'),
    detail: t(
      'Neither the current adapter nor the comparison reference solved this flip reliably yet.'
    ),
    tone: 'gray',
  }

  if (selectedExample?.baseline?.correct === true) {
    selectedExampleBaselineClue = {
      value: t('Baseline still saw the right cue'),
      detail: t(
        'The base model solved this flip, so the new adapter likely learned the wrong emphasis.'
      ),
      tone: 'purple',
    }
  } else if (selectedExample?.previous?.correct === true) {
    selectedExampleBaselineClue = {
      value: t('This run regressed'),
      detail: t(
        'An earlier saved adapter solved this flip, so this failure is likely overwrite or drift rather than missing coverage.'
      ),
      tone: 'orange',
    }
  }
  const selectedExampleCurrentResult = describeBenchmarkRunExampleResult(
    selectedExample?.current,
    t
  )
  const selectedExampleBaselineResult = describeBenchmarkRunExampleResult(
    selectedExample?.baseline,
    t
  )
  const selectedExamplePreviousResult = describeBenchmarkRunExampleResult(
    selectedExample?.previous,
    t
  )
  const currentFairness = data?.current?.fairBenchmark || null

  if (isLoading) {
    return (
      <Box borderWidth="1px" borderColor="gray.100" borderRadius="md" p={3}>
        <Stack spacing={2}>
          <Text fontSize="sm" fontWeight={600}>
            {t('Benchmark example flips')}
          </Text>
          <Progress size="sm" isIndeterminate colorScheme="blue" />
          <Text color="muted" fontSize="sm">
            {t(
              'Loading example flips from the saved benchmark run so you can inspect what changed.'
            )}
          </Text>
        </Stack>
      </Box>
    )
  }

  if (error) {
    return (
      <Box
        borderWidth="1px"
        borderColor="red.100"
        borderRadius="md"
        p={3}
        bg="red.50"
      >
        <Stack spacing={1}>
          <Text fontSize="sm" fontWeight={700}>
            {t('Benchmark example flips unavailable')}
          </Text>
          <Text fontSize="sm">{error}</Text>
        </Stack>
      </Box>
    )
  }

  if (!data?.current) {
    return (
      <BenchmarkExamplesEmptyState
        activeRun={activeRun}
        telemetry={telemetry}
        t={t}
      />
    )
  }

  if (!data?.hasDetailedResults) {
    return (
      <Box borderWidth="1px" borderColor="gray.100" borderRadius="md" p={3}>
        <Stack spacing={1}>
          <Text fontSize="sm" fontWeight={600}>
            {t('Benchmark example flips')}
          </Text>
          <Text color="muted" fontSize="sm">
            {t(
              'This saved benchmark only kept aggregate accuracy. Example-by-example flips become visible when the detailed local comparison files are available.'
            )}
          </Text>
        </Stack>
      </Box>
    )
  }

  return (
    <Box borderWidth="1px" borderColor="gray.100" borderRadius="md" p={3}>
      <Stack spacing={3}>
        <Flex
          justify="space-between"
          align={['flex-start', 'center']}
          direction={['column', 'row']}
          gap={2}
        >
          <Box>
            <Text fontSize="sm" fontWeight={600}>
              {t('Benchmark example flips')}
            </Text>
            <Text color="muted" fontSize="xs">
              {data.previous
                ? t(
                    'These example flips come from the same unseen {{count}}-flip holdout used by the current and previous run.',
                    {count: benchmarkSize}
                  )
                : t(
                    'These example flips come from the latest unseen {{count}}-flip holdout run.',
                    {count: benchmarkSize}
                  )}
            </Text>
          </Box>
          <HStack spacing={2} flexWrap="wrap" align="center">
            <Box minW={['100%', '220px']} maxW="260px">
              <FormLabel mb={1}>{t('Show')}</FormLabel>
              <Select
                value={exampleFilter}
                onChange={(e) => setExampleFilter(e?.target?.value || 'all')}
              >
                {filterOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {`${option.label} (${option.count})`}
                  </option>
                ))}
              </Select>
            </Box>
            <Badge colorScheme="blue" borderRadius="full" px={2}>
              {t('Current')}: {formatSuccessRate(data.current.accuracy)}
            </Badge>
            {currentFairness ? (
              <Badge
                colorScheme={
                  currentFairness.legacyFairnessUnknown ? 'orange' : 'green'
                }
                borderRadius="full"
                px={2}
              >
                {currentFairness.legacyFairnessUnknown
                  ? t('Legacy fairness unknown')
                  : t('Fair benchmark')}
              </Badge>
            ) : null}
            {data.previous ? (
              <Badge colorScheme="gray" borderRadius="full" px={2}>
                {t('Last run')}: {formatSuccessRate(data.previous.accuracy)}
              </Badge>
            ) : null}
          </HStack>
        </Flex>

        <SimpleGrid columns={[1, 1, 2]} spacing={3}>
          <Box
            borderWidth="1px"
            borderColor="gray.100"
            borderRadius="md"
            px={3}
            py={2}
            bg="gray.50"
          >
            <Text color="muted" fontSize="xs">
              {t('Current run')}
            </Text>
            <Text fontWeight={700}>
              {Number(data.current.correct) || 0} /{' '}
              {Number(data.current.totalFlips) || 0}
            </Text>
            <Text color="muted" fontSize="xs">
              {formatTimestamp(data.current.evaluatedAt)}
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
              {t('Last run')}
            </Text>
            <Text fontWeight={700}>
              {data.previous
                ? `${Number(data.previous.correct) || 0} / ${
                    Number(data.previous.totalFlips) || 0
                  }`
                : t('No earlier run')}
            </Text>
            <Text color="muted" fontSize="xs">
              {data.previous
                ? formatTimestamp(data.previous.evaluatedAt)
                : t('Run this benchmark again after another local update.')}
            </Text>
          </Box>
        </SimpleGrid>

        <BenchmarkExamplesComparisonGraph examples={examples} t={t} />
        <BenchmarkLiveStatsPanel
          activeRun={activeRun}
          telemetry={telemetry}
          current={data.current}
          previous={data.previous}
          t={t}
        />

        {examples.length ? (
          <SimpleGrid columns={[1, 1, 3]} spacing={3}>
            <Box
              borderWidth="1px"
              borderColor="gray.100"
              borderRadius="md"
              overflow="hidden"
            >
              <Stack spacing={0}>
                {filteredExamples.map((example, index) => {
                  const identity = buildBenchmarkExampleIdentity(example, index)
                  const styles = describeBenchmarkExampleChange(
                    example.changeType,
                    t
                  )
                  const currentResult = describeBenchmarkRunExampleResult(
                    example.current,
                    t
                  )
                  const isSelected = identity === selectedExampleKey

                  return (
                    <Box
                      key={identity}
                      px={3}
                      py={3}
                      bg={isSelected ? styles.background : 'white'}
                      borderBottomWidth={
                        index < filteredExamples.length - 1 ? '1px' : '0px'
                      }
                      borderBottomColor="gray.50"
                      cursor="pointer"
                      onClick={() => setSelectedExampleKey(identity)}
                    >
                      <Stack spacing={2}>
                        <Flex justify="space-between" align="center" gap={2}>
                          <Text fontSize="sm" fontWeight={700} noOfLines={1}>
                            {example.sampleId ||
                              example.flipHash ||
                              `#${index + 1}`}
                          </Text>
                          <HStack spacing={1} flexWrap="wrap">
                            {isSelected ? (
                              <Badge colorScheme="blue" borderRadius="full">
                                {t('Inspecting')}
                              </Badge>
                            ) : null}
                            <Badge
                              colorScheme={styles.scheme}
                              borderRadius="full"
                            >
                              {styles.label}
                            </Badge>
                          </HStack>
                        </Flex>
                        <Text color="muted" fontSize="xs">
                          {t('Expected')}:{' '}
                          {formatBenchmarkAnswerLabel(example.expected, t)}
                          {' · '}
                          {t('Current')}: {currentResult.label}
                        </Text>
                        {example.reviewTarget?.taskNumber ? (
                          <Text color="muted" fontSize="xs">
                            {t('Annotation target')}: {t('Flip')}{' '}
                            {example.reviewTarget.taskNumber}
                          </Text>
                        ) : null}
                      </Stack>
                    </Box>
                  )
                })}
              </Stack>
            </Box>

            <Box
              borderWidth="1px"
              borderColor={selectedExampleStyles.borderColor}
              borderRadius="md"
              p={3}
              bg={selectedExampleStyles.background}
              gridColumn={['auto', 'auto', 'span 2']}
            >
              {selectedExample ? (
                <Stack spacing={3}>
                  <Flex
                    justify="space-between"
                    align={['flex-start', 'center']}
                    direction={['column', 'row']}
                    gap={2}
                  >
                    <Box minW={0}>
                      <Text fontSize="sm" fontWeight={700} noOfLines={1}>
                        {selectedExample.sampleId ||
                          selectedExample.flipHash ||
                          t('Benchmark flip')}
                      </Text>
                      <Text color="muted" fontSize="xs" mt={1}>
                        {describeBenchmarkInspectorSummary(selectedExample, t)}
                      </Text>
                    </Box>
                    <HStack spacing={2} flexWrap="wrap">
                      <Badge
                        colorScheme={selectedExampleStyles.scheme}
                        borderRadius="full"
                        px={2}
                      >
                        {selectedExampleStyles.label}
                      </Badge>
                      {selectedExample.reviewTarget?.taskId ? (
                        <PrimaryButton
                          onClick={() =>
                            typeof onReviewExample === 'function'
                              ? onReviewExample(selectedExample)
                              : null
                          }
                        >
                          {t('Review and annotate')}
                        </PrimaryButton>
                      ) : null}
                    </HStack>
                  </Flex>

                  <Alert status="info" borderRadius="md">
                    <Text fontSize="sm">
                      {describeBenchmarkReviewAction(selectedExample, t)}
                    </Text>
                  </Alert>

                  <SimpleGrid columns={[1, 1, 3]} spacing={3}>
                    <BenchmarkInsightCard
                      title={t('Likely failure cause')}
                      value={
                        selectedExampleSuggestion?.headline || t('No summary')
                      }
                      detail={
                        selectedExampleSuggestion?.summary ||
                        t('This example has no derived diagnosis yet.')
                      }
                      tone={selectedExampleCauseTone}
                    />
                    <BenchmarkInsightCard
                      title={t('Decision stability')}
                      value={selectedExampleTraceStability.label}
                      detail={selectedExampleTraceStability.detail}
                      tone={selectedExampleTraceStability.tone}
                    />
                    <BenchmarkInsightCard
                      title={t('Reference clue')}
                      value={selectedExampleBaselineClue.value}
                      detail={selectedExampleBaselineClue.detail}
                      tone={selectedExampleBaselineClue.tone}
                    />
                  </SimpleGrid>

                  <SimpleGrid columns={[1, 2, 3]} spacing={3}>
                    <Box
                      borderWidth="1px"
                      borderColor="whiteAlpha.700"
                      borderRadius="md"
                      p={3}
                      bg="white"
                    >
                      <Text color="muted" fontSize="xs">
                        {t('Expected')}
                      </Text>
                      <Text fontWeight={700}>
                        {formatBenchmarkAnswerLabel(
                          selectedExample.expected,
                          t
                        )}
                      </Text>
                    </Box>
                    <Box
                      borderWidth="1px"
                      borderColor="whiteAlpha.700"
                      borderRadius="md"
                      p={3}
                      bg="white"
                    >
                      <Text color="muted" fontSize="xs">
                        {t('Adapter now')}
                      </Text>
                      <Badge
                        colorScheme={selectedExampleCurrentResult.scheme}
                        borderRadius="full"
                      >
                        {selectedExampleCurrentResult.label}
                      </Badge>
                      <Text fontSize="sm" mt={2}>
                        {selectedExampleCurrentResult.detail}
                      </Text>
                    </Box>
                    <Box
                      borderWidth="1px"
                      borderColor="whiteAlpha.700"
                      borderRadius="md"
                      p={3}
                      bg="white"
                    >
                      <Text color="muted" fontSize="xs">
                        {t('Baseline in same run')}
                      </Text>
                      <Badge
                        colorScheme={selectedExampleBaselineResult.scheme}
                        borderRadius="full"
                      >
                        {selectedExampleBaselineResult.label}
                      </Badge>
                      <Text fontSize="sm" mt={2}>
                        {selectedExampleBaselineResult.detail}
                      </Text>
                    </Box>
                  </SimpleGrid>

                  <SimpleGrid columns={[1, 1, 2]} spacing={3}>
                    <BenchmarkInsightCard
                      title={t('Score race')}
                      value={selectedExampleScoreRace.value}
                      detail={selectedExampleScoreRace.detail}
                      tone={selectedExampleScoreRace.tone}
                    />
                    <BenchmarkInsightCard
                      title={t('Suggested retraining focus')}
                      value={t('Next note to add')}
                      detail={
                        selectedExampleSuggestion?.retrainingHint ||
                        t(
                          'Add a short human explanation of the cue the model should respect next time.'
                        )
                      }
                      tone="blue"
                    />
                  </SimpleGrid>

                  <SimpleGrid columns={[1, 1, 2]} spacing={3}>
                    <BenchmarkExampleDecisionTraceCard
                      title={t('Adapter decision trace')}
                      detail={selectedExample.currentDetails}
                      t={t}
                    />
                    <BenchmarkExampleDecisionTraceCard
                      title={t('Baseline decision trace')}
                      detail={selectedExample.baselineDetails}
                      t={t}
                    />
                  </SimpleGrid>

                  {selectedExample.previous ? (
                    <Box
                      borderWidth="1px"
                      borderColor="whiteAlpha.700"
                      borderRadius="md"
                      p={3}
                      bg="white"
                    >
                      <Stack spacing={2}>
                        <Text fontSize="sm" fontWeight={700}>
                          {t('Last saved run')}
                        </Text>
                        <Badge
                          alignSelf="flex-start"
                          colorScheme={selectedExamplePreviousResult.scheme}
                          borderRadius="full"
                        >
                          {selectedExamplePreviousResult.label}
                        </Badge>
                        <Text fontSize="sm">
                          {selectedExamplePreviousResult.detail}
                        </Text>
                      </Stack>
                    </Box>
                  ) : null}

                  {selectedExample.flipHash ? (
                    <Text color="muted" fontSize="xs">
                      {t('Flip hash')}: {selectedExample.flipHash}
                    </Text>
                  ) : null}
                </Stack>
              ) : null}
            </Box>
          </SimpleGrid>
        ) : (
          <Text color="muted" fontSize="sm">
            {t(
              'No detailed example flips were selected from the saved benchmark output yet.'
            )}
          </Text>
        )}
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
  const annotationWorkspaceRef = React.useRef(null)
  const developerSessionContextVersionRef = React.useRef(0)
  const developerSessionLoadRequestIdRef = React.useRef(0)
  const developerSessionStatusRequestIdRef = React.useRef(0)
  const developerComparisonExamplesRequestIdRef = React.useRef(0)
  const missingFieldSectionRefs = React.useRef({})
  const lastMissingFieldScrollKeyRef = React.useRef('')

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
  const [developerComparisonExamples, setDeveloperComparisonExamples] =
    React.useState(null)
  const [
    developerComparisonExamplesError,
    setDeveloperComparisonExamplesError,
  ] = React.useState('')
  const [
    isLoadingDeveloperComparisonExamples,
    setIsLoadingDeveloperComparisonExamples,
  ] = React.useState(false)
  const [isStoppingDeveloperRun, setIsStoppingDeveloperRun] =
    React.useState(false)
  const [isUpdatingDeveloperRunControls, setIsUpdatingDeveloperRunControls] =
    React.useState(false)
  const [developerPendingRunControl, setDeveloperPendingRunControl] =
    React.useState(null)
  const [developerBenchmarkReviewContext, setDeveloperBenchmarkReviewContext] =
    React.useState(null)
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
  const [
    developerTrainingPressureOverride,
    setDeveloperTrainingPressureOverride,
  ] = React.useState(false)
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
  const [highlightedMissingFields, setHighlightedMissingFields] =
    React.useState([])
  const [highlightedMissingFieldTaskId, setHighlightedMissingFieldTaskId] =
    React.useState('')
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

  const hasInteractiveLocalAiBridge = Boolean(
    global.localAi &&
      ['electron', 'browser_dev_api'].includes(global.localAi.bridgeMode)
  )

  const ensureBridge = React.useCallback(() => {
    if (
      !global.localAi ||
      !['electron', 'browser_dev_api'].includes(global.localAi.bridgeMode) ||
      typeof global.localAi.loadHumanTeacherPackage !== 'function'
    ) {
      throw new Error('Local AI human-teacher bridge is unavailable')
    }

    return global.localAi
  }, [])

  const refreshDeveloperTelemetry = React.useCallback(async () => {
    if (
      !isDeveloperMode ||
      !hasInteractiveLocalAiBridge ||
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
  }, [hasInteractiveLocalAiBridge, isDeveloperMode])

  const refreshDeveloperSessionState = React.useCallback(async () => {
    if (
      !isDeveloperMode ||
      !hasInteractiveLocalAiBridge ||
      !global.localAi ||
      typeof global.localAi.loadHumanTeacherDeveloperSessionState !== 'function'
    ) {
      return null
    }

    try {
      const requestContextVersion = developerSessionContextVersionRef.current
      const requestId = developerSessionStatusRequestIdRef.current + 1
      developerSessionStatusRequestIdRef.current = requestId
      const nextResult =
        await global.localAi.loadHumanTeacherDeveloperSessionState({
          sampleName: demoSampleName,
          currentPeriod,
        })

      if (
        developerSessionContextVersionRef.current !== requestContextVersion ||
        developerSessionStatusRequestIdRef.current !== requestId
      ) {
        return null
      }

      if (nextResult?.state) {
        setDeveloperSessionState(nextResult.state)
      }
      return nextResult
    } catch {
      return null
    }
  }, [
    currentPeriod,
    demoSampleName,
    hasInteractiveLocalAiBridge,
    isDeveloperMode,
  ])

  const stopDeveloperActiveRun = React.useCallback(
    async (stopMode = 'cancel_now') => {
      if (
        !isDeveloperMode ||
        !hasInteractiveLocalAiBridge ||
        !global.localAi ||
        typeof global.localAi.stopHumanTeacherDeveloperRun !== 'function'
      ) {
        return null
      }

      setIsStoppingDeveloperRun(true)

      try {
        const nextResult = await ensureBridge().stopHumanTeacherDeveloperRun({
          sampleName: demoSampleName,
          currentPeriod,
          stopMode,
        })

        if (nextResult?.state) {
          setDeveloperSessionState(nextResult.state)
        }

        if (nextResult?.stopped === true) {
          toast({
            title:
              stopMode === 'after_unit'
                ? t('Graceful stop requested')
                : t('Cancel requested'),
            description:
              stopMode === 'after_unit'
                ? t(
                    'This run will stop after the current step or benchmark flip finishes. It will not pause for resume later.'
                  )
                : t(
                    'The current local run is being cancelled now. The sticky run console will stay visible until the process exits.'
                  ),
            status: 'info',
            duration: 4000,
            isClosable: true,
          })
        } else {
          toast({
            title: t('No live local run to stop'),
            description: t(
              'The app did not find a running local training or benchmark process.'
            ),
            status: 'info',
            duration: 3500,
            isClosable: true,
          })
        }

        return nextResult
      } catch (nextError) {
        const message = formatErrorMessage(nextError)
        setError(message)
        toast({
          title: t('Could not stop the local run'),
          description: message,
          status: 'error',
          duration: 5000,
          isClosable: true,
        })
        return null
      } finally {
        setIsStoppingDeveloperRun(false)
      }
    },
    [
      currentPeriod,
      demoSampleName,
      ensureBridge,
      hasInteractiveLocalAiBridge,
      isDeveloperMode,
      t,
      toast,
    ]
  )

  const updateDeveloperActiveRunControls = React.useCallback(
    async (nextMode) => {
      const bridge = ensureBridge()

      if (
        !isDeveloperMode ||
        !bridge ||
        typeof bridge.updateHumanTeacherDeveloperRunControls !== 'function'
      ) {
        return null
      }

      const activeRun =
        developerSessionState &&
        typeof developerSessionState.activeRun === 'object' &&
        !Array.isArray(developerSessionState.activeRun)
          ? developerSessionState.activeRun
          : null
      const activeStage = String(activeRun?.stage || '')
        .trim()
        .toLowerCase()
      const activeKind = String(activeRun?.kind || '')
        .trim()
        .toLowerCase()
      const benchmarkPhase =
        activeKind === 'comparison' || activeStage.startsWith('benchmark_')
      const nextPayload = benchmarkPhase
        ? {localBenchmarkThermalMode: nextMode}
        : {localTrainingThermalMode: nextMode}

      setDeveloperPendingRunControl({mode: nextMode, benchmarkPhase})
      setIsUpdatingDeveloperRunControls(true)

      try {
        const nextResult = await bridge.updateHumanTeacherDeveloperRunControls({
          sampleName: demoSampleName,
          currentPeriod,
          ...nextPayload,
        })

        if (nextResult?.state) {
          setDeveloperSessionState(nextResult.state)
        }

        if (nextResult?.updated === true) {
          toast({
            title: benchmarkPhase
              ? t('Benchmark speed updated')
              : t('Training speed updated'),
            description: benchmarkPhase
              ? t('The next unseen flips will use the new benchmark heat mode.')
              : t(
                  'The next training steps will use the new training heat mode.'
                ),
            status: 'success',
            duration: 3000,
            isClosable: true,
          })
        } else {
          const message = String(
            nextResult?.lastError ||
              nextResult?.error ||
              t('The live run did not accept a new speed setting right now.')
          ).trim()

          setDeveloperPendingRunControl(null)
          setError(message)
          toast({
            title: t('Could not update run speed'),
            description: message,
            status: 'warning',
            duration: 5000,
            isClosable: true,
          })
        }

        return nextResult
      } catch (nextError) {
        const message = formatErrorMessage(nextError)
        setDeveloperPendingRunControl(null)
        setError(message)
        toast({
          title: t('Could not update run speed'),
          description: message,
          status: 'error',
          duration: 5000,
          isClosable: true,
        })
        return null
      } finally {
        setIsUpdatingDeveloperRunControls(false)
      }
    },
    [
      currentPeriod,
      demoSampleName,
      developerSessionState,
      ensureBridge,
      isDeveloperMode,
      setDeveloperPendingRunControl,
      t,
      toast,
    ]
  )

  const developerLocalBenchmarkSize = normalizeDeveloperLocalBenchmarkSize(
    localAi?.developerLocalBenchmarkSize ||
      DEFAULT_DEVELOPER_LOCAL_BENCHMARK_SIZE
  )

  const loadDeveloperComparisonExamples = React.useCallback(
    async ({sampleName = demoSampleName, benchmarkFlips} = {}) => {
      if (
        !isDeveloperMode ||
        !hasInteractiveLocalAiBridge ||
        !global.localAi ||
        typeof global.localAi.loadHumanTeacherDeveloperComparisonExamples !==
          'function'
      ) {
        return null
      }

      const requestId = developerComparisonExamplesRequestIdRef.current + 1
      developerComparisonExamplesRequestIdRef.current = requestId
      setIsLoadingDeveloperComparisonExamples(true)
      setDeveloperComparisonExamplesError('')

      try {
        const nextResult =
          await ensureBridge().loadHumanTeacherDeveloperComparisonExamples({
            sampleName,
            evaluationFlips: benchmarkFlips,
            currentPeriod,
            maxExamples: benchmarkFlips || developerLocalBenchmarkSize,
          })

        if (developerComparisonExamplesRequestIdRef.current !== requestId) {
          return null
        }

        setDeveloperComparisonExamples(nextResult || null)
        return nextResult
      } catch (nextError) {
        if (developerComparisonExamplesRequestIdRef.current !== requestId) {
          return null
        }

        setDeveloperComparisonExamples(null)
        setDeveloperComparisonExamplesError(formatErrorMessage(nextError))
        return null
      } finally {
        if (developerComparisonExamplesRequestIdRef.current === requestId) {
          setIsLoadingDeveloperComparisonExamples(false)
        }
      }
    },
    [
      currentPeriod,
      developerLocalBenchmarkSize,
      demoSampleName,
      ensureBridge,
      hasInteractiveLocalAiBridge,
      isDeveloperMode,
    ]
  )

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
  const developerLocalBenchmarkThermalMode =
    normalizeDeveloperLocalBenchmarkThermalMode(
      localAi?.developerLocalBenchmarkThermalMode ||
        DEFAULT_DEVELOPER_LOCAL_BENCHMARK_THERMAL_MODE
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
  const developerBenchmarkReviewRequiredFields =
    normalizeDeveloperBenchmarkReviewRequiredFields(
      localAi?.developerBenchmarkReviewRequiredFields,
      {
        fallbackToDefault:
          !localAi ||
          !Object.prototype.hasOwnProperty.call(
            localAi,
            'developerBenchmarkReviewRequiredFields'
          ),
      }
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
  const developerLocalTrainingBaseLabel =
    developerLocalTrainingModelPath || t('no bundled local training base')
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
  const developerLocalBenchmarkThermalSummary = React.useMemo(
    () =>
      describeDeveloperLocalBenchmarkThermalMode(
        developerLocalBenchmarkThermalMode,
        t
      ),
    [developerLocalBenchmarkThermalMode, t]
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
  const developerActiveRun = React.useMemo(() => {
    const source =
      developerSessionState &&
      typeof developerSessionState.activeRun === 'object' &&
      !Array.isArray(developerSessionState.activeRun)
        ? developerSessionState.activeRun
        : null

    return source || null
  }, [developerSessionState])
  const developerActiveRunStatus = String(
    developerActiveRun?.status || ''
  ).trim()
  const developerActiveRunIsBusy =
    developerActiveRunStatus === 'running' ||
    developerActiveRunStatus === 'stopping'
  const developerTelemetryIsBusy =
    isFinalizingDeveloperChunk ||
    isRunningDeveloperComparison ||
    developerActiveRunIsBusy
  const developerTrainingReadiness = React.useMemo(
    () => normalizeDeveloperTrainingReadiness(developerTelemetry, t),
    [developerTelemetry, t]
  )
  const developerTrainingBlockedBySystemPressure =
    developerTrainingReadiness.status === 'blocked'
  const developerTrainingRequiresOverride =
    developerTrainingReadiness.requiresExplicitOverride === true
  const developerTrainingReadyToStart =
    !developerTrainingBlockedBySystemPressure ||
    developerTrainingPressureOverride === true
  React.useEffect(() => {
    if (!developerPendingRunControl) {
      return
    }

    const activeMode = developerPendingRunControl.benchmarkPhase
      ? String(developerActiveRun?.benchmarkThermalMode || '').trim()
      : String(developerActiveRun?.trainingThermalMode || '').trim()

    if (
      !developerActiveRun ||
      developerActiveRun.status !== 'running' ||
      activeMode === String(developerPendingRunControl.mode || '').trim()
    ) {
      setDeveloperPendingRunControl(null)
    }
  }, [
    developerActiveRun,
    developerPendingRunControl,
    developerActiveRun?.benchmarkThermalMode,
    developerActiveRun?.status,
    developerActiveRun?.trainingThermalMode,
  ])
  const developerTrainingReadinessAlertStatus = React.useMemo(() => {
    if (developerTrainingReadiness.tone === 'red') {
      return 'error'
    }

    if (
      developerTrainingReadiness.tone === 'orange' ||
      developerTrainingReadiness.tone === 'yellow'
    ) {
      return 'warning'
    }

    return 'info'
  }, [developerTrainingReadiness.tone])

  React.useEffect(() => {
    if (!isDeveloperMode) {
      setDeveloperTelemetry(null)
      setDeveloperTelemetryError('')
      return undefined
    }

    const refreshIntervalMs =
      isFinalizingDeveloperChunk ||
      isRunningDeveloperComparison ||
      developerActiveRunIsBusy
        ? 3000
        : 10000

    const refreshNow = async () => {
      await refreshDeveloperTelemetry()
    }

    refreshNow()
    const intervalId = window.setInterval(refreshNow, refreshIntervalMs)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [
    developerActiveRunIsBusy,
    isDeveloperMode,
    isFinalizingDeveloperChunk,
    isRunningDeveloperComparison,
    refreshDeveloperTelemetry,
  ])

  React.useEffect(() => {
    if (!isDeveloperMode) {
      return undefined
    }

    const activeRunStatus = String(
      developerSessionState?.activeRun?.status || ''
    ).trim()
    const shouldPoll =
      isFinalizingDeveloperChunk ||
      isRunningDeveloperComparison ||
      activeRunStatus === 'running' ||
      activeRunStatus === 'stopping'

    if (!shouldPoll) {
      return undefined
    }

    const refreshNow = async () => {
      await refreshDeveloperSessionState()
    }

    refreshNow()
    const intervalId = window.setInterval(refreshNow, 2500)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [
    developerSessionState?.activeRun?.status,
    isDeveloperMode,
    isFinalizingDeveloperChunk,
    isRunningDeveloperComparison,
    refreshDeveloperSessionState,
  ])

  React.useEffect(() => {
    if (!developerTrainingBlockedBySystemPressure) {
      setDeveloperTrainingPressureOverride(false)
    }
  }, [developerTrainingBlockedBySystemPressure])

  React.useEffect(() => {
    const runtimeBackend = String(localAi?.runtimeBackend || '').trim()

    if (
      !isDeveloperMode ||
      localAi?.enabled !== true ||
      !supportsAiDraftRuntimeBackend(runtimeBackend)
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
    const runtimeBackend = String(localAi?.runtimeBackend || '').trim()
    const ollamaBackend = isOllamaLocalRuntimeBackend(runtimeBackend)

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
          installHint:
            requestedModel && ollamaBackend
              ? `ollama pull ${requestedModel}`
              : '',
        })
      )
      return undefined
    }

    if (!supportsAiDraftRuntimeBackend(runtimeBackend)) {
      setAiDraftRuntimeResolution(
        createAiDraftRuntimeResolution({
          status: 'unsupported_backend',
          requestedModel,
          fallbackModel: '',
          lastError: t(
            'The current Local AI runtime backend does not expose a supported local draft chat path here.'
          ),
          installHint:
            requestedModel && ollamaBackend
              ? `ollama pull ${requestedModel}`
              : '',
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
        installHint:
          requestedModel && ollamaBackend
            ? `ollama pull ${requestedModel}`
            : '',
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
            ollamaBackend
              ? createAiDraftRuntimeResolution({
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
              : createAiDraftRuntimeResolution({
                  status: requestedModel ? 'ready' : 'idle',
                  requestedModel,
                  activeModel: requestedModel,
                  fallbackModel: '',
                  availableModels: [],
                  lastError: String(
                    modelListResult?.lastError || modelListResult?.error || ''
                  ).trim(),
                })
          )
          return
        }

        setAiDraftRuntimeResolution(
          resolveAiDraftRuntimeResolution({
            requestedModel,
            availableModels: modelListResult.models,
            runtimeBackend,
          })
        )
      } catch (runtimeError) {
        if (isCancelled) {
          return
        }

        setAiDraftRuntimeResolution(
          ollamaBackend
            ? createAiDraftRuntimeResolution({
                status: 'error',
                requestedModel,
                fallbackModel: '',
                lastError: String(
                  (runtimeError && runtimeError.message) || runtimeError || ''
                ).trim(),
                installHint: requestedModel
                  ? `ollama pull ${requestedModel}`
                  : '',
              })
            : createAiDraftRuntimeResolution({
                status: requestedModel ? 'ready' : 'idle',
                requestedModel,
                activeModel: requestedModel,
                fallbackModel: '',
                availableModels: [],
                lastError: String(
                  (runtimeError && runtimeError.message) || runtimeError || ''
                ).trim(),
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
    setDeveloperTrainingPressureOverride(false)
    setChunkDecisionDialog({
      isOpen: true,
      mode,
    })
  }, [])

  const closeChunkDecisionDialog = React.useCallback(() => {
    setDeveloperTrainingPressureOverride(false)
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
    async ({
      offsetOverride,
      sampleNameOverride,
      preferredTaskIdOverride = '',
      allowCompletedPreferred = false,
    } = {}) => {
      const requestId = developerSessionLoadRequestIdRef.current + 1
      developerSessionLoadRequestIdRef.current = requestId
      const requestContextVersion =
        developerSessionContextVersionRef.current + 1
      developerSessionContextVersionRef.current = requestContextVersion
      const isCurrentRequest = () =>
        developerSessionLoadRequestIdRef.current === requestId &&
        developerSessionContextVersionRef.current === requestContextVersion

      setIsWorkspaceLoading(true)
      setError('')
      setImportResult(null)

      try {
        const activeSampleName = String(
          sampleNameOverride || demoSampleName
        ).trim()
        const nextResult =
          await ensureBridge().loadHumanTeacherDeveloperSession({
            sampleName: activeSampleName,
            offset: offsetOverride,
            currentPeriod,
          })

        if (!isCurrentRequest()) {
          return nextResult
        }

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
        if (activeSampleName && activeSampleName !== demoSampleName) {
          setDemoSampleName(activeSampleName)
        }
        setSelectedTaskId(
          pickPreferredTaskId(
            nextWorkspace,
            preferredTaskIdOverride || selectedTaskId,
            {
              allowCompletedPreferred,
            }
          )
        )

        if (queryAction === 'start') {
          router.replace('/settings/ai-human-teacher?developer=1')
        }

        return nextResult
      } catch (nextError) {
        if (!isCurrentRequest()) {
          return null
        }

        setWorkspace(null)
        setSelectedTaskId('')
        setTaskDetail(null)
        setAnnotationDraft(createEmptyAnnotationDraft())
        setDeveloperSessionState(null)
        setDeveloperActionResult(null)
        setError(formatErrorMessage(nextError))
      } finally {
        if (isCurrentRequest()) {
          setIsWorkspaceLoading(false)
        }
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
  const benchmarkReviewContextForCurrentTask = React.useMemo(() => {
    const reviewContext =
      developerBenchmarkReviewContext &&
      typeof developerBenchmarkReviewContext === 'object' &&
      !Array.isArray(developerBenchmarkReviewContext)
        ? developerBenchmarkReviewContext
        : null

    if (
      !reviewContext ||
      annotationSourceMode !== 'developer' ||
      String(reviewContext?.reviewTarget?.taskId || '').trim() !==
        String(selectedTaskId || '').trim()
    ) {
      return null
    }

    return reviewContext
  }, [annotationSourceMode, developerBenchmarkReviewContext, selectedTaskId])
  const activeBenchmarkReviewRequiredFields = React.useMemo(
    () =>
      benchmarkReviewContextForCurrentTask
        ? developerBenchmarkReviewRequiredFields
        : [],
    [
      benchmarkReviewContextForCurrentTask,
      developerBenchmarkReviewRequiredFields,
    ]
  )
  const normalizedDraft = React.useMemo(
    () => normalizeAnnotationDraft(annotationDraft),
    [annotationDraft]
  )
  const annotationCompletionState = React.useMemo(
    () =>
      getAnnotationCompletionState(annotationDraft, {
        benchmarkReviewRequiredFields: activeBenchmarkReviewRequiredFields,
      }),
    [activeBenchmarkReviewRequiredFields, annotationDraft]
  )
  const annotationCompletionItems = React.useMemo(() => {
    const items = [
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
    ]

    if (annotationCompletionState.hasBenchmarkReviewRequirements) {
      items.push({
        key: 'benchmark_review',
        label: t('Benchmark review'),
        done: annotationCompletionState.benchmarkReviewComplete,
        detail: t('{{done}} / {{total}} required', {
          done: annotationCompletionState.benchmarkReviewCompletedChecks,
          total: annotationCompletionState.benchmarkReviewTotalChecks,
        }),
      })
    }

    return items
  }, [
    annotationCompletionState.benchmarkReviewComplete,
    annotationCompletionState.benchmarkReviewCompletedChecks,
    annotationCompletionState.benchmarkReviewTotalChecks,
    annotationCompletionState.hasBenchmarkReviewRequirements,
    annotationCompletionState.hasConfidence,
    annotationCompletionState.hasDecision,
    annotationCompletionState.hasReason,
    annotationCompletionState.hasReportDecision,
    annotationCompletionState.hasReportReason,
    annotationCompletionState.hasSequenceDecision,
    annotationCompletionState.hasTextDecision,
    annotationDraft.confidence,
    annotationDraft.final_answer,
    t,
  ])
  const currentMissingRequiredFieldLabels = React.useMemo(
    () =>
      formatMissingRequiredFields(
        t,
        annotationCompletionState.missingRequiredFields
      ),
    [annotationCompletionState.missingRequiredFields, t]
  )
  const activeHighlightedMissingFields = React.useMemo(() => {
    const activeTaskId = String(selectedTaskId || '').trim()

    if (
      !activeTaskId ||
      activeTaskId !== String(highlightedMissingFieldTaskId || '').trim()
    ) {
      return []
    }

    return annotationCompletionState.missingRequiredFields.filter((fieldKey) =>
      highlightedMissingFields.includes(fieldKey)
    )
  }, [
    annotationCompletionState.missingRequiredFields,
    highlightedMissingFieldTaskId,
    highlightedMissingFields,
    selectedTaskId,
  ])
  const highlightedMissingFieldSet = React.useMemo(
    () => new Set(activeHighlightedMissingFields),
    [activeHighlightedMissingFields]
  )
  const canMoveForwardFromCurrentFlip = annotationCompletionState.isComplete
  const highlightMissingFields = React.useCallback(
    (fieldKeys = [], taskId = selectedTaskId) => {
      const targetTaskId = String(taskId || '').trim()
      const normalizedFieldKeys = Array.from(
        new Set(
          (Array.isArray(fieldKeys) ? fieldKeys : [])
            .map((fieldKey) => String(fieldKey || '').trim())
            .filter(Boolean)
        )
      )

      if (!targetTaskId || !normalizedFieldKeys.length) {
        return
      }

      setHighlightedMissingFieldTaskId(targetTaskId)
      setHighlightedMissingFields(normalizedFieldKeys)
      lastMissingFieldScrollKeyRef.current = ''
    },
    [selectedTaskId]
  )
  const revealCurrentMissingFields = React.useCallback(
    (fieldKeys = annotationCompletionState.missingRequiredFields) => {
      highlightMissingFields(fieldKeys, selectedTaskId)
    },
    [
      annotationCompletionState.missingRequiredFields,
      highlightMissingFields,
      selectedTaskId,
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
  const currentTaskStatusLabel = React.useMemo(() => {
    if (annotationCompletionState.isComplete) {
      return t('Complete')
    }

    if (hasDraftContent(annotationDraft)) {
      return t('Draft')
    }

    return t('Pending')
  }, [annotationCompletionState.isComplete, annotationDraft, t])
  const currentDraftHelperLabel = React.useMemo(() => {
    if (annotationCompletionState.isComplete) {
      return t('This flip looks complete.')
    }

    if (hasDraftContent(annotationDraft)) {
      return t('This flip still needs {{count}} required item(s).', {
        count: annotationCompletionState.missingRequiredFields.length,
      })
    }

    return t('No annotation content yet.')
  }, [
    annotationCompletionState.isComplete,
    annotationCompletionState.missingRequiredFields.length,
    annotationDraft,
    t,
  ])
  const showOptionalDetailSection =
    showAdvancedFields || annotationCompletionState.hasOptionalDetailContent
  const optionalDetailToggleLabel = React.useMemo(() => {
    if (showOptionalDetailSection) {
      return t('Hide optional detail')
    }

    if (annotationCompletionState.hasOptionalDetailContent) {
      return t('Review optional detail')
    }

    return t('Add optional detail')
  }, [
    annotationCompletionState.hasOptionalDetailContent,
    showOptionalDetailSection,
    t,
  ])
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
  const isFinalAnswerFieldHighlighted =
    highlightedMissingFieldSet.has('final_answer')
  const isReasonFieldHighlighted = highlightedMissingFieldSet.has('why_answer')
  const isTextDecisionFieldHighlighted =
    highlightedMissingFieldSet.has('text_required')
  const isSequenceDecisionFieldHighlighted = highlightedMissingFieldSet.has(
    'sequence_markers_present'
  )
  const isReportDecisionFieldHighlighted =
    highlightedMissingFieldSet.has('report_required')
  const isReportReasonFieldHighlighted =
    highlightedMissingFieldSet.has('report_reason')
  const isConfidenceFieldHighlighted =
    highlightedMissingFieldSet.has('confidence')
  const isBenchmarkReviewIssueTypeHighlighted = highlightedMissingFieldSet.has(
    'benchmark_review_issue_type'
  )
  const isBenchmarkReviewFailureNoteHighlighted =
    highlightedMissingFieldSet.has('benchmark_review_failure_note')
  const isBenchmarkReviewRetrainingHintHighlighted =
    highlightedMissingFieldSet.has('benchmark_review_retraining_hint')
  const isBenchmarkReviewIncludeForTrainingHighlighted =
    highlightedMissingFieldSet.has('benchmark_review_include_for_training')
  const benchmarkReviewRequiredFieldSet = React.useMemo(
    () => new Set(activeBenchmarkReviewRequiredFields),
    [activeBenchmarkReviewRequiredFields]
  )
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
                'This build does not expose the Local AI chat bridge yet. Fully restart IdenaAI and try again.'
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
                  'The current Local AI backend does not expose a supported local draft chat path here.'
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
                'No local runtime research model is configured on this desktop profile yet.'
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
                  'The requested runtime model is not available on the current local runtime yet.'
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
            runtimeBackend: localAi?.runtimeBackend,
          })

          setAiDraftRuntimeResolution(runtimeResolution)

          if (!runtimeResolution.activeModel) {
            throw new Error(
              runtimeResolution.fallbackReason ||
                t(
                  'The requested runtime model is not available on the current local runtime yet.'
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
          responseFormat: AI_ANNOTATION_RESPONSE_SCHEMA,
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

    if (
      !activeTaskId ||
      !selectedId ||
      activeTaskId !== selectedId ||
      activeTaskId !== String(highlightedMissingFieldTaskId || '').trim() ||
      !activeHighlightedMissingFields.length
    ) {
      return
    }

    const firstFieldKey = activeHighlightedMissingFields.find(
      (fieldKey) => missingFieldSectionRefs.current[fieldKey]
    )

    if (!firstFieldKey) {
      return
    }

    const scrollKey = `${activeTaskId}:${activeHighlightedMissingFields.join(
      ','
    )}`

    if (lastMissingFieldScrollKeyRef.current === scrollKey) {
      return
    }

    lastMissingFieldScrollKeyRef.current = scrollKey

    const sectionNode = missingFieldSectionRefs.current[firstFieldKey]

    if (sectionNode && typeof sectionNode.scrollIntoView === 'function') {
      window.requestAnimationFrame(() => {
        sectionNode.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        })
      })
    }
  }, [
    activeHighlightedMissingFields,
    highlightedMissingFieldTaskId,
    selectedTaskId,
    taskDetail?.taskId,
  ])

  React.useEffect(() => {
    if (
      annotationCompletionState.isComplete &&
      String(highlightedMissingFieldTaskId || '').trim() ===
        String(selectedTaskId || '').trim() &&
      highlightedMissingFields.length
    ) {
      setHighlightedMissingFields([])
      setHighlightedMissingFieldTaskId('')
      lastMissingFieldScrollKeyRef.current = ''
    }
  }, [
    annotationCompletionState.isComplete,
    highlightedMissingFieldTaskId,
    highlightedMissingFields.length,
    selectedTaskId,
  ])

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
      getWorkspaceCountsAfterSave(workspace, selectedTaskId, annotationDraft, {
        benchmarkReviewRequiredFields: activeBenchmarkReviewRequiredFields,
      }),
    [
      activeBenchmarkReviewRequiredFields,
      annotationDraft,
      selectedTaskId,
      workspace,
    ]
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
        const draftCompletion = getAnnotationCompletionState(annotationDraft, {
          benchmarkReviewRequiredFields: activeBenchmarkReviewRequiredFields,
        })
        const draftMissingRequiredFields = formatMissingRequiredFields(
          t,
          draftCompletion.missingRequiredFields
        )
        const nextDraftKey = buildAnnotationDraftKey({
          annotationSourceMode,
          epoch: nextEpoch,
          demoSampleName,
          demoOffset,
          developerOffset,
          selectedTaskId,
        })
        const workspacePreview = getWorkspacePreviewAfterSave(
          workspace,
          selectedTaskId,
          annotationDraft,
          {
            benchmarkReviewRequiredFields: activeBenchmarkReviewRequiredFields,
          }
        )
        const {completionState, firstIncompleteTaskId} = workspacePreview
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
                tasks: workspacePreview.tasks.map((task) =>
                  task.taskId === selectedTaskId
                    ? {
                        ...task,
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
        const shouldVerifyChunkCompletion =
          promptOnChunkComplete &&
          !nextTaskId &&
          completionState.allComplete &&
          (annotationSourceMode === 'developer' ||
            annotationSourceMode === 'demo')
        let willOpenChunkDecisionDialog = shouldVerifyChunkCompletion

        if (shouldVerifyChunkCompletion) {
          if (annotationSourceMode === 'developer') {
            const authoritativeResult =
              await ensureBridge().loadHumanTeacherDeveloperSession({
                sampleName: demoSampleName,
                offset: developerOffset,
                currentPeriod,
              })
            const authoritativeWorkspace =
              authoritativeResult?.workspace || null

            setAnnotationSourceMode('developer')
            setWorkspace(authoritativeWorkspace)
            setResult(authoritativeResult)
            setDemoSessionState(null)
            setDemoOffset(0)
            setDeveloperSessionState(authoritativeResult?.state || null)
            setDeveloperOffset(Number(authoritativeResult?.offset) || 0)
            setSelectedTaskId(
              pickPreferredTaskId(authoritativeWorkspace, selectedTaskId)
            )

            const authoritativeTaskCount = Number(
              authoritativeWorkspace?.taskCount
            )
            const authoritativeCompletedCount = Number(
              authoritativeWorkspace?.completedCount
            )

            willOpenChunkDecisionDialog =
              authoritativeTaskCount > 0 &&
              authoritativeCompletedCount >= authoritativeTaskCount

            if (!willOpenChunkDecisionDialog) {
              toast({
                title: t('This 5-flip chunk is not finished yet'),
                description: describeIncompleteWorkspaceTasks(
                  authoritativeWorkspace,
                  t
                ),
                status: 'info',
                duration: 4500,
                isClosable: true,
              })
            }
          } else if (annotationSourceMode === 'demo') {
            const authoritativeResult =
              await ensureBridge().loadHumanTeacherDemoWorkspace({
                sampleName: demoSampleName,
                offset: demoOffset,
              })
            const authoritativeWorkspace =
              authoritativeResult?.workspace || null

            setAnnotationSourceMode('demo')
            setWorkspace(authoritativeWorkspace)
            setResult(authoritativeResult)
            setDemoSessionState(authoritativeResult?.state || null)
            setDemoOffset(Number(authoritativeResult?.offset) || 0)
            setSelectedTaskId(
              pickPreferredTaskId(authoritativeWorkspace, selectedTaskId)
            )

            const authoritativeTaskCount = Number(
              authoritativeWorkspace?.taskCount
            )
            const authoritativeCompletedCount = Number(
              authoritativeWorkspace?.completedCount
            )

            willOpenChunkDecisionDialog =
              authoritativeTaskCount > 0 &&
              authoritativeCompletedCount >= authoritativeTaskCount

            if (!willOpenChunkDecisionDialog) {
              toast({
                title: t('This 5-flip demo chunk is not finished yet'),
                description: describeIncompleteWorkspaceTasks(
                  authoritativeWorkspace,
                  t
                ),
                status: 'info',
                duration: 4500,
                isClosable: true,
              })
            }
          }
        }

        if (!quiet) {
          let saveDescription = t('Your annotation was saved locally.')

          if (advance && nextTaskId) {
            if (draftCompletion.isComplete) {
              saveDescription = t('Saved. Moving to the next flip.')
            } else if (draftMissingRequiredFields) {
              saveDescription = t(
                'Saved. Finish this flip before moving on: {{fields}}.',
                {
                  fields: draftMissingRequiredFields,
                }
              )
            } else {
              saveDescription = t(
                'Saved. Finish the remaining required fields on this flip before moving on.'
              )
            }
          } else if (
            advance &&
            !nextTaskId &&
            !completionState.allComplete &&
            (annotationSourceMode === 'developer' ||
              annotationSourceMode === 'demo')
          ) {
            saveDescription = t(
              'Saved. This chunk is not complete yet, so the next unfinished flip will open instead.'
            )
          }

          if (
            isCompleteDraft(annotationDraft, {
              benchmarkReviewRequiredFields:
                activeBenchmarkReviewRequiredFields,
            }) &&
            !willOpenChunkDecisionDialog
          ) {
            rewardWithConfetti({particleCount: 70})
          }
          if (!willOpenChunkDecisionDialog) {
            toast({
              title: isCompleteDraft(annotationDraft, {
                benchmarkReviewRequiredFields:
                  activeBenchmarkReviewRequiredFields,
              })
                ? t('Flip saved')
                : t('Flip draft saved'),
              description: saveDescription,
              status: 'success',
              duration: 2500,
              isClosable: true,
            })
          }
        }

        if (advance && !autosave && !draftCompletion.isComplete) {
          if (nextTaskId) {
            highlightMissingFields(
              draftCompletion.missingRequiredFields,
              selectedTaskId
            )
          } else if (!completionState.allComplete && firstIncompleteTaskId) {
            const firstIncompleteTask = workspacePreview.tasks.find(
              (task) => task.taskId === firstIncompleteTaskId
            )

            highlightMissingFields(
              firstIncompleteTask?.missingRequiredFields ||
                draftCompletion.missingRequiredFields,
              firstIncompleteTaskId
            )
          }
        }

        if (advance && nextTaskId && draftCompletion.isComplete) {
          setSelectedTaskId(nextTaskId)
        } else if (
          advance &&
          !nextTaskId &&
          !completionState.allComplete &&
          firstIncompleteTaskId
        ) {
          setSelectedTaskId(firstIncompleteTaskId)
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
      activeBenchmarkReviewRequiredFields,
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
      highlightMissingFields,
    ]
  )

  const navigateToTask = React.useCallback(
    async (taskId) => {
      const nextTargetTaskId = String(taskId || '').trim()

      if (!nextTargetTaskId || nextTargetTaskId === selectedTaskId) {
        return
      }

      const nextTargetTaskIndex = taskIds.indexOf(nextTargetTaskId)

      if (
        nextTargetTaskIndex > selectedTaskIndex &&
        !canMoveForwardFromCurrentFlip
      ) {
        revealCurrentMissingFields()
        toast({
          title: t('Finish this flip first'),
          description: currentMissingRequiredFieldLabels
            ? t('Still missing: {{fields}}.', {
                fields: currentMissingRequiredFieldLabels,
              })
            : t('This flip still has required fields missing.'),
          status: 'info',
          duration: 4000,
          isClosable: true,
        })
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
    [
      canMoveForwardFromCurrentFlip,
      currentMissingRequiredFieldLabels,
      hasUnsavedDraftChanges,
      revealCurrentMissingFields,
      saveTaskDraft,
      selectedTaskId,
      selectedTaskIndex,
      t,
      taskIds,
      toast,
    ]
  )

  const handleReviewDeveloperBenchmarkExample = React.useCallback(
    async (example) => {
      const reviewTarget =
        example &&
        typeof example === 'object' &&
        !Array.isArray(example) &&
        example.reviewTarget &&
        typeof example.reviewTarget === 'object'
          ? example.reviewTarget
          : null

      if (!reviewTarget?.taskId) {
        toast({
          title: t('Benchmark review target missing'),
          description: t(
            'This saved benchmark example is not linked to a reviewable developer flip yet.'
          ),
          status: 'warning',
          duration: 4000,
          isClosable: true,
        })
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

      const nextResult = await loadDeveloperSession({
        sampleNameOverride: reviewTarget.sampleName || demoSampleName,
        offsetOverride: reviewTarget.offset,
        preferredTaskIdOverride: reviewTarget.taskId,
        allowCompletedPreferred: true,
      })

      const nextTasks = Array.isArray(nextResult?.workspace?.tasks)
        ? nextResult.workspace.tasks
        : []

      if (!nextTasks.some((task) => task.taskId === reviewTarget.taskId)) {
        toast({
          title: t('Could not open benchmark review'),
          description: t(
            'The linked developer flip is not available in the current sample.'
          ),
          status: 'error',
          duration: 4500,
          isClosable: true,
        })
        return
      }

      setSelectedTaskId(reviewTarget.taskId)
      setDeveloperBenchmarkReviewContext(example)

      if (typeof window !== 'undefined') {
        window.setTimeout(() => {
          const nextNode = annotationWorkspaceRef.current

          if (nextNode && typeof nextNode.scrollIntoView === 'function') {
            nextNode.scrollIntoView({
              behavior: 'smooth',
              block: 'start',
            })
          }
        }, 120)
      }

      toast({
        title: t('Benchmark flip opened for review'),
        description: t(
          'This flip is now open in the annotation flow. Save your human answer to feed the next local adapter run.'
        ),
        status: 'success',
        duration: 3500,
        isClosable: true,
      })
    },
    [
      demoSampleName,
      hasUnsavedDraftChanges,
      loadDeveloperSession,
      saveTaskDraft,
      t,
      toast,
    ]
  )

  const finalizeDeveloperChunk = React.useCallback(
    async ({
      trainNow = false,
      advance = false,
      exitAfter = false,
      allowSystemPressureOverride = false,
      offsetOverride = null,
      skipCurrentChunkCompletionCheck = false,
      restoreOffsetOverride = null,
    } = {}) => {
      const targetOffset =
        typeof offsetOverride === 'number' ? offsetOverride : developerOffset
      const trainingSavedChunkOnly = targetOffset !== developerOffset
      const targetChunkRangeLabel = formatChunkRangeLabel(targetOffset, {
        totalCount: Number(developerSessionState?.totalAvailableTasks) || 0,
      })
      const saved = await saveTaskDraft({
        quiet: true,
        promptOnChunkComplete: false,
      })

      if (!saved) {
        return null
      }

      if (
        !skipCurrentChunkCompletionCheck &&
        !saved.completionState.allComplete
      ) {
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
            offset: targetOffset,
            currentPeriod,
            trainNow,
            advance,
            allowSystemPressureOverride,
            trainingModelPath: developerLocalTrainingModelPath,
            localTrainingProfile: developerLocalTrainingProfile,
            localTrainingThermalMode: developerLocalTrainingThermalMode,
            localBenchmarkThermalMode: developerLocalBenchmarkThermalMode,
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
          const trainingStoppedAfterAdapterFinished =
            nextResult?.training?.status === 'stopped' &&
            nextResult?.training?.partialTrainingCompleted === true

          if (nextResult?.training?.ok || trainingStoppedAfterAdapterFinished) {
            const latestAccuracy = nextResult?.state?.comparison100?.accuracy
            const latestCorrect = nextResult?.state?.comparison100?.correct
            const latestTotal = nextResult?.state?.comparison100?.totalFlips
            let successDescription = t(
              'This 5-flip chunk is now part of the active local model.'
            )

            if (trainingSavedChunkOnly) {
              successDescription = t(
                'Saved flips {{range}} are now part of the active local adapter.',
                {
                  range: targetChunkRangeLabel,
                }
              )
            }

            if (typeof latestAccuracy === 'number') {
              successDescription = trainingSavedChunkOnly
                ? t(
                    'Saved flips {{range}} were trained into the local adapter. Latest success rate: {{accuracy}} ({{correct}} / {{total}}).',
                    {
                      range: targetChunkRangeLabel,
                      accuracy: formatSuccessRate(latestAccuracy),
                      correct: Number(latestCorrect) || 0,
                      total: Number(latestTotal) || 0,
                    }
                  )
                : t(
                    'This 5-flip chunk was trained locally and is now part of the active model. Latest success rate: {{accuracy}} ({{correct}} / {{total}}).',
                    {
                      accuracy: formatSuccessRate(latestAccuracy),
                      correct: Number(latestCorrect) || 0,
                      total: Number(latestTotal) || 0,
                    }
                  )
            }

            if (trainingStoppedAfterAdapterFinished) {
              successDescription = trainingSavedChunkOnly
                ? t(
                    'Saved flips {{range}} were trained into the local adapter. The benchmark was stopped before it finished, so you can rerun the comparison later.',
                    {
                      range: targetChunkRangeLabel,
                    }
                  )
                : t(
                    'This 5-flip chunk was trained into the local model. The benchmark was stopped before it finished, so you can rerun the comparison later.'
                  )
            }

            toast({
              title: trainingSavedChunkOnly
                ? t('Saved adapter chunk trained')
                : t('Training finished'),
              description: successDescription,
              status: 'success',
              duration: 4500,
              isClosable: true,
            })
          } else {
            let failedTrainingDescription = t(
              'Your 5 annotated flips were stored locally, but the active local model is unchanged right now because training did not complete yet.'
            )

            if (trainingSavedChunkOnly) {
              failedTrainingDescription = t(
                'Saved flips {{range}} are still queued locally because adapter training did not complete yet.',
                {
                  range: targetChunkRangeLabel,
                }
              )
            }

            if (trainingFailureReason) {
              failedTrainingDescription = trainingSavedChunkOnly
                ? t(
                    'Saved flips {{range}} are still queued locally because adapter training failed. Reason: {{reason}}',
                    {
                      range: targetChunkRangeLabel,
                      reason: trainingFailureReason,
                    }
                  )
                : t(
                    'Your 5 annotated flips were stored locally, but the active local model is unchanged because training failed. Reason: {{reason}}',
                    {
                      reason: trainingFailureReason,
                    }
                  )
            }

            toast({
              title: trainingSavedChunkOnly
                ? t('Saved adapter chunk still pending')
                : t('Chunk saved for training'),
              description: failedTrainingDescription,
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

        const nextLoadOffset =
          typeof restoreOffsetOverride === 'number'
            ? restoreOffsetOverride
            : nextResult.nextOffset

        await loadDeveloperSession({offsetOverride: nextLoadOffset})

        if (exitAfter) {
          router.push('/ai-chat')
        }

        return nextResult
      } catch (nextError) {
        const message = formatErrorMessage(nextError)

        if (isIncompleteDeveloperChunkError(message)) {
          const authoritativeResult = await loadDeveloperSession({
            offsetOverride: developerOffset,
          })
          const authoritativeWorkspace = authoritativeResult?.workspace || null

          toast({
            title: t('This 5-flip chunk is not finished yet'),
            description: describeIncompleteWorkspaceTasks(
              authoritativeWorkspace,
              t
            ),
            status: 'info',
            duration: 4500,
            isClosable: true,
          })
          return {
            recovered: true,
            incomplete: true,
          }
        }

        let failureTitle = t('Could not finish this chunk')

        if (trainNow) {
          failureTitle = trainingSavedChunkOnly
            ? t('Saved adapter chunk did not start')
            : t('Local training did not start')
        } else if (advance) {
          failureTitle = t('Could not open the next 5 flips')
        }

        setError(message)
        toast({
          title: failureTitle,
          description: message,
          status: 'error',
          duration: 5000,
          isClosable: true,
        })
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
      developerLocalBenchmarkThermalMode,
      developerSessionState,
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
        const message = formatErrorMessage(nextError)

        if (isIncompleteDemoChunkError(message)) {
          const authoritativeResult = await loadOfflineDemoWorkspace({
            offsetOverride: demoOffset,
          })
          const authoritativeWorkspace = authoritativeResult?.workspace || null

          toast({
            title: t('This 5-flip demo chunk is not finished yet'),
            description: describeIncompleteWorkspaceTasks(
              authoritativeWorkspace,
              t
            ),
            status: 'info',
            duration: 4500,
            isClosable: true,
          })
          return {
            recovered: true,
            incomplete: true,
          }
        }

        let failureTitle = t('Could not finish this demo chunk')

        if (trainNow) {
          failureTitle = t('Demo training did not start')
        } else if (advance) {
          failureTitle = t('Could not open the next 5 demo flips')
        }

        setError(message)
        toast({
          title: failureTitle,
          description: message,
          status: 'error',
          duration: 5000,
          isClosable: true,
        })
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
    const trainedCount = Number(developerSessionState?.trainedCount) || 0

    if (trainedCount < 1) {
      toast({
        title: t('Train one chunk first'),
        description: t(
          'The {{count}}-flip comparison unlocks after at least one 5-flip chunk was trained into the local model.',
          {
            count: developerLocalBenchmarkSize,
          }
        ),
        status: 'info',
        duration: 4500,
        isClosable: true,
      })
      return null
    }

    setIsRunningDeveloperComparison(true)
    setError('')

    try {
      const nextResult =
        await ensureBridge().runHumanTeacherDeveloperComparison({
          sampleName: demoSampleName,
          currentPeriod,
          evaluationFlips: developerLocalBenchmarkSize,
          localBenchmarkThermalMode: developerLocalBenchmarkThermalMode,
        })
      setDeveloperActionResult(nextResult)
      setDeveloperSessionState(nextResult.state || null)

      const comparisonOk = nextResult?.comparison?.ok === true
      const comparisonFailureReason = String(
        nextResult?.comparison?.failureReason ||
          nextResult?.comparison?.lastError ||
          nextResult?.comparison?.error ||
          ''
      ).trim()
      const latestAccuracy = nextResult?.state?.comparison100?.accuracy
      const latestCorrect = nextResult?.state?.comparison100?.correct
      const latestTotal = nextResult?.state?.comparison100?.totalFlips
      const comparisonHasMetrics =
        typeof latestAccuracy === 'number' ||
        (typeof latestCorrect === 'number' && typeof latestTotal === 'number')

      if (!comparisonOk || !comparisonHasMetrics) {
        const message =
          comparisonFailureReason ||
          (comparisonHasMetrics
            ? t('The local comparison did not finish successfully.')
            : t('The local comparison finished without benchmark metrics.'))

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
      }

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
    developerSessionState,
    demoSampleName,
    developerLocalBenchmarkThermalMode,
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
  const developerHasTrainedModel = developerTrainedCount > 0
  const developerSavedPendingChunk = React.useMemo(() => {
    const chunks = Array.isArray(developerSessionState?.chunks)
      ? developerSessionState.chunks
      : []

    return (
      chunks.find((chunk) => {
        const status = String(chunk?.trainingStatus || '')
          .trim()
          .toLowerCase()

        return (
          Number(chunk?.rowCount) > 0 &&
          status !== 'trained' &&
          status !== 'demo_trained'
        )
      }) || null
    )
  }, [developerSessionState?.chunks])
  const developerSavedPendingChunkOffset =
    typeof developerSavedPendingChunk?.offset === 'number'
      ? developerSavedPendingChunk.offset
      : null
  const developerHasSavedPendingChunk =
    developerSavedPendingChunkOffset !== null && developerPendingCount > 0
  const developerSavedPendingChunkRangeLabel =
    developerHasSavedPendingChunk && developerSavedPendingChunkOffset !== null
      ? formatChunkRangeLabel(developerSavedPendingChunkOffset, {
          totalCount: Number(developerSessionState?.totalAvailableTasks) || 0,
        })
      : ''
  const developerRemainingCount =
    Number(developerSessionState?.remainingTaskCount) || 0
  const developerComparison = developerSessionState?.comparison100 || null
  const developerLastTraining = developerSessionState?.lastTraining || null
  const developerSupportsLocalTraining =
    hasInteractiveLocalAiBridge &&
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
        Number.parseInt(entry?.benchmarkFlips, 10) ===
        developerLocalBenchmarkSize
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
      (isRunningDeveloperComparison ||
      developerActiveRun?.kind === 'comparison' ||
      (developerActiveRun?.kind === 'training' &&
        String(developerActiveRun?.stage || '')
          .trim()
          .startsWith('benchmark_'))
        ? 'running'
        : 'not_loaded')
  ).trim()
  const developerAccuracyDelta =
    latestDeveloperComparison &&
    previousDeveloperComparison &&
    typeof latestDeveloperComparison.accuracy === 'number' &&
    typeof previousDeveloperComparison.accuracy === 'number'
      ? latestDeveloperComparison.accuracy -
        previousDeveloperComparison.accuracy
      : null
  const latestDeveloperComparisonSignature = React.useMemo(
    () =>
      [
        latestDeveloperComparison?.status || '',
        latestDeveloperComparison?.lastEvaluatedAt || '',
        latestDeveloperComparison?.accuracy ?? '',
        latestDeveloperComparison?.correct ?? '',
        latestDeveloperComparison?.totalFlips ?? '',
        latestDeveloperComparison?.benchmarkFlips ?? '',
      ].join('::'),
    [
      latestDeveloperComparison?.accuracy,
      latestDeveloperComparison?.benchmarkFlips,
      latestDeveloperComparison?.correct,
      latestDeveloperComparison?.lastEvaluatedAt,
      latestDeveloperComparison?.status,
      latestDeveloperComparison?.totalFlips,
    ]
  )
  const previousDeveloperComparisonSignature = React.useMemo(
    () =>
      [
        previousDeveloperComparison?.status || '',
        previousDeveloperComparison?.lastEvaluatedAt || '',
        previousDeveloperComparison?.accuracy ?? '',
        previousDeveloperComparison?.correct ?? '',
        previousDeveloperComparison?.totalFlips ?? '',
        previousDeveloperComparison?.benchmarkFlips ?? '',
      ].join('::'),
    [
      previousDeveloperComparison?.accuracy,
      previousDeveloperComparison?.benchmarkFlips,
      previousDeveloperComparison?.correct,
      previousDeveloperComparison?.lastEvaluatedAt,
      previousDeveloperComparison?.status,
      previousDeveloperComparison?.totalFlips,
    ]
  )
  const hasSavedDeveloperComparison = React.useMemo(
    () =>
      Boolean(
        latestDeveloperComparison &&
          (latestDeveloperComparison.lastEvaluatedAt ||
            typeof latestDeveloperComparison.accuracy === 'number' ||
            typeof latestDeveloperComparison.correct === 'number' ||
            typeof latestDeveloperComparison.totalFlips === 'number')
      ),
    [latestDeveloperComparison]
  )

  const developerCanRunComparison =
    isDeveloperMode &&
    developerHasTrainedModel &&
    developerSupportsLocalTraining &&
    !isRunningDeveloperComparison &&
    !developerActiveRunIsBusy
  const developerComparisonBlockedReason = React.useMemo(() => {
    if (!isDeveloperMode) {
      return ''
    }

    if (!hasInteractiveLocalAiBridge) {
      return t('Local training bridge unavailable in this runtime.')
    }

    if (!developerSupportsLocalTraining) {
      return t('Local comparison needs a trainable local backend.')
    }

    if (!developerHasTrainedModel) {
      return t(
        'Run local training once first. Comparison needs at least one learned chunk.'
      )
    }

    return ''
  }, [
    hasInteractiveLocalAiBridge,
    developerHasTrainedModel,
    developerSupportsLocalTraining,
    isDeveloperMode,
    t,
  ])
  const developerTrainingRunActive =
    isFinalizingDeveloperChunk ||
    ((developerActiveRunStatus === 'running' ||
      developerActiveRunStatus === 'stopping') &&
      developerActiveRun?.kind === 'training')
  const developerComparisonRunActive =
    isRunningDeveloperComparison ||
    ((developerActiveRunStatus === 'running' ||
      developerActiveRunStatus === 'stopping') &&
      developerActiveRun?.kind === 'comparison')
  const developerStickyRunConsoleVisible =
    isDeveloperMode &&
    (developerActiveRunIsBusy ||
      isStoppingDeveloperRun ||
      developerTrainingRunActive ||
      developerComparisonRunActive)
  const developerCanAdvance =
    isDeveloperMode &&
    totalTaskCount > 0 &&
    completionPreview.allComplete &&
    developerRemainingCount > 0 &&
    developerOffset + DEVELOPER_TRAINING_CHUNK_SIZE <
      Number(developerSessionState?.totalAvailableTasks || 0)

  React.useEffect(() => {
    if (
      !isDeveloperMode ||
      developerTrainingRunActive ||
      developerComparisonRunActive
    ) {
      return undefined
    }

    if (!hasSavedDeveloperComparison) {
      setDeveloperComparisonExamples(null)
      setDeveloperComparisonExamplesError('')
      setIsLoadingDeveloperComparisonExamples(false)
      return undefined
    }

    const loadExamples = async () => {
      await loadDeveloperComparisonExamples({
        sampleName: demoSampleName,
        benchmarkFlips: developerLocalBenchmarkSize,
      })
    }

    loadExamples()
    return undefined
  }, [
    demoSampleName,
    developerComparisonRunActive,
    developerLocalBenchmarkSize,
    developerTrainingRunActive,
    hasSavedDeveloperComparison,
    isDeveloperMode,
    loadDeveloperComparisonExamples,
    latestDeveloperComparisonSignature,
    previousDeveloperComparisonSignature,
  ])
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
  const activeDeveloperBenchmarkReviewContext =
    benchmarkReviewContextForCurrentTask
  const activeBenchmarkReviewSuggestion = React.useMemo(
    () =>
      activeDeveloperBenchmarkReviewContext
        ? buildBenchmarkReviewSuggestion(
            activeDeveloperBenchmarkReviewContext,
            t
          )
        : null,
    [activeDeveloperBenchmarkReviewContext, t]
  )
  React.useEffect(() => {
    if (!activeDeveloperBenchmarkReviewContext) {
      return
    }

    setAnnotationDraft((current) => {
      const normalized = mergeBenchmarkReviewContextIntoDraft(
        current,
        activeDeveloperBenchmarkReviewContext
      )
      const next = applyBenchmarkReviewSuggestionToDraft(
        normalized,
        activeBenchmarkReviewSuggestion,
        {overwrite: false}
      )

      if (
        next.benchmark_review_issue_type ===
          normalized.benchmark_review_issue_type &&
        next.benchmark_review_failure_note ===
          normalized.benchmark_review_failure_note &&
        next.benchmark_review_retraining_hint ===
          normalized.benchmark_review_retraining_hint &&
        next.benchmark_review_include_for_training ===
          normalized.benchmark_review_include_for_training
      ) {
        return current
      }

      return next
    })
  }, [activeBenchmarkReviewSuggestion, activeDeveloperBenchmarkReviewContext])
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
  const developerPrimaryDashboardActionLabel = React.useMemo(() => {
    if (developerTrainingRunActive) {
      return t('Local training in progress')
    }

    if (developerComparisonRunActive) {
      return t('Benchmark in progress')
    }

    if (!workspace || !isDeveloperSourceMode) {
      return hasInteractiveLocalAiBridge
        ? t('Open teaching chunk')
        : t('Desktop app required')
    }

    if (
      developerTrainingBlockedBySystemPressure &&
      developerTrainingRequiresOverride &&
      (completionPreview.allComplete || developerHasSavedPendingChunk)
    ) {
      return t('Review local training block')
    }

    if (developerHasSavedPendingChunk && !completionPreview.allComplete) {
      return t('Train saved adapter chunk now')
    }

    if (!completionPreview.allComplete) {
      return t('Continue teaching this 5-flip chunk')
    }

    return t('Start local adapter training now')
  }, [
    completionPreview.allComplete,
    hasInteractiveLocalAiBridge,
    developerComparisonRunActive,
    developerHasSavedPendingChunk,
    developerTrainingBlockedBySystemPressure,
    developerTrainingRequiresOverride,
    developerTrainingRunActive,
    isDeveloperSourceMode,
    t,
    workspace,
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

  const handlePrimaryLocalTrainingDashboardAction =
    React.useCallback(async () => {
      if (developerTrainingRunActive || developerComparisonRunActive) {
        return
      }

      if (!workspace || !isDeveloperSourceMode) {
        await loadDeveloperSession()
        if (typeof window !== 'undefined') {
          window.setTimeout(() => {
            scrollToLocalPilotTraining()
          }, 120)
        }
        return
      }

      if (developerHasSavedPendingChunk && !completionPreview.allComplete) {
        if (
          developerTrainingBlockedBySystemPressure &&
          developerTrainingRequiresOverride
        ) {
          openLocalPilotTrainingDialog()
          return
        }

        await finalizeDeveloperChunk({
          trainNow: true,
          allowSystemPressureOverride: developerTrainingPressureOverride,
          offsetOverride: developerSavedPendingChunkOffset,
          skipCurrentChunkCompletionCheck: true,
          restoreOffsetOverride: developerOffset,
        })
        return
      }

      if (!completionPreview.allComplete) {
        scrollToLocalPilotTraining()
        return
      }

      if (
        developerTrainingBlockedBySystemPressure &&
        developerTrainingRequiresOverride
      ) {
        openLocalPilotTrainingDialog()
        return
      }

      await finalizeDeveloperChunk({
        trainNow: true,
        allowSystemPressureOverride: developerTrainingPressureOverride,
      })
    }, [
      completionPreview.allComplete,
      developerComparisonRunActive,
      developerHasSavedPendingChunk,
      developerSavedPendingChunkOffset,
      developerTrainingBlockedBySystemPressure,
      developerTrainingPressureOverride,
      developerTrainingRequiresOverride,
      developerTrainingRunActive,
      developerOffset,
      finalizeDeveloperChunk,
      isDeveloperSourceMode,
      loadDeveloperSession,
      openLocalPilotTrainingDialog,
      scrollToLocalPilotTraining,
      workspace,
    ])

  const handleChunkDecisionAction = React.useCallback(
    async (action) => {
      const mode = chunkDecisionMode
      let nextResult = null

      if (mode === 'developer') {
        if (action === 'train') {
          nextResult = await finalizeDeveloperChunk({
            trainNow: true,
            allowSystemPressureOverride: developerTrainingPressureOverride,
          })
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
      developerTrainingPressureOverride,
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
                {developerStickyRunConsoleVisible ? (
                  <LocalTrainingStickyRunConsole
                    activeRun={developerActiveRun}
                    telemetry={developerTelemetry}
                    totalAvailableTasks={
                      Number(developerSessionState?.totalAvailableTasks) || 0
                    }
                    onStopNow={() => stopDeveloperActiveRun('cancel_now')}
                    onStopAfterUnit={() => stopDeveloperActiveRun('after_unit')}
                    onUpdateRunControls={updateDeveloperActiveRunControls}
                    pendingRunControl={developerPendingRunControl}
                    isStopping={isStoppingDeveloperRun}
                    isUpdatingRunControls={isUpdatingDeveloperRunControls}
                    t={t}
                  />
                ) : null}
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
                    <Text color="muted" fontSize="xs" mt={2}>
                      {t(
                        'Choose the bundled sample here. Open or resume the 5-flip teaching chunk in the local pilot section below.'
                      )}
                    </Text>
                  </Box>
                  <SecondaryButton onClick={() => router.push('/ai-chat')}>
                    {t('Back to IdenaAI')}
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
                            isDisabled={!hasInteractiveLocalAiBridge}
                            onClick={openLocalPilotTrainingDialog}
                          >
                            {t('Review local pilot training')}
                          </SecondaryButton>
                        </Stack>
                      </Box>
                    </SimpleGrid>
                  </Stack>
                </Box>

                {!developerStickyRunConsoleVisible ? (
                  <LocalTrainingImpactPanel
                    telemetry={developerTelemetry}
                    telemetryError={developerTelemetryError}
                    thermalSummary={developerLocalTrainingThermalSummary}
                    isBusy={developerTelemetryIsBusy}
                    t={t}
                  />
                ) : null}
                {!developerStickyRunConsoleVisible ? (
                  <LocalTrainingRunPanel
                    activeRun={developerActiveRun}
                    totalAvailableTasks={
                      Number(developerSessionState?.totalAvailableTasks) || 0
                    }
                    t={t}
                  />
                ) : null}
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
                  isTrainingActive={developerTrainingRunActive}
                  isComparisonActive={developerComparisonRunActive}
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
                    {!hasInteractiveLocalAiBridge ? (
                      <Alert status="warning" borderRadius="md">
                        <Text fontSize="sm">
                          {t(
                            'The local training bridge is unavailable here right now.'
                          )}
                        </Text>
                      </Alert>
                    ) : null}
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
                            'Use the button here to open or resume the 5-flip teaching chunk from the bundled FLIP developer sample.'
                          )}
                    </Text>
                    <Stack isInline spacing={2} flexWrap="wrap">
                      <PrimaryButton
                        isDisabled={
                          !hasInteractiveLocalAiBridge ||
                          isWorkspaceLoading ||
                          developerTrainingRunActive ||
                          developerComparisonRunActive
                        }
                        isLoading={
                          isWorkspaceLoading || developerTrainingRunActive
                        }
                        onClick={handlePrimaryLocalTrainingDashboardAction}
                      >
                        {developerPrimaryDashboardActionLabel}
                      </PrimaryButton>
                      <SecondaryButton
                        isDisabled={
                          !hasInteractiveLocalAiBridge ||
                          !developerCanRunComparison
                        }
                        isLoading={developerComparisonRunActive}
                        onClick={runDeveloperComparison}
                      >
                        {t('Run {{count}}-flip comparison now', {
                          count: developerLocalBenchmarkSize,
                        })}
                      </SecondaryButton>
                    </Stack>
                    {!developerCanRunComparison &&
                    developerComparisonBlockedReason ? (
                      <Text color="muted" fontSize="xs">
                        {developerComparisonBlockedReason}
                      </Text>
                    ) : null}
                    {developerHasSavedPendingChunk &&
                    !completionPreview.allComplete ? (
                      <Text color="muted" fontSize="xs">
                        {t(
                          'Saved flips {{range}} are ready for adapter training now. Your current chunk can stay unfinished while that older saved chunk trains.',
                          {
                            range: developerSavedPendingChunkRangeLabel,
                          }
                        )}
                      </Text>
                    ) : null}
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
                    {developerTrainingRunActive ? (
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
                              'The app is running local training and the follow-up benchmark right now. Watch the live run panel above for the current stage.'
                            )}
                          </Text>
                        </Stack>
                      </Box>
                    ) : null}
                    {developerComparisonRunActive ? (
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
                              'The app is checking the latest local model against the same {{count}}-flip validation holdout used for earlier runs at this size. The live run panel shows which unseen flip is being scored now.',
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
                            'This local draft path stays pinned to the currently requested runtime. If that model is missing, drafting should stop instead of silently switching to some older runtime.'
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
                          {developerLocalTrainingBaseLabel}
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
                    {developerComparisonHistoryForSelectedBenchmark.length ? (
                      <SuccessRateHistoryChart
                        entries={developerComparisonHistoryForSelectedBenchmark}
                        t={t}
                      />
                    ) : null}
                    <DeveloperBenchmarkExamplesPanel
                      data={developerComparisonExamples}
                      benchmarkSize={developerLocalBenchmarkSize}
                      isLoading={isLoadingDeveloperComparisonExamples}
                      error={developerComparisonExamplesError}
                      activeRun={developerActiveRun}
                      telemetry={developerTelemetry}
                      onReviewExample={handleReviewDeveloperBenchmarkExample}
                      t={t}
                    />
                    <Text color="muted" fontSize="xs">
                      {t('Current local pilot preset')}:{' '}
                      {developerLocalTrainingProfileSummary.label} ·{' '}
                      {developerLocalTrainingBaseLabel}
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
                        {t('Package file')}: {result.packagePath}
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
                    {t('Workspace folder')}: {exportResult.outputDir}
                  </Text>
                  <Text color="muted" fontSize="xs">
                    {t('Manifest file')}: {exportResult.manifestPath}
                  </Text>
                  <Text color="muted" fontSize="xs">
                    {t('Template file')}: {exportResult.templatePath}
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
                    {t('Imported file name')}: {importResult.annotationsPath}
                  </Text>
                  <Text color="muted" fontSize="xs">
                    {t('Normalized file')}: {importResult.normalizedPath}
                  </Text>
                  <Text color="muted" fontSize="xs">
                    {t('Summary file')}: {importResult.summaryPath}
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
                        'Current local research slot: requested runtime {{draftModel}}. Active runtime on this Mac: {{activeModel}}. Local training base: {{trainingModel}}.',
                        {
                          draftModel: localDraftRequestedRuntimeModelLabel,
                          activeModel: localDraftActiveRuntimeModelLabel,
                          trainingModel: developerLocalTrainingBaseLabel,
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

                  <Flex
                    ref={annotationWorkspaceRef}
                    gap={4}
                    align="flex-start"
                    flexWrap="wrap"
                  >
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
                          const isSelectedTask = task.taskId === selectedTaskId
                          const isNextQueuedTask = task.taskId === nextTaskId
                          const displayedTaskIsComplete =
                            isSelectedTask &&
                            activeDeveloperBenchmarkReviewContext
                              ? annotationCompletionState.isComplete
                              : task.isComplete
                          const displayedTaskHasDraft =
                            isSelectedTask &&
                            activeDeveloperBenchmarkReviewContext
                              ? hasDraftContent(annotationDraft)
                              : task.hasDraft
                          let displayedTaskStatusLabel = t('Pending')
                          let taskStatusTone = 'gray'

                          if (displayedTaskIsComplete) {
                            taskStatusTone = 'green'
                            displayedTaskStatusLabel = t('Complete')
                          } else if (displayedTaskHasDraft) {
                            taskStatusTone = 'orange'
                            displayedTaskStatusLabel = t('Draft')
                          }
                          const displayedTaskMissingRequiredFields =
                            isSelectedTask &&
                            activeDeveloperBenchmarkReviewContext
                              ? annotationCompletionState.missingRequiredFields
                              : task.missingRequiredFields

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
                                    {displayedTaskStatusLabel}
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
                              {!displayedTaskIsComplete &&
                              formatMissingRequiredFields(
                                t,
                                displayedTaskMissingRequiredFields
                              ) ? (
                                <Text color="orange.600" fontSize="xs" mt={1}>
                                  {t('Missing: {{fields}}', {
                                    fields: formatMissingRequiredFields(
                                      t,
                                      displayedTaskMissingRequiredFields
                                    ),
                                  })}
                                </Text>
                              ) : null}
                            </Box>
                          )
                        })}
                      </Stack>
                    </Box>

                    <Box flex="2 1 640px" minW="320px">
                      {taskDetail ? (
                        <Stack spacing={4}>
                          {activeDeveloperBenchmarkReviewContext ? (
                            <Box
                              borderWidth="1px"
                              borderColor="purple.100"
                              bg="purple.50"
                              borderRadius="xl"
                              p={4}
                            >
                              <Stack spacing={2}>
                                <Text
                                  fontSize="sm"
                                  fontWeight={700}
                                  color="purple.600"
                                >
                                  {t('Benchmark review')}
                                </Text>
                                <Text fontSize="sm">
                                  {describeBenchmarkInspectorSummary(
                                    activeDeveloperBenchmarkReviewContext,
                                    t
                                  )}
                                </Text>
                                <Text color="muted" fontSize="xs">
                                  {t('Expected')}:&nbsp;
                                  {formatBenchmarkAnswerLabel(
                                    activeDeveloperBenchmarkReviewContext.expected,
                                    t
                                  )}
                                  {' · '}
                                  {t('Adapter')}:&nbsp;
                                  {formatBenchmarkAnswerLabel(
                                    activeDeveloperBenchmarkReviewContext
                                      .current?.predicted,
                                    t
                                  )}
                                  {activeDeveloperBenchmarkReviewContext.baseline
                                    ? ` · ${t(
                                        'Baseline'
                                      )}: ${formatBenchmarkAnswerLabel(
                                        activeDeveloperBenchmarkReviewContext
                                          .baseline?.predicted,
                                        t
                                      )}`
                                    : ''}
                                </Text>
                              </Stack>
                            </Box>
                          ) : null}
                          {activeDeveloperBenchmarkReviewContext ? (
                            <Box
                              borderWidth="1px"
                              borderColor="purple.100"
                              borderRadius="xl"
                              p={4}
                              bg="white"
                            >
                              <Stack spacing={4}>
                                <Flex
                                  justify="space-between"
                                  align={['flex-start', 'center']}
                                  direction={['column', 'row']}
                                  gap={3}
                                >
                                  <Box>
                                    <Text fontWeight={700}>
                                      {t('Benchmark correction')}
                                    </Text>
                                    <Text color="muted" fontSize="sm" mt={1}>
                                      {t(
                                        'Save what failed here so you can feed it into the next retraining round.'
                                      )}
                                    </Text>
                                  </Box>
                                  <Stack
                                    direction={['column', 'row']}
                                    spacing={2}
                                    flexWrap="wrap"
                                    align={['stretch', 'center']}
                                  >
                                    <Badge
                                      colorScheme="purple"
                                      borderRadius="full"
                                    >
                                      {t('{{count}} rules active', {
                                        count:
                                          activeBenchmarkReviewRequiredFields.length,
                                      })}
                                    </Badge>
                                    <SecondaryButton
                                      onClick={() =>
                                        setAnnotationDraft((current) =>
                                          applyBenchmarkReviewSuggestionToDraft(
                                            current,
                                            activeBenchmarkReviewSuggestion,
                                            {overwrite: false}
                                          )
                                        )
                                      }
                                      isDisabled={
                                        !activeBenchmarkReviewSuggestion
                                      }
                                    >
                                      {t('Use suggested correction')}
                                    </SecondaryButton>
                                    <SecondaryButton
                                      onClick={() =>
                                        setAnnotationDraft((current) =>
                                          applyBenchmarkReviewSuggestionToDraft(
                                            current,
                                            activeBenchmarkReviewSuggestion,
                                            {overwrite: true}
                                          )
                                        )
                                      }
                                      isDisabled={
                                        !activeBenchmarkReviewSuggestion
                                      }
                                    >
                                      {t('Replace with suggestion')}
                                    </SecondaryButton>
                                  </Stack>
                                </Flex>

                                {activeBenchmarkReviewSuggestion ? (
                                  <SimpleGrid columns={[1, 1, 3]} spacing={3}>
                                    <BenchmarkInsightCard
                                      title={t('Likely issue')}
                                      value={
                                        activeBenchmarkReviewSuggestion.headline
                                      }
                                      detail={
                                        activeBenchmarkReviewSuggestion.summary
                                      }
                                      tone="purple"
                                    />
                                    <BenchmarkInsightCard
                                      title={t('Decision stability')}
                                      value={
                                        activeBenchmarkReviewSuggestion
                                          .stability.label
                                      }
                                      detail={
                                        activeBenchmarkReviewSuggestion
                                          .stability.detail
                                      }
                                      tone={
                                        activeBenchmarkReviewSuggestion
                                          .stability.tone
                                      }
                                    />
                                    <BenchmarkInsightCard
                                      title={t('Suggested retraining focus')}
                                      value={t('Add this next')}
                                      detail={
                                        activeBenchmarkReviewSuggestion.retrainingHint
                                      }
                                      tone="blue"
                                    />
                                  </SimpleGrid>
                                ) : null}

                                <Box
                                  borderWidth="1px"
                                  borderColor="gray.100"
                                  borderRadius="lg"
                                  p={3}
                                  bg="gray.50"
                                >
                                  <Stack spacing={3}>
                                    <Text fontSize="sm" fontWeight={600}>
                                      {t('Require on benchmark review flips')}
                                    </Text>
                                    <SimpleGrid columns={[1, 2, 2]} spacing={2}>
                                      {DEVELOPER_BENCHMARK_REVIEW_REQUIRED_FIELD_OPTIONS.map(
                                        (fieldKey) => {
                                          const checked =
                                            benchmarkReviewRequiredFieldSet.has(
                                              fieldKey
                                            )

                                          return (
                                            <Checkbox
                                              key={fieldKey}
                                              isChecked={checked}
                                              onChange={(e) => {
                                                const nextChecked =
                                                  e.target.checked
                                                const currentFields =
                                                  normalizeDeveloperBenchmarkReviewRequiredFields(
                                                    developerBenchmarkReviewRequiredFields,
                                                    {
                                                      fallbackToDefault: false,
                                                    }
                                                  )
                                                const nextFields = nextChecked
                                                  ? Array.from(
                                                      new Set([
                                                        ...currentFields,
                                                        fieldKey,
                                                      ])
                                                    )
                                                  : currentFields.filter(
                                                      (item) =>
                                                        item !== fieldKey
                                                    )

                                                updateLocalAiSettings({
                                                  developerBenchmarkReviewRequiredFields:
                                                    nextFields,
                                                })
                                              }}
                                            >
                                              <Text fontSize="sm">
                                                {getRequiredFieldLabel(
                                                  fieldKey,
                                                  t
                                                )}
                                              </Text>
                                            </Checkbox>
                                          )
                                        }
                                      )}
                                    </SimpleGrid>
                                  </Stack>
                                </Box>

                                <InterviewPrompt
                                  title={t('What kind of failure was this?')}
                                  isMissing={
                                    isBenchmarkReviewIssueTypeHighlighted
                                  }
                                  missingHint={t(
                                    'Choose one issue type before moving on.'
                                  )}
                                  sectionRef={(node) => {
                                    missingFieldSectionRefs.current.benchmark_review_issue_type =
                                      node
                                  }}
                                >
                                  <Select
                                    value={
                                      annotationDraft.benchmark_review_issue_type
                                    }
                                    onChange={(e) => {
                                      const nextValue = e?.target?.value || ''

                                      setAnnotationDraft((current) => ({
                                        ...current,
                                        benchmark_review_issue_type: nextValue,
                                      }))
                                    }}
                                  >
                                    <option value="">
                                      {t('Choose issue type')}
                                    </option>
                                    {BENCHMARK_REVIEW_ISSUE_TYPE_OPTIONS.map(
                                      (option) => (
                                        <option key={option} value={option}>
                                          {formatBenchmarkReviewIssueTypeLabel(
                                            option,
                                            t
                                          )}
                                        </option>
                                      )
                                    )}
                                  </Select>
                                </InterviewPrompt>

                                <InterviewPrompt
                                  title={t(
                                    'What failed in this benchmark run?'
                                  )}
                                  isMissing={
                                    isBenchmarkReviewFailureNoteHighlighted
                                  }
                                  missingHint={t(
                                    'Write the failure note before moving on.'
                                  )}
                                  sectionRef={(node) => {
                                    missingFieldSectionRefs.current.benchmark_review_failure_note =
                                      node
                                  }}
                                >
                                  <Textarea
                                    placeholder={t(
                                      'For example: the adapter ignored the visible order cue and still chose the weaker story.'
                                    )}
                                    value={
                                      annotationDraft.benchmark_review_failure_note
                                    }
                                    onChange={(e) => {
                                      const nextValue = e?.target?.value || ''

                                      setAnnotationDraft((current) => ({
                                        ...current,
                                        benchmark_review_failure_note:
                                          nextValue,
                                      }))
                                    }}
                                  />
                                </InterviewPrompt>

                                <InterviewPrompt
                                  title={t(
                                    'What should the model learn next time?'
                                  )}
                                  isMissing={
                                    isBenchmarkReviewRetrainingHintHighlighted
                                  }
                                  missingHint={t(
                                    'Add a retraining hint before moving on.'
                                  )}
                                  sectionRef={(node) => {
                                    missingFieldSectionRefs.current.benchmark_review_retraining_hint =
                                      node
                                  }}
                                >
                                  <Textarea
                                    placeholder={t(
                                      'For example: prefer explicit timeline clues over repeated background objects.'
                                    )}
                                    value={
                                      annotationDraft.benchmark_review_retraining_hint
                                    }
                                    onChange={(e) => {
                                      const nextValue = e?.target?.value || ''

                                      setAnnotationDraft((current) => ({
                                        ...current,
                                        benchmark_review_retraining_hint:
                                          nextValue,
                                      }))
                                    }}
                                  />
                                </InterviewPrompt>

                                <BooleanChoiceField
                                  title={t(
                                    'Use this benchmark note in retraining?'
                                  )}
                                  description={t(
                                    'Choose yes to append these review notes to the next local training prompt for this flip.'
                                  )}
                                  value={
                                    annotationDraft.benchmark_review_include_for_training
                                  }
                                  onChange={(value) =>
                                    setAnnotationDraft((current) => ({
                                      ...current,
                                      benchmark_review_include_for_training:
                                        value,
                                    }))
                                  }
                                  trueLabel={t('Yes, use it')}
                                  falseLabel={t('No, keep it as audit only')}
                                  t={t}
                                  isMissing={
                                    isBenchmarkReviewIncludeForTrainingHighlighted
                                  }
                                  missingHint={t(
                                    'Choose whether this review should feed retraining.'
                                  )}
                                  sectionRef={(node) => {
                                    missingFieldSectionRefs.current.benchmark_review_include_for_training =
                                      node
                                  }}
                                />
                              </Stack>
                            </Box>
                          ) : null}
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
                                {currentTaskStatusLabel}
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
                              {!annotationCompletionState.isComplete &&
                              currentMissingRequiredFieldLabels ? (
                                <Text color="orange.600" fontSize="sm">
                                  {t('Still missing: {{fields}}.', {
                                    fields: currentMissingRequiredFieldLabels,
                                  })}
                                </Text>
                              ) : null}
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
                                        'This draft chat stays on the same currently selected local runtime and training slot. Runtime: {{draftModel}}. Local training base: {{trainingModel}}.',
                                        {
                                          draftModel:
                                            localDraftRequestedRuntimeModelLabel,
                                          trainingModel:
                                            developerLocalTrainingBaseLabel,
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
                                          developerLocalTrainingBaseLabel
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
                              isMissing={isFinalAnswerFieldHighlighted}
                              missingHint={t(
                                'Choose LEFT, RIGHT, or SKIP before moving on.'
                              )}
                              sectionRef={(node) => {
                                missingFieldSectionRefs.current.final_answer =
                                  node
                              }}
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
                                isMissing={isReasonFieldHighlighted}
                                missingHint={t(
                                  'Add one short reason before moving on.'
                                )}
                                sectionRef={(node) => {
                                  missingFieldSectionRefs.current.why_answer =
                                    node
                                }}
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
                                    isMissing={isTextDecisionFieldHighlighted}
                                    missingHint={t(
                                      'Choose yes or no before moving on.'
                                    )}
                                    sectionRef={(node) => {
                                      missingFieldSectionRefs.current.text_required =
                                        node
                                    }}
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
                                    isMissing={
                                      isSequenceDecisionFieldHighlighted
                                    }
                                    missingHint={t(
                                      'Choose yes or no before moving on.'
                                    )}
                                    sectionRef={(node) => {
                                      missingFieldSectionRefs.current.sequence_markers_present =
                                        node
                                    }}
                                  />
                                </Stack>
                              </InterviewPrompt>
                            ) : null}

                            {hasDecision && hasReason ? (
                              <InterviewPrompt
                                title={t(
                                  'Does this flip need a report because it breaks the rules or depends on disallowed cues?'
                                )}
                                isMissing={
                                  isReportDecisionFieldHighlighted ||
                                  isReportReasonFieldHighlighted
                                }
                                missingHint={
                                  isReportReasonFieldHighlighted
                                    ? t(
                                        'Write a short report reason before moving on.'
                                      )
                                    : t(
                                        'Choose whether this flip should be reported before moving on.'
                                      )
                                }
                                sectionRef={(node) => {
                                  missingFieldSectionRefs.current.report_required =
                                    node
                                  missingFieldSectionRefs.current.report_reason =
                                    node
                                }}
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
                                    isMissing={isReportDecisionFieldHighlighted}
                                    missingHint={t(
                                      'Choose yes or no before moving on.'
                                    )}
                                  />

                                  {annotationDraft.report_required === true ? (
                                    <Box
                                      borderWidth="1px"
                                      borderColor={
                                        isReportReasonFieldHighlighted
                                          ? 'orange.200'
                                          : 'gray.100'
                                      }
                                      borderRadius="lg"
                                      p={3}
                                      bg={
                                        isReportReasonFieldHighlighted
                                          ? 'orange.50'
                                          : 'white'
                                      }
                                      scrollMarginTop="120px"
                                    >
                                      <Textarea
                                        placeholder={t(
                                          'Short reason for why this should be reported.'
                                        )}
                                        value={annotationDraft.report_reason}
                                        onChange={(e) => {
                                          const nextValue =
                                            e?.target?.value || ''

                                          setAnnotationDraft((current) => ({
                                            ...current,
                                            report_reason: nextValue,
                                          }))
                                        }}
                                      />
                                      {isReportReasonFieldHighlighted ? (
                                        <Text
                                          color="orange.700"
                                          fontSize="sm"
                                          fontWeight={600}
                                          mt={3}
                                        >
                                          {t(
                                            'Write a short report reason before moving on.'
                                          )}
                                        </Text>
                                      ) : null}
                                    </Box>
                                  ) : null}
                                </Stack>
                              </InterviewPrompt>
                            ) : null}

                            {hasDecision && hasReason ? (
                              <InterviewPrompt
                                title={t(
                                  'How confident are you in that judgment? Choose one level before saving this flip.'
                                )}
                                isMissing={isConfidenceFieldHighlighted}
                                missingHint={t(
                                  'Choose one confidence level before moving on.'
                                )}
                                sectionRef={(node) => {
                                  missingFieldSectionRefs.current.confidence =
                                    node
                                }}
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
                                    {annotationCompletionState.optionalDetailComplete
                                      ? t('Optional detail added')
                                      : t('Optional detail')}
                                  </Text>
                                  <Text color="muted" fontSize="sm">
                                    {annotationCompletionState.optionalDetailComplete
                                      ? t(
                                          'You already added frame notes and both story summaries. You can review or edit them here.'
                                        )
                                      : t(
                                          'Frame notes and both short story summaries can help later review and training, but they are optional for saving this flip.'
                                        )}
                                  </Text>
                                </Box>
                                <Stack
                                  direction={['column', 'row']}
                                  spacing={2}
                                  align={['stretch', 'center']}
                                >
                                  <Badge colorScheme="gray" borderRadius="full">
                                    {t(
                                      '{{count}} / {{total}} optional items added',
                                      {
                                        count:
                                          annotationCompletionState.completedOptionalChecks,
                                        total:
                                          annotationCompletionState.totalOptionalChecks,
                                      }
                                    )}
                                  </Badge>
                                  <SecondaryButton
                                    onClick={() =>
                                      setShowAdvancedFields(
                                        (current) => !current
                                      )
                                    }
                                  >
                                    {optionalDetailToggleLabel}
                                  </SecondaryButton>
                                </Stack>
                              </Flex>

                              {showOptionalDetailSection ? (
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
                                isDisabled={isSavingTask}
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
                                    onClick={() =>
                                      nextTaskId
                                        ? saveTaskDraft()
                                        : saveTaskDraft({advance: true})
                                    }
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
                                {currentDraftHelperLabel}
                              </Text>
                            </Stack>
                            {nextTaskId && !canMoveForwardFromCurrentFlip ? (
                              <Text color="orange.600" fontSize="sm">
                                {t(
                                  'Finish this flip before moving forward: {{fields}}.',
                                  {
                                    fields:
                                      currentMissingRequiredFieldLabels ||
                                      t('required fields'),
                                  }
                                )}
                              </Text>
                            ) : null}
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
                    {chunkDecisionDialog.mode === 'developer' ? (
                      <Alert
                        status={developerTrainingReadinessAlertStatus}
                        borderRadius="md"
                      >
                        <Stack spacing={2} w="full">
                          <Flex
                            justify="space-between"
                            align={['flex-start', 'center']}
                            direction={['column', 'row']}
                            gap={2}
                            w="full"
                          >
                            <Text fontWeight={600}>
                              {t('Training readiness')}
                            </Text>
                            <Badge
                              colorScheme={getTrainingReadinessBadgeScheme(
                                developerTrainingReadiness.tone
                              )}
                              borderRadius="full"
                              px={2}
                              py={1}
                            >
                              {developerTrainingReadiness.label}
                            </Badge>
                          </Flex>
                          <Text fontSize="sm">
                            {developerTrainingReadiness.message}
                          </Text>
                          {developerTrainingRequiresOverride ? (
                            <Checkbox
                              isChecked={developerTrainingPressureOverride}
                              onChange={(e) =>
                                setDeveloperTrainingPressureOverride(
                                  e.target.checked
                                )
                              }
                            >
                              <Text fontSize="sm">
                                {t(
                                  'I understand this machine is already under pressure and I still want to run one local training pass now.'
                                )}
                              </Text>
                            </Checkbox>
                          ) : null}
                        </Stack>
                      </Alert>
                    ) : null}
                  </Stack>
                </ModalBody>
                <ModalFooter>
                  <Stack spacing={2} w="full">
                    <PrimaryButton
                      isLoading={isChunkDecisionBusy}
                      isDisabled={
                        isChunkDecisionBusy ||
                        (chunkDecisionDialog.mode === 'developer' &&
                          (developerTrainingUnsupported ||
                            !developerTrainingReadyToStart))
                      }
                      onClick={() => handleChunkDecisionAction('train')}
                    >
                      {chunkDecisionDialog.mode === 'demo'
                        ? t('Start demo training now')
                        : t('Start local adapter training now')}
                    </PrimaryButton>
                    {chunkDecisionDialog.mode === 'developer' &&
                    developerTrainingUnsupported ? (
                      <Text color="muted" fontSize="sm">
                        {t(
                          'Training is unavailable in the current Local AI runtime. Your annotations stay saved locally until a trainable backend exists.'
                        )}
                      </Text>
                    ) : null}
                    {chunkDecisionDialog.mode === 'developer' &&
                    developerTrainingRequiresOverride &&
                    !developerTrainingPressureOverride ? (
                      <Text color="muted" fontSize="sm">
                        {t(
                          'The start button stays locked until you explicitly confirm this override.'
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
                                  'Upload this bundle folder to the machine or provider you want to use.'
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
                                '2. Upload this bundle folder to that machine.'
                              )}
                            </Text>
                            <Text fontSize="sm">
                              {t(
                                '3. Start with a benchmark-only smoke run before doing a longer training run.'
                              )}
                            </Text>
                            <Text fontSize="sm">
                              {externalContributionBundle.recommendedTrainingModel
                                ? t(
                                    '4. For serious training, use the recommended MLX base {{model}}.',
                                    {
                                      model:
                                        externalContributionBundle.recommendedTrainingModel,
                                    }
                                  )
                                : t(
                                    '4. No approved MLX base is bundled right now. Choose and audit your own base model before training.'
                                  )}
                            </Text>
                            <Text fontSize="sm">
                              {t(
                                '5. After training, run the fixed held-out comparison on {{count}} unseen flips and keep the result JSON plus the adapter artifact together.',
                                {
                                  count:
                                    externalContributionBundle.recommendedBenchmarkFlips,
                                }
                              )}
                            </Text>
                            <Text fontSize="sm">
                              {t(
                                '6. Import only the result files you intend to trust back into IdenaAI later.'
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
                                {t('Bundle folder name')}:{' '}
                                {externalContributionBundle.outputDir}
                              </Text>
                              <Text
                                color="muted"
                                fontSize="xs"
                                wordBreak="break-all"
                              >
                                {t('Manifest file')}:{' '}
                                {externalContributionBundle.manifestPath}
                              </Text>
                              <Text
                                color="muted"
                                fontSize="xs"
                                wordBreak="break-all"
                              >
                                {t('README file')}:{' '}
                                {externalContributionBundle.readmePath}
                              </Text>
                              <Text
                                color="muted"
                                fontSize="xs"
                                wordBreak="break-all"
                              >
                                {t('Annotations file')}:{' '}
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
                            {developerLocalTrainingBaseLabel}
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
                            <Input
                              size="sm"
                              type="number"
                              min={1}
                              max={500}
                              step={1}
                              value={String(developerLocalBenchmarkSize)}
                              onChange={(e) =>
                                updateLocalAiSettings({
                                  developerLocalBenchmarkSize:
                                    normalizeDeveloperLocalBenchmarkSize(
                                      e.target.value
                                    ),
                                })
                              }
                            />
                            <Text color="muted" fontSize="xs" mt={1}>
                              {t(
                                'Enter any benchmark size from 1 to 500. The final run clamps to the available unseen holdout and never reuses the flips you just trained on.'
                              )}
                            </Text>
                          </Box>
                          <Box maxW="320px">
                            <FormLabel mb={1}>
                              {t('Benchmark heat mode')}
                            </FormLabel>
                            <Select
                              size="sm"
                              value={developerLocalBenchmarkThermalMode}
                              onChange={(e) =>
                                updateLocalAiSettings({
                                  developerLocalBenchmarkThermalMode:
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
                              {developerLocalBenchmarkThermalSummary.detail}
                            </Text>
                            <Text color="muted" fontSize="xs" mt={1}>
                              {t(
                                'This inserts {{cooldown}} ms between unseen benchmark flips.',
                                {
                                  cooldown:
                                    developerLocalBenchmarkThermalSummary.benchmarkCooldownMs,
                                }
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
                          {t('Open local pilot dashboard')}
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
