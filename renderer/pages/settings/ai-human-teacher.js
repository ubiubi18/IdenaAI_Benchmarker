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
} from '../../shared/components/components'
import {useEpochState} from '../../shared/providers/epoch-context'

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
    next.frame_captions.every((item) => String(item || '').trim()) &&
      next.option_a_summary.trim() &&
      next.option_b_summary.trim() &&
      next.final_answer.trim() &&
      next.why_answer.trim()
  )
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

export default function AiHumanTeacherPage() {
  const {t} = useTranslation()
  const router = useRouter()
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
                            <Text color="muted" fontSize="sm">
                              {t('LEFT order')}:{' '}
                              {formatOrder(taskDetail.leftOrder)}
                            </Text>
                            <Text color="muted" fontSize="sm">
                              {t('RIGHT order')}:{' '}
                              {formatOrder(taskDetail.rightOrder)}
                            </Text>
                          </Box>

                          <SimpleGrid columns={[1, 2]} spacing={3}>
                            {(taskDetail.panels || []).map((panel) => (
                              <Box
                                key={panel.id}
                                borderWidth="1px"
                                borderColor="gray.100"
                                borderRadius="md"
                                overflow="hidden"
                              >
                                <Image
                                  src={panel.dataUrl}
                                  alt={panel.id}
                                  objectFit="contain"
                                  w="full"
                                  bg="gray.50"
                                />
                                <Box px={2} py={1}>
                                  <Text fontSize="xs" color="muted">
                                    {t('Panel')} {panel.index + 1}
                                  </Text>
                                </Box>
                              </Box>
                            ))}
                          </SimpleGrid>

                          <Stack spacing={3}>
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

                            {annotationDraft.frame_captions.map(
                              (caption, index) => (
                                <Box key={`caption-${index}`}>
                                  <FormLabel>
                                    {t('Frame caption')} {index + 1}
                                  </FormLabel>
                                  <Input
                                    value={caption}
                                    onChange={(e) =>
                                      setAnnotationDraft((current) => ({
                                        ...current,
                                        frame_captions:
                                          current.frame_captions.map(
                                            (item, itemIndex) =>
                                              itemIndex === index
                                                ? e.target.value
                                                : item
                                          ),
                                      }))
                                    }
                                  />
                                </Box>
                              )
                            )}

                            <Box>
                              <FormLabel>{t('OPTION A summary')}</FormLabel>
                              <Textarea
                                value={annotationDraft.option_a_summary}
                                onChange={(e) =>
                                  setAnnotationDraft((current) => ({
                                    ...current,
                                    option_a_summary: e.target.value,
                                  }))
                                }
                              />
                            </Box>

                            <Box>
                              <FormLabel>{t('OPTION B summary')}</FormLabel>
                              <Textarea
                                value={annotationDraft.option_b_summary}
                                onChange={(e) =>
                                  setAnnotationDraft((current) => ({
                                    ...current,
                                    option_b_summary: e.target.value,
                                  }))
                                }
                              />
                            </Box>

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
                                {t('Readable text is required')}
                              </Checkbox>
                              <Checkbox
                                isChecked={
                                  annotationDraft.sequence_markers_present ===
                                  true
                                }
                                onChange={(e) =>
                                  setAnnotationDraft((current) => ({
                                    ...current,
                                    sequence_markers_present: e.target.checked
                                      ? true
                                      : null,
                                  }))
                                }
                              >
                                {t('Sequence markers are present')}
                              </Checkbox>
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
                                {t('This flip should be reported')}
                              </Checkbox>
                            </Stack>

                            <Box>
                              <FormLabel>{t('Report reason')}</FormLabel>
                              <Textarea
                                value={annotationDraft.report_reason}
                                onChange={(e) =>
                                  setAnnotationDraft((current) => ({
                                    ...current,
                                    report_reason: e.target.value,
                                  }))
                                }
                              />
                            </Box>

                            <Box>
                              <FormLabel>{t('Final answer')}</FormLabel>
                              <Select
                                value={annotationDraft.final_answer}
                                onChange={(e) =>
                                  setAnnotationDraft((current) => ({
                                    ...current,
                                    final_answer: e.target.value,
                                  }))
                                }
                              >
                                <option value="">{t('Choose')}</option>
                                <option value="left">{t('left')}</option>
                                <option value="right">{t('right')}</option>
                                <option value="skip">{t('skip')}</option>
                              </Select>
                            </Box>

                            <Box>
                              <FormLabel>{t('Why this answer')}</FormLabel>
                              <Textarea
                                value={annotationDraft.why_answer}
                                onChange={(e) =>
                                  setAnnotationDraft((current) => ({
                                    ...current,
                                    why_answer: e.target.value,
                                  }))
                                }
                              />
                            </Box>

                            <Box>
                              <FormLabel>{t('Confidence (0-1)')}</FormLabel>
                              <Input
                                value={annotationDraft.confidence}
                                onChange={(e) =>
                                  setAnnotationDraft((current) => ({
                                    ...current,
                                    confidence: e.target.value,
                                  }))
                                }
                              />
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
