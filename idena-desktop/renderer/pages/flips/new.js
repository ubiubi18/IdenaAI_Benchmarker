import React, {useEffect, useMemo, useRef, useState} from 'react'
import {useRouter} from 'next/router'
import {
  Box,
  Flex,
  useToast,
  Divider,
  useDisclosure,
  Stack,
  Text,
  SimpleGrid,
  Switch,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
} from '@chakra-ui/react'
import {useTranslation} from 'react-i18next'
import {useMachine} from '@xstate/react'
import {
  FlipMasterFooter,
  FlipPageTitle,
  FlipMaster,
  FlipMasterNavbar,
  FlipMasterNavbarItem,
  FlipStoryStep,
  FlipStepBody,
  FlipKeywordPanel,
  FlipKeywordTranslationSwitch,
  CommunityTranslations,
  FlipKeyword,
  FlipKeywordName,
  FlipStoryAside,
  FlipEditorStep,
  FlipShuffleStep,
  FlipSubmitStep,
  CommunityTranslationUnavailable,
  PublishFlipDrawer,
} from '../../screens/flips/components'
import {useIdentityState} from '../../shared/providers/identity-context'
import {flipMasterMachine} from '../../screens/flips/machines'
import {
  publishFlip,
  isPendingKeywordPair,
  getRandomKeywordPair,
} from '../../screens/flips/utils'
import {Step} from '../../screens/flips/types'
import {
  IconButton2,
  SecondaryButton,
  PrimaryButton,
} from '../../shared/components/button'
import {
  Toast,
  FloatDebug,
  Page,
  Input,
  Textarea,
} from '../../shared/components/components'
import Layout from '../../shared/components/layout'
import {useChainState} from '../../shared/providers/chain-context'
import {useSettingsState} from '../../shared/providers/settings-context'
import {BadFlipDialog} from '../../screens/validation/components'
import {requestDb} from '../../shared/utils/db'
import {useFailToast} from '../../shared/hooks/use-toast'
import {InfoIcon, RefreshIcon} from '../../shared/components/icons'
import {useRpc, useTrackTx} from '../../screens/ads/hooks'
import {eitherState} from '../../shared/utils/utils'
import {solveShortSessionWithAi} from '../../screens/validation/ai/solver-orchestrator'
import {
  decodedFlipToAiFlip,
  normalizeInputFlipsInChunks,
  normalizeInputFlips,
} from '../../screens/validation/ai/test-unit-utils'

const DEFAULT_AI_SOLVER_SETTINGS = {
  enabled: false,
  provider: 'openai',
  model: 'gpt-4o-mini',
  benchmarkProfile: 'strict',
  deadlineMs: 60 * 1000,
  requestTimeoutMs: 9 * 1000,
  maxConcurrency: 1,
  maxRetries: 1,
  maxOutputTokens: 120,
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

// Pricing snapshot for common OpenAI text+vision models (USD per 1M tokens),
// based on public OpenAI pricing/docs as of 2026-03-25.
const OPENAI_MODEL_PRICING_USD_PER_MTOK = {
  'gpt-5.4': {input: 2.5, output: 15},
  'gpt-5.3-chat-latest': {input: 1.75, output: 14},
  'gpt-5.3-codex': {input: 1.75, output: 14},
  'gpt-5-mini': {input: 0.25, output: 2},
  'gpt-4.1': {input: 2, output: 8},
  'gpt-4.1-mini': {input: 0.4, output: 1.6},
  'gpt-4o': {input: 2.5, output: 10},
  'gpt-4o-mini': {input: 0.15, output: 0.6},
  'o4-mini': {input: 1.1, output: 4.4},
}

const MAX_INLINE_JSON_BYTES = 2 * 1024 * 1024
const JSON_IMPORT_CHUNK_SIZE = 8

function toInt(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function toFloat(value, fallback) {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function normalizeWeight(value, fallback = 1) {
  const parsed = toFloat(value, fallback)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }
  return Math.min(10, Math.max(0.05, parsed))
}

function buildProviderConfig(provider, settings = {}) {
  if (provider !== 'openai-compatible') {
    return null
  }

  return {
    name: settings.customProviderName,
    baseUrl: settings.customProviderBaseUrl,
    chatPath: settings.customProviderChatPath,
  }
}

function readTextFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error(`Unable to read file ${file.name}`))
    reader.readAsText(file)
  })
}

function tokenCount(item = {}) {
  const usage = item.tokenUsage || {}
  return usage.totalTokens || usage.promptTokens || usage.completionTokens || 0
}

function toPercent(value) {
  if (!Number.isFinite(value)) {
    return '0.0%'
  }
  return `${(value * 100).toFixed(1)}%`
}

function benchmarkPresetToLabel(preset) {
  const labels = {
    short: 'short-6',
    long: 'long-14',
    json: 'json',
    custom: 'custom',
  }
  return labels[preset] || 'custom'
}

function normalizeConsultProvider(value) {
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

function buildConsultProvidersFromSettings(settings = {}) {
  if (!settings.ensembleEnabled) return []

  const slots = [
    {
      enabled: settings.ensembleProvider2Enabled,
      provider: settings.ensembleProvider2,
      model: settings.ensembleModel2,
      weight: settings.ensembleProvider2Weight,
      source: 'ensemble-slot-2',
    },
    {
      enabled: settings.ensembleProvider3Enabled,
      provider: settings.ensembleProvider3,
      model: settings.ensembleModel3,
      weight: settings.ensembleProvider3Weight,
      source: 'ensemble-slot-3',
    },
  ]

  return slots
    .filter((slot) => slot.enabled)
    .map((slot) => {
      const provider = normalizeConsultProvider(slot.provider)
      const model = String(slot.model || '').trim()
      if (!provider || !model) return null

      return {
        provider,
        model,
        weight: normalizeWeight(slot.weight, 1),
        source: slot.source,
        providerConfig: buildProviderConfig(provider, settings),
      }
    })
    .filter(Boolean)
    .slice(0, 2)
}

function estimateHeuristicTokensPerFlip({
  flipVisionMode,
  maxOutputTokens,
  uncertaintyRepromptEnabled,
}) {
  const mode = String(flipVisionMode || 'composite')
    .trim()
    .toLowerCase()
  const safeMaxOutput = Math.max(16, toInt(maxOutputTokens, 120))

  let basePromptPerFlip = 2600
  let baseCompletionPerFlip = Math.max(40, Math.min(safeMaxOutput, 96))

  if (mode === 'frames_single_pass') {
    basePromptPerFlip = 3400
    baseCompletionPerFlip = Math.max(56, Math.min(safeMaxOutput, 128))
  } else if (mode === 'frames_two_pass') {
    basePromptPerFlip = 4300
    baseCompletionPerFlip = Math.max(
      96,
      Math.min(safeMaxOutput + Math.round(safeMaxOutput * 0.8), 260)
    )
  }

  const worstMultiplier = uncertaintyRepromptEnabled ? 2 : 1

  return {
    expectedPromptPerFlip: basePromptPerFlip,
    expectedCompletionPerFlip: baseCompletionPerFlip,
    worstPromptPerFlip: Math.round(basePromptPerFlip * worstMultiplier),
    worstCompletionPerFlip: Math.round(baseCompletionPerFlip * worstMultiplier),
    basis: 'heuristic',
  }
}

function normalizePrice(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

function resolveOpenAiModelPricing(model) {
  const normalized = String(model || '')
    .trim()
    .toLowerCase()

  if (!normalized) {
    return null
  }

  if (OPENAI_MODEL_PRICING_USD_PER_MTOK[normalized]) {
    return OPENAI_MODEL_PRICING_USD_PER_MTOK[normalized]
  }

  const prefix = Object.keys(OPENAI_MODEL_PRICING_USD_PER_MTOK).find((key) =>
    normalized.startsWith(`${key}-`)
  )
  if (prefix) {
    return OPENAI_MODEL_PRICING_USD_PER_MTOK[prefix]
  }

  return null
}

function toUsdFromTokens(tokens, pricePerM) {
  return (normalizePrice(tokens) / 1000000) * normalizePrice(pricePerM)
}

function formatUsd(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return '$0.00'
  }
  if (value < 0.01) {
    return '<$0.01'
  }
  if (value < 1) {
    return `$${value.toFixed(3)}`
  }
  return `$${value.toFixed(2)}`
}

function expectedSuffix(expectedAnswer, isCorrect, labels = {}) {
  const normalized = String(expectedAnswer || '').trim()
  if (!normalized) {
    return ''
  }

  const okLabel = labels.okLabel || 'correct'
  const missLabel = labels.missLabel || 'wrong'
  const expectedPart = ` | expected ${normalized.toUpperCase()}`

  if (isCorrect == null) {
    return expectedPart
  }

  return `${expectedPart} | ${isCorrect ? okLabel : missLabel}`
}

function flattenBatchResults(runResult) {
  if (!runResult || !Array.isArray(runResult.batches)) {
    return []
  }

  return runResult.batches
    .flatMap((batch) => (Array.isArray(batch.results) ? batch.results : []))
    .filter(Boolean)
}

function formatAiRunError(error) {
  const raw = String((error && error.message) || error || '').trim()
  const withoutIpcPrefix = raw
    .replace(/Error invoking remote method '[^']+':\s*/i, '')
    .trim()
  const message = withoutIpcPrefix || 'Unknown error'

  if (/API key is not set for provider:/i.test(message)) {
    const provider = (message.split(':')[1] || '').trim() || 'selected provider'
    return `API key missing for ${provider}. Open AI settings and set the session key, then retry.`
  }

  if (/AI helper is disabled/i.test(message)) {
    return 'AI helper is disabled. Open AI settings, enable AI helper, then retry.'
  }

  return message
}

export default function NewFlipPage() {
  const {t, i18n} = useTranslation()

  const router = useRouter()

  const toast = useToast()

  const {syncing, offline} = useChainState()
  const settings = useSettingsState()

  const {flipKeyWordPairs} = useIdentityState()

  const failToast = useFailToast()

  const didBootstrapEpochFallback = useRef(false)
  const [isOfflineBuilderMode, setIsOfflineBuilderMode] = useState(false)
  const [isAiDraftTesting, setIsAiDraftTesting] = useState(false)
  const [isAddingToTestUnit, setIsAddingToTestUnit] = useState(false)
  const [aiDraftTestResult, setAiDraftTestResult] = useState(null)
  const [builderQueue, setBuilderQueue] = useState([])
  const [builderQueueTotal, setBuilderQueueTotal] = useState(0)
  const [isBuilderQueueLoading, setIsBuilderQueueLoading] = useState(false)
  const [isBuilderQueueRunning, setIsBuilderQueueRunning] = useState(false)
  const [isBuilderQueueClearing, setIsBuilderQueueClearing] = useState(false)
  const [builderBatchSize, setBuilderBatchSize] = useState(3)
  const [builderMaxFlips, setBuilderMaxFlips] = useState(6)
  const [builderDequeue, setBuilderDequeue] = useState(false)
  const [builderJsonInput, setBuilderJsonInput] = useState('')
  const [builderJsonFilename, setBuilderJsonFilename] = useState('')
  const [builderJsonFile, setBuilderJsonFile] = useState(null)
  const [isBuilderJsonLoading, setIsBuilderJsonLoading] = useState(false)
  const [isBuilderJsonAdding, setIsBuilderJsonAdding] = useState(false)
  const [isBuilderJsonRunning, setIsBuilderJsonRunning] = useState(false)
  const [builderLastRun, setBuilderLastRun] = useState(null)
  const [builderRunId, setBuilderRunId] = useState('')
  const [builderLiveState, setBuilderLiveState] = useState({
    isRunning: false,
    processed: 0,
    totalFlips: 0,
    totalBatches: 0,
    elapsedMs: 0,
    provider: '',
    model: '',
  })
  const [builderLiveCurrentFlip, setBuilderLiveCurrentFlip] = useState(null)
  const [builderLiveTimeline, setBuilderLiveTimeline] = useState([])
  const [benchmarkCountdown, setBenchmarkCountdown] = useState(null)
  const [benchmarkPopupStatus, setBenchmarkPopupStatus] = useState('idle')
  const [benchmarkRunPreset, setBenchmarkRunPreset] = useState('custom')
  const [benchmarkRunStartedAtMs, setBenchmarkRunStartedAtMs] = useState(0)
  const [benchmarkRunRuntimeMs, setBenchmarkRunRuntimeMs] = useState(0)
  const benchmarkSessionDisclosure = useDisclosure()

  const aiSolverSettings = useMemo(
    () => ({...DEFAULT_AI_SOLVER_SETTINGS, ...(settings.aiSolver || {})}),
    [settings.aiSolver]
  )
  const hasBuilderJsonSource = Boolean(
    String(builderJsonInput || '').trim() || builderJsonFile
  )

  const sessionPackPreview = useMemo(() => {
    const pack = Array.isArray(builderQueue) ? builderQueue.slice(0, 20) : []
    return {
      total: pack.length,
      shortFlips: pack.slice(0, 6),
      longFlips: pack.slice(6, 20),
    }
  }, [builderQueue])

  const baseRunPayload = useMemo(
    () => ({
      provider: aiSolverSettings.provider,
      model: aiSolverSettings.model,
      providerConfig: buildProviderConfig(
        aiSolverSettings.provider,
        aiSolverSettings
      ),
      benchmarkProfile: aiSolverSettings.benchmarkProfile,
      deadlineMs: aiSolverSettings.deadlineMs,
      requestTimeoutMs: aiSolverSettings.requestTimeoutMs,
      maxConcurrency: aiSolverSettings.maxConcurrency,
      maxRetries: aiSolverSettings.maxRetries,
      maxOutputTokens: aiSolverSettings.maxOutputTokens,
      interFlipDelayMs: aiSolverSettings.interFlipDelayMs,
      temperature: aiSolverSettings.temperature,
      forceDecision: aiSolverSettings.forceDecision,
      uncertaintyRepromptEnabled: aiSolverSettings.uncertaintyRepromptEnabled,
      uncertaintyConfidenceThreshold:
        aiSolverSettings.uncertaintyConfidenceThreshold,
      uncertaintyRepromptMinRemainingMs:
        aiSolverSettings.uncertaintyRepromptMinRemainingMs,
      uncertaintyRepromptInstruction:
        aiSolverSettings.uncertaintyRepromptInstruction,
      promptTemplateOverride: aiSolverSettings.promptTemplateOverride,
      flipVisionMode: aiSolverSettings.flipVisionMode,
      ensembleEnabled: Boolean(aiSolverSettings.ensembleEnabled),
      ensemblePrimaryWeight: normalizeWeight(
        aiSolverSettings.ensemblePrimaryWeight,
        1
      ),
      legacyHeuristicEnabled: Boolean(aiSolverSettings.legacyHeuristicEnabled),
      legacyHeuristicWeight: normalizeWeight(
        aiSolverSettings.legacyHeuristicWeight,
        1
      ),
      legacyHeuristicOnly: Boolean(aiSolverSettings.legacyHeuristicOnly),
      consultProviders: buildConsultProvidersFromSettings(aiSolverSettings),
    }),
    [aiSolverSettings]
  )

  const modelCostEstimate = useMemo(() => {
    const provider = String(aiSolverSettings.provider || '')
      .trim()
      .toLowerCase()
    const model = String(aiSolverSettings.model || '').trim()
    const pricing =
      provider === 'openai' || provider === 'openai-compatible'
        ? resolveOpenAiModelPricing(model)
        : null

    const hasLastRunTokenSummary =
      builderLastRun &&
      builderLastRun.provider === aiSolverSettings.provider &&
      builderLastRun.model === aiSolverSettings.model &&
      builderLastRun.summary &&
      builderLastRun.summary.tokens &&
      Number(builderLastRun.totalFlips) > 0 &&
      Number(builderLastRun.summary.tokens.flipsWithUsage) > 0

    let tokenProfile = estimateHeuristicTokensPerFlip({
      flipVisionMode: aiSolverSettings.flipVisionMode,
      maxOutputTokens: aiSolverSettings.maxOutputTokens,
      uncertaintyRepromptEnabled: aiSolverSettings.uncertaintyRepromptEnabled,
    })

    if (hasLastRunTokenSummary) {
      const flipsWithUsage = Math.max(
        1,
        Number(builderLastRun.summary.tokens.flipsWithUsage) || 1
      )
      const avgPrompt =
        (Number(builderLastRun.summary.tokens.promptTokens) || 0) /
        flipsWithUsage
      const avgCompletion =
        (Number(builderLastRun.summary.tokens.completionTokens) || 0) /
        flipsWithUsage
      const uncertaintyMultiplier = aiSolverSettings.uncertaintyRepromptEnabled
        ? 2
        : 1

      tokenProfile = {
        expectedPromptPerFlip: Math.max(0, Math.round(avgPrompt)),
        expectedCompletionPerFlip: Math.max(0, Math.round(avgCompletion)),
        worstPromptPerFlip: Math.max(
          0,
          Math.round(avgPrompt * uncertaintyMultiplier)
        ),
        worstCompletionPerFlip: Math.max(
          0,
          Math.round(avgCompletion * uncertaintyMultiplier)
        ),
        basis: 'last_run',
      }
    }

    const estimateFor = (flipCount) => {
      const safeCount = Math.max(1, toInt(flipCount, 1))
      const expectedPromptTokens =
        tokenProfile.expectedPromptPerFlip * safeCount
      const expectedCompletionTokens =
        tokenProfile.expectedCompletionPerFlip * safeCount
      const worstPromptTokens = tokenProfile.worstPromptPerFlip * safeCount
      const worstCompletionTokens =
        tokenProfile.worstCompletionPerFlip * safeCount

      const expectedCost = pricing
        ? toUsdFromTokens(expectedPromptTokens, pricing.input) +
          toUsdFromTokens(expectedCompletionTokens, pricing.output)
        : null
      const worstCost = pricing
        ? toUsdFromTokens(worstPromptTokens, pricing.input) +
          toUsdFromTokens(worstCompletionTokens, pricing.output)
        : null

      return {
        flipCount: safeCount,
        expectedPromptTokens,
        expectedCompletionTokens,
        worstPromptTokens,
        worstCompletionTokens,
        expectedCost,
        worstCost,
      }
    }

    return {
      provider,
      model,
      pricing,
      tokenProfile,
      short: estimateFor(6),
      long: estimateFor(14),
      custom: estimateFor(builderMaxFlips),
    }
  }, [aiSolverSettings, builderLastRun, builderMaxFlips])

  const [current, send] = useMachine(flipMasterMachine, {
    context: {
      locale: i18n.language,
    },
    services: {
      prepareFlip: async () => {
        // eslint-disable-next-line no-shadow
        let didShowBadFlip

        try {
          didShowBadFlip = await global
            .sub(requestDb(), 'flips')
            .get('didShowBadFlipNew')
        } catch {
          didShowBadFlip = false
        }

        if (
          !Array.isArray(flipKeyWordPairs) ||
          flipKeyWordPairs.every(({used}) => used)
        )
          return {
            keywordPairId: 0,
            availableKeywords: [getRandomKeywordPair()],
            didShowBadFlip,
          }

        const persistedFlips = global.flipStore?.getFlips()

        // eslint-disable-next-line no-shadow
        const availableKeywords = flipKeyWordPairs.filter(
          ({id, used}) => !used && !isPendingKeywordPair(persistedFlips, id)
        )

        if (!availableKeywords.length) {
          return {
            keywordPairId: 0,
            availableKeywords: [getRandomKeywordPair()],
            didShowBadFlip,
          }
        }

        // eslint-disable-next-line no-shadow
        const [{id: keywordPairId}] = availableKeywords

        return {keywordPairId, availableKeywords, didShowBadFlip}
      },
      protectFlip: async (flip) =>
        Promise.resolve({
          protectedImages: Array.isArray(flip.images)
            ? flip.images.slice()
            : Array.from({length: 4}),
          adversarialImage: '',
        }),
      loadAdversarial: async () => Promise.resolve(),
      shuffleAdversarial: async (flip) =>
        Promise.resolve({
          order: Array.isArray(flip.originalOrder)
            ? flip.originalOrder.slice()
            : [0, 1, 2, 3],
        }),
      submitFlip: async (flip) => publishFlip(flip),
    },
    actions: {
      onMined: () => {
        router.push('/flips/list')
      },
      onError: (
        _,
        {data, error = data.response?.data?.error ?? data.message}
      ) => {
        failToast(
          data.response?.status === 413
            ? t('Cannot submit flip, content is too big')
            : error
        )
      },
    },
  })

  const {
    availableKeywords,
    keywordPairId,
    keywords,
    images,
    protectedImages,
    adversarialImageId,
    originalOrder,
    order,
    showTranslation,
    isCommunityTranslationsExpanded,
    didShowBadFlip,
    txHash,
  } = current.context

  const draftImages = useMemo(
    () => images.map((image, idx) => protectedImages[idx] || image),
    [images, protectedImages]
  )

  const not = (state) => !current.matches({editing: state})
  const is = (state) => current.matches({editing: state})
  const either = (...states) =>
    eitherState(current, ...states.map((s) => ({editing: s})))

  const isOffline = is('keywords.loaded.fetchTranslationsFailed')

  const {
    isOpen: isOpenBadFlipDialog,
    onOpen: onOpenBadFlipDialog,
    onClose: onCloseBadFlipDialog,
  } = useDisclosure()

  const publishDrawerDisclosure = useDisclosure()

  const notify = (title, description, status = 'info') => {
    toast({
      render: () => (
        <Toast title={title} description={description} status={status} />
      ),
    })
  }

  const ensureAiSolverBridge = () => {
    if (!global.aiSolver) {
      throw new Error('AI solver bridge is not available in this build')
    }
  }

  const ensureAiRunReady = async ({requireEnabled = false} = {}) => {
    ensureAiSolverBridge()

    // Manual benchmark runs in the flip builder should work even if
    // auto-session AI helper is disabled in global settings.
    if (requireEnabled && !aiSolverSettings.enabled) {
      throw new Error('AI helper is disabled')
    }

    const isLegacyOnlyMode =
      aiSolverSettings.legacyHeuristicEnabled &&
      aiSolverSettings.legacyHeuristicOnly

    if (
      !isLegacyOnlyMode &&
      global.aiSolver &&
      typeof global.aiSolver.hasProviderKey === 'function'
    ) {
      const state = await global.aiSolver.hasProviderKey({
        provider: aiSolverSettings.provider,
      })
      if (!state || !state.hasKey) {
        throw new Error(
          `API key is not set for provider: ${
            (state && state.provider) || aiSolverSettings.provider
          }`
        )
      }
    }
  }

  const ensureAiTestUnitBridge = () => {
    if (!global.aiTestUnit) {
      throw new Error('AI test unit bridge is not available in this build')
    }
    return global.aiTestUnit
  }

  const ensureDraftImages = () => {
    if (draftImages.some((img) => !img)) {
      throw new Error('Flip images are incomplete. Add all 4 images first.')
    }
  }

  const resetBuilderLiveRun = ({totalFlips = 0, totalBatches = 0} = {}) => {
    const startedAtMs = Date.now()
    const requestId = `builder-run-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2, 8)}`
    setBenchmarkRunStartedAtMs(startedAtMs)
    setBenchmarkRunRuntimeMs(0)
    setBuilderRunId(requestId)
    setBuilderLiveCurrentFlip(null)
    setBuilderLiveTimeline([])
    setBuilderLiveState({
      isRunning: true,
      processed: 0,
      totalFlips,
      totalBatches,
      elapsedMs: 0,
      provider: aiSolverSettings.provider,
      model: aiSolverSettings.model,
    })
    return requestId
  }

  const runBenchmarkCountdown = async (seconds = 5) => {
    setBenchmarkPopupStatus('countdown')
    setBenchmarkCountdown(seconds)
    benchmarkSessionDisclosure.onOpen()

    for (let remaining = seconds - 1; remaining >= 0; remaining -= 1) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => {
        setTimeout(resolve, 1000)
      })
      setBenchmarkCountdown(remaining)
    }
  }

  const reloadBuilderQueue = async () => {
    setIsBuilderQueueLoading(true)
    try {
      const bridge = ensureAiTestUnitBridge()
      const result = await bridge.listFlips({limit: 200, offset: 0})
      setBuilderQueue(result.flips || [])
      setBuilderQueueTotal(result.total || 0)
    } catch (error) {
      notify(t('Unable to load queue'), error.toString(), 'error')
    } finally {
      setIsBuilderQueueLoading(false)
    }
  }

  const readBuilderJsonSourceText = async () => {
    const inlinePayload = String(builderJsonInput || '').trim()
    if (inlinePayload) {
      return inlinePayload
    }
    if (builderJsonFile) {
      return readTextFile(builderJsonFile)
    }
    throw new Error('No JSON payload loaded')
  }

  const parseBuilderJsonRaw = async () => {
    const payload = await readBuilderJsonSourceText()
    try {
      return JSON.parse(payload)
    } catch (error) {
      const sourceName = builderJsonFile ? ` in ${builderJsonFile.name}` : ''
      throw new Error(
        `Unable to parse JSON${sourceName}: ${
          (error && error.message) || error
        }`
      )
    }
  }

  const parseBuilderJsonInput = async () =>
    normalizeInputFlips(await parseBuilderJsonRaw())

  const loadBuilderJsonFile = async (event) => {
    const inputElement = event.target || event.currentTarget || null
    const file = inputElement && inputElement.files && inputElement.files[0]
    if (!file) {
      return
    }

    setIsBuilderJsonLoading(true)
    try {
      if (file.size <= MAX_INLINE_JSON_BYTES) {
        const content = await readTextFile(file)
        setBuilderJsonInput(content)
        setBuilderJsonFile(null)
      } else {
        setBuilderJsonInput('')
        setBuilderJsonFile(file)
      }
      setBuilderJsonFilename(file.name)
      notify(
        t('JSON file loaded'),
        t('{{name}} ({{size}} bytes) {{mode}}', {
          name: file.name,
          size: file.size,
          mode:
            file.size <= MAX_INLINE_JSON_BYTES
              ? '(inline)'
              : '(lazy-loaded for import)',
        })
      )
    } catch (error) {
      notify(t('Unable to read file'), error.toString(), 'error')
    } finally {
      setIsBuilderJsonLoading(false)
      if (inputElement && typeof inputElement.value === 'string') {
        inputElement.value = ''
      }
    }
  }

  const runAiTestBeforeSubmit = async () => {
    setIsAiDraftTesting(true)
    setAiDraftTestResult(null)

    try {
      await ensureAiRunReady()
      ensureDraftImages()

      const result = await solveShortSessionWithAi({
        shortFlips: [
          {
            hash: `draft-flip-${Date.now()}`,
            decoded: true,
            images: draftImages,
            orders: [originalOrder, order],
            ready: true,
            fetched: true,
            extra: false,
            failed: false,
          },
        ],
        aiSolver: aiSolverSettings,
        sessionMeta: {
          type: 'draft-prepublish-test',
          startedAt: new Date().toISOString(),
          keywordPairId,
        },
      })

      const primaryDecision = (result.results || [])[0] || null
      const nextResult = {
        provider: result.provider,
        model: result.model,
        left: result.summary && result.summary.left,
        right: result.summary && result.summary.right,
        skipped: result.summary && result.summary.skipped,
        elapsedMs: result.summary && result.summary.elapsedMs,
        primaryDecision,
      }

      setAiDraftTestResult(nextResult)
      notify(
        t('Draft AI test completed'),
        t('Decision {{answer}} in {{latency}} ms', {
          answer: (primaryDecision && primaryDecision.answer) || 'skip',
          latency: (primaryDecision && primaryDecision.latencyMs) || 0,
        })
      )
    } catch (error) {
      const message = formatAiRunError(error)
      setAiDraftTestResult({error: message})
      notify(t('Draft AI test failed'), message, 'error')
      if (/API key missing|AI helper is disabled/i.test(message)) {
        router.push('/settings/ai')
      }
    } finally {
      setIsAiDraftTesting(false)
    }
  }

  const addDraftToTestUnit = async () => {
    setIsAddingToTestUnit(true)
    try {
      ensureDraftImages()
      const bridge = ensureAiTestUnitBridge()

      const flip = await decodedFlipToAiFlip({
        hash: `draft-flip-${Date.now()}`,
        images: draftImages,
        orders: [originalOrder, order],
      })

      const result = await bridge.addFlips({
        source: 'draft-builder',
        flips: [flip],
        meta: {
          keywordPairId,
        },
      })

      notify(
        t('Added to local AI test unit'),
        t('Queue size: {{count}}', {count: result.total})
      )
    } catch (error) {
      notify(t('Unable to add draft flip'), error.toString(), 'error')
    } finally {
      setIsAddingToTestUnit(false)
    }
  }

  const hydrateLiveStateFromRunResult = (runResult) => {
    const resultRows = flattenBatchResults(runResult)
    if (!resultRows.length) {
      return
    }

    setBuilderLiveState({
      isRunning: false,
      processed: runResult.totalFlips || resultRows.length,
      totalFlips: runResult.totalFlips || resultRows.length,
      totalBatches: runResult.totalBatches || 0,
      elapsedMs: runResult.elapsedMs || 0,
      provider: runResult.provider || aiSolverSettings.provider,
      model: runResult.model || aiSolverSettings.model,
    })
    setBuilderLiveCurrentFlip(resultRows[resultRows.length - 1] || null)
    setBuilderLiveTimeline(resultRows.slice().reverse().slice(0, 24))
  }

  const runBuilderQueue = async ({preset = 'custom'} = {}) => {
    setIsBuilderQueueRunning(true)
    try {
      await ensureAiRunReady()
      const bridge = ensureAiTestUnitBridge()
      const requestedFlipsByPreset = {
        short: 6,
        long: 14,
      }
      const requestedFlips =
        requestedFlipsByPreset[preset] || Math.max(1, toInt(builderMaxFlips, 6))
      const selectedFlips = Math.min(
        requestedFlips,
        Math.max(0, builderQueueTotal || 0)
      )
      if (selectedFlips < 1) {
        throw new Error('Queue is empty')
      }
      if (preset === 'short' && selectedFlips < 6) {
        throw new Error('Short session needs at least 6 flips in queue')
      }
      if (preset === 'long' && selectedFlips < 14) {
        throw new Error('Long session needs at least 14 flips in queue')
      }

      const requestId = resetBuilderLiveRun({
        totalFlips: selectedFlips,
        totalBatches: Math.ceil(selectedFlips / Math.max(1, builderBatchSize)),
      })
      setBenchmarkRunPreset(preset)
      await runBenchmarkCountdown(5)
      setBenchmarkPopupStatus('running')

      const runResult = await bridge.run({
        ...baseRunPayload,
        maxConcurrency: 1,
        batchSize: builderBatchSize,
        maxFlips: selectedFlips,
        dequeue: builderDequeue,
        requestId,
      })
      setBuilderLastRun(runResult)
      hydrateLiveStateFromRunResult(runResult)
      setBenchmarkPopupStatus('completed')
      notify(
        t('Queue run completed'),
        t('{{total}} flips processed in {{batches}} batches', {
          total: runResult.totalFlips,
          batches: runResult.totalBatches,
        })
      )
      await reloadBuilderQueue()
    } catch (error) {
      setBuilderLiveState((prev) => ({...prev, isRunning: false}))
      setBuilderRunId('')
      setBenchmarkPopupStatus('failed')
      const message = formatAiRunError(error)
      notify(t('Queue run failed'), message, 'error')
      if (/API key missing|AI helper is disabled/i.test(message)) {
        router.push('/settings/ai')
      }
    } finally {
      setIsBuilderQueueRunning(false)
    }
  }

  const addBuilderJsonToQueue = async () => {
    setIsBuilderJsonAdding(true)
    try {
      const bridge = ensureAiTestUnitBridge()
      const raw = await parseBuilderJsonRaw()
      let added = 0
      let total = builderQueueTotal

      await normalizeInputFlipsInChunks(raw, {
        chunkSize: JSON_IMPORT_CHUNK_SIZE,
        onChunk: async (chunk) => {
          if (!Array.isArray(chunk) || chunk.length < 1) {
            return
          }
          // eslint-disable-next-line no-await-in-loop
          const result = await bridge.addFlips({
            source: 'json-import',
            flips: chunk,
          })
          added += result.added || chunk.length
          total = Number.isFinite(result.total) ? result.total : total
        },
      })

      notify(
        t('Flips added to queue'),
        t('{{added}} flips added (total {{total}})', {
          added,
          total,
        })
      )
      await reloadBuilderQueue()
    } catch (error) {
      notify(t('JSON ingest failed'), error.toString(), 'error')
    } finally {
      setIsBuilderJsonAdding(false)
    }
  }

  const runBuilderJsonNow = async () => {
    setIsBuilderJsonRunning(true)
    try {
      await ensureAiRunReady()
      const bridge = ensureAiTestUnitBridge()
      const flips = await parseBuilderJsonInput()
      const requestId = resetBuilderLiveRun({
        totalFlips: flips.length,
        totalBatches:
          flips.length > 0
            ? Math.ceil(flips.length / Math.max(1, builderBatchSize))
            : 0,
      })
      setBenchmarkRunPreset('json')
      await runBenchmarkCountdown(5)
      setBenchmarkPopupStatus('running')

      const runResult = await bridge.run({
        ...baseRunPayload,
        maxConcurrency: 1,
        flips,
        batchSize: builderBatchSize,
        maxFlips: flips.length,
        dequeue: false,
        requestId,
      })
      setBuilderLastRun(runResult)
      hydrateLiveStateFromRunResult(runResult)
      setBenchmarkPopupStatus('completed')
      notify(
        t('JSON run completed'),
        t('{{total}} flips processed in {{batches}} batches', {
          total: runResult.totalFlips,
          batches: runResult.totalBatches,
        })
      )
    } catch (error) {
      setBuilderLiveState((prev) => ({...prev, isRunning: false}))
      setBuilderRunId('')
      setBenchmarkPopupStatus('failed')
      const message = formatAiRunError(error)
      notify(t('JSON run failed'), message, 'error')
      if (/API key missing|AI helper is disabled/i.test(message)) {
        router.push('/settings/ai')
      }
    } finally {
      setIsBuilderJsonRunning(false)
    }
  }

  useTrackTx(txHash, {
    onMined: React.useCallback(() => {
      send({type: 'FLIP_MINED'})
    }, [send]),
  })

  useRpc('dna_epoch', [], {
    onSuccess: (data) => {
      didBootstrapEpochFallback.current = true
      setIsOfflineBuilderMode(false)
      send({type: 'SET_EPOCH_NUMBER', epochNumber: data.epoch})
    },
  })

  useEffect(() => {
    if (didBootstrapEpochFallback.current) {
      return
    }

    const timeoutId = setTimeout(() => {
      if (didBootstrapEpochFallback.current) {
        return
      }
      didBootstrapEpochFallback.current = true
      setIsOfflineBuilderMode(true)
      send({type: 'SET_EPOCH_NUMBER', epochNumber: 0})
      notify(
        t('Offline builder mode'),
        t(
          'Node epoch is unavailable. Flip builder is unlocked for local draft and AI benchmark testing.'
        )
      )
    }, 1800)

    return () => clearTimeout(timeoutId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    reloadBuilderQueue()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (router.query?.focus !== 'ai-benchmark') {
      return
    }
    const element = document.getElementById('ai-benchmark')
    if (element && typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({block: 'start', behavior: 'smooth'})
    }
  }, [router.query])

  useEffect(() => {
    const bridge = global.aiTestUnit
    if (!bridge || typeof bridge.onEvent !== 'function') {
      return undefined
    }

    const unsubscribe = bridge.onEvent((event) => {
      if (!event || typeof event !== 'object') {
        return
      }

      if (
        builderRunId &&
        event.requestId &&
        String(event.requestId) !== String(builderRunId)
      ) {
        return
      }

      if (event.type === 'run-start') {
        const startedAtMs = Date.parse(event.startedAt || '') || Date.now()
        setBenchmarkRunStartedAtMs(startedAtMs)
        setBenchmarkRunRuntimeMs(0)
        setBuilderLiveState({
          isRunning: true,
          processed: 0,
          totalFlips: event.totalFlips || 0,
          totalBatches: event.totalBatches || 0,
          elapsedMs: 0,
          provider: event.provider || aiSolverSettings.provider,
          model: event.model || aiSolverSettings.model,
        })
        setBuilderLiveCurrentFlip(null)
        setBuilderLiveTimeline([])
        setBenchmarkPopupStatus((prev) =>
          prev === 'countdown' ? prev : 'running'
        )
        return
      }

      if (event.type === 'flip-start') {
        setBuilderLiveCurrentFlip({
          ...event,
          stage: 'start',
        })
        return
      }

      if (event.type === 'flip-result') {
        setBuilderLiveCurrentFlip(event)
        setBuilderLiveState((prev) => ({
          ...prev,
          isRunning: true,
          processed:
            prev.totalFlips > 0
              ? Math.min(prev.totalFlips, prev.processed + 1)
              : prev.processed + 1,
          elapsedMs: event.elapsedMs || prev.elapsedMs,
        }))
        setBuilderLiveTimeline((prev) => [event].concat(prev).slice(0, 24))
        return
      }

      if (event.type === 'run-complete') {
        setBuilderLiveState((prev) => ({
          ...prev,
          isRunning: false,
          processed: event.totalFlips || prev.processed,
          totalFlips: event.totalFlips || prev.totalFlips,
          totalBatches: event.totalBatches || prev.totalBatches,
          elapsedMs: event.elapsedMs || prev.elapsedMs,
          provider: event.provider || prev.provider,
          model: event.model || prev.model,
        }))
        setBenchmarkRunRuntimeMs(event.elapsedMs || 0)
        setBuilderRunId('')
        setBenchmarkPopupStatus('completed')
      }
    })

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe()
      }
    }
  }, [aiSolverSettings.model, aiSolverSettings.provider, builderRunId])

  useEffect(() => {
    if (
      !builderLiveState.isRunning ||
      !Number.isFinite(benchmarkRunStartedAtMs) ||
      benchmarkRunStartedAtMs <= 0
    ) {
      return undefined
    }

    const intervalId = setInterval(() => {
      setBenchmarkRunRuntimeMs(
        Math.max(0, Date.now() - benchmarkRunStartedAtMs)
      )
    }, 200)

    return () => clearInterval(intervalId)
  }, [benchmarkRunStartedAtMs, builderLiveState.isRunning])

  const isBenchmarkPopupBusy =
    benchmarkPopupStatus === 'countdown' || benchmarkPopupStatus === 'running'
  const benchmarkPresetLabel = benchmarkPresetToLabel(benchmarkRunPreset)

  return (
    <Layout>
      <Page p={0}>
        <Flex
          direction="column"
          flex={1}
          alignSelf="stretch"
          px={20}
          pb={36}
          overflowY="auto"
        >
          <FlipPageTitle
            onClose={() => {
              if (images.some((x) => x))
                toast({
                  status: 'success',
                  // eslint-disable-next-line react/display-name
                  render: () => (
                    <Toast title={t('Flip has been saved to drafts')} />
                  ),
                })
              router.push('/flips/list')
            }}
          >
            {t('New flip')}
          </FlipPageTitle>
          {isOfflineBuilderMode && (
            <Text color="muted" fontSize="sm" mb={3}>
              {t(
                'Offline builder mode: create/import flips for local AI testing. Network publishing still requires a running node.'
              )}
            </Text>
          )}
          {!current.matches('editing') && (
            <Box
              borderWidth="1px"
              borderColor="gray.100"
              borderRadius="md"
              p={4}
              mb={4}
            >
              <Stack spacing={3}>
                <Text color="muted" fontSize="sm">
                  {t(
                    'Preparing flip builder. If your node is offline, start local builder mode now.'
                  )}
                </Text>
                <Stack isInline justify="flex-end">
                  <SecondaryButton
                    onClick={() => {
                      didBootstrapEpochFallback.current = true
                      setIsOfflineBuilderMode(true)
                      send({type: 'SET_EPOCH_NUMBER', epochNumber: 0})
                    }}
                  >
                    {t('Start local builder now')}
                  </SecondaryButton>
                </Stack>
              </Stack>
            </Box>
          )}
          {current.matches('editing') && (
            <FlipMaster>
              <FlipMasterNavbar>
                <FlipMasterNavbarItem
                  step={is('keywords') ? Step.Active : Step.Completed}
                >
                  {t('Think up a story')}
                </FlipMasterNavbarItem>
                <FlipMasterNavbarItem
                  step={
                    // eslint-disable-next-line no-nested-ternary
                    is('images')
                      ? Step.Active
                      : is('keywords')
                      ? Step.Next
                      : Step.Completed
                  }
                >
                  {t('Select images')}
                </FlipMasterNavbarItem>
                <FlipMasterNavbarItem
                  step={
                    // eslint-disable-next-line no-nested-ternary
                    is('shuffle')
                      ? Step.Active
                      : is('keywords') || is('images')
                      ? Step.Next
                      : Step.Completed
                  }
                >
                  {t('Shuffle images')}
                </FlipMasterNavbarItem>
                <FlipMasterNavbarItem
                  step={is('submit') ? Step.Active : Step.Next}
                >
                  {t('Submit flip')}
                </FlipMasterNavbarItem>
              </FlipMasterNavbar>
              <Box
                borderWidth="1px"
                borderColor="orange.100"
                borderRadius="md"
                p={3}
                mt={4}
                mb={4}
                bg="orange.012"
              >
                <Stack spacing={2}>
                  <Stack
                    isInline
                    justify="space-between"
                    align={['flex-start', 'center']}
                  >
                    <Text fontSize="sm" fontWeight={500}>
                      {t('Bulk JSON import for AI benchmark')}
                    </Text>
                    <SecondaryButton onClick={() => send('PICK_SUBMIT')}>
                      {t('Open submit step')}
                    </SecondaryButton>
                  </Stack>
                  <Text color="muted" fontSize="xs">
                    {t(
                      'Visible in every step: load JSON, then add to queue or run now.'
                    )}
                  </Text>
                  <Stack isInline spacing={2} align="center">
                    <SecondaryButton
                      as="label"
                      isLoading={isBuilderJsonLoading}
                      htmlFor="builder-json-file-input-global"
                    >
                      {t('Load JSON file')}
                    </SecondaryButton>
                    <input
                      id="builder-json-file-input-global"
                      type="file"
                      accept=".json,application/json"
                      style={{display: 'none'}}
                      onChange={loadBuilderJsonFile}
                    />
                    {builderJsonFilename ? (
                      <Text fontSize="xs" color="muted">
                        {builderJsonFilename}
                      </Text>
                    ) : null}
                  </Stack>
                  <Textarea
                    value={builderJsonInput}
                    onChange={(e) => {
                      setBuilderJsonInput(e.target.value)
                      if (builderJsonFile) {
                        setBuilderJsonFile(null)
                      }
                    }}
                    minH="88px"
                    maxH="140px"
                    placeholder={t('Paste JSON payload here')}
                  />
                  <Stack isInline justify="flex-end" spacing={2}>
                    <SecondaryButton
                      isDisabled={!hasBuilderJsonSource}
                      onClick={() => {
                        setBuilderJsonInput('')
                        setBuilderJsonFilename('')
                        setBuilderJsonFile(null)
                      }}
                    >
                      {t('Clear JSON')}
                    </SecondaryButton>
                    <SecondaryButton
                      isDisabled={!hasBuilderJsonSource}
                      isLoading={isBuilderJsonAdding}
                      onClick={addBuilderJsonToQueue}
                    >
                      {t('Add JSON to queue')}
                    </SecondaryButton>
                    <PrimaryButton
                      isDisabled={!hasBuilderJsonSource}
                      isLoading={isBuilderJsonRunning}
                      onClick={runBuilderJsonNow}
                    >
                      {t('Run JSON now')}
                    </PrimaryButton>
                  </Stack>
                </Stack>
              </Box>
              {is('keywords') && (
                <FlipStoryStep>
                  <FlipStepBody minH="180px">
                    <Box>
                      <FlipKeywordPanel>
                        {is('keywords.loaded') && (
                          <>
                            <FlipKeywordTranslationSwitch
                              keywords={keywords}
                              showTranslation={showTranslation}
                              locale={i18n.language}
                              onSwitchLocale={() => send('SWITCH_LOCALE')}
                            />
                            {(i18n.language || 'en').toUpperCase() !== 'EN' &&
                              !isOffline && (
                                <>
                                  <Divider
                                    borderColor="gray.300"
                                    mx={-10}
                                    mt={4}
                                    mb={6}
                                  />
                                  <CommunityTranslations
                                    keywords={keywords}
                                    onVote={(e) => send('VOTE', e)}
                                    onSuggest={(e) => send('SUGGEST', e)}
                                    isOpen={isCommunityTranslationsExpanded}
                                    isPending={is(
                                      'keywords.loaded.fetchedTranslations.suggesting'
                                    )}
                                    onToggle={() =>
                                      send('TOGGLE_COMMUNITY_TRANSLATIONS')
                                    }
                                  />
                                </>
                              )}
                          </>
                        )}
                        {is('keywords.failure') && (
                          <FlipKeyword>
                            <FlipKeywordName>
                              {t('Missing keywords')}
                            </FlipKeywordName>
                          </FlipKeyword>
                        )}
                      </FlipKeywordPanel>
                      {isOffline && <CommunityTranslationUnavailable />}
                    </Box>
                    <FlipStoryAside>
                      <IconButton2
                        icon={<RefreshIcon />}
                        isDisabled={
                          availableKeywords.length < 2 || is('keywords.loading')
                        }
                        onClick={() => send('CHANGE_KEYWORDS')}
                      >
                        {t('Change words')}{' '}
                        {availableKeywords.length > 1
                          ? `(#${keywordPairId + 1})`
                          : null}
                      </IconButton2>
                      <IconButton2
                        icon={<InfoIcon />}
                        onClick={onOpenBadFlipDialog}
                      >
                        {t('What is a bad flip')}
                      </IconButton2>
                    </FlipStoryAside>
                  </FlipStepBody>
                </FlipStoryStep>
              )}
              {is('images') && (
                <FlipEditorStep
                  keywords={keywords}
                  showTranslation={showTranslation}
                  originalOrder={originalOrder}
                  images={images}
                  adversarialImageId={adversarialImageId}
                  onChangeImage={(image, currentIndex) =>
                    send('CHANGE_IMAGES', {image, currentIndex})
                  }
                  // eslint-disable-next-line no-shadow
                  onChangeOriginalOrder={(order) =>
                    send('CHANGE_ORIGINAL_ORDER', {order})
                  }
                  onPainting={() => send('PAINTING')}
                  onChangeAdversarialId={(newIndex) => {
                    send('CHANGE_ADVERSARIAL_ID', {newIndex})
                  }}
                />
              )}
              {is('shuffle') && (
                <FlipShuffleStep
                  images={draftImages}
                  originalOrder={originalOrder}
                  order={order}
                  onShuffle={() => send('SHUFFLE')}
                  onManualShuffle={(nextOrder) =>
                    send('MANUAL_SHUFFLE', {order: nextOrder})
                  }
                  onReset={() => send('RESET_SHUFFLE')}
                />
              )}
              {is('submit') && (
                <>
                  <FlipSubmitStep
                    keywords={keywords}
                    showTranslation={showTranslation}
                    locale={i18n.language}
                    onSwitchLocale={() => send('SWITCH_LOCALE')}
                    originalOrder={originalOrder}
                    order={order}
                    images={draftImages}
                  />
                  <Box
                    id="ai-benchmark"
                    mt={6}
                    borderWidth="1px"
                    borderColor="gray.100"
                    borderRadius="md"
                    p={4}
                  >
                    <Stack spacing={4}>
                      <Text fontWeight={500}>
                        {t('AI benchmark helper (regular builder flow)')}
                      </Text>
                      <Text color="muted" fontSize="sm">
                        {t(
                          'Use queue and JSON tools directly in the normal flip submit step. This keeps testing in the same workflow regular users already know.'
                        )}
                      </Text>
                      <Stack isInline justify="flex-end" spacing={2}>
                        <SecondaryButton
                          onClick={() => router.push('/settings/ai')}
                        >
                          {t('AI settings')}
                        </SecondaryButton>
                        <SecondaryButton
                          isLoading={isAddingToTestUnit}
                          onClick={addDraftToTestUnit}
                        >
                          {t('Add current draft flip to queue')}
                        </SecondaryButton>
                        <SecondaryButton
                          isLoading={isAiDraftTesting}
                          onClick={runAiTestBeforeSubmit}
                        >
                          {t('Run current draft now')}
                        </SecondaryButton>
                      </Stack>

                      <SimpleGrid columns={[1, 2]} spacing={3}>
                        <Box>
                          <Text fontSize="xs" color="muted" mb={1}>
                            {t('Provider')}
                          </Text>
                          <Input value={aiSolverSettings.provider} isReadOnly />
                        </Box>
                        <Box>
                          <Text fontSize="xs" color="muted" mb={1}>
                            {t('Model')}
                          </Text>
                          <Input value={aiSolverSettings.model} isReadOnly />
                        </Box>
                        <Box>
                          <Text fontSize="xs" color="muted" mb={1}>
                            {t('Batch size')}
                          </Text>
                          <Input
                            type="number"
                            min={1}
                            max={100}
                            value={builderBatchSize}
                            onChange={(e) =>
                              setBuilderBatchSize(toInt(e.target.value, 3))
                            }
                          />
                        </Box>
                        <Box>
                          <Text fontSize="xs" color="muted" mb={1}>
                            {t('Max flips per run')}
                          </Text>
                          <Input
                            type="number"
                            min={1}
                            max={2000}
                            value={builderMaxFlips}
                            onChange={(e) =>
                              setBuilderMaxFlips(toInt(e.target.value, 6))
                            }
                          />
                        </Box>
                      </SimpleGrid>

                      <Flex align="center" justify="space-between">
                        <Text fontSize="sm" color="muted">
                          {t('Dequeue after run')}
                        </Text>
                        <Switch
                          isChecked={builderDequeue}
                          onChange={() => setBuilderDequeue(!builderDequeue)}
                        />
                      </Flex>

                      <Stack isInline justify="flex-end" spacing={2}>
                        <SecondaryButton
                          isLoading={isBuilderQueueLoading}
                          onClick={reloadBuilderQueue}
                        >
                          {t('Reload queue')}
                        </SecondaryButton>
                        <SecondaryButton
                          isLoading={isBuilderQueueClearing}
                          onClick={async () => {
                            setIsBuilderQueueClearing(true)
                            try {
                              const bridge = ensureAiTestUnitBridge()
                              await bridge.clearFlips({})
                              notify(
                                t('Queue cleared'),
                                t('Local test unit queue is empty.')
                              )
                              await reloadBuilderQueue()
                            } catch (error) {
                              notify(
                                t('Unable to clear queue'),
                                error.toString(),
                                'error'
                              )
                            } finally {
                              setIsBuilderQueueClearing(false)
                            }
                          }}
                        >
                          {t('Clear queue')}
                        </SecondaryButton>
                        <SecondaryButton
                          isLoading={isBuilderQueueRunning}
                          onClick={() => runBuilderQueue({preset: 'long'})}
                        >
                          {t('Run long (14)')}
                        </SecondaryButton>
                        <PrimaryButton
                          isLoading={isBuilderQueueRunning}
                          onClick={() => runBuilderQueue({preset: 'short'})}
                        >
                          {t('Run short (6)')}
                        </PrimaryButton>
                        <PrimaryButton
                          isLoading={isBuilderQueueRunning}
                          onClick={() => runBuilderQueue({preset: 'custom'})}
                        >
                          {t('Run queue (custom)')}
                        </PrimaryButton>
                      </Stack>

                      <Text color="muted" fontSize="sm">
                        {t('Queue size: {{count}}', {count: builderQueueTotal})}
                      </Text>
                      <Box
                        borderWidth="1px"
                        borderColor="gray.100"
                        borderRadius="md"
                        p={3}
                      >
                        <Stack spacing={1}>
                          <Text fontSize="sm" fontWeight={500}>
                            {t('Cost estimate before run')}
                          </Text>
                          <Text fontSize="xs" color="muted">
                            {modelCostEstimate.pricing
                              ? t(
                                  'Model {{model}} pricing: input {{inputUsd}} / output {{outputUsd}} per 1M tokens',
                                  {
                                    model: modelCostEstimate.model || '-',
                                    inputUsd: `$${modelCostEstimate.pricing.input}`,
                                    outputUsd: `$${modelCostEstimate.pricing.output}`,
                                  }
                                )
                              : t(
                                  'No built-in pricing available for current provider/model. Token estimate is still shown.'
                                )}
                          </Text>
                          <Text fontSize="xs" color="muted">
                            {modelCostEstimate.tokenProfile.basis === 'last_run'
                              ? t(
                                  'Token estimate basis: last run average for same provider/model.'
                                )
                              : t(
                                  'Token estimate basis: heuristic for selected flip vision mode.'
                                )}
                          </Text>
                          <Text fontSize="xs" color="muted">
                            {`short(6): ~${
                              modelCostEstimate.short.expectedPromptTokens
                            } in / ${
                              modelCostEstimate.short.expectedCompletionTokens
                            } out tokens | expected ${
                              modelCostEstimate.pricing
                                ? formatUsd(
                                    modelCostEstimate.short.expectedCost
                                  )
                                : '-'
                            } | worst ${
                              modelCostEstimate.pricing
                                ? formatUsd(modelCostEstimate.short.worstCost)
                                : '-'
                            }`}
                          </Text>
                          <Text fontSize="xs" color="muted">
                            {`long(14): ~${
                              modelCostEstimate.long.expectedPromptTokens
                            } in / ${
                              modelCostEstimate.long.expectedCompletionTokens
                            } out tokens | expected ${
                              modelCostEstimate.pricing
                                ? formatUsd(modelCostEstimate.long.expectedCost)
                                : '-'
                            } | worst ${
                              modelCostEstimate.pricing
                                ? formatUsd(modelCostEstimate.long.worstCost)
                                : '-'
                            }`}
                          </Text>
                          <Text fontSize="xs" color="muted">
                            {`custom(${modelCostEstimate.custom.flipCount}): ~${
                              modelCostEstimate.custom.expectedPromptTokens
                            } in / ${
                              modelCostEstimate.custom.expectedCompletionTokens
                            } out tokens | expected ${
                              modelCostEstimate.pricing
                                ? formatUsd(
                                    modelCostEstimate.custom.expectedCost
                                  )
                                : '-'
                            } | worst ${
                              modelCostEstimate.pricing
                                ? formatUsd(modelCostEstimate.custom.worstCost)
                                : '-'
                            }`}
                          </Text>
                        </Stack>
                      </Box>
                      <Box
                        borderWidth="1px"
                        borderColor="gray.100"
                        borderRadius="md"
                        p={3}
                      >
                        <Stack spacing={2}>
                          <Text fontSize="sm" fontWeight={500}>
                            {t('Session split preview (20 flips)')}
                          </Text>
                          <Text fontSize="xs" color="muted">
                            {`short ${sessionPackPreview.shortFlips.length}/6 | long ${sessionPackPreview.longFlips.length}/14 | total ${sessionPackPreview.total}/20`}
                          </Text>
                          <SimpleGrid columns={[1, 2]} spacing={2}>
                            <Box>
                              <Text fontSize="xs" color="muted" mb={1}>
                                {t('Short session (6)')}
                              </Text>
                              <Stack spacing={1} maxH="110px" overflowY="auto">
                                {sessionPackPreview.shortFlips.length ? (
                                  sessionPackPreview.shortFlips.map((item) => (
                                    <Text
                                      key={`short-${item.id || item.hash}`}
                                      fontSize="xs"
                                      color="muted"
                                    >
                                      {item.hash}
                                    </Text>
                                  ))
                                ) : (
                                  <Text fontSize="xs" color="muted">
                                    {t('No flips loaded yet')}
                                  </Text>
                                )}
                              </Stack>
                            </Box>
                            <Box>
                              <Text fontSize="xs" color="muted" mb={1}>
                                {t('Long session (14)')}
                              </Text>
                              <Stack spacing={1} maxH="110px" overflowY="auto">
                                {sessionPackPreview.longFlips.length ? (
                                  sessionPackPreview.longFlips.map((item) => (
                                    <Text
                                      key={`long-${item.id || item.hash}`}
                                      fontSize="xs"
                                      color="muted"
                                    >
                                      {item.hash}
                                    </Text>
                                  ))
                                ) : (
                                  <Text fontSize="xs" color="muted">
                                    {t('No flips loaded yet')}
                                  </Text>
                                )}
                              </Stack>
                            </Box>
                          </SimpleGrid>
                        </Stack>
                      </Box>

                      {builderQueue.length > 0 ? (
                        <Stack
                          spacing={1}
                          borderWidth="1px"
                          borderColor="gray.100"
                          borderRadius="md"
                          p={3}
                          maxH="160px"
                          overflowY="auto"
                        >
                          {builderQueue.slice(0, 10).map((item) => (
                            <Text
                              key={item.id || item.hash}
                              fontSize="xs"
                              color="muted"
                            >
                              {`${item.hash} (${item.source || 'manual'})`}
                            </Text>
                          ))}
                        </Stack>
                      ) : null}

                      <Box
                        borderWidth="1px"
                        borderColor="gray.100"
                        borderRadius="md"
                        p={3}
                      >
                        <Stack spacing={2}>
                          <Text fontSize="sm" fontWeight={500}>
                            {t('Session monitor')}
                          </Text>
                          <Text color="muted" fontSize="xs">
                            {`${
                              builderLiveState.isRunning ? 'running' : 'idle'
                            } | ${
                              builderLiveState.provider ||
                              aiSolverSettings.provider
                            } ${
                              builderLiveState.model || aiSolverSettings.model
                            } | ${benchmarkPresetLabel} | ${
                              builderLiveState.processed || 0
                            }/${builderLiveState.totalFlips || 0} flips | ${
                              builderLiveState.totalBatches || 0
                            } batches | elapsed ${
                              builderLiveState.elapsedMs || 0
                            }ms | runtime ${benchmarkRunRuntimeMs}ms`}
                          </Text>
                          <Text fontSize="xs" color="muted">
                            {builderLiveCurrentFlip
                              ? `#${
                                  (builderLiveCurrentFlip.flipIndex || 0) + 1
                                } ${
                                  builderLiveCurrentFlip.hash || '-'
                                } -> ${String(
                                  builderLiveCurrentFlip.answer || 'analyzing'
                                ).toUpperCase()} | ${
                                  builderLiveCurrentFlip.latencyMs || 0
                                }ms | tokens ${tokenCount(
                                  builderLiveCurrentFlip
                                )}${expectedSuffix(
                                  builderLiveCurrentFlip.expectedAnswer,
                                  builderLiveCurrentFlip.isCorrect
                                )}`
                              : t(
                                  'Start queue or JSON run to open live session preview.'
                                )}
                          </Text>
                          <Stack isInline justify="flex-end">
                            <SecondaryButton
                              onClick={() =>
                                benchmarkSessionDisclosure.onOpen()
                              }
                            >
                              {t('Open live session preview')}
                            </SecondaryButton>
                          </Stack>
                        </Stack>
                      </Box>

                      {builderLastRun ? (
                        <Stack spacing={1}>
                          <Text fontSize="xs" color="muted">
                            {`${builderLastRun.totalFlips} flips, ${
                              builderLastRun.totalBatches
                            } batches, ${builderLastRun.elapsedMs}ms | left ${
                              (builderLastRun.summary &&
                                builderLastRun.summary.left) ||
                              0
                            }, right ${
                              (builderLastRun.summary &&
                                builderLastRun.summary.right) ||
                              0
                            }, skipped ${
                              (builderLastRun.summary &&
                                builderLastRun.summary.skipped) ||
                              0
                            }`}
                          </Text>
                          {builderLastRun.summary &&
                          builderLastRun.summary.evaluation ? (
                            <>
                              {builderLastRun.summary.evaluation.labeled > 0 ? (
                                <Text fontSize="xs" color="muted">
                                  {`accuracy labeled ${toPercent(
                                    builderLastRun.summary.evaluation
                                      .accuracyLabeled
                                  )} (${
                                    builderLastRun.summary.evaluation.correct
                                  }/${
                                    builderLastRun.summary.evaluation.labeled
                                  }) | accuracy answered ${toPercent(
                                    builderLastRun.summary.evaluation
                                      .accuracyAnswered
                                  )} (${
                                    builderLastRun.summary.evaluation
                                      .correctAnswered
                                  }/${
                                    builderLastRun.summary.evaluation.answered
                                  })`}
                                </Text>
                              ) : null}
                              {builderLastRun.summary.evaluation.labeled < 1 ? (
                                <Text fontSize="xs" color="muted">
                                  {t(
                                    'Audit unavailable for this run: flips had no expectedAnswer labels.'
                                  )}
                                </Text>
                              ) : null}
                            </>
                          ) : null}
                        </Stack>
                      ) : null}
                    </Stack>
                  </Box>
                </>
              )}
            </FlipMaster>
          )}
        </Flex>
        <FlipMasterFooter>
          {not('keywords') && (
            <SecondaryButton
              isDisabled={is('images.painting')}
              onClick={() => send('PREV')}
            >
              {t('Previous step')}
            </SecondaryButton>
          )}
          {not('submit') && (
            <PrimaryButton
              isDisabled={is('images.painting') || is('keywords.loading')}
              onClick={() => send('NEXT')}
            >
              {t('Next step')}
            </PrimaryButton>
          )}
          {is('submit') && (
            <PrimaryButton
              isDisabled={is('submit.submitting')}
              isLoading={is('submit.submitting')}
              loadingText={t('Publishing')}
              onClick={() => {
                if (syncing) {
                  failToast('Can not submit flip while node is synchronizing')
                  return
                }
                if (offline) {
                  failToast('Can not submit flip. Node is offline')
                  return
                }
                publishDrawerDisclosure.onOpen()
              }}
            >
              {t('Submit')}
            </PrimaryButton>
          )}
        </FlipMasterFooter>

        <BadFlipDialog
          isOpen={isOpenBadFlipDialog || !didShowBadFlip}
          title={t('What is a bad flip?')}
          subtitle={t(
            'Please read the rules carefully. You can lose all your validation rewards if any of your flips is reported.'
          )}
          onClose={async () => {
            await global.sub(requestDb(), 'flips').put('didShowBadFlipNew', 1)
            send('SKIP_BAD_FLIP')
            onCloseBadFlipDialog()
          }}
        />

        <Modal
          isOpen={benchmarkSessionDisclosure.isOpen}
          onClose={() => {
            if (!isBenchmarkPopupBusy) {
              setBenchmarkPopupStatus('idle')
              benchmarkSessionDisclosure.onClose()
            }
          }}
          closeOnEsc={!isBenchmarkPopupBusy}
          closeOnOverlayClick={!isBenchmarkPopupBusy}
          size="5xl"
        >
          <ModalOverlay />
          <ModalContent>
            <ModalHeader>
              {`${t('AI benchmark session preview')} (${benchmarkPresetLabel})`}
            </ModalHeader>
            {!isBenchmarkPopupBusy && <ModalCloseButton />}
            <ModalBody>
              <Stack spacing={4}>
                <Text color="muted" fontSize="sm">
                  {t(
                    'Regular solving-style preview. AI processes flips sequentially, one by one.'
                  )}
                </Text>

                <Box
                  borderWidth="1px"
                  borderColor="gray.100"
                  borderRadius="md"
                  p={3}
                  bg="black"
                >
                  <Stack spacing={3}>
                    <Text fontSize="sm" color="white" fontWeight={500}>
                      {t('Select meaningful story: left or right')}
                    </Text>
                    <Text fontSize="xs" color="whiteAlpha.800">
                      {`${builderLiveState.processed || 0}/${
                        builderLiveState.totalFlips || 0
                      } flips | ${
                        builderLiveState.totalBatches || 0
                      } batches | elapsed ${
                        builderLiveState.elapsedMs || 0
                      }ms | runtime ${benchmarkRunRuntimeMs}ms`}
                    </Text>
                    {benchmarkPopupStatus === 'countdown' && (
                      <Text fontSize="lg" color="orange.300" fontWeight={600}>
                        {t('Starting in {{seconds}}s', {
                          seconds: benchmarkCountdown || 0,
                        })}
                      </Text>
                    )}
                    {benchmarkPopupStatus === 'completed' && (
                      <Text fontSize="sm" color="green.300" fontWeight={600}>
                        {t('Benchmark run completed')}
                      </Text>
                    )}
                    {benchmarkPopupStatus === 'failed' && (
                      <Text fontSize="sm" color="red.300" fontWeight={600}>
                        {t('Benchmark run failed')}
                      </Text>
                    )}
                    {builderLiveCurrentFlip ? (
                      <>
                        <SimpleGrid columns={[1, 2]} spacing={3}>
                          {String(
                            builderLiveCurrentFlip.leftImage || ''
                          ).startsWith('data:') ? (
                            <Box>
                              <Text
                                mb={1}
                                fontSize="xs"
                                color={
                                  String(
                                    builderLiveCurrentFlip.answer || ''
                                  ).toLowerCase() === 'left'
                                    ? 'blue.200'
                                    : 'whiteAlpha.700'
                                }
                                fontWeight={600}
                              >
                                {t('Left side')}
                              </Text>
                              <img
                                src={builderLiveCurrentFlip.leftImage}
                                alt={`benchmark-left-${
                                  builderLiveCurrentFlip.hash || 'flip'
                                }`}
                                style={{
                                  width: '100%',
                                  maxHeight: 280,
                                  objectFit: 'contain',
                                  border:
                                    String(
                                      builderLiveCurrentFlip.answer || ''
                                    ).toLowerCase() === 'left'
                                      ? '2px solid #63b3ed'
                                      : '1px solid rgba(255,255,255,0.25)',
                                  borderRadius: 8,
                                  background: 'rgba(255,255,255,0.06)',
                                }}
                              />
                            </Box>
                          ) : (
                            <Box
                              borderWidth="1px"
                              borderColor="whiteAlpha.300"
                              borderRadius="md"
                              p={3}
                            >
                              <Text fontSize="xs" color="whiteAlpha.800">
                                {t('Left image unavailable')}
                              </Text>
                            </Box>
                          )}
                          {String(
                            builderLiveCurrentFlip.rightImage || ''
                          ).startsWith('data:') ? (
                            <Box>
                              <Text
                                mb={1}
                                fontSize="xs"
                                color={
                                  String(
                                    builderLiveCurrentFlip.answer || ''
                                  ).toLowerCase() === 'right'
                                    ? 'blue.200'
                                    : 'whiteAlpha.700'
                                }
                                fontWeight={600}
                              >
                                {t('Right side')}
                              </Text>
                              <img
                                src={builderLiveCurrentFlip.rightImage}
                                alt={`benchmark-right-${
                                  builderLiveCurrentFlip.hash || 'flip'
                                }`}
                                style={{
                                  width: '100%',
                                  maxHeight: 280,
                                  objectFit: 'contain',
                                  border:
                                    String(
                                      builderLiveCurrentFlip.answer || ''
                                    ).toLowerCase() === 'right'
                                      ? '2px solid #63b3ed'
                                      : '1px solid rgba(255,255,255,0.25)',
                                  borderRadius: 8,
                                  background: 'rgba(255,255,255,0.06)',
                                }}
                              />
                            </Box>
                          ) : (
                            <Box
                              borderWidth="1px"
                              borderColor="whiteAlpha.300"
                              borderRadius="md"
                              p={3}
                            >
                              <Text fontSize="xs" color="whiteAlpha.800">
                                {t('Right image unavailable')}
                              </Text>
                            </Box>
                          )}
                        </SimpleGrid>

                        <Text fontSize="sm" color="whiteAlpha.900">
                          {builderLiveCurrentFlip.answer
                            ? t(
                                'AI selected {{side}} in {{latency}}ms (tokens {{tokens}})',
                                {
                                  side: String(
                                    builderLiveCurrentFlip.answer || 'skip'
                                  ).toUpperCase(),
                                  latency:
                                    builderLiveCurrentFlip.latencyMs || 0,
                                  tokens: tokenCount(builderLiveCurrentFlip),
                                }
                              )
                            : t('Analyzing current flip...')}
                        </Text>
                      </>
                    ) : (
                      <Text fontSize="sm" color="whiteAlpha.800">
                        {benchmarkPopupStatus === 'countdown'
                          ? t('Preparing benchmark session...')
                          : t('Waiting for first flip...')}
                      </Text>
                    )}
                  </Stack>
                </Box>

                <Stack
                  spacing={1}
                  borderWidth="1px"
                  borderColor="gray.100"
                  borderRadius="md"
                  p={3}
                  maxH="160px"
                  overflowY="auto"
                >
                  {builderLiveTimeline.length ? (
                    builderLiveTimeline.map((event, idx) => (
                      <Text
                        key={`${event.hash || 'flip'}-${
                          event.flipIndex || 0
                        }-${idx}`}
                        fontSize="xs"
                        color="muted"
                      >
                        {`#${(event.flipIndex || 0) + 1} ${String(
                          event.answer || 'skip'
                        ).toUpperCase()} ${event.hash || '-'} | ${
                          event.latencyMs || 0
                        }ms | tok ${tokenCount(event)}${expectedSuffix(
                          event.expectedAnswer,
                          event.isCorrect,
                          {
                            okLabel: 'ok',
                            missLabel: 'miss',
                          }
                        ).replace(' | expected ', ' | exp ')}${
                          event.sideSwapped ? ' | swap' : ''
                        }${event.error ? ' | error' : ''}`}
                      </Text>
                    ))
                  ) : (
                    <Text fontSize="xs" color="muted">
                      {t('No decisions yet.')}
                    </Text>
                  )}
                </Stack>
              </Stack>
            </ModalBody>
            <ModalFooter>
              <SecondaryButton
                isDisabled={isBenchmarkPopupBusy}
                onClick={() => {
                  setBenchmarkPopupStatus('idle')
                  benchmarkSessionDisclosure.onClose()
                }}
              >
                {t('Close')}
              </SecondaryButton>
            </ModalFooter>
          </ModalContent>
        </Modal>

        <PublishFlipDrawer
          {...publishDrawerDisclosure}
          isPending={either('submit.submitting', 'submit.mining')}
          isAiTesting={isAiDraftTesting}
          isAddingToTestUnit={isAddingToTestUnit}
          aiTestResult={aiDraftTestResult}
          flip={{
            keywords: showTranslation ? keywords.translations : keywords.words,
            images: draftImages,
            originalOrder,
            order,
          }}
          onAiTest={runAiTestBeforeSubmit}
          onAddToTestUnit={addDraftToTestUnit}
          onSubmit={() => {
            send('SUBMIT')
          }}
        />

        {global.isDev && (
          <FloatDebug>{JSON.stringify(current.value)}</FloatDebug>
        )}
      </Page>
    </Layout>
  )
}
