/* eslint-disable react/prop-types */
import React, {useMemo, useEffect, useState, useRef, useCallback} from 'react'
import {useMachine} from '@xstate/react'
import {useRouter} from 'next/router'
import {useTranslation} from 'react-i18next'
import dayjs from 'dayjs'
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
  loadValidationStateForPeriod,
  filterRegularFlips,
  rearrangeFlips,
  readyFlip,
  isRenderableValidationFlip,
  hasRenderableValidationFlips,
  decodedWithKeywords,
  availableReportsNumber,
  solvableFlips,
  shouldPrepareValidationSession,
  buildValidationSessionScopeKey,
  buildValidationSessionNodeScope,
  buildValidationStateScope,
  isValidationCeremonyPeriod,
  canOpenValidationCeremonyLocalResults,
  getValidationSessionPhaseDeadlineAt,
  getValidationSessionPhaseRemainingMs,
  getValidationAutoReportDelayMs,
  getShortSessionLongSessionTransitionDelayMs,
  SHORT_SESSION_AUTO_SUBMIT_BUFFER_SECONDS,
  hasEnoughAnswers,
} from '../screens/validation/utils'
import {
  rememberDismissedValidationScreen,
  getRehearsalValidationBlockedReason,
  normalizeRehearsalDevnetStatus,
  hasAssignedRehearsalValidationHashes,
  REHEARSAL_DEVNET_STATUS_INITIAL,
  useValidationCeremonyReadiness,
} from '../screens/validation/hooks/use-start-validation'
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
  FailedFlip,
  FailedFlipAnnotation,
  ReviewValidationDialog,
  EncourageReportDialog,
  BadFlipDialog,
  SynchronizingValidationAlert,
  OfflineValidationAlert,
} from '../screens/validation/components'
import {rem} from '../shared/theme'
import {AnswerType, EpochPeriod, RelevanceType} from '../shared/types'
import {useEpochState} from '../shared/providers/epoch-context'
import {useIdentity} from '../shared/providers/identity-context'
import {useTimingState} from '../shared/providers/timing-context'
import {
  InfoButton,
  PrimaryButton,
  SecondaryButton,
} from '../shared/components/button'
import {Toast, Tooltip} from '../shared/components/components'
import {useChainState} from '../shared/providers/chain-context'
import {reorderList} from '../shared/utils/arr'
import {
  useSettingsDispatch,
  useSettingsState,
  isValidationRehearsalNodeSettings,
} from '../shared/providers/settings-context'
import {
  FullscreenIcon,
  HollowStarIcon,
  NewStarIcon,
} from '../shared/components/icons'
import {useAutoCloseValidationToast} from '../screens/validation/hooks/use-validation-toast'
import {
  estimateValidationAiSolveBudget,
  solveValidationSessionWithAi,
} from '../screens/validation/ai/solver-orchestrator'
import {appendValidationAiCostLedgerEntry} from '../screens/validation/ai-cost-tracker'
import {buildRehearsalNetworkPayload} from '../shared/utils/rehearsal-devnet'
import {
  checkAiProviderReadiness,
  formatMissingAiProviders,
  isLocalAiProvider,
  resolveLocalAiProviderState,
} from '../shared/utils/ai-provider-readiness'
import {prepareValidationSession} from '../shared/api/validation'
import {getNodeBridge} from '../shared/utils/node-bridge'
import {useInterval} from '../shared/hooks/use-interval'
import {
  getValidationAiSessionType,
  getValidationLongAiSolveStatus,
  getValidationReportKeywordStatus,
  shouldFinishLongSessionAiSolve,
  shouldWaitForValidationReportKeywords,
  shouldAllowSessionAutoMode,
  shouldBlockSessionAutoInDev,
  shouldAutoRunSessionForPeriod,
  shouldShowValidationAiUi,
  shouldShowValidationLocalAiUi,
} from '../shared/utils/validation-ai-auto'
import {
  computeRehearsalBenchmarkSummary,
  hasMissingRehearsalSeedMeta,
} from '../screens/validation/rehearsal-benchmark'

const previewAiSampleSet = require('../../samples/flips/flip-challenge-test-5-decoded-labeled.json')

const AUTO_REPORT_DEFAULT_DELAY_MINUTES = 10
const SESSION_AUTO_PROVIDER_RETRY_MS = 5 * 1000
const MIN_AUTO_REPORT_DELAY_MS = 15 * 1000
const AUTO_REPORT_KEYWORD_WAIT_MS = 20 * 1000
const AUTO_REPORT_KEYWORD_RETRY_MS = 5 * 1000
const LONG_SESSION_LOADING_GRACE_MS = 15 * 60 * 1000
const DEFAULT_AI_SOLVER_SETTINGS = {
  enabled: false,
  provider: 'openai',
  model: 'gpt-5.4',
  shortSessionOpenAiFastEnabled: false,
  shortSessionOpenAiFastModel: 'gpt-5.4-mini',
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
  const message = typeof error?.message === 'string' ? error.message.trim() : ''
  const eventType =
    error && typeof error === 'object' && typeof error.type === 'string'
      ? error.type.trim()
      : ''
  const eventSource = String(
    error?.target?.currentSrc ||
      error?.target?.src ||
      error?.currentTarget?.currentSrc ||
      error?.currentTarget?.src ||
      ''
  ).trim()
  let eventMessage = ''

  if (eventType === 'error') {
    eventMessage = eventSource
      ? `Unable to load validation flip image (${eventSource})`
      : 'Unable to load validation flip image'
  } else if (eventType) {
    eventMessage = eventType
  }

  const raw = String(
    message ||
      eventMessage ||
      (typeof error === 'string' ? error : '') ||
      (typeof error?.code === 'string' ? error.code : '')
  ).trim()
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

function createLocalAiRuntimeStatusState() {
  return {
    checked: false,
    checking: false,
    available: false,
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

function buildShortSessionFastModeNotice({fastMode, t}) {
  if (!fastMode || fastMode.requested !== true) {
    return null
  }

  const missingParameters = Array.isArray(fastMode.missingRequestedParameters)
    ? fastMode.missingRequestedParameters.join(', ')
    : ''

  if (fastMode.compatibilityFallbackUsed) {
    return {
      title: t('Short-session fast mode fell back to normal OpenAI mode'),
      description: missingParameters
        ? t(
            'OpenAI did not accept the fast-lane request shape ({{params}}). This short session now continues on the normal OpenAI plan. Long session stays on the normal plan too.',
            {
              params: missingParameters,
            }
          )
        : t(
            'OpenAI did not accept the fast-lane request shape. This short session now continues on the normal OpenAI plan. Long session stays on the normal plan too.'
          ),
    }
  }

  if (fastMode.priorityDowngraded) {
    return {
      title: t('OpenAI served standard tier during short-session fast mode'),
      description: t(
        'At least one fast short-session request was handled without Priority. Solving continued automatically, and long session stays on the normal plan.'
      ),
    }
  }

  return null
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

function getValidationConnectionAlertMessage({
  currentPeriod,
  offline = false,
  syncing = false,
  peersCount = 0,
  t,
}) {
  if (offline) {
    if (currentPeriod === EpochPeriod.LongSession) {
      return t(
        'Connection to the node was lost. If it returns before long session ends, validation can resume automatically.'
      )
    }

    return t(
      'Connection to the node was lost. If it returns before short session ends, validation can continue. If short session expires first, this validation may no longer be recoverable.'
    )
  }

  if (syncing || !Number.isFinite(peersCount) || peersCount < 1) {
    if (currentPeriod === EpochPeriod.LongSession) {
      return t(
        'The node is reconnecting to validation peers. Stay on this screen and long session will resume automatically once synchronization returns.'
      )
    }

    return t(
      'The node is reconnecting to validation peers. Recovery is only safe while short session time still remains.'
    )
  }

  return ''
}

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

function applyAiAnswerOptionsToFlips(flips = [], answers = []) {
  const answerOptionsByHash = new Map(
    (Array.isArray(answers) ? answers : [])
      .filter((answer) => answer && answer.hash)
      .map((answer) => [answer.hash, answer.option])
  )

  return (Array.isArray(flips) ? flips : []).map((flip) =>
    answerOptionsByHash.has(flip.hash)
      ? {
          ...flip,
          option: answerOptionsByHash.get(flip.hash),
        }
      : flip
  )
}

function getDecodedRegularAnswerStats(flips = []) {
  const regularFlips = filterRegularFlips(
    Array.isArray(flips) ? flips : []
  ).filter((flip) => flip && flip.failed !== true)
  const decodedRegularFlips = regularFlips.filter(
    (flip) => flip.decoded === true
  )
  const answered = decodedRegularFlips.filter((flip) => Number(flip.option) > 0)

  return {
    regularTotal: regularFlips.length,
    total: decodedRegularFlips.length,
    answered: answered.length,
    allAnswered:
      regularFlips.length > 0 &&
      decodedRegularFlips.length === regularFlips.length &&
      answered.length === decodedRegularFlips.length,
  }
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
  const {loading, offline, syncing, peersCount} = useChainState()

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

  if (
    epoch &&
    timing &&
    timing.shortSession &&
    isValidationCeremonyPeriod(epoch.currentPeriod)
  )
    return (
      <ValidationSession
        key={`validation-${epoch.epoch}-${new Date(
          epoch.nextValidation
        ).getTime()}-${
          epoch.currentPeriod === EpochPeriod.LongSession ? 'long' : 'short'
        }`}
        epoch={epoch.epoch}
        currentPeriod={epoch.currentPeriod}
        validationStart={new Date(epoch.nextValidation).getTime()}
        shortSessionDuration={timing.shortSession}
        longSessionDuration={timing.longSession}
        initialValidationPeriod={
          epoch.currentPeriod === EpochPeriod.LongSession ? 'long' : 'short'
        }
      />
    )

  let validationBootstrapMessage =
    'Waiting for the validation route to receive ceremony timing data from the connected node...'

  if (offline) {
    validationBootstrapMessage =
      'The connected node is temporarily unavailable. Stay on this screen while the connection recovers, or go back and reconnect the rehearsal node.'
  } else if (loading) {
    validationBootstrapMessage =
      'Loading ceremony timing and identity data from the connected node...'
  } else if (epoch?.currentPeriod === 'FlipLottery') {
    validationBootstrapMessage =
      'Validation has not started yet. Stay on the countdown screen until the short session begins.'
  } else if (epoch?.currentPeriod === 'AfterLongSession') {
    validationBootstrapMessage =
      'This validation session has already moved past the answer phases. Open the validation status screen instead.'
  } else if (syncing) {
    validationBootstrapMessage =
      'Waiting for the connected node to finish synchronization before validation can start...'
  } else if (Number.isFinite(peersCount) && peersCount < 1) {
    validationBootstrapMessage =
      'Waiting for the connected node to discover ceremony peers...'
  }

  return (
    <ValidationScene>
      <Flex flex={1} align="center" justify="center">
        <Stack spacing={4} align="center" maxW={rem(520)} textAlign="center">
          <Title>Preparing validation session</Title>
          <Text color="xwhite.050">{validationBootstrapMessage}</Text>
          <SecondaryButton onClick={() => router.push('/home')}>
            Back to home
          </SecondaryButton>
        </Stack>
      </Flex>
    </ValidationScene>
  )
}

function ValidationSession({
  epoch,
  currentPeriod = EpochPeriod.ShortSession,
  validationStart,
  shortSessionDuration,
  longSessionDuration,
  initialValidationPeriod = 'short',
  forceAiPreview = false,
}) {
  const router = useRouter()

  const {t, i18n} = useTranslation()
  const toast = useToast()
  const settings = useSettingsState()
  const {updateAiSolverSettings} = useSettingsDispatch()
  const [identity] = useIdentity()
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
  const [localAiRuntimeStatus, setLocalAiRuntimeStatus] = useState(() =>
    createLocalAiRuntimeStatusState()
  )
  const [shortSessionFastModeNotice, setShortSessionFastModeNotice] =
    useState(null)
  const [
    shortSessionOpenAiFastSuppressed,
    setShortSessionOpenAiFastSuppressed,
  ] = useState(false)
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
  const autoSolveLongSignatureRef = useRef('')
  const missingOnchainAutoSubmitConsentNotifiedRef = useRef(false)
  const shortSessionDecodeRecoveryAttemptedRef = useRef(false)
  const longSessionDecodeRecoveryAttemptedRef = useRef(false)
  const manualReportingStartedRef = useRef(false)
  const autoReportSubmitPendingRef = useRef(false)
  const autoReportKeywordWaitStartedAtRef = useRef(null)
  const autoReportKeywordWaitNotifiedRef = useRef(false)
  const localAiCaptureSyncRef = useRef({})
  const preparedValidationSessionRef = useRef({
    epoch: null,
    sessionId: null,
    prepareScopeKey: null,
  })
  const previewShortFlips = useMemo(
    () => (forceAiPreview ? createPreviewAiShortFlips() : []),
    [forceAiPreview]
  )
  const validationNodeScope = useMemo(
    () =>
      buildValidationSessionNodeScope({
        runInternalNode: settings.runInternalNode,
        useExternalNode: settings.useExternalNode,
        url: settings.url,
        internalPort: settings.internalPort,
      }),
    [
      settings.internalPort,
      settings.runInternalNode,
      settings.url,
      settings.useExternalNode,
    ]
  )
  const validationStateScope = useMemo(
    () =>
      buildValidationStateScope({
        epoch,
        address: identity?.address,
        nodeScope: validationNodeScope,
        validationStart,
      }),
    [epoch, identity?.address, validationNodeScope, validationStart]
  )
  const validationReadiness = useValidationCeremonyReadiness()
  const {validationSessionId, rememberLiveValidationSessionId} =
    validationReadiness
  const isRehearsalNodeSession = isValidationRehearsalNodeSettings(settings)

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
      validationSessionId,
      initialValidationPeriod,
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

  const restoredValidationState = useMemo(
    () =>
      forceAiPreview || !validationStateScope
        ? undefined
        : loadValidationStateForPeriod(currentPeriod, validationStateScope) ||
          undefined,
    [currentPeriod, forceAiPreview, validationStateScope]
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
    state: restoredValidationState,
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
  const canOpenLocalResultsShortcut =
    canOpenValidationCeremonyLocalResults(state)

  useEffect(() => {
    if (validationSessionId) {
      send({type: 'SET_VALIDATION_SESSION_ID', sessionId: validationSessionId})
    }
  }, [send, validationSessionId])

  let currentValidationPeriod = null
  if (state.matches('shortSession')) {
    currentValidationPeriod = 'ShortSession'
  } else if (state.matches('longSession')) {
    currentValidationPeriod = 'LongSession'
  }

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
    if (validationStateScope) {
      persistValidationState(state, validationStateScope)
    }
  }, [forceAiPreview, state, validationStateScope])

  useEffect(() => {
    const preparedSessionId = preparedValidationSessionRef.current.sessionId
    const hasPreparedSessionForScope =
      preparedValidationSessionRef.current.epoch === epoch &&
      preparedValidationSessionRef.current.prepareScopeKey ===
        validationReadiness.validationPrepareScopeKey &&
      (validationSessionId
        ? preparedSessionId === validationSessionId
        : Boolean(preparedSessionId))

    if (
      forceAiPreview ||
      !validationReadiness.rpcReady ||
      hasPreparedSessionForScope ||
      !shouldPrepareValidationSession(
        {
          epoch,
          currentPeriod: currentValidationPeriod,
        },
        identity,
        {
          isRehearsalNodeSession,
        }
      )
    ) {
      return
    }

    let ignore = false
    const requestedSessionId = String(validationSessionId || '')

    prepareValidationSession(epoch, requestedSessionId)
      .then((result) => {
        if (ignore) return

        const activeSessionId =
          (result && result.sessionId) || requestedSessionId

        if (activeSessionId) {
          rememberLiveValidationSessionId(activeSessionId)
          send({type: 'SET_VALIDATION_SESSION_ID', sessionId: activeSessionId})
        }

        preparedValidationSessionRef.current = {
          epoch,
          sessionId: activeSessionId,
          prepareScopeKey: validationReadiness.validationPrepareScopeKey,
        }
      })
      .catch((error) => {
        if (!ignore) {
          global.logger.error(
            'Unable to refresh live validation session',
            error && error.message ? error.message : error
          )
        }
      })

    return () => {
      ignore = true
    }
  }, [
    currentValidationPeriod,
    epoch,
    forceAiPreview,
    identity,
    rememberLiveValidationSessionId,
    send,
    validationReadiness.validationPrepareScopeKey,
    validationReadiness.rpcReady,
    validationSessionId,
    isRehearsalNodeSession,
  ])

  const {
    isOpen: isOpenEncourageReportDialog,
    onOpen: onOpenEncourageReportDialog,
    onClose: onCloseEncourageReportDialog,
  } = useDisclosure()

  React.useEffect(() => {
    if (didReport) onOpenEncourageReportDialog()
  }, [didReport, onOpenEncourageReportDialog])

  const {loading, syncing, offline, peersCount} = useChainState()
  const validationConnectionInterrupted =
    loading ||
    offline ||
    syncing ||
    !Number.isFinite(peersCount) ||
    peersCount < 1
  const hadValidationConnectionLossRef = useRef(false)

  const flips = sessionFlips(state)
  const currentFlip = flips[currentIndex]
  const displayIndex = flips.length
    ? Math.min(currentIndex + 1, flips.length)
    : 0
  const hasRenderableCurrentFlip = Boolean(currentFlip && currentFlip.hash)
  const [rehearsalDevnetStatus, setRehearsalDevnetStatus] = useState(
    REHEARSAL_DEVNET_STATUS_INITIAL
  )
  const rehearsalFlipFetchStuck =
    isRehearsalNodeSession &&
    !forceAiPreview &&
    !hasRenderableCurrentFlip &&
    state.matches('shortSession') &&
    validationStart &&
    dayjs().diff(dayjs(validationStart), 'second') >= 20
  const rehearsalBlockedReason = getRehearsalValidationBlockedReason({
    currentPeriod,
    devnetStatus: rehearsalDevnetStatus,
    isRehearsalNodeSession,
  })
  const shouldOfferRehearsalRestart =
    isRehearsalNodeSession &&
    !forceAiPreview &&
    !hasRenderableCurrentFlip &&
    rehearsalBlockedReason === 'failed-rehearsal'
  const rehearsalWaitingForHashAssignment =
    isRehearsalNodeSession &&
    !forceAiPreview &&
    !hasRenderableCurrentFlip &&
    state.matches('shortSession') &&
    rehearsalDevnetStatus.active &&
    !hasAssignedRehearsalValidationHashes({
      currentPeriod,
      devnetStatus: rehearsalDevnetStatus,
      isRehearsalNodeSession,
    })
  const rehearsalWaitingForKeys =
    isRehearsalNodeSession &&
    !forceAiPreview &&
    !hasRenderableCurrentFlip &&
    rehearsalBlockedReason === 'keys-not-ready' &&
    !shouldOfferRehearsalRestart
  const rehearsalRestartMessage = rehearsalFlipFetchStuck
    ? t(
        'This rehearsal run still has no ready validation flips well into short session. Restart the rehearsal network for a fresh run.'
      )
    : t(
        'This rehearsal run still never produced a ready flip after short session began. Restart the rehearsal network for a fresh run.'
      )
  const rehearsalWaitingMessage = t(
    'Rehearsal node is connected, but validation hashes are not assigned yet. IdenaAI will keep waiting for the rehearsal node to assign them.'
  )
  const rehearsalKeysWaitingMessage = t(
    'Rehearsal node is connected, but public flip keys and decryption packages are still syncing. IdenaAI will keep waiting until at least one rehearsal flip is actually ready.'
  )
  let waitingForCurrentFlipMessage = t(
    'Waiting for validation flips to become available...'
  )

  if (rehearsalWaitingForHashAssignment) {
    waitingForCurrentFlipMessage = rehearsalWaitingMessage
  } else if (rehearsalWaitingForKeys) {
    waitingForCurrentFlipMessage = rehearsalKeysWaitingMessage
  }

  if (shouldOfferRehearsalRestart) {
    waitingForCurrentFlipMessage = rehearsalRestartMessage
  }

  const localAiValidationEnabled = settings.localAi?.enabled === true
  const localAiCheckerAvailable =
    localAiValidationEnabled &&
    global.localAi &&
    typeof global.localAi.checkFlipSequence === 'function'
  const localAiRuntimeAvailable =
    localAiRuntimeStatus.checked && localAiRuntimeStatus.available
  const canCheckCurrentFlipWithLocalAi =
    shouldShowValidationLocalAiUi({
      runtimeReady: localAiRuntimeAvailable,
      checkerAvailable: localAiCheckerAvailable,
    }) &&
    (isShortSession(state) || isLongSessionFlips(state)) &&
    hasLocalAiValidationSequences(currentFlip)
  const captureSessionType = getLocalAiCaptureSessionType(state)

  const flipTimerDetails = {
    isShortSession: isShortSession(state),
    validationStart,
    shortSessionDuration,
    longSessionDuration,
  }
  const isRealSessionAutoBlockedInDev = shouldBlockSessionAutoInDev({
    isDev: global.isDev,
    forceAiPreview,
    isRehearsalNodeSession,
  })

  const [bestRewardTipOpen, setBestRewardTipOpen] = useState(false)
  useEffect(() => {
    if (currentFlip && currentFlip.relevance === RelevanceType.Relevant) {
      setBestRewardTipOpen(true)
    }
  }, [currentFlip])

  const handleRestartRehearsalNetwork = useCallback(() => {
    const validationScopeKey = buildValidationSessionScopeKey({
      epoch,
      address: identity?.address,
      nodeScope: buildValidationSessionNodeScope({
        runInternalNode: settings.runInternalNode,
        useExternalNode: settings.useExternalNode,
        url: settings.url,
        internalPort: settings.internalPort,
      }),
      validationStart,
    })

    rememberDismissedValidationScreen({
      scopeKey: validationScopeKey,
      reason: 'failed-rehearsal',
    })

    getNodeBridge().restartValidationDevnet(
      buildRehearsalNetworkPayload({
        connectApp: true,
      })
    )
    router.push('/settings/node')
  }, [
    epoch,
    identity?.address,
    router,
    settings.internalPort,
    settings.runInternalNode,
    settings.url,
    settings.useExternalNode,
    validationStart,
  ])

  const handleLeaveFailedRehearsal = useCallback(() => {
    const validationScopeKey = buildValidationSessionScopeKey({
      epoch,
      address: identity?.address,
      nodeScope: buildValidationSessionNodeScope({
        runInternalNode: settings.runInternalNode,
        useExternalNode: settings.useExternalNode,
        url: settings.url,
        internalPort: settings.internalPort,
      }),
      validationStart,
    })

    rememberDismissedValidationScreen({
      scopeKey: validationScopeKey,
      reason: 'failed-rehearsal',
    })

    router.push('/settings/node')
  }, [
    epoch,
    identity?.address,
    router,
    settings.internalPort,
    settings.runInternalNode,
    settings.url,
    settings.useExternalNode,
    validationStart,
  ])

  useEffect(() => {
    if (!isRehearsalNodeSession || getNodeBridge().__idenaFallback) {
      setRehearsalDevnetStatus(REHEARSAL_DEVNET_STATUS_INITIAL)
      return undefined
    }

    const bridge = getNodeBridge()

    bridge.getValidationDevnetStatus()

    return bridge.onEvent((event, data) => {
      if (event === 'validation-devnet-status') {
        setRehearsalDevnetStatus(normalizeRehearsalDevnetStatus(data))
      }
    })
  }, [isRehearsalNodeSession])

  useInterval(
    () => {
      if (isRehearsalNodeSession && !getNodeBridge().__idenaFallback) {
        getNodeBridge().getValidationDevnetStatus()
      }
    },
    isRehearsalNodeSession &&
      (state.matches('shortSession') || state.matches('longSession'))
      ? 1000
      : null
  )

  useEffect(() => {
    if (!isRehearsalNodeSession) {
      return
    }

    const seedFlipMetaByHash = rehearsalDevnetStatus.seedFlipMetaByHash || {}

    if (
      !Object.keys(seedFlipMetaByHash).length ||
      (!hasMissingRehearsalSeedMeta(
        state.context?.shortFlips,
        seedFlipMetaByHash
      ) &&
        !hasMissingRehearsalSeedMeta(
          state.context?.longFlips,
          seedFlipMetaByHash
        ))
    ) {
      return
    }

    send({
      type: 'MERGE_REHEARSAL_BENCHMARK_META',
      metaByHash: seedFlipMetaByHash,
    })
  }, [
    isRehearsalNodeSession,
    rehearsalDevnetStatus.seedFlipMetaByHash,
    send,
    state.context?.longFlips,
    state.context?.shortFlips,
  ])

  const rehearsalBenchmarkSummary = useMemo(
    () =>
      isRehearsalNodeSession ? computeRehearsalBenchmarkSummary(state) : null,
    [isRehearsalNodeSession, state]
  )

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
    if (isRealSessionAutoBlockedInDev) {
      toast({
        render: () => (
          <Toast
            title={t('Automatic session solving is blocked in dev mode')}
            description={t(
              'Use the off-chain preview flow while developing. Real ceremony auto-start and auto-solve stay disabled in the dev build, but rehearsal sessions can still run automatically.'
            )}
            status="warning"
          />
        ),
      })
      return
    }

    updateAiSolverSettings({
      enabled: true,
      mode: 'session-auto',
      onchainAutoSubmitConsentAt: new Date().toISOString(),
    })
    toast({
      render: () => (
        <Toast
          title={t('Automatic AI solving enabled')}
          description={t(
            'The next real validation session will auto-start AI solving and may submit answers on-chain automatically.'
          )}
          status="success"
        />
      ),
    })
    router.push('/settings/ai')
  }, [isRealSessionAutoBlockedInDev, router, t, toast, updateAiSolverSettings])

  const aiSessionType = getValidationAiSessionType({
    state,
    submitting: isSubmitting(state),
    hasRenderableLongFlips: hasRenderableValidationFlips(
      state.context?.longFlips || []
    ),
  })

  const canAutoRunAiSolveForCurrentPeriod = shouldAutoRunSessionForPeriod({
    aiSessionType,
    currentPeriod,
    forceAiPreview,
  })
  const hasSessionAutoSubmitConsent = shouldAllowSessionAutoMode({
    aiSolver: aiSolverSettings,
    forceAiPreview,
    isRehearsalNodeSession,
  })
  const needsOnchainAutoSubmitConsent =
    !forceAiPreview &&
    !isRehearsalNodeSession &&
    aiSolverSettings.enabled &&
    aiSolverSettings.mode === 'session-auto' &&
    !hasSessionAutoSubmitConsent

  const isSessionAutoMode =
    !isRealSessionAutoBlockedInDev &&
    aiSolverSettings.enabled &&
    aiSolverSettings.mode === 'session-auto' &&
    hasSessionAutoSubmitConsent
  const autoReportDelayMinutes = Math.max(
    1,
    Number(aiSolverSettings.autoReportDelayMinutes) ||
      AUTO_REPORT_DEFAULT_DELAY_MINUTES
  )
  const autoReportEnabled =
    isSessionAutoMode &&
    aiSolverSettings.autoReportEnabled === true &&
    !forceAiPreview

  useEffect(() => {
    if (!needsOnchainAutoSubmitConsent) {
      missingOnchainAutoSubmitConsentNotifiedRef.current = false
      return
    }

    if (missingOnchainAutoSubmitConsentNotifiedRef.current) {
      return
    }

    missingOnchainAutoSubmitConsentNotifiedRef.current = true
    notifyAi(
      t('On-chain autosolver needs confirmation'),
      t(
        'Open AI settings and choose auto-run again to confirm that AI may submit validation answers on-chain automatically.'
      ),
      'warning'
    )
  }, [needsOnchainAutoSubmitConsent, notifyAi, t])

  useEffect(() => {
    if (forceAiPreview) {
      return
    }

    if (validationConnectionInterrupted) {
      hadValidationConnectionLossRef.current = true
      return
    }

    if (!hadValidationConnectionLossRef.current) {
      return
    }

    hadValidationConnectionLossRef.current = false

    if (currentPeriod === EpochPeriod.ShortSession) {
      autoSolveStartedRef.current.short = false
    }

    if (currentPeriod === EpochPeriod.LongSession) {
      autoSolveStartedRef.current.long = false
    }

    if (['shortSession', 'longSession'].some(state.matches)) {
      send('REFETCH_FLIPS')
    }

    if (isSessionAutoMode) {
      notifyAi(
        currentPeriod === EpochPeriod.LongSession
          ? t('Validation connection recovered')
          : t('Short session connection recovered'),
        currentPeriod === EpochPeriod.LongSession
          ? t(
              'Node connectivity is back. Long session will refetch flips and resume automatically.'
            )
          : t(
              'Node connectivity is back. Short session is refetching flips now, but recovery still depends on the remaining short-session time.'
            )
      )
    }
  }, [
    currentPeriod,
    forceAiPreview,
    isSessionAutoMode,
    notifyAi,
    send,
    state,
    t,
    validationConnectionInterrupted,
  ])

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

  const refreshLocalAiRuntimeStatus = useCallback(async () => {
    if (!localAiCheckerAvailable) {
      const nextState = createLocalAiRuntimeStatusState()
      setLocalAiRuntimeStatus(nextState)
      return nextState
    }

    setLocalAiRuntimeStatus((prev) => ({
      ...prev,
      checking: true,
      error: '',
    }))

    try {
      const nextState = await resolveLocalAiProviderState({
        localBridge: global.localAi,
        localAi: settings.localAi,
      })
      const normalizedState = {
        checked: true,
        checking: false,
        available: Boolean(nextState?.hasKey),
        error: String(nextState?.error || '').trim(),
      }
      setLocalAiRuntimeStatus(normalizedState)
      return normalizedState
    } catch (error) {
      const fallbackState = {
        checked: true,
        checking: false,
        available: false,
        error: String((error && error.message) || error || '').trim(),
      }
      setLocalAiRuntimeStatus(fallbackState)
      return fallbackState
    }
  }, [localAiCheckerAvailable, settings.localAi])

  useEffect(() => {
    refreshAiProviderStatus()
  }, [refreshAiProviderStatus])

  useEffect(() => {
    refreshLocalAiRuntimeStatus()
  }, [refreshLocalAiRuntimeStatus])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined
    }

    const refreshOnFocus = () => {
      refreshAiProviderStatus()
      refreshLocalAiRuntimeStatus()
    }

    window.addEventListener('focus', refreshOnFocus)
    document.addEventListener('visibilitychange', refreshOnFocus)

    return () => {
      window.removeEventListener('focus', refreshOnFocus)
      document.removeEventListener('visibilitychange', refreshOnFocus)
    }
  }, [refreshAiProviderStatus, refreshLocalAiRuntimeStatus])

  const aiProviderSetupReady =
    !aiSolverSettings.enabled ||
    (aiProviderStatus.checked && aiProviderStatus.allReady)
  const showValidationAiUi = shouldShowValidationAiUi({
    enabled: aiSolverSettings.enabled,
    providerReady: aiProviderSetupReady,
  })
  const longSessionAiSolveStatus = useMemo(
    () =>
      getValidationLongAiSolveStatus({
        longFlips: state.context?.longFlips || [],
      }),
    [state]
  )
  const longSessionAutoSolveSignature =
    longSessionAiSolveStatus.decodedUnansweredHashes.join(',')
  const renderableSessionFlipsAvailable = useMemo(
    () => hasRenderableValidationFlips(sessionFlips(state)),
    [state]
  )
  const canRunAiSolve =
    aiSolverSettings.enabled &&
    Boolean(aiSessionType) &&
    aiProviderSetupReady &&
    renderableSessionFlipsAvailable

  useInterval(
    () => {
      if (!aiProviderStatus.checking) {
        refreshAiProviderStatus()
      }
    },
    isSessionAutoMode &&
      !forceAiPreview &&
      !aiProviderSetupReady &&
      !validationConnectionInterrupted
      ? SESSION_AUTO_PROVIDER_RETRY_MS
      : null
  )

  const runAiSolve = useCallback(async () => {
    if (!canRunAiSolve || aiSolving || !aiSessionType) return

    const sessionType = aiSessionType

    try {
      const solveAiSettings =
        sessionType === 'short' && shortSessionOpenAiFastSuppressed
          ? {
              ...aiSolverSettings,
              shortSessionOpenAiFastEnabled: false,
            }
          : aiSolverSettings
      const displayFlips = sessionFlips(state)
      const solveDeadlineAt = getValidationSessionPhaseDeadlineAt({
        validationStart,
        shortSessionDuration,
        longSessionDuration,
        sessionType,
      })
      const remainingSolveMs = getValidationSessionPhaseRemainingMs({
        validationStart,
        shortSessionDuration,
        longSessionDuration,
        sessionType,
      })
      const solveBudget = estimateValidationAiSolveBudget({
        sessionType,
        shortFlips: state.context.shortFlips,
        longFlips: state.context.longFlips,
        aiSolver: solveAiSettings,
      })
      const indexByHash = new Map(
        displayFlips.map((flip, index) => [flip.hash, index])
      )
      const firstRenderableFlip = displayFlips.find(isRenderableValidationFlip)

      if (firstRenderableFlip) {
        const pickIndex = indexByHash.get(firstRenderableFlip.hash)
        if (Number.isFinite(pickIndex)) {
          send({type: 'PICK', index: pickIndex})
        }
      }

      setAiSolving(true)
      setAiProgress(t('Preparing flip payloads...'))
      setAiLiveTimeline([])
      setAiActiveFlip(null)
      setAiLastRun({
        status: 'running',
        sessionType,
        provider: solveAiSettings.provider,
        model: solveBudget.model,
        startedAt: new Date().toISOString(),
      })

      const readiness = await refreshAiProviderStatus()
      if (!readiness.allReady) {
        const readinessError = new Error(
          formatAiProviderReadinessError(readiness, t)
        )
        readinessError.code = 'provider_not_ready'
        throw readinessError
      }

      if (!Number.isFinite(remainingSolveMs) || remainingSolveMs <= 0) {
        const expiredError = new Error(
          t(
            sessionType === 'long'
              ? 'Long session is already too close to its submission cutoff for AI solving.'
              : 'Short session is already too close to its submission cutoff for AI solving.'
          )
        )
        expiredError.code = 'session_window_too_small'
        throw expiredError
      }

      if (solveBudget.flipCount < 1) {
        throw new Error(t('No solvable flips are available for AI helper.'))
      }

      if (
        sessionType !== 'short' &&
        solveBudget.estimatedMs > remainingSolveMs
      ) {
        const timingError = new Error(
          t(
            sessionType === 'long'
              ? 'Not enough long-session time remains for a reliable AI run. Need about {{need}} seconds, but only {{have}} seconds remain before submission cutoff.'
              : 'Not enough short-session time remains for a reliable AI run. Need about {{need}} seconds, but only {{have}} seconds remain before automatic submission.',
            {
              need: Math.ceil(solveBudget.estimatedMs / 1000),
              have: Math.max(0, Math.floor(remainingSolveMs / 1000)),
            }
          )
        )
        timingError.code = 'session_window_too_small'
        throw timingError
      }

      const liveEntries = []
      const result = await solveValidationSessionWithAi({
        sessionType,
        shortFlips: state.context.shortFlips,
        longFlips: state.context.longFlips,
        aiSolver: solveAiSettings,
        sessionMeta: {
          epoch,
          sessionType,
          startedAt: new Date().toISOString(),
        },
        hardDeadlineAt: solveDeadlineAt,
        onProgress: (event) => {
          if (event.stage === 'prepared') {
            setAiProgress(
              t('Preparing flip payloads: {{current}}/{{total}}', {
                current: event.index,
                total: event.total,
              })
            )
            setAiActiveFlip({
              hash: event.hash,
              leftImage: event.leftImage,
              rightImage: event.rightImage,
              words: event.words,
              expectedAnswer: event.expectedAnswer,
              expectedStrength: event.expectedStrength,
              consensusAnswer: event.consensusAnswer,
              consensusStrength: event.consensusStrength,
              consensusVotes: event.consensusVotes,
              sourceDataset: event.sourceDataset,
              sourceSplit: event.sourceSplit,
              sourceStats: event.sourceStats,
              index: event.index,
              total: event.total,
              sessionType: event.sessionType,
            })
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
              words: event.words,
              expectedAnswer: event.expectedAnswer,
              expectedStrength: event.expectedStrength,
              consensusAnswer: event.consensusAnswer,
              consensusStrength: event.consensusStrength,
              consensusVotes: event.consensusVotes,
              sourceDataset: event.sourceDataset,
              sourceSplit: event.sourceSplit,
              sourceStats: event.sourceStats,
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
              words: event.words,
              expectedAnswer: event.expectedAnswer,
              expectedStrength: event.expectedStrength,
              consensusAnswer: event.consensusAnswer,
              consensusStrength: event.consensusStrength,
              consensusVotes: event.consensusVotes,
              sourceDataset: event.sourceDataset,
              sourceSplit: event.sourceSplit,
              sourceStats: event.sourceStats,
              answer: event.answer,
              latencyMs: event.latencyMs,
              confidence: event.confidence,
              error: event.error,
              tokenUsage: event.tokenUsage,
              costs: event.costs,
              reasoning: event.reasoning,
              uncertaintyRepromptUsed: event.uncertaintyRepromptUsed,
              forcedDecision: event.forcedDecision,
              forcedDecisionPolicy: event.forcedDecisionPolicy,
              forcedDecisionReason: event.forcedDecisionReason,
              secondPassStrategy: event.secondPassStrategy,
              firstPass: event.firstPass,
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
              words: event.words,
              expectedAnswer: event.expectedAnswer,
              expectedStrength: event.expectedStrength,
              consensusAnswer: event.consensusAnswer,
              consensusStrength: event.consensusStrength,
              consensusVotes: event.consensusVotes,
              sourceDataset: event.sourceDataset,
              sourceSplit: event.sourceSplit,
              sourceStats: event.sourceStats,
              rawAnswerBeforeRemap: event.rawAnswerBeforeRemap,
              finalAnswerAfterRemap: event.finalAnswerAfterRemap,
              sideSwapped: event.sideSwapped,
              tokenUsage: event.tokenUsage,
              costs: event.costs,
              reasoning: event.reasoning,
              uncertaintyRepromptUsed: event.uncertaintyRepromptUsed,
              forcedDecision: event.forcedDecision,
              forcedDecisionPolicy: event.forcedDecisionPolicy,
              forcedDecisionReason: event.forcedDecisionReason,
              secondPassStrategy: event.secondPassStrategy,
              firstPass: event.firstPass,
            }
            liveEntries.push(entry)
            setAiLiveTimeline((prev) => prev.concat(entry).slice(-24))
            setAiProgress(
              t(
                'Flip {{current}}/{{total}}: {{answer}} in {{latency}} ms{{suffix}}',
                {
                  current: event.index,
                  total: event.total,
                  answer: String(event.answer || 'skip').toUpperCase(),
                  latency: Number.isFinite(event.latencyMs)
                    ? event.latencyMs
                    : '-',
                  suffix: formatAiSolveProgressSuffix(event),
                }
              )
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

      if (sessionType === 'short') {
        const fastModeNotice = buildShortSessionFastModeNotice({
          fastMode: result.fastMode,
          t,
        })

        if (fastModeNotice) {
          setShortSessionFastModeNotice(fastModeNotice)
          notifyAi(fastModeNotice.title, fastModeNotice.description, 'warning')

          if (result.fastMode?.compatibilityFallbackUsed) {
            setShortSessionOpenAiFastSuppressed(true)
          }
        }
      }

      setAiLastRun({
        status: 'completed',
        sessionType,
        provider: result.provider,
        model: result.model,
        profile: result.profile,
        summary: result.summary,
        fastMode: result.fastMode,
        flips: result.results || [],
        appliedAnswers: result.answers.length,
        timeline: liveEntries.slice(-24),
        completedAt: new Date().toISOString(),
      })

      if (!forceAiPreview && validationStateScope) {
        appendValidationAiCostLedgerEntry(validationStateScope, {
          action:
            sessionType === 'short'
              ? 'short-session solve'
              : 'long-session solve',
          provider: result.provider || solveAiSettings.provider,
          model: result.model || solveBudget.model,
          sessionType,
          totalFlips: result.summary?.totalFlips,
          appliedAnswers: Array.isArray(result.answers)
            ? result.answers.length
            : 0,
          tokenUsage: result.summary?.tokens,
          estimatedUsd: result.summary?.costs?.estimatedUsd,
          actualUsd: result.summary?.costs?.actualUsd,
        })
      }

      if (sessionType === 'short' && !forceAiPreview) {
        const shortFlipsAfterAi = applyAiAnswerOptionsToFlips(
          state.context.shortFlips,
          result.answers
        )
        const answerStats = getDecodedRegularAnswerStats(shortFlipsAfterAi)
        const remainingShortSolveMs = getValidationSessionPhaseRemainingMs({
          validationStart,
          shortSessionDuration,
          longSessionDuration,
          sessionType: 'short',
        })
        const reachedSubmitCutoff =
          !Number.isFinite(remainingShortSolveMs) || remainingShortSolveMs <= 0

        if (
          result.answers.length > 0 &&
          (answerStats.allAnswered ||
            (reachedSubmitCutoff && hasEnoughAnswers(shortFlipsAfterAi)))
        ) {
          send('SUBMIT')
        } else if (
          result.answers.length > 0 &&
          isSessionAutoMode &&
          !reachedSubmitCutoff
        ) {
          autoSolveStartedRef.current.short = false
          notifyAi(
            t('AI short-session retry armed'),
            t(
              'AI answered {{answered}}/{{total}} decoded short flips. It will retry remaining flips until the final {{seconds}} seconds.',
              {
                answered: answerStats.answered,
                total: answerStats.total,
                seconds: SHORT_SESSION_AUTO_SUBMIT_BUFFER_SECONDS,
              }
            )
          )
        }
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
        const solvedHashes = result.answers.map(({hash}) => hash)
        const nextLongAiSolveStatus = getValidationLongAiSolveStatus({
          longFlips: state.context.longFlips,
          solvedHashes,
        })
        const longSessionStartedAt =
          dayjs(validationStart).valueOf() + shortSessionDuration * 1000
        const longSessionElapsedMs = Math.max(
          0,
          Date.now() - longSessionStartedAt
        )

        if (
          shouldFinishLongSessionAiSolve({
            longFlips: state.context.longFlips,
            solvedHashes,
            longSessionElapsedMs,
            loadingGraceMs: LONG_SESSION_LOADING_GRACE_MS,
          })
        ) {
          setAwaitingHumanReporting(true)
          send('FINISH_FLIPS')
        } else if (
          !nextLongAiSolveStatus.hasDecodedUnansweredFlips &&
          nextLongAiSolveStatus.hasLoadingFlips
        ) {
          autoSolveLongSignatureRef.current = ''
        }
      }
    } catch (error) {
      const errorMessage = formatErrorForToast(error)

      if (error?.code === 'provider_not_ready') {
        autoSolveStartedRef.current[sessionType] = false
        if (sessionType === 'long') {
          autoSolveLongSignatureRef.current = ''
        }
      }

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
    isSessionAutoMode,
    longSessionDuration,
    notifyAi,
    forceAiPreview,
    refreshAiProviderStatus,
    send,
    shortSessionDuration,
    state,
    t,
    validationStart,
    validationStateScope,
    shortSessionOpenAiFastSuppressed,
  ])

  const handleRunAiSolve = useCallback(() => {
    Promise.resolve()
      .then(() => runAiSolve())
      .catch((error) => {
        notifyAi(t('AI helper failed'), formatErrorForToast(error), 'error')
        setAiSolving(false)
        setAiProgress(null)
      })
  }, [notifyAi, runAiSolve, t])

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

  const submitLongSessionAutomatically = useCallback(
    ({title, description, status = 'info'} = {}) => {
      if (!state.matches('longSession.solve.answer.keywords')) {
        return
      }

      manualReportingStartedRef.current = false
      autoReportSubmitPendingRef.current = true
      setAutoReportDeadlineAt(null)
      notifyAi(
        title || t('Long session auto-submit armed'),
        description ||
          t(
            'AI finished the long-session flips. The app will submit the long-session answers automatically without extra report review.'
          ),
        status
      )

      send('SUBMIT_NOW')
    },
    [notifyAi, send, state, t]
  )

  const canRunAutomaticReportReview =
    autoReportEnabled &&
    global.aiSolver &&
    typeof global.aiSolver.reviewValidationReports === 'function' &&
    !isLocalAiProvider(aiSolverSettings.provider)

  const runAutoReportReview = useCallback(async () => {
    if (
      !autoReportEnabled ||
      autoReportRunning ||
      manualReportingStartedRef.current ||
      !state.matches('longSession.solve.answer.keywords')
    ) {
      return
    }

    if (!canRunAutomaticReportReview) {
      submitLongSessionAutomatically({
        title: t('AI report review skipped'),
        description: isLocalAiProvider(aiSolverSettings.provider)
          ? t(
              'Local AI does not support validation report review yet. Long-session answers will be submitted automatically without extra report decisions.'
            )
          : t(
              'Automatic report review is unavailable in this build. Long-session answers will be submitted automatically without extra report decisions.'
            ),
        status: 'warning',
      })
      return
    }

    setAutoReportRunning(true)
    setAutoReportDeadlineAt(null)

    try {
      const readiness = await refreshAiProviderStatus()
      if (!readiness.allReady) {
        throw new Error(formatAiProviderReadinessError(readiness, t))
      }

      const keywordStatus = getValidationReportKeywordStatus({
        state,
        longFlips,
      })
      const candidateSourceFlips = keywordStatus.keywordReadyFlips
      const waitedForKeywordsMs = autoReportKeywordWaitStartedAtRef.current
        ? Date.now() - autoReportKeywordWaitStartedAtRef.current
        : 0

      if (
        shouldWaitForValidationReportKeywords({
          keywordStatus,
          waitedMs: waitedForKeywordsMs,
          maxWaitMs: AUTO_REPORT_KEYWORD_WAIT_MS,
        })
      ) {
        setAutoReportDeadlineAt(Date.now() + AUTO_REPORT_KEYWORD_RETRY_MS)

        if (!autoReportKeywordWaitNotifiedRef.current) {
          autoReportKeywordWaitNotifiedRef.current = true
          notifyAi(
            t('Getting flip keywords'),
            candidateSourceFlips.length
              ? t(
                  'Automatic report review found {{ready}} keyword-ready flip(s), but is waiting briefly for {{missing}} more before making report decisions.',
                  {
                    ready: candidateSourceFlips.length,
                    missing: keywordStatus.missingKeywordFlipCount,
                  }
                )
              : t(
                  'Automatic report review is waiting for long-session keywords to load before making report decisions.'
                )
          )
        }

        return
      }

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
        submitLongSessionAutomatically({
          title: t('AI report review skipped'),
          description:
            keywordStatus.decodedFlipCount > 0
              ? t(
                  'Flip keywords are still unavailable, so automatic report review cannot run. Long-session answers will be submitted automatically without extra report decisions.'
                )
              : t(
                  'No keyword-ready flips are available for automatic report review. Long-session answers will be submitted automatically.'
                ),
        })
        return
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

      if (!forceAiPreview && validationStateScope) {
        appendValidationAiCostLedgerEntry(validationStateScope, {
          action: 'long-session report review',
          provider: reviewResult?.provider || aiSolverSettings.provider,
          model: reviewResult?.model || aiSolverSettings.model,
          sessionType: 'long-report-review',
          totalFlips:
            reviewResult?.summary?.totalFlips || candidateFlips.length,
          appliedAnswers: candidateSourceFlips.length,
          tokenUsage: reviewResult?.summary?.tokens,
          estimatedUsd: reviewResult?.summary?.costs?.estimatedUsd,
          actualUsd: reviewResult?.summary?.costs?.actualUsd,
        })
      }

      autoReportSubmitPendingRef.current = true

      notifyAi(
        t('AI auto-report completed'),
        keywordStatus.missingKeywordFlipCount > 0
          ? t(
              'Applied {{reported}} report decisions and {{approved}} approvals. Skipped {{skipped}} flip(s) with missing keywords. Long session answers will be submitted automatically.',
              {
                reported: reportHashSet.size,
                approved: Math.max(
                  0,
                  candidateSourceFlips.length - reportHashSet.size
                ),
                skipped: keywordStatus.missingKeywordFlipCount,
              }
            )
          : t(
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

      send('SUBMIT_NOW')
    } catch (error) {
      autoReportSubmitPendingRef.current = false
      notifyAi(t('AI auto-report failed'), formatErrorForToast(error), 'error')
      submitLongSessionAutomatically({
        title: t('Long session auto-submit fallback'),
        description: t(
          'Automatic report review failed, so the app will submit the long-session answers without extra report decisions.'
        ),
        status: 'warning',
      })
    } finally {
      setAutoReportRunning(false)
    }
  }, [
    aiConsultProviders,
    aiProviderConfig,
    aiSolverSettings,
    autoReportEnabled,
    autoReportRunning,
    canRunAutomaticReportReview,
    epoch,
    forceAiPreview,
    longFlips,
    notifyAi,
    refreshAiProviderStatus,
    send,
    state,
    submitLongSessionAutomatically,
    t,
    validationStateScope,
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

    if (isLongSessionFlips(state) || isLongSessionKeywords(state)) {
      beginManualReporting()
      send('SUBMIT_NOW')
      return
    }

    send('SUBMIT')
  }, [beginManualReporting, forceAiPreview, notifyAi, send, state, t])

  useEffect(() => {
    if (
      isSessionAutoMode &&
      canRunAiSolve &&
      aiSessionType === 'short' &&
      canAutoRunAiSolveForCurrentPeriod &&
      !autoSolveStartedRef.current.short
    ) {
      autoSolveStartedRef.current.short = true
      runAiSolve()
    }
  }, [
    aiSessionType,
    canAutoRunAiSolveForCurrentPeriod,
    canRunAiSolve,
    isSessionAutoMode,
    runAiSolve,
  ])

  useEffect(() => {
    if (
      currentPeriod !== EpochPeriod.LongSession ||
      !state.matches('longSession.solve.answer.flips')
    ) {
      autoSolveStartedRef.current.long = false
      autoSolveLongSignatureRef.current = ''
      return
    }

    if (
      !isSessionAutoMode ||
      !canRunAiSolve ||
      aiSessionType !== 'long' ||
      !canAutoRunAiSolveForCurrentPeriod ||
      aiSolving ||
      !longSessionAutoSolveSignature
    ) {
      return
    }

    if (autoSolveLongSignatureRef.current === longSessionAutoSolveSignature) {
      return
    }

    autoSolveStartedRef.current.long = true
    autoSolveLongSignatureRef.current = longSessionAutoSolveSignature
    runAiSolve()
  }, [
    aiSessionType,
    aiSolving,
    canAutoRunAiSolveForCurrentPeriod,
    canRunAiSolve,
    currentPeriod,
    isSessionAutoMode,
    longSessionAutoSolveSignature,
    runAiSolve,
    state,
  ])

  useEffect(() => {
    if (
      currentPeriod !== EpochPeriod.LongSession ||
      !state.matches('shortSession.solve.answer.submitShortSession.submitted')
    ) {
      return undefined
    }

    const remainingDelayMs = getShortSessionLongSessionTransitionDelayMs({
      validationStart: state.context.validationStart || validationStart,
      shortSessionDuration:
        state.context.shortSessionDuration || shortSessionDuration,
      shortSessionSubmittedAt: state.context.shortSessionSubmittedAt,
    })

    if (remainingDelayMs <= 0) {
      send('START_LONG_SESSION')
      return undefined
    }

    const timeoutId = setTimeout(() => {
      send('START_LONG_SESSION')
    }, remainingDelayMs)

    return () => {
      clearTimeout(timeoutId)
    }
  }, [currentPeriod, send, shortSessionDuration, state, validationStart])

  useEffect(() => {
    const shouldRecoverShortSessionDecodeState =
      !forceAiPreview &&
      currentPeriod === EpochPeriod.ShortSession &&
      state.matches('shortSession.fetch.done') &&
      state.matches('shortSession.solve') &&
      state.context.shortFlips.some(readyFlip) &&
      !hasRenderableValidationFlips(state.context.shortFlips)

    if (!shouldRecoverShortSessionDecodeState) {
      if (currentPeriod !== EpochPeriod.ShortSession) {
        shortSessionDecodeRecoveryAttemptedRef.current = false
      }
      return
    }

    if (shortSessionDecodeRecoveryAttemptedRef.current) {
      return
    }

    shortSessionDecodeRecoveryAttemptedRef.current = true
    autoSolveStartedRef.current.short = false
    send('REFETCH_FLIPS')
  }, [currentPeriod, forceAiPreview, send, state])

  useEffect(() => {
    const shouldRecoverLongSessionDecodeState =
      !forceAiPreview &&
      currentPeriod === EpochPeriod.LongSession &&
      state.matches('longSession.solve.answer.flips') &&
      state.matches('longSession.fetch.flips.done') &&
      state.context.longFlips.some(readyFlip) &&
      !hasRenderableValidationFlips(state.context.longFlips)

    if (!shouldRecoverLongSessionDecodeState) {
      if (currentPeriod !== EpochPeriod.LongSession) {
        longSessionDecodeRecoveryAttemptedRef.current = false
      }
      return
    }

    if (longSessionDecodeRecoveryAttemptedRef.current) {
      return
    }

    longSessionDecodeRecoveryAttemptedRef.current = true
    autoSolveStartedRef.current.long = false
    autoSolveLongSignatureRef.current = ''
    send('REFETCH_FLIPS')
  }, [currentPeriod, forceAiPreview, send, state])

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
    if (state.matches('longSession.solve.answer.keywords')) {
      if (!autoReportKeywordWaitStartedAtRef.current) {
        autoReportKeywordWaitStartedAtRef.current = Date.now()
      }
      return
    }

    autoReportKeywordWaitStartedAtRef.current = null
    autoReportKeywordWaitNotifiedRef.current = false
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
      const clampedDelayMs = getValidationAutoReportDelayMs({
        validationStart,
        shortSessionDuration,
        longSessionDuration,
        requestedDelayMinutes: autoReportDelayMinutes,
      })

      manualReportingStartedRef.current = existingSelections

      if (existingSelections) {
        notifyAi(
          t('Manual long-session reporting detected'),
          t(
            'Manual report choices are already in progress. Automatic long-session reporting will stay out of the way until you submit.'
          )
        )
      } else if (!autoReportEnabled || !canRunAutomaticReportReview) {
        const autoSubmitTitle = !autoReportEnabled
          ? t('Long session auto-submit armed')
          : t('AI report review unavailable')
        let autoSubmitDescription = t(
          'Delayed AI report review is off. The app will submit long-session answers automatically without extra report decisions.'
        )

        if (autoReportEnabled) {
          autoSubmitDescription = isLocalAiProvider(aiSolverSettings.provider)
            ? t(
                'Local AI cannot review report keywords yet. The app will submit long-session answers automatically without extra report decisions.'
              )
            : t(
                'This build cannot review report keywords automatically. The app will submit long-session answers automatically without extra report decisions.'
              )
        }

        submitLongSessionAutomatically({
          title: autoSubmitTitle,
          description: autoSubmitDescription,
          status: !autoReportEnabled ? 'info' : 'warning',
        })
      } else if (
        !Number.isFinite(clampedDelayMs) ||
        clampedDelayMs <= MIN_AUTO_REPORT_DELAY_MS
      ) {
        setAutoReportDeadlineAt(Date.now())

        notifyAi(
          t('Immediate AI auto-report armed'),
          t(
            'Long session is already close to its deadline. AI report review will start immediately if possible, then submit automatically.'
          )
        )
      } else {
        const deadlineAt = Date.now() + clampedDelayMs

        setAutoReportDeadlineAt(deadlineAt)

        notifyAi(
          t('Delayed AI auto-report armed'),
          t(
            'Automatic report review will start in about {{minutes}} minute(s) unless manual reporting begins first. The long session will still submit automatically afterward.',
            {
              minutes: Math.max(1, Math.ceil(clampedDelayMs / (60 * 1000))),
            }
          )
        )
      }

      setAwaitingHumanReporting(false)
    }
  }, [
    autoReportDelayMinutes,
    autoReportEnabled,
    awaitingHumanReporting,
    canRunAutomaticReportReview,
    aiSolverSettings.provider,
    longSessionDuration,
    longFlips,
    notifyAi,
    shortSessionDuration,
    state,
    submitLongSessionAutomatically,
    t,
    validationStart,
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
  }, [currentFlip?.hash, localAiRuntimeAvailable])

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

  const handleRunLocalAiRecommendation = useCallback(() => {
    Promise.resolve()
      .then(() => runLocalAiRecommendation())
      .catch((error) => {
        setLocalAiRecommendation({
          status: 'error',
          left: null,
          right: null,
          error: formatErrorForToast(error),
        })
        setIsCheckingLocalAiRecommendation(false)
      })
  }, [runLocalAiRecommendation])

  const handleToggleFullScreen = useCallback(() => {
    Promise.resolve()
      .then(() => global.toggleFullScreen?.())
      .catch((error) => {
        notifyAi(
          t('Fullscreen toggle failed'),
          formatErrorForToast(error),
          'warning'
        )
      })
  }, [notifyAi, t])

  useEffect(() => {
    if (aiSessionType !== 'short') {
      autoSolveStartedRef.current.short = false
      shortSessionDecodeRecoveryAttemptedRef.current = false
    }
    if (aiSessionType !== 'long') {
      autoSolveStartedRef.current.long = false
      longSessionDecodeRecoveryAttemptedRef.current = false
    }
  }, [aiSessionType])

  useEffect(() => {
    if (currentPeriod !== EpochPeriod.ShortSession) {
      setShortSessionFastModeNotice(null)
    }
  }, [currentPeriod])

  const validationConnectionAlertMessage = getValidationConnectionAlertMessage({
    currentPeriod,
    offline,
    syncing,
    peersCount,
    t,
  })
  const isAutoManagedValidation = isSessionAutoMode && !forceAiPreview
  const submitActionLabel = t(
    isAutoManagedValidation ? 'Submit now' : 'Submit answers'
  )
  const keywordActionLabel = t(
    isAutoManagedValidation ? 'Review reports now' : 'Start checking keywords'
  )
  let manualAiActionLabel = t('AI solve long session')

  if (isAutoManagedValidation) {
    manualAiActionLabel = t('Retry AI now')
  } else if (isShortSession(state)) {
    manualAiActionLabel = t('AI solve short session')
  }

  return (
    <ValidationScene bg={isShortSession(state) ? 'black' : 'white'}>
      <Flex
        align="center"
        justify="center"
        bg={showValidationAiUi ? 'orange.500' : 'blue.500'}
        color="white"
        py={1}
        fontSize="xs"
        fontWeight={600}
      >
        {showValidationAiUi
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

      {(syncing ||
        (!offline && (!Number.isFinite(peersCount) || peersCount < 1))) && (
        <SynchronizingValidationAlert>
          {validationConnectionAlertMessage || t('Synchronizing...')}
        </SynchronizingValidationAlert>
      )}

      {offline && (
        <OfflineValidationAlert>
          {validationConnectionAlertMessage || t('Offline')}
        </OfflineValidationAlert>
      )}

      {shortSessionFastModeNotice ? (
        <Box
          mb={4}
          px={4}
          py={3}
          borderWidth="1px"
          borderColor="orange.200"
          bg="orange.012"
          borderRadius="md"
        >
          <Flex
            align={['flex-start', 'center']}
            justify="space-between"
            direction={['column', 'row']}
            gap={3}
          >
            <Box>
              <Text fontWeight={600}>{shortSessionFastModeNotice.title}</Text>
              <Text color="muted" fontSize="sm">
                {shortSessionFastModeNotice.description}
              </Text>
            </Box>
            <SecondaryButton
              onClick={() => setShortSessionFastModeNotice(null)}
            >
              {t('Dismiss')}
            </SecondaryButton>
          </Flex>
        </Box>
      ) : null}

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
            {displayIndex}{' '}
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
            onClick={handleToggleFullScreen}
          />
        </Flex>
      </Header>
      <CurrentStep>
        <FlipChallenge>
          <Flex justify="center" align="center" position="relative">
            {hasRenderableCurrentFlip &&
              ((currentFlip.fetched && !currentFlip.decoded) ||
                currentFlip.failed) && (
                <FailedFlipAnnotation>
                  {t('No data available. Please skip the flip.')}
                </FailedFlipAnnotation>
              )}
            {hasRenderableCurrentFlip ? (
              <>
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
              </>
            ) : (
              <>
                <Stack spacing={4} align="center">
                  <FailedFlipAnnotation>
                    {waitingForCurrentFlipMessage}
                  </FailedFlipAnnotation>
                  {(shouldOfferRehearsalRestart ||
                    rehearsalWaitingForHashAssignment ||
                    rehearsalWaitingForKeys) && (
                    <Stack isInline spacing={2}>
                      {shouldOfferRehearsalRestart && (
                        <PrimaryButton onClick={handleRestartRehearsalNetwork}>
                          {t('Restart fresh rehearsal')}
                        </PrimaryButton>
                      )}
                      <SecondaryButton onClick={handleLeaveFailedRehearsal}>
                        {t('Back to node settings')}
                      </SecondaryButton>
                    </Stack>
                  )}
                </Stack>
                <FailedFlip />
                <FailedFlip />
              </>
            )}
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
          onCheck={handleRunLocalAiRecommendation}
        />
      ) : null}
      {(isShortSession(state) || state.matches('longSession')) &&
        showValidationAiUi && (
          <AiTelemetryPanel
            isShortSessionMode={isShortSession(state)}
            telemetry={aiLastRun}
            aiProgress={aiProgress}
            activeFlip={aiActiveFlip}
            liveTimeline={aiLiveTimeline}
            rehearsalBenchmarkSummary={rehearsalBenchmarkSummary}
          />
        )}
      <ActionBar>
        <ActionBarItem />
        <ActionBarItem justify="center">
          <ValidationTimer
            validationStart={validationStart}
            duration={
              shortSessionDuration -
              SHORT_SESSION_AUTO_SUBMIT_BUFFER_SECONDS +
              (isShortSession(state) ? 0 : longSessionDuration)
            }
          />
        </ActionBarItem>
        <ActionBarItem justify="flex-end">
          {(isShortSession(state) || isLongSessionFlips(state)) &&
            showValidationAiUi && (
              <Stack isInline spacing={2} align="center" mr={3}>
                {aiProgress && (
                  <Text
                    fontSize="xs"
                    color={isShortSession(state) ? 'whiteAlpha.800' : 'muted'}
                  >
                    {aiProgress}
                  </Text>
                )}
                {isSessionAutoMode &&
                !forceAiPreview &&
                aiLastRun?.status !== 'failed' ? (
                  <Text
                    fontSize="xs"
                    color={isShortSession(state) ? 'whiteAlpha.800' : 'muted'}
                    fontWeight={600}
                  >
                    {t('AI auto-run active')}
                  </Text>
                ) : (
                  <SecondaryButton
                    isDisabled={!canRunAiSolve || aiProviderStatus.checking}
                    isLoading={aiSolving}
                    onClick={handleRunAiSolve}
                  >
                    {manualAiActionLabel}
                  </SecondaryButton>
                )}
              </Stack>
            )}
          {canOpenLocalResultsShortcut && (
            <SecondaryButton
              mr={3}
              onClick={() => router.push('/validation/after')}
            >
              {t('Open local stats & audit')}
            </SecondaryButton>
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
                {submitActionLabel}
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
                  {submitActionLabel}
                </PrimaryButton>
              </Tooltip>
            ))}
          {isLongSessionFlips(state) && (
            <Stack isInline spacing={2}>
              <SecondaryButton
                isDisabled={isSubmitting(state) || autoReportRunning}
                onClick={() => {
                  beginManualReporting()
                  send('FINISH_FLIPS')
                }}
              >
                {keywordActionLabel}
              </SecondaryButton>
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
                {submitActionLabel}
              </PrimaryButton>
            </Stack>
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

      <EncourageReportDialog
        isOpen={isOpenEncourageReportDialog}
        onClose={onCloseEncourageReportDialog}
      />
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

function formatUsd(value) {
  const num = Number(value)

  if (!Number.isFinite(num) || num < 0) {
    return null
  }

  if (num === 0) {
    return '$0.00'
  }

  if (num < 0.01) {
    return '<$0.01'
  }

  if (num < 1) {
    return `$${num.toFixed(3)}`
  }

  return `$${num.toFixed(2)}`
}

function formatTelemetryCost(costs = {}) {
  const estimated = formatUsd(costs && costs.estimatedUsd)
  const actual = formatUsd(costs && costs.actualUsd)

  if (estimated && actual && estimated !== actual) {
    return `est ${estimated} | actual ${actual}`
  }

  if (actual) {
    return `actual ${actual}`
  }

  if (estimated) {
    return `est ${estimated}`
  }

  return ''
}

function shortenHash(hash) {
  const value = String(hash || '')
  if (value.length <= 12) return value
  return `${value.slice(0, 6)}...${value.slice(-4)}`
}

function formatAiDecisionTrace(item = {}) {
  const parts = []

  if (item.uncertaintyRepromptUsed) {
    parts.push(
      item.secondPassStrategy === 'annotated_frame_review'
        ? 'reprompt frame-review'
        : 'reprompt'
    )
  }

  if (item.forcedDecision) {
    parts.push(
      item.forcedDecisionPolicy === 'random'
        ? `random fallback${
            item.forcedDecisionReason
              ? ` (${String(item.forcedDecisionReason).replace(/_/g, ' ')})`
              : ''
          }`
        : 'forced decision'
    )
  } else if (item.rawAnswerBeforeRemap === 'skip') {
    parts.push('raw skip')
  }

  if (item.ensembleTieBreakApplied) {
    const selectedAnswer = String(
      item.finalAnswerAfterRemap || item.answer || ''
    )
      .trim()
      .toUpperCase()
    const tiedAnswers = Array.isArray(item.ensembleTieBreakCandidates)
      ? item.ensembleTieBreakCandidates
          .map((answer) =>
            String(answer || '')
              .trim()
              .toUpperCase()
          )
          .filter(Boolean)
      : []

    parts.push(
      tiedAnswers.length > 1 && selectedAnswer
        ? `ensemble tie-break ${selectedAnswer} from ${tiedAnswers.join('/')}`
        : 'ensemble tie-break'
    )
  }

  if (item.error) {
    parts.push('provider error')
  }

  return parts.join(' | ')
}

function formatAiDecisionReasoning(item = {}) {
  const parts = []

  if (item.firstPass) {
    const firstPassBits = []

    if (item.firstPass.answer) {
      firstPassBits.push(`first ${String(item.firstPass.answer).toUpperCase()}`)
    }
    if (Number.isFinite(Number(item.firstPass.confidence))) {
      firstPassBits.push(toPct(item.firstPass.confidence))
    }
    if (item.firstPass.strategy) {
      firstPassBits.push(String(item.firstPass.strategy).replace(/_/g, ' '))
    }
    if (item.firstPass.error) {
      firstPassBits.push(String(item.firstPass.error))
    } else if (item.firstPass.reasoning) {
      firstPassBits.push(String(item.firstPass.reasoning))
    }

    if (firstPassBits.length) {
      parts.push(firstPassBits.join(' | '))
    }
  }

  if (item.reasoning) {
    parts.push(String(item.reasoning))
  }

  return parts.join(' || ')
}

function formatAiSolveProgressSuffix(item = {}) {
  if (item.forcedDecisionPolicy === 'random') {
    return ' (random fallback)'
  }

  if (item.uncertaintyRepromptUsed) {
    return ' (reprompt)'
  }

  return ''
}

function formatFlipKeywordSummary(words = []) {
  const normalized = Array.isArray(words)
    ? words
        .map((word) => String(word?.name || word?.desc || '').trim())
        .filter(Boolean)
        .slice(0, 2)
    : []

  return normalized.length ? normalized.join(' / ') : ''
}

function formatFlipConsensusSummary(consensusVotes) {
  const total = Number(consensusVotes?.total) || 0
  if (total < 1) {
    return ''
  }

  return `votes ${Number(consensusVotes?.left) || 0}/${
    Number(consensusVotes?.right) || 0
  }/${Number(consensusVotes?.reported) || 0}`
}

function formatFlipSourceStatsSummary(sourceStats) {
  if (!sourceStats) {
    return ''
  }

  const parts = []

  if (sourceStats.status) {
    parts.push(String(sourceStats.status))
  }
  if (
    Number.isFinite(Number(sourceStats.shortRespCount)) ||
    Number.isFinite(Number(sourceStats.longRespCount))
  ) {
    parts.push(
      `resp ${Number(sourceStats.shortRespCount) || 0}/${
        Number(sourceStats.longRespCount) || 0
      }`
    )
  }
  if (Number.isFinite(Number(sourceStats.wrongWordsVotes))) {
    parts.push(`wrongWords ${Number(sourceStats.wrongWordsVotes) || 0}`)
  }
  if (Number.isFinite(Number(sourceStats.grade))) {
    const gradeScore = Number.isFinite(Number(sourceStats.gradeScore))
      ? `:${Number(sourceStats.gradeScore).toFixed(2)}`
      : ''
    parts.push(`grade ${Number(sourceStats.grade)}${gradeScore}`)
  }

  return parts.join(' | ')
}

function AiTelemetryPanel({
  isShortSessionMode,
  telemetry,
  aiProgress,
  activeFlip,
  liveTimeline = [],
  rehearsalBenchmarkSummary = null,
}) {
  const cardBg = isShortSessionMode ? 'whiteAlpha.100' : 'gray.50'
  const cardBorder = isShortSessionMode ? 'whiteAlpha.300' : 'gray.100'
  const titleColor = isShortSessionMode ? 'whiteAlpha.900' : 'brandGray.500'
  const bodyColor = isShortSessionMode ? 'whiteAlpha.800' : 'muted'
  const sessionType = String(
    telemetry?.sessionType ||
      activeFlip?.sessionType ||
      (isShortSessionMode ? 'short' : 'long')
  ).toLowerCase()
  const sessionStats =
    rehearsalBenchmarkSummary &&
    rehearsalBenchmarkSummary.sessions &&
    rehearsalBenchmarkSummary.sessions[sessionType]
      ? rehearsalBenchmarkSummary.sessions[sessionType]
      : null

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
          {telemetry.profile && (
            <Text fontSize="xs" color={bodyColor}>
              {`profile ${
                telemetry.profile.benchmarkProfile || 'strict'
              }, vision ${
                telemetry.profile.flipVisionMode || 'composite'
              }, timeout ${formatLatency(
                telemetry.profile.requestTimeoutMs
              )}, gap ${formatLatency(telemetry.profile.interFlipDelayMs)}`}
            </Text>
          )}

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
              {formatTelemetryCost(telemetry.summary.costs) && (
                <Text fontSize="xs" color={bodyColor}>
                  {`price ${formatTelemetryCost(telemetry.summary.costs)}`}
                </Text>
              )}
              <Text fontSize="xs" color={bodyColor}>
                {`raw L/R/S ${telemetry.summary.diagnostics?.rawLeft || 0}/${
                  telemetry.summary.diagnostics?.rawRight || 0
                }/${telemetry.summary.diagnostics?.rawSkip || 0}, swapped ${
                  telemetry.summary.diagnostics?.swapped || 0
                }/${telemetry.summary.diagnostics?.notSwapped || 0}, remapped ${
                  telemetry.summary.diagnostics?.remappedDecisions || 0
                }`}
              </Text>
              <Text fontSize="xs" color={bodyColor}>
                {`reprompt ${
                  telemetry.summary.diagnostics?.uncertaintyReprompts || 0
                }, frame-review ${
                  telemetry.summary.diagnostics?.annotatedFrameReviews || 0
                }, ensemble-tie ${
                  telemetry.summary.diagnostics?.ensembleTieBreaks || 0
                }, forced ${
                  telemetry.summary.diagnostics?.forcedDecisions || 0
                }, random ${
                  telemetry.summary.diagnostics?.randomForcedDecisions || 0
                }`}
              </Text>
            </Stack>
          )}

          {rehearsalBenchmarkSummary?.available && (
            <Stack spacing={1} pt={1}>
              <Text fontSize="xs" color={bodyColor}>
                {`benchmark overall ${rehearsalBenchmarkSummary.correct}/${
                  rehearsalBenchmarkSummary.total
                } correct, answered ${rehearsalBenchmarkSummary.answered}/${
                  rehearsalBenchmarkSummary.total
                }, keywords ${
                  rehearsalBenchmarkSummary.keywordReady?.total || 0
                }/${rehearsalBenchmarkSummary.total}, source-stats ${
                  rehearsalBenchmarkSummary.sourceStatsReady?.total || 0
                }/${rehearsalBenchmarkSummary.total}`}
              </Text>
              {sessionStats && (
                <Text fontSize="xs" color={bodyColor}>
                  {`${sessionType} session ${sessionStats.correct}/${
                    sessionStats.total
                  } correct, answered ${sessionStats.answered}/${
                    sessionStats.total
                  }, keywords ${sessionStats.keywordReady || 0}/${
                    sessionStats.total
                  }, source-stats ${sessionStats.sourceStatsReady || 0}/${
                    sessionStats.total
                  }`}
                </Text>
              )}
              {rehearsalBenchmarkSummary.rawConsensusAvailable && (
                <Text fontSize="xs" color={bodyColor}>
                  {`consensus subset ${
                    rehearsalBenchmarkSummary.consensusBacked.correct
                  }/${
                    rehearsalBenchmarkSummary.consensusBacked.total
                  } correct (${toPct(
                    rehearsalBenchmarkSummary.consensusBacked.coverage
                  )} coverage)`}
                </Text>
              )}
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
                <Stack spacing={1} mt={1}>
                  <Text fontSize="xs" color={bodyColor}>
                    {`selected ${String(
                      activeFlip.answer
                    ).toUpperCase()} in ${formatLatency(
                      activeFlip.latencyMs
                    )} | tok ${tokenTotal(activeFlip.tokenUsage)}${
                      formatTelemetryCost(activeFlip.costs)
                        ? ` | price ${formatTelemetryCost(activeFlip.costs)}`
                        : ''
                    }`}
                  </Text>
                  {formatAiDecisionTrace(activeFlip) && (
                    <Text fontSize="xs" color={bodyColor}>
                      {formatAiDecisionTrace(activeFlip)}
                    </Text>
                  )}
                  {formatAiDecisionReasoning(activeFlip) && (
                    <Text fontSize="xs" color={bodyColor} noOfLines={3}>
                      {formatAiDecisionReasoning(activeFlip)}
                    </Text>
                  )}
                </Stack>
              )}
              {(formatFlipKeywordSummary(activeFlip.words) ||
                formatFlipConsensusSummary(activeFlip.consensusVotes) ||
                formatFlipSourceStatsSummary(activeFlip.sourceStats)) && (
                <Stack spacing={1} mt={1}>
                  {formatFlipKeywordSummary(activeFlip.words) && (
                    <Text fontSize="xs" color={bodyColor}>
                      {`keywords ${formatFlipKeywordSummary(activeFlip.words)}`}
                    </Text>
                  )}
                  {formatFlipConsensusSummary(activeFlip.consensusVotes) && (
                    <Text fontSize="xs" color={bodyColor}>
                      {formatFlipConsensusSummary(activeFlip.consensusVotes)}
                    </Text>
                  )}
                  {formatFlipSourceStatsSummary(activeFlip.sourceStats) && (
                    <Text fontSize="xs" color={bodyColor}>
                      {formatFlipSourceStatsSummary(activeFlip.sourceStats)}
                    </Text>
                  )}
                </Stack>
              )}
            </Box>
          )}

          {Array.isArray(liveTimeline) &&
            liveTimeline.slice(-8).map((event) => (
              <Stack key={`${event.hash}-${event.at}`} spacing={1}>
                <Flex justify="space-between" gap={3}>
                  <Text fontSize="xs" color={bodyColor} noOfLines={1}>
                    {`#${event.index || '-'} ${shortenHash(
                      event.hash
                    )} ${String(
                      event.answer || 'skip'
                    ).toUpperCase()} raw:${String(
                      event.rawAnswerBeforeRemap || '-'
                    ).toUpperCase()}${event.sideSwapped ? ' SWAP' : ''}`}
                  </Text>
                  <Text fontSize="xs" color={bodyColor}>
                    {`${toPct(event.confidence)} ${formatLatency(
                      event.latencyMs
                    )} tok:${tokenTotal(event.tokenUsage)}${
                      formatTelemetryCost(event.costs)
                        ? ` price:${formatTelemetryCost(event.costs)}`
                        : ''
                    }${event.error ? ' ERR' : ''}`}
                  </Text>
                </Flex>
                {formatAiDecisionTrace(event) && (
                  <Text fontSize="xs" color={bodyColor} noOfLines={2}>
                    {formatAiDecisionTrace(event)}
                  </Text>
                )}
                {formatAiDecisionReasoning(event) && (
                  <Text fontSize="xs" color={bodyColor} noOfLines={2}>
                    {formatAiDecisionReasoning(event)}
                  </Text>
                )}
                {(formatFlipKeywordSummary(event.words) ||
                  formatFlipConsensusSummary(event.consensusVotes) ||
                  formatFlipSourceStatsSummary(event.sourceStats)) && (
                  <Text fontSize="xs" color={bodyColor} noOfLines={2}>
                    {[
                      formatFlipKeywordSummary(event.words)
                        ? `kw ${formatFlipKeywordSummary(event.words)}`
                        : '',
                      formatFlipConsensusSummary(event.consensusVotes),
                      formatFlipSourceStatsSummary(event.sourceStats),
                    ]
                      .filter(Boolean)
                      .join(' | ')}
                  </Text>
                )}
              </Stack>
            ))}

          {!liveTimeline.length &&
            Array.isArray(telemetry.flips) &&
            telemetry.flips.slice(0, 6).map((flip) => (
              <Stack key={flip.hash} spacing={1}>
                <Flex justify="space-between" gap={3}>
                  <Text fontSize="xs" color={bodyColor} noOfLines={1}>
                    {`${shortenHash(flip.hash)} ${String(
                      flip.answer || 'skip'
                    ).toUpperCase()}`}
                  </Text>
                  <Text fontSize="xs" color={bodyColor}>
                    {`${toPct(flip.confidence)} ${formatLatency(
                      flip.latencyMs
                    )} tok:${tokenTotal(flip.tokenUsage)}${
                      formatTelemetryCost(flip.costs)
                        ? ` price:${formatTelemetryCost(flip.costs)}`
                        : ''
                    }${flip.error ? ' ERR' : ''}`}
                  </Text>
                </Flex>
                {formatAiDecisionTrace(flip) && (
                  <Text fontSize="xs" color={bodyColor} noOfLines={2}>
                    {formatAiDecisionTrace(flip)}
                  </Text>
                )}
                {formatAiDecisionReasoning(flip) && (
                  <Text fontSize="xs" color={bodyColor} noOfLines={2}>
                    {formatAiDecisionReasoning(flip)}
                  </Text>
                )}
              </Stack>
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
  if (isShortSession(state))
    return hasAnyAnsweredFlip(state) && !isSubmitting(state)

  if (isLongSessionFlips(state))
    return hasAnyAnsweredFlip(state) && !isSubmitting(state)

  if (isLongSessionKeywords(state))
    return hasAnyAnsweredFlip(state) && !isSubmitting(state)
}

function sessionFlips(state) {
  const {
    context: {shortFlips, longFlips},
  } = state
  return isShortSession(state)
    ? rearrangeFlips(filterRegularFlips(shortFlips))
    : rearrangeFlips(longFlips.filter(readyFlip))
}

function hasAnyAnsweredFlip(state) {
  const {
    context: {shortFlips, longFlips},
  } = state
  const flips = isShortSession(state)
    ? shortFlips.filter(({decoded, extra}) => decoded && !extra)
    : longFlips.filter(({decoded}) => decoded)

  return flips.some(({option}) => option > 0)
}

function hasAllRelevanceMarks({context: {longFlips}}) {
  const flips = longFlips.filter(decodedWithKeywords)
  return flips.every(({relevance}) => relevance)
}
