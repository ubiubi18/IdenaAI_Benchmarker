/* eslint-disable react/prop-types */
import React from 'react'
import {
  Alert,
  Box,
  Flex,
  Image,
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
  Checkbox,
  FormLabel,
  Input,
  Select,
  Textarea,
} from '../../shared/components/components'
import {useEpochState} from '../../shared/providers/epoch-context'

const HUMAN_TEACHER_SET_LIMIT = 30

function formatErrorMessage(error) {
  const raw = String((error && error.message) || error || '').trim()
  const prefix = /Error invoking remote method '[^']+':\s*/i
  const message = raw.replace(prefix, '').trim()

  if (
    /No handler registered for 'localAi\.(?:loadHumanTeacherDemoWorkspace|loadHumanTeacherDemoTask|saveHumanTeacherDemoDraft|loadHumanTeacherAnnotationWorkspace|loadHumanTeacherAnnotationTask|saveHumanTeacherAnnotationDraft|importHumanTeacherAnnotations|exportHumanTeacherTasks)'/i.test(
      message
    )
  ) {
    return 'This human-teacher feature is not available in the running main process yet. Fully restart IdenaAI and try again.'
  }

  if (/Local AI human-teacher bridge is unavailable/i.test(message)) {
    return 'The human-teacher bridge is unavailable in this build. Fully restart IdenaAI and try again.'
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

  if (isCompleteDraft(nextAnnotation)) {
    return t('This flip looks complete.')
  }

  if (hasDraftContent(nextAnnotation)) {
    return t('This flip has unsaved or incomplete draft content.')
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
  const toast = useToast()
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
  const [showAdvancedFields, setShowAdvancedFields] = React.useState(false)
  const [developerSessionState, setDeveloperSessionState] = React.useState(null)
  const [developerOffset, setDeveloperOffset] = React.useState(0)
  const [developerActionResult, setDeveloperActionResult] = React.useState(null)

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
    [currentEpoch, ensureBridge, epoch, t]
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
    ]
  )

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
            taskId,
          })
        } else {
          nextResult = await ensureBridge().loadHumanTeacherAnnotationTask({
            epoch: nextEpoch,
            currentEpoch,
            taskId,
          })
        }

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
    [
      annotationSourceMode,
      currentEpoch,
      currentPeriod,
      demoSampleName,
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
  const hasDecision = Boolean(annotationDraft.final_answer)
  const hasReason = Boolean(String(annotationDraft.why_answer || '').trim())
  const completionPreview = React.useMemo(
    () =>
      getWorkspaceCountsAfterSave(workspace, selectedTaskId, annotationDraft),
    [annotationDraft, selectedTaskId, workspace]
  )

  const saveTaskDraft = React.useCallback(
    async (options = {}) => {
      const {advance = false, quiet = false} = options
      const nextEpoch = String(epoch || '').trim()

      if ((!nextEpoch && annotationSourceMode !== 'demo') || !selectedTaskId) {
        setError(t('Select a flip before saving annotation notes.'))
        return null
      }

      setIsSavingTask(true)
      setError('')

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

        if (!quiet) {
          if (isCompleteDraft(annotationDraft)) {
            rewardWithConfetti({particleCount: 70})
          }
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

        if (advance && nextTaskId) {
          setSelectedTaskId(nextTaskId)
        }

        return {
          task: nextResult?.task || null,
          completionState,
        }
      } catch (nextError) {
        setError(formatErrorMessage(nextError))
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
      developerOffset,
      ensureBridge,
      epoch,
      nextTaskId,
      selectedTaskId,
      t,
      toast,
      workspace,
    ]
  )

  const finalizeDeveloperChunk = React.useCallback(
    async ({trainNow = false, advance = false, exitAfter = false} = {}) => {
      const saved = await saveTaskDraft({quiet: true})

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
          if (nextResult?.training?.ok) {
            toast({
              title: t('Training started'),
              description: t(
                'This 5-flip chunk was added to your local training set and the local AI runtime accepted the training request.'
              ),
              status: 'success',
              duration: 4500,
              isClosable: true,
            })
          } else {
            toast({
              title: t('Chunk saved for training'),
              description: t(
                'Your 5 annotated flips were stored locally, but the current Local AI runtime did not complete training yet.'
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
      developerOffset,
      ensureBridge,
      currentPeriod,
      loadDeveloperSession,
      router,
      saveTaskDraft,
      t,
      toast,
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
  const reviewStatus = normalizeReviewStatus(result?.package?.reviewStatus)
  const eligibleCount = Number(result?.eligibleCount) || 0
  const importedAnnotations = result?.package?.importedAnnotations || null
  const isDeveloperSourceMode = annotationSourceMode === 'developer'
  const isDemoMode = annotationSourceMode === 'demo'
  const developerPendingCount =
    Number(developerSessionState?.pendingTrainingCount) || 0
  const developerAnnotatedCount =
    Number(developerSessionState?.annotatedCount) || 0
  const developerTrainedCount = Number(developerSessionState?.trainedCount) || 0
  const developerRemainingCount =
    Number(developerSessionState?.remainingTaskCount) || 0
  const developerComparison = developerSessionState?.comparison100 || null
  const developerCanAdvance =
    isDeveloperMode &&
    totalTaskCount > 0 &&
    completionPreview.allComplete &&
    developerRemainingCount > 0 &&
    developerOffset + DEVELOPER_TRAINING_CHUNK_SIZE <
      Number(developerSessionState?.totalAvailableTasks || 0)
  const savePrimaryLabel = nextTaskId ? t('Save flip draft') : t('Save flip')
  const finishButtonLabel = React.useMemo(() => {
    if (isDeveloperSourceMode) {
      if (nextTaskId) {
        return t('Save and next flip')
      }

      return t('Train your AI now')
    }

    if (nextTaskId) {
      return t('Save and next flip')
    }

    if (isDemoMode) {
      return t('Save and finish demo')
    }

    return t('Save and submit set')
  }, [isDemoMode, isDeveloperSourceMode, nextTaskId, t])
  const finalFlipHint = React.useMemo(() => {
    if (isDeveloperSourceMode) {
      if (developerCanAdvance) {
        return t(
          'This 5-flip chunk is complete. You can train now or load the next 5 flips.'
        )
      }

      return t(
        'This 5-flip chunk is complete. You can train your AI now or save and come back later.'
      )
    }

    if (isDemoMode) {
      return t(
        'This is the last flip in the demo set. Save it here to finish the demo.'
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
    }
  }, [loadTask, selectedTaskId])

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
                    {t('Back to IdenaAI-GPT')}
                  </SecondaryButton>
                </Stack>

                <Box
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
                    <Text color="muted" fontSize="sm">
                      {t('Annotated flips')}: {developerAnnotatedCount} ·{' '}
                      {t('Pending training')}: {developerPendingCount} ·{' '}
                      {t('Already trained')}: {developerTrainedCount}
                    </Text>
                    <Text color="muted" fontSize="sm">
                      {t('5-flip chunk size')}: {DEVELOPER_TRAINING_CHUNK_SIZE}
                    </Text>
                    <Text color="muted" fontSize="xs">
                      {t('100-flip holdout comparison status')}:{' '}
                      {String(developerComparison?.status || 'not_loaded')}
                    </Text>
                    {result?.comparison100?.expectedPath ? (
                      <Text color="muted" fontSize="xs">
                        {t('Expected comparison record')}:{' '}
                        {result.comparison100.expectedPath}
                      </Text>
                    ) : null}
                    {developerActionResult?.statePath ? (
                      <Text color="muted" fontSize="xs">
                        {t('Developer state path')}:{' '}
                        {developerActionResult.statePath}
                      </Text>
                    ) : null}
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
                          'This developer loop uses 5 bundled FLIP samples at a time. Annotate them one by one, then choose whether to train immediately or load the next 5 flips.'
                        )
                      : t(
                          'This uses the selected epoch annotation set. The app keeps you on one current flip at a time and saves your notes flip by flip.'
                        )}
                  </Text>
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
                              {t('Flip')} {taskIds.indexOf(task.taskId) + 1}
                            </Text>
                            <Text color="muted" fontSize="xs" noOfLines={1}>
                              {task.flipHash || task.taskId}
                            </Text>
                            <Text color="muted" fontSize="xs">
                              {t('Consensus')}: {task.consensusAnswer || 'n/a'}{' '}
                              · {getDraftStatusLabel(task, t)}
                            </Text>
                          </Box>
                        ))}
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
                          </Box>

                          {!nextTaskId && totalTaskCount > 0 ? (
                            <Alert status="info" borderRadius="lg">
                              <Text fontSize="sm">{finalFlipHint}</Text>
                            </Alert>
                          ) : null}

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
                                  onChange={(e) =>
                                    setAnnotationDraft((current) => ({
                                      ...current,
                                      why_answer: e.target.value,
                                    }))
                                  }
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
                                    onChange={(e) =>
                                      setAnnotationDraft((current) => ({
                                        ...current,
                                        text_required: e.target.checked
                                          ? true
                                          : null,
                                      }))
                                    }
                                  >
                                    {t('Readable text was required')}
                                  </Checkbox>
                                  <Checkbox
                                    isChecked={
                                      annotationDraft.sequence_markers_present ===
                                      true
                                    }
                                    onChange={(e) =>
                                      setAnnotationDraft((current) => ({
                                        ...current,
                                        sequence_markers_present: e.target
                                          .checked
                                          ? true
                                          : null,
                                      }))
                                    }
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
                                    onChange={(e) =>
                                      setAnnotationDraft((current) => ({
                                        ...current,
                                        report_required: e.target.checked
                                          ? true
                                          : null,
                                      }))
                                    }
                                  >
                                    {t('Yes, this should be reported')}
                                  </Checkbox>

                                  {annotationDraft.report_required === true ? (
                                    <Textarea
                                      placeholder={t(
                                        'Short reason for why this should be reported.'
                                      )}
                                      value={annotationDraft.report_reason}
                                      onChange={(e) =>
                                        setAnnotationDraft((current) => ({
                                          ...current,
                                          report_reason: e.target.value,
                                        }))
                                      }
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
                                  onChange={(e) =>
                                    setAnnotationDraft((current) => ({
                                      ...current,
                                      confidence: e.target.value,
                                    }))
                                  }
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
                                      'Open this only when you want to teach extra captions or side summaries for this flip.'
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
                                              onChange={(e) =>
                                                setAnnotationDraft(
                                                  (current) => ({
                                                    ...current,
                                                    frame_captions:
                                                      current.frame_captions.map(
                                                        (item, itemIndex) =>
                                                          itemIndex === index
                                                            ? e.target.value
                                                            : item
                                                      ),
                                                  })
                                                )
                                              }
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
                                          onChange={(e) =>
                                            setAnnotationDraft((current) => ({
                                              ...current,
                                              option_a_summary: e.target.value,
                                            }))
                                          }
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
                                          onChange={(e) =>
                                            setAnnotationDraft((current) => ({
                                              ...current,
                                              option_b_summary: e.target.value,
                                            }))
                                          }
                                        />
                                      </Box>

                                      <Box>
                                        <FormLabel>{t('Annotator')}</FormLabel>
                                        <Input
                                          value={annotationDraft.annotator}
                                          onChange={(e) =>
                                            setAnnotationDraft((current) => ({
                                              ...current,
                                              annotator: e.target.value,
                                            }))
                                          }
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
                                {savePrimaryLabel}
                              </PrimaryButton>
                              {isDeveloperMode ? (
                                <>
                                  <SecondaryButton
                                    isDisabled={isSavingTask || !selectedTaskId}
                                    isLoading={isFinalizingDeveloperChunk}
                                    onClick={() =>
                                      nextTaskId
                                        ? saveTaskDraft({advance: true})
                                        : finalizeDeveloperChunk({
                                            trainNow: true,
                                          })
                                    }
                                  >
                                    {finishButtonLabel}
                                  </SecondaryButton>
                                  {!nextTaskId && developerCanAdvance ? (
                                    <SecondaryButton
                                      isDisabled={
                                        isSavingTask ||
                                        isFinalizingDeveloperChunk
                                      }
                                      onClick={() =>
                                        finalizeDeveloperChunk({advance: true})
                                      }
                                    >
                                      {t('Annotate 5 more flips')}
                                    </SecondaryButton>
                                  ) : null}
                                  <SecondaryButton
                                    isDisabled={
                                      isSavingTask || isFinalizingDeveloperChunk
                                    }
                                    onClick={() =>
                                      finalizeDeveloperChunk({exitAfter: true})
                                    }
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
                                      ? saveTaskDraft({advance: true})
                                      : finishAnnotationSet()
                                  }
                                >
                                  {finishButtonLabel}
                                </SecondaryButton>
                              )}
                              <SecondaryButton
                                isDisabled={!previousTaskId || isTaskLoading}
                                onClick={() =>
                                  setSelectedTaskId(previousTaskId)
                                }
                              >
                                {t('Previous flip')}
                              </SecondaryButton>
                              <SecondaryButton
                                isDisabled={!nextTaskId || isTaskLoading}
                                onClick={() => setSelectedTaskId(nextTaskId)}
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
          </Stack>
        </SettingsSection>
      </Stack>
    </SettingsLayout>
  )
}
