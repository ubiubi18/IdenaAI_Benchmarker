/* eslint-disable react/prop-types */
import React, {useCallback, useEffect, useMemo, useState} from 'react'
import {
  Box,
  Flex,
  ListItem,
  UnorderedList,
  Stack,
  Text,
  Switch,
  useToast,
  InputRightElement,
  InputGroup,
  IconButton,
} from '@chakra-ui/react'
import {useRouter} from 'next/router'
import {useTranslation} from 'react-i18next'
import SettingsLayout from '../../screens/settings/layout'
import {
  SettingsFormControl,
  SettingsFormLabel,
  SettingsSection,
} from '../../screens/settings/components'
import {
  Input,
  Select,
  Textarea,
  Toast,
} from '../../shared/components/components'
import {PrimaryButton, SecondaryButton} from '../../shared/components/button'
import {
  useSettingsDispatch,
  useSettingsState,
} from '../../shared/providers/settings-context'
import {EyeIcon, EyeOffIcon} from '../../shared/components/icons'
import {
  checkAiProviderReadiness,
  formatAiProviderLabel,
  formatMissingAiProviders,
  isLocalAiProvider,
  resolveLocalAiProviderState,
} from '../../shared/utils/ai-provider-readiness'
import {AiEnableDialog} from '../../shared/components/ai-enable-dialog'
import {
  DEFAULT_LOCAL_AI_SETTINGS,
  DEFAULT_LOCAL_AI_PUBLIC_MODEL_ID,
  DEFAULT_LOCAL_AI_PUBLIC_VISION_ID,
  FALLBACK_LOCAL_AI_TRAINING_MODEL,
  RECOMMENDED_LOCAL_AI_OLLAMA_MODEL,
  RECOMMENDED_LOCAL_AI_OLLAMA_VISION_MODEL,
  RECOMMENDED_LOCAL_AI_TRAINING_MODEL,
  STRONG_FALLBACK_LOCAL_AI_TRAINING_MODEL,
  buildRecommendedLocalAiMacPreset,
  buildLocalAiRuntimePreset,
  buildLocalAiSettings,
  getLocalAiEndpointSafety,
  resolveLocalAiWireRuntimeType,
} from '../../shared/utils/local-ai-settings'

const DEFAULT_MODELS = {
  'local-ai': RECOMMENDED_LOCAL_AI_OLLAMA_MODEL,
  openai: 'gpt-5.4',
  'openai-compatible': 'gpt-4o-mini',
  gemini: 'gemini-2.0-flash',
  anthropic: 'claude-3-7-sonnet-latest',
  xai: 'grok-2-vision-latest',
  mistral: 'mistral-large-latest',
  groq: 'llama-3.2-90b-vision-preview',
  deepseek: 'deepseek-chat',
  openrouter: 'openai/gpt-4o-mini',
}

const MODEL_PRESETS = {
  'local-ai': [],
  openai: [
    'gpt-5.4',
    'gpt-5.3-chat-latest',
    'gpt-5.3-codex',
    'gpt-5-mini',
    'gpt-4.1',
    'gpt-4.1-mini',
    'gpt-4o',
    'gpt-4o-mini',
    'o4-mini',
  ],
  'openai-compatible': [
    'gpt-5.4',
    'gpt-5.3-chat-latest',
    'gpt-5.3-codex',
    'gpt-5-mini',
    'gpt-4o-mini',
    'gpt-4o',
    'gpt-4.1-mini',
    'gpt-4.1',
    'o4-mini',
  ],
  gemini: ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
  anthropic: [
    'claude-3-7-sonnet-latest',
    'claude-3-5-sonnet-latest',
    'claude-3-5-haiku-latest',
  ],
  xai: ['grok-2-vision-latest', 'grok-2-latest'],
  mistral: ['mistral-large-latest', 'pixtral-large-latest', 'pixtral-12b'],
  groq: [
    'llama-3.2-90b-vision-preview',
    'meta-llama/llama-4-scout-17b-16e-instruct',
  ],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  openrouter: [
    'openai/gpt-4o-mini',
    'openai/gpt-4.1-mini',
    'anthropic/claude-3.7-sonnet',
    'google/gemini-2.0-flash-001',
  ],
}

const MAIN_PROVIDER_OPTIONS = [
  {value: 'local-ai', label: 'Local AI runtime'},
  {value: 'openai', label: 'OpenAI'},
  {value: 'anthropic', label: 'Anthropic Claude'},
  {value: 'gemini', label: 'Google Gemini'},
  {value: 'xai', label: 'xAI (Grok)'},
  {value: 'mistral', label: 'Mistral'},
  {value: 'groq', label: 'Groq'},
  {value: 'deepseek', label: 'DeepSeek'},
  {value: 'openrouter', label: 'OpenRouter'},
  {value: 'openai-compatible', label: 'OpenAI-compatible (custom)'},
]

const CONSULT_PROVIDER_OPTIONS = MAIN_PROVIDER_OPTIONS.filter(
  ({value}) => value !== 'local-ai'
)

const LOCAL_AI_RUNTIME_OPTIONS = [
  {
    value: 'ollama-direct',
    label: 'Local runtime via Ollama (recommended on Mac)',
  },
  {value: 'sidecar-http', label: 'Legacy HTTP sidecar'},
]

const DEFAULT_AI_SETTINGS = {
  enabled: false,
  provider: 'openai',
  model: DEFAULT_MODELS.openai,
  mode: 'manual',
  autoReportEnabled: false,
  autoReportDelayMinutes: 10,
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
  ensembleModel2: DEFAULT_MODELS.gemini,
  ensembleProvider2Weight: 1,
  ensembleProvider3Enabled: false,
  ensembleProvider3: 'openai',
  ensembleModel3: 'gpt-4.1-mini',
  ensembleProvider3Weight: 1,
  customProviderName: 'Custom OpenAI-compatible',
  customProviderBaseUrl: 'https://api.openai.com/v1',
  customProviderChatPath: '/chat/completions',
}

const DEFAULT_LOCAL_AI_DEBUG_CHAT_PROMPT =
  'Reply with one short sentence confirming local chat works.'

const DEFAULT_LOCAL_AI_DEBUG_FLIP_INPUT = `{
  "images": [
    "/absolute/path/to/panel-1.png",
    "/absolute/path/to/panel-2.png"
  ]
}`

function numberOrFallback(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function floatOrFallback(value, fallback) {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function weightOrFallback(value, fallback = 1) {
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }
  return Math.min(10, Math.max(0.05, parsed))
}

function isCustomConfigProvider(provider) {
  return provider === 'openai-compatible'
}

function buildProviderConfigForBridge(aiSolver, provider) {
  if (!isCustomConfigProvider(provider)) {
    return null
  }

  return {
    name: aiSolver.customProviderName,
    baseUrl: aiSolver.customProviderBaseUrl,
    chatPath: aiSolver.customProviderChatPath,
  }
}

function resolveDefaultModelForProvider(provider, localAi = {}) {
  if (isLocalAiProvider(provider)) {
    return (
      String(localAi && localAi.model ? localAi.model : '').trim() ||
      RECOMMENDED_LOCAL_AI_OLLAMA_MODEL
    )
  }

  return DEFAULT_MODELS[provider] || DEFAULT_MODELS.openai
}

function formatLocalAiRuntimeRequirement(error, t) {
  const message = String(error || '').trim()

  if (message === 'local_ai_disabled') {
    return t(
      'Enable Local AI in the Local AI section below, then check the runtime status.'
    )
  }

  if (message === 'local_ai_bridge_unavailable') {
    return t('Local AI bridge is unavailable in this build.')
  }

  if (message === 'local_ai_unavailable') {
    return t('The configured Local AI runtime is not reachable yet.')
  }

  return message || t('The configured Local AI runtime is not reachable yet.')
}

function formatErrorForToast(error) {
  const raw = String((error && error.message) || error || '').trim()
  const prefix = /Error invoking remote method '[^']+':\s*/i
  const withoutIpcPrefix = raw.replace(prefix, '').trim()
  const message = withoutIpcPrefix || 'Unknown error'

  if (
    /(?:^|\\s)429(?:\\s|$)/.test(message) ||
    /insufficient_quota|rate.?limit/i.test(message)
  ) {
    return `${message}. OpenAI returned 429: check API billing/credits, project budget limits, and retry after a short delay.`
  }

  return message
}

function formatLocalAiStatusDescription(result, t) {
  const modelCount = Number(result && result.sidecarModelCount) || 0
  const baseUrl = String(result && result.baseUrl ? result.baseUrl : '').trim()

  if (result && result.sidecarReachable) {
    return t('{{count}} model(s) discovered at {{baseUrl}}.', {
      count: modelCount,
      baseUrl: baseUrl || 'the configured Local AI URL',
    })
  }

  return (
    String(result && result.lastError).trim() ||
    t('No Local AI runtime responded at {{baseUrl}}.', {
      baseUrl: baseUrl || 'the configured Local AI URL',
    })
  )
}

function normalizeLocalAiStatusResult(result, fallbackBaseUrl) {
  const reachable =
    result && typeof result.sidecarReachable === 'boolean'
      ? result.sidecarReachable
      : null

  return {
    enabled: result ? result.enabled !== false : true,
    status:
      String(result && result.status ? result.status : '').trim() ||
      (reachable === true ? 'ok' : 'error'),
    runtime:
      String(
        result &&
          (result.runtimeBackend || result.runtime || result.runtimeType)
          ? result.runtimeBackend || result.runtime || result.runtimeType
          : DEFAULT_LOCAL_AI_SETTINGS.runtimeBackend
      ).trim() || DEFAULT_LOCAL_AI_SETTINGS.runtimeBackend,
    baseUrl:
      String(
        result && result.baseUrl ? result.baseUrl : fallbackBaseUrl || ''
      ).trim() || String(fallbackBaseUrl || '').trim(),
    sidecarReachable: reachable === true,
    sidecarModelCount: Number(result && result.sidecarModelCount) || 0,
    error:
      String((result && (result.error || result.lastError)) || '').trim() ||
      null,
    lastError: String((result && result.lastError) || '').trim() || null,
  }
}

function formatLocalAiDebugResult(result) {
  if (!result) {
    return ''
  }

  try {
    return JSON.stringify(result, null, 2)
  } catch {
    return String(result)
  }
}

function parseLocalAiDebugJsonInput(value) {
  const text = String(value || '').trim()

  if (!text) {
    return {
      ok: false,
      error: 'Provide JSON input with one or more local panel image paths.',
    }
  }

  try {
    const parsed = JSON.parse(text)

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        ok: false,
        error: 'Debug input must be a JSON object.',
      }
    }

    return {
      ok: true,
      value: parsed,
    }
  } catch (error) {
    return {
      ok: false,
      error: String((error && error.message) || error || '').trim(),
    }
  }
}

function formatLocalAiTrainingPackageTimestamp(value) {
  const text = String(value || '').trim()

  if (!text) {
    return '-'
  }

  const nextDate = new Date(text)

  if (!Number.isFinite(nextDate.getTime())) {
    return text
  }

  return nextDate.toLocaleString()
}

function formatLocalAiArtifactSize(value) {
  const sizeBytes = Number.parseInt(value, 10)

  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) {
    return '-'
  }

  if (sizeBytes < 1024) {
    return `${sizeBytes} B`
  }

  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`
  }

  return `${(sizeBytes / (1024 * 1024)).toFixed(2)} MB`
}

function normalizeLocalAiTrainingPackageReviewStatus(value) {
  const reviewStatus = String(value || '')
    .trim()
    .toLowerCase()

  switch (reviewStatus) {
    case 'reviewed':
    case 'approved':
    case 'rejected':
      return reviewStatus
    case 'draft':
    default:
      return 'draft'
  }
}

function describeLocalAiTrainingPackageReviewStatus(status, t) {
  switch (normalizeLocalAiTrainingPackageReviewStatus(status)) {
    case 'reviewed':
      return {
        label: t('Reviewed'),
        color: 'blue.500',
      }
    case 'approved':
      return {
        label: t('Approved'),
        color: 'green.500',
      }
    case 'rejected':
      return {
        label: t('Rejected'),
        color: 'red.500',
      }
    case 'draft':
    default:
      return {
        label: t('Draft'),
        color: 'orange.500',
      }
  }
}

function describeLocalAiTrainingPackageFederatedReady(value, t) {
  if (value) {
    return {
      label: t('Yes'),
      color: 'green.500',
    }
  }

  return {
    label: t('No'),
    color: 'muted',
  }
}

function normalizeLocalAiAdapterDeltaType(value) {
  const deltaType = String(value || '')
    .trim()
    .toLowerCase()

  if (!deltaType) {
    return 'pending_adapter'
  }

  return deltaType
}

function describeLocalAiAdapterDeltaType(value, t) {
  switch (normalizeLocalAiAdapterDeltaType(value)) {
    case 'lora_adapter':
      return {
        label: t('Concrete LoRA adapter'),
        color: 'green.500',
      }
    case 'pending_adapter':
      return {
        label: t('Pending adapter'),
        color: 'orange.500',
      }
    default: {
      const label = String(value || '').trim() || 'pending_adapter'

      return {
        label,
        color: 'blue.500',
      }
    }
  }
}

function formatLocalAiFederatedReason(value) {
  const text = String(value || '').trim()

  if (!text) {
    return '-'
  }

  return text.replace(/_/g, ' ')
}

function LocalAiDebugResult({label, result}) {
  if (!result) {
    return null
  }

  return (
    <SettingsFormControl>
      <SettingsFormLabel>{label}</SettingsFormLabel>
      <Textarea
        isReadOnly
        minH="120px"
        value={formatLocalAiDebugResult(result)}
      />
    </SettingsFormControl>
  )
}

function describeLocalAiRuntimeStatus({
  enabled,
  isChecking,
  result,
  baseUrl,
  t,
}) {
  if (!enabled) {
    return {
      tone: 'muted',
      title: t('Local AI disabled'),
      description: t('Enable Local AI to allow local runtime health checks.'),
    }
  }

  if (isChecking) {
    return {
      tone: 'blue.500',
      title: t('Checking Local AI'),
      description: t('Trying {{baseUrl}}.', {
        baseUrl: String(baseUrl || 'http://localhost:5000').trim(),
      }),
    }
  }

  if (result && result.status === 'ok') {
    return {
      tone: 'green.500',
      title: t('Local AI runtime available'),
      description: formatLocalAiStatusDescription(result, t),
    }
  }

  return {
    tone: 'red.500',
    title: t('Local AI runtime unavailable'),
    description:
      (result && (result.error || result.lastError)) ||
      t('Check the local runtime URL and try again.'),
  }
}

export default function AiSettingsPage() {
  const {t} = useTranslation()
  const toast = useToast()
  const router = useRouter()

  const settings = useSettingsState()
  const {updateAiSolverSettings, updateLocalAiSettings} = useSettingsDispatch()

  const aiSolver = useMemo(
    () => ({...DEFAULT_AI_SETTINGS, ...(settings.aiSolver || {})}),
    [settings.aiSolver]
  )
  const localAi = useMemo(
    () => buildLocalAiSettings(settings.localAi),
    [settings.localAi]
  )
  const localAiWireRuntimeType = useMemo(
    () => resolveLocalAiWireRuntimeType(localAi),
    [localAi]
  )
  const localAiRuntimeUrl = useMemo(() => {
    if (typeof localAi.endpoint === 'string') {
      return localAi.endpoint.trim()
    }

    if (typeof localAi.baseUrl === 'string') {
      return localAi.baseUrl.trim()
    }

    return DEFAULT_LOCAL_AI_SETTINGS.endpoint
  }, [localAi.baseUrl, localAi.endpoint])
  const localAiEndpointSafety = useMemo(
    () => getLocalAiEndpointSafety(localAiRuntimeUrl),
    [localAiRuntimeUrl]
  )

  const [apiKey, setApiKey] = useState('')
  const [isUpdatingKey, setIsUpdatingKey] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [isRefreshingModels, setIsRefreshingModels] = useState(false)
  const [isRefreshingAllModels, setIsRefreshingAllModels] = useState(false)
  const [isApiKeyVisible, setIsApiKeyVisible] = useState(false)
  const [latestModelsByProvider, setLatestModelsByProvider] = useState({})
  const [showProviderSetup, setShowProviderSetup] = useState(false)
  const [showLocalAiSetup, setShowLocalAiSetup] = useState(false)
  const [showAdvancedAiSettings, setShowAdvancedAiSettings] = useState(false)
  const [
    showLocalAiCompatibilityOverrides,
    setShowLocalAiCompatibilityOverrides,
  ] = useState(false)
  const setupSectionRef = React.useRef(null)
  const [isEnableDialogOpen, setIsEnableDialogOpen] = useState(false)
  const [isCheckingLocalAi, setIsCheckingLocalAi] = useState(false)
  const [isStartingLocalAi, setIsStartingLocalAi] = useState(false)
  const [isStoppingLocalAi, setIsStoppingLocalAi] = useState(false)
  const [localAiStatusResult, setLocalAiStatusResult] = useState(() =>
    normalizeLocalAiStatusResult(
      {
        enabled: !!localAi.enabled,
        status: localAi.enabled ? 'error' : 'disabled',
        runtime:
          localAi.runtimeBackend || DEFAULT_LOCAL_AI_SETTINGS.runtimeBackend,
        baseUrl: localAiRuntimeUrl,
        error: localAi.enabled
          ? 'Check the local runtime URL and try again.'
          : null,
      },
      localAiRuntimeUrl
    )
  )
  const [localAiDebugChatPrompt, setLocalAiDebugChatPrompt] = useState(
    DEFAULT_LOCAL_AI_DEBUG_CHAT_PROMPT
  )
  const [localAiDebugFlipInput, setLocalAiDebugFlipInput] = useState(
    DEFAULT_LOCAL_AI_DEBUG_FLIP_INPUT
  )
  const [isRunningLocalAiChat, setIsRunningLocalAiChat] = useState(false)
  const [isRunningLocalAiFlipToText, setIsRunningLocalAiFlipToText] =
    useState(false)
  const [isRunningLocalAiFlipChecker, setIsRunningLocalAiFlipChecker] =
    useState(false)
  const [localAiChatResult, setLocalAiChatResult] = useState(null)
  const [localAiFlipToTextResult, setLocalAiFlipToTextResult] = useState(null)
  const [localAiFlipCheckerResult, setLocalAiFlipCheckerResult] = useState(null)
  const [localAiPackageEpoch, setLocalAiPackageEpoch] = useState('')
  const [isLoadingLocalAiPackage, setIsLoadingLocalAiPackage] = useState(false)
  const [isExportingLocalAiPackage, setIsExportingLocalAiPackage] =
    useState(false)
  const [isUpdatingLocalAiPackageReview, setIsUpdatingLocalAiPackageReview] =
    useState(false)
  const [localAiPackagePreview, setLocalAiPackagePreview] = useState(null)
  const [localAiPackageExportPath, setLocalAiPackageExportPath] = useState('')
  const [localAiPackageError, setLocalAiPackageError] = useState('')
  const [localAiAdapterSourcePath, setLocalAiAdapterSourcePath] = useState('')
  const [isRegisteringLocalAiAdapter, setIsRegisteringLocalAiAdapter] =
    useState(false)
  const [isLoadingLocalAiAdapter, setIsLoadingLocalAiAdapter] = useState(false)
  const [localAiAdapterManifest, setLocalAiAdapterManifest] = useState(null)
  const [localAiAdapterError, setLocalAiAdapterError] = useState('')
  const [isBuildingLocalAiBundle, setIsBuildingLocalAiBundle] = useState(false)
  const [isImportingLocalAiBundle, setIsImportingLocalAiBundle] =
    useState(false)
  const [isAggregatingLocalAiBundles, setIsAggregatingLocalAiBundles] =
    useState(false)
  const [localAiBundleImportPath, setLocalAiBundleImportPath] = useState('')
  const [localAiBuildBundleResult, setLocalAiBuildBundleResult] = useState(null)
  const [localAiImportBundleResult, setLocalAiImportBundleResult] =
    useState(null)
  const [localAiAggregateResult, setLocalAiAggregateResult] = useState(null)
  const [localAiFederatedError, setLocalAiFederatedError] = useState('')
  const [providerKeyStatus, setProviderKeyStatus] = useState({
    checked: false,
    checking: true,
    hasKey: false,
    allReady: false,
    primaryReady: false,
    activeProvider: 'openai',
    requiredProviders: [],
    missingProviders: [],
    error: '',
  })

  const notify = useCallback(
    (title, description, status = 'info') => {
      toast({
        render: () => (
          <Toast title={title} description={description} status={status} />
        ),
      })
    },
    [toast]
  )

  const updateNumberField = (field, value) => {
    updateAiSolverSettings({
      [field]: numberOrFallback(value, DEFAULT_AI_SETTINGS[field]),
    })
  }

  const updateFloatField = (field, value) => {
    updateAiSolverSettings({
      [field]: floatOrFallback(value, DEFAULT_AI_SETTINGS[field]),
    })
  }

  const updateProvider = (provider) => {
    const fallbackModel = resolveDefaultModelForProvider(provider, localAi)
    updateAiSolverSettings({
      provider,
      model: fallbackModel,
    })
  }

  const applyLocalAiRuntimeBackend = useCallback(
    (runtimeBackend) => {
      updateLocalAiSettings(buildLocalAiRuntimePreset(runtimeBackend))
    },
    [updateLocalAiSettings]
  )

  const applyRecommendedLocalAiSetup = useCallback(() => {
    updateLocalAiSettings({
      enabled: true,
      ...buildRecommendedLocalAiMacPreset(),
    })

    notify(
      t('Recommended Mac local AI setup applied'),
      t(
        'IdenaAI now points local inference at Ollama on http://127.0.0.1:11434 and uses qwen3.5:9b as the default local runtime for both text and image work. Local MLX training stays in the same Qwen3.5 family: Qwen3.5-9B MLX 4-bit is the recommended strong-Mac target, Qwen2.5-VL-7B 4-bit is the stronger fallback, and Qwen2-VL-2B 4-bit remains the safe minimum fallback.'
      ),
      'success'
    )
  }, [notify, t, updateLocalAiSettings])

  const enableAutomaticNextValidationSession = useCallback(() => {
    updateAiSolverSettings({
      enabled: true,
      mode: 'session-auto',
    })
    notify(
      t('Automatic AI solving enabled'),
      t(
        'The next real validation session will auto-start AI solving when a solvable session begins.'
      )
    )
  }, [notify, t, updateAiSolverSettings])

  const ensureBridge = () => {
    if (!global.aiSolver) {
      throw new Error('AI bridge is not available in this build')
    }
    return global.aiSolver
  }

  const ensureLocalAiBridge = () => {
    if (!global.localAi) {
      throw new Error('Local AI bridge is not available in this build')
    }
    return global.localAi
  }

  const localAiRuntimePayload = useMemo(
    () => ({
      mode: localAi.runtimeMode,
      runtimeType: localAiWireRuntimeType,
      runtimeBackend: localAi.runtimeBackend,
      reasonerBackend: localAi.reasonerBackend,
      visionBackend: localAi.visionBackend,
      publicModelId: localAi.publicModelId,
      publicVisionId: localAi.publicVisionId,
      contractVersion: localAi.contractVersion,
      adapterStrategy: localAi.adapterStrategy,
      trainingPolicy: localAi.trainingPolicy,
      rankingPolicy: localAi.rankingPolicy,
      baseUrl: localAiRuntimeUrl,
      endpoint: localAiRuntimeUrl,
      model: RECOMMENDED_LOCAL_AI_OLLAMA_MODEL,
      visionModel: RECOMMENDED_LOCAL_AI_OLLAMA_VISION_MODEL,
    }),
    [
      localAi.contractVersion,
      localAi.publicModelId,
      localAi.publicVisionId,
      localAi.rankingPolicy,
      localAi.reasonerBackend,
      localAi.runtimeMode,
      localAi.runtimeBackend,
      localAi.adapterStrategy,
      localAi.trainingPolicy,
      localAiWireRuntimeType,
      localAi.visionBackend,
      localAiRuntimeUrl,
    ]
  )

  const requestLocalAiStatus = useCallback(async () => {
    if (!localAi.enabled) {
      const result = normalizeLocalAiStatusResult(
        {
          enabled: false,
          status: 'disabled',
          runtime:
            localAi.runtimeBackend || DEFAULT_LOCAL_AI_SETTINGS.runtimeBackend,
          baseUrl: localAiRuntimeUrl,
          error: null,
          lastError: null,
        },
        localAiRuntimeUrl
      )
      setLocalAiStatusResult(result)
      return result
    }

    setIsCheckingLocalAi(true)

    try {
      const result = normalizeLocalAiStatusResult(
        await ensureLocalAiBridge().status({
          ...localAiRuntimePayload,
          refresh: true,
        }),
        localAiRuntimeUrl
      )
      setLocalAiStatusResult(result)
      return result
    } catch (error) {
      const result = normalizeLocalAiStatusResult(
        {
          enabled: true,
          status: 'error',
          runtime:
            localAi.runtimeBackend || DEFAULT_LOCAL_AI_SETTINGS.runtimeBackend,
          baseUrl: localAiRuntimeUrl,
          error: formatErrorForToast(error),
          lastError: formatErrorForToast(error),
        },
        localAiRuntimeUrl
      )
      setLocalAiStatusResult(result)
      return result
    } finally {
      setIsCheckingLocalAi(false)
    }
  }, [
    localAi.enabled,
    localAiRuntimePayload,
    localAi.runtimeBackend,
    localAiRuntimeUrl,
  ])

  const ensureInteractiveLocalAiRuntime = useCallback(async () => {
    if (!localAi.enabled) {
      throw new Error(t('Enable Local AI first.'))
    }

    const result = normalizeLocalAiStatusResult(
      await ensureLocalAiBridge().start({
        ...localAiRuntimePayload,
        timeoutMs: 10000,
      }),
      localAiRuntimeUrl
    )

    setLocalAiStatusResult(result)

    if (result.sidecarReachable !== true) {
      throw new Error(
        formatLocalAiStatusDescription(result, t) ||
          t('The configured Local AI runtime is not reachable yet.')
      )
    }

    return result
  }, [localAi.enabled, localAiRuntimePayload, localAiRuntimeUrl, t])

  useEffect(() => {
    if (!localAi.enabled) {
      setLocalAiStatusResult(
        normalizeLocalAiStatusResult(
          {
            enabled: false,
            status: 'disabled',
            runtime:
              localAi.runtimeBackend ||
              DEFAULT_LOCAL_AI_SETTINGS.runtimeBackend,
            baseUrl: localAiRuntimeUrl,
            error: null,
            lastError: null,
          },
          localAiRuntimeUrl
        )
      )
      return
    }

    if (!localAiEndpointSafety.safe) {
      setLocalAiStatusResult((current) => {
        if (
          current &&
          current.enabled !== false &&
          current.lastError === localAiEndpointSafety.message
        ) {
          return current
        }

        return normalizeLocalAiStatusResult(
          {
            enabled: true,
            status: 'error',
            runtime:
              localAi.runtimeBackend ||
              DEFAULT_LOCAL_AI_SETTINGS.runtimeBackend,
            baseUrl: localAiRuntimeUrl,
            error: localAiEndpointSafety.message,
            lastError: localAiEndpointSafety.message,
          },
          localAiRuntimeUrl
        )
      })
      return
    }

    setLocalAiStatusResult((current) => {
      if (current && current.enabled !== false) {
        return current
      }

      return normalizeLocalAiStatusResult(
        {
          enabled: true,
          status: 'error',
          runtime:
            localAi.runtimeBackend || DEFAULT_LOCAL_AI_SETTINGS.runtimeBackend,
          baseUrl: localAiRuntimeUrl,
          error: 'Check the local runtime URL and try again.',
          lastError: 'Check the local runtime URL and try again.',
        },
        localAiRuntimeUrl
      )
    })
  }, [
    localAi.enabled,
    localAi.runtimeBackend,
    localAiEndpointSafety.message,
    localAiEndpointSafety.safe,
    localAiRuntimeUrl,
  ])

  const localAiRuntimeStatus = useMemo(
    () =>
      describeLocalAiRuntimeStatus({
        enabled: !!localAi.enabled,
        isChecking: isCheckingLocalAi,
        result: localAiStatusResult,
        baseUrl: localAiRuntimeUrl,
        t,
      }),
    [
      isCheckingLocalAi,
      localAi.enabled,
      localAiRuntimeUrl,
      localAiStatusResult,
      t,
    ]
  )

  const runLocalAiChatTest = useCallback(async () => {
    const prompt = String(localAiDebugChatPrompt || '').trim()

    if (!prompt) {
      setLocalAiChatResult({
        ok: false,
        status: 'validation_error',
        error: 'prompt_required',
        lastError: t('Provide a prompt before running the local chat test.'),
      })
      return
    }

    setIsRunningLocalAiChat(true)

    try {
      await ensureInteractiveLocalAiRuntime()
      const result = await ensureLocalAiBridge().chat({
        ...localAiRuntimePayload,
        prompt,
        timeoutMs: 60 * 1000,
      })
      setLocalAiChatResult(result)
    } catch (error) {
      setLocalAiChatResult({
        ok: false,
        status: 'error',
        error: 'request_failed',
        lastError: formatErrorForToast(error),
      })
    } finally {
      setIsRunningLocalAiChat(false)
    }
  }, [
    ensureInteractiveLocalAiRuntime,
    localAiDebugChatPrompt,
    localAiRuntimePayload,
    t,
  ])

  const runLocalAiFlipTest = useCallback(
    async (method) => {
      const parsedInput = parseLocalAiDebugJsonInput(localAiDebugFlipInput)

      if (!parsedInput.ok) {
        const errorResult = {
          ok: false,
          status: 'validation_error',
          error: 'invalid_debug_input',
          lastError: parsedInput.error,
        }

        if (method === 'flipToText') {
          setLocalAiFlipToTextResult(errorResult)
        } else {
          setLocalAiFlipCheckerResult(errorResult)
        }
        return
      }

      if (method === 'flipToText') {
        setIsRunningLocalAiFlipToText(true)
      } else {
        setIsRunningLocalAiFlipChecker(true)
      }

      try {
        await ensureInteractiveLocalAiRuntime()
        const bridge = ensureLocalAiBridge()
        const handler =
          method === 'flipToText'
            ? bridge.flipToText.bind(bridge)
            : bridge.checkFlipSequence.bind(bridge)
        const result = await handler({
          ...localAiRuntimePayload,
          ...parsedInput.value,
        })

        if (method === 'flipToText') {
          setLocalAiFlipToTextResult(result)
        } else {
          setLocalAiFlipCheckerResult(result)
        }
      } catch (error) {
        const errorResult = {
          ok: false,
          status: 'error',
          error: 'request_failed',
          lastError: formatErrorForToast(error),
        }

        if (method === 'flipToText') {
          setLocalAiFlipToTextResult(errorResult)
        } else {
          setLocalAiFlipCheckerResult(errorResult)
        }
      } finally {
        if (method === 'flipToText') {
          setIsRunningLocalAiFlipToText(false)
        } else {
          setIsRunningLocalAiFlipChecker(false)
        }
      }
    },
    [
      ensureInteractiveLocalAiRuntime,
      localAiDebugFlipInput,
      localAiRuntimePayload,
    ]
  )

  const runLocalAiTrainingPackageAction = useCallback(
    async (includePackage) => {
      const epoch = String(localAiPackageEpoch || '').trim()

      if (!epoch) {
        setLocalAiPackageError(
          t('Enter an epoch before generating a package preview.')
        )

        if (includePackage) {
          setLocalAiPackagePreview(null)
        } else {
          setLocalAiPackageExportPath('')
        }

        return
      }

      if (includePackage) {
        setIsLoadingLocalAiPackage(true)
      } else {
        setIsExportingLocalAiPackage(true)
      }

      setLocalAiPackageError('')

      try {
        const bridge = ensureLocalAiBridge()
        let result = null

        if (includePackage) {
          try {
            result = await bridge.loadTrainingCandidatePackage({epoch})
          } catch (error) {
            const message = formatErrorForToast(error)

            if (!/training candidate package is unavailable/i.test(message)) {
              throw error
            }

            result = await bridge.buildTrainingCandidatePackage({
              ...localAiRuntimePayload,
              epoch,
              includePackage: true,
            })
          }
        } else {
          try {
            result = await bridge.loadTrainingCandidatePackage({epoch})
          } catch (error) {
            const message = formatErrorForToast(error)

            if (!/training candidate package is unavailable/i.test(message)) {
              throw error
            }

            result = await bridge.buildTrainingCandidatePackage({
              ...localAiRuntimePayload,
              epoch,
              includePackage: false,
            })
          }
        }

        if (includePackage) {
          setLocalAiPackagePreview(result)
          setLocalAiPackageExportPath(
            String(
              result && result.packagePath ? result.packagePath : ''
            ).trim()
          )
        } else {
          setLocalAiPackageExportPath(
            String(
              result && result.packagePath ? result.packagePath : ''
            ).trim()
          )
        }
      } catch (error) {
        const message = formatErrorForToast(error)
        setLocalAiPackageError(message)

        if (includePackage) {
          setLocalAiPackagePreview(null)
        } else {
          setLocalAiPackageExportPath('')
        }
      } finally {
        if (includePackage) {
          setIsLoadingLocalAiPackage(false)
        } else {
          setIsExportingLocalAiPackage(false)
        }
      }
    },
    [localAiPackageEpoch, localAiRuntimePayload, t]
  )

  const updateLocalAiTrainingPackageReviewStatus = useCallback(
    async (reviewStatus) => {
      const epoch = String(localAiPackageEpoch || '').trim()

      if (!epoch) {
        setLocalAiPackageError(
          t('Enter an epoch before updating the package review status.')
        )
        return
      }

      setIsUpdatingLocalAiPackageReview(true)
      setLocalAiPackageError('')

      try {
        const result =
          await ensureLocalAiBridge().updateTrainingCandidatePackageReview({
            epoch,
            reviewStatus,
          })

        setLocalAiPackagePreview(result)
        setLocalAiPackageExportPath(
          String(result && result.packagePath ? result.packagePath : '').trim()
        )
      } catch (error) {
        setLocalAiPackageError(formatErrorForToast(error))
      } finally {
        setIsUpdatingLocalAiPackageReview(false)
      }
    },
    [localAiPackageEpoch, t]
  )

  const runLocalAiRegisterAdapterArtifact = useCallback(async () => {
    const epoch = String(localAiPackageEpoch || '').trim()
    const sourcePath = String(localAiAdapterSourcePath || '').trim()

    if (!epoch) {
      setLocalAiAdapterError(
        t('Enter an epoch before registering a local adapter artifact.')
      )
      return
    }

    if (!sourcePath) {
      setLocalAiAdapterError(
        t('Provide an absolute adapter file path before registering it.')
      )
      return
    }

    setIsRegisteringLocalAiAdapter(true)
    setLocalAiAdapterError('')

    try {
      const result = await ensureLocalAiBridge().registerAdapterArtifact({
        ...localAiRuntimePayload,
        epoch,
        sourcePath,
      })

      setLocalAiAdapterManifest(result)
    } catch (error) {
      setLocalAiAdapterManifest(null)
      setLocalAiAdapterError(formatErrorForToast(error))
    } finally {
      setIsRegisteringLocalAiAdapter(false)
    }
  }, [localAiAdapterSourcePath, localAiRuntimePayload, localAiPackageEpoch, t])

  const runLocalAiLoadAdapterArtifact = useCallback(async () => {
    const epoch = String(localAiPackageEpoch || '').trim()

    if (!epoch) {
      setLocalAiAdapterError(
        t('Enter an epoch before loading a registered adapter artifact.')
      )
      return
    }

    setIsLoadingLocalAiAdapter(true)
    setLocalAiAdapterError('')

    try {
      const result = await ensureLocalAiBridge().loadAdapterArtifact({
        ...localAiRuntimePayload,
        epoch,
      })

      setLocalAiAdapterManifest(result)
      setLocalAiAdapterSourcePath(
        String(
          result && result.adapterArtifact && result.adapterArtifact.sourcePath
            ? result.adapterArtifact.sourcePath
            : ''
        ).trim()
      )
    } catch (error) {
      setLocalAiAdapterManifest(null)
      setLocalAiAdapterError(formatErrorForToast(error))
    } finally {
      setIsLoadingLocalAiAdapter(false)
    }
  }, [localAiPackageEpoch, localAiRuntimePayload, t])

  const runLocalAiBuildBundle = useCallback(async () => {
    const epoch = String(localAiPackageEpoch || '').trim()

    if (!epoch) {
      setLocalAiFederatedError(
        t('Enter an epoch before building a federated bundle.')
      )
      return
    }

    setIsBuildingLocalAiBundle(true)
    setLocalAiFederatedError('')

    try {
      const result = await ensureLocalAiBridge().buildBundle(epoch)
      setLocalAiBuildBundleResult(result)
    } catch (error) {
      setLocalAiBuildBundleResult(null)
      setLocalAiFederatedError(formatErrorForToast(error))
    } finally {
      setIsBuildingLocalAiBundle(false)
    }
  }, [localAiPackageEpoch, t])

  const runLocalAiImportBundle = useCallback(async () => {
    const filePath = String(localAiBundleImportPath || '').trim()

    if (!filePath) {
      setLocalAiFederatedError(
        t('Provide an absolute incoming bundle path before importing it.')
      )
      return
    }

    setIsImportingLocalAiBundle(true)
    setLocalAiFederatedError('')

    try {
      const result = await ensureLocalAiBridge().importBundle(filePath)
      setLocalAiImportBundleResult(result)
    } catch (error) {
      setLocalAiImportBundleResult(null)
      setLocalAiFederatedError(formatErrorForToast(error))
    } finally {
      setIsImportingLocalAiBundle(false)
    }
  }, [localAiBundleImportPath, t])

  const runLocalAiAggregateBundles = useCallback(async () => {
    setIsAggregatingLocalAiBundles(true)
    setLocalAiFederatedError('')

    try {
      const result = await ensureLocalAiBridge().aggregate()
      setLocalAiAggregateResult(result)
    } catch (error) {
      setLocalAiAggregateResult(null)
      setLocalAiFederatedError(formatErrorForToast(error))
    } finally {
      setIsAggregatingLocalAiBundles(false)
    }
  }, [])

  const hasSessionKeyForProvider = async (provider) => {
    if (isLocalAiProvider(provider)) {
      const localState = await resolveLocalAiProviderState({
        localBridge: global.localAi,
        localAi,
      })

      return Boolean(localState && localState.hasKey)
    }

    const bridge = ensureBridge()
    const keyStatus = await bridge.hasProviderKey({provider})
    return Boolean(keyStatus && keyStatus.hasKey)
  }

  const refreshModelsForProvider = async (provider) => {
    if (isLocalAiProvider(provider)) {
      await ensureInteractiveLocalAiRuntime()
      const localResult = await ensureLocalAiBridge().listModels(
        localAiRuntimePayload
      )
      const message = String(
        (localResult && (localResult.lastError || localResult.error)) || ''
      ).trim()

      if (localResult && localResult.ok === false) {
        throw new Error(message || 'Local AI runtime is unavailable')
      }

      const localModels = Array.isArray(localResult && localResult.models)
        ? localResult.models
        : []

      setLatestModelsByProvider((prev) => ({
        ...prev,
        [provider]: localModels,
      }))

      return {
        provider,
        count: localModels.length,
      }
    }

    const bridge = ensureBridge()
    const bridgeResult = await bridge.listModels({
      provider,
      providerConfig: buildProviderConfigForBridge(aiSolver, provider),
    })

    const remoteModels = Array.isArray(bridgeResult && bridgeResult.models)
      ? bridgeResult.models
      : []

    setLatestModelsByProvider((prev) => ({
      ...prev,
      [provider]: remoteModels,
    }))

    return {
      provider,
      count: remoteModels.length,
    }
  }

  const activeProvider = aiSolver.provider || 'openai'
  const isLocalAiPrimaryProvider = isLocalAiProvider(activeProvider)
  const staticModelPresets = MODEL_PRESETS[activeProvider] || []
  const dynamicModelPresets = latestModelsByProvider[activeProvider] || []
  const modelPresets = Array.from(
    new Set(
      dynamicModelPresets
        .concat(staticModelPresets)
        .map((item) => String(item || '').trim())
        .filter(Boolean)
    )
  )
  const activeModel =
    aiSolver.model || resolveDefaultModelForProvider(activeProvider, localAi)
  const presetValue = modelPresets.includes(activeModel)
    ? activeModel
    : 'custom'
  const ensembleProvider2 = aiSolver.ensembleProvider2 || 'gemini'
  const ensembleProvider3 = aiSolver.ensembleProvider3 || 'openai'
  const ensembleModel2 =
    aiSolver.ensembleModel2 || DEFAULT_MODELS[ensembleProvider2]
  const ensembleModel3 =
    aiSolver.ensembleModel3 || DEFAULT_MODELS[ensembleProvider3]
  const ensemblePrimaryWeight = weightOrFallback(
    aiSolver.ensemblePrimaryWeight,
    1
  )
  const legacyHeuristicWeight = weightOrFallback(
    aiSolver.legacyHeuristicWeight,
    1
  )
  const ensembleProvider2Weight = weightOrFallback(
    aiSolver.ensembleProvider2Weight,
    1
  )
  const ensembleProvider3Weight = weightOrFallback(
    aiSolver.ensembleProvider3Weight,
    1
  )
  const ensemblePresets2 = Array.from(
    new Set(
      (MODEL_PRESETS[ensembleProvider2] || [])
        .concat(latestModelsByProvider[ensembleProvider2] || [])
        .map((item) => String(item || '').trim())
        .filter(Boolean)
    )
  )
  const ensemblePresets3 = Array.from(
    new Set(
      (MODEL_PRESETS[ensembleProvider3] || [])
        .concat(latestModelsByProvider[ensembleProvider3] || [])
        .map((item) => String(item || '').trim())
        .filter(Boolean)
    )
  )
  const providerConfig = buildProviderConfigForBridge(aiSolver, activeProvider)
  const trimmedApiKey = String(apiKey || '').trim()
  const refreshProviderKeyStatus = useCallback(async () => {
    const bridge = ensureBridge()
    setProviderKeyStatus((prev) => ({
      ...prev,
      checking: true,
      error: '',
    }))

    try {
      const nextState = await checkAiProviderReadiness({
        bridge,
        localBridge: global.localAi,
        localAi,
        aiSolver,
      })
      setProviderKeyStatus(nextState)
      return nextState
    } catch (error) {
      const fallbackState = {
        checked: true,
        checking: false,
        hasKey: false,
        allReady: false,
        primaryReady: false,
        activeProvider,
        requiredProviders: [activeProvider],
        missingProviders: [activeProvider],
        error: String((error && error.message) || error || '').trim(),
      }
      setProviderKeyStatus(fallbackState)
      return fallbackState
    }
  }, [activeProvider, aiSolver, localAi])

  useEffect(() => {
    refreshProviderKeyStatus()
  }, [refreshProviderKeyStatus])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    if (router.query?.setup === '1') {
      setShowProviderSetup(true)
    }

    if (
      router.query?.setup === '1' &&
      setupSectionRef.current &&
      typeof setupSectionRef.current.scrollIntoView === 'function'
    ) {
      setupSectionRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    }
  }, [router.query])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined
    }

    const refreshOnFocus = () => {
      refreshProviderKeyStatus()
    }

    window.addEventListener('focus', refreshOnFocus)
    document.addEventListener('visibilitychange', refreshOnFocus)

    return () => {
      window.removeEventListener('focus', refreshOnFocus)
      document.removeEventListener('visibilitychange', refreshOnFocus)
    }
  }, [refreshProviderKeyStatus])

  const providerKeyStatusUi = useMemo(() => {
    if (!providerKeyStatus.checked || providerKeyStatus.checking) {
      return {
        label: t('Checking...'),
        color: 'muted',
        detail: '',
      }
    }

    if (providerKeyStatus.allReady) {
      const requiredCount = Array.isArray(providerKeyStatus.requiredProviders)
        ? providerKeyStatus.requiredProviders.length
        : 0
      let readyDetail = t('Active provider key is loaded.')

      if (requiredCount > 1) {
        readyDetail = t('All required AI providers are ready.')
      } else if (isLocalAiPrimaryProvider) {
        readyDetail = t('Local AI runtime is reachable.')
      }

      return {
        label:
          requiredCount > 1
            ? t('Ready ({{count}}/{{count}})', {count: requiredCount})
            : t('Ready'),
        color: 'green.500',
        detail: readyDetail,
      }
    }

    const missingProviders = formatMissingAiProviders(
      providerKeyStatus.missingProviders
    )

    let missingDetail = t('Load the required provider key below.')

    if (isLocalAiPrimaryProvider) {
      missingDetail = formatLocalAiRuntimeRequirement(
        providerKeyStatus.error,
        t
      )
    } else if (missingProviders) {
      missingDetail = t('Missing for: {{providers}}', {
        providers: missingProviders,
      })
    }

    return {
      label: t('Missing'),
      color: 'orange.500',
      detail: missingDetail,
    }
  }, [
    isLocalAiPrimaryProvider,
    providerKeyStatus.allReady,
    providerKeyStatus.checked,
    providerKeyStatus.checking,
    providerKeyStatus.error,
    providerKeyStatus.missingProviders,
    providerKeyStatus.requiredProviders,
    t,
  ])
  const externalProviderChoice = isLocalAiPrimaryProvider
    ? 'openai'
    : activeProvider
  const externalAiSummary = aiSolver.enabled
    ? t(
        'Insert one or multiple AI provider API keys here. Click Advanced if you need more settings later.'
      )
    : t(
        'Use this when you want an external AI provider via API instead of a local runtime.'
      )
  const localAiSummary = localAi.enabled
    ? t(
        'Local AI custom settings are active now. The default local runtime is {{model}}. Click Advanced if you need more settings.',
        {model: RECOMMENDED_LOCAL_AI_OLLAMA_MODEL}
      )
    : t(
        'Use this when you want to run AI locally on this machine instead of through an external API.'
      )
  const enableExternalProviderSetup = useCallback(() => {
    updateAiSolverSettings({
      enabled: true,
      provider: externalProviderChoice,
      model: resolveDefaultModelForProvider(externalProviderChoice, localAi),
    })
    setShowProviderSetup(true)
    setShowLocalAiSetup(false)
  }, [externalProviderChoice, localAi, updateAiSolverSettings])
  const enableLocalAiSetup = useCallback(() => {
    updateLocalAiSettings({enabled: true})
    updateAiSolverSettings({
      enabled: true,
      provider: 'local-ai',
      model: resolveDefaultModelForProvider('local-ai', {
        ...localAi,
        enabled: true,
      }),
    })
    setShowLocalAiSetup(true)
    setShowProviderSetup(false)
  }, [localAi, updateAiSolverSettings, updateLocalAiSettings])
  const toggleProviderSetup = useCallback(() => {
    setShowProviderSetup((value) => {
      const nextValue = !value

      if (nextValue) {
        setShowLocalAiSetup(false)
      }

      return nextValue
    })
  }, [])
  const toggleLocalAiSetup = useCallback(() => {
    setShowLocalAiSetup((value) => {
      const nextValue = !value

      if (nextValue) {
        setShowProviderSetup(false)
      }

      return nextValue
    })
  }, [])
  const localAiPackageReviewStatusUi = useMemo(
    () =>
      describeLocalAiTrainingPackageReviewStatus(
        localAiPackagePreview &&
          localAiPackagePreview.package &&
          localAiPackagePreview.package.reviewStatus,
        t
      ),
    [localAiPackagePreview, t]
  )
  const localAiPackageFederatedReadyUi = useMemo(
    () =>
      describeLocalAiTrainingPackageFederatedReady(
        Boolean(
          localAiPackagePreview &&
            localAiPackagePreview.package &&
            localAiPackagePreview.package.federatedReady
        ),
        t
      ),
    [localAiPackagePreview, t]
  )
  const localAiPackageContractUi = useMemo(
    () =>
      describeLocalAiAdapterDeltaType(
        localAiPackagePreview &&
          localAiPackagePreview.package &&
          localAiPackagePreview.package.deltaType,
        t
      ),
    [localAiPackagePreview, t]
  )
  const localAiAdapterContractUi = useMemo(
    () =>
      describeLocalAiAdapterDeltaType(
        localAiAdapterManifest ? localAiAdapterManifest.deltaType : '',
        t
      ),
    [localAiAdapterManifest, t]
  )
  const localAiPackageNeedsRefreshAfterAdapterRegistration = useMemo(() => {
    if (
      !localAiPackagePreview ||
      !localAiPackagePreview.package ||
      !localAiAdapterManifest
    ) {
      return false
    }

    const previewEpoch = Number.parseInt(
      localAiPackagePreview.package.epoch || localAiPackagePreview.epoch,
      10
    )
    const adapterEpoch = Number.parseInt(localAiAdapterManifest.epoch, 10)

    if (!Number.isFinite(previewEpoch) || !Number.isFinite(adapterEpoch)) {
      return false
    }

    return (
      previewEpoch === adapterEpoch &&
      normalizeLocalAiAdapterDeltaType(
        localAiPackagePreview.package.deltaType
      ) !== 'lora_adapter'
    )
  }, [localAiAdapterManifest, localAiPackagePreview])

  return (
    <SettingsLayout>
      <Stack spacing={8} mt={8} maxW="2xl">
        <SettingsSection title={t('AI')}>
          <Stack spacing={4}>
            <Box
              ref={setupSectionRef}
              borderWidth="1px"
              borderColor="blue.100"
              borderRadius="md"
              p={4}
              bg="blue.012"
            >
              <Stack spacing={4}>
                <Flex align="center" justify="space-between">
                  <Box>
                    <Text fontWeight={600}>{t('Choose AI access')}</Text>
                    <Text color="muted" fontSize="sm">
                      {t(
                        'Start with one simple path. Open advanced settings only when you really need them.'
                      )}
                    </Text>
                  </Box>
                  <Switch
                    isChecked={!!aiSolver.enabled}
                    onChange={() => {
                      if (aiSolver.enabled) {
                        updateAiSolverSettings({enabled: false})
                        return
                      }
                      setIsEnableDialogOpen(true)
                    }}
                  />
                </Flex>

                <Stack spacing={3}>
                  <Box
                    borderWidth="1px"
                    borderColor="blue.100"
                    borderRadius="md"
                    p={3}
                    bg="white"
                  >
                    <Stack spacing={3}>
                      <Box>
                        <Text fontWeight={600}>
                          {t('Enable external AI provider via API')}
                        </Text>
                        <Text color="muted" fontSize="sm" mt={1}>
                          {externalAiSummary}
                        </Text>
                      </Box>
                      <Text color="muted" fontSize="xs">
                        {t('Current provider')}:{' '}
                        {formatAiProviderLabel(externalProviderChoice)} ·{' '}
                        {providerKeyStatusUi.label}
                      </Text>
                      <Stack isInline spacing={2} flexWrap="wrap">
                        <PrimaryButton onClick={enableExternalProviderSetup}>
                          {t('Enable external AI provider via API')}
                        </PrimaryButton>
                        <SecondaryButton onClick={toggleProviderSetup}>
                          {showProviderSetup
                            ? t('Hide provider setup')
                            : t('Advanced')}
                        </SecondaryButton>
                      </Stack>
                    </Stack>
                  </Box>

                  <Box
                    borderWidth="1px"
                    borderColor="green.100"
                    borderRadius="md"
                    p={3}
                    bg="white"
                  >
                    <Stack spacing={3}>
                      <Box>
                        <Text fontWeight={600}>{t('Enable local AI')}</Text>
                        <Text color="muted" fontSize="sm" mt={1}>
                          {localAiSummary}
                        </Text>
                      </Box>
                      <Text color="muted" fontSize="xs">
                        {t('Current runtime')}: {localAiRuntimeStatus.title}
                      </Text>
                      <Stack isInline spacing={2} flexWrap="wrap">
                        <PrimaryButton onClick={enableLocalAiSetup}>
                          {t('Enable local AI')}
                        </PrimaryButton>
                        <SecondaryButton onClick={toggleLocalAiSetup}>
                          {showLocalAiSetup
                            ? t('Hide local AI')
                            : t('Advanced')}
                        </SecondaryButton>
                      </Stack>
                    </Stack>
                  </Box>
                </Stack>
              </Stack>
            </Box>

            {showProviderSetup ? (
              <>
                <SettingsFormControl>
                  <SettingsFormLabel>{t('Main AI provider')}</SettingsFormLabel>
                  <Select
                    value={activeProvider}
                    onChange={(e) => updateProvider(e.target.value)}
                    w="xs"
                  >
                    {MAIN_PROVIDER_OPTIONS.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </Select>
                </SettingsFormControl>

                <Flex align="center" justify="space-between">
                  <Box>
                    <Text fontWeight={500}>{t('Current setup state')}</Text>
                    <Text color="muted">
                      {providerKeyStatusUi.detail ||
                        t('Choose a provider and complete its required setup.')}
                    </Text>
                  </Box>
                  <Text fontWeight={600} color={providerKeyStatusUi.color}>
                    {providerKeyStatusUi.label}
                  </Text>
                </Flex>

                {isCustomConfigProvider(activeProvider) && (
                  <Stack spacing={3}>
                    <SettingsFormControl>
                      <SettingsFormLabel>
                        {t('Custom provider name')}
                      </SettingsFormLabel>
                      <Input
                        value={aiSolver.customProviderName}
                        onChange={(e) =>
                          updateAiSolverSettings({
                            customProviderName: e.target.value,
                          })
                        }
                        w="xl"
                      />
                    </SettingsFormControl>
                    <SettingsFormControl>
                      <SettingsFormLabel>{t('API base URL')}</SettingsFormLabel>
                      <Input
                        value={aiSolver.customProviderBaseUrl}
                        onChange={(e) =>
                          updateAiSolverSettings({
                            customProviderBaseUrl: e.target.value,
                          })
                        }
                        placeholder="https://api.openai.com/v1"
                        w="xl"
                      />
                    </SettingsFormControl>
                    <SettingsFormControl>
                      <SettingsFormLabel>{t('Chat path')}</SettingsFormLabel>
                      <Input
                        value={aiSolver.customProviderChatPath}
                        onChange={(e) =>
                          updateAiSolverSettings({
                            customProviderChatPath: e.target.value,
                          })
                        }
                        placeholder="/chat/completions"
                        w="xl"
                      />
                    </SettingsFormControl>
                  </Stack>
                )}

                <SettingsFormControl>
                  <SettingsFormLabel>{t('Model preset')}</SettingsFormLabel>
                  <Select
                    value={presetValue}
                    onChange={(e) => {
                      if (e.target.value !== 'custom') {
                        updateAiSolverSettings({model: e.target.value})
                      }
                    }}
                    w="xs"
                  >
                    {modelPresets.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                    <option value="custom">{t('Custom model id')}</option>
                  </Select>
                </SettingsFormControl>

                <SettingsFormControl>
                  <SettingsFormLabel>{t('Model')}</SettingsFormLabel>
                  <Input
                    value={activeModel}
                    onChange={(e) =>
                      updateAiSolverSettings({
                        model: e.target.value,
                      })
                    }
                    w="xs"
                  />
                </SettingsFormControl>

                <Box
                  borderWidth="1px"
                  borderColor="blue.050"
                  borderRadius="md"
                  p={3}
                >
                  <Stack spacing={2}>
                    <Text fontWeight={500}>
                      {t('Step 2: Choose what you want')}
                    </Text>
                    <Text color="muted" fontSize="sm">
                      {t(
                        'After the provider setup works, you can use one AI page for all flows: AI Flip Builder, AI Solver, off-chain benchmark, and on-chain automatic flow.'
                      )}
                    </Text>
                    <UnorderedList spacing={1} color="muted" fontSize="sm">
                      <ListItem>
                        {t(
                          'AI Flip Builder: generate a story draft and build flip images.'
                        )}
                      </ListItem>
                      <ListItem>
                        {t('AI Solver: help solve validation flips.')}
                      </ListItem>
                      <ListItem>
                        {t(
                          'Off-chain benchmark: test queue runs locally without publishing.'
                        )}
                      </ListItem>
                      <ListItem>
                        {t(
                          'On-chain automatic flow: generate, build, and publish with extra caution.'
                        )}
                      </ListItem>
                    </UnorderedList>
                    <Stack isInline spacing={2}>
                      <PrimaryButton
                        isDisabled={!providerKeyStatus.primaryReady}
                        onClick={() =>
                          router.push('/flips/new?autostep=submit')
                        }
                      >
                        {t('Open AI Flip Builder')}
                      </PrimaryButton>
                      <PrimaryButton
                        isDisabled={!providerKeyStatus.primaryReady}
                        onClick={enableAutomaticNextValidationSession}
                      >
                        {t('Enable auto-solve next session')}
                      </PrimaryButton>
                    </Stack>
                    <Stack isInline spacing={2}>
                      <SecondaryButton
                        isDisabled={!providerKeyStatus.primaryReady}
                        onClick={() => router.push('/validation?previewAi=1')}
                      >
                        {t('Test flip solver off-chain')}
                      </SecondaryButton>
                      <SecondaryButton
                        isDisabled={!providerKeyStatus.primaryReady}
                        onClick={() =>
                          router.push(
                            '/flips/new?focus=ai-benchmark&autostep=submit'
                          )
                        }
                      >
                        {t('Open off-chain benchmark')}
                      </SecondaryButton>
                      <SecondaryButton
                        isDisabled={!providerKeyStatus.primaryReady}
                      >
                        {t('Open on-chain automatic flow')}
                      </SecondaryButton>
                    </Stack>
                  </Stack>
                </Box>

                <Stack isInline justify="flex-end">
                  <SecondaryButton
                    onClick={() => setShowAdvancedAiSettings((v) => !v)}
                  >
                    {showAdvancedAiSettings
                      ? t('Hide advanced AI settings')
                      : t('Advanced AI settings')}
                  </SecondaryButton>
                </Stack>

                {showAdvancedAiSettings ? (
                  <>
                    <Stack
                      isInline
                      justify="flex-start"
                      spacing={2}
                      align="center"
                    >
                      <SecondaryButton
                        isLoading={isRefreshingModels}
                        isDisabled={isRefreshingAllModels}
                        onClick={async () => {
                          setIsRefreshingModels(true)
                          try {
                            const result = await refreshModelsForProvider(
                              activeProvider
                            )

                            notify(
                              t('Latest models loaded'),
                              t('{{provider}} returned {{count}} models', {
                                provider: result.provider,
                                count: result.count,
                              })
                            )
                          } catch (error) {
                            notify(
                              t('Unable to load latest models'),
                              formatErrorForToast(error),
                              'error'
                            )
                          } finally {
                            setIsRefreshingModels(false)
                          }
                        }}
                      >
                        {t('Check latest models')}
                      </SecondaryButton>
                      <SecondaryButton
                        isLoading={isRefreshingAllModels}
                        isDisabled={isRefreshingModels}
                        onClick={async () => {
                          setIsRefreshingAllModels(true)
                          try {
                            const providers = MAIN_PROVIDER_OPTIONS.map(
                              (item) => item.value
                            )
                            let loaded = 0
                            let skipped = 0
                            let failed = 0
                            const failedProviders = []

                            // Run sequentially to avoid rate spikes and noisy provider errors.
                            // eslint-disable-next-line no-restricted-syntax
                            for (const provider of providers) {
                              try {
                                // eslint-disable-next-line no-await-in-loop
                                const hasKey = await hasSessionKeyForProvider(
                                  provider
                                )
                                if (!hasKey) {
                                  skipped += 1
                                  // eslint-disable-next-line no-continue
                                  continue
                                }
                                // eslint-disable-next-line no-await-in-loop
                                await refreshModelsForProvider(provider)
                                loaded += 1
                              } catch (error) {
                                failed += 1
                                failedProviders.push(provider)
                              }
                            }

                            notify(
                              t('Latest model scan finished'),
                              [
                                t(
                                  '{{loaded}} loaded, {{skipped}} skipped (provider not ready), {{failed}} failed',
                                  {
                                    loaded,
                                    skipped,
                                    failed,
                                  }
                                ),
                                skipped > 0
                                  ? t(
                                      'Cloud providers need a session API key. Local AI needs the local runtime to be enabled and reachable.'
                                    )
                                  : null,
                                failedProviders.length > 0
                                  ? t('Failed: {{providers}}', {
                                      providers: failedProviders
                                        .map((provider) =>
                                          formatAiProviderLabel(provider)
                                        )
                                        .join(', '),
                                    })
                                  : null,
                              ]
                                .filter(Boolean)
                                .join(' '),
                              failed > 0 ? 'warning' : 'success'
                            )
                          } catch (error) {
                            notify(
                              t('Unable to scan latest models'),
                              formatErrorForToast(error),
                              'error'
                            )
                          } finally {
                            setIsRefreshingAllModels(false)
                          }
                        }}
                      >
                        {t('Check all providers')}
                      </SecondaryButton>
                      <Text color="muted" fontSize="sm">
                        {t('Loaded: {{count}}', {
                          count: dynamicModelPresets.length,
                        })}
                      </Text>
                    </Stack>

                    <Flex align="center" justify="space-between">
                      <Box>
                        <Text fontWeight={500}>
                          {t('Consult multiple APIs')}
                        </Text>
                        <Text color="muted" fontSize="sm">
                          {t(
                            'Optional: consult up to 3 models in parallel and decide each flip by averaged probabilities.'
                          )}
                        </Text>
                      </Box>
                      <Switch
                        isChecked={!!aiSolver.ensembleEnabled}
                        onChange={() =>
                          updateAiSolverSettings({
                            ensembleEnabled: !aiSolver.ensembleEnabled,
                          })
                        }
                      />
                    </Flex>

                    <Flex align="center" justify="space-between">
                      <Box>
                        <Text fontWeight={500}>
                          {t('Legacy heuristic vote')}
                        </Text>
                        <Text color="muted" fontSize="sm">
                          {t(
                            'Adds a local legacy frame-continuity heuristic as an additional weighted vote (no cloud API call).'
                          )}
                        </Text>
                      </Box>
                      <Switch
                        isChecked={!!aiSolver.legacyHeuristicEnabled}
                        onChange={() =>
                          updateAiSolverSettings({
                            legacyHeuristicEnabled:
                              !aiSolver.legacyHeuristicEnabled,
                          })
                        }
                      />
                    </Flex>

                    {aiSolver.legacyHeuristicEnabled && (
                      <Stack spacing={3}>
                        <SettingsFormControl>
                          <SettingsFormLabel>
                            {t('Legacy heuristic weight')}
                          </SettingsFormLabel>
                          <Input
                            type="number"
                            step="0.05"
                            min={0.05}
                            max={10}
                            value={legacyHeuristicWeight}
                            onChange={(e) =>
                              updateAiSolverSettings({
                                legacyHeuristicWeight: weightOrFallback(
                                  e.target.value,
                                  1
                                ),
                              })
                            }
                            w="sm"
                          />
                        </SettingsFormControl>
                        <Flex align="center" justify="space-between">
                          <Box>
                            <Text fontWeight={500}>
                              {t('Legacy-only run mode')}
                            </Text>
                            <Text color="muted" fontSize="sm">
                              {t(
                                'When enabled, runs use only the legacy heuristic and do not require a cloud provider API key.'
                              )}
                            </Text>
                          </Box>
                          <Switch
                            isChecked={!!aiSolver.legacyHeuristicOnly}
                            onChange={() =>
                              updateAiSolverSettings({
                                legacyHeuristicOnly:
                                  !aiSolver.legacyHeuristicOnly,
                              })
                            }
                          />
                        </Flex>
                      </Stack>
                    )}

                    {aiSolver.ensembleEnabled && (
                      <Stack
                        spacing={3}
                        borderWidth="1px"
                        borderColor="gray.100"
                        p={3}
                      >
                        <Text color="muted" fontSize="sm">
                          {t(
                            'Primary provider/model is consultant #1. Add consultant #2 and #3 below. Each provider needs its own loaded API key.'
                          )}
                        </Text>
                        <SettingsFormControl>
                          <SettingsFormLabel>
                            {t('Consultant #1 weight')}
                          </SettingsFormLabel>
                          <Input
                            type="number"
                            step="0.05"
                            min={0.05}
                            max={10}
                            value={ensemblePrimaryWeight}
                            onChange={(e) =>
                              updateAiSolverSettings({
                                ensemblePrimaryWeight: weightOrFallback(
                                  e.target.value,
                                  1
                                ),
                              })
                            }
                            w="sm"
                          />
                        </SettingsFormControl>

                        <Flex align="center" justify="space-between">
                          <Text fontWeight={500}>{t('Consultant #2')}</Text>
                          <Switch
                            isChecked={!!aiSolver.ensembleProvider2Enabled}
                            onChange={() =>
                              updateAiSolverSettings({
                                ensembleProvider2Enabled:
                                  !aiSolver.ensembleProvider2Enabled,
                              })
                            }
                          />
                        </Flex>

                        {aiSolver.ensembleProvider2Enabled && (
                          <Stack spacing={2}>
                            <SettingsFormControl>
                              <SettingsFormLabel>
                                {t('Provider')}
                              </SettingsFormLabel>
                              <Select
                                value={ensembleProvider2}
                                onChange={(e) =>
                                  updateAiSolverSettings({
                                    ensembleProvider2: e.target.value,
                                    ensembleModel2:
                                      DEFAULT_MODELS[e.target.value],
                                  })
                                }
                                w="sm"
                              >
                                {CONSULT_PROVIDER_OPTIONS.map((item) => (
                                  <option
                                    key={`ensemble2-provider-${item.value}`}
                                    value={item.value}
                                  >
                                    {item.label}
                                  </option>
                                ))}
                              </Select>
                            </SettingsFormControl>
                            <SettingsFormControl>
                              <SettingsFormLabel>
                                {t('Model preset')}
                              </SettingsFormLabel>
                              <Select
                                value={
                                  ensemblePresets2.includes(ensembleModel2)
                                    ? ensembleModel2
                                    : 'custom'
                                }
                                onChange={(e) => {
                                  if (e.target.value !== 'custom') {
                                    updateAiSolverSettings({
                                      ensembleModel2: e.target.value,
                                    })
                                  }
                                }}
                                w="sm"
                              >
                                {ensemblePresets2.map((value) => (
                                  <option
                                    key={`ensemble2-${value}`}
                                    value={value}
                                  >
                                    {value}
                                  </option>
                                ))}
                                <option value="custom">
                                  {t('Custom model id')}
                                </option>
                              </Select>
                            </SettingsFormControl>
                            <SettingsFormControl>
                              <SettingsFormLabel>
                                {t('Model')}
                              </SettingsFormLabel>
                              <Input
                                value={ensembleModel2}
                                onChange={(e) =>
                                  updateAiSolverSettings({
                                    ensembleModel2: e.target.value,
                                  })
                                }
                                w="sm"
                              />
                            </SettingsFormControl>
                            <SettingsFormControl>
                              <SettingsFormLabel>
                                {t('Weight')}
                              </SettingsFormLabel>
                              <Input
                                type="number"
                                step="0.05"
                                min={0.05}
                                max={10}
                                value={ensembleProvider2Weight}
                                onChange={(e) =>
                                  updateAiSolverSettings({
                                    ensembleProvider2Weight: weightOrFallback(
                                      e.target.value,
                                      1
                                    ),
                                  })
                                }
                                w="sm"
                              />
                            </SettingsFormControl>
                          </Stack>
                        )}

                        <Flex align="center" justify="space-between">
                          <Text fontWeight={500}>{t('Consultant #3')}</Text>
                          <Switch
                            isChecked={!!aiSolver.ensembleProvider3Enabled}
                            onChange={() =>
                              updateAiSolverSettings({
                                ensembleProvider3Enabled:
                                  !aiSolver.ensembleProvider3Enabled,
                              })
                            }
                          />
                        </Flex>

                        {aiSolver.ensembleProvider3Enabled && (
                          <Stack spacing={2}>
                            <SettingsFormControl>
                              <SettingsFormLabel>
                                {t('Provider')}
                              </SettingsFormLabel>
                              <Select
                                value={ensembleProvider3}
                                onChange={(e) =>
                                  updateAiSolverSettings({
                                    ensembleProvider3: e.target.value,
                                    ensembleModel3:
                                      DEFAULT_MODELS[e.target.value],
                                  })
                                }
                                w="sm"
                              >
                                {CONSULT_PROVIDER_OPTIONS.map((item) => (
                                  <option
                                    key={`ensemble3-provider-${item.value}`}
                                    value={item.value}
                                  >
                                    {item.label}
                                  </option>
                                ))}
                              </Select>
                            </SettingsFormControl>
                            <SettingsFormControl>
                              <SettingsFormLabel>
                                {t('Model preset')}
                              </SettingsFormLabel>
                              <Select
                                value={
                                  ensemblePresets3.includes(ensembleModel3)
                                    ? ensembleModel3
                                    : 'custom'
                                }
                                onChange={(e) => {
                                  if (e.target.value !== 'custom') {
                                    updateAiSolverSettings({
                                      ensembleModel3: e.target.value,
                                    })
                                  }
                                }}
                                w="sm"
                              >
                                {ensemblePresets3.map((value) => (
                                  <option
                                    key={`ensemble3-${value}`}
                                    value={value}
                                  >
                                    {value}
                                  </option>
                                ))}
                                <option value="custom">
                                  {t('Custom model id')}
                                </option>
                              </Select>
                            </SettingsFormControl>
                            <SettingsFormControl>
                              <SettingsFormLabel>
                                {t('Model')}
                              </SettingsFormLabel>
                              <Input
                                value={ensembleModel3}
                                onChange={(e) =>
                                  updateAiSolverSettings({
                                    ensembleModel3: e.target.value,
                                  })
                                }
                                w="sm"
                              />
                            </SettingsFormControl>
                            <SettingsFormControl>
                              <SettingsFormLabel>
                                {t('Weight')}
                              </SettingsFormLabel>
                              <Input
                                type="number"
                                step="0.05"
                                min={0.05}
                                max={10}
                                value={ensembleProvider3Weight}
                                onChange={(e) =>
                                  updateAiSolverSettings({
                                    ensembleProvider3Weight: weightOrFallback(
                                      e.target.value,
                                      1
                                    ),
                                  })
                                }
                                w="sm"
                              />
                            </SettingsFormControl>
                          </Stack>
                        )}
                      </Stack>
                    )}

                    <SettingsFormControl>
                      <SettingsFormLabel>{t('Run mode')}</SettingsFormLabel>
                      <Select
                        value={aiSolver.mode || 'manual'}
                        onChange={(e) =>
                          updateAiSolverSettings({mode: e.target.value})
                        }
                        w="xs"
                      >
                        <option value="manual">{t('Manual one-click')}</option>
                        <option value="session-auto">
                          {t('Auto-run each validation session')}
                        </option>
                      </Select>
                    </SettingsFormControl>

                    {aiSolver.mode === 'session-auto' && (
                      <SettingsFormControl>
                        <SettingsFormLabel>
                          {t('Delayed auto-report')}
                        </SettingsFormLabel>
                        <Stack spacing={3}>
                          <Flex align="center" justify="space-between">
                            <Text color="muted" fontSize="sm" maxW="lg" mr={4}>
                              {t(
                                'If manual reporting has not started within the grace period after the automatic keyword step begins, let AI review bad flips and submit the long session automatically.'
                              )}
                            </Text>
                            <Switch
                              isChecked={Boolean(aiSolver.autoReportEnabled)}
                              onChange={(e) =>
                                updateAiSolverSettings({
                                  autoReportEnabled: e.target.checked,
                                })
                              }
                            />
                          </Flex>

                          {aiSolver.autoReportEnabled && (
                            <SettingsFormControl>
                              <SettingsFormLabel>
                                {t('Manual reporting grace period (minutes)')}
                              </SettingsFormLabel>
                              <Input
                                type="number"
                                min="1"
                                max="60"
                                step="1"
                                value={aiSolver.autoReportDelayMinutes ?? 10}
                                onChange={(e) =>
                                  updateNumberField(
                                    'autoReportDelayMinutes',
                                    e.target.value
                                  )
                                }
                                w="xs"
                              />
                            </SettingsFormControl>
                          )}
                        </Stack>
                      </SettingsFormControl>
                    )}

                    <SettingsFormControl>
                      <SettingsFormLabel>
                        {t('Benchmark profile')}
                      </SettingsFormLabel>
                      <Select
                        value={aiSolver.benchmarkProfile || 'strict'}
                        onChange={(e) =>
                          updateAiSolverSettings({
                            benchmarkProfile: e.target.value,
                          })
                        }
                        w="xs"
                      >
                        <option value="strict">{t('Strict default')}</option>
                        <option value="custom">{t('Custom research')}</option>
                      </Select>
                    </SettingsFormControl>

                    <Text color="muted" fontSize="sm">
                      {aiSolver.benchmarkProfile === 'strict'
                        ? t(
                            'Strict profile targets 6 flips within 60 seconds with fixed retry/output limits and sequential pacing for fair customer-side benchmark comparison.'
                          )
                        : t(
                            'Custom profile allows local overrides for exploratory research. All custom settings are logged in benchmark metrics.'
                          )}
                    </Text>

                    <SettingsFormControl>
                      <SettingsFormLabel>
                        {t('Flip vision mode')}
                      </SettingsFormLabel>
                      <Select
                        value={aiSolver.flipVisionMode || 'composite'}
                        onChange={(e) =>
                          updateAiSolverSettings({
                            flipVisionMode: e.target.value,
                          })
                        }
                        w="sm"
                      >
                        <option value="composite">
                          {t('Composite (2 story images)')}
                        </option>
                        <option value="frames_single_pass">
                          {t('Frame-by-frame in one pass')}
                        </option>
                        <option value="frames_two_pass">
                          {t('Frame analysis then decision')}
                        </option>
                      </Select>
                      <Text color="muted" fontSize="sm" mt={1}>
                        {t(
                          'Choose whether AI compares 2 composed story images or reasons over all 8 ordered frames.'
                        )}
                      </Text>
                    </SettingsFormControl>

                    {aiSolver.benchmarkProfile === 'custom' && (
                      <Stack spacing={3}>
                        <SettingsFormControl>
                          <SettingsFormLabel>
                            {t('Session deadline (ms)')}
                          </SettingsFormLabel>
                          <Input
                            type="number"
                            min={10000}
                            max={180000}
                            value={aiSolver.deadlineMs}
                            onChange={(e) =>
                              updateNumberField('deadlineMs', e.target.value)
                            }
                            w="xs"
                          />
                        </SettingsFormControl>
                        <SettingsFormControl>
                          <SettingsFormLabel>
                            {t('Request timeout (ms)')}
                          </SettingsFormLabel>
                          <Input
                            type="number"
                            min={1000}
                            max={30000}
                            value={aiSolver.requestTimeoutMs}
                            onChange={(e) =>
                              updateNumberField(
                                'requestTimeoutMs',
                                e.target.value
                              )
                            }
                            w="xs"
                          />
                        </SettingsFormControl>
                        <SettingsFormControl>
                          <SettingsFormLabel>
                            {t('Max concurrency')}
                          </SettingsFormLabel>
                          <Input
                            type="number"
                            min={1}
                            max={6}
                            value={aiSolver.maxConcurrency}
                            onChange={(e) =>
                              updateNumberField(
                                'maxConcurrency',
                                e.target.value
                              )
                            }
                            w="xs"
                          />
                        </SettingsFormControl>
                        <SettingsFormControl>
                          <SettingsFormLabel>
                            {t('Inter-flip delay (ms)')}
                          </SettingsFormLabel>
                          <Input
                            type="number"
                            min={0}
                            max={5000}
                            value={aiSolver.interFlipDelayMs}
                            onChange={(e) =>
                              updateNumberField(
                                'interFlipDelayMs',
                                e.target.value
                              )
                            }
                            w="xs"
                          />
                        </SettingsFormControl>
                        <SettingsFormControl>
                          <SettingsFormLabel>
                            {t('Max retries')}
                          </SettingsFormLabel>
                          <Input
                            type="number"
                            min={0}
                            max={3}
                            value={aiSolver.maxRetries}
                            onChange={(e) =>
                              updateNumberField('maxRetries', e.target.value)
                            }
                            w="xs"
                          />
                        </SettingsFormControl>
                        <SettingsFormControl>
                          <SettingsFormLabel>
                            {t('Max output tokens')}
                          </SettingsFormLabel>
                          <Input
                            type="number"
                            min={0}
                            max={8192}
                            value={aiSolver.maxOutputTokens}
                            onChange={(e) =>
                              updateNumberField(
                                'maxOutputTokens',
                                e.target.value
                              )
                            }
                            w="xs"
                          />
                          <Text fontSize="xs" color="muted">
                            {t(
                              'Use 0 for auto. Timeouts and session deadline stay the real hard limits.'
                            )}
                          </Text>
                        </SettingsFormControl>

                        <SettingsFormControl>
                          <SettingsFormLabel>
                            {t('Temperature')}
                          </SettingsFormLabel>
                          <Input
                            type="number"
                            step="0.05"
                            min={0}
                            max={2}
                            value={aiSolver.temperature}
                            onChange={(e) =>
                              updateFloatField('temperature', e.target.value)
                            }
                            w="xs"
                          />
                        </SettingsFormControl>

                        <Flex align="center" justify="space-between">
                          <Box>
                            <Text fontWeight={500}>{t('Force decision')}</Text>
                            <Text color="muted" fontSize="sm">
                              {t(
                                'Avoid final skip answers. If uncertainty remains, choose a side deterministically.'
                              )}
                            </Text>
                          </Box>
                          <Switch
                            isChecked={!!aiSolver.forceDecision}
                            onChange={() =>
                              updateAiSolverSettings({
                                forceDecision: !aiSolver.forceDecision,
                              })
                            }
                          />
                        </Flex>

                        <Flex align="center" justify="space-between">
                          <Box>
                            <Text fontWeight={500}>
                              {t('Uncertainty second pass')}
                            </Text>
                            <Text color="muted" fontSize="sm">
                              {t(
                                'If uncertain and enough time remains, run an additional reasoning pass before final answer.'
                              )}
                            </Text>
                          </Box>
                          <Switch
                            isChecked={!!aiSolver.uncertaintyRepromptEnabled}
                            onChange={() =>
                              updateAiSolverSettings({
                                uncertaintyRepromptEnabled:
                                  !aiSolver.uncertaintyRepromptEnabled,
                              })
                            }
                          />
                        </Flex>

                        {aiSolver.uncertaintyRepromptEnabled && (
                          <>
                            <SettingsFormControl>
                              <SettingsFormLabel>
                                {t('Uncertainty confidence threshold (0-1)')}
                              </SettingsFormLabel>
                              <Input
                                type="number"
                                step="0.05"
                                min={0}
                                max={1}
                                value={aiSolver.uncertaintyConfidenceThreshold}
                                onChange={(e) =>
                                  updateFloatField(
                                    'uncertaintyConfidenceThreshold',
                                    e.target.value
                                  )
                                }
                                w="xs"
                              />
                            </SettingsFormControl>

                            <SettingsFormControl>
                              <SettingsFormLabel>
                                {t('Min remaining time for second pass (ms)')}
                              </SettingsFormLabel>
                              <Input
                                type="number"
                                min={500}
                                max={30000}
                                value={
                                  aiSolver.uncertaintyRepromptMinRemainingMs
                                }
                                onChange={(e) =>
                                  updateNumberField(
                                    'uncertaintyRepromptMinRemainingMs',
                                    e.target.value
                                  )
                                }
                                w="xs"
                              />
                            </SettingsFormControl>

                            <SettingsFormControl>
                              <SettingsFormLabel>
                                {t('Second-pass extra instruction (optional)')}
                              </SettingsFormLabel>
                              <Input
                                value={
                                  aiSolver.uncertaintyRepromptInstruction || ''
                                }
                                onChange={(e) =>
                                  updateAiSolverSettings({
                                    uncertaintyRepromptInstruction:
                                      e.target.value,
                                  })
                                }
                                w="xl"
                                placeholder={t(
                                  'Example: Compare temporal order strictly, then pick the more coherent narrative.'
                                )}
                              />
                            </SettingsFormControl>
                          </>
                        )}

                        <SettingsFormControl>
                          <SettingsFormLabel>
                            {t('Prompt template override (optional)')}
                          </SettingsFormLabel>
                          <Textarea
                            value={aiSolver.promptTemplateOverride || ''}
                            onChange={(e) =>
                              updateAiSolverSettings({
                                promptTemplateOverride: e.target.value,
                              })
                            }
                            minH="120px"
                            maxH="280px"
                            w="xl"
                            placeholder={t(
                              'Use {{hash}}, {{allowSkip}}, {{secondPass}}, {{allowedAnswers}} placeholders.'
                            )}
                          />
                        </SettingsFormControl>
                      </Stack>
                    )}
                  </>
                ) : null}
              </>
            ) : null}
          </Stack>
        </SettingsSection>

        {showLocalAiSetup ? (
          <SettingsSection title={t('Local AI')}>
            <Stack spacing={4}>
              <Text color="muted" fontSize="sm">
                {t(
                  'These settings are local-only and opt-in. IdenaAI should expose its own branded text and multimodal identities here; the runtime backend below is only the local transport and compatibility layer.'
                )}
              </Text>

              <Flex align="center" justify="space-between">
                <Box>
                  <Text fontWeight={500}>{t('Enable local AI')}</Text>
                  <Text color="muted" fontSize="sm">
                    {t(
                      'Keep this off until a local runtime is available on this machine.'
                    )}
                  </Text>
                </Box>
                <Switch
                  isChecked={!!localAi.enabled}
                  onChange={() =>
                    updateLocalAiSettings({enabled: !localAi.enabled})
                  }
                />
              </Flex>

              <SettingsFormControl>
                <SettingsFormLabel>{t('Runtime mode')}</SettingsFormLabel>
                <Select
                  value={localAi.runtimeMode || 'sidecar'}
                  onChange={(e) =>
                    updateLocalAiSettings({runtimeMode: e.target.value})
                  }
                  w="xs"
                >
                  <option value="sidecar">{t('Sidecar')}</option>
                </Select>
              </SettingsFormControl>

              <SettingsFormControl>
                <SettingsFormLabel>{t('Runtime backend')}</SettingsFormLabel>
                <Select
                  value={
                    localAi.runtimeBackend ||
                    DEFAULT_LOCAL_AI_SETTINGS.runtimeBackend
                  }
                  onChange={(e) => applyLocalAiRuntimeBackend(e.target.value)}
                  w="xl"
                >
                  {LOCAL_AI_RUNTIME_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {t(option.label)}
                    </option>
                  ))}
                </Select>
                <Text color="muted" fontSize="sm" mt={1}>
                  {t(
                    'Use Ollama for local Mac inference unless you are intentionally running a custom legacy sidecar on another local port.'
                  )}
                </Text>
              </SettingsFormControl>

              <SettingsFormControl>
                <SettingsFormLabel>{t('Reasoner backend')}</SettingsFormLabel>
                <Input
                  value={localAi.reasonerBackend || ''}
                  onChange={(e) =>
                    updateLocalAiSettings({reasonerBackend: e.target.value})
                  }
                  placeholder="local-reasoner"
                  w="xl"
                />
              </SettingsFormControl>

              <SettingsFormControl>
                <SettingsFormLabel>{t('Vision backend')}</SettingsFormLabel>
                <Input
                  value={localAi.visionBackend || ''}
                  onChange={(e) =>
                    updateLocalAiSettings({visionBackend: e.target.value})
                  }
                  placeholder="local-vision"
                  w="xl"
                />
              </SettingsFormControl>

              <SettingsFormControl>
                <SettingsFormLabel>
                  {t('Branded text model name')}
                </SettingsFormLabel>
                <Input
                  value={localAi.publicModelId || ''}
                  onChange={(e) =>
                    updateLocalAiSettings({publicModelId: e.target.value})
                  }
                  placeholder={DEFAULT_LOCAL_AI_PUBLIC_MODEL_ID}
                  w="xl"
                />
                <Text color="muted" fontSize="sm" mt={1}>
                  {t(
                    'This is the product-facing text identity exposed by IdenaAI, independent of the backend model override.'
                  )}
                </Text>
              </SettingsFormControl>

              <SettingsFormControl>
                <SettingsFormLabel>
                  {t('Branded multimodal model name')}
                </SettingsFormLabel>
                <Input
                  value={localAi.publicVisionId || ''}
                  onChange={(e) =>
                    updateLocalAiSettings({publicVisionId: e.target.value})
                  }
                  placeholder={DEFAULT_LOCAL_AI_PUBLIC_VISION_ID}
                  w="xl"
                />
                <Text color="muted" fontSize="sm" mt={1}>
                  {t(
                    'Use this for the image-aware and flip-aware IdenaAI identity that sits above the local transport.'
                  )}
                </Text>
              </SettingsFormControl>

              <SettingsFormControl>
                <SettingsFormLabel>{t('Contract version')}</SettingsFormLabel>
                <Input
                  value={localAi.contractVersion || ''}
                  onChange={(e) =>
                    updateLocalAiSettings({contractVersion: e.target.value})
                  }
                  placeholder="idena-local/v1"
                  w="xl"
                />
              </SettingsFormControl>

              <SettingsFormControl>
                <SettingsFormLabel>
                  {t('Local runtime endpoint')}
                </SettingsFormLabel>
                <Input
                  value={localAiRuntimeUrl}
                  onChange={(e) =>
                    updateLocalAiSettings({
                      baseUrl: e.target.value,
                      endpoint: e.target.value,
                    })
                  }
                  placeholder="http://127.0.0.1:11434"
                  w="xl"
                />
                <Text color="muted" fontSize="sm" mt={1}>
                  {localAi.runtimeBackend === 'ollama-direct'
                    ? t(
                        'Recommended local runtime endpoint: http://127.0.0.1:11434. Default local text and image model: {{runtimeModel}}. Local MLX training stays in the same Qwen family: {{trainingModel}} is the recommended strong-Mac target, {{strongFallbackModel}} is the stronger fallback, and {{fallbackModel}} remains the safe minimum fallback.',
                        {
                          runtimeModel: RECOMMENDED_LOCAL_AI_OLLAMA_MODEL,
                          trainingModel: RECOMMENDED_LOCAL_AI_TRAINING_MODEL,
                          strongFallbackModel:
                            STRONG_FALLBACK_LOCAL_AI_TRAINING_MODEL,
                          fallbackModel: FALLBACK_LOCAL_AI_TRAINING_MODEL,
                        }
                      )
                    : t(
                        'Use a loopback URL for a custom local sidecar, for example http://127.0.0.1:5000.'
                      )}
                </Text>
                {!localAiEndpointSafety.safe && (
                  <Text color="red.500" fontSize="sm" mt={1}>
                    {localAiEndpointSafety.message}
                  </Text>
                )}
              </SettingsFormControl>

              <Stack isInline spacing={2}>
                <SecondaryButton onClick={applyRecommendedLocalAiSetup}>
                  {t('Use recommended Mac VLM setup')}
                </SecondaryButton>
              </Stack>
              <Text color="muted" fontSize="sm">
                {t(
                  'Runtime model: Ollama at http://127.0.0.1:11434 with {{visionModel}}. Training model: {{trainingModel}}. Benchmark and matrix runs use that MLX base by default. Stronger fallback: {{strongFallbackModel}}. Safe fallback: {{fallbackModel}}.',
                  {
                    visionModel: RECOMMENDED_LOCAL_AI_OLLAMA_VISION_MODEL,
                    trainingModel: RECOMMENDED_LOCAL_AI_TRAINING_MODEL,
                    strongFallbackModel:
                      STRONG_FALLBACK_LOCAL_AI_TRAINING_MODEL,
                    fallbackModel: FALLBACK_LOCAL_AI_TRAINING_MODEL,
                  }
                )}
              </Text>

              <Stack spacing={2} align="flex-start">
                <SecondaryButton
                  onClick={() =>
                    setShowLocalAiCompatibilityOverrides((value) => !value)
                  }
                >
                  {showLocalAiCompatibilityOverrides
                    ? t('Hide runtime compatibility overrides')
                    : t('Show runtime compatibility overrides')}
                </SecondaryButton>
                <Text color="muted" fontSize="sm">
                  {t(
                    'These legacy override fields are only for wire/runtime compatibility. They are not the public Idena product identity.'
                  )}
                </Text>
              </Stack>

              {showLocalAiCompatibilityOverrides ? (
                <>
                  <SettingsFormControl>
                    <SettingsFormLabel>
                      {t('Reasoner model override')}
                    </SettingsFormLabel>
                    <Input
                      value={localAi.model || ''}
                      onChange={(e) =>
                        updateLocalAiSettings({model: e.target.value})
                      }
                      placeholder={t('Leave blank to use the runtime default')}
                      w="xl"
                    />
                    <Text color="muted" fontSize="sm" mt={1}>
                      {t(
                        'Compatibility override for the current local runtime wire contract. This is not the product identity.'
                      )}
                    </Text>
                  </SettingsFormControl>

                  <SettingsFormControl>
                    <SettingsFormLabel>
                      {t('Vision model override')}
                    </SettingsFormLabel>
                    <Input
                      value={
                        typeof localAi.visionModel === 'string'
                          ? localAi.visionModel
                          : ''
                      }
                      onChange={(e) =>
                        updateLocalAiSettings({visionModel: e.target.value})
                      }
                      placeholder={t('Leave blank to use the runtime default')}
                      w="xl"
                    />
                    <Text color="muted" fontSize="sm" mt={1}>
                      {t(
                        'Compatibility override for the current image-aware runtime path. On stronger Macs, {{visionModel}} is the recommended Ollama vision model. Install it with: ollama pull {{visionModel}}',
                        {
                          visionModel: RECOMMENDED_LOCAL_AI_OLLAMA_VISION_MODEL,
                        }
                      )}
                    </Text>
                  </SettingsFormControl>

                  <SettingsFormControl>
                    <SettingsFormLabel>
                      {t('Wire runtime type')}
                    </SettingsFormLabel>
                    <Input
                      value={localAi.runtimeType || ''}
                      onChange={(e) =>
                        updateLocalAiSettings({runtimeType: e.target.value})
                      }
                      placeholder={localAiWireRuntimeType}
                      w="xl"
                    />
                    <Text color="muted" fontSize="sm" mt={1}>
                      {t(
                        'Legacy compatibility field for the current runtime bridge. Leave blank unless you need to force a wire-level runtime.'
                      )}
                    </Text>
                  </SettingsFormControl>

                  <SettingsFormControl>
                    <SettingsFormLabel>
                      {t('Wire runtime family')}
                    </SettingsFormLabel>
                    <Input
                      value={localAi.runtimeFamily || ''}
                      onChange={(e) =>
                        updateLocalAiSettings({runtimeFamily: e.target.value})
                      }
                      placeholder={localAi.reasonerBackend || 'local-reasoner'}
                      w="xl"
                    />
                    <Text color="muted" fontSize="sm" mt={1}>
                      {t(
                        'Legacy compatibility label retained for old payloads and persisted settings.'
                      )}
                    </Text>
                  </SettingsFormControl>
                </>
              ) : null}

              <Flex align="center" justify="space-between">
                <Box>
                  <Text fontWeight={500}>
                    {t('Capture eligible flips locally')}
                  </Text>
                  <Text color="muted" fontSize="sm">
                    {t(
                      'Stores the local capture preference only. This does not change cloud-provider behavior.'
                    )}
                  </Text>
                </Box>
                <Switch
                  isChecked={!!localAi.captureEnabled}
                  onChange={() =>
                    updateLocalAiSettings({
                      captureEnabled: !localAi.captureEnabled,
                    })
                  }
                />
              </Flex>

              <Box
                borderWidth="1px"
                borderColor="gray.100"
                borderRadius="md"
                p={3}
              >
                <Stack spacing={3}>
                  <Box>
                    <Text fontWeight={500}>{t('Training ranking policy')}</Text>
                    <Text color="muted" fontSize="sm">
                      {t(
                        'Modern flips should be ranked from your own local node and local index snapshot first. Public indexer data is only a fallback when local ranking data is missing.'
                      )}
                    </Text>
                  </Box>

                  <Flex align="center" justify="space-between">
                    <Box>
                      <Text fontWeight={500}>
                        {t('Allow public indexer fallback')}
                      </Text>
                      <Text color="muted" fontSize="sm">
                        {t(
                          'Keep ranking alive if your local index snapshot is incomplete or offline during a training-package build.'
                        )}
                      </Text>
                    </Box>
                    <Switch
                      isChecked={
                        localAi.rankingPolicy.allowPublicIndexerFallback !==
                        false
                      }
                      onChange={() =>
                        updateLocalAiSettings({
                          rankingPolicy: {
                            allowPublicIndexerFallback:
                              localAi.rankingPolicy
                                .allowPublicIndexerFallback === false,
                          },
                        })
                      }
                    />
                  </Flex>

                  <SettingsFormControl>
                    <SettingsFormLabel>
                      {t('Extra-flip baseline')}
                    </SettingsFormLabel>
                    <Input
                      type="number"
                      min={0}
                      step={1}
                      value={String(
                        localAi.rankingPolicy.extraFlipBaseline ?? 3
                      )}
                      onChange={(e) =>
                        updateLocalAiSettings({
                          rankingPolicy: {
                            extraFlipBaseline: Number.parseInt(
                              e.target.value,
                              10
                            ),
                          },
                        })
                      }
                      w="xs"
                    />
                    <Text color="muted" fontSize="sm" mt={1}>
                      {t(
                        'Authors above this flip count in one epoch are downweighted as extra-flip producers.'
                      )}
                    </Text>
                  </SettingsFormControl>

                  <Flex align="center" justify="space-between">
                    <Box>
                      <Text fontWeight={500}>{t('Exclude bad authors')}</Text>
                      <Text color="muted" fontSize="sm">
                        {t(
                          'Drop flips entirely when the author is flagged for WrongWords in the ranking layer.'
                        )}
                      </Text>
                    </Box>
                    <Switch
                      isChecked={
                        localAi.rankingPolicy.excludeBadAuthors === true
                      }
                      onChange={() =>
                        updateLocalAiSettings({
                          rankingPolicy: {
                            excludeBadAuthors:
                              localAi.rankingPolicy.excludeBadAuthors !== true,
                          },
                        })
                      }
                    />
                  </Flex>

                  <Flex align="center" justify="space-between">
                    <Box>
                      <Text fontWeight={500}>
                        {t('Exclude repeated report offenders')}
                      </Text>
                      <Text color="muted" fontSize="sm">
                        {t(
                          'Optionally remove flips from authors who repeatedly accumulate reported or wrongWords-style penalties.'
                        )}
                      </Text>
                    </Box>
                    <Switch
                      isChecked={
                        localAi.rankingPolicy.excludeRepeatReportOffenders ===
                        true
                      }
                      onChange={() =>
                        updateLocalAiSettings({
                          rankingPolicy: {
                            excludeRepeatReportOffenders:
                              localAi.rankingPolicy
                                .excludeRepeatReportOffenders !== true,
                          },
                        })
                      }
                    />
                  </Flex>

                  <SettingsFormControl>
                    <SettingsFormLabel>
                      {t('Allowed repeat offenses before exclusion')}
                    </SettingsFormLabel>
                    <Input
                      type="number"
                      min={0}
                      step={1}
                      value={String(
                        localAi.rankingPolicy.maxRepeatReportOffenses ?? 1
                      )}
                      onChange={(e) =>
                        updateLocalAiSettings({
                          rankingPolicy: {
                            maxRepeatReportOffenses: Number.parseInt(
                              e.target.value,
                              10
                            ),
                          },
                        })
                      }
                      w="xs"
                    />
                    <Text color="muted" fontSize="sm" mt={1}>
                      {t(
                        'Used only when repeated-offender exclusion is enabled. Higher-quality modern flips automatically receive stronger training weights.'
                      )}
                    </Text>
                  </SettingsFormControl>
                </Stack>
              </Box>

              <Flex align="center" justify="space-between">
                <Box>
                  <Text fontWeight={500}>{t('Enable federated updates')}</Text>
                  <Text color="muted" fontSize="sm">
                    {t(
                      'Stores the future federated-learning preference only. No background sharing starts in this build.'
                    )}
                  </Text>
                </Box>
                <Switch
                  isChecked={!!localAi.federated.enabled}
                  onChange={() =>
                    updateLocalAiSettings({
                      federated: {
                        enabled: !localAi.federated.enabled,
                      },
                    })
                  }
                />
              </Flex>

              <Box
                borderWidth="1px"
                borderColor="gray.100"
                borderRadius="md"
                p={3}
              >
                <Stack spacing={2}>
                  <Text fontWeight={500}>{t('Runtime control')}</Text>
                  <Text color="muted" fontSize="sm">
                    {t(
                      'These controls only probe or mark the optional local runtime. Cloud provider flows stay unchanged unless you explicitly choose Local AI.'
                    )}
                  </Text>
                  <Box bg="gray.50" borderRadius="md" p={3}>
                    <Stack spacing={1}>
                      <Text color={localAiRuntimeStatus.tone} fontWeight={500}>
                        {localAiRuntimeStatus.title}
                      </Text>
                      <Text color="muted" fontSize="sm">
                        {localAiRuntimeStatus.description}
                      </Text>
                    </Stack>
                  </Box>
                  <Stack isInline spacing={2}>
                    <SecondaryButton
                      isDisabled={!localAi.enabled || isStartingLocalAi}
                      onClick={async () => {
                        setIsStartingLocalAi(true)

                        try {
                          const result = normalizeLocalAiStatusResult(
                            await ensureLocalAiBridge().start(
                              localAiRuntimePayload
                            ),
                            localAiRuntimeUrl
                          )
                          setLocalAiStatusResult(result)

                          notify(
                            t('Local AI runtime updated'),
                            formatLocalAiStatusDescription(result, t),
                            result && result.status === 'ok'
                              ? 'success'
                              : 'warning'
                          )
                        } catch (error) {
                          notify(
                            t('Unable to start Local AI'),
                            formatErrorForToast(error),
                            'error'
                          )
                        } finally {
                          setIsStartingLocalAi(false)
                        }
                      }}
                    >
                      {t('Start local runtime')}
                    </SecondaryButton>
                    <SecondaryButton
                      isDisabled={!localAi.enabled || isStoppingLocalAi}
                      onClick={async () => {
                        setIsStoppingLocalAi(true)

                        try {
                          await ensureLocalAiBridge().stop()
                          setLocalAiStatusResult(
                            normalizeLocalAiStatusResult(
                              {
                                enabled: true,
                                status: 'error',
                                runtime:
                                  localAi.runtimeBackend ||
                                  DEFAULT_LOCAL_AI_SETTINGS.runtimeBackend,
                                baseUrl: localAiRuntimeUrl,
                                error: t('Local AI runtime is idle.'),
                                lastError: t('Local AI runtime is idle.'),
                              },
                              localAiRuntimeUrl
                            )
                          )

                          notify(
                            t('Local AI runtime stopped'),
                            t(
                              'The optional Local AI bridge is now idle. Existing cloud providers were not changed.'
                            ),
                            'info'
                          )
                        } catch (error) {
                          notify(
                            t('Unable to stop Local AI'),
                            formatErrorForToast(error),
                            'error'
                          )
                        } finally {
                          setIsStoppingLocalAi(false)
                        }
                      }}
                    >
                      {t('Stop local runtime')}
                    </SecondaryButton>
                    <SecondaryButton
                      isDisabled={!localAi.enabled || isCheckingLocalAi}
                      onClick={async () => {
                        try {
                          const result = await requestLocalAiStatus()

                          notify(
                            result && result.status === 'ok'
                              ? t('Local AI runtime reachable')
                              : t('Local AI runtime unavailable'),
                            formatLocalAiStatusDescription(result, t),
                            result && result.status === 'ok'
                              ? 'success'
                              : 'warning'
                          )
                        } catch (error) {
                          notify(
                            t('Unable to check Local AI status'),
                            formatErrorForToast(error),
                            'error'
                          )
                        }
                      }}
                    >
                      {t('Check status')}
                    </SecondaryButton>
                  </Stack>
                  <Text color="muted" fontSize="sm">
                    {t(
                      'Choose Local AI as the main provider above to route the solver through this runtime. OpenAI-compatible (custom) remains available for third-party compatible endpoints.'
                    )}
                  </Text>
                </Stack>
              </Box>

              {localAi.enabled ? (
                <Box
                  borderWidth="1px"
                  borderColor="orange.100"
                  borderRadius="md"
                  p={3}
                  bg="orange.012"
                >
                  <Stack spacing={3}>
                    <Text fontWeight={500}>{t('Local AI Debug')}</Text>
                    <Text color="muted" fontSize="sm">
                      {t('Developer test tools. No cloud fallback.')}
                    </Text>

                    <Box bg="white" borderRadius="md" p={3}>
                      <Stack spacing={2}>
                        <Flex align="center" justify="space-between">
                          <Box>
                            <Text fontWeight={500}>{t('Runtime status')}</Text>
                            <Text color="muted" fontSize="sm">
                              {localAiRuntimeStatus.description}
                            </Text>
                          </Box>
                          <Text
                            color={localAiRuntimeStatus.tone}
                            fontWeight={600}
                          >
                            {localAiRuntimeStatus.title}
                          </Text>
                        </Flex>
                        <Stack isInline spacing={2}>
                          <SecondaryButton
                            isLoading={isCheckingLocalAi}
                            onClick={async () => {
                              try {
                                await requestLocalAiStatus()
                              } catch (error) {
                                notify(
                                  t('Unable to check Local AI status'),
                                  formatErrorForToast(error),
                                  'error'
                                )
                              }
                            }}
                          >
                            {t('Check Local AI')}
                          </SecondaryButton>
                        </Stack>
                        <LocalAiDebugResult
                          label={t('Status result')}
                          result={localAiStatusResult}
                        />
                      </Stack>
                    </Box>

                    <Box bg="white" borderRadius="md" p={3}>
                      <Stack spacing={3}>
                        <Text fontWeight={500}>{t('Chat test')}</Text>
                        <SettingsFormControl>
                          <SettingsFormLabel>{t('Prompt')}</SettingsFormLabel>
                          <Textarea
                            value={localAiDebugChatPrompt}
                            onChange={(e) =>
                              setLocalAiDebugChatPrompt(e.target.value)
                            }
                            minH="90px"
                          />
                        </SettingsFormControl>
                        <Stack isInline spacing={2}>
                          <SecondaryButton
                            isLoading={isRunningLocalAiChat}
                            onClick={runLocalAiChatTest}
                          >
                            {t('Run Local Chat')}
                          </SecondaryButton>
                        </Stack>
                        <LocalAiDebugResult
                          label={t('Chat result')}
                          result={localAiChatResult}
                        />
                      </Stack>
                    </Box>

                    <Box bg="white" borderRadius="md" p={3}>
                      <Stack spacing={3}>
                        <Text fontWeight={500}>
                          {t('flipToText / checker test')}
                        </Text>
                        <Text color="muted" fontSize="sm">
                          {t(
                            'Provide JSON with local image paths, for example {"images":["/absolute/path/panel-1.png","/absolute/path/panel-2.png"]}.'
                          )}
                        </Text>
                        <SettingsFormControl>
                          <SettingsFormLabel>
                            {t('Input JSON')}
                          </SettingsFormLabel>
                          <Textarea
                            value={localAiDebugFlipInput}
                            onChange={(e) =>
                              setLocalAiDebugFlipInput(e.target.value)
                            }
                            minH="140px"
                          />
                        </SettingsFormControl>
                        <Stack isInline spacing={2}>
                          <SecondaryButton
                            isLoading={isRunningLocalAiFlipToText}
                            onClick={() => runLocalAiFlipTest('flipToText')}
                          >
                            {t('Run flipToText')}
                          </SecondaryButton>
                          <SecondaryButton
                            isLoading={isRunningLocalAiFlipChecker}
                            onClick={() =>
                              runLocalAiFlipTest('checkFlipSequence')
                            }
                          >
                            {t('Run Flip Checker')}
                          </SecondaryButton>
                        </Stack>
                        <LocalAiDebugResult
                          label={t('flipToText result')}
                          result={localAiFlipToTextResult}
                        />
                        <LocalAiDebugResult
                          label={t('Flip checker result')}
                          result={localAiFlipCheckerResult}
                        />
                      </Stack>
                    </Box>

                    <Box bg="white" borderRadius="md" p={3}>
                      <Stack spacing={3}>
                        <Text fontWeight={500}>
                          {t('Human Teacher Annotator')}
                        </Text>
                        <Text color="muted" fontSize="sm">
                          {t(
                            'Open the post-session annotation tool, or load an offline demo batch from bundled sample flips to test the annotator without waiting for consensus.'
                          )}
                        </Text>
                        <Stack isInline spacing={2} flexWrap="wrap">
                          <SecondaryButton
                            onClick={() =>
                              router.push('/settings/ai-human-teacher')
                            }
                          >
                            {t('Open Human Teacher Lab')}
                          </SecondaryButton>
                          <SecondaryButton
                            onClick={() =>
                              router.push(
                                '/settings/ai-human-teacher?action=demo&sample=flip-challenge-test-5-decoded-labeled'
                              )
                            }
                          >
                            {t('Start Offline Demo')}
                          </SecondaryButton>
                        </Stack>
                      </Stack>
                    </Box>

                    <Box bg="white" borderRadius="md" p={3}>
                      <Stack spacing={3}>
                        <Text fontWeight={500}>
                          {t('Local AI Training Package Review')}
                        </Text>
                        <Text color="muted" fontSize="sm">
                          {t(
                            'Developer/admin review only. This generates a local post-consensus package preview and export path. No training or sharing is triggered.'
                          )}
                        </Text>
                        <SettingsFormControl>
                          <SettingsFormLabel>{t('Epoch')}</SettingsFormLabel>
                          <Input
                            value={localAiPackageEpoch}
                            onChange={(e) =>
                              setLocalAiPackageEpoch(e.target.value)
                            }
                            placeholder="12"
                            w="xs"
                          />
                        </SettingsFormControl>
                        <Stack isInline spacing={2}>
                          <SecondaryButton
                            isLoading={isLoadingLocalAiPackage}
                            onClick={() =>
                              runLocalAiTrainingPackageAction(true)
                            }
                          >
                            {t('Generate Package Preview')}
                          </SecondaryButton>
                          <SecondaryButton
                            isLoading={isExportingLocalAiPackage}
                            onClick={() =>
                              runLocalAiTrainingPackageAction(false)
                            }
                          >
                            {t('Export Package')}
                          </SecondaryButton>
                        </Stack>
                        {localAiPackageError ? (
                          <Text color="orange.500" fontSize="sm">
                            {localAiPackageError}
                          </Text>
                        ) : null}
                        {localAiPackageExportPath ? (
                          <Box
                            borderWidth="1px"
                            borderColor="gray.100"
                            borderRadius="md"
                            p={3}
                          >
                            <Stack spacing={1}>
                              <Text fontWeight={500}>
                                {t('Export complete')}
                              </Text>
                              <Text color="muted" fontSize="sm">
                                {localAiPackageExportPath}
                              </Text>
                            </Stack>
                          </Box>
                        ) : null}
                        <Box
                          borderWidth="1px"
                          borderColor="gray.100"
                          borderRadius="md"
                          p={3}
                        >
                          <Stack spacing={3}>
                            <Stack spacing={1}>
                              <Text fontWeight={500}>
                                {t('Adapter artifact registration')}
                              </Text>
                              <Text color="muted" fontSize="sm">
                                {t(
                                  'Register one local adapter file for this epoch to promote federated exports from pending metadata to a concrete adapter contract.'
                                )}
                              </Text>
                            </Stack>
                            <SettingsFormControl>
                              <SettingsFormLabel>
                                {t('Local adapter file path')}
                              </SettingsFormLabel>
                              <Input
                                value={localAiAdapterSourcePath}
                                onChange={(e) =>
                                  setLocalAiAdapterSourcePath(e.target.value)
                                }
                                placeholder="/absolute/path/to/epoch-12-lora.safetensors"
                              />
                            </SettingsFormControl>
                            <Stack isInline spacing={2}>
                              <SecondaryButton
                                isLoading={isRegisteringLocalAiAdapter}
                                onClick={runLocalAiRegisterAdapterArtifact}
                              >
                                {t('Register Adapter')}
                              </SecondaryButton>
                              <SecondaryButton
                                isLoading={isLoadingLocalAiAdapter}
                                onClick={runLocalAiLoadAdapterArtifact}
                              >
                                {t('Load Registered Adapter')}
                              </SecondaryButton>
                            </Stack>
                            {localAiAdapterError ? (
                              <Text color="orange.500" fontSize="sm">
                                {localAiAdapterError}
                              </Text>
                            ) : null}
                            {localAiAdapterManifest ? (
                              <Box
                                borderWidth="1px"
                                borderColor="gray.50"
                                borderRadius="md"
                                p={3}
                              >
                                <Stack spacing={1}>
                                  <Text
                                    color={localAiAdapterContractUi.color}
                                    fontSize="sm"
                                    fontWeight={600}
                                  >
                                    {t('Stored contract')}:{' '}
                                    {localAiAdapterContractUi.label}
                                  </Text>
                                  <Text color="muted" fontSize="sm">
                                    {t('Registered at')}:{' '}
                                    {formatLocalAiTrainingPackageTimestamp(
                                      localAiAdapterManifest.registeredAt
                                    )}
                                  </Text>
                                  <Text color="muted" fontSize="sm">
                                    {t('Adapter manifest path')}:{' '}
                                    {localAiAdapterManifest.adapterManifestPath}
                                  </Text>
                                  <Text color="muted" fontSize="sm">
                                    {t('Public model')}:{' '}
                                    {localAiAdapterManifest.publicModelId ||
                                      '-'}
                                  </Text>
                                  <Text color="muted" fontSize="sm">
                                    {t('Base model')}:{' '}
                                    {localAiAdapterManifest.baseModelId || '-'}
                                  </Text>
                                  <Text color="muted" fontSize="sm">
                                    {t('Adapter format')}:{' '}
                                    {localAiAdapterManifest.adapterFormat ||
                                      '-'}
                                  </Text>
                                  <Text color="muted" fontSize="sm">
                                    {t('Adapter SHA-256')}:{' '}
                                    {localAiAdapterManifest.adapterSha256 ||
                                      '-'}
                                  </Text>
                                  <Text color="muted" fontSize="sm">
                                    {t('Training config hash')}:{' '}
                                    {localAiAdapterManifest.trainingConfigHash ||
                                      '-'}
                                  </Text>
                                  <Text color="muted" fontSize="sm">
                                    {t('Artifact file')}:{' '}
                                    {(localAiAdapterManifest.adapterArtifact &&
                                      localAiAdapterManifest.adapterArtifact
                                        .file) ||
                                      '-'}
                                  </Text>
                                  <Text color="muted" fontSize="sm">
                                    {t('Artifact size')}:{' '}
                                    {formatLocalAiArtifactSize(
                                      localAiAdapterManifest.adapterArtifact &&
                                        localAiAdapterManifest.adapterArtifact
                                          .sizeBytes
                                    )}
                                  </Text>
                                  <Text color="muted" fontSize="sm">
                                    {t('Source path')}:{' '}
                                    {(localAiAdapterManifest.adapterArtifact &&
                                      localAiAdapterManifest.adapterArtifact
                                        .sourcePath) ||
                                      '-'}
                                  </Text>
                                </Stack>
                              </Box>
                            ) : null}
                            {localAiPackageNeedsRefreshAfterAdapterRegistration ? (
                              <Text color="blue.500" fontSize="xs">
                                {t(
                                  'A package preview for this epoch still shows a pending adapter contract. Regenerate the package preview to refresh it to the stored adapter registration.'
                                )}
                              </Text>
                            ) : null}
                          </Stack>
                        </Box>
                        <Box
                          borderWidth="1px"
                          borderColor="gray.100"
                          borderRadius="md"
                          p={3}
                        >
                          <Stack spacing={3}>
                            <Stack spacing={1}>
                              <Text fontWeight={500}>
                                {t('Federated bundle operations')}
                              </Text>
                              <Text color="muted" fontSize="sm">
                                {t(
                                  'Building a local federated bundle now requires an approved training package and a concrete registered adapter artifact for the same epoch.'
                                )}
                              </Text>
                            </Stack>
                            <Stack isInline spacing={2}>
                              <SecondaryButton
                                isLoading={isBuildingLocalAiBundle}
                                onClick={runLocalAiBuildBundle}
                              >
                                {t('Build Federated Bundle')}
                              </SecondaryButton>
                              <SecondaryButton
                                isLoading={isAggregatingLocalAiBundles}
                                onClick={runLocalAiAggregateBundles}
                              >
                                {t('Aggregate Received Bundles')}
                              </SecondaryButton>
                            </Stack>
                            <SettingsFormControl>
                              <SettingsFormLabel>
                                {t('Incoming bundle path')}
                              </SettingsFormLabel>
                              <Input
                                value={localAiBundleImportPath}
                                onChange={(e) =>
                                  setLocalAiBundleImportPath(e.target.value)
                                }
                                placeholder="/absolute/path/to/incoming/update-epoch.json"
                              />
                            </SettingsFormControl>
                            <SecondaryButton
                              isLoading={isImportingLocalAiBundle}
                              onClick={runLocalAiImportBundle}
                            >
                              {t('Import Bundle')}
                            </SecondaryButton>
                            {localAiFederatedError ? (
                              <Text color="orange.500" fontSize="sm">
                                {localAiFederatedError}
                              </Text>
                            ) : null}
                            {localAiBuildBundleResult ? (
                              <Box
                                borderWidth="1px"
                                borderColor="gray.50"
                                borderRadius="md"
                                p={3}
                              >
                                <Stack spacing={1}>
                                  <Text fontWeight={500}>
                                    {t('Latest built bundle')}
                                  </Text>
                                  <Text color="muted" fontSize="sm">
                                    {t('Delta type')}:{' '}
                                    {localAiBuildBundleResult.deltaType || '-'}
                                  </Text>
                                  <Text color="muted" fontSize="sm">
                                    {t('Signed')}:{' '}
                                    {localAiBuildBundleResult.signed
                                      ? t('Yes')
                                      : t('No')}
                                  </Text>
                                  <Text color="muted" fontSize="sm">
                                    {t('Eligible')}:{' '}
                                    {Number(
                                      localAiBuildBundleResult.eligibleCount
                                    ) || 0}
                                  </Text>
                                  <Text color="muted" fontSize="sm">
                                    {t('Bundle path')}:{' '}
                                    {localAiBuildBundleResult.bundlePath || '-'}
                                  </Text>
                                  <Text color="muted" fontSize="sm">
                                    {t('Artifact path')}:{' '}
                                    {localAiBuildBundleResult.artifactPath ||
                                      '-'}
                                  </Text>
                                </Stack>
                              </Box>
                            ) : null}
                            {localAiImportBundleResult ? (
                              <Box
                                borderWidth="1px"
                                borderColor="gray.50"
                                borderRadius="md"
                                p={3}
                              >
                                <Stack spacing={1}>
                                  <Text fontWeight={500}>
                                    {t('Latest import result')}
                                  </Text>
                                  <Text color="muted" fontSize="sm">
                                    {t('Accepted')}:{' '}
                                    {localAiImportBundleResult.accepted
                                      ? t('Yes')
                                      : t('No')}
                                  </Text>
                                  <Text color="muted" fontSize="sm">
                                    {t('Reason')}:{' '}
                                    {formatLocalAiFederatedReason(
                                      localAiImportBundleResult.reason
                                    )}
                                  </Text>
                                  <Text color="muted" fontSize="sm">
                                    {t('Bundle path')}:{' '}
                                    {localAiImportBundleResult.bundlePath ||
                                      '-'}
                                  </Text>
                                  <Text color="muted" fontSize="sm">
                                    {t('Stored path')}:{' '}
                                    {localAiImportBundleResult.storedPath ||
                                      '-'}
                                  </Text>
                                  <Text color="muted" fontSize="sm">
                                    {t('Artifact path')}:{' '}
                                    {localAiImportBundleResult.artifactPath ||
                                      '-'}
                                  </Text>
                                </Stack>
                              </Box>
                            ) : null}
                            {localAiAggregateResult ? (
                              <Box
                                borderWidth="1px"
                                borderColor="gray.50"
                                borderRadius="md"
                                p={3}
                              >
                                <Stack spacing={1}>
                                  <Text fontWeight={500}>
                                    {t('Latest aggregation result')}
                                  </Text>
                                  <Text color="muted" fontSize="sm">
                                    {t('Mode')}:{' '}
                                    {localAiAggregateResult.mode || '-'}
                                  </Text>
                                  <Text color="muted" fontSize="sm">
                                    {t('Compatible bundles')}:{' '}
                                    {Number(
                                      localAiAggregateResult.compatibleCount
                                    ) || 0}
                                  </Text>
                                  <Text color="muted" fontSize="sm">
                                    {t('Skipped bundles')}:{' '}
                                    {Number(
                                      localAiAggregateResult.skippedCount
                                    ) || 0}
                                  </Text>
                                  <Text color="muted" fontSize="sm">
                                    {t('Output path')}:{' '}
                                    {localAiAggregateResult.outputPath || '-'}
                                  </Text>
                                </Stack>
                              </Box>
                            ) : null}
                          </Stack>
                        </Box>
                        {localAiPackagePreview &&
                        localAiPackagePreview.package ? (
                          <Box
                            borderWidth="1px"
                            borderColor="gray.100"
                            borderRadius="md"
                            p={3}
                          >
                            <Stack spacing={3}>
                              <Stack spacing={1}>
                                <Text fontWeight={500}>
                                  {t('Package metadata')}
                                </Text>
                                <Text
                                  color={localAiPackageReviewStatusUi.color}
                                  fontSize="sm"
                                  fontWeight={600}
                                >
                                  {t('Review status')}:{' '}
                                  {localAiPackageReviewStatusUi.label}
                                </Text>
                                <Text color="muted" fontSize="sm">
                                  {t('Reviewed at')}:{' '}
                                  {formatLocalAiTrainingPackageTimestamp(
                                    localAiPackagePreview.package.reviewedAt
                                  )}
                                </Text>
                                <Text
                                  color={localAiPackageFederatedReadyUi.color}
                                  fontSize="sm"
                                  fontWeight={500}
                                >
                                  {t('Federated-ready')}:{' '}
                                  {localAiPackageFederatedReadyUi.label}
                                </Text>
                                <Text
                                  color={localAiPackageContractUi.color}
                                  fontSize="sm"
                                  fontWeight={500}
                                >
                                  {t('Contract state')}:{' '}
                                  {localAiPackageContractUi.label}
                                </Text>
                                <Text color="muted" fontSize="sm">
                                  {t('Schema version')}:{' '}
                                  {localAiPackagePreview.package.schemaVersion}
                                </Text>
                                <Text color="muted" fontSize="sm">
                                  {t('Created')}:{' '}
                                  {formatLocalAiTrainingPackageTimestamp(
                                    localAiPackagePreview.package.createdAt
                                  )}
                                </Text>
                                <Text color="muted" fontSize="sm">
                                  {t('Eligible')}:{' '}
                                  {Number(
                                    localAiPackagePreview.package.eligibleCount
                                  ) || 0}
                                </Text>
                                <Text color="muted" fontSize="sm">
                                  {t('Excluded')}:{' '}
                                  {Number(
                                    localAiPackagePreview.package.excludedCount
                                  ) || 0}
                                </Text>
                                <Text color="muted" fontSize="sm">
                                  {t('Package path')}:{' '}
                                  {localAiPackagePreview.packagePath}
                                </Text>
                                <Text color="muted" fontSize="sm">
                                  {t('Adapter format')}:{' '}
                                  {localAiPackagePreview.package
                                    .adapterFormat || '-'}
                                </Text>
                                <Text color="muted" fontSize="sm">
                                  {t('Adapter SHA-256')}:{' '}
                                  {localAiPackagePreview.package
                                    .adapterSha256 || '-'}
                                </Text>
                                <Text color="muted" fontSize="sm">
                                  {t('Training config hash')}:{' '}
                                  {localAiPackagePreview.package
                                    .trainingConfigHash || '-'}
                                </Text>
                                <Text color="muted" fontSize="sm">
                                  {t('Artifact file')}:{' '}
                                  {(localAiPackagePreview.package
                                    .adapterArtifact &&
                                    localAiPackagePreview.package
                                      .adapterArtifact.file) ||
                                    '-'}
                                </Text>
                                <Text color="muted" fontSize="sm">
                                  {t('Artifact size')}:{' '}
                                  {formatLocalAiArtifactSize(
                                    localAiPackagePreview.package
                                      .adapterArtifact &&
                                      localAiPackagePreview.package
                                        .adapterArtifact.sizeBytes
                                  )}
                                </Text>
                                <Text color="muted" fontSize="xs">
                                  {t(
                                    'Only approved packages should be used for future federated workflows.'
                                  )}
                                </Text>
                                <Text color="muted" fontSize="xs">
                                  {t(
                                    'Federated-ready is a local preparation marker only. No sharing happens here.'
                                  )}
                                </Text>
                              </Stack>

                              <Stack isInline spacing={2}>
                                <SecondaryButton
                                  isDisabled={isUpdatingLocalAiPackageReview}
                                  isLoading={
                                    isUpdatingLocalAiPackageReview &&
                                    normalizeLocalAiTrainingPackageReviewStatus(
                                      localAiPackagePreview.package.reviewStatus
                                    ) === 'draft'
                                  }
                                  onClick={() =>
                                    updateLocalAiTrainingPackageReviewStatus(
                                      'draft'
                                    )
                                  }
                                >
                                  {t('Mark Draft')}
                                </SecondaryButton>
                                <SecondaryButton
                                  isDisabled={isUpdatingLocalAiPackageReview}
                                  onClick={() =>
                                    updateLocalAiTrainingPackageReviewStatus(
                                      'reviewed'
                                    )
                                  }
                                >
                                  {t('Mark Reviewed')}
                                </SecondaryButton>
                                <SecondaryButton
                                  isDisabled={isUpdatingLocalAiPackageReview}
                                  onClick={() =>
                                    updateLocalAiTrainingPackageReviewStatus(
                                      'approved'
                                    )
                                  }
                                >
                                  {t('Approve')}
                                </SecondaryButton>
                                <SecondaryButton
                                  isDisabled={isUpdatingLocalAiPackageReview}
                                  onClick={() =>
                                    updateLocalAiTrainingPackageReviewStatus(
                                      'rejected'
                                    )
                                  }
                                >
                                  {t('Reject')}
                                </SecondaryButton>
                              </Stack>

                              <Stack spacing={2}>
                                <Text fontWeight={500}>
                                  {t('Included items')}
                                </Text>
                                {(Array.isArray(
                                  localAiPackagePreview.package.items
                                )
                                  ? localAiPackagePreview.package.items.slice(
                                      0,
                                      5
                                    )
                                  : []
                                ).map((item) => (
                                  <Box
                                    key={`${item.flipHash || 'unknown'}-${
                                      item.capturedAt || 'na'
                                    }`}
                                    borderWidth="1px"
                                    borderColor="gray.50"
                                    borderRadius="md"
                                    p={2}
                                  >
                                    <Stack spacing={1}>
                                      <Text fontSize="sm" fontWeight={500}>
                                        {item.flipHash || t('Unknown item')}
                                      </Text>
                                      <Text color="muted" fontSize="xs">
                                        {t('Answer')}: {item.finalAnswer || '-'}{' '}
                                        • {t('Session')}:{' '}
                                        {item.sessionType || '-'} •{' '}
                                        {t('Panels')}:{' '}
                                        {Number(item.panelCount) || 0}
                                      </Text>
                                      <Text color="muted" fontSize="xs">
                                        {t('Captured')}:{' '}
                                        {formatLocalAiTrainingPackageTimestamp(
                                          item.capturedAt
                                        )}
                                      </Text>
                                    </Stack>
                                  </Box>
                                ))}
                                {Array.isArray(
                                  localAiPackagePreview.package.items
                                ) &&
                                localAiPackagePreview.package.items.length >
                                  5 ? (
                                  <Text color="muted" fontSize="xs">
                                    {t(
                                      'Showing the first {{count}} items only.',
                                      {
                                        count: 5,
                                      }
                                    )}
                                  </Text>
                                ) : null}
                              </Stack>
                            </Stack>
                          </Box>
                        ) : null}
                      </Stack>
                    </Box>
                  </Stack>
                </Box>
              ) : null}
            </Stack>
          </SettingsSection>
        ) : null}

        {showProviderSetup ? (
          <SettingsSection
            title={
              isLocalAiPrimaryProvider
                ? t('Local AI runtime')
                : t('Provider key (session only)')
            }
          >
            <Stack spacing={3}>
              <Text color="muted" fontSize="sm">
                {isLocalAiPrimaryProvider
                  ? t(
                      'Local AI uses the runtime configured in the Local AI section below. No session API key is required for the main provider.'
                    )
                  : t(
                      'The API key is kept in memory only for this desktop run and is not persisted to settings by default.'
                    )}
              </Text>
              <Text color="muted" fontSize="sm">
                {isLocalAiPrimaryProvider
                  ? t(
                      'If setup still shows Missing, enable Local AI and make sure the configured runtime endpoint responds before testing again.'
                    )
                  : t(
                      'Keys are stored separately per provider. Setting an OpenAI key does not automatically enable Gemini, Anthropic, xAI, Groq, OpenRouter, or other providers.'
                    )}
              </Text>
              <Box
                borderWidth="1px"
                borderColor="gray.100"
                borderRadius="md"
                p={3}
              >
                <Stack spacing={1}>
                  <Text color="muted" fontSize="xs">
                    {isLocalAiPrimaryProvider
                      ? t('Current runtime status')
                      : t('Current key status')}
                  </Text>
                  <Text
                    fontSize="sm"
                    fontWeight={500}
                    color={providerKeyStatusUi.color}
                  >
                    {providerKeyStatusUi.label}
                  </Text>
                  {providerKeyStatusUi.detail ? (
                    <Text color="muted" fontSize="xs">
                      {providerKeyStatusUi.detail}
                    </Text>
                  ) : null}
                </Stack>
              </Box>

              {!isLocalAiPrimaryProvider ? (
                <SettingsFormControl>
                  <SettingsFormLabel>{t('API key')}</SettingsFormLabel>
                  <InputGroup w="full" maxW="xl">
                    <Input
                      value={apiKey}
                      type={isApiKeyVisible ? 'text' : 'password'}
                      placeholder={t('Paste provider API key')}
                      onChange={(e) => setApiKey(e.target.value)}
                    />
                    <InputRightElement w="6" h="6" m="1">
                      <IconButton
                        size="xs"
                        icon={isApiKeyVisible ? <EyeOffIcon /> : <EyeIcon />}
                        bg={isApiKeyVisible ? 'gray.300' : 'white'}
                        fontSize={20}
                        _hover={{
                          bg: isApiKeyVisible ? 'gray.300' : 'white',
                        }}
                        onClick={() => setIsApiKeyVisible(!isApiKeyVisible)}
                      />
                    </InputRightElement>
                  </InputGroup>
                </SettingsFormControl>
              ) : (
                <Box
                  borderWidth="1px"
                  borderColor="blue.050"
                  borderRadius="md"
                  p={3}
                >
                  <Text color="muted" fontSize="sm">
                    {t(
                      'Model selection, runtime URL, and runtime health checks live in the Local AI section above. Use Test connection here to verify the current Local AI provider setup.'
                    )}
                  </Text>
                </Box>
              )}

              <Stack isInline justify="flex-end" spacing={2}>
                {!isLocalAiPrimaryProvider ? (
                  <>
                    <SecondaryButton
                      isLoading={isUpdatingKey}
                      onClick={async () => {
                        setIsUpdatingKey(true)
                        try {
                          const bridge = ensureBridge()
                          await bridge.clearProviderKey({
                            provider: activeProvider,
                          })
                          setApiKey('')
                          await refreshProviderKeyStatus()
                          notify(
                            t('Provider key cleared'),
                            t('The session key has been removed from memory.')
                          )
                        } catch (error) {
                          notify(
                            t('Unable to clear key'),
                            formatErrorForToast(error),
                            'error'
                          )
                        } finally {
                          setIsUpdatingKey(false)
                        }
                      }}
                    >
                      {t('Clear key')}
                    </SecondaryButton>

                    <SecondaryButton
                      isDisabled={!trimmedApiKey}
                      isLoading={isUpdatingKey}
                      onClick={async () => {
                        setIsUpdatingKey(true)
                        try {
                          const bridge = ensureBridge()
                          await bridge.setProviderKey({
                            provider: activeProvider,
                            apiKey: trimmedApiKey,
                          })
                          setApiKey('')
                          setIsApiKeyVisible(false)
                          await refreshProviderKeyStatus()
                          notify(
                            t('Provider key set'),
                            t(
                              'The session key was loaded and is ready for requests.'
                            )
                          )
                        } catch (error) {
                          notify(
                            t('Unable to set key'),
                            formatErrorForToast(error),
                            'error'
                          )
                        } finally {
                          setIsUpdatingKey(false)
                        }
                      }}
                    >
                      {t('Set key')}
                    </SecondaryButton>
                  </>
                ) : null}

                <PrimaryButton
                  isDisabled={
                    !isLocalAiPrimaryProvider && !providerKeyStatus.primaryReady
                  }
                  isLoading={isTesting}
                  onClick={async () => {
                    setIsTesting(true)
                    try {
                      const bridge = ensureBridge()
                      const result = await bridge.testProvider({
                        provider: activeProvider,
                        model: activeModel,
                        providerConfig,
                      })
                      notify(
                        t('Provider is reachable'),
                        t('{{provider}} {{model}} in {{latency}} ms', {
                          provider: formatAiProviderLabel(result.provider),
                          model:
                            String(result.model || '').trim() ||
                            t('default model'),
                          latency: result.latencyMs,
                        })
                      )
                      await refreshProviderKeyStatus()
                    } catch (error) {
                      notify(
                        t('Provider test failed'),
                        formatErrorForToast(error),
                        'error'
                      )
                    } finally {
                      setIsTesting(false)
                    }
                  }}
                >
                  {t('Test connection')}
                </PrimaryButton>
              </Stack>
            </Stack>
          </SettingsSection>
        ) : null}
      </Stack>
      <AiEnableDialog
        isOpen={isEnableDialogOpen}
        onClose={() => setIsEnableDialogOpen(false)}
        defaultProvider={activeProvider}
        providerOptions={MAIN_PROVIDER_OPTIONS}
        onComplete={async ({provider}) => {
          updateAiSolverSettings({
            enabled: true,
            provider,
            model: resolveDefaultModelForProvider(provider, localAi),
          })
          setIsEnableDialogOpen(false)
          await refreshProviderKeyStatus()
        }}
      />
    </SettingsLayout>
  )
}
