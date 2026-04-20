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
  Dialog,
  DialogBody,
  DialogFooter,
  Input,
  Progress,
  Select,
  Textarea,
  Toast,
} from '../../shared/components/components'
import {PrimaryButton, SecondaryButton} from '../../shared/components/button'
import {ManagedRuntimeTrustDialog} from '../../shared/components/managed-runtime-trust-dialog'
import {
  useSettingsDispatch,
  useSettingsState,
} from '../../shared/providers/settings-context'
import {EyeIcon, EyeOffIcon} from '../../shared/components/icons'
import {
  buildLocalAiRuntimePayload,
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
  MOLMO2_O_RESEARCH_RUNTIME_MODEL,
  buildManagedLocalAiTrustApprovalPatch,
  buildLocalAiRepairPreset,
  buildRecommendedLocalAiMacPreset,
  buildMolmo2OResearchPreset,
  buildLocalAiRuntimePreset,
  buildLocalAiSettings,
  getLocalAiEndpointSafety,
  hasManagedLocalAiTrustApproval,
  resolveLocalAiWireRuntimeType,
} from '../../shared/utils/local-ai-settings'

const DEFAULT_MODELS = {
  'local-ai': '',
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
  {
    value: 'local-runtime-service',
    label: 'Local runtime service (Molmo / MLX / vLLM)',
  },
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

const MAX_LOCAL_AI_ADAPTER_IMPORT_BYTES = 96 * 1024 * 1024

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
    return String(localAi && localAi.model ? localAi.model : '').trim()
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

  if (/ECONNREFUSED|EHOSTUNREACH|ENOTFOUND/i.test(message)) {
    return t('The local runtime is not running yet. Start it and try again.')
  }

  if (/assistant text|invalid_response/i.test(message)) {
    return t(
      'The local model answered in an empty or unsupported format. Try a simpler local model or restart the runtime.'
    )
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

  if (/ResolutionImpossible|cannot install/i.test(message)) {
    return 'The managed local runtime could not finish installing its Python packages. Try Fix automatically once, then restart the app and try again.'
  }

  if (/runtime_start_timeout|not responding yet/i.test(message)) {
    return 'The managed local runtime is still preparing the on-device model. The first launch can take several more minutes after package installation.'
  }

  if (/managed_runtime_trust_required/i.test(message)) {
    return 'Approve the managed on-device runtime once before IdenaAI installs pinned packages and runs the verified Molmo2-O snapshot locally.'
  }

  if (/unsupported_managed_model/i.test(message)) {
    return 'The managed on-device runtime is locked to the pinned Molmo2-O model. Use a custom local runtime if you need a different base model.'
  }

  return message
}

function isManagedMolmo2Runtime(localAi = {}) {
  return (
    String(localAi?.runtimeBackend || '')
      .trim()
      .toLowerCase() === 'local-runtime-service' &&
    String(localAi?.runtimeFamily || '')
      .trim()
      .toLowerCase() === 'molmo2-o'
  )
}

function buildRecommendedRuntimePresetForBackend(runtimeBackend) {
  return String(runtimeBackend || '')
    .trim()
    .toLowerCase() === 'local-runtime-service'
    ? buildMolmo2OResearchPreset()
    : buildLocalAiRuntimePreset(runtimeBackend)
}

function humanizeLocalAiRuntimeError(
  message,
  t,
  {managedRuntime = false} = {}
) {
  const text = String(message || '').trim()

  if (!text) {
    return managedRuntime
      ? t('The managed local runtime is not responding yet.')
      : t('The configured local runtime is not reachable yet.')
  }

  if (/ECONNREFUSED|EHOSTUNREACH|ENOTFOUND/i.test(text)) {
    return managedRuntime
      ? t(
          'The managed local runtime is not running yet. Start it here and give the first launch a little time.'
        )
      : t(
          'Nothing is listening on the configured local endpoint yet. Start the local runtime and try again.'
        )
  }

  if (/managed_runtime_trust_required/i.test(text)) {
    return t(
      'Approve the managed on-device runtime once before IdenaAI installs pinned packages and runs the verified Molmo2-O snapshot locally.'
    )
  }

  if (/unsupported_managed_model/i.test(text)) {
    return t(
      'The managed on-device runtime is locked to the pinned Molmo2-O model. Use a custom local runtime if you need a different base model.'
    )
  }

  if (/runtime_start_timeout|not responding yet/i.test(text)) {
    return managedRuntime
      ? t(
          'The managed local runtime is still preparing the on-device model. The first launch can take several more minutes after package installation.'
        )
      : t('The local runtime is still starting. Give it a little more time.')
  }

  if (/ResolutionImpossible|cannot install/i.test(text)) {
    return managedRuntime
      ? t(
          'IdenaAI could not finish installing the managed local runtime packages. Try Fix automatically once, then restart the app and try again.'
        )
      : t('The local runtime package install failed.')
  }

  if (/assistant text|invalid_response/i.test(text)) {
    return t(
      'The local model answered in an unsupported or empty format. Try a different local model or a shorter prompt.'
    )
  }

  if (/idle/i.test(text)) {
    return managedRuntime
      ? t('The managed local runtime is currently stopped.')
      : t('The local runtime is currently stopped.')
  }

  return text
}

function normalizeRuntimeProgress(progress) {
  if (!progress || typeof progress !== 'object' || Array.isArray(progress)) {
    return null
  }

  const progressPercent = Number(progress.progressPercent)
  const stageIndex = Number(progress.stageIndex)
  const stageCount = Number(progress.stageCount)

  return {
    active: progress.active !== false,
    status: String(progress.status || '').trim() || 'starting',
    stage: String(progress.stage || '').trim() || null,
    message: String(progress.message || '').trim() || null,
    detail: String(progress.detail || '').trim() || null,
    progressPercent: Number.isFinite(progressPercent)
      ? Math.max(0, Math.min(100, Math.round(progressPercent)))
      : null,
    stageIndex: Number.isFinite(stageIndex)
      ? Math.max(1, Math.round(stageIndex))
      : null,
    stageCount: Number.isFinite(stageCount)
      ? Math.max(1, Math.round(stageCount))
      : null,
  }
}

function getLocalAiRuntimePayloadKey(payload = {}) {
  const source =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload
      : {}

  return JSON.stringify({
    enabled: source.enabled === true,
    runtimeBackend: String(source.runtimeBackend || '').trim(),
    runtimeType: String(source.runtimeType || '').trim(),
    runtimeFamily: String(source.runtimeFamily || '').trim(),
    baseUrl: String(source.baseUrl || source.endpoint || '').trim(),
    model: String(source.model || '').trim(),
    visionModel: String(source.visionModel || '').trim(),
    managedRuntimeTrustVersion:
      Number.parseInt(source.managedRuntimeTrustVersion, 10) || 0,
    managedRuntimePythonPath: String(
      source.managedRuntimePythonPath || ''
    ).trim(),
    ollamaCommandPath: String(source.ollamaCommandPath || '').trim(),
  })
}

function shouldIgnoreStaleRuntimeStatusResult(
  currentResult,
  nextResult,
  {activePayloadKey = '', payloadKey = ''} = {}
) {
  if (!activePayloadKey) {
    return false
  }

  if (payloadKey && payloadKey !== activePayloadKey) {
    return true
  }

  const currentProgress = normalizeRuntimeProgress(
    currentResult && currentResult.runtimeProgress
  )

  if (!currentProgress || currentProgress.active === false) {
    return false
  }

  const nextProgress = normalizeRuntimeProgress(
    nextResult && nextResult.runtimeProgress
  )

  if (nextProgress && nextProgress.active !== false) {
    return false
  }

  if (nextResult && nextResult.sidecarReachable === true) {
    return false
  }

  return true
}

function describeRuntimeProgress(progress, t, {managedRuntime = false} = {}) {
  const next = normalizeRuntimeProgress(progress)

  if (!next || !next.active) {
    return null
  }

  let title = t('Starting local runtime')

  if (next.status === 'installing') {
    title = managedRuntime
      ? t('Installing managed local runtime')
      : t('Installing local runtime')
  } else if (
    managedRuntime &&
    String(next.stage || '').trim() === 'wait_for_runtime_model_load'
  ) {
    title = t('Loading on-device model')
  } else if (managedRuntime) {
    title = t('Starting managed local runtime')
  }

  const description =
    next.message ||
    (managedRuntime
      ? t('IdenaAI is preparing the managed local runtime on this device.')
      : t('IdenaAI is preparing the local runtime on this device.'))

  return {
    ...next,
    title,
    description,
  }
}

function formatLocalAiStatusDescription(result, t, options = {}) {
  const progress = describeRuntimeProgress(
    result && result.runtimeProgress,
    t,
    options
  )
  const modelCount = Number(result && result.sidecarModelCount) || 0
  const baseUrl = String(result && result.baseUrl ? result.baseUrl : '').trim()

  if (progress) {
    return progress.description
  }

  if (result && result.sidecarReachable) {
    return t('{{count}} model(s) discovered at {{baseUrl}}.', {
      count: modelCount,
      baseUrl: baseUrl || 'the configured Local AI URL',
    })
  }

  return (
    humanizeLocalAiRuntimeError(result && result.lastError, t, options) ||
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
  const runtimeProgress = normalizeRuntimeProgress(
    result && result.runtimeProgress
  )

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
    runtimeProgress,
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

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () =>
      reject(reader.error || new Error('Could not read the selected file'))

    reader.readAsDataURL(file)
  })
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
  managedRuntime = false,
  t,
}) {
  if (!enabled) {
    return {
      tone: 'muted',
      title: t('Local AI disabled'),
      description: t('Enable Local AI to allow local runtime health checks.'),
    }
  }

  const progress = describeRuntimeProgress(
    result && result.runtimeProgress,
    t,
    {managedRuntime}
  )

  if (progress) {
    return {
      tone: 'blue.500',
      title: progress.title,
      description: progress.description,
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
      description: formatLocalAiStatusDescription(result, t, {managedRuntime}),
    }
  }

  return {
    tone: 'red.500',
    title: t('Local AI runtime unavailable'),
    description: humanizeLocalAiRuntimeError(
      result && (result.error || result.lastError),
      t,
      {managedRuntime}
    ),
  }
}

function describeLocalAiSelection(localAi, runtimeUrl, t) {
  const managedRuntime = isManagedMolmo2Runtime(localAi)
  const backend = String(localAi?.runtimeBackend || '')
    .trim()
    .toLowerCase()

  if (managedRuntime) {
    return {
      title: t('Managed Molmo2-O research runtime'),
      description: t(
        'IdenaAI can prepare, install, and start this local-only runtime on first use. The first startup can take several minutes.'
      ),
      endpointLabel: t('Managed local endpoint'),
      endpointHelper: t(
        'This loopback endpoint is used internally by the managed runtime on this device.'
      ),
      endpointReadOnly: true,
      startLabel: t('Install / start managed runtime'),
    }
  }

  if (backend === 'ollama-direct') {
    return {
      title: t('Ollama local runtime'),
      description: t(
        'Best for simple local chat. IdenaAI talks to your own Ollama runtime on this device.'
      ),
      endpointLabel: t('Ollama endpoint'),
      endpointHelper: t(
        'Recommended: http://127.0.0.1:11434. Use a loopback-only Ollama URL here.'
      ),
      endpointReadOnly: false,
      startLabel: t('Start local runtime'),
    }
  }

  return {
    title: t('Custom local runtime service'),
    description: t(
      'Use this only if you intentionally run your own compatible local runtime service.'
    ),
    endpointLabel: t('Local runtime endpoint'),
    endpointHelper: t(
      'Use a loopback-only URL. Keep this on localhost, 127.0.0.1, or ::1.'
    ),
    endpointReadOnly: false,
    startLabel: t('Start local runtime'),
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
  const localAiSelection = useMemo(
    () => describeLocalAiSelection(localAi, localAiRuntimeUrl, t),
    [localAi, localAiRuntimeUrl, t]
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
  const localAiAdapterFileInputRef = React.useRef(null)
  const [isEnableDialogOpen, setIsEnableDialogOpen] = useState(false)
  const [isCheckingLocalAi, setIsCheckingLocalAi] = useState(false)
  const [isStartingLocalAi, setIsStartingLocalAi] = useState(false)
  const [isStoppingLocalAi, setIsStoppingLocalAi] = useState(false)
  const [isRuntimePathDialogOpen, setIsRuntimePathDialogOpen] = useState(false)
  const [isManagedRuntimeTrustDialogOpen, setIsManagedRuntimeTrustDialogOpen] =
    useState(false)
  const [managedRuntimeTrustRequest, setManagedRuntimeTrustRequest] =
    useState(null)
  const [runtimePathDraft, setRuntimePathDraft] = useState({
    endpoint: '',
    managedRuntimePythonPath: '',
    ollamaCommandPath: '',
  })
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
  const [isImportingLocalAiAdapter, setIsImportingLocalAiAdapter] =
    useState(false)
  const [isRegisteringLocalAiAdapter, setIsRegisteringLocalAiAdapter] =
    useState(false)
  const [isLoadingLocalAiAdapter, setIsLoadingLocalAiAdapter] = useState(false)
  const [localAiImportedAdapterArtifact, setLocalAiImportedAdapterArtifact] =
    useState(null)
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
      updateLocalAiSettings(
        buildRecommendedRuntimePresetForBackend(runtimeBackend)
      )
    },
    [updateLocalAiSettings]
  )

  const applyRecommendedLocalAiSetup = useCallback(() => {
    updateLocalAiSettings({
      enabled: true,
      ...buildRecommendedLocalAiMacPreset(),
    })

    notify(
      t('Embryo-stage local AI preset applied'),
      t(
        'IdenaAI now points local inference at Ollama on http://127.0.0.1:11434, but no approved local base model is configured. Local AI is back in embryo stage while base-layer research continues.'
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
    () => buildLocalAiRuntimePayload(localAi),
    [localAi]
  )
  const [activeLocalAiRuntimePayload, setActiveLocalAiRuntimePayload] =
    useState(null)
  const activeLocalAiRuntimePayloadKeyRef = React.useRef('')
  const localAiProgressPollingPayload =
    activeLocalAiRuntimePayload || localAiRuntimePayload
  const applyBackgroundLocalAiStatusResult = useCallback(
    (nextResult, payload) => {
      const payloadKey = getLocalAiRuntimePayloadKey(payload)
      setLocalAiStatusResult((current) =>
        shouldIgnoreStaleRuntimeStatusResult(current, nextResult, {
          activePayloadKey: activeLocalAiRuntimePayloadKeyRef.current,
          payloadKey,
        })
          ? current
          : nextResult
      )
    },
    []
  )
  const hasActiveLocalAiStartAttempt = useCallback((currentResult) => {
    if (!activeLocalAiRuntimePayloadKeyRef.current) {
      return false
    }

    const currentProgress = normalizeRuntimeProgress(
      currentResult && currentResult.runtimeProgress
    )

    return Boolean(currentProgress && currentProgress.active !== false)
  }, [])

  const startLocalAiWithSettings = useCallback(
    async ({
      localAiPatch = {},
      enableLocalProvider = false,
      openSetup = true,
      preparingMessage = '',
    } = {}) => {
      const nextSettingsPatch = {
        enabled: true,
        ...(localAiPatch && typeof localAiPatch === 'object'
          ? localAiPatch
          : {}),
      }
      const nextLocalAi = buildLocalAiSettings({
        ...localAi,
        ...nextSettingsPatch,
      })
      const nextPayload = buildLocalAiRuntimePayload(nextLocalAi)
      const managedRuntime = isManagedMolmo2Runtime(nextLocalAi)

      if (openSetup) {
        setShowLocalAiSetup(true)
        setShowProviderSetup(false)
      }

      if (managedRuntime && !hasManagedLocalAiTrustApproval(nextLocalAi)) {
        setManagedRuntimeTrustRequest({
          localAiPatch: nextSettingsPatch,
          enableLocalProvider,
          openSetup,
          preparingMessage,
        })
        setIsManagedRuntimeTrustDialogOpen(true)
        return normalizeLocalAiStatusResult(
          {
            enabled: true,
            status: 'stopped',
            runtime: nextLocalAi.runtimeBackend,
            runtimeBackend: nextLocalAi.runtimeBackend,
            runtimeType: resolveLocalAiWireRuntimeType(nextLocalAi),
            baseUrl: nextPayload.baseUrl,
            error: 'managed_runtime_trust_required',
            lastError:
              'Approve the managed local runtime before installation starts.',
          },
          nextPayload.baseUrl
        )
      }

      updateLocalAiSettings(nextSettingsPatch)

      if (enableLocalProvider) {
        updateAiSolverSettings({
          enabled: true,
          provider: 'local-ai',
          model: resolveDefaultModelForProvider('local-ai', nextLocalAi),
        })
      }

      setLocalAiStatusResult(
        normalizeLocalAiStatusResult(
          {
            enabled: true,
            status: 'starting',
            runtime: nextLocalAi.runtimeBackend,
            runtimeBackend: nextLocalAi.runtimeBackend,
            runtimeType: resolveLocalAiWireRuntimeType(nextLocalAi),
            baseUrl: nextPayload.baseUrl,
            runtimeProgress: {
              active: true,
              status: managedRuntime ? 'installing' : 'starting',
              stage: 'prepare_runtime_request',
              message:
                String(preparingMessage || '').trim() ||
                (managedRuntime
                  ? 'Preparing the managed local runtime on this device.'
                  : 'Preparing the local runtime on this device.'),
              progressPercent: 2,
            },
          },
          nextPayload.baseUrl
        )
      )

      setIsStartingLocalAi(true)
      activeLocalAiRuntimePayloadKeyRef.current =
        getLocalAiRuntimePayloadKey(nextPayload)
      setActiveLocalAiRuntimePayload(nextPayload)

      try {
        const result = normalizeLocalAiStatusResult(
          await ensureLocalAiBridge().start(nextPayload),
          nextPayload.baseUrl
        )
        setLocalAiStatusResult(result)
        return result
      } catch (error) {
        const message = formatErrorForToast(error)
        const result = normalizeLocalAiStatusResult(
          {
            enabled: true,
            status: 'error',
            runtime: nextLocalAi.runtimeBackend,
            runtimeBackend: nextLocalAi.runtimeBackend,
            runtimeType: resolveLocalAiWireRuntimeType(nextLocalAi),
            baseUrl: nextPayload.baseUrl,
            error: message,
            lastError: message,
          },
          nextPayload.baseUrl
        )
        setLocalAiStatusResult(result)
        notify(t('Unable to start Local AI'), message, 'error')
        return result
      } finally {
        setIsStartingLocalAi(false)
        activeLocalAiRuntimePayloadKeyRef.current = ''
        setActiveLocalAiRuntimePayload(null)
      }
    },
    [localAi, notify, t, updateAiSolverSettings, updateLocalAiSettings]
  )

  const openRuntimePathDialog = useCallback(() => {
    setRuntimePathDraft({
      endpoint: localAiRuntimeUrl,
      managedRuntimePythonPath: String(
        localAi.managedRuntimePythonPath || ''
      ).trim(),
      ollamaCommandPath: String(localAi.ollamaCommandPath || '').trim(),
    })
    setIsRuntimePathDialogOpen(true)
  }, [
    localAi.managedRuntimePythonPath,
    localAi.ollamaCommandPath,
    localAiRuntimeUrl,
  ])

  const closeRuntimePathDialog = useCallback(() => {
    setIsRuntimePathDialogOpen(false)
  }, [])

  const closeManagedRuntimeTrustDialog = useCallback(() => {
    setIsManagedRuntimeTrustDialogOpen(false)
    setManagedRuntimeTrustRequest(null)
  }, [])

  const approveManagedRuntimeTrust = useCallback(async () => {
    if (!managedRuntimeTrustRequest) {
      setIsManagedRuntimeTrustDialogOpen(false)
      return
    }

    const pending = managedRuntimeTrustRequest
    setIsManagedRuntimeTrustDialogOpen(false)
    setManagedRuntimeTrustRequest(null)

    await startLocalAiWithSettings({
      ...pending,
      localAiPatch: {
        ...((pending && pending.localAiPatch) || {}),
        ...buildManagedLocalAiTrustApprovalPatch(),
      },
    })
  }, [managedRuntimeTrustRequest, startLocalAiWithSettings])

  const resetRuntimePathDraft = useCallback(() => {
    const recommendedPreset = buildRecommendedRuntimePresetForBackend(
      localAi.runtimeBackend
    )
    setRuntimePathDraft({
      endpoint: recommendedPreset.endpoint,
      managedRuntimePythonPath: '',
      ollamaCommandPath: '',
    })
  }, [localAi.runtimeBackend])

  const fixLocalAiAutomatically = useCallback(
    () =>
      startLocalAiWithSettings({
        localAiPatch: buildLocalAiRepairPreset(localAi, {
          preferManaged: !localAi.enabled || isManagedMolmo2Runtime(localAi),
        }),
        preparingMessage: t(
          'Resetting the local runtime path to the recommended value and retrying now.'
        ),
      }),
    [localAi, startLocalAiWithSettings, t]
  )

  const saveRuntimePathDraft = useCallback(
    async ({retry = false} = {}) => {
      const endpoint = String(runtimePathDraft.endpoint || '').trim()
      const endpointSafety = getLocalAiEndpointSafety(endpoint)

      if (!endpointSafety.safe) {
        notify(t('Invalid local runtime path'), endpointSafety.message, 'error')
        return
      }

      const localAiPatch = {
        baseUrl: endpointSafety.normalizedBaseUrl,
        endpoint: endpointSafety.normalizedBaseUrl,
        managedRuntimePythonPath: String(
          runtimePathDraft.managedRuntimePythonPath || ''
        ).trim(),
        ollamaCommandPath: String(
          runtimePathDraft.ollamaCommandPath || ''
        ).trim(),
      }

      if (retry) {
        await startLocalAiWithSettings({
          localAiPatch,
          preparingMessage: t(
            'Retrying the local runtime with the updated path settings.'
          ),
        })
      } else {
        updateLocalAiSettings(localAiPatch)
      }

      setIsRuntimePathDialogOpen(false)
      notify(
        retry
          ? t('Updated runtime path and retrying')
          : t('Runtime path saved'),
        retry
          ? t(
              'IdenaAI is retrying local runtime startup with the updated endpoint and path overrides.'
            )
          : t(
              'The updated local runtime endpoint and path overrides were saved.'
            ),
        'success'
      )
    },
    [
      notify,
      runtimePathDraft.endpoint,
      runtimePathDraft.managedRuntimePythonPath,
      runtimePathDraft.ollamaCommandPath,
      startLocalAiWithSettings,
      t,
      updateLocalAiSettings,
    ]
  )

  const applyMolmo2OResearchSetup = useCallback(
    () =>
      startLocalAiWithSettings({
        localAiPatch: buildMolmo2OResearchPreset(),
        preparingMessage: t(
          'Preparing the managed on-device runtime now. Progress will appear below.'
        ),
      }),
    [startLocalAiWithSettings, t]
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
      applyBackgroundLocalAiStatusResult(result, localAiRuntimePayload)
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
      applyBackgroundLocalAiStatusResult(result, localAiRuntimePayload)
      return result
    } finally {
      setIsCheckingLocalAi(false)
    }
  }, [
    applyBackgroundLocalAiStatusResult,
    localAi.enabled,
    localAiRuntimePayload,
    localAi.runtimeBackend,
    localAiRuntimeUrl,
  ])

  const localAiRuntimeProgress = useMemo(
    () => normalizeRuntimeProgress(localAiStatusResult?.runtimeProgress),
    [localAiStatusResult]
  )

  useEffect(() => {
    if (!isStartingLocalAi && !localAiRuntimeProgress?.active) {
      return undefined
    }

    let cancelled = false
    let timerId = null

    const pollProgress = async () => {
      try {
        if (!global.localAi) {
          return
        }

        const result = normalizeLocalAiStatusResult(
          await global.localAi.status(localAiProgressPollingPayload),
          localAiProgressPollingPayload?.baseUrl || localAiRuntimeUrl
        )

        if (!cancelled) {
          applyBackgroundLocalAiStatusResult(
            result,
            localAiProgressPollingPayload
          )
        }
      } catch {
        // Keep the last visible progress state until the start call resolves.
      } finally {
        if (!cancelled) {
          timerId = setTimeout(pollProgress, 900)
        }
      }
    }

    pollProgress()

    return () => {
      cancelled = true

      if (timerId) {
        clearTimeout(timerId)
      }
    }
  }, [
    applyBackgroundLocalAiStatusResult,
    isStartingLocalAi,
    localAiProgressPollingPayload,
    localAiRuntimeProgress?.active,
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
        formatLocalAiStatusDescription(result, t, {
          managedRuntime: isManagedMolmo2Runtime(localAi),
        }) || t('The configured Local AI runtime is not reachable yet.')
      )
    }

    return result
  }, [localAi, localAiRuntimePayload, localAiRuntimeUrl, t])

  useEffect(() => {
    if (!localAi.enabled) {
      setLocalAiStatusResult((current) => {
        if (hasActiveLocalAiStartAttempt(current)) {
          return current
        }

        return normalizeLocalAiStatusResult(
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
      })
      return
    }

    if (!localAiEndpointSafety.safe) {
      setLocalAiStatusResult((current) => {
        if (hasActiveLocalAiStartAttempt(current)) {
          return current
        }

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
      if (hasActiveLocalAiStartAttempt(current)) {
        return current
      }

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
    hasActiveLocalAiStartAttempt,
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
        managedRuntime: isManagedMolmo2Runtime(localAi),
        t,
      }),
    [isCheckingLocalAi, localAiRuntimeUrl, localAiStatusResult, localAi, t]
  )
  const localAiRuntimeProgressDisplay = useMemo(
    () =>
      describeRuntimeProgress(localAiRuntimeProgress, t, {
        managedRuntime: isManagedMolmo2Runtime(localAi),
      }),
    [localAi, localAiRuntimeProgress, t]
  )
  const localAiStartButtonLabel = localAiRuntimeProgressDisplay?.title
    ? localAiRuntimeProgressDisplay.title
    : localAiSelection.startLabel
  const localAiTopSummaryTitle = localAiRuntimeProgressDisplay?.title
    ? localAiRuntimeProgressDisplay.title
    : localAiRuntimeStatus.title
  let localAiSetupStatusBorderColor = 'gray.100'
  let localAiSetupStatusBackgroundColor = 'gray.50'
  let localAiSetupStatusTitleColor = localAiRuntimeStatus.tone

  if (localAiRuntimeStatus.tone === 'red.500') {
    localAiSetupStatusBorderColor = 'red.100'
    localAiSetupStatusBackgroundColor = 'red.50'
  }

  if (localAiRuntimeProgressDisplay) {
    localAiSetupStatusBorderColor = 'blue.100'
    localAiSetupStatusBackgroundColor = 'blue.50'
    localAiSetupStatusTitleColor = 'blue.700'
  }

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

  const runLocalAiImportAdapterArtifact = useCallback(() => {
    const epoch = String(localAiPackageEpoch || '').trim()

    if (!epoch) {
      setLocalAiAdapterError(
        t('Enter an epoch before importing a local adapter artifact.')
      )
      return
    }

    setLocalAiAdapterError('')

    if (localAiAdapterFileInputRef.current) {
      localAiAdapterFileInputRef.current.value = ''
      localAiAdapterFileInputRef.current.click()
    }
  }, [localAiPackageEpoch, t])

  const handleLocalAiAdapterFileChange = useCallback(
    async (event) => {
      const input = event && event.target ? event.target : null
      const file =
        input && input.files && input.files.length > 0 ? input.files[0] : null

      if (!file) {
        return
      }

      const epoch = String(localAiPackageEpoch || '').trim()

      if (!epoch) {
        setLocalAiAdapterError(
          t('Enter an epoch before importing a local adapter artifact.')
        )
        if (input) {
          input.value = ''
        }
        return
      }

      if (file.size > MAX_LOCAL_AI_ADAPTER_IMPORT_BYTES) {
        setLocalAiImportedAdapterArtifact(null)
        setLocalAiAdapterError(
          t(
            'The selected adapter file is too large for the secure import path.'
          )
        )
        if (input) {
          input.value = ''
        }
        return
      }

      setIsImportingLocalAiAdapter(true)
      setLocalAiAdapterError('')

      try {
        const artifactBase64 = await readFileAsDataUrl(file)
        const result = await ensureLocalAiBridge().importAdapterArtifact({
          ...localAiRuntimePayload,
          epoch,
          artifactFileName: file.name,
          artifactBase64,
        })

        setLocalAiImportedAdapterArtifact(result)
      } catch (error) {
        setLocalAiImportedAdapterArtifact(null)
        setLocalAiAdapterError(formatErrorForToast(error))
      } finally {
        setIsImportingLocalAiAdapter(false)
        if (input) {
          input.value = ''
        }
      }
    },
    [localAiPackageEpoch, localAiRuntimePayload, t]
  )

  const runLocalAiRegisterAdapterArtifact = useCallback(async () => {
    const epoch = String(localAiPackageEpoch || '').trim()
    const artifactToken = String(
      localAiImportedAdapterArtifact &&
        localAiImportedAdapterArtifact.artifactToken
        ? localAiImportedAdapterArtifact.artifactToken
        : ''
    ).trim()

    if (!epoch) {
      setLocalAiAdapterError(
        t('Enter an epoch before registering a local adapter artifact.')
      )
      return
    }

    if (!artifactToken) {
      setLocalAiAdapterError(
        t('Import a local adapter file before registering it.')
      )
      return
    }

    setIsRegisteringLocalAiAdapter(true)
    setLocalAiAdapterError('')

    try {
      const result = await ensureLocalAiBridge().registerAdapterArtifact({
        ...localAiRuntimePayload,
        epoch,
        artifactToken,
      })

      setLocalAiAdapterManifest(result)
    } catch (error) {
      setLocalAiAdapterManifest(null)
      setLocalAiAdapterError(formatErrorForToast(error))
    } finally {
      setIsRegisteringLocalAiAdapter(false)
    }
  }, [
    localAiImportedAdapterArtifact,
    localAiRuntimePayload,
    localAiPackageEpoch,
    t,
  ])

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
      setLocalAiImportedAdapterArtifact(
        result && result.adapterArtifact
          ? {
              artifactToken: result.adapterArtifact.artifactToken || null,
              artifactFileName: result.adapterArtifact.file || null,
              sizeBytes: result.adapterArtifact.sizeBytes || null,
              artifactSha256: result.adapterSha256 || null,
              importedAt: null,
            }
          : null
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
  const enableExternalProviderSetup = useCallback(() => {
    updateAiSolverSettings({
      enabled: true,
      provider: externalProviderChoice,
      model: resolveDefaultModelForProvider(externalProviderChoice, localAi),
    })
    setShowProviderSetup(true)
    setShowLocalAiSetup(false)
  }, [externalProviderChoice, localAi, updateAiSolverSettings])
  const enableLocalAiSetup = useCallback(
    () =>
      startLocalAiWithSettings({
        localAiPatch: buildMolmo2OResearchPreset(),
        enableLocalProvider: true,
        preparingMessage: t(
          'Preparing the managed on-device runtime now. Progress will appear below.'
        ),
      }),
    [startLocalAiWithSettings, t]
  )
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

  const hasHandledAutoLocalAiStartRef = React.useRef(false)

  useEffect(() => {
    if (String(router.query?.startLocalAi || '').trim() !== '1') {
      hasHandledAutoLocalAiStartRef.current = false
      return
    }

    if (hasHandledAutoLocalAiStartRef.current) {
      return
    }

    hasHandledAutoLocalAiStartRef.current = true
    enableLocalAiSetup()

    const nextQuery = {...router.query}
    delete nextQuery.startLocalAi
    router.replace(
      {
        pathname: router.pathname,
        query: nextQuery,
      },
      undefined,
      {shallow: true}
    )
  }, [enableLocalAiSetup, router])

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
    <SettingsLayout allowWhenNodeUnavailable>
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
                    <Text fontWeight={600}>{t('Turn on AI')}</Text>
                    <Text color="muted" fontSize="sm">
                      {t(
                        'New users should start with the managed local runtime on this device. External API providers stay available if you want them later.'
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
                    borderColor="green.100"
                    borderRadius="md"
                    p={3}
                    bg="white"
                  >
                    <Stack spacing={3}>
                      <Box>
                        <Text fontWeight={600}>
                          {t('Recommended: local AI on this device')}
                        </Text>
                        <Text color="muted" fontSize="sm" mt={1}>
                          {t(
                            'IdenaAI can prepare and start the local runtime for you. Click once here and follow the progress below. No API key is required for this path.'
                          )}
                        </Text>
                      </Box>
                      <Text color="muted" fontSize="xs">
                        {t('Current runtime')}: {localAiTopSummaryTitle}
                      </Text>
                      <Stack isInline spacing={2} flexWrap="wrap">
                        <PrimaryButton
                          onClick={enableLocalAiSetup}
                          isLoading={isStartingLocalAi}
                        >
                          {t('Install local AI on this device')}
                        </PrimaryButton>
                        <SecondaryButton onClick={toggleLocalAiSetup}>
                          {showLocalAiSetup
                            ? t('Hide local AI')
                            : t('Local AI settings')}
                        </SecondaryButton>
                      </Stack>
                    </Stack>
                  </Box>

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
                          {t('External AI provider via API')}
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
                        <SecondaryButton onClick={enableExternalProviderSetup}>
                          {t('Use external API provider')}
                        </SecondaryButton>
                        <SecondaryButton onClick={toggleProviderSetup}>
                          {showProviderSetup
                            ? t('Hide provider setup')
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
                        'After the provider setup works, you can use one AI page for provider-backed flip building, solving, off-chain benchmarking, and cautious on-chain automation. Provider benchmarks stay in the provider lane and do not train the local AI model.'
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
                          'Off-chain benchmark: benchmark provider solving on queued flips locally without publishing or feeding local AI training.'
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
                            'Strict profile targets provider-side flip solving benchmarks with fixed retry, pacing, and timeout limits for fair comparison.'
                          )
                        : t(
                            'Custom profile allows exploratory provider benchmark overrides. All custom settings are logged in benchmark metrics.'
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

                    {!isLocalAiPrimaryProvider && (
                      <SettingsFormControl>
                        <SettingsFormLabel>
                          {t('API provider solver prompt override (optional)')}
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
                            'Use {{hash}}, {{allowSkip}}, {{secondPass}}, {{allowedAnswers}}, {{visionMode}}, {{promptPhase}}. Leave blank to use the built-in anti-slot-bias solver prompt.'
                          )}
                        />
                        <Text color="muted" fontSize="sm" mt={1}>
                          {t(
                            'Applies to provider flip solving and provider benchmark/test-unit runs only. It does not change provider-based flip generation or local human-teacher training.'
                          )}
                        </Text>
                      </SettingsFormControl>
                    )}

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
                  'Choose one local path first. Keep the low-level runtime fields hidden unless you are deliberately debugging a custom setup.'
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
                  onChange={() => {
                    if (localAi.enabled) {
                      updateLocalAiSettings({enabled: false})
                      return
                    }

                    updateLocalAiSettings({
                      enabled: true,
                      ...buildMolmo2OResearchPreset(),
                    })
                  }}
                />
              </Flex>

              <Box
                borderWidth="1px"
                borderColor="gray.100"
                borderRadius="md"
                p={3}
              >
                <Stack spacing={2}>
                  <Text fontWeight={600}>{localAiSelection.title}</Text>
                  <Text color="muted" fontSize="sm">
                    {localAiSelection.description}
                  </Text>
                </Stack>
              </Box>

              <SettingsFormControl>
                <SettingsFormLabel>
                  {localAiSelection.endpointLabel}
                </SettingsFormLabel>
                <Input
                  value={localAiRuntimeUrl}
                  isReadOnly={localAiSelection.endpointReadOnly}
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
                  {localAiSelection.endpointHelper}
                </Text>
                {isManagedMolmo2Runtime(localAi) ? (
                  <Text color="muted" fontSize="sm" mt={1}>
                    {t(
                      'Managed research model: {{model}}. IdenaAI prepares this local-only runtime on first use.',
                      {model: MOLMO2_O_RESEARCH_RUNTIME_MODEL}
                    )}
                  </Text>
                ) : null}
                {!localAiEndpointSafety.safe && (
                  <Text color="red.500" fontSize="sm" mt={1}>
                    {localAiEndpointSafety.message}
                  </Text>
                )}
              </SettingsFormControl>

              <Stack isInline spacing={2} flexWrap="wrap">
                <PrimaryButton
                  onClick={applyMolmo2OResearchSetup}
                  isLoading={isStartingLocalAi}
                >
                  {t('Install recommended on-device AI')}
                </PrimaryButton>
                <SecondaryButton
                  onClick={fixLocalAiAutomatically}
                  isLoading={isStartingLocalAi}
                >
                  {t('Fix automatically')}
                </SecondaryButton>
                <SecondaryButton onClick={applyRecommendedLocalAiSetup}>
                  {t('Use Ollama instead')}
                </SecondaryButton>
              </Stack>
              <Text color="muted" fontSize="sm">
                {t(
                  'Recommended for most people: let IdenaAI prepare the managed on-device runtime now and follow the progress bar below. Pick Ollama only if you already run your own local model runtime.'
                )}
              </Text>
              <Box
                borderWidth="1px"
                borderColor={localAiSetupStatusBorderColor}
                bg={localAiSetupStatusBackgroundColor}
                borderRadius="md"
                p={3}
              >
                <Stack spacing={2}>
                  <Text color={localAiSetupStatusTitleColor} fontWeight={600}>
                    {localAiRuntimeProgressDisplay
                      ? localAiRuntimeProgressDisplay.title
                      : localAiRuntimeStatus.title}
                  </Text>
                  <Text color="muted" fontSize="sm">
                    {localAiRuntimeProgressDisplay
                      ? localAiRuntimeProgressDisplay.description
                      : localAiRuntimeStatus.description}
                  </Text>
                  {localAiRuntimeProgressDisplay ? (
                    <Box pt={1}>
                      <Progress
                        value={
                          localAiRuntimeProgressDisplay.progressPercent ??
                          undefined
                        }
                        isIndeterminate={
                          !Number.isFinite(
                            localAiRuntimeProgressDisplay.progressPercent
                          )
                        }
                        hasStripe
                        isAnimated
                      />
                      <Flex
                        align="center"
                        justify="space-between"
                        mt={2}
                        gap={3}
                      >
                        <Text color="muted" fontSize="xs">
                          {localAiRuntimeProgressDisplay.detail ||
                            t(
                              'The first setup can take several minutes while Python packages and model files are prepared.'
                            )}
                        </Text>
                        {Number.isFinite(
                          localAiRuntimeProgressDisplay.progressPercent
                        ) ? (
                          <Text color="muted" fontSize="xs" fontWeight={600}>
                            {localAiRuntimeProgressDisplay.progressPercent}%
                          </Text>
                        ) : null}
                      </Flex>
                    </Box>
                  ) : null}
                </Stack>
              </Box>
              <Text color="muted" fontSize="sm">
                {t(
                  'Only if automatic repair fails: use the custom path dialog in the runtime box below.'
                )}
              </Text>

              <Stack spacing={2} align="flex-start">
                <SecondaryButton
                  onClick={() =>
                    setShowLocalAiCompatibilityOverrides((value) => !value)
                  }
                >
                  {showLocalAiCompatibilityOverrides
                    ? t('Hide advanced local runtime settings')
                    : t('Show advanced local runtime settings')}
                </SecondaryButton>
                <Text color="muted" fontSize="sm">
                  {t(
                    'Only open this if you intentionally need custom runtime wiring, branded IDs, or compatibility overrides.'
                  )}
                </Text>
              </Stack>

              {showLocalAiCompatibilityOverrides ? (
                <>
                  <SettingsFormControl>
                    <SettingsFormLabel>
                      {t('Runtime backend')}
                    </SettingsFormLabel>
                    <Select
                      value={
                        localAi.runtimeBackend ||
                        DEFAULT_LOCAL_AI_SETTINGS.runtimeBackend
                      }
                      onChange={(e) =>
                        applyLocalAiRuntimeBackend(e.target.value)
                      }
                      w="xl"
                    >
                      {LOCAL_AI_RUNTIME_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {t(option.label)}
                        </option>
                      ))}
                    </Select>
                  </SettingsFormControl>

                  <SettingsFormControl>
                    <SettingsFormLabel>
                      {t('Reasoner backend')}
                    </SettingsFormLabel>
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
                  </SettingsFormControl>

                  <SettingsFormControl>
                    <SettingsFormLabel>
                      {t('Contract version')}
                    </SettingsFormLabel>
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
                        'Compatibility override for the current image-aware runtime path. Leave it blank unless you intentionally want to test a specific local vision runtime yourself.'
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
                    <Stack spacing={2}>
                      <Text color={localAiRuntimeStatus.tone} fontWeight={500}>
                        {localAiRuntimeStatus.title}
                      </Text>
                      <Text color="muted" fontSize="sm">
                        {localAiRuntimeStatus.description}
                      </Text>
                      {localAiRuntimeProgressDisplay ? (
                        <Box pt={1}>
                          <Progress
                            value={
                              localAiRuntimeProgressDisplay.progressPercent ??
                              undefined
                            }
                            isIndeterminate={
                              !Number.isFinite(
                                localAiRuntimeProgressDisplay.progressPercent
                              )
                            }
                            hasStripe
                            isAnimated
                          />
                          <Flex
                            align="center"
                            justify="space-between"
                            mt={2}
                            gap={3}
                          >
                            <Text color="muted" fontSize="xs">
                              {localAiRuntimeProgressDisplay.detail ||
                                t(
                                  'The first setup can take several minutes while Python packages and model files are prepared.'
                                )}
                            </Text>
                            {Number.isFinite(
                              localAiRuntimeProgressDisplay.progressPercent
                            ) ? (
                              <Text
                                color="muted"
                                fontSize="xs"
                                fontWeight={600}
                              >
                                {localAiRuntimeProgressDisplay.progressPercent}%
                              </Text>
                            ) : null}
                          </Flex>
                        </Box>
                      ) : null}
                    </Stack>
                  </Box>
                  <Stack isInline spacing={2}>
                    <SecondaryButton
                      isDisabled={!localAi.enabled || isStartingLocalAi}
                      onClick={async () => {
                        const nextPayload = localAiRuntimePayload
                        setIsStartingLocalAi(true)
                        activeLocalAiRuntimePayloadKeyRef.current =
                          getLocalAiRuntimePayloadKey(nextPayload)
                        setActiveLocalAiRuntimePayload(nextPayload)
                        setLocalAiStatusResult((current) =>
                          normalizeLocalAiStatusResult(
                            {
                              ...(current || {}),
                              enabled: true,
                              status: 'starting',
                              runtime:
                                localAi.runtimeBackend ||
                                DEFAULT_LOCAL_AI_SETTINGS.runtimeBackend,
                              runtimeBackend:
                                localAi.runtimeBackend ||
                                DEFAULT_LOCAL_AI_SETTINGS.runtimeBackend,
                              runtimeType:
                                resolveLocalAiWireRuntimeType(localAi),
                              baseUrl: nextPayload.baseUrl || localAiRuntimeUrl,
                              runtimeProgress: {
                                active: true,
                                status: isManagedMolmo2Runtime(localAi)
                                  ? 'installing'
                                  : 'starting',
                                stage: 'prepare_runtime_request',
                                message: isManagedMolmo2Runtime(localAi)
                                  ? 'Preparing the managed local runtime on this device.'
                                  : 'Preparing the local runtime on this device.',
                                progressPercent: 2,
                              },
                            },
                            nextPayload.baseUrl || localAiRuntimeUrl
                          )
                        )

                        try {
                          const result = normalizeLocalAiStatusResult(
                            await ensureLocalAiBridge().start(nextPayload),
                            nextPayload.baseUrl || localAiRuntimeUrl
                          )
                          setLocalAiStatusResult(result)

                          notify(
                            t('Local AI runtime updated'),
                            formatLocalAiStatusDescription(result, t, {
                              managedRuntime: isManagedMolmo2Runtime(localAi),
                            }),
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
                          activeLocalAiRuntimePayloadKeyRef.current = ''
                          setActiveLocalAiRuntimePayload(null)
                        }
                      }}
                    >
                      {localAiStartButtonLabel}
                    </SecondaryButton>
                    <SecondaryButton
                      isLoading={isStartingLocalAi}
                      onClick={fixLocalAiAutomatically}
                    >
                      {t('Fix automatically')}
                    </SecondaryButton>
                    <SecondaryButton onClick={openRuntimePathDialog}>
                      {t('Custom path')}
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
                            formatLocalAiStatusDescription(result, t, {
                              managedRuntime: isManagedMolmo2Runtime(localAi),
                            }),
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
                            <input
                              ref={localAiAdapterFileInputRef}
                              hidden
                              type="file"
                              onChange={handleLocalAiAdapterFileChange}
                            />
                            <Box
                              borderWidth="1px"
                              borderColor="gray.100"
                              borderRadius="md"
                              p={3}
                            >
                              <Stack spacing={1}>
                                <Text fontWeight={500}>
                                  {t('Imported adapter file')}
                                </Text>
                                <Text color="muted" fontSize="sm">
                                  {localAiImportedAdapterArtifact &&
                                  localAiImportedAdapterArtifact.artifactFileName
                                    ? localAiImportedAdapterArtifact.artifactFileName
                                    : t('No adapter file imported yet.')}
                                </Text>
                                <Text color="muted" fontSize="sm">
                                  {t('Size')}:{' '}
                                  {formatLocalAiArtifactSize(
                                    localAiImportedAdapterArtifact &&
                                      localAiImportedAdapterArtifact.sizeBytes
                                  )}
                                </Text>
                              </Stack>
                            </Box>
                            <Stack isInline spacing={2}>
                              <SecondaryButton
                                isLoading={isImportingLocalAiAdapter}
                                onClick={runLocalAiImportAdapterArtifact}
                              >
                                {t('Choose Adapter File')}
                              </SecondaryButton>
                              <SecondaryButton
                                isLoading={isRegisteringLocalAiAdapter}
                                onClick={runLocalAiRegisterAdapterArtifact}
                              >
                                {t('Register Imported Adapter')}
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
                                    {t('Artifact storage')}:{' '}
                                    {t('managed local AI storage')}
                                  </Text>
                                  <Text color="muted" fontSize="sm">
                                    {t('Artifact token')}:{' '}
                                    {(localAiAdapterManifest.adapterArtifact &&
                                      localAiAdapterManifest.adapterArtifact
                                        .artifactToken) ||
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
      <Dialog
        isOpen={isRuntimePathDialogOpen}
        onClose={closeRuntimePathDialog}
        size="lg"
        title={t('Repair local runtime path')}
        shouldShowCloseButton
      >
        <DialogBody>
          <Stack spacing={4}>
            <Text color="muted" fontSize="sm">
              {t(
                'Usually you do not need this. IdenaAI can reset to the recommended path automatically. Use this only if a future update changed the local path, Ollama lives elsewhere, or you need a custom Python binary.'
              )}
            </Text>

            <Box>
              <Text fontWeight={600} mb={2}>
                {t('Loopback runtime endpoint')}
              </Text>
              <Input
                value={runtimePathDraft.endpoint}
                onChange={(e) =>
                  setRuntimePathDraft((current) => ({
                    ...current,
                    endpoint: e.target.value,
                  }))
                }
                placeholder={
                  localAi.runtimeBackend === 'local-runtime-service'
                    ? 'http://127.0.0.1:8080'
                    : 'http://127.0.0.1:11434'
                }
              />
              <Text color="muted" fontSize="sm" mt={2}>
                {t(
                  'Keep this on localhost, 127.0.0.1, or ::1. If the recommended endpoint changed in a future build, enter the updated loopback address here.'
                )}
              </Text>
            </Box>

            <Box>
              <Text fontWeight={600} mb={2}>
                {t('Managed runtime Python path')}
              </Text>
              <Input
                value={runtimePathDraft.managedRuntimePythonPath}
                onChange={(e) =>
                  setRuntimePathDraft((current) => ({
                    ...current,
                    managedRuntimePythonPath: e.target.value,
                  }))
                }
                placeholder="python3.11"
              />
              <Text color="muted" fontSize="sm" mt={2}>
                {t(
                  'Optional. Only use this if IdenaAI cannot find the right Python 3.10+ binary for the managed on-device runtime.'
                )}
              </Text>
            </Box>

            <Box>
              <Text fontWeight={600} mb={2}>
                {t('Ollama app / binary path')}
              </Text>
              <Input
                value={runtimePathDraft.ollamaCommandPath}
                onChange={(e) =>
                  setRuntimePathDraft((current) => ({
                    ...current,
                    ollamaCommandPath: e.target.value,
                  }))
                }
                placeholder="/opt/homebrew/bin/ollama"
              />
              <Text color="muted" fontSize="sm" mt={2}>
                {t(
                  'Optional. Use this if Ollama was installed in a non-standard location and the default app path is outdated.'
                )}
              </Text>
            </Box>
          </Stack>
        </DialogBody>
        <DialogFooter>
          <SecondaryButton onClick={closeRuntimePathDialog}>
            {t('Cancel')}
          </SecondaryButton>
          <SecondaryButton onClick={resetRuntimePathDraft}>
            {t('Use recommended path')}
          </SecondaryButton>
          <PrimaryButton
            isLoading={isStartingLocalAi}
            onClick={() => saveRuntimePathDraft({retry: true})}
          >
            {t('Save custom path and retry')}
          </PrimaryButton>
        </DialogFooter>
      </Dialog>
      <ManagedRuntimeTrustDialog
        isOpen={isManagedRuntimeTrustDialogOpen}
        onClose={closeManagedRuntimeTrustDialog}
        onConfirm={approveManagedRuntimeTrust}
        isLoading={isStartingLocalAi}
        title={t('Trust managed on-device AI')}
        confirmLabel={t('Trust and install')}
      />
      <AiEnableDialog
        isOpen={isEnableDialogOpen}
        onClose={() => setIsEnableDialogOpen(false)}
        defaultProvider="local-ai"
        providerOptions={MAIN_PROVIDER_OPTIONS}
        onComplete={async ({provider}) => {
          if (provider === 'local-ai') {
            enableLocalAiSetup()
          } else {
            const nextLocalAi = localAi
            updateAiSolverSettings({
              enabled: true,
              provider,
              model: resolveDefaultModelForProvider(provider, nextLocalAi),
            })
          }
          setIsEnableDialogOpen(false)
          await refreshProviderKeyStatus()
        }}
      />
    </SettingsLayout>
  )
}
