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
  formatMissingAiProviders,
} from '../../shared/utils/ai-provider-readiness'
import {AiEnableDialog} from '../../shared/components/ai-enable-dialog'

const DEFAULT_MODELS = {
  openai: 'gpt-4o-mini',
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

const PROVIDER_OPTIONS = [
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

const DEFAULT_AI_SETTINGS = {
  enabled: false,
  provider: 'openai',
  model: DEFAULT_MODELS.openai,
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

const DEFAULT_LOCAL_AI_SETTINGS = {
  enabled: false,
  runtimeMode: 'sidecar',
  baseUrl: 'http://localhost:5000',
  captureEnabled: false,
  federated: {
    enabled: false,
    relays: [],
    minExamples: 5,
    clipNorm: 1.0,
    dpNoise: 0.01,
  },
  eligibilityGate: {
    requireValidatedIdentity: true,
    requireLocalNode: true,
  },
}

function buildLocalAiSettings(settings = {}) {
  return {
    ...DEFAULT_LOCAL_AI_SETTINGS,
    ...(settings || {}),
    federated: {
      ...DEFAULT_LOCAL_AI_SETTINGS.federated,
      ...((settings && settings.federated) || {}),
    },
    eligibilityGate: {
      ...DEFAULT_LOCAL_AI_SETTINGS.eligibilityGate,
      ...((settings && settings.eligibilityGate) || {}),
    },
  }
}

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
    t('No Local AI sidecar responded at {{baseUrl}}.', {
      baseUrl: baseUrl || 'the configured Local AI URL',
    })
  )
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

  const [apiKey, setApiKey] = useState('')
  const [isUpdatingKey, setIsUpdatingKey] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [isRefreshingModels, setIsRefreshingModels] = useState(false)
  const [isRefreshingAllModels, setIsRefreshingAllModels] = useState(false)
  const [isApiKeyVisible, setIsApiKeyVisible] = useState(false)
  const [latestModelsByProvider, setLatestModelsByProvider] = useState({})
  const [showAdvancedAiSettings, setShowAdvancedAiSettings] = useState(false)
  const setupSectionRef = React.useRef(null)
  const [isEnableDialogOpen, setIsEnableDialogOpen] = useState(false)
  const [isCheckingLocalAi, setIsCheckingLocalAi] = useState(false)
  const [isStartingLocalAi, setIsStartingLocalAi] = useState(false)
  const [isStoppingLocalAi, setIsStoppingLocalAi] = useState(false)
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
    const fallbackModel = DEFAULT_MODELS[provider] || DEFAULT_MODELS.openai
    updateAiSolverSettings({
      provider,
      model: fallbackModel,
    })
  }

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

  const buildLocalAiRuntimePayload = useCallback(
    () => ({
      mode: localAi.runtimeMode,
      baseUrl: localAi.baseUrl,
    }),
    [localAi.baseUrl, localAi.runtimeMode]
  )

  const hasSessionKeyForProvider = async (provider) => {
    const bridge = ensureBridge()
    const result = await bridge.hasProviderKey({provider})
    return Boolean(result && result.hasKey)
  }

  const refreshModelsForProvider = async (provider) => {
    const bridge = ensureBridge()
    const result = await bridge.listModels({
      provider,
      providerConfig: buildProviderConfigForBridge(aiSolver, provider),
    })

    const models = Array.isArray(result && result.models) ? result.models : []

    setLatestModelsByProvider((prev) => ({
      ...prev,
      [provider]: models,
    }))

    return {
      provider,
      count: models.length,
    }
  }

  const activeProvider = aiSolver.provider || 'openai'
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
  const activeModel = aiSolver.model || DEFAULT_MODELS[activeProvider]
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
  }, [activeProvider, aiSolver])

  useEffect(() => {
    refreshProviderKeyStatus()
  }, [refreshProviderKeyStatus])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
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
      return {
        label:
          requiredCount > 1
            ? t('Ready ({{count}}/{{count}})', {count: requiredCount})
            : t('Ready'),
        color: 'green.500',
        detail:
          requiredCount > 1
            ? t('All required provider keys are loaded.')
            : t('Active provider key is loaded.'),
      }
    }

    const missingProviders = formatMissingAiProviders(
      providerKeyStatus.missingProviders
    )

    return {
      label: t('Missing'),
      color: 'orange.500',
      detail: missingProviders
        ? t('Missing for: {{providers}}', {providers: missingProviders})
        : t('Load the required provider key below.'),
    }
  }, [
    providerKeyStatus.allReady,
    providerKeyStatus.checked,
    providerKeyStatus.checking,
    providerKeyStatus.missingProviders,
    providerKeyStatus.requiredProviders,
    t,
  ])

  return (
    <SettingsLayout>
      <Stack spacing={8} mt={8} maxW="2xl">
        <SettingsSection title={t('AI')}>
          <Stack spacing={4}>
            <Box
              bg="blue.012"
              borderWidth="1px"
              borderColor="blue.050"
              p={4}
              borderRadius="md"
            >
              <Text color="muted">
                {t(
                  'Enable experimental AI features if you want AI solving or AI-assisted flip generation.'
                )}
              </Text>
            </Box>

            <Box
              ref={setupSectionRef}
              borderWidth="1px"
              borderColor="blue.100"
              borderRadius="md"
              p={4}
              bg="blue.012"
            >
              <Stack spacing={3}>
                <Text fontWeight={600}>{t('Step 1: Set up AI access')}</Text>
                <Text color="muted" fontSize="sm">
                  {t(
                    'First choose one main provider and load its API key. If you want multi-provider runs later, enable more providers in Advanced settings.'
                  )}
                </Text>
                <UnorderedList spacing={1} color="muted" fontSize="sm">
                  <ListItem>{t('First: turn AI on.')}</ListItem>
                  <ListItem>{t('Second: choose one main provider.')}</ListItem>
                  <ListItem>
                    {t(
                      'Third: paste a session API key and test the connection.'
                    )}
                  </ListItem>
                  <ListItem>
                    {t(
                      'Optional later: add more providers in Advanced settings.'
                    )}
                  </ListItem>
                </UnorderedList>
                <Flex align="center" justify="space-between">
                  <Box>
                    <Text fontWeight={500}>
                      {t('Enable optional AI features')}
                    </Text>
                    <Text color="muted">
                      {t(
                        'When enabled, a setup popup asks for provider and API key.'
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
              </Stack>
            </Box>

            <SettingsFormControl>
              <SettingsFormLabel>{t('Main AI provider')}</SettingsFormLabel>
              <Select
                value={activeProvider}
                onChange={(e) => updateProvider(e.target.value)}
                w="xs"
              >
                {PROVIDER_OPTIONS.map((item) => (
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
                    t('Choose a provider and load a session API key.')}
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
                    'After the key works, you can use one AI page for all flows: AI Flip Builder, AI Solver, off-chain benchmark, and on-chain automatic flow.'
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
                    onClick={() => router.push('/flips/new?autostep=submit')}
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
                  <SecondaryButton isDisabled={!providerKeyStatus.primaryReady}>
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
                <Stack isInline justify="flex-start" spacing={2} align="center">
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
                        const providers = PROVIDER_OPTIONS.map(
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
                              '{{loaded}} loaded, {{skipped}} skipped (no session key), {{failed}} failed',
                              {
                                loaded,
                                skipped,
                                failed,
                              }
                            ),
                            skipped > 0
                              ? t(
                                  'Keys are stored per provider. Switch provider and load a key for each provider you want to scan.'
                                )
                              : null,
                            failedProviders.length > 0
                              ? t('Failed: {{providers}}', {
                                  providers: failedProviders.join(', '),
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
                    <Text fontWeight={500}>{t('Consult multiple APIs')}</Text>
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
                    <Text fontWeight={500}>{t('Legacy heuristic vote')}</Text>
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
                            legacyHeuristicOnly: !aiSolver.legacyHeuristicOnly,
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
                          <SettingsFormLabel>{t('Provider')}</SettingsFormLabel>
                          <Select
                            value={ensembleProvider2}
                            onChange={(e) =>
                              updateAiSolverSettings({
                                ensembleProvider2: e.target.value,
                                ensembleModel2: DEFAULT_MODELS[e.target.value],
                              })
                            }
                            w="sm"
                          >
                            {PROVIDER_OPTIONS.map((item) => (
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
                              <option key={`ensemble2-${value}`} value={value}>
                                {value}
                              </option>
                            ))}
                            <option value="custom">
                              {t('Custom model id')}
                            </option>
                          </Select>
                        </SettingsFormControl>
                        <SettingsFormControl>
                          <SettingsFormLabel>{t('Model')}</SettingsFormLabel>
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
                          <SettingsFormLabel>{t('Weight')}</SettingsFormLabel>
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
                          <SettingsFormLabel>{t('Provider')}</SettingsFormLabel>
                          <Select
                            value={ensembleProvider3}
                            onChange={(e) =>
                              updateAiSolverSettings({
                                ensembleProvider3: e.target.value,
                                ensembleModel3: DEFAULT_MODELS[e.target.value],
                              })
                            }
                            w="sm"
                          >
                            {PROVIDER_OPTIONS.map((item) => (
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
                              <option key={`ensemble3-${value}`} value={value}>
                                {value}
                              </option>
                            ))}
                            <option value="custom">
                              {t('Custom model id')}
                            </option>
                          </Select>
                        </SettingsFormControl>
                        <SettingsFormControl>
                          <SettingsFormLabel>{t('Model')}</SettingsFormLabel>
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
                          <SettingsFormLabel>{t('Weight')}</SettingsFormLabel>
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

                <SettingsFormControl>
                  <SettingsFormLabel>
                    {t('Benchmark profile')}
                  </SettingsFormLabel>
                  <Select
                    value={aiSolver.benchmarkProfile || 'strict'}
                    onChange={(e) =>
                      updateAiSolverSettings({benchmarkProfile: e.target.value})
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
                  <SettingsFormLabel>{t('Flip vision mode')}</SettingsFormLabel>
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
                          updateNumberField('requestTimeoutMs', e.target.value)
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
                          updateNumberField('maxConcurrency', e.target.value)
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
                          updateNumberField('interFlipDelayMs', e.target.value)
                        }
                        w="xs"
                      />
                    </SettingsFormControl>
                    <SettingsFormControl>
                      <SettingsFormLabel>{t('Max retries')}</SettingsFormLabel>
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
                          updateNumberField('maxOutputTokens', e.target.value)
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
                      <SettingsFormLabel>{t('Temperature')}</SettingsFormLabel>
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
                            value={aiSolver.uncertaintyRepromptMinRemainingMs}
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
                                uncertaintyRepromptInstruction: e.target.value,
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
          </Stack>
        </SettingsSection>

        <SettingsSection title={t('Local AI')}>
          <Stack spacing={4}>
            <Text color="muted" fontSize="sm">
              {t(
                'These settings only prepare the future local runtime flow. They do not start a runtime or capture flips yet.'
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
              <SettingsFormLabel>{t('Local runtime URL')}</SettingsFormLabel>
              <Input
                value={localAi.baseUrl || ''}
                onChange={(e) =>
                  updateLocalAiSettings({baseUrl: e.target.value})
                }
                placeholder="http://localhost:5000"
                w="xl"
              />
            </SettingsFormControl>

            <Flex align="center" justify="space-between">
              <Box>
                <Text fontWeight={500}>{t('Capture flips locally')}</Text>
                <Text color="muted" fontSize="sm">
                  {t(
                    'Stores only the preference for a later local capture pipeline.'
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

            <Box borderWidth="1px" borderColor="gray.100" borderRadius="md" p={3}>
              <Stack spacing={2}>
                <Text fontWeight={500}>{t('Runtime control')}</Text>
                <Text color="muted" fontSize="sm">
                  {t(
                    'These controls only probe or mark the optional local sidecar. Cloud provider flows stay unchanged unless you explicitly choose a local-compatible provider.'
                  )}
                </Text>
                <Stack isInline spacing={2}>
                  <SecondaryButton
                    isDisabled={!localAi.enabled || isStartingLocalAi}
                    onClick={async () => {
                      setIsStartingLocalAi(true)

                      try {
                        const result = await ensureLocalAiBridge().start(
                          buildLocalAiRuntimePayload()
                        )

                        notify(
                          t('Local AI runtime updated'),
                          formatLocalAiStatusDescription(result, t),
                          result && result.sidecarReachable ? 'success' : 'warning'
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
                    {t('Start local AI')}
                  </SecondaryButton>
                  <SecondaryButton
                    isDisabled={!localAi.enabled || isStoppingLocalAi}
                    onClick={async () => {
                      setIsStoppingLocalAi(true)

                      try {
                        await ensureLocalAiBridge().stop()

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
                    {t('Stop local AI')}
                  </SecondaryButton>
                  <SecondaryButton
                    isDisabled={!localAi.enabled || isCheckingLocalAi}
                    onClick={async () => {
                      setIsCheckingLocalAi(true)

                      try {
                        const result = await ensureLocalAiBridge().status({
                          ...buildLocalAiRuntimePayload(),
                          refresh: true,
                        })

                        notify(
                          result && result.sidecarReachable
                            ? t('Local AI sidecar reachable')
                            : t('Local AI sidecar unavailable'),
                          formatLocalAiStatusDescription(result, t),
                          result && result.sidecarReachable ? 'success' : 'warning'
                        )
                      } catch (error) {
                        notify(
                          t('Unable to check Local AI status'),
                          formatErrorForToast(error),
                          'error'
                        )
                      } finally {
                        setIsCheckingLocalAi(false)
                      }
                    }}
                  >
                    {t('Check status')}
                  </SecondaryButton>
                </Stack>
                <Text color="muted" fontSize="sm">
                  {t(
                    'To route the existing solver through a local OpenAI-compatible runtime later, choose OpenAI-compatible (custom) in the provider section and point it at this sidecar URL.'
                  )}
                </Text>
              </Stack>
            </Box>
          </Stack>
        </SettingsSection>

        <SettingsSection title={t('Provider key (session only)')}>
          <Stack spacing={3}>
            <Text color="muted" fontSize="sm">
              {t(
                'The API key is kept in memory only for this desktop run and is not persisted to settings by default.'
              )}
            </Text>
            <Text color="muted" fontSize="sm">
              {t(
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
                  {t('Current key status')}
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

            <Stack isInline justify="flex-end" spacing={2}>
              <SecondaryButton
                isLoading={isUpdatingKey}
                onClick={async () => {
                  setIsUpdatingKey(true)
                  try {
                    const bridge = ensureBridge()
                    await bridge.clearProviderKey({provider: activeProvider})
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
                      t('The session key was loaded and is ready for requests.')
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

              <PrimaryButton
                isDisabled={!providerKeyStatus.primaryReady}
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
                        provider: result.provider,
                        model: result.model,
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
      </Stack>
      <AiEnableDialog
        isOpen={isEnableDialogOpen}
        onClose={() => setIsEnableDialogOpen(false)}
        defaultProvider={activeProvider}
        providerOptions={PROVIDER_OPTIONS}
        onComplete={async ({provider}) => {
          updateAiSolverSettings({
            enabled: true,
            provider,
            model: DEFAULT_MODELS[provider] || DEFAULT_MODELS.openai,
          })
          setIsEnableDialogOpen(false)
          await refreshProviderKeyStatus()
        }}
      />
    </SettingsLayout>
  )
}
