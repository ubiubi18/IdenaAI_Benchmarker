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
import {
  checkAiProviderReadiness,
  formatMissingAiProviders,
  isLocalAiProvider,
} from '../shared/utils/ai-provider-readiness'

const previewAiSampleSet = require('../../samples/flips/flip-challenge-test-5-decoded-labeled.json')

const AUTO_REPORT_DEFAULT_DELAY_MINUTES = 10
const DEFAULT_AI_SOLVER_SETTINGS = {
  enabled: false,
  provider: 'openai',
  model: 'gpt-5.4',
  mode: 'manual',
  autoReportEnabled: false,
  autoReportDelayMinutes: AUTO_REPORT_DEFAULT_DELAY_MINUTES,
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

function createAiProviderStatusState() {
  return {
    checked: false,
    checking: false,
    hasKey: false,
    allReady: false,
    primaryReady: false,
    activeProvider: '',
    requiredProviders: [],
    missingProviders: [],
    error: '',
  }
}

function formatAiProviderReadinessError(status, t) {
  if (status && status.error === 'ai_bridge_unavailable') {
    return t('AI solver bridge is unavailable in this build.')
  }

  if (status && status.error === 'local_ai_bridge_unavailable') {
    return t('Local AI bridge is unavailable in this build.')
  }

  const missingProviders = formatMissingAiProviders(
    status && status.missingProviders
  )

  if (missingProviders) {
    if (isLocalAiProvider(status && status.activeProvider)) {
      return t(
        'Local AI runtime is not ready for: {{providers}}. Open AI settings, enable Local AI, and check the runtime before starting live solving.',
        {
          providers: missingProviders,
        }
      )
    }

    return t(
      'Missing AI provider key for: {{providers}}. Open AI settings and load the session key before starting live solving.',
      {
        providers: missingProviders,
      }
    )
  }

  const message = String((status && status.error) || '').trim()
  if (message) {
    return message
  }

  return t(
    isLocalAiProvider(status && status.activeProvider)
      ? 'Local AI runtime setup is not ready. Open AI settings, enable Local AI, and check the runtime before starting live solving.'
      : 'AI provider setup is not ready. Open AI settings and load the session key before starting live solving.'
  )
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

const PREVIEW_AI_SHORT_FLIP_LIMIT = 3

function createPreviewAiShortFlips() {
  const sampleFlips = Array.isArray(previewAiSampleSet?.flips)
    ? previewAiSampleSet.flips.slice(0, PREVIEW_AI_SHORT_FLIP_LIMIT)
    : []

  return sampleFlips.map((flip, index) => ({
    hash:
      String(flip?.hash || '').trim() || `preview-ai-short-flip-${index + 1}`,
    ready: true,
    fetched: true,
    decoded: true,
    extra: false,
    failed: false,
    flipped: false,
    loading: false,
    retries: 0,
    option: AnswerType.None,
    relevance: RelevanceType.Abstained,
    images: Array.isArray(flip?.images) ? flip.images.slice() : [],
    orders: Array.isArray(flip?.orders)
      ? flip.orders.slice(0, 2).map((order) => [...order])
      : [],
  }))
}

function buildAiProviderConfig(aiSolver = {}) {
  const provider = String(aiSolver.provider || '')
    .trim()
    .toLowerCase()

  if (provider !== 'openai-compatible') {
    return null
  }

  return {
    name: aiSolver.customProviderName,
    baseUrl: aiSolver.customProviderBaseUrl,
    chatPath: aiSolver.customProviderChatPath,
  }
}

function normalizeAiConsultProvider(value) {
  const provider = String(value || '')
    .trim()
    .toLowerCase()

  if (
    [
      'openai',
      'openai-compatible',
      'gemini',
      'anthropic',
      'xai',
      'mistral',
      'groq',
      'deepseek',
      'openrouter',
    ].includes(provider)
  ) {
    return provider
  }

  return null
}

function normalizeAiWeight(value, fallback = 1) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }
  return Math.min(10, Math.max(0.05, parsed))
}

function buildAiConsultProviders(aiSolver = {}, providerConfig = null) {
  if (!aiSolver.ensembleEnabled) {
    return []
  }

  return [
    {
      enabled: aiSolver.ensembleProvider2Enabled,
      provider: aiSolver.ensembleProvider2,
      model: aiSolver.ensembleModel2,
      weight: aiSolver.ensembleProvider2Weight,
      source: 'ensemble-slot-2',
    },
    {
      enabled: aiSolver.ensembleProvider3Enabled,
      provider: aiSolver.ensembleProvider3,
      model: aiSolver.ensembleModel3,
      weight: aiSolver.ensembleProvider3Weight,
      source: 'ensemble-slot-3',
    },
  ]
    .filter((slot) => slot.enabled)
    .map((slot) => {
      const provider = normalizeAiConsultProvider(slot.provider)
      const model = String(slot.model || '').trim()

      if (!provider || !model) {
        return null
      }

      return {
        provider,
        model,
        weight: normalizeAiWeight(slot.weight, 1),
        source: slot.source,
        providerConfig:
          provider === 'openai-compatible' ? {...(providerConfig || {})} : null,
      }
    })
    .filter(Boolean)
    .slice(0, 2)
}

function hasLongSessionReportSelections(longFlips = []) {
  return Array.isArray(longFlips)
    ? longFlips.some(
        ({relevance}) =>
          relevance === RelevanceType.Relevant ||
          relevance === RelevanceType.Irrelevant
      )
    : false
}

function pickLongSessionReviewOrder(flip) {
  if (flip?.option === AnswerType.Right) {
    return Array.isArray(flip?.orders?.[1]) ? flip.orders[1] : []
  }

  return Array.isArray(flip?.orders?.[0]) ? flip.orders[0] : []
}

function normalizeAutoReportKeywords(words = []) {
  return Array.isArray(words)
    ? words
        .map((item) => ({
          name: String(item?.name || '').trim(),
          desc: String(item?.desc || '').trim(),
        }))
        .filter(({name, desc}) => name || desc)
        .slice(0, 2)
    : []
}

function normalizeLocalCaptureWords(words = []) {
  return Array.isArray(words)
    ? words
        .map((item) =>
          item && typeof item === 'object'
            ? {
                id: Number.isFinite(Number(item.id)) ? Number(item.id) : null,
                name: String(item.name || '').trim() || null,
                desc:
                  String(item.desc || item.description || '').trim() || null,
              }
            : null
        )
        .filter(Boolean)
    : []
}

function getLocalAiCaptureSessionType(state) {
  if (isShortSession(state)) {
    return 'short'
  }

  if (isLongSessionFlips(state) || isLongSessionKeywords(state)) {
    return 'long'
  }

  return null
}

function normalizeLocalCaptureSelectedOrder(flip) {
  if (flip?.option === AnswerType.Left) {
    return 'left'
  }

  if (flip?.option === AnswerType.Right) {
    return 'right'
  }

  return null
}

function normalizeLocalCaptureRelevance(value) {
  if (value === RelevanceType.Relevant) {
    return 'relevant'
  }

  if (value === RelevanceType.Irrelevant) {
    return 'irrelevant'
  }

  if (value === RelevanceType.Abstained) {
    return 'abstained'
  }

  return null
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
        key="preview-ai-validation"
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
        key={`validation-${epoch.epoch}-${new Date(
          epoch.nextValidation
        ).getTime()}`}
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
  const [aiProviderStatus, setAiProviderStatus] = useState(() =>
    createAiProviderStatusState()
  )
  const [awaitingHumanReporting, setAwaitingHumanReporting] = useState(false)
  const [autoReportDeadlineAt, setAutoReportDeadlineAt] = useState(null)
  const [autoReportRunning, setAutoReportRunning] = useState(false)
  const [localAiRecommendation, setLocalAiRecommendation] = useState({
    status: 'idle',
    left: null,
    right: null,
    error: '',
  })
  const [isCheckingLocalAiRecommendation, setIsCheckingLocalAiRecommendation] =
    useState(false)
  const autoSolveStartedRef = useRef({short: false, long: false})
  const manualReportingStartedRef = useRef(false)
  const autoReportSubmitPendingRef = useRef(false)
  const localAiCaptureSyncRef = useRef({})
  const previewShortFlips = useMemo(
    () => (forceAiPreview ? createPreviewAiShortFlips() : []),
    [forceAiPreview]
  )

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

  const [validationMachine] = useState(() =>
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
        orders,
      }) => {
        if (
          !localAiCaptureEnabled ||
          !global.localAi ||
          typeof global.localAi.captureFlip !== 'function'
        ) {
          return
        }

        try {
          global.localAi.captureFlip({
            flipHash,
            epoch: epochNumber,
            sessionType,
            images,
            panelCount: Array.isArray(images) ? images.length : 0,
            orders,
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
      initialShortFlips: previewShortFlips,
    })
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
    state: forceAiPreview ? undefined : loadValidationState(),
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
    if (hasLongSessionReportSelections(longFlips)) {
      manualReportingStartedRef.current = true
      setAutoReportDeadlineAt(null)
    }
  }, [longFlips])

  useEffect(() => {
    if (forceAiPreview) {
      return
    }
    persistValidationState(state)
  }, [forceAiPreview, state])

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
  const captureSessionType = getLocalAiCaptureSessionType(state)

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
    if (
      !localAiCaptureEnabled ||
      !captureSessionType ||
      !global.localAi ||
      typeof global.localAi.captureFlip !== 'function'
    ) {
      return
    }

    flips.forEach((flip) => {
      if (!flip || !flip.hash) {
        return
      }

      const payload = {
        flipHash: flip.hash,
        epoch,
        sessionType: captureSessionType,
        panelCount: Array.isArray(flip.images) ? flip.images.length : 0,
        orders: Array.isArray(flip.orders) ? flip.orders : [],
        words: normalizeLocalCaptureWords(flip.words),
        selectedOrder: normalizeLocalCaptureSelectedOrder(flip),
        relevance: normalizeLocalCaptureRelevance(flip.relevance),
        best: Boolean(bestFlipHashes[flip.hash]),
      }

      const fingerprint = JSON.stringify(payload)
      if (localAiCaptureSyncRef.current[flip.hash] === fingerprint) {
        return
      }

      localAiCaptureSyncRef.current[flip.hash] = fingerprint

      try {
        global.localAi.captureFlip(payload)
      } catch (error) {
        if (global.isDev) {
          global.logger.debug(
            'localAi.captureFlip incremental update failed',
            error && error.message
          )
        }
      }
    })
  }, [bestFlipHashes, captureSessionType, epoch, flips, localAiCaptureEnabled])

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
  const autoReportDelayMinutes = Math.max(
    1,
    Number(aiSolverSettings.autoReportDelayMinutes) ||
      AUTO_REPORT_DEFAULT_DELAY_MINUTES
  )
  const autoReportEnabled =
    isSessionAutoMode &&
    aiSolverSettings.autoReportEnabled === true &&
    !forceAiPreview
  const aiProviderConfig = useMemo(
    () => buildAiProviderConfig(aiSolverSettings),
    [aiSolverSettings]
  )
  const aiConsultProviders = useMemo(
    () => buildAiConsultProviders(aiSolverSettings, aiProviderConfig),
    [aiProviderConfig, aiSolverSettings]
  )

  const refreshAiProviderStatus = useCallback(async () => {
    if (!aiSolverSettings.enabled) {
      const nextState = createAiProviderStatusState()
      setAiProviderStatus(nextState)
      return nextState
    }

    setAiProviderStatus((prev) => ({
      ...prev,
      checking: true,
      error: '',
    }))

    try {
      const nextState = await checkAiProviderReadiness({
        bridge: global.aiSolver,
        localBridge: global.localAi,
        localAi: settings.localAi,
        aiSolver: aiSolverSettings,
      })
      setAiProviderStatus(nextState)
      return nextState
    } catch (error) {
      const fallbackState = {
        ...createAiProviderStatusState(),
        checked: true,
        activeProvider: String(aiSolverSettings.provider || 'openai').trim(),
        requiredProviders: [
          String(aiSolverSettings.provider || 'openai').trim(),
        ],
        missingProviders: [
          String(aiSolverSettings.provider || 'openai').trim(),
        ],
        error: String((error && error.message) || error || '').trim(),
      }
      setAiProviderStatus(fallbackState)
      return fallbackState
    }
  }, [aiSolverSettings, settings.localAi])

  useEffect(() => {
    refreshAiProviderStatus()
  }, [refreshAiProviderStatus])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined
    }

    const refreshOnFocus = () => {
      refreshAiProviderStatus()
    }

    window.addEventListener('focus', refreshOnFocus)
    document.addEventListener('visibilitychange', refreshOnFocus)

    return () => {
      window.removeEventListener('focus', refreshOnFocus)
      document.removeEventListener('visibilitychange', refreshOnFocus)
    }
  }, [refreshAiProviderStatus])

  const aiProviderSetupError = useMemo(() => {
    if (!aiSolverSettings.enabled || !aiProviderStatus.checked) {
      return ''
    }

    if (aiProviderStatus.allReady) {
      return ''
    }

    return formatAiProviderReadinessError(aiProviderStatus, t)
  }, [aiProviderStatus, aiSolverSettings.enabled, t])

  const aiProviderSetupReady =
    !aiSolverSettings.enabled ||
    (aiProviderStatus.checked && aiProviderStatus.allReady)
  const canRunAiSolve =
    aiSolverSettings.enabled && Boolean(aiSessionType) && aiProviderSetupReady

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
      const readiness = await refreshAiProviderStatus()
      if (!readiness.allReady) {
        throw new Error(formatAiProviderReadinessError(readiness, t))
      }

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

      if (
        sessionType === 'short' &&
        result.answers.length > 0 &&
        !forceAiPreview
      ) {
        send('SUBMIT')
      }

      if (
        sessionType === 'short' &&
        result.answers.length > 0 &&
        forceAiPreview
      ) {
        notifyAi(
          t('Preview answers applied'),
          t(
            'AI answers were applied to the local sample flips only. Nothing was submitted on-chain.'
          )
        )
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
    forceAiPreview,
    refreshAiProviderStatus,
    send,
    state,
    t,
  ])

  const beginManualReporting = useCallback(() => {
    manualReportingStartedRef.current = true
    autoReportSubmitPendingRef.current = false
    setAutoReportDeadlineAt(null)
  }, [])

  const handleApproveWords = useCallback(
    (hash) => {
      beginManualReporting()
      onCloseExceededTooltip()
      send({
        type: 'APPROVE_WORDS',
        hash,
      })
    },
    [beginManualReporting, onCloseExceededTooltip, send]
  )

  const handleReportWords = useCallback(
    (hash) => {
      beginManualReporting()
      send({
        type: 'REPORT_WORDS',
        hash,
      })
    },
    [beginManualReporting, send]
  )

  const runAutoReportReview = useCallback(async () => {
    if (
      !autoReportEnabled ||
      autoReportRunning ||
      manualReportingStartedRef.current ||
      !state.matches('longSession.solve.answer.keywords')
    ) {
      return
    }

    if (
      !global.aiSolver ||
      typeof global.aiSolver.reviewValidationReports !== 'function'
    ) {
      notifyAi(
        t('AI auto-report unavailable'),
        t('This build does not expose the keyword review bridge.'),
        'error'
      )
      return
    }

    if (isLocalAiProvider(aiSolverSettings.provider)) {
      notifyAi(
        t('AI auto-report unavailable'),
        t(
          'Local AI does not support validation report review yet. Switch to a cloud provider for automatic report review.'
        ),
        'error'
      )
      return
    }

    setAutoReportRunning(true)
    setAutoReportDeadlineAt(null)

    try {
      const readiness = await refreshAiProviderStatus()
      if (!readiness.allReady) {
        throw new Error(formatAiProviderReadinessError(readiness, t))
      }

      const candidateSourceFlips = longFlips.filter(decodedWithKeywords)
      const candidateFlips = await Promise.all(
        candidateSourceFlips.map(async (flip) => ({
          hash: flip.hash,
          images: await buildOrderedLocalAiImages(
            flip.images,
            pickLongSessionReviewOrder(flip)
          ),
          keywords: normalizeAutoReportKeywords(flip.words),
        }))
      )

      if (!candidateFlips.length) {
        throw new Error(
          t('No keyword-ready flips are available for automatic report review.')
        )
      }

      const reviewResult = await global.aiSolver.reviewValidationReports({
        ...aiSolverSettings,
        provider: aiSolverSettings.provider,
        model: aiSolverSettings.model,
        providerConfig: aiProviderConfig,
        consultProviders: aiConsultProviders,
        flips: candidateFlips,
        session: {
          epoch,
          sessionType: 'long-report-review',
          startedAt: new Date().toISOString(),
        },
      })

      const reportQuota = availableReportsNumber(longFlips)
      const reportHashes = (
        Array.isArray(reviewResult?.results) ? reviewResult.results : []
      )
        .filter((item) => item && item.decision === 'report')
        .sort((left, right) => right.confidence - left.confidence)
        .slice(0, reportQuota)
        .map((item) => item.hash)
      const reportHashSet = new Set(reportHashes)

      candidateSourceFlips.forEach((flip) => {
        send({
          type: reportHashSet.has(flip.hash) ? 'REPORT_WORDS' : 'APPROVE_WORDS',
          hash: flip.hash,
        })
      })

      autoReportSubmitPendingRef.current = true

      notifyAi(
        t('AI auto-report completed'),
        t(
          'Applied {{reported}} report decisions and {{approved}} approvals. Long session answers will be submitted automatically.',
          {
            reported: reportHashSet.size,
            approved: Math.max(
              0,
              candidateSourceFlips.length - reportHashSet.size
            ),
          }
        )
      )

      send('SUBMIT')
    } catch (error) {
      autoReportSubmitPendingRef.current = false
      notifyAi(
        t('AI auto-report failed'),
        error?.message || String(error || ''),
        'error'
      )
    } finally {
      setAutoReportRunning(false)
    }
  }, [
    aiConsultProviders,
    aiProviderConfig,
    aiSolverSettings,
    autoReportEnabled,
    autoReportRunning,
    epoch,
    longFlips,
    notifyAi,
    refreshAiProviderStatus,
    send,
    state,
    t,
  ])

  const handleSubmit = useCallback(() => {
    if (forceAiPreview) {
      notifyAi(
        t('Preview only'),
        t(
          'This off-chain preview does not submit answers on-chain. Use it to verify loading and AI solving, then return to AI settings.'
        )
      )
      return
    }

    send('SUBMIT')
  }, [forceAiPreview, notifyAi, send, t])

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
      aiProviderSetupReady &&
      state.matches('longSession.solve.answer.welcomeQualification')
    ) {
      send('START_LONG_SESSION')
    }
  }, [aiProviderSetupReady, isSessionAutoMode, send, state])

  useEffect(() => {
    if (state.matches('longSession.solve.answer.flips')) {
      manualReportingStartedRef.current = false
      autoReportSubmitPendingRef.current = false
      setAutoReportDeadlineAt(null)
    }
  }, [state])

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
      const existingSelections = hasLongSessionReportSelections(longFlips)

      manualReportingStartedRef.current = existingSelections

      if (autoReportEnabled && !existingSelections) {
        const deadlineAt = Date.now() + autoReportDelayMinutes * 60 * 1000

        setAutoReportDeadlineAt(deadlineAt)

        notifyAi(
          t('Delayed AI auto-report armed'),
          t(
            'Manual reporting has {{minutes}} minutes before AI reviews bad flips and submits the long session automatically.',
            {
              minutes: autoReportDelayMinutes,
            }
          )
        )
      } else {
        notifyAi(
          t('Human reporting required'),
          t(
            'AI finished flip choices. Please complete reporting/approval manually, then submit long session answers.'
          ),
          'warning'
        )
      }

      setAwaitingHumanReporting(false)
    }
  }, [
    autoReportDelayMinutes,
    autoReportEnabled,
    awaitingHumanReporting,
    longFlips,
    notifyAi,
    state,
    t,
  ])

  useEffect(() => {
    if (
      autoReportSubmitPendingRef.current &&
      state.matches('longSession.solve.answer.review')
    ) {
      autoReportSubmitPendingRef.current = false
      send('SUBMIT')
    }
  }, [send, state])

  useEffect(() => {
    if (!state.matches('longSession.solve.answer.keywords')) {
      setAutoReportDeadlineAt(null)
      return undefined
    }

    if (
      !autoReportEnabled ||
      autoReportRunning ||
      !autoReportDeadlineAt ||
      manualReportingStartedRef.current
    ) {
      return undefined
    }

    const remainingMs = autoReportDeadlineAt - Date.now()
    if (remainingMs <= 0) {
      runAutoReportReview()
      return undefined
    }

    const timeoutId = setTimeout(() => {
      runAutoReportReview()
    }, remainingMs)

    return () => {
      clearTimeout(timeoutId)
    }
  }, [
    autoReportDeadlineAt,
    autoReportEnabled,
    autoReportRunning,
    runAutoReportReview,
    state,
  ])

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
      if (typeof global.localAi.start === 'function') {
        const runtimeStart = await global.localAi.start({timeoutMs: 10000})
        const runtimeError = String(
          (runtimeStart &&
            (runtimeStart.lastError || runtimeStart.error || '')) ||
            ''
        ).trim()

        if (
          runtimeStart?.sidecarReachable !== true &&
          runtimeStart?.ok !== true
        ) {
          throw new Error(
            runtimeError ||
              'The configured Local AI runtime is not reachable yet.'
          )
        }
      }

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
                  'This is only a local test screen. It loads a few local sample flips, does not start a real validation session, and does not publish anything.'
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
                      isDisabled={autoReportRunning}
                      onClick={() => handleApproveWords(currentFlip.hash)}
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
                        isDisabled={autoReportRunning}
                        onClick={() => handleReportWords(currentFlip.hash)}
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
                {!aiProgress && aiProviderSetupError && (
                  <Text
                    fontSize="xs"
                    color={isShortSession(state) ? 'orange.200' : 'orange.500'}
                    maxW="sm"
                  >
                    {aiProviderSetupError}
                  </Text>
                )}
                <SecondaryButton
                  isDisabled={
                    !canRunAiSolve ||
                    aiProviderStatus.checking ||
                    Boolean(aiProviderSetupError)
                  }
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
                isDisabled={!canSubmit(state) || autoReportRunning}
                isLoading={isSubmitting(state) || autoReportRunning}
                loadingText={
                  autoReportRunning
                    ? t('AI reviewing...')
                    : t('Submitting answers...')
                }
                onClick={handleSubmit}
              >
                {t('Submit answers')}
              </PrimaryButton>
            ) : (
              <Tooltip label={t('Go to last flip')}>
                <PrimaryButton
                  isDisabled={!canSubmit(state) || autoReportRunning}
                  isLoading={isSubmitting(state) || autoReportRunning}
                  loadingText={
                    autoReportRunning
                      ? t('AI reviewing...')
                      : t('Submitting answers...')
                  }
                  onClick={handleSubmit}
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
          (state.matches('longSession.solve.answer.finishFlips') &&
            !(isSessionAutoMode && awaitingHumanReporting))
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
        onSubmit={handleSubmit}
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
        onSubmit={handleSubmit}
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
