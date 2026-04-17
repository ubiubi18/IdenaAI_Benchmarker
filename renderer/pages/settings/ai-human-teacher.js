/* eslint-disable react/prop-types */
import React from 'react'
import {
  Alert,
  Box,
  Flex,
  Image,
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
import {
  Checkbox,
  FormLabel,
  Input,
  Select,
  Textarea,
  Toast,
} from '../../shared/components/components'
import {useEpochState} from '../../shared/providers/epoch-context'
import {useSettingsState} from '../../shared/providers/settings-context'

const DEFAULT_HUMAN_TEACHER_SYSTEM_PROMPT =
  'Use human-teacher guidance without collapsing into a left-only or right-only bias. Prefer left or right only when the visual chronology, readable text, reportability cues, or explicit human annotation meaningfully support that side. If the evidence is weak or conflicting, stay cautious and do not default to one side.'
const AI_ANNOTATION_RATINGS = ['good', 'bad', 'wrong']

function formatErrorMessage(error) {
  const raw = String((error && error.message) || error || '').trim()
  const prefix = /Error invoking remote method '[^']+':\s*/i
  const message = raw.replace(prefix, '').trim()

  if (
    /No handler registered for 'localAi\.(?:loadHumanTeacherDemoWorkspace|loadHumanTeacherDemoTask|saveHumanTeacherDemoDraft|loadHumanTeacherAnnotationWorkspace|loadHumanTeacherAnnotationTask|saveHumanTeacherAnnotationDraft|importHumanTeacherAnnotations|exportHumanTeacherTasks|chat)'/i.test(
      message
    )
  ) {
    return 'This human-teacher feature is not available in the running main process yet. Fully restart IdenaAI and try again.'
  }

  if (/Local AI human-teacher bridge is unavailable/i.test(message)) {
    return 'The human-teacher bridge is unavailable in this build. Fully restart IdenaAI and try again.'
  }

  return message || 'Unknown error'
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
      detail: t('No human-teacher package exists for this epoch yet.'),
    }
  }

  if (normalizeReviewStatus(taskPackage.reviewStatus) === 'rejected') {
    return {
      label: t('Skipped'),
      tone: 'gray',
      detail: t(
        'You chose not to annotate this epoch. Federated updates still work normally; you just do not contribute annotation learnings for this batch.'
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
        'Consensus-backed flips are available for voluntary human annotation.'
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
        'Consensus is available, but payload-backed tasks are not ready yet for export.'
      ),
    }
  }

  return {
    label: t('No eligible tasks'),
    tone: 'gray',
    detail: t(
      'No voluntary annotation batch is available for this epoch right now.'
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
    text_required: null,
    sequence_markers_present: null,
    report_required: null,
    report_reason: '',
    final_answer: '',
    why_answer: '',
    confidence: '',
  }
}

function createEmptyAiAnnotationDraft() {
  return {
    generated_at: '',
    runtime_backend: '',
    runtime_type: '',
    model: '',
    vision_model: '',
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

function hasAiAnnotationContent(annotation = {}) {
  const next =
    annotation && typeof annotation === 'object' && !Array.isArray(annotation)
      ? annotation
      : {}

  return Boolean(
    next.generated_at ||
      next.runtime_backend ||
      next.runtime_type ||
      next.model ||
      next.vision_model ||
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
    report_reason: String(next.report_reason || ''),
    final_answer: String(next.final_answer || ''),
    why_answer: String(next.why_answer || ''),
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
      next.report_reason.trim() ||
      next.final_answer.trim() ||
      next.why_answer.trim() ||
      next.text_required !== null ||
      next.sequence_markers_present !== null ||
      next.report_required !== null ||
      next.confidence !== ''
  )
}

function isCompleteDraft(annotation = {}) {
  const next = normalizeAnnotationDraft(annotation)
  return Boolean(
    next.final_answer.trim() &&
      next.why_answer.trim() &&
      (next.report_required !== true || next.report_reason.trim())
  )
}

function getOrderedPanels(task = {}, order = []) {
  const safeTask = task && typeof task === 'object' ? task : {}
  const panels = Array.isArray(safeTask.panels) ? safeTask.panels : []
  const panelsByIndex = new Map(
    panels
      .map((panel) => [Number(panel.index), panel])
      .filter(([index]) => Number.isFinite(index))
  )

  return order.map((index) => panelsByIndex.get(Number(index))).filter(Boolean)
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
    'You are generating a human-teacher draft annotation for human review.',
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
    'Use skip if the flip is ambiguous, report-worthy, or lacks a clear better story.',
    'Keep the reason short and concrete.',
    'Return JSON only with this exact schema:',
    '{"final_answer":"left|right|skip","why_answer":"...","confidence":1|2|3|4|5,"text_required":true|false,"sequence_markers_present":true|false,"report_required":true|false,"report_reason":"...","option_a_summary":"short LEFT story summary","option_b_summary":"short RIGHT story summary"}',
    'If report_required is false, report_reason must be an empty string.',
  ].join(' ')
}

function buildStoredAiAnnotation(aiAnnotation, result = {}) {
  const normalized = normalizeAiAnnotationDraft({
    ...aiAnnotation,
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

function formatAiAnnotationRatingLabel(value, t) {
  if (value === 'good') {
    return t('Good')
  }
  if (value === 'bad') {
    return t('Bad')
  }
  return t('Wrong')
}

function getDraftStatusLabel(annotation, t) {
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
  const nextAnnotation = annotation || {}

  if (isCompleteDraft(nextAnnotation)) {
    return t('This task looks complete.')
  }

  if (hasDraftContent(nextAnnotation)) {
    return t('This task has unsaved or incomplete draft content.')
  }

  return t('No annotation content yet.')
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
          IdenaAI
        </Text>
        <Text mt={1}>{title}</Text>
      </Box>
      <Box>{children}</Box>
    </Box>
  )
}

export default function AiHumanTeacherPage() {
  const {t} = useTranslation()
  const router = useRouter()
  const epochState = useEpochState()
  const settings = useSettingsState()
  const toast = useToast()
  const localAi = settings?.localAi || {}
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
  const queryAction = String(router.query?.action || '')
    .trim()
    .toLowerCase()
  const queryDemoSample = String(router.query?.sample || '').trim()
  const autoStartKeyRef = React.useRef('')

  const [epoch, setEpoch] = React.useState(queryEpoch || fallbackEpoch)
  const [result, setResult] = React.useState(null)
  const [exportResult, setExportResult] = React.useState(null)
  const [importResult, setImportResult] = React.useState(null)
  const [annotationSourceMode, setAnnotationSourceMode] =
    React.useState('epoch')
  const [demoSampleName, setDemoSampleName] = React.useState(
    queryDemoSample || DEMO_SAMPLE_OPTIONS[0].value
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
  const [isGeneratingAiDraft, setIsGeneratingAiDraft] = React.useState(false)
  const [showAdvancedFields, setShowAdvancedFields] = React.useState(false)

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

  const ensureBridge = React.useCallback(() => {
    if (
      !global.localAi ||
      typeof global.localAi.loadHumanTeacherPackage !== 'function'
    ) {
      throw new Error('Local AI human-teacher bridge is unavailable')
    }

    return global.localAi
  }, [])

  const loadPackage = React.useCallback(
    async ({forceRebuild = false} = {}) => {
      const nextEpoch = String(epoch || '').trim()

      if (!nextEpoch) {
        setError(t('Enter an epoch before loading a human-teacher batch.'))
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
            batchSize: 30,
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
    [currentEpoch, ensureBridge, epoch, t]
  )

  React.useEffect(() => {
    if (epoch) {
      loadPackage()
    }
  }, [epoch, loadPackage])

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
      setError(t('Enter an epoch before exporting annotation tasks.'))
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
      setWorkspace(nextWorkspace)
      setSelectedTaskId(pickPreferredTaskId(nextWorkspace, selectedTaskId))
    } catch (nextError) {
      setExportResult(null)
      setError(formatErrorMessage(nextError))
    } finally {
      setIsExporting(false)
    }
  }, [currentEpoch, ensureBridge, epoch, result, selectedTaskId, t])

  const loadWorkspace = React.useCallback(async () => {
    const nextEpoch = String(epoch || '').trim()

    if (!nextEpoch) {
      setError(t('Enter an epoch before opening annotation tasks.'))
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
  }, [currentEpoch, ensureBridge, epoch, selectedTaskId, t])

  const loadOfflineDemoWorkspace = React.useCallback(async () => {
    setIsWorkspaceLoading(true)
    setError('')
    setImportResult(null)

    try {
      const nextResult = await ensureBridge().loadHumanTeacherDemoWorkspace({
        sampleName: demoSampleName,
      })
      const nextWorkspace = nextResult.workspace || null
      setAnnotationSourceMode('demo')
      setWorkspace(nextWorkspace)
      setResult(nextResult)
      setSelectedTaskId(pickPreferredTaskId(nextWorkspace, selectedTaskId))

      if (queryAction === 'demo') {
        router.replace('/settings/ai-human-teacher')
      }
    } catch (nextError) {
      setWorkspace(null)
      setSelectedTaskId('')
      setTaskDetail(null)
      setAnnotationDraft(createEmptyAnnotationDraft())
      setError(formatErrorMessage(nextError))
    } finally {
      setIsWorkspaceLoading(false)
    }
  }, [demoSampleName, ensureBridge, queryAction, router, selectedTaskId])

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
  ])

  const loadTask = React.useCallback(
    async (taskId) => {
      const nextEpoch = String(epoch || '').trim()

      if ((!nextEpoch && annotationSourceMode !== 'demo') || !taskId) {
        return
      }

      setIsTaskLoading(true)
      setError('')

      try {
        const nextResult =
          annotationSourceMode === 'demo'
            ? await ensureBridge().loadHumanTeacherDemoTask({
                sampleName: demoSampleName,
                taskId,
              })
            : await ensureBridge().loadHumanTeacherAnnotationTask({
                epoch: nextEpoch,
                currentEpoch,
                taskId,
              })
        setTaskDetail(nextResult.task || null)
        setAnnotationDraft(
          normalizeAnnotationDraft(nextResult.task?.annotation || {})
        )
        setShowAdvancedFields(false)
      } catch (nextError) {
        setTaskDetail(null)
        setAnnotationDraft(createEmptyAnnotationDraft())
        setError(formatErrorMessage(nextError))
      } finally {
        setIsTaskLoading(false)
      }
    },
    [annotationSourceMode, currentEpoch, demoSampleName, ensureBridge, epoch]
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
  const currentAiAnnotation = React.useMemo(
    () => normalizeAiAnnotationDraft(annotationDraft.ai_annotation),
    [annotationDraft.ai_annotation]
  )
  const hasDecision = Boolean(annotationDraft.final_answer)
  const hasReason = Boolean(String(annotationDraft.why_answer || '').trim())

  const requestAiAnnotationDraft = React.useCallback(async () => {
    if (localAi?.enabled !== true) {
      toast({
        render: () => (
          <Toast
            title={t('Enable local AI first')}
            description={t(
              'The AI draft button uses the local runtime. Turn on Local AI in AI settings, then try again.'
            )}
            status="warning"
          />
        ),
      })
      return
    }

    if (!global.localAi || typeof global.localAi.chat !== 'function') {
      toast({
        render: () => (
          <Toast
            title={t('Local AI chat bridge missing')}
            description={t(
              'This build does not expose the Local AI chat bridge yet. Fully restart IdenaAI and try again.'
            )}
            status="error"
          />
        ),
      })
      return
    }

    const orderedImages = [...leftPanels, ...rightPanels]
      .map((panel) => panel?.dataUrl)
      .filter(Boolean)

    if (orderedImages.length !== 8) {
      toast({
        render: () => (
          <Toast
            title={t('Current flip is missing panel images')}
            description={t(
              'The local AI draft needs 8 ordered panel images, but only {{count}} were available for this flip.',
              {count: orderedImages.length}
            )}
            status="error"
          />
        ),
      })
      return
    }

    setIsGeneratingAiDraft(true)
    setError('')

    try {
      const aiDraftResult = await global.localAi.chat({
        baseUrl: localAi?.baseUrl,
        runtimeBackend: localAi?.runtimeBackend,
        runtimeType: localAi?.runtimeType,
        model: localAi?.model,
        visionModel: localAi?.visionModel,
        timeoutMs: 45000,
        responseFormat: 'json',
        generationOptions: {
          temperature: 0,
          numPredict: 256,
        },
        messages: [
          {
            role: 'system',
            content: buildAiAnnotationSystemPrompt(),
          },
          {
            role: 'user',
            content: buildAiAnnotationUserPrompt(),
            images: orderedImages,
          },
        ],
      })

      const aiText = String(
        aiDraftResult?.text || aiDraftResult?.content || ''
      ).trim()

      if (!aiDraftResult?.ok || !aiText) {
        throw new Error(
          String(aiDraftResult?.lastError || '').trim() ||
            t('The local AI runtime did not return a usable annotation draft.')
        )
      }

      const aiAnnotation = buildStoredAiAnnotation(
        parseAiAnnotationResponse(aiText),
        aiDraftResult
      )

      setAnnotationDraft((current) =>
        applyAiAnnotationToDraft(current, aiAnnotation)
      )
      setShowAdvancedFields(
        Boolean(aiAnnotation.option_a_summary || aiAnnotation.option_b_summary)
      )
      toast({
        render: () => (
          <Toast
            title={t('AI draft applied')}
            description={t(
              'The local AI filled a draft for this flip. Review it and correct it before saving.'
            )}
            status="success"
          />
        ),
      })
    } catch (draftError) {
      toast({
        render: () => (
          <Toast
            title={t('AI draft failed')}
            description={formatErrorMessage(draftError)}
            status="error"
          />
        ),
      })
    } finally {
      setIsGeneratingAiDraft(false)
    }
  }, [
    leftPanels,
    localAi?.baseUrl,
    localAi?.enabled,
    localAi?.model,
    localAi?.runtimeBackend,
    localAi?.runtimeType,
    localAi?.visionModel,
    rightPanels,
    t,
    toast,
  ])

  const saveTaskDraft = React.useCallback(
    async (options = {}) => {
      const {advance = false} = options
      const nextEpoch = String(epoch || '').trim()

      if ((!nextEpoch && annotationSourceMode !== 'demo') || !selectedTaskId) {
        setError(t('Select a task before saving annotation notes.'))
        return
      }

      setIsSavingTask(true)
      setError('')

      try {
        const nextResult =
          annotationSourceMode === 'demo'
            ? await ensureBridge().saveHumanTeacherDemoDraft({
                sampleName: demoSampleName,
                taskId: selectedTaskId,
                annotation: annotationDraft,
              })
            : await ensureBridge().saveHumanTeacherAnnotationDraft({
                epoch: nextEpoch,
                currentEpoch,
                taskId: selectedTaskId,
                annotation: annotationDraft,
              })
        const nextStatus = String(
          nextResult?.task?.annotationStatus || 'pending'
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
                draftedCount: current.tasks.filter((task) =>
                  task.taskId === selectedTaskId
                    ? hasDraftContent(annotationDraft)
                    : task.hasDraft
                ).length,
                completedCount: current.tasks.filter((task) =>
                  task.taskId === selectedTaskId
                    ? isCompleteDraft(annotationDraft)
                    : task.isComplete
                ).length,
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

        if (advance && nextTaskId) {
          setSelectedTaskId(nextTaskId)
        }
      } catch (nextError) {
        setError(formatErrorMessage(nextError))
      } finally {
        setIsSavingTask(false)
      }
    },
    [
      annotationSourceMode,
      annotationDraft,
      currentEpoch,
      demoSampleName,
      ensureBridge,
      epoch,
      nextTaskId,
      selectedTaskId,
      t,
    ]
  )

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

  const packageSummary = describeHumanTeacherPackage(t, result)
  const reviewStatus = normalizeReviewStatus(result?.package?.reviewStatus)
  const eligibleCount = Number(result?.eligibleCount) || 0
  const importedAnnotations = result?.package?.importedAnnotations || null
  const isDemoMode = annotationSourceMode === 'demo'

  React.useEffect(() => {
    if (selectedTaskId) {
      loadTask(selectedTaskId)
    } else {
      setTaskDetail(null)
      setAnnotationDraft(createEmptyAnnotationDraft())
    }
  }, [loadTask, selectedTaskId])

  React.useEffect(() => {
    const nextEpoch = String(epoch || '').trim()
    const autoStartKey = `${nextEpoch}:${queryAction}`

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
  }, [epoch, loadOfflineDemoWorkspace, queryAction, startAnnotationFlow])

  return (
    <SettingsLayout>
      <Stack spacing={8} mt={8} maxW="3xl">
        <SettingsSection title={t('Human teacher loop')}>
          <Stack spacing={4}>
            <Alert status="info" borderRadius="md">
              <Stack spacing={2}>
                <Text fontWeight={600}>
                  {t('Voluntary post-session teaching')}
                </Text>
                <Text fontSize="sm">
                  {t(
                    'This batch starts only after the validation session is over and final consensus exists. Skipping it does not block incoming federated updates; it only means you do not share annotation learnings for this epoch.'
                  )}
                </Text>
                <Text fontSize="sm">
                  {t(
                    'You can now annotate directly in the app after the batch is approved. The exported workspace remains available as a fallback and import path.'
                  )}
                </Text>
                <Text fontSize="sm">
                  {t(
                    'You can also load an offline demo batch from bundled sample flips. Demo annotations stay local and are never used for training.'
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
                {t('Refresh batch')}
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
                    {t('Flags')}: {result.package.inconsistencyFlags.join(', ')}
                  </Text>
                ) : null}
              </Stack>
            </Box>

            {error ? (
              <Alert status="error" borderRadius="md">
                <Text fontSize="sm">{error}</Text>
              </Alert>
            ) : null}

            <Stack isInline spacing={2} flexWrap="wrap">
              <PrimaryButton
                isDisabled={
                  isDemoMode || isUpdating || isExporting || eligibleCount <= 0
                }
                isLoading={isExporting}
                onClick={startAnnotationFlow}
              >
                {reviewStatus === 'approved'
                  ? t('Open in-app annotator')
                  : t('Start in-app annotation')}
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
                {t('Export annotation tasks')}
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
                onClick={isDemoMode ? loadOfflineDemoWorkspace : loadWorkspace}
              >
                {isDemoMode
                  ? t('Reload demo workspace')
                  : t('Open annotation workspace')}
              </SecondaryButton>
            </Stack>

            {exportResult ? (
              <Box
                borderWidth="1px"
                borderColor="green.100"
                borderRadius="md"
                p={4}
              >
                <Stack spacing={1}>
                  <Text fontWeight={600}>
                    {t('Annotation workspace ready')}
                  </Text>
                  <Text color="muted" fontSize="sm">
                    {t(
                      'The app exported a local task workspace with decoded panels, a task manifest, and an annotation template.'
                    )}
                  </Text>
                  <Text color="muted" fontSize="sm">
                    {t('Tasks')}: {Number(exportResult.tasks) || 0}
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

            {importResult ? (
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
                      'The app normalized completed annotation rows from the exported workspace and stored them for later training ingestion.'
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
                  <Text fontWeight={600}>{t('In-app annotator')}</Text>
                  <Text color="muted" fontSize="sm">
                    {t(
                      'This uses the exported task workspace for the selected epoch. Save notes task by task, then import the completed annotations when you are done.'
                    )}
                  </Text>
                  <Text color="muted" fontSize="sm">
                    {t('Task count')}: {Number(workspace.taskCount) || 0} ·{' '}
                    {t('Drafted')}: {Number(workspace.draftedCount) || 0} ·{' '}
                    {t('Complete')}: {Number(workspace.completedCount) || 0}
                  </Text>

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
                        {workspace.tasks.map((task) => (
                          <Box
                            key={task.taskId}
                            px={3}
                            py={3}
                            borderBottomWidth="1px"
                            borderBottomColor="gray.50"
                            bg={
                              task.taskId === selectedTaskId
                                ? 'blue.50'
                                : 'transparent'
                            }
                            cursor="pointer"
                            onClick={() => setSelectedTaskId(task.taskId)}
                          >
                            <Text fontSize="sm" fontWeight={600}>
                              {task.flipHash || task.taskId}
                            </Text>
                            <Text color="muted" fontSize="xs">
                              {t('Consensus')}: {task.consensusAnswer || 'n/a'}{' '}
                              · {task.consensusStrength || 'n/a'}
                            </Text>
                            <Text color="muted" fontSize="xs">
                              {getDraftStatusLabel(task, t)}
                            </Text>
                          </Box>
                        ))}
                      </Stack>
                    </Box>

                    <Box flex="2 1 640px" minW="320px">
                      {taskDetail ? (
                        <Stack spacing={4}>
                          <Box>
                            <Text fontWeight={600}>
                              {taskDetail.flipHash || taskDetail.taskId}
                            </Text>
                            <Text color="muted" fontSize="sm" mt={1}>
                              {t(
                                'Review it like a normal flip test: choose the better story first, then add a short human explanation.'
                              )}
                            </Text>
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
                                      <Image
                                        src={panel.dataUrl}
                                        alt={panel.id}
                                        objectFit="contain"
                                        w="full"
                                        maxH="180px"
                                        bg="gray.50"
                                      />
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
                            <Box
                              borderWidth="1px"
                              borderColor="gray.100"
                              borderRadius="lg"
                              p={3}
                              bg="white"
                            >
                              <Flex
                                justify="space-between"
                                align={['flex-start', 'center']}
                                gap={3}
                                direction={['column', 'row']}
                              >
                                <Box>
                                  <Text fontWeight={600}>
                                    {t('Optional AI draft')}
                                  </Text>
                                  <Text color="muted" fontSize="sm">
                                    {t(
                                      'Ask the local AI to prefill this flip, then review and correct it like a normal human annotation.'
                                    )}
                                  </Text>
                                  <Text color="muted" fontSize="xs" mt={1}>
                                    {t('Locked local draft model: {{model}}', {
                                      model:
                                        localAi?.visionModel ||
                                        localAi?.model ||
                                        'qwen3.5:9b',
                                    })}
                                  </Text>
                                  {localAi?.enabled !== true ? (
                                    <Text color="muted" fontSize="xs" mt={1}>
                                      {t(
                                        'Enable Local AI in AI settings first if you want this helper.'
                                      )}
                                    </Text>
                                  ) : null}
                                </Box>
                                <PrimaryButton
                                  onClick={requestAiAnnotationDraft}
                                  isLoading={isGeneratingAiDraft}
                                  loadingText={t('Drafting')}
                                  isDisabled={localAi?.enabled !== true}
                                >
                                  {currentAiAnnotation
                                    ? t('Re-run AI draft')
                                    : t('Ask AI to draft this flip')}
                                </PrimaryButton>
                              </Flex>

                              {currentAiAnnotation ? (
                                <Box
                                  mt={3}
                                  p={3}
                                  borderRadius="lg"
                                  bg="gray.50"
                                  borderWidth="1px"
                                  borderColor="gray.100"
                                >
                                  <Stack spacing={2}>
                                    <Text fontSize="sm" fontWeight={600}>
                                      {t('Current AI draft')}
                                    </Text>
                                    <Text fontSize="sm" color="muted">
                                      {t(
                                        'Model: {{model}} · Answer: {{answer}} · Confidence: {{confidence}}/5',
                                        {
                                          model:
                                            currentAiAnnotation.model ||
                                            currentAiAnnotation.vision_model ||
                                            localAi?.visionModel ||
                                            localAi?.model ||
                                            'qwen3.5:9b',
                                          answer: formatDecisionLabel(
                                            currentAiAnnotation.final_answer,
                                            t
                                          ),
                                          confidence:
                                            currentAiAnnotation.confidence ||
                                            '?',
                                        }
                                      )}
                                    </Text>
                                    {currentAiAnnotation.why_answer ? (
                                      <Text fontSize="sm">
                                        {currentAiAnnotation.why_answer}
                                      </Text>
                                    ) : null}
                                    {currentAiAnnotation.option_a_summary ||
                                    currentAiAnnotation.option_b_summary ? (
                                      <Box fontSize="xs" color="muted">
                                        {currentAiAnnotation.option_a_summary ? (
                                          <Text>
                                            {t('LEFT summary')}:&nbsp;
                                            {
                                              currentAiAnnotation.option_a_summary
                                            }
                                          </Text>
                                        ) : null}
                                        {currentAiAnnotation.option_b_summary ? (
                                          <Text>
                                            {t('RIGHT summary')}:&nbsp;
                                            {
                                              currentAiAnnotation.option_b_summary
                                            }
                                          </Text>
                                        ) : null}
                                      </Box>
                                    ) : null}
                                    <Box>
                                      <Text fontSize="xs" color="muted" mb={2}>
                                        {t('Rate this AI draft')}
                                      </Text>
                                      <Stack
                                        direction={['column', 'row']}
                                        spacing={2}
                                        flexWrap="wrap"
                                      >
                                        {AI_ANNOTATION_RATINGS.map((rating) =>
                                          currentAiAnnotation.rating ===
                                          rating ? (
                                            <PrimaryButton
                                              key={rating}
                                              onClick={() =>
                                                setAnnotationDraft(
                                                  (current) => ({
                                                    ...current,
                                                    ai_annotation: {
                                                      ...(normalizeAiAnnotationDraft(
                                                        current.ai_annotation
                                                      ) ||
                                                        createEmptyAiAnnotationDraft()),
                                                      rating,
                                                    },
                                                  })
                                                )
                                              }
                                            >
                                              {formatAiAnnotationRatingLabel(
                                                rating,
                                                t
                                              )}
                                            </PrimaryButton>
                                          ) : (
                                            <SecondaryButton
                                              key={rating}
                                              onClick={() =>
                                                setAnnotationDraft(
                                                  (current) => ({
                                                    ...current,
                                                    ai_annotation: {
                                                      ...(normalizeAiAnnotationDraft(
                                                        current.ai_annotation
                                                      ) ||
                                                        createEmptyAiAnnotationDraft()),
                                                      rating,
                                                    },
                                                  })
                                                )
                                              }
                                            >
                                              {formatAiAnnotationRatingLabel(
                                                rating,
                                                t
                                              )}
                                            </SecondaryButton>
                                          )
                                        )}
                                      </Stack>
                                    </Box>
                                  </Stack>
                                </Box>
                              ) : null}
                            </Box>

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
                              </InterviewPrompt>
                            ) : null}

                            {currentAiAnnotation ? (
                              <InterviewPrompt
                                title={t(
                                  'What did the AI get wrong? Keep it to one or two short sentences.'
                                )}
                              >
                                <Textarea
                                  placeholder={t(
                                    'For example: the AI assumed the order from the object positions, but the human sequence is only clear from the motion between steps.'
                                  )}
                                  value={annotationDraft.ai_annotation_feedback}
                                  onChange={(e) => {
                                    const nextValue = e?.target?.value || ''

                                    setAnnotationDraft((current) => ({
                                      ...current,
                                      ai_annotation_feedback: nextValue,
                                    }))
                                  }}
                                />
                              </InterviewPrompt>
                            ) : null}

                            {hasDecision && hasReason ? (
                              <InterviewPrompt
                                title={t(
                                  'Did you need readable text or explicit sequence markers to judge this flip?'
                                )}
                              >
                                <Stack spacing={2}>
                                  <Checkbox
                                    isChecked={
                                      annotationDraft.text_required === true
                                    }
                                    onChange={(e) => {
                                      const isChecked =
                                        e?.target?.checked === true

                                      setAnnotationDraft((current) => ({
                                        ...current,
                                        text_required: isChecked ? true : null,
                                      }))
                                    }}
                                  >
                                    {t('Readable text was required')}
                                  </Checkbox>
                                  <Checkbox
                                    isChecked={
                                      annotationDraft.sequence_markers_present ===
                                      true
                                    }
                                    onChange={(e) => {
                                      const isChecked =
                                        e?.target?.checked === true

                                      setAnnotationDraft((current) => ({
                                        ...current,
                                        sequence_markers_present: isChecked
                                          ? true
                                          : null,
                                      }))
                                    }}
                                  >
                                    {t('Sequence markers were present')}
                                  </Checkbox>
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
                                  <Checkbox
                                    isChecked={
                                      annotationDraft.report_required === true
                                    }
                                    onChange={(e) => {
                                      const isChecked =
                                        e?.target?.checked === true

                                      setAnnotationDraft((current) => ({
                                        ...current,
                                        report_required: isChecked
                                          ? true
                                          : null,
                                      }))
                                    }}
                                  >
                                    {t('Yes, this should be reported')}
                                  </Checkbox>

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
                                  'How confident are you in that judgment? This is optional.'
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
                                  <option value="">{t('Optional')}</option>
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
                                    {t('Optional detail')}
                                  </Text>
                                  <Text color="muted" fontSize="sm">
                                    {t(
                                      'Open this only when you want to teach extra captions or side summaries.'
                                    )}
                                  </Text>
                                </Box>
                                <SecondaryButton
                                  onClick={() =>
                                    setShowAdvancedFields((current) => !current)
                                  }
                                >
                                  {showAdvancedFields
                                    ? t('Hide detail')
                                    : t('Add detail')}
                                </SecondaryButton>
                              </Flex>

                              {showAdvancedFields ? (
                                <Stack spacing={3} mt={3}>
                                  <InterviewPrompt
                                    title={t(
                                      'If you want, add a short note for each panel.'
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
                                      'If the AI needs more help, summarize the LEFT and RIGHT stories in your own words.'
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
                                      </Box>
                                    </Stack>
                                  </InterviewPrompt>
                                </Stack>
                              ) : null}
                            </Box>

                            <Stack isInline spacing={2} flexWrap="wrap">
                              <PrimaryButton
                                isLoading={isSavingTask}
                                onClick={() => saveTaskDraft()}
                              >
                                {t('Save task draft')}
                              </PrimaryButton>
                              <SecondaryButton
                                isDisabled={isSavingTask || !nextTaskId}
                                onClick={() => saveTaskDraft({advance: true})}
                              >
                                {t('Save and continue')}
                              </SecondaryButton>
                              <SecondaryButton
                                isDisabled={!previousTaskId || isTaskLoading}
                                onClick={() =>
                                  setSelectedTaskId(previousTaskId)
                                }
                              >
                                {t('Previous task')}
                              </SecondaryButton>
                              <SecondaryButton
                                isDisabled={!nextTaskId || isTaskLoading}
                                onClick={() => setSelectedTaskId(nextTaskId)}
                              >
                                {t('Next task')}
                              </SecondaryButton>
                              <SecondaryButton
                                isDisabled={isTaskLoading}
                                onClick={() => loadTask(selectedTaskId)}
                              >
                                {t('Reload task')}
                              </SecondaryButton>
                              <Text
                                color="muted"
                                fontSize="sm"
                                alignSelf="center"
                              >
                                {getDraftHelperText(annotationDraft, t)}
                              </Text>
                            </Stack>
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
                              ? t('Loading task...')
                              : t('Select a task to annotate.')}
                          </Text>
                        </Box>
                      )}
                    </Box>
                  </Flex>
                </Stack>
              </Box>
            ) : null}
          </Stack>
        </SettingsSection>
      </Stack>
    </SettingsLayout>
  )
}
