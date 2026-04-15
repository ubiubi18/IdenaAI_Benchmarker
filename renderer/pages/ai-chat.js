/* eslint-disable react/prop-types */
import React from 'react'
import {
  Badge,
  Box,
  Button,
  Flex,
  HStack,
  IconButton,
  Image,
  Input,
  SimpleGrid,
  Spinner,
  Stack,
  Text,
  useToast,
} from '@chakra-ui/react'
import {useRouter} from 'next/router'
import {useTranslation} from 'react-i18next'
import Layout from '../shared/components/layout'
import {
  ErrorAlert,
  Page,
  PageTitle,
  SuccessAlert,
  Textarea,
  Toast,
} from '../shared/components/components'
import {PrimaryButton, SecondaryButton} from '../shared/components/button'
import {useChainState} from '../shared/providers/chain-context'
import {
  useSettingsDispatch,
  useSettingsState,
} from '../shared/providers/settings-context'
import {
  buildLocalAiRuntimePayload,
  formatAiProviderLabel,
} from '../shared/utils/ai-provider-readiness'
import {
  buildLocalAiRuntimePreset,
  buildLocalAiSettings,
} from '../shared/utils/local-ai-settings'
import {
  ChatIcon,
  DeleteIcon,
  PhotoIcon,
  SendIcon,
  SettingsIcon,
  SyncIcon,
  UploadIcon,
} from '../shared/components/icons'

const bundledSampleFlipSet = require('../../samples/flips/flip-challenge-test-5-decoded-labeled.json')

const CHAT_HISTORY_STORAGE_KEY = 'idenaLocalAiChatHistoryV1'
const CHAT_DRAFT_STORAGE_KEY = 'idenaLocalAiChatDraftV1'
const CHAT_HISTORY_LIMIT = 40
const CHAT_ATTACHMENT_LIMIT = 8
const SYSTEM_CHAT_MESSAGE = {
  role: 'system',
  content:
    'You are a concise, practical assistant inside the Idena desktop app. Keep answers short and actionable.',
}
const QUICK_PROMPTS = [
  'Explain this node error in plain English.',
  'Help me draft better flips for the next validation.',
  'Summarize what I should do before validation starts.',
  'Show me a bundled sample test flip.',
  'Solve the attached test flip and explain the likely sequence.',
]

const FLIP_REQUEST_PATTERN =
  /\b(test ?flip|flip|sequence|panels?|solve|coherent|order|caption)\b/i
const SAMPLE_FLIP_PATTERN = /\b(sample|test)\s*flip(s)?\b/i
const SAMPLE_FLIP_ACTION_PATTERN =
  /\b(show|load|display|open|give|send|solve|analy[sz]e|explain|caption|order)\b/i

function createChatId(role) {
  return `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function createChatMessage(role, content, options = {}) {
  return {
    id: createChatId(role),
    role,
    content: String(content || '').trim(),
    createdAt: new Date().toISOString(),
    attachments: Array.isArray(options.attachments)
      ? options.attachments
          .map((item, index) => {
            const dataUrl = String(item?.dataUrl || item?.src || '').trim()

            if (!dataUrl) {
              return null
            }

            return {
              id:
                String(item?.id || '').trim() ||
                `attachment-${role}-${Date.now()}-${index}`,
              dataUrl,
              fileName:
                String(item?.fileName || '').trim() || `image-${index + 1}.png`,
            }
          })
          .filter(Boolean)
          .slice(0, CHAT_ATTACHMENT_LIMIT)
      : [],
    flipAnalysis:
      options.flipAnalysis && typeof options.flipAnalysis === 'object'
        ? options.flipAnalysis
        : null,
  }
}

function normalizeStoredChatHistory(value) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item, index) => {
      const role = item?.role === 'assistant' ? 'assistant' : 'user'
      const content = String(item?.content || '').trim()
      const createdAt = String(item?.createdAt || '').trim() || null

      if (!content) {
        return null
      }

      return {
        id: String(item?.id || '').trim() || `${role}-${index}`,
        role,
        content,
        createdAt,
      }
    })
    .filter(Boolean)
    .slice(-CHAT_HISTORY_LIMIT)
}

function loadStoredChatHistory() {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    return normalizeStoredChatHistory(
      JSON.parse(window.localStorage.getItem(CHAT_HISTORY_STORAGE_KEY) || '[]')
    )
  } catch {
    return []
  }
}

function persistStoredChatHistory(messages) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(
    CHAT_HISTORY_STORAGE_KEY,
    JSON.stringify(
      normalizeStoredChatHistory(messages).map(
        ({id, role, content, createdAt}) => ({
          id,
          role,
          content,
          createdAt,
        })
      )
    )
  )
}

function loadStoredDraft() {
  if (typeof window === 'undefined') {
    return ''
  }

  return String(window.localStorage.getItem(CHAT_DRAFT_STORAGE_KEY) || '')
}

function persistStoredDraft(value) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(CHAT_DRAFT_STORAGE_KEY, String(value || ''))
}

function formatRuntimeStatusError(result, t) {
  const message = String(
    (result && (result.error || result.lastError)) || ''
  ).trim()

  if (message === 'local_ai_disabled') {
    return t('Enable Local AI in Settings > AI to start chatting.')
  }

  if (message === 'local_ai_bridge_unavailable') {
    return t('The desktop Local AI bridge is unavailable. Restart the app.')
  }

  if (message === 'local_ai_unavailable') {
    return t('The configured Local AI runtime is not reachable yet.')
  }

  return message || t('The configured Local AI runtime is not reachable yet.')
}

function formatChatError(error, t) {
  const message = String((error && error.message) || error || '').trim()
  return message || t('Local AI chat request failed.')
}

function extractChatContent(result) {
  return String(result?.content || result?.text || result?.message || '').trim()
}

function formatFlipAnalysisForPrompt(flipAnalysis) {
  if (!flipAnalysis) {
    return ''
  }

  const lines = []

  if (flipAnalysis.sequenceText) {
    lines.push(`Sequence summary: ${flipAnalysis.sequenceText}`)
  }

  if (flipAnalysis.classification) {
    lines.push(
      `Sequence coherence: ${flipAnalysis.classification}${
        flipAnalysis.confidence ? ` (${flipAnalysis.confidence})` : ''
      }`
    )
  }

  if (flipAnalysis.reason) {
    lines.push(`Reason: ${flipAnalysis.reason}`)
  }

  return lines.join('\n')
}

function formatFlipAnalysisForDisplay(flipAnalysis, t) {
  const text = formatFlipAnalysisForPrompt(flipAnalysis)
  if (!text) {
    return ''
  }

  return `${t('Attached flip analysis')}\n${text}`
}

function shouldAnalyzeFlipRequest(prompt, attachments) {
  return (
    Array.isArray(attachments) &&
    attachments.length >= 2 &&
    (FLIP_REQUEST_PATTERN.test(String(prompt || '').trim()) ||
      attachments.length === 4)
  )
}

function shouldUseBundledSampleFlip(prompt, attachments) {
  const nextPrompt = String(prompt || '').trim()

  return (
    Array.isArray(attachments) &&
    attachments.length === 0 &&
    SAMPLE_FLIP_PATTERN.test(nextPrompt) &&
    SAMPLE_FLIP_ACTION_PATTERN.test(nextPrompt)
  )
}

function getBundledSampleFlip(index = 0) {
  const flips = Array.isArray(bundledSampleFlipSet?.flips)
    ? bundledSampleFlipSet.flips
    : []

  if (flips.length === 0) {
    return null
  }

  const nextIndex = Math.max(0, index) % flips.length
  const flip = flips[nextIndex]
  const attachments = Array.isArray(flip?.images)
    ? flip.images
        .slice(0, 4)
        .map((dataUrl, imageIndex) => {
          const nextDataUrl = String(dataUrl || '').trim()

          if (!nextDataUrl.startsWith('data:image/')) {
            return null
          }

          return {
            id: `bundled-sample-flip-${nextIndex + 1}-${imageIndex + 1}`,
            dataUrl: nextDataUrl,
            fileName: `bundled-sample-flip-${nextIndex + 1}-panel-${
              imageIndex + 1
            }.png`,
          }
        })
        .filter(Boolean)
    : []

  if (attachments.length === 0) {
    return null
  }

  return {
    attachments,
    meta: {
      sampleIndex: nextIndex + 1,
      hash: String(flip?.hash || '').trim(),
      expectedAnswer: String(flip?.expectedAnswer || '').trim() || null,
    },
  }
}

function formatBundledSampleFlipNotice(meta, t) {
  if (!meta) {
    return ''
  }

  if (meta.hash) {
    return t('Loaded bundled sample flip #{{index}} ({{hash}}).', {
      index: meta.sampleIndex,
      hash: meta.hash.slice(0, 12),
    })
  }

  return t('Loaded bundled sample flip #{{index}}.', {
    index: meta.sampleIndex,
  })
}

function toBridgeMessage(message) {
  const next = {
    role: message.role,
    content: message.content,
  }

  if (Array.isArray(message.attachments) && message.attachments.length > 0) {
    next.images = message.attachments
      .map(({dataUrl}) => dataUrl)
      .filter(Boolean)
  }

  return next
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => {
      const result = String(reader.result || '').trim()

      if (!result.startsWith('data:image/')) {
        reject(new Error('Only image files can be attached'))
        return
      }

      resolve(result)
    }

    reader.onerror = () => {
      reject(new Error('Unable to read the selected image'))
    }

    reader.readAsDataURL(file)
  })
}

function formatMessageTime(value) {
  if (!value) {
    return ''
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getLocalAiBridge() {
  if (!global.localAi || typeof global.localAi.chat !== 'function') {
    throw new Error('Local AI bridge is unavailable. Restart desktop app.')
  }

  return global.localAi
}

function ChatMessage({message}) {
  const isAssistant = message.role === 'assistant'

  return (
    <Flex justify={isAssistant ? 'flex-start' : 'flex-end'}>
      <Box
        maxW="3xl"
        w="fit-content"
        bg={isAssistant ? 'white' : 'brandBlue.500'}
        color={isAssistant ? 'brandGray.500' : 'white'}
        borderWidth={isAssistant ? '1px' : '0'}
        borderColor="gray.100"
        borderRadius="xl"
        px={4}
        py={3}
        boxShadow={isAssistant ? 'sm' : 'none'}
      >
        <HStack justify="space-between" spacing={4} mb={2}>
          <Text fontSize="sm" fontWeight={600} opacity={isAssistant ? 1 : 0.85}>
            {isAssistant ? 'AI' : 'You'}
          </Text>
          <Text fontSize="xs" opacity={isAssistant ? 0.7 : 0.85}>
            {formatMessageTime(message.createdAt)}
          </Text>
        </HStack>
        {Array.isArray(message.attachments) &&
          message.attachments.length > 0 && (
            <SimpleGrid
              columns={[2, 2, 4]}
              spacing={2}
              mb={message.content ? 3 : 0}
            >
              {message.attachments.map((attachment) => (
                <Box
                  key={attachment.id}
                  borderRadius="lg"
                  overflow="hidden"
                  borderWidth="1px"
                  borderColor={isAssistant ? 'gray.100' : 'whiteAlpha.500'}
                  bg={isAssistant ? 'gray.50' : 'whiteAlpha.200'}
                >
                  <Image
                    src={attachment.dataUrl}
                    alt={attachment.fileName || 'Attached image'}
                    objectFit="cover"
                    w="full"
                    h="96px"
                  />
                </Box>
              ))}
            </SimpleGrid>
          )}
        <Text whiteSpace="pre-wrap" lineHeight="tall">
          {message.content}
        </Text>
      </Box>
    </Flex>
  )
}

export default function AiChatPage() {
  const {t} = useTranslation()
  const router = useRouter()
  const toast = useToast()
  const {loading, syncing, offline} = useChainState()
  const settings = useSettingsState()
  const {updateLocalAiSettings} = useSettingsDispatch()

  const localAi = React.useMemo(
    () => buildLocalAiSettings(settings.localAi),
    [settings.localAi]
  )

  const runtimePayload = React.useMemo(
    () => buildLocalAiRuntimePayload(localAi),
    [localAi]
  )

  const [messages, setMessages] = React.useState([])
  const [draft, setDraft] = React.useState('')
  const [attachments, setAttachments] = React.useState([])
  const [statusResult, setStatusResult] = React.useState(null)
  const [isCheckingStatus, setIsCheckingStatus] = React.useState(false)
  const [isStartingRuntime, setIsStartingRuntime] = React.useState(false)
  const [isSending, setIsSending] = React.useState(false)
  const [lastError, setLastError] = React.useState('')

  const scrollAnchorRef = React.useRef(null)
  const fileInputRef = React.useRef(null)
  const sampleFlipCursorRef = React.useRef(0)

  React.useEffect(() => {
    setMessages(loadStoredChatHistory())
    setDraft(loadStoredDraft())
  }, [])

  React.useEffect(() => {
    persistStoredChatHistory(messages)
  }, [messages])

  React.useEffect(() => {
    persistStoredDraft(draft)
  }, [draft])

  React.useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'end',
    })
  }, [messages, isSending])

  const refreshRuntimeStatus = React.useCallback(async () => {
    setIsCheckingStatus(true)

    try {
      const bridge = getLocalAiBridge()
      const result = await bridge.status(runtimePayload)
      setStatusResult(result)
      setLastError('')
      return result
    } catch (error) {
      const nextError = formatChatError(error, t)
      setStatusResult({
        ok: false,
        enabled: Boolean(localAi.enabled),
        sidecarReachable: false,
        lastError: nextError,
      })
      setLastError(nextError)
      return null
    } finally {
      setIsCheckingStatus(false)
    }
  }, [localAi.enabled, runtimePayload, t])

  React.useEffect(() => {
    refreshRuntimeStatus()
  }, [refreshRuntimeStatus])

  const appendAssistantErrorToast = React.useCallback(
    (description) => {
      toast({
        status: 'error',
        duration: 5000,
        render: (props) => (
          <Toast
            title={t('Local AI chat failed')}
            description={description}
            {...props}
          />
        ),
      })
    },
    [t, toast]
  )

  const handlePickAttachments = React.useCallback(
    async (event) => {
      const files = Array.from(event?.target?.files || []).slice(
        0,
        CHAT_ATTACHMENT_LIMIT
      )

      if (files.length === 0) {
        return
      }

      try {
        const loaded = await Promise.all(
          files.map(async (file, index) => ({
            id: `attachment-${Date.now()}-${index}`,
            dataUrl: await readFileAsDataUrl(file),
            fileName:
              String(file?.name || '').trim() || `image-${index + 1}.png`,
          }))
        )

        setAttachments((current) =>
          [...current, ...loaded].slice(0, CHAT_ATTACHMENT_LIMIT)
        )
        setLastError('')
      } catch (error) {
        const nextError = formatChatError(error, t)
        setLastError(nextError)
        appendAssistantErrorToast(nextError)
      } finally {
        if (event?.target) {
          // Allow selecting the same file again.
          // eslint-disable-next-line no-param-reassign
          event.target.value = ''
        }
      }
    },
    [appendAssistantErrorToast, t]
  )

  const handleRemoveAttachment = React.useCallback((id) => {
    setAttachments((current) => current.filter((item) => item.id !== id))
  }, [])

  const handleClearAttachments = React.useCallback(() => {
    setAttachments([])
  }, [])

  const handleOpenAttachmentPicker = React.useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleSend = React.useCallback(async () => {
    const prompt = String(draft || '').trim()
    const selectedAttachments = attachments.slice(0, CHAT_ATTACHMENT_LIMIT)
    let bundledSampleFlip = null

    if (shouldUseBundledSampleFlip(prompt, selectedAttachments)) {
      bundledSampleFlip = getBundledSampleFlip(sampleFlipCursorRef.current)
      sampleFlipCursorRef.current += 1
    }

    const outgoingAttachments = bundledSampleFlip
      ? bundledSampleFlip.attachments
      : selectedAttachments
    const fallbackPrompt =
      outgoingAttachments.length >= 2
        ? t('Please analyze the attached flip panels.')
        : t('Please describe the attached image.')
    const effectivePrompt =
      prompt || (outgoingAttachments.length > 0 ? fallbackPrompt : '')

    if (!effectivePrompt || isSending) {
      return
    }

    const userMessage = createChatMessage('user', effectivePrompt, {
      attachments: outgoingAttachments,
    })
    const nextHistory = [...messages, userMessage].slice(-CHAT_HISTORY_LIMIT)

    setMessages(nextHistory)
    setDraft('')
    setAttachments([])
    setLastError('')
    setIsSending(true)

    try {
      const bridge = getLocalAiBridge()
      let flipAnalysis = null

      if (shouldAnalyzeFlipRequest(effectivePrompt, outgoingAttachments)) {
        const images = outgoingAttachments.map(({dataUrl}) => dataUrl)
        const [sequenceResult, checkerResult] = await Promise.all([
          bridge.flipToText({
            ...runtimePayload,
            input: {images},
          }),
          bridge.checkFlipSequence({
            ...runtimePayload,
            input: {images},
          }),
        ])

        if (sequenceResult?.ok || checkerResult?.ok) {
          flipAnalysis = {
            sequenceText: String(sequenceResult?.text || '').trim() || null,
            classification:
              String(checkerResult?.classification || '').trim() || null,
            confidence: String(checkerResult?.confidence || '').trim() || null,
            reason: String(checkerResult?.reason || '').trim() || null,
          }
        }
      }

      const analysisContext = formatFlipAnalysisForPrompt(flipAnalysis)
      const result = await bridge.chat({
        ...runtimePayload,
        messages: [
          SYSTEM_CHAT_MESSAGE,
          ...(analysisContext
            ? [
                {
                  role: 'system',
                  content: `Attached flip analysis from the local runtime:\n${analysisContext}`,
                },
              ]
            : []),
          ...nextHistory.map(toBridgeMessage),
        ],
      })
      const assistantContent = extractChatContent(result)

      if (!result?.ok || !assistantContent) {
        throw new Error(formatRuntimeStatusError(result, t))
      }

      const bundledSampleNotice = formatBundledSampleFlipNotice(
        bundledSampleFlip?.meta,
        t
      )
      const introText = bundledSampleNotice ? `${bundledSampleNotice}\n\n` : ''
      let displayText = `${introText}${assistantContent}`

      if (flipAnalysis) {
        displayText = `${introText}${formatFlipAnalysisForDisplay(
          flipAnalysis,
          t
        )}\n\n${assistantContent}`
      }

      setMessages((current) =>
        [
          ...current,
          createChatMessage('assistant', displayText, {flipAnalysis}),
        ].slice(-CHAT_HISTORY_LIMIT)
      )
      setStatusResult(result)
    } catch (error) {
      const message = formatChatError(error, t)
      setLastError(message)
      appendAssistantErrorToast(message)
    } finally {
      setIsSending(false)
    }
  }, [
    appendAssistantErrorToast,
    attachments,
    draft,
    isSending,
    messages,
    runtimePayload,
    t,
  ])

  const handleDraftKeyDown = React.useCallback(
    (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        handleSend()
      }
    },
    [handleSend]
  )

  const handleClearConversation = React.useCallback(() => {
    setMessages([])
    setAttachments([])
    setLastError('')
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(CHAT_HISTORY_STORAGE_KEY)
    }
  }, [])

  const handleQuickPrompt = React.useCallback((value) => {
    setDraft(value)
  }, [])

  const handleEnableLocalAi = React.useCallback(() => {
    updateLocalAiSettings({
      enabled: true,
      ...buildLocalAiRuntimePreset('ollama-direct'),
    })
  }, [updateLocalAiSettings])

  const startRuntimeLabel = t('Start local runtime')

  const handleStartLocalAi = React.useCallback(async () => {
    setIsStartingRuntime(true)
    setLastError('')

    const nextSettingsPatch =
      localAi.runtimeBackend === 'ollama-direct'
        ? {enabled: true}
        : {
            enabled: true,
            ...buildLocalAiRuntimePreset('ollama-direct'),
          }
    const nextLocalAi = buildLocalAiSettings({
      ...localAi,
      ...nextSettingsPatch,
    })
    const nextPayload = buildLocalAiRuntimePayload(nextLocalAi)

    try {
      updateLocalAiSettings(nextSettingsPatch)
      const bridge = getLocalAiBridge()
      const result = await bridge.start(nextPayload)
      setStatusResult(result)
      setLastError(
        result && result.sidecarReachable === true
          ? ''
          : formatRuntimeStatusError(result, t)
      )
    } catch (error) {
      const nextError = formatChatError(error, t)
      setLastError(nextError)
      appendAssistantErrorToast(nextError)
    } finally {
      setIsStartingRuntime(false)
    }
  }, [appendAssistantErrorToast, localAi, t, updateLocalAiSettings])

  const handleEnableAndStartLocalAi = React.useCallback(async () => {
    handleEnableLocalAi()
    await handleStartLocalAi()
  }, [handleEnableLocalAi, handleStartLocalAi])

  const isRuntimeReady = Boolean(
    localAi.enabled && statusResult && statusResult.sidecarReachable === true
  )
  const runtimeErrorMessage = formatRuntimeStatusError(statusResult, t)
  const textModelLabel =
    String(localAi.publicModelId || '').trim() || 'Idena-text-v1'
  const multimodalModelLabel =
    String(localAi.publicVisionId || '').trim() || 'Idena-multimodal-v1'
  const compatibilityTextModel =
    String(localAi.model || '').trim() || t('runtime default')
  const compatibilityVisionModel =
    String(localAi.visionModel || '').trim() || t('runtime default')
  const backendLabel =
    localAi.runtimeBackend === 'ollama-direct'
      ? t('Local runtime via Ollama')
      : t('Legacy HTTP sidecar')
  let runtimeStatusLabel = t('Disabled')

  if (isCheckingStatus) {
    runtimeStatusLabel = t('Checking runtime')
  } else if (isRuntimeReady) {
    runtimeStatusLabel = t('Ready')
  } else if (localAi.enabled) {
    runtimeStatusLabel = t('Needs attention')
  }

  const runtimeStatusTone = isRuntimeReady ? 'green' : 'orange'

  let runtimeAlert = null

  if (localAi.enabled) {
    runtimeAlert = isRuntimeReady ? (
      <SuccessAlert>
        <Text>
          {t(
            'Local AI runtime is reachable. Messages stay inside this desktop profile and use your current Local AI configuration.'
          )}
        </Text>
      </SuccessAlert>
    ) : (
      <ErrorAlert>
        <Flex
          direction={['column', 'row']}
          gap={3}
          justify="space-between"
          align={['flex-start', 'center']}
          w="full"
        >
          <Text>{runtimeErrorMessage}</Text>
          <HStack spacing={2}>
            <SecondaryButton
              minW="fit-content"
              isLoading={isStartingRuntime}
              onClick={handleStartLocalAi}
            >
              {startRuntimeLabel}
            </SecondaryButton>
            <SecondaryButton
              minW="fit-content"
              onClick={() => router.push('/settings/ai')}
            >
              {t('Fix in settings')}
            </SecondaryButton>
          </HStack>
        </Flex>
      </ErrorAlert>
    )
  } else {
    runtimeAlert = (
      <ErrorAlert>
        <Flex
          direction={['column', 'row']}
          gap={3}
          justify="space-between"
          align={['flex-start', 'center']}
          w="full"
        >
          <Text>
            {t(
              'Local AI is disabled. Enable it first to use the dedicated AI chat view.'
            )}
          </Text>
          <HStack spacing={2}>
            <SecondaryButton onClick={handleEnableLocalAi}>
              {t('Enable Local AI')}
            </SecondaryButton>
            <SecondaryButton
              isLoading={isStartingRuntime}
              onClick={handleEnableAndStartLocalAi}
            >
              {t('Enable and start local AI')}
            </SecondaryButton>
            <SecondaryButton onClick={() => router.push('/settings/ai')}>
              {t('Open settings')}
            </SecondaryButton>
          </HStack>
        </Flex>
      </ErrorAlert>
    )
  }

  return (
    <Layout loading={loading} syncing={syncing} offline={offline}>
      <Page minW={0}>
        <Flex direction="column" flex={1} w="full" minH={0}>
          <Stack spacing={5} flex={1} minH={0}>
            <Stack spacing={2}>
              <HStack spacing={3} align="center">
                <ChatIcon boxSize="6" color="brandBlue.500" />
                <PageTitle mb={0}>{t('IdenaAI-GPT')}</PageTitle>
              </HStack>
              <Text color="muted" maxW="4xl">
                {t(
                  'A dedicated local chat view for your configured IdenaAI runtime, with conversation history kept only in this desktop profile. You can also attach flip panels or other images and ask IdenaAI to analyze them.'
                )}
              </Text>
            </Stack>

            <Box
              bg="white"
              borderWidth="1px"
              borderColor="gray.100"
              borderRadius="xl"
              px={4}
              py={4}
            >
              <Stack spacing={4}>
                <Flex
                  align={['flex-start', 'center']}
                  direction={['column', 'row']}
                  justify="space-between"
                  gap={3}
                >
                  <Stack spacing={1}>
                    <HStack spacing={2} wrap="wrap">
                      <Badge colorScheme={runtimeStatusTone}>
                        {runtimeStatusLabel}
                      </Badge>
                      <Badge variant="subtle">
                        {formatAiProviderLabel('local-ai')}
                      </Badge>
                    </HStack>
                    <Text fontWeight={600}>
                      {t('Text model')}: {textModelLabel}
                    </Text>
                    <Text fontWeight={600}>
                      {t('Multimodal model')}: {multimodalModelLabel}
                    </Text>
                    <Text color="muted" fontSize="sm">
                      {t('Compatibility backend')}: {backendLabel}
                    </Text>
                    <Text color="muted" fontSize="sm">
                      {t('Backend overrides')}: {compatibilityTextModel} /{' '}
                      {compatibilityVisionModel}
                    </Text>
                    <Text color="muted" fontSize="sm">
                      {t('Endpoint')}: {runtimePayload.baseUrl}
                    </Text>
                  </Stack>

                  <HStack spacing={2} alignSelf={['stretch', 'auto']}>
                    <SecondaryButton
                      leftIcon={<SyncIcon boxSize="4" />}
                      isLoading={isCheckingStatus}
                      onClick={refreshRuntimeStatus}
                    >
                      {t('Refresh status')}
                    </SecondaryButton>
                    <SecondaryButton
                      leftIcon={<SettingsIcon boxSize="4" />}
                      onClick={() => router.push('/settings/ai')}
                    >
                      {t('AI settings')}
                    </SecondaryButton>
                  </HStack>
                </Flex>

                {runtimeAlert}
              </Stack>
            </Box>

            <Box
              bg="gray.50"
              borderWidth="1px"
              borderColor="gray.100"
              borderRadius="xl"
              px={4}
              py={4}
              flex={1}
              minH={0}
            >
              <Stack spacing={4} h="full">
                <Flex
                  align={['flex-start', 'center']}
                  direction={['column', 'row']}
                  justify="space-between"
                  gap={3}
                >
                  <Stack spacing={1}>
                    <Text fontWeight={600}>{t('Conversation')}</Text>
                    <Text color="muted" fontSize="sm">
                      {t(
                        'Use Cmd/Ctrl + Enter to send quickly. Clear the conversation at any time.'
                      )}
                    </Text>
                  </Stack>
                  <SecondaryButton onClick={handleClearConversation}>
                    {t('New chat')}
                  </SecondaryButton>
                </Flex>

                <Box
                  bg="white"
                  borderRadius="xl"
                  borderWidth="1px"
                  borderColor="gray.100"
                  px={4}
                  py={4}
                  flex={1}
                  minH="420px"
                  maxH="calc(100vh - 430px)"
                  overflowY="auto"
                >
                  {messages.length > 0 ? (
                    <Stack spacing={4}>
                      {messages.map((message) => (
                        <ChatMessage key={message.id} message={message} />
                      ))}
                      {isSending && (
                        <Flex justify="flex-start">
                          <Box
                            bg="white"
                            borderWidth="1px"
                            borderColor="gray.100"
                            borderRadius="xl"
                            px={4}
                            py={3}
                            boxShadow="sm"
                          >
                            <HStack spacing={3}>
                              <Spinner size="sm" color="brandBlue.500" />
                              <Text color="muted">{t('Thinking...')}</Text>
                            </HStack>
                          </Box>
                        </Flex>
                      )}
                      <Box ref={scrollAnchorRef} />
                    </Stack>
                  ) : (
                    <Stack spacing={4} align="flex-start">
                      <Text fontWeight={600}>
                        {t('Start with a simple ask')}
                      </Text>
                      <Text color="muted" maxW="2xl">
                        {t(
                          'This page is meant to be a fast, convenient IdenaAI conversation surface, similar in convenience to the Social section rather than a raw debug control.'
                        )}
                      </Text>
                      <Stack spacing={2}>
                        {QUICK_PROMPTS.map((prompt) => (
                          <Button
                            key={prompt}
                            justifyContent="flex-start"
                            variant="ghost"
                            colorScheme="blue"
                            onClick={() => handleQuickPrompt(prompt)}
                          >
                            {t(prompt)}
                          </Button>
                        ))}
                      </Stack>
                    </Stack>
                  )}
                </Box>

                {lastError && <ErrorAlert>{lastError}</ErrorAlert>}

                <Box
                  bg="white"
                  borderWidth="1px"
                  borderColor="gray.100"
                  borderRadius="xl"
                  px={4}
                  py={4}
                >
                  <Stack spacing={3}>
                    <Input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      display="none"
                      onChange={handlePickAttachments}
                    />
                    <Flex
                      justify="space-between"
                      align={['flex-start', 'center']}
                      direction={['column', 'row']}
                      gap={3}
                    >
                      <Stack spacing={1}>
                        <Text fontWeight={600}>{t('Message')}</Text>
                        <Text color="muted" fontSize="sm">
                          {t(
                            'Attach one or more images to discuss them, or attach 2 to 4 flip panels and ask IdenaAI to solve the test flip locally.'
                          )}
                        </Text>
                      </Stack>
                      <HStack spacing={2}>
                        <SecondaryButton
                          leftIcon={<UploadIcon boxSize="4" />}
                          onClick={handleOpenAttachmentPicker}
                        >
                          {t('Add images')}
                        </SecondaryButton>
                        {attachments.length > 0 && (
                          <SecondaryButton
                            leftIcon={<DeleteIcon boxSize="4" />}
                            onClick={handleClearAttachments}
                          >
                            {t('Clear images')}
                          </SecondaryButton>
                        )}
                      </HStack>
                    </Flex>

                    {attachments.length > 0 && (
                      <Box
                        bg="gray.50"
                        borderWidth="1px"
                        borderColor="gray.100"
                        borderRadius="xl"
                        px={3}
                        py={3}
                      >
                        <Stack spacing={3}>
                          <HStack justify="space-between">
                            <HStack spacing={2}>
                              <PhotoIcon boxSize="4" color="brandBlue.500" />
                              <Text fontWeight={600}>
                                {t('Attached images ({{count}})', {
                                  count: attachments.length,
                                })}
                              </Text>
                            </HStack>
                            <Text color="muted" fontSize="sm">
                              {attachments.length >= 2
                                ? t('Ready for local flip analysis')
                                : t('Ready for image chat')}
                            </Text>
                          </HStack>
                          <SimpleGrid columns={[2, 2, 4]} spacing={3}>
                            {attachments.map((attachment) => (
                              <Box
                                key={attachment.id}
                                position="relative"
                                borderRadius="lg"
                                overflow="hidden"
                                borderWidth="1px"
                                borderColor="gray.100"
                                bg="white"
                              >
                                <Image
                                  src={attachment.dataUrl}
                                  alt={attachment.fileName}
                                  objectFit="cover"
                                  w="full"
                                  h="108px"
                                />
                                <IconButton
                                  aria-label={t('Remove image')}
                                  icon={<DeleteIcon boxSize="4" />}
                                  size="xs"
                                  position="absolute"
                                  top={2}
                                  right={2}
                                  onClick={() =>
                                    handleRemoveAttachment(attachment.id)
                                  }
                                />
                                <Box px={2} py={2}>
                                  <Text
                                    fontSize="xs"
                                    color="muted"
                                    noOfLines={1}
                                  >
                                    {attachment.fileName}
                                  </Text>
                                </Box>
                              </Box>
                            ))}
                          </SimpleGrid>
                        </Stack>
                      </Box>
                    )}

                    <Textarea
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={handleDraftKeyDown}
                      minH="120px"
                      placeholder={t(
                        'Ask Local AI something useful about flips, validation, node logs, or general strategy...'
                      )}
                    />
                    <Flex justify="space-between" align="center" gap={3}>
                      <Text color="muted" fontSize="sm">
                        {attachments.length > 0
                          ? t(
                              'Attached images stay local to this desktop session. Text history is stored only in this desktop profile.'
                            )
                          : t(
                              'Conversation history is stored only in this desktop profile.'
                            )}
                      </Text>
                      <PrimaryButton
                        leftIcon={<SendIcon boxSize="4" />}
                        isLoading={isSending}
                        onClick={handleSend}
                        isDisabled={
                          (!String(draft || '').trim() &&
                            attachments.length === 0) ||
                          !isRuntimeReady
                        }
                      >
                        {t('Send')}
                      </PrimaryButton>
                    </Flex>
                  </Stack>
                </Box>
              </Stack>
            </Box>
          </Stack>
        </Flex>
      </Page>
    </Layout>
  )
}
