/* eslint-disable react/prop-types */
import React, {useMemo, useEffect, useState, useRef, useCallback} from 'react'
import {useMachine} from '@xstate/react'
import {useRouter} from 'next/router'
import {useTranslation} from 'react-i18next'
import {
  Box,
  Flex,
  Text,
  IconButton,
  Heading,
  Stack,
  Button,
  Divider,
  SlideFade,
  useDisclosure,
  useToast,
} from '@chakra-ui/react'
import {createValidationMachine} from '../screens/validation/machine'
import {
  persistValidationState,
  loadValidationState,
  filterRegularFlips,
  rearrangeFlips,
  readyFlip,
  decodedWithKeywords,
  availableReportsNumber,
  solvableFlips,
} from '../screens/validation/utils'
import {
  ValidationScene,
  ActionBar,
  ThumbnailList,
  Header,
  Title,
  FlipChallenge,
  CurrentStep,
  Flip,
  ActionBarItem,
  Thumbnail,
  FlipWords,
  NavButton,
  QualificationActions,
  QualificationButton,
  WelcomeQualificationDialog,
  ValidationTimer,
  ValidationFailedDialog,
  SubmitFailedDialog,
  FailedFlipAnnotation,
  ReviewValidationDialog,
  EncourageReportDialog,
  BadFlipDialog,
  ReviewShortSessionDialog,
  SynchronizingValidationAlert,
  OfflineValidationAlert,
} from '../screens/validation/components'
import {rem} from '../shared/theme'
import {AnswerType, RelevanceType} from '../shared/types'
import {useEpochState} from '../shared/providers/epoch-context'
import {useTimingState} from '../shared/providers/timing-context'
import {
  InfoButton,
  PrimaryButton,
  SecondaryButton,
} from '../shared/components/button'
import {FloatDebug, Toast, Tooltip} from '../shared/components/components'
import {useChainState} from '../shared/providers/chain-context'
import {reorderList} from '../shared/utils/arr'
import {
  useSettingsDispatch,
  useSettingsState,
} from '../shared/providers/settings-context'
import {
  FullscreenIcon,
  HollowStarIcon,
  NewStarIcon,
} from '../shared/components/icons'
import {useAutoCloseValidationToast} from '../screens/validation/hooks/use-validation-toast'
import {solveValidationSessionWithAi} from '../screens/validation/ai/solver-orchestrator'

const DEFAULT_AI_SOLVER_SETTINGS = {
  enabled: false,
  provider: 'openai',
  model: 'gpt-4o-mini',
  mode: 'manual',
  benchmarkProfile: 'strict',
  deadlineMs: 60 * 1000,
  requestTimeoutMs: 9 * 1000,
  maxConcurrency: 1,
  maxRetries: 1,
  maxOutputTokens: 0,
  interFlipDelayMs: 650,
  temperature: 0,
  forceDecision: true,
  uncertaintyRepromptEnabled: true,
  uncertaintyConfidenceThreshold: 0.45,
  uncertaintyRepromptMinRemainingMs: 3500,
  uncertaintyRepromptInstruction: '',
  promptTemplateOverride: '',
  flipVisionMode: 'composite',
  ensembleEnabled: false,
  ensemblePrimaryWeight: 1,
  legacyHeuristicEnabled: false,
  legacyHeuristicWeight: 1,
  legacyHeuristicOnly: false,
  ensembleProvider2Enabled: false,
  ensembleProvider2: 'gemini',
  ensembleModel2: 'gemini-2.0-flash',
  ensembleProvider2Weight: 1,
  ensembleProvider3Enabled: false,
  ensembleProvider3: 'openai',
  ensembleModel3: 'gpt-4.1-mini',
  ensembleProvider3Weight: 1,
  customProviderName: 'Custom OpenAI-compatible',
  customProviderBaseUrl: 'https://api.openai.com/v1',
  customProviderChatPath: '/chat/completions',
}

function formatErrorForToast(error) {
  const raw = String((error && error.message) || error || '').trim()
  const prefix = /Error invoking remote method '[^']+':\s*/i
  const withoutIpcPrefix = raw.replace(prefix, '').trim()

  return withoutIpcPrefix || 'Unknown error'
}

function hasLocalAiValidationSequences(flip) {
  return Boolean(
    flip &&
      flip.decoded &&
      Array.isArray(flip.images) &&
      flip.images.length > 0 &&
      Array.isArray(flip.orders) &&
      flip.orders.length >= 2 &&
      flip.orders.every((order) => Array.isArray(order) && order.length > 0)
  )
}

async function imageSrcToDataUrl(src) {
  const value = String(src || '').trim()

  if (!value) {
    throw new Error('Validation panel image is missing')
  }

  if (value.startsWith('data:')) {
    return value
  }

  const response = await fetch(value)

  if (!response.ok) {
    throw new Error('Unable to load validation panel image')
  }

  const blob = await response.blob()

  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => {
      if (typeof reader.result === 'string' && reader.result.trim()) {
        resolve(reader.result)
      } else {
        reject(new Error('Unable to read validation panel image'))
      }
    }

    reader.onerror = () => {
      reject(new Error('Unable to read validation panel image'))
    }

    reader.readAsDataURL(blob)
  })
}

async function buildOrderedLocalAiImages(images = [], order = []) {
  const orderedImages = reorderList(images, order).filter(Boolean)
  return Promise.all(orderedImages.map((src) => imageSrcToDataUrl(src)))
}

function shortenLocalAiReason(value, maxLength = 140) {
  const text = String(value || '').trim()
  if (!text) return ''
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text
}

function describeLocalAiRecommendation(result, t) {
  if (!result) {
    return {
      label: t('Not checked'),
      color: 'muted',
      detail: t('Run a local advisory check to compare the two story options.'),
    }
  }

  if (!result.ok) {
    return {
      label: t('Unavailable'),
      color: 'orange.500',
      detail:
        shortenLocalAiReason(result.lastError || result.error) ||
        t('Local AI recommendation is unavailable right now.'),
    }
  }

  const confidence = String(result.confidence || '').trim()
  const reason = shortenLocalAiReason(result.reason)
  const detail = [
    confidence ? t('{{confidence}} confidence', {confidence}) : '',
    reason,
  ]
    .filter(Boolean)
    .join(' • ')

  switch (result.classification) {
    case 'consistent':
      return {
        label: t('Likely consistent'),
        color: 'green.500',
        detail: detail || t('This sequence looks coherent panel to panel.'),
      }
    case 'inconsistent':
      return {
        label: t('Likely inconsistent'),
        color: 'red.500',
        detail:
          detail ||
          t('This sequence may contain a contradiction or bad order.'),
      }
    case 'ambiguous':
    default:
      return {
        label: t('Possibly ambiguous'),
        color: 'orange.500',
        detail: detail || t('This sequence may be plausible but unclear.'),
      }
  }
}

function LocalAiValidationRecommendation({
  isShortSessionMode,
  isChecking,
  canCheck,
  recommendation,
  onCheck,
}) {
  const {t} = useTranslation()
  const panelBg = isShortSessionMode ? 'whiteAlpha.100' : 'gray.50'
  const panelBorder = isShortSessionMode ? 'whiteAlpha.300' : 'gray.100'
  const titleColor = isShortSessionMode ? 'whiteAlpha.900' : 'brandGray.500'
  const bodyColor = isShortSessionMode ? 'whiteAlpha.800' : 'muted'
  const left = describeLocalAiRecommendation(recommendation.left, t)
  const right = describeLocalAiRecommendation(recommendation.right, t)

  return (
    <Stack
      spacing={2}
      px={4}
      py={3}
      mx={6}
      mb={3}
      borderWidth="1px"
      borderColor={panelBorder}
      borderRadius="md"
      bg={panelBg}
    >
      <Flex align="center" justify="space-between">
        <Box>
          <Text fontSize="xs" fontWeight={600} color={titleColor}>
            {t('Local AI recommendation')}
          </Text>
          <Text fontSize="xs" color={bodyColor}>
            {t('Local AI recommendation only. It does not change your answer.')}
          </Text>
        </Box>
        <SecondaryButton
          isDisabled={!canCheck}
          isLoading={isChecking}
          onClick={onCheck}
        >
          {t('Check with Local AI')}
        </SecondaryButton>
      </Flex>

      {recommendation.status === 'checking' ? (
        <Text fontSize="xs" color={bodyColor}>
          {t('Checking the current left and right story sequences locally...')}
        </Text>
      ) : null}

      {recommendation.error ? (
        <Text fontSize="xs" color="orange.500">
          {recommendation.error}
        </Text>
      ) : null}

      <Stack spacing={1}>
        <Flex align="center" justify="space-between">
          <Text fontSize="xs" color={bodyColor}>
            {t('Left story')}
          </Text>
          <Text fontSize="xs" fontWeight={600} color={left.color}>
            {left.label}
          </Text>
        </Flex>
        <Text fontSize="xs" color={bodyColor}>
          {left.detail}
        </Text>
      </Stack>

      <Stack spacing={1}>
        <Flex align="center" justify="space-between">
          <Text fontSize="xs" color={bodyColor}>
            {t('Right story')}
          </Text>
          <Text fontSize="xs" fontWeight={600} color={right.color}>
            {right.label}
          </Text>
        </Flex>
        <Text fontSize="xs" color={bodyColor}>
          {right.detail}
        </Text>
      </Stack>
    </Stack>
  )
}

export default function ValidationPage() {
  const router = useRouter()
  const epoch = useEpochState()
  const timing = useTimingState()

  useAutoCloseValidationToast()

  const previewAi = router.query?.previewAi === '1'

  if (previewAi) {
    return (
      <ValidationSession
        epoch={999}
        validationStart={Date.now() + 60 * 1000}
        shortSessionDuration={60}
        longSessionDuration={180}
        forceAiPreview
      />
    )
  }

  if (epoch && timing && timing.shortSession)
    return (
      <ValidationSession
        epoch={epoch.epoch}
        validationStart={new Date(epoch.nextValidation).getTime()}
        shortSessionDuration={timing.shortSession}
        longSessionDuration={timing.longSession}
      />
    )

  return null
}

function ValidationSession({
  epoch,
  validationStart,
  shortSessionDuration,
  longSessionDuration,
  forceAiPreview = false,
}) {
  const router = useRouter()

  const {t, i18n} = useTranslation()
  const toast = useToast()
  const settings = useSettingsState()
  const {updateAiSolverSettings} = useSettingsDispatch()
  const aiSolverSettings = useMemo(
    () => ({
      ...DEFAULT_AI_SOLVER_SETTINGS,
      ...(settings.aiSolver || {}),
      ...(forceAiPreview ? {enabled: true} : {}),
    }),
    [forceAiPreview, settings.aiSolver]
  )
  const localAiCaptureEnabled = settings.localAi?.captureEnabled === true
  const [aiSolving, setAiSolving] = useState(false)
  const [aiProgress, setAiProgress] = useState(null)
  const [aiLastRun, setAiLastRun] = useState(null)
  const [aiLiveTimeline, setAiLiveTimeline] = useState([])
  const [aiActiveFlip, setAiActiveFlip] = useState(null)
  const [awaitingHumanReporting, setAwaitingHumanReporting] = useState(false)
  const [localAiRecommendation, setLocalAiRecommendation] = useState({
    status: 'idle',
    left: null,
    right: null,
    error: '',
  })
  const [isCheckingLocalAiRecommendation, setIsCheckingLocalAiRecommendation] =
    useState(false)
  const autoSolveStartedRef = useRef({short: false, long: false})

  const {
    isOpen: isExceededTooltipOpen,
    onOpen: onOpenExceededTooltip,
    onClose: onCloseExceededTooltip,
  } = useDisclosure()
  const {
    isOpen: isReportDialogOpen,
    onOpen: onOpenReportDialog,
    onClose: onCloseReportDialog,
  } = useDisclosure()

  const validationMachine = useMemo(
    () =>
      createValidationMachine({
        epoch,
        validationStart,
        shortSessionDuration,
        longSessionDuration,
        locale: i18n.language || 'en',
        onDecodedFlip: ({
          flipHash,
          epoch: epochNumber,
          sessionType,
          images,
        }) => {
          if (
            !localAiCaptureEnabled ||
            !global.ipcRenderer ||
            typeof global.ipcRenderer.send !== 'function'
          ) {
            return
          }

          try {
            global.ipcRenderer.send('localAi.captureFlip', {
              flipHash,
              epoch: epochNumber,
              sessionType,
              images,
            })
          } catch (error) {
            if (global.isDev) {
              global.logger.debug(
                'localAi.captureFlip failed',
                error && error.message
              )
            }
          }
        },
      }),
    [
      epoch,
      i18n.language,
      localAiCaptureEnabled,
      longSessionDuration,
      shortSessionDuration,
      validationStart,
    ]
  )

  const [state, send] = useMachine(validationMachine, {
    actions: {
      onExceededReports: () => {
        onOpenExceededTooltip()
        setTimeout(onCloseExceededTooltip, 3000)
      },
      onValidationSucceeded: () => {
        router.push('/validation/after')
      },
    },
    state: loadValidationState(),
    logger: global.isDev
      ? console.log
      : (...args) => global.logger.debug(...args),
  })

  const {
    currentIndex,
    bestFlipHashes,
    translations,
    reports,
    longFlips,
    didReport,
  } = state.context

  useEffect(() => {
    persistValidationState(state)
  }, [state])

  const {
    isOpen: isOpenEncourageReportDialog,
    onOpen: onOpenEncourageReportDialog,
    onClose: onCloseEncourageReportDialog,
  } = useDisclosure()

  React.useEffect(() => {
    if (didReport) onOpenEncourageReportDialog()
  }, [didReport, onOpenEncourageReportDialog])

  const {syncing, offline} = useChainState()

  const flips = sessionFlips(state)
  const currentFlip = flips[currentIndex]
  const localAiValidationEnabled = settings.localAi?.enabled === true
  const localAiCheckerAvailable =
    localAiValidationEnabled &&
    global.localAi &&
    typeof global.localAi.checkFlipSequence === 'function'
  const canCheckCurrentFlipWithLocalAi =
    localAiCheckerAvailable &&
    (isShortSession(state) || isLongSessionFlips(state)) &&
    hasLocalAiValidationSequences(currentFlip)

  const flipTimerDetails = {
    isShortSession: isShortSession(state),
    validationStart,
    shortSessionDuration,
    longSessionDuration,
  }

  const [bestRewardTipOpen, setBestRewardTipOpen] = useState(false)
  useEffect(() => {
    if (currentFlip && currentFlip.relevance === RelevanceType.Relevant) {
      setBestRewardTipOpen(true)
    }
  }, [currentFlip])
  useEffect(() => {
    if (bestFlipHashes[currentFlip?.hash]) {
      setBestRewardTipOpen(false)
    }
  }, [bestFlipHashes, currentFlip])
  useEffect(() => {
    if (bestRewardTipOpen) {
      setTimeout(() => {
        setBestRewardTipOpen(false)
      }, 5000)
    }
  }, [bestRewardTipOpen, currentFlip])

  const notifyAi = useCallback(
    (title, description, status = 'info') => {
      toast({
        render: () => (
          <Toast title={title} description={description} status={status} />
        ),
      })
    },
    [toast]
  )

  const enableAutomaticNextValidationSession = useCallback(() => {
    updateAiSolverSettings({
      enabled: true,
      mode: 'session-auto',
    })
    toast({
      render: () => (
        <Toast
          title={t('Automatic AI solving enabled')}
          description={t(
            'The next real validation session will auto-start AI solving when possible.'
          )}
          status="success"
        />
      ),
    })
    router.push('/settings/ai')
  }, [router, t, toast, updateAiSolverSettings])

  const canRunAiSolveInShort =
    state.matches('shortSession.solve.answer.normal') &&
    state.matches('shortSession.fetch.done') &&
    !isSubmitting(state)

  const canRunAiSolveInLong =
    state.matches('longSession.solve.answer.flips') &&
    state.matches('longSession.fetch.done') &&
    !isSubmitting(state)

  let aiSessionType = null
  if (canRunAiSolveInShort) {
    aiSessionType = 'short'
  } else if (canRunAiSolveInLong) {
    aiSessionType = 'long'
  }

  const isSessionAutoMode =
    aiSolverSettings.enabled && aiSolverSettings.mode === 'session-auto'
  const canRunAiSolve = aiSolverSettings.enabled && Boolean(aiSessionType)

  const runAiSolve = useCallback(async () => {
    if (!canRunAiSolve || aiSolving || !aiSessionType) return

    const sessionType = aiSessionType
    const displayFlips = sessionFlips(state)
    const indexByHash = new Map(
      displayFlips.map((flip, index) => [flip.hash, index])
    )

    setAiSolving(true)
    setAiProgress(t('Preparing flip payloads...'))
    setAiLiveTimeline([])
    setAiActiveFlip(null)
    setAiLastRun({
      status: 'running',
      sessionType,
      provider: aiSolverSettings.provider,
      model: aiSolverSettings.model,
      startedAt: new Date().toISOString(),
    })

    try {
      const liveEntries = []
      const result = await solveValidationSessionWithAi({
        sessionType,
        shortFlips: state.context.shortFlips,
        longFlips: state.context.longFlips,
        aiSolver: aiSolverSettings,
        sessionMeta: {
          epoch,
          sessionType,
          startedAt: new Date().toISOString(),
        },
        onProgress: (event) => {
          if (event.stage === 'prepared') {
            setAiProgress(
              t('Preparing flip payloads: {{current}}/{{total}}', {
                current: event.index,
                total: event.total,
              })
            )
            return
          }

          if (event.stage === 'solving') {
            const pickIndex = indexByHash.get(event.hash)
            if (Number.isFinite(pickIndex)) {
              send({type: 'PICK', index: pickIndex})
            }
            setAiActiveFlip({
              hash: event.hash,
              leftImage: event.leftImage,
              rightImage: event.rightImage,
              index: event.index,
              total: event.total,
              sessionType: event.sessionType,
            })
            setAiProgress(
              t('Solving flip {{current}}/{{total}}', {
                current: event.index,
                total: event.total,
              })
            )
            return
          }

          if (event.stage === 'solved') {
            const pickIndex = indexByHash.get(event.hash)
            if (Number.isFinite(pickIndex)) {
              send({type: 'PICK', index: pickIndex})
            }
            setAiActiveFlip({
              hash: event.hash,
              leftImage: event.leftImage,
              rightImage: event.rightImage,
              answer: event.answer,
              latencyMs: event.latencyMs,
              confidence: event.confidence,
              error: event.error,
              tokenUsage: event.tokenUsage,
              index: event.index,
              total: event.total,
              sessionType: event.sessionType,
            })
            const entry = {
              at: new Date().toISOString(),
              hash: event.hash,
              answer: event.answer,
              confidence: event.confidence,
              latencyMs: event.latencyMs,
              error: event.error,
              index: event.index,
              total: event.total,
              rawAnswerBeforeRemap: event.rawAnswerBeforeRemap,
              finalAnswerAfterRemap: event.finalAnswerAfterRemap,
              sideSwapped: event.sideSwapped,
              tokenUsage: event.tokenUsage,
            }
            liveEntries.push(entry)
            setAiLiveTimeline((prev) => prev.concat(entry).slice(-24))
            setAiProgress(
              t('Flip {{current}}/{{total}}: {{answer}} in {{latency}} ms', {
                current: event.index,
                total: event.total,
                answer: String(event.answer || 'skip').toUpperCase(),
                latency: Number.isFinite(event.latencyMs)
                  ? event.latencyMs
                  : '-',
              })
            )
            return
          }

          if (event.stage === 'waiting') {
            setAiProgress(
              t(
                'Rate-limit pacing: wait {{wait}} ms before next flip ({{current}}/{{total}})',
                {
                  wait: event.waitMs,
                  current: event.index,
                  total: event.total,
                }
              )
            )
            return
          }

          if (event.stage === 'completed') {
            setAiProgress(
              t('AI run completed: {{applied}} answers applied', {
                applied: event.appliedAnswers || 0,
              })
            )
          }
        },
        onDecision: async ({hash, option}) => {
          if (option > 0) {
            send({
              type: 'ANSWER',
              hash,
              option,
            })
          }
        },
      })

      notifyAi(
        t('AI helper completed'),
        t(
          '{{answers}} answers applied in {{session}} session ({{provider}} {{model}})',
          {
            answers: result.answers.length,
            session: sessionType,
            provider: result.provider,
            model: result.model,
          }
        )
      )

      setAiLastRun({
        status: 'completed',
        sessionType,
        provider: result.provider,
        model: result.model,
        profile: result.profile,
        summary: result.summary,
        flips: result.results || [],
        appliedAnswers: result.answers.length,
        timeline: liveEntries.slice(-24),
        completedAt: new Date().toISOString(),
      })

      if (sessionType === 'short' && result.answers.length > 0) {
        send('SUBMIT')
      }

      if (
        sessionType === 'long' &&
        Array.isArray(result.results) &&
        result.results.length > 0
      ) {
        setAwaitingHumanReporting(true)
        send('FINISH_FLIPS')
      }
    } catch (error) {
      const errorMessage = error?.message || error.toString()

      notifyAi(t('AI helper failed'), errorMessage, 'error')

      setAiLastRun((prev) => ({
        ...(prev || {}),
        status: 'failed',
        sessionType,
        error: errorMessage,
        completedAt: new Date().toISOString(),
      }))
    } finally {
      setAiSolving(false)
      setAiProgress(null)
    }
  }, [
    aiSolverSettings,
    aiSolving,
    aiSessionType,
    canRunAiSolve,
    epoch,
    notifyAi,
    send,
    state,
    t,
  ])

  useEffect(() => {
    if (
      isSessionAutoMode &&
      canRunAiSolve &&
      aiSessionType &&
      !autoSolveStartedRef.current[aiSessionType]
    ) {
      autoSolveStartedRef.current[aiSessionType] = true
      runAiSolve()
    }
  }, [isSessionAutoMode, aiSessionType, canRunAiSolve, runAiSolve])

  useEffect(() => {
    if (
      isSessionAutoMode &&
      state.matches('longSession.solve.answer.welcomeQualification')
    ) {
      send('START_LONG_SESSION')
    }
  }, [isSessionAutoMode, send, state])

  useEffect(() => {
    if (
      isSessionAutoMode &&
      awaitingHumanReporting &&
      state.matches('longSession.solve.answer.finishFlips')
    ) {
      send('START_KEYWORDS_QUALIFICATION')
    }
  }, [awaitingHumanReporting, isSessionAutoMode, send, state])

  useEffect(() => {
    if (
      awaitingHumanReporting &&
      state.matches('longSession.solve.answer.keywords')
    ) {
      notifyAi(
        t('Human reporting required'),
        t(
          'AI finished flip choices. Please complete reporting/approval manually, then submit long session answers.'
        ),
        'warning'
      )
      setAwaitingHumanReporting(false)
    }
  }, [awaitingHumanReporting, notifyAi, state, t])

  useEffect(() => {
    setLocalAiRecommendation({
      status: 'idle',
      left: null,
      right: null,
      error: '',
    })
  }, [currentFlip?.hash, localAiCheckerAvailable])

  const runLocalAiRecommendation = useCallback(async () => {
    if (!canCheckCurrentFlipWithLocalAi || !currentFlip) {
      return
    }

    setIsCheckingLocalAiRecommendation(true)
    setLocalAiRecommendation({
      status: 'checking',
      left: null,
      right: null,
      error: '',
    })

    try {
      const leftImages = await buildOrderedLocalAiImages(
        currentFlip.images,
        currentFlip.orders[0]
      )
      const rightImages = await buildOrderedLocalAiImages(
        currentFlip.images,
        currentFlip.orders[1]
      )

      const left = await global.localAi.checkFlipSequence({images: leftImages})
      const right = await global.localAi.checkFlipSequence({
        images: rightImages,
      })

      setLocalAiRecommendation({
        status: 'ready',
        left,
        right,
        error: '',
      })
    } catch (error) {
      setLocalAiRecommendation({
        status: 'error',
        left: null,
        right: null,
        error: formatErrorForToast(error),
      })
    } finally {
      setIsCheckingLocalAiRecommendation(false)
    }
  }, [canCheckCurrentFlipWithLocalAi, currentFlip])

  useEffect(() => {
    if (aiSessionType !== 'short') {
      autoSolveStartedRef.current.short = false
    }
    if (aiSessionType !== 'long') {
      autoSolveStartedRef.current.long = false
    }
  }, [aiSessionType])

  return (
    <ValidationScene bg={isShortSession(state) ? 'black' : 'white'}>
      <Flex
        align="center"
        justify="center"
        bg={aiSolverSettings.enabled ? 'orange.500' : 'blue.500'}
        color="white"
        py={1}
        fontSize="xs"
        fontWeight={600}
      >
        {aiSolverSettings.enabled
          ? t('Optional AI solver mode is enabled.')
          : t('Classic validation flow active. Optional AI solver is off.')}
      </Flex>

      {forceAiPreview ? (
        <Box bg="blue.012" borderBottomWidth="1px" borderBottomColor="blue.050">
          <Flex
            px={4}
            py={3}
            align={['flex-start', 'center']}
            justify="space-between"
            direction={['column', 'row']}
            gap={3}
          >
            <Box>
              <Text fontWeight={600}>{t('Off-chain AI solver test')}</Text>
              <Text color="muted" fontSize="sm">
                {t(
                  'This is only a local test screen. It does not start a real validation session and it does not publish anything.'
                )}
              </Text>
            </Box>
            <Stack isInline spacing={2}>
              <SecondaryButton onClick={() => router.push('/settings/ai')}>
                {t('Back to AI')}
              </SecondaryButton>
              <PrimaryButton onClick={enableAutomaticNextValidationSession}>
                {t('Enable auto-solve next session')}
              </PrimaryButton>
            </Stack>
          </Flex>
        </Box>
      ) : null}

      {syncing && (
        <SynchronizingValidationAlert>
          {t('Synchronizing...')}
        </SynchronizingValidationAlert>
      )}

      {offline && (
        <OfflineValidationAlert>{t('Offline')}</OfflineValidationAlert>
      )}

      <Header>
        <Title color={isShortSession(state) ? 'white' : 'brandGray.500'}>
          {['shortSession', 'longSession'].some(state.matches) &&
          !isLongSessionKeywords(state)
            ? t('Select meaningful story: left or right', {nsSeparator: '!'})
            : t('Check flips quality')}
        </Title>
        <Flex align="center">
          <Title
            color={isShortSession(state) ? 'white' : 'brandGray.500'}
            mr={6}
          >
            {currentIndex + 1}{' '}
            <Text as="span" color="muted">
              {t('out of')} {flips.length}
            </Text>
          </Title>

          <IconButton
            icon={<FullscreenIcon />}
            bg={isShortSession(state) ? 'brandGray.060' : 'gray.300'}
            color={isShortSession(state) ? 'white' : 'brandGray.500'}
            borderRadius="lg"
            fontSize={rem(20)}
            w={10}
            h={10}
            _hover={{
              bg: isShortSession(state) ? 'brandGray.060' : 'gray.300',
            }}
            onClick={global.toggleFullScreen}
          />
        </Flex>
      </Header>
      <CurrentStep>
        <FlipChallenge>
          <Flex justify="center" align="center" position="relative">
            {currentFlip &&
              ((currentFlip.fetched && !currentFlip.decoded) ||
                currentFlip.failed) && (
                <FailedFlipAnnotation>
                  {t('No data available. Please skip the flip.')}
                </FailedFlipAnnotation>
              )}
            <Flip
              {...currentFlip}
              variant={AnswerType.Left}
              timerDetails={flipTimerDetails}
              onChoose={(hash) =>
                send({
                  type: 'ANSWER',
                  hash,
                  option: AnswerType.Left,
                })
              }
            />
            <Flip
              {...currentFlip}
              variant={AnswerType.Right}
              timerDetails={flipTimerDetails}
              onChoose={(hash) =>
                send({
                  type: 'ANSWER',
                  hash,
                  option: AnswerType.Right,
                })
              }
              onImageFail={() => send('REFETCH_FLIPS')}
            />
          </Flex>
          {(isLongSessionKeywords(state) ||
            state.matches('validationSucceeded')) &&
            currentFlip && (
              <FlipWords
                key={currentFlip.hash}
                currentFlip={currentFlip}
                translations={translations}
                validationStart={validationStart}
                onSkip={() => {
                  if (isLastFlip(state)) {
                    send({type: 'SUBMIT'})
                  } else {
                    send({type: 'NEXT'})
                  }
                }}
              >
                <Stack spacing={4}>
                  <Stack isInline spacing={1} align="center">
                    <Heading fontSize="base" fontWeight={500}>
                      {t(`Is the flip correct?`)}
                    </Heading>
                    <InfoButton onClick={onOpenReportDialog} />
                  </Stack>
                  <QualificationActions>
                    <QualificationButton
                      isSelected={
                        currentFlip.relevance === RelevanceType.Relevant
                      }
                      onClick={() => {
                        onCloseExceededTooltip()
                        send({
                          type: 'APPROVE_WORDS',
                          hash: currentFlip.hash,
                        })
                      }}
                    >
                      {t('Approve')}
                    </QualificationButton>

                    <Tooltip
                      label={t(
                        'All available reports are used. You can skip this flip or remove Report status from other flips.'
                      )}
                      isOpen={isExceededTooltipOpen}
                      placement="top"
                      zIndex="tooltip"
                    >
                      <QualificationButton
                        isSelected={
                          currentFlip.relevance === RelevanceType.Irrelevant
                        }
                        bg={
                          currentFlip.relevance === RelevanceType.Irrelevant
                            ? 'red.500'
                            : 'red.012'
                        }
                        color={
                          currentFlip.relevance === RelevanceType.Irrelevant
                            ? 'white'
                            : 'red.500'
                        }
                        _hover={null}
                        _active={null}
                        _focus={{
                          boxShadow: '0 0 0 3px rgb(255 102 102 /0.50)',
                          outline: 'none',
                        }}
                        onClick={() =>
                          send({
                            type: 'REPORT_WORDS',
                            hash: currentFlip.hash,
                          })
                        }
                      >
                        {t('Report')}{' '}
                        {t('({{count}} left)', {
                          count:
                            availableReportsNumber(longFlips) - reports.size,
                        })}
                      </QualificationButton>
                    </Tooltip>
                  </QualificationActions>
                  <SlideFade
                    style={{
                      zIndex:
                        currentFlip.relevance === RelevanceType.Relevant &&
                        (Object.keys(bestFlipHashes).length < 1 ||
                          bestFlipHashes[currentFlip.hash])
                          ? 'auto'
                          : -1,
                    }}
                    offsetY="-80px"
                    in={
                      currentFlip.relevance === RelevanceType.Relevant &&
                      (Object.keys(bestFlipHashes).length < 1 ||
                        bestFlipHashes[currentFlip.hash])
                    }
                  >
                    <Divider mt={1} />
                    <Flex direction="column" align="center">
                      <Button
                        backgroundColor="transparent"
                        border="solid 1px #d2d4d9"
                        color="brandGray.500"
                        borderRadius={6}
                        mt={5}
                        variant="bordered"
                        w={['100%', 'auto']}
                        isActive={!!bestFlipHashes[currentFlip.hash]}
                        _hover={{
                          backgroundColor: 'transparent',
                          _disabled: {
                            backgroundColor: 'transparent',
                            color: '#DCDEDF',
                          },
                        }}
                        _active={{
                          backgroundColor: '#F5F6F7',
                        }}
                        onClick={() =>
                          send({
                            type: 'FAVORITE',
                            hash: currentFlip.hash,
                          })
                        }
                      >
                        {bestFlipHashes[currentFlip.hash] ? (
                          <NewStarIcon
                            h="12.5px"
                            w="13px"
                            mr="5.5px"
                            fill="brandGray.500"
                          />
                        ) : (
                          <HollowStarIcon
                            h="12.5px"
                            w="13px"
                            mr="5.5px"
                            fill="brandGray.500"
                          />
                        )}
                        {t('Mark as the best')}
                      </Button>
                      <Text fontSize="11px" color="#B8BABC" mt={2}>
                        {t('You can mark this flip as the best')}
                      </Text>
                    </Flex>
                  </SlideFade>
                </Stack>
              </FlipWords>
            )}
        </FlipChallenge>
      </CurrentStep>
      {canCheckCurrentFlipWithLocalAi ? (
        <LocalAiValidationRecommendation
          isShortSessionMode={isShortSession(state)}
          isChecking={isCheckingLocalAiRecommendation}
          canCheck={canCheckCurrentFlipWithLocalAi}
          recommendation={localAiRecommendation}
          onCheck={runLocalAiRecommendation}
        />
      ) : null}
      {(isShortSession(state) || isLongSessionFlips(state)) &&
        aiSolverSettings.enabled && (
          <AiTelemetryPanel
            isShortSessionMode={isShortSession(state)}
            telemetry={aiLastRun}
            aiProgress={aiProgress}
            activeFlip={aiActiveFlip}
            liveTimeline={aiLiveTimeline}
          />
        )}
      <ActionBar>
        <ActionBarItem />
        <ActionBarItem justify="center">
          <ValidationTimer
            validationStart={validationStart}
            duration={
              shortSessionDuration -
              10 +
              (isShortSession(state) ? 0 : longSessionDuration)
            }
          />
        </ActionBarItem>
        <ActionBarItem justify="flex-end">
          {(isShortSession(state) || isLongSessionFlips(state)) &&
            aiSolverSettings.enabled && (
              <Stack isInline spacing={2} align="center" mr={3}>
                {aiProgress && (
                  <Text
                    fontSize="xs"
                    color={isShortSession(state) ? 'whiteAlpha.800' : 'muted'}
                  >
                    {aiProgress}
                  </Text>
                )}
                <SecondaryButton
                  isDisabled={!canRunAiSolve}
                  isLoading={aiSolving}
                  onClick={runAiSolve}
                >
                  {isShortSession(state)
                    ? t('AI solve short session')
                    : t('AI solve long session')}
                </SecondaryButton>
              </Stack>
            )}
          {(isShortSession(state) || isLongSessionKeywords(state)) &&
            (hasAllRelevanceMarks(state) || isLastFlip(state) ? (
              <PrimaryButton
                isDisabled={!canSubmit(state)}
                isLoading={isSubmitting(state)}
                loadingText={t('Submitting answers...')}
                onClick={() => send('SUBMIT')}
              >
                {t('Submit answers')}
              </PrimaryButton>
            ) : (
              <Tooltip label={t('Go to last flip')}>
                <PrimaryButton
                  isDisabled={!canSubmit(state)}
                  isLoading={isSubmitting(state)}
                  loadingText={t('Submitting answers...')}
                  onClick={() => send('SUBMIT')}
                >
                  {t('Submit answers')}
                </PrimaryButton>
              </Tooltip>
            ))}
          {isLongSessionFlips(state) && (
            <PrimaryButton
              isDisabled={!canSubmit(state)}
              onClick={() => send('FINISH_FLIPS')}
            >
              {t('Start checking keywords')}
            </PrimaryButton>
          )}
        </ActionBarItem>
      </ActionBar>

      <ThumbnailList currentIndex={currentIndex}>
        {flips.map((flip, idx) => (
          <Thumbnail
            key={flip.hash}
            {...flip}
            isCurrent={currentIndex === idx}
            isBest={bestFlipHashes[flip.hash]}
            onPick={() => send({type: 'PICK', index: idx})}
          />
        ))}
      </ThumbnailList>

      {!isFirstFlip(state) &&
        hasManyFlips(state) &&
        isSolving(state) &&
        !isSubmitting(state) && (
          <NavButton
            type="prev"
            bg={isShortSession(state) ? 'xwhite.010' : 'gray.50'}
            color={isShortSession(state) ? 'white' : 'brandGray.500'}
            onClick={() => send({type: 'PREV'})}
          />
        )}
      {!isLastFlip(state) &&
        hasManyFlips(state) &&
        isSolving(state) &&
        !isSubmitting(state) && (
          <NavButton
            type="next"
            bg={isShortSession(state) ? 'xwhite.010' : 'gray.50'}
            color={isShortSession(state) ? 'white' : 'brandGray.500'}
            onClick={() => send({type: 'NEXT'})}
          />
        )}
      {isSubmitFailed(state) && (
        <SubmitFailedDialog isOpen onSubmit={() => send('RETRY_SUBMIT')} />
      )}

      {state.matches('longSession.solve.answer.welcomeQualification') && (
        <WelcomeQualificationDialog
          isOpen
          onSubmit={() => send('START_LONG_SESSION')}
        />
      )}

      {state.matches('validationFailed') && (
        <ValidationFailedDialog isOpen onSubmit={() => router.push('/home')} />
      )}

      <BadFlipDialog
        isOpen={
          isReportDialogOpen ||
          state.matches('longSession.solve.answer.finishFlips')
        }
        title={t('Earn rewards for reporting')}
        subtitle={t(
          'Report bad flips and get rewarded if these flips are reported by more than 50% of other participants'
        )}
        onClose={() => {
          if (state.matches('longSession.solve.answer.finishFlips'))
            send('START_KEYWORDS_QUALIFICATION')
          else onCloseReportDialog()
        }}
      />

      <ReviewValidationDialog
        flips={flips.filter(solvableFlips)}
        reportedFlipsCount={reports.size}
        availableReportsCount={availableReportsNumber(longFlips)}
        isOpen={state.matches('longSession.solve.answer.review')}
        isSubmitting={isSubmitting(state)}
        onSubmit={() => send('SUBMIT')}
        onMisingAnswers={() => {
          send({
            type: 'CHECK_FLIPS',
            index: flips.findIndex(({option = 0}) => option < 1),
          })
        }}
        onMisingReports={() => {
          send('CHECK_REPORTS')
        }}
        onCancel={() => {
          send('CANCEL')
        }}
      />

      <ReviewShortSessionDialog
        flips={flips.filter(solvableFlips)}
        isOpen={state.matches(
          'shortSession.solve.answer.submitShortSession.confirm'
        )}
        onSubmit={() => send('SUBMIT')}
        onClose={() => {
          send('CANCEL')
        }}
        onCancel={() => {
          send('CANCEL')
        }}
      />

      <EncourageReportDialog
        isOpen={isOpenEncourageReportDialog}
        onClose={onCloseEncourageReportDialog}
      />

      {global.isDev && <FloatDebug>{state.value}</FloatDebug>}
    </ValidationScene>
  )
}

function toPct(value) {
  const num = Number(value)
  if (!Number.isFinite(num)) return '0%'
  return `${Math.round(Math.max(0, Math.min(1, num)) * 100)}%`
}

function formatLatency(value) {
  const num = Number(value)
  if (!Number.isFinite(num) || num < 0) return '-'
  return `${num}ms`
}

function tokenTotal(usage = {}) {
  const total = Number(usage && usage.totalTokens)
  if (Number.isFinite(total) && total >= 0) return total

  const prompt = Number(usage && usage.promptTokens)
  const completion = Number(usage && usage.completionTokens)
  const normalizedPrompt = Number.isFinite(prompt) && prompt >= 0 ? prompt : 0
  const normalizedCompletion =
    Number.isFinite(completion) && completion >= 0 ? completion : 0
  return normalizedPrompt + normalizedCompletion
}

function shortenHash(hash) {
  const value = String(hash || '')
  if (value.length <= 12) return value
  return `${value.slice(0, 6)}...${value.slice(-4)}`
}

function AiTelemetryPanel({
  isShortSessionMode,
  telemetry,
  aiProgress,
  activeFlip,
  liveTimeline = [],
}) {
  const cardBg = isShortSessionMode ? 'whiteAlpha.100' : 'gray.50'
  const cardBorder = isShortSessionMode ? 'whiteAlpha.300' : 'gray.100'
  const titleColor = isShortSessionMode ? 'whiteAlpha.900' : 'brandGray.500'
  const bodyColor = isShortSessionMode ? 'whiteAlpha.800' : 'muted'

  return (
    <Stack
      spacing={2}
      px={4}
      py={3}
      mx={6}
      mb={3}
      borderWidth="1px"
      borderColor={cardBorder}
      borderRadius="md"
      bg={cardBg}
    >
      <Text fontSize="xs" fontWeight={600} color={titleColor}>
        AI benchmark telemetry
      </Text>

      {aiProgress && (
        <Text fontSize="xs" color={bodyColor}>
          {aiProgress}
        </Text>
      )}

      {!telemetry && (
        <Text fontSize="xs" color={bodyColor}>
          No AI run yet in this validation session.
        </Text>
      )}

      {telemetry && (
        <Stack spacing={1}>
          <Text fontSize="xs" color={bodyColor}>
            {`${telemetry.provider || '-'} ${telemetry.model || '-'} (${String(
              telemetry.sessionType || 'short'
            )})`}
          </Text>

          {telemetry.status === 'running' && (
            <Text fontSize="xs" color={bodyColor}>
              Solving flips in sequence with rate-limit pacing...
            </Text>
          )}

          {telemetry.status === 'failed' && (
            <Text fontSize="xs" color="red.300">
              {telemetry.error || 'AI run failed'}
            </Text>
          )}

          {telemetry.summary && (
            <Stack spacing={1}>
              <Text fontSize="xs" color={bodyColor}>
                {`applied ${telemetry.appliedAnswers || 0}, left ${
                  telemetry.summary.left || 0
                }, right ${telemetry.summary.right || 0}, skipped ${
                  telemetry.summary.skipped || 0
                }, elapsed ${formatLatency(telemetry.summary.elapsedMs)}`}
              </Text>
              <Text fontSize="xs" color={bodyColor}>
                {`tokens prompt ${
                  telemetry.summary.tokens?.promptTokens || 0
                }, completion ${
                  telemetry.summary.tokens?.completionTokens || 0
                }, total ${telemetry.summary.tokens?.totalTokens || 0}`}
              </Text>
              <Text fontSize="xs" color={bodyColor}>
                {`raw L/R/S ${telemetry.summary.diagnostics?.rawLeft || 0}/${
                  telemetry.summary.diagnostics?.rawRight || 0
                }/${telemetry.summary.diagnostics?.rawSkip || 0}, swapped ${
                  telemetry.summary.diagnostics?.swapped || 0
                }/${telemetry.summary.diagnostics?.notSwapped || 0}, remapped ${
                  telemetry.summary.diagnostics?.remappedDecisions || 0
                }`}
              </Text>
            </Stack>
          )}

          {activeFlip && (
            <Box
              borderWidth="1px"
              borderColor={cardBorder}
              borderRadius="md"
              p={2}
              mt={1}
            >
              <Text fontSize="xs" color={bodyColor} mb={1}>
                {`current ${activeFlip.index || '-'} / ${
                  activeFlip.total || '-'
                } ${shortenHash(activeFlip.hash)}`}
              </Text>
              <Flex gap={2}>
                {activeFlip.leftImage ? (
                  <img
                    src={activeFlip.leftImage}
                    alt="ai-current-left"
                    style={{
                      width: 84,
                      height: 64,
                      objectFit: 'cover',
                      borderRadius: 6,
                      border: '1px solid rgba(128,128,128,0.35)',
                    }}
                  />
                ) : null}
                {activeFlip.rightImage ? (
                  <img
                    src={activeFlip.rightImage}
                    alt="ai-current-right"
                    style={{
                      width: 84,
                      height: 64,
                      objectFit: 'cover',
                      borderRadius: 6,
                      border: '1px solid rgba(128,128,128,0.35)',
                    }}
                  />
                ) : null}
              </Flex>
              {activeFlip.answer && (
                <Text fontSize="xs" color={bodyColor} mt={1}>
                  {`selected ${String(
                    activeFlip.answer
                  ).toUpperCase()} in ${formatLatency(
                    activeFlip.latencyMs
                  )} | tok ${tokenTotal(activeFlip.tokenUsage)}`}
                </Text>
              )}
            </Box>
          )}

          {Array.isArray(liveTimeline) &&
            liveTimeline.slice(-8).map((event) => (
              <Flex
                key={`${event.hash}-${event.at}`}
                justify="space-between"
                gap={3}
              >
                <Text fontSize="xs" color={bodyColor} noOfLines={1}>
                  {`#${event.index || '-'} ${shortenHash(event.hash)} ${String(
                    event.answer || 'skip'
                  ).toUpperCase()} raw:${String(
                    event.rawAnswerBeforeRemap || '-'
                  ).toUpperCase()}${event.sideSwapped ? ' SWAP' : ''}`}
                </Text>
                <Text fontSize="xs" color={bodyColor}>
                  {`${toPct(event.confidence)} ${formatLatency(
                    event.latencyMs
                  )} tok:${tokenTotal(event.tokenUsage)}${
                    event.error ? ' ERR' : ''
                  }`}
                </Text>
              </Flex>
            ))}

          {!liveTimeline.length &&
            Array.isArray(telemetry.flips) &&
            telemetry.flips.slice(0, 6).map((flip) => (
              <Flex key={flip.hash} justify="space-between" gap={3}>
                <Text fontSize="xs" color={bodyColor} noOfLines={1}>
                  {`${shortenHash(flip.hash)} ${String(
                    flip.answer || 'skip'
                  ).toUpperCase()}`}
                </Text>
                <Text fontSize="xs" color={bodyColor}>
                  {`${toPct(flip.confidence)} ${formatLatency(
                    flip.latencyMs
                  )} tok:${tokenTotal(flip.tokenUsage)}${
                    flip.error ? ' ERR' : ''
                  }`}
                </Text>
              </Flex>
            ))}
        </Stack>
      )}
    </Stack>
  )
}

function isShortSession(state) {
  return state.matches('shortSession')
}

function isLongSessionFlips(state) {
  return ['flips', 'finishFlips']
    .map((substate) => `longSession.solve.answer.${substate}`)
    .some(state.matches)
}

function isLongSessionKeywords(state) {
  return ['keywords', 'submitLongSession']
    .map((substate) => `longSession.solve.answer.${substate}`)
    .some(state.matches)
}

function isSolving(state) {
  return ['shortSession', 'longSession'].some(state.matches)
}

function isSubmitting(state) {
  return [
    'shortSession.solve.answer.submitShortSession.submitting',
    'longSession.solve.answer.finishFlips',
    'longSession.solve.answer.submitLongSession',
  ].some(state.matches)
}

function isSubmitFailed(state) {
  return [
    ['shortSession', 'submitShortSession'],
    ['longSession', 'submitLongSession'],
  ]
    .map(([state1, state2]) => `${state1}.solve.answer.${state2}.fail`)
    .some(state.matches)
}

function isFirstFlip(state) {
  return ['shortSession', 'longSession']
    .map((substate) => `${substate}.solve.nav.firstFlip`)
    .some(state.matches)
}

function isLastFlip(state) {
  return ['shortSession', 'longSession']
    .map((type) => `${type}.solve.nav.lastFlip`)
    .some(state.matches)
}

function hasManyFlips(state) {
  return sessionFlips(state).length > 1
}

function canSubmit(state) {
  if (isShortSession(state) || isLongSessionFlips(state))
    return (hasAllAnswers(state) || isLastFlip(state)) && !isSubmitting(state)

  if (isLongSessionKeywords(state))
    return (
      (hasAllRelevanceMarks(state) || isLastFlip(state)) && !isSubmitting(state)
    )
}

function sessionFlips(state) {
  const {
    context: {shortFlips, longFlips},
  } = state
  return isShortSession(state)
    ? rearrangeFlips(filterRegularFlips(shortFlips))
    : rearrangeFlips(longFlips.filter(readyFlip))
}

function hasAllAnswers(state) {
  const {
    context: {shortFlips, longFlips},
  } = state
  const flips = isShortSession(state)
    ? shortFlips.filter(({decoded, extra}) => decoded && !extra)
    : longFlips.filter(({decoded}) => decoded)
  return flips.length && flips.every(({option}) => option)
}

function hasAllRelevanceMarks({context: {longFlips}}) {
  const flips = longFlips.filter(decodedWithKeywords)
  return flips.every(({relevance}) => relevance)
}
