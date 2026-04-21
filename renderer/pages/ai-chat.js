/* eslint-disable react/prop-types */
import React from 'react'
import {
  Badge,
  Box,
  Button,
  Checkbox as ChakraCheckbox,
  Code,
  Divider,
  Flex,
  Heading,
  HStack,
  IconButton,
  Image,
  Input,
  Link,
  ListItem,
  OrderedList,
  Popover,
  PopoverArrow,
  PopoverBody,
  PopoverContent,
  PopoverTrigger,
  SimpleGrid,
  Spinner,
  Stack,
  Textarea as ChakraTextarea,
  Text,
  UnorderedList,
  useToast,
} from '@chakra-ui/react'
import {useRouter} from 'next/router'
import {useTranslation} from 'react-i18next'
import Layout from '../shared/components/layout'
import {
  ErrorAlert,
  Page,
  PageTitle,
  Progress,
  SuccessAlert,
  Toast,
  Tooltip,
} from '../shared/components/components'
import {
  InfoButton,
  PrimaryButton,
  SecondaryButton,
} from '../shared/components/button'
import {ManagedRuntimeTrustDialog} from '../shared/components/managed-runtime-trust-dialog'
import {useChainState} from '../shared/providers/chain-context'
import {EpochPeriod, useEpochState} from '../shared/providers/epoch-context'
import {
  useSettingsDispatch,
  useSettingsState,
} from '../shared/providers/settings-context'
import {
  buildLocalAiRuntimePayload,
  formatAiProviderLabel,
} from '../shared/utils/ai-provider-readiness'
import {
  DEFAULT_LOCAL_AI_SETTINGS,
  INTERNVL3_5_1B_RESEARCH_RUNTIME_FAMILY,
  INTERNVL3_5_8B_RESEARCH_RUNTIME_FAMILY,
  MANAGED_LOCAL_RUNTIME_FAMILIES,
  MOLMO2_4B_RESEARCH_RUNTIME_FAMILY,
  buildManagedLocalAiTrustApprovalPatch,
  buildLocalAiRepairPreset,
  buildMolmo2OResearchPreset,
  buildLocalAiSettings,
  hasManagedLocalAiTrustApproval,
  resolveManagedLocalRuntimeMemoryReference,
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
const CHAT_PREFERENCES_STORAGE_KEY = 'idenaLocalAiChatPreferencesV1'
const CHAT_HISTORY_LIMIT = 40
const CHAT_ATTACHMENT_LIMIT = 8
const CHAT_COMPOSER_COLLAPSED_HEIGHT = 58
const CHAT_COMPOSER_EXPANDED_MIN_HEIGHT = 96
const CHAT_COMPOSER_EXPANDED_MAX_HEIGHT = 240
const SYSTEM_CHAT_MESSAGE = {
  role: 'system',
  content:
    'You are a concise, practical assistant inside the Idena desktop app. Keep answers short and actionable.',
}
const OCR_IMAGE_CHAT_SYSTEM_MESSAGE = {
  role: 'system',
  content:
    'If attached images contain text, read the visible text carefully before answering. For screenshots, prioritize OCR and the textual content over generic visual description. Quote or summarize the relevant text first when it matters for the answer.',
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

function HelpPopover({label, children, placement = 'top-end'}) {
  let body = children

  if (Array.isArray(children)) {
    body = (
      <Stack spacing={2}>
        {children.map((item, index) => (
          <Text key={`${label}-${index}`} fontSize="sm">
            {item}
          </Text>
        ))}
      </Stack>
    )
  } else if (typeof children === 'string') {
    body = <Text fontSize="sm">{children}</Text>
  }

  return (
    <Popover trigger="click" placement={placement} isLazy>
      <PopoverTrigger>
        <Box as="span">
          <InfoButton aria-label={label} display="inline-flex" />
        </Box>
      </PopoverTrigger>
      <PopoverContent
        border="none"
        bg="graphite.500"
        color="white"
        borderRadius="md"
        boxShadow="lg"
        maxW="320px"
      >
        <PopoverArrow bg="graphite.500" />
        <PopoverBody p={3}>{body}</PopoverBody>
      </PopoverContent>
    </Popover>
  )
}

function createChatId(role) {
  return `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function createChatMessage(role, content, options = {}) {
  return {
    id: createChatId(role),
    role,
    content: String(content || '').trim(),
    createdAt: new Date().toISOString(),
    persistLocally: options.persistLocally !== false,
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
    flipContext:
      typeof options.flipContext === 'string' && options.flipContext.trim()
        ? options.flipContext.trim()
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
        persistLocally: item?.persistLocally !== false,
        flipContext: String(item?.flipContext || '').trim() || null,
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

function clearStoredChatHistory() {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.removeItem(CHAT_HISTORY_STORAGE_KEY)
}

function persistStoredChatHistory(messages) {
  if (typeof window === 'undefined') {
    return
  }

  const normalizedMessages = normalizeStoredChatHistory(messages).filter(
    (message) => message && message.persistLocally !== false
  )

  window.localStorage.setItem(
    CHAT_HISTORY_STORAGE_KEY,
    JSON.stringify(
      normalizedMessages.map(
        ({id, role, content, createdAt, flipContext, persistLocally}) => ({
          id,
          role,
          content,
          createdAt,
          persistLocally: persistLocally !== false,
          flipContext:
            typeof flipContext === 'string' && flipContext.trim()
              ? flipContext.trim()
              : null,
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

function clearStoredDraft() {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.removeItem(CHAT_DRAFT_STORAGE_KEY)
}

function persistStoredDraft(value) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(CHAT_DRAFT_STORAGE_KEY, String(value || ''))
}

function loadStoredChatPreferences() {
  if (typeof window === 'undefined') {
    return {storeLocally: false}
  }

  const hasExistingStoredChat = Boolean(
    window.localStorage.getItem(CHAT_HISTORY_STORAGE_KEY) ||
      window.localStorage.getItem(CHAT_DRAFT_STORAGE_KEY)
  )

  try {
    const raw = JSON.parse(
      window.localStorage.getItem(CHAT_PREFERENCES_STORAGE_KEY) || '{}'
    )

    if (typeof raw?.storeLocally === 'boolean') {
      return {storeLocally: raw.storeLocally}
    }
  } catch {
    // Ignore malformed preferences and fall back to the privacy-first default.
  }

  return {
    storeLocally: hasExistingStoredChat,
  }
}

function persistStoredChatPreferences(preferences = {}) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(
    CHAT_PREFERENCES_STORAGE_KEY,
    JSON.stringify({
      storeLocally: preferences.storeLocally === true,
    })
  )
}

function formatRuntimeStatusError(result, t) {
  const progress =
    result &&
    result.runtimeProgress &&
    typeof result.runtimeProgress === 'object' &&
    result.runtimeProgress.active !== false
      ? result.runtimeProgress
      : null

  if (progress && String(progress.message || '').trim()) {
    return String(progress.message || '').trim()
  }

  const message = String(
    (result && (result.lastError || result.error)) || ''
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

  if (
    message === 'invalid_response' ||
    /assistant text|unsupported or empty format|empty reply/i.test(message)
  ) {
    return t(
      'The local model answered in an empty or unsupported format. Try a simpler prompt, a different local model, or restart the local runtime.'
    )
  }

  if (/ECONNREFUSED|EHOSTUNREACH|ENOTFOUND/i.test(message)) {
    return t(
      'The local runtime is not running yet. Start it here, then try again.'
    )
  }

  if (/runtime_start_timeout|not responding yet/i.test(message)) {
    return t(
      'The managed local runtime is still preparing the on-device model. The first launch can take several more minutes after package installation.'
    )
  }

  if (/ResolutionImpossible|cannot install/i.test(message)) {
    return t(
      'IdenaAI could not finish installing the managed local runtime packages. Try Fix automatically once, then restart the app and try again.'
    )
  }

  if (/managed_runtime_trust_required/i.test(message)) {
    return t(
      'Approve the managed on-device runtime once before IdenaAI installs pinned packages and runs the verified pinned local model snapshot locally.'
    )
  }

  if (/unsupported_managed_model/i.test(message)) {
    return t(
      'The managed on-device runtime is locked to its pinned model family. Use a custom local runtime if you need a different base model.'
    )
  }

  if (/idle/i.test(message)) {
    return t('The local runtime is currently stopped.')
  }

  return message || t('The configured Local AI runtime is not reachable yet.')
}

function formatChatError(error, t) {
  const message = String((error && error.message) || error || '').trim()
  if (/managed_runtime_trust_required/i.test(message)) {
    return t(
      'Approve the managed on-device runtime once before IdenaAI installs pinned packages and runs the verified pinned local model snapshot locally.'
    )
  }
  if (/unsupported_managed_model/i.test(message)) {
    return t(
      'The managed on-device runtime is locked to its pinned model family. Use a custom local runtime if you need a different base model.'
    )
  }
  return message || t('Local AI chat request failed.')
}

function getManagedLocalRuntimeFamily(localAi = {}) {
  const runtimeBackend = String(localAi?.runtimeBackend || '')
    .trim()
    .toLowerCase()
  const runtimeFamily = String(localAi?.runtimeFamily || '')
    .trim()
    .toLowerCase()

  if (runtimeBackend !== 'local-runtime-service') {
    return ''
  }

  return MANAGED_LOCAL_RUNTIME_FAMILIES.includes(runtimeFamily)
    ? runtimeFamily
    : ''
}

function getManagedLocalRuntimeName(t, runtimeFamily = '') {
  switch (
    String(runtimeFamily || '')
      .trim()
      .toLowerCase()
  ) {
    case INTERNVL3_5_1B_RESEARCH_RUNTIME_FAMILY:
      return t('InternVL3.5-1B light runtime')
    case MOLMO2_4B_RESEARCH_RUNTIME_FAMILY:
      return t('Molmo2-4B compact runtime')
    case INTERNVL3_5_8B_RESEARCH_RUNTIME_FAMILY:
      return t('InternVL3.5-8B experimental runtime')
    case 'molmo2-o':
    default:
      return t('Molmo2-O research runtime')
  }
}

function getManagedLocalRuntimeBackendLabel(t, runtimeFamily = '') {
  switch (
    String(runtimeFamily || '')
      .trim()
      .toLowerCase()
  ) {
    case INTERNVL3_5_1B_RESEARCH_RUNTIME_FAMILY:
      return t('Managed InternVL3.5-1B runtime')
    case MOLMO2_4B_RESEARCH_RUNTIME_FAMILY:
      return t('Managed Molmo2-4B runtime')
    case INTERNVL3_5_8B_RESEARCH_RUNTIME_FAMILY:
      return t('Experimental InternVL3.5-8B runtime')
    case 'molmo2-o':
    default:
      return t('Managed Molmo2-O runtime')
  }
}

function getManagedLocalRuntimeTrustNote(t, runtimeFamily = '') {
  return String(runtimeFamily || '')
    .trim()
    .toLowerCase() === INTERNVL3_5_8B_RESEARCH_RUNTIME_FAMILY
    ? t(
        'Experimental path: this pinned InternVL build uses the generic transformers runtime and can still be too heavy for a 32 GB desktop once the node and other apps are open.'
      )
    : ''
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

function getRuntimePayloadKey(payload = {}) {
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
      ? t('Installing managed runtime')
      : t('Installing local runtime')
  } else if (
    managedRuntime &&
    String(next.stage || '').trim() === 'wait_for_runtime_model_load'
  ) {
    title = t('Loading on-device model')
  } else if (managedRuntime) {
    title = t('Starting managed runtime')
  }

  return {
    ...next,
    title,
    description:
      next.message ||
      (managedRuntime
        ? t('IdenaAI is preparing the managed local runtime on this device.')
        : t('IdenaAI is preparing the local runtime on this device.')),
  }
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

function buildFlipContextSummary({
  prompt,
  attachments,
  bundledSampleMeta,
  flipAnalysis,
}) {
  const lines = []
  const nextPrompt = String(prompt || '').trim()

  if (bundledSampleMeta?.sampleIndex) {
    lines.push(`Bundled sample flip: #${bundledSampleMeta.sampleIndex}`)
  }

  if (bundledSampleMeta?.hash) {
    lines.push(`Bundled sample hash: ${bundledSampleMeta.hash}`)
  }

  if (bundledSampleMeta?.expectedAnswer) {
    lines.push(
      `Bundled sample expected answer: ${bundledSampleMeta.expectedAnswer}`
    )
  }

  if (Array.isArray(attachments) && attachments.length > 0) {
    lines.push(`Attached panel count: ${attachments.length}`)
  }

  if (nextPrompt) {
    lines.push(`Original user ask: ${nextPrompt}`)
  }

  const analysisText = formatFlipAnalysisForPrompt(flipAnalysis)
  if (analysisText) {
    lines.push(`Local flip analysis:\n${analysisText}`)
  }

  return lines.join('\n').trim()
}

function findLatestFlipContext(messages = []) {
  const reversed = Array.isArray(messages) ? [...messages].reverse() : []

  return (
    reversed.find(
      (message) =>
        message &&
        typeof message.flipContext === 'string' &&
        message.flipContext.trim()
    ) || null
  )
}

function getFlipContextSourceLabel(flipContext) {
  const text = String(flipContext || '').trim()

  if (!text) {
    return ''
  }

  const firstLine = text.split('\n').find((line) => String(line || '').trim())

  return String(firstLine || '').trim()
}

function toBridgeMessage(message, options = {}) {
  const includeImages = Boolean(options.includeImages)
  const next = {
    role: message.role,
    content: message.content,
  }

  if (
    includeImages &&
    Array.isArray(message.attachments) &&
    message.attachments.length > 0
  ) {
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

function summarizeContextSnippet(value, maxLength = 180) {
  const raw = String(value || '')
    .replace(/\s+/gu, ' ')
    .trim()

  if (!raw) {
    return ''
  }

  if (raw.length <= maxLength) {
    return raw
  }

  return `${raw.slice(0, maxLength).trim()}…`
}

function getLocalAiBridge() {
  if (!global.localAi || typeof global.localAi.chat !== 'function') {
    throw new Error('Local AI bridge is unavailable. Restart desktop app.')
  }

  return global.localAi
}

function normalizeMarkdownLines(content) {
  return String(content || '')
    .replace(/\r\n?/gu, '\n')
    .split('\n')
}

function joinMarkdownParagraphLines(lines = []) {
  return lines
    .map((line) => String(line || '').trim())
    .filter(Boolean)
    .join(' ')
}

function renderMarkdownInlines(content, options = {}) {
  const text = String(content || '')
  const keyPrefix = String(options.keyPrefix || 'inline')
  const linkColor = options.linkColor || 'blue.500'
  const nodes = []
  const patterns = [
    {
      type: 'link',
      regex: /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/u,
    },
    {
      type: 'bold',
      regex: /\*\*([^*]+)\*\*/u,
    },
    {
      type: 'code',
      regex: /`([^`\n]+)`/u,
    },
    {
      type: 'italic',
      regex: /\*([^*\n]+)\*/u,
    },
  ]

  let remaining = text
  let partIndex = 0

  while (remaining) {
    let bestMatch = null

    for (const nextPattern of patterns) {
      const nextMatch = nextPattern.regex.exec(remaining)

      if (!nextMatch) {
        // Keep scanning until we find the earliest inline token.
      } else if (
        !bestMatch ||
        nextMatch.index < bestMatch.match.index ||
        (nextMatch.index === bestMatch.match.index &&
          patterns.indexOf(nextPattern) < patterns.indexOf(bestMatch.pattern))
      ) {
        bestMatch = {pattern: nextPattern, match: nextMatch}
      }
    }

    if (!bestMatch) {
      nodes.push(remaining)
      break
    }

    const selectedPattern = bestMatch.pattern
    const selectedMatch = bestMatch.match

    if (selectedMatch.index > 0) {
      nodes.push(remaining.slice(0, selectedMatch.index))
    }

    const matchKey = `${keyPrefix}-${partIndex}`

    if (selectedPattern.type === 'link') {
      const label = String(selectedMatch[1] || '').trim()
      const href = String(selectedMatch[2] || '').trim()
      nodes.push(
        <Link
          key={matchKey}
          color={linkColor}
          href={href}
          isExternal
          textDecoration="underline"
          wordBreak="break-all"
        >
          {label || href}
        </Link>
      )
    } else if (selectedPattern.type === 'bold') {
      nodes.push(
        <Text as="strong" key={matchKey} fontWeight={700} color="inherit">
          {renderMarkdownInlines(selectedMatch[1], {
            keyPrefix: `${matchKey}-strong`,
            linkColor,
          })}
        </Text>
      )
    } else if (selectedPattern.type === 'italic') {
      nodes.push(
        <Text as="em" key={matchKey} fontStyle="italic" color="inherit">
          {renderMarkdownInlines(selectedMatch[1], {
            keyPrefix: `${matchKey}-em`,
            linkColor,
          })}
        </Text>
      )
    } else if (selectedPattern.type === 'code') {
      nodes.push(
        <Code
          key={matchKey}
          px={1.5}
          py={0.5}
          borderRadius="md"
          fontSize="0.92em"
          colorScheme="gray"
        >
          {selectedMatch[1]}
        </Code>
      )
    }

    remaining = remaining.slice(selectedMatch.index + selectedMatch[0].length)
    partIndex += 1
  }

  return nodes
}

function renderMarkdownBlocks(content, options = {}) {
  const lines = normalizeMarkdownLines(content)
  const blocks = []
  const keyPrefix = String(options.keyPrefix || 'block')
  const textColor = options.textColor || 'inherit'
  const linkColor = options.linkColor || 'blue.500'
  let index = 0
  let blockIndex = 0

  const isBlockBoundary = (line) => {
    const nextLine = String(line || '')
    return (
      /^#{1,6}\s+/u.test(nextLine) ||
      /^\s*[-*]\s+/u.test(nextLine) ||
      /^\s*\d+\.\s+/u.test(nextLine) ||
      /^\s*>\s+/u.test(nextLine) ||
      /^\s*```/u.test(nextLine)
    )
  }

  while (index < lines.length) {
    const line = String(lines[index] || '')
    const trimmed = line.trim()

    if (!trimmed) {
      index += 1
    } else if (/^\s*```/u.test(line)) {
      const codeLines = []
      index += 1

      while (index < lines.length && !/^\s*```/u.test(lines[index])) {
        codeLines.push(lines[index])
        index += 1
      }

      if (index < lines.length) {
        index += 1
      }

      blocks.push(
        <Box
          as="pre"
          key={`${keyPrefix}-${blockIndex}`}
          overflowX="auto"
          whiteSpace="pre-wrap"
          bg="blackAlpha.50"
          borderWidth="1px"
          borderColor="blackAlpha.100"
          borderRadius="lg"
          px={3}
          py={2.5}
          fontSize="sm"
          lineHeight="tall"
          fontFamily="mono"
          color={textColor}
        >
          {codeLines.join('\n')}
        </Box>
      )
      blockIndex += 1
    } else {
      const headingMatch = /^(#{1,6})\s+(.*)$/u.exec(trimmed)

      if (headingMatch) {
        const level = Math.min(headingMatch[1].length, 6)
        const sizeMap = {
          1: 'lg',
          2: 'md',
          3: 'sm',
          4: 'xs',
          5: 'xs',
          6: 'xs',
        }

        blocks.push(
          <Heading
            key={`${keyPrefix}-${blockIndex}`}
            as={`h${level}`}
            size={sizeMap[level] || 'sm'}
            color={textColor}
            lineHeight="short"
          >
            {renderMarkdownInlines(headingMatch[2], {
              keyPrefix: `${keyPrefix}-${blockIndex}-heading`,
              linkColor,
            })}
          </Heading>
        )
        blockIndex += 1
        index += 1
      } else if (/^\s*[-*]\s+/u.test(line)) {
        const currentBlockIndex = blockIndex
        const items = []

        while (index < lines.length && /^\s*[-*]\s+/u.test(lines[index])) {
          items.push(lines[index].replace(/^\s*[-*]\s+/u, '').trim())
          index += 1
        }

        blocks.push(
          <UnorderedList
            key={`${keyPrefix}-${currentBlockIndex}`}
            spacing={2}
            pl={5}
            color={textColor}
          >
            {items.map((item, itemIndex) => (
              <ListItem
                key={`${keyPrefix}-${currentBlockIndex}-item-${itemIndex}`}
              >
                {renderMarkdownInlines(item, {
                  keyPrefix: `${keyPrefix}-${currentBlockIndex}-item-${itemIndex}`,
                  linkColor,
                })}
              </ListItem>
            ))}
          </UnorderedList>
        )
        blockIndex += 1
      } else if (/^\s*\d+\.\s+/u.test(line)) {
        const currentBlockIndex = blockIndex
        const items = []

        while (index < lines.length && /^\s*\d+\.\s+/u.test(lines[index])) {
          items.push(lines[index].replace(/^\s*\d+\.\s+/u, '').trim())
          index += 1
        }

        blocks.push(
          <OrderedList
            key={`${keyPrefix}-${currentBlockIndex}`}
            spacing={2}
            pl={5}
            color={textColor}
          >
            {items.map((item, itemIndex) => (
              <ListItem
                key={`${keyPrefix}-${currentBlockIndex}-item-${itemIndex}`}
              >
                {renderMarkdownInlines(item, {
                  keyPrefix: `${keyPrefix}-${currentBlockIndex}-item-${itemIndex}`,
                  linkColor,
                })}
              </ListItem>
            ))}
          </OrderedList>
        )
        blockIndex += 1
      } else if (/^\s*>\s+/u.test(line)) {
        const quoteLines = []

        while (index < lines.length && /^\s*>\s+/u.test(lines[index])) {
          quoteLines.push(lines[index].replace(/^\s*>\s+/u, '').trim())
          index += 1
        }

        blocks.push(
          <Box
            key={`${keyPrefix}-${blockIndex}`}
            borderLeftWidth="3px"
            borderLeftColor="gray.300"
            pl={3}
            py={1}
            color={textColor}
          >
            <Text lineHeight="tall">
              {renderMarkdownInlines(joinMarkdownParagraphLines(quoteLines), {
                keyPrefix: `${keyPrefix}-${blockIndex}-quote`,
                linkColor,
              })}
            </Text>
          </Box>
        )
        blockIndex += 1
      } else {
        const paragraphLines = [trimmed]
        index += 1

        while (index < lines.length) {
          const nextLine = String(lines[index] || '')

          if (!nextLine.trim() || isBlockBoundary(nextLine)) {
            break
          }

          paragraphLines.push(nextLine.trim())
          index += 1
        }

        blocks.push(
          <Text
            key={`${keyPrefix}-${blockIndex}`}
            whiteSpace="pre-wrap"
            lineHeight="tall"
            color={textColor}
          >
            {renderMarkdownInlines(joinMarkdownParagraphLines(paragraphLines), {
              keyPrefix: `${keyPrefix}-${blockIndex}-paragraph`,
              linkColor,
            })}
          </Text>
        )
        blockIndex += 1
      }
    }
  }

  return blocks
}

function FormattedChatContent({content = '', isAssistant = false}) {
  const blocks = React.useMemo(
    () =>
      renderMarkdownBlocks(content, {
        keyPrefix: isAssistant ? 'assistant-message' : 'user-message',
        textColor: 'inherit',
        linkColor: isAssistant ? 'blue.500' : 'white',
      }),
    [content, isAssistant]
  )

  return <Stack spacing={3}>{blocks}</Stack>
}

function ChatMessage({message}) {
  const isAssistant = message.role === 'assistant'

  return (
    <Flex justify={isAssistant ? 'flex-start' : 'flex-end'}>
      <Box
        maxW={isAssistant ? '4xl' : '3xl'}
        w="fit-content"
        bg={isAssistant ? 'white' : 'brandBlue.500'}
        color={isAssistant ? 'brandGray.500' : 'white'}
        borderWidth={isAssistant ? '1px' : '0'}
        borderColor="gray.100"
        borderRadius="2xl"
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
        <FormattedChatContent
          content={message.content}
          isAssistant={isAssistant}
        />
      </Box>
    </Flex>
  )
}

export default function AiChatPage() {
  const {t} = useTranslation()
  const router = useRouter()
  const toast = useToast()
  const {loading, syncing, offline} = useChainState()
  const epoch = useEpochState()
  const settings = useSettingsState()
  const {updateAiSolverSettings, updateLocalAiSettings} = useSettingsDispatch()

  const localAi = React.useMemo(
    () => buildLocalAiSettings(settings.localAi),
    [settings.localAi]
  )
  const currentMode = String(router.query?.mode || '')
    .trim()
    .toLowerCase()
  const showModeChooser = currentMode !== 'chat'
  const isValidationRunning = [
    EpochPeriod.ShortSession,
    EpochPeriod.LongSession,
  ].includes(String(epoch?.currentPeriod || '').trim())

  const runtimePayload = React.useMemo(
    () => buildLocalAiRuntimePayload(localAi),
    [localAi]
  )
  const [activeRuntimePayload, setActiveRuntimePayload] = React.useState(null)
  const activeRuntimePayloadKeyRef = React.useRef('')
  const runtimeProgressPollingPayload = activeRuntimePayload || runtimePayload

  const [messages, setMessages] = React.useState([])
  const [draft, setDraft] = React.useState('')
  const [attachments, setAttachments] = React.useState([])
  const [storeChatLocally, setStoreChatLocally] = React.useState(false)
  const [statusResult, setStatusResult] = React.useState(null)
  const [isCheckingStatus, setIsCheckingStatus] = React.useState(false)
  const [isStartingRuntime, setIsStartingRuntime] = React.useState(false)
  const [isSending, setIsSending] = React.useState(false)
  const [isComposerFocused, setIsComposerFocused] = React.useState(false)
  const [lastError, setLastError] = React.useState('')
  const [isManagedRuntimeTrustDialogOpen, setIsManagedRuntimeTrustDialogOpen] =
    React.useState(false)
  const [managedRuntimeTrustPatch, setManagedRuntimeTrustPatch] =
    React.useState(null)
  const managedRuntimeTrustLocalAi = React.useMemo(
    () =>
      buildLocalAiSettings({
        ...localAi,
        ...((managedRuntimeTrustPatch && managedRuntimeTrustPatch) || {}),
      }),
    [localAi, managedRuntimeTrustPatch]
  )
  const managedRuntimeTrustFamily = React.useMemo(
    () => getManagedLocalRuntimeFamily(managedRuntimeTrustLocalAi),
    [managedRuntimeTrustLocalAi]
  )
  const applyBackgroundStatusResult = React.useCallback(
    (nextResult, payload) => {
      const payloadKey = getRuntimePayloadKey(payload)
      setStatusResult((current) =>
        shouldIgnoreStaleRuntimeStatusResult(current, nextResult, {
          activePayloadKey: activeRuntimePayloadKeyRef.current,
          payloadKey,
        })
          ? current
          : nextResult
      )
    },
    []
  )
  const applyBackgroundStatusError = React.useCallback(
    (nextError, payload) => {
      const payloadKey = getRuntimePayloadKey(payload)
      const nextResult = {
        ok: false,
        enabled: Boolean(localAi.enabled),
        sidecarReachable: false,
        lastError: nextError,
      }

      let ignored = false

      setStatusResult((current) => {
        if (
          shouldIgnoreStaleRuntimeStatusResult(current, nextResult, {
            activePayloadKey: activeRuntimePayloadKeyRef.current,
            payloadKey,
          })
        ) {
          ignored = true
          return current
        }

        return nextResult
      })

      if (!ignored) {
        setLastError(nextError)
      }

      return !ignored
    },
    [localAi.enabled]
  )

  const scrollAnchorRef = React.useRef(null)
  const fileInputRef = React.useRef(null)
  const composerRef = React.useRef(null)
  const sampleFlipCursorRef = React.useRef(0)

  React.useEffect(() => {
    const preferences = loadStoredChatPreferences()
    setStoreChatLocally(preferences.storeLocally)

    if (preferences.storeLocally) {
      setMessages(loadStoredChatHistory())
      setDraft(loadStoredDraft())
    }
  }, [])

  React.useEffect(() => {
    persistStoredChatPreferences({storeLocally: storeChatLocally})
  }, [storeChatLocally])

  React.useEffect(() => {
    if (storeChatLocally) {
      persistStoredChatHistory(messages)
    } else {
      clearStoredChatHistory()
    }
  }, [messages, storeChatLocally])

  React.useEffect(() => {
    if (storeChatLocally) {
      persistStoredDraft(draft)
    } else {
      clearStoredDraft()
    }
  }, [draft, storeChatLocally])

  React.useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'end',
    })
  }, [messages, isSending])

  React.useEffect(() => {
    const node = composerRef.current

    if (!node) {
      return
    }

    const canExpand =
      isComposerFocused ||
      Boolean(String(draft || '').trim()) ||
      attachments.length > 0
    const minHeight = canExpand
      ? CHAT_COMPOSER_EXPANDED_MIN_HEIGHT
      : CHAT_COMPOSER_COLLAPSED_HEIGHT
    const maxHeight = canExpand
      ? CHAT_COMPOSER_EXPANDED_MAX_HEIGHT
      : CHAT_COMPOSER_EXPANDED_MIN_HEIGHT

    node.style.height = 'auto'
    const nextHeight = Math.min(
      maxHeight,
      Math.max(minHeight, node.scrollHeight)
    )
    node.style.height = `${nextHeight}px`
    node.style.overflowY = node.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }, [attachments.length, draft, isComposerFocused])

  const latestFlipContextMessage = React.useMemo(
    () => findLatestFlipContext(messages),
    [messages]
  )
  const draftText = String(draft || '').trim()
  const willUseRetainedFlipContext = React.useMemo(
    () =>
      attachments.length === 0 &&
      FLIP_REQUEST_PATTERN.test(draftText) &&
      Boolean(latestFlipContextMessage?.flipContext),
    [attachments.length, draftText, latestFlipContextMessage]
  )
  const retainedFlipContextSource = React.useMemo(
    () => getFlipContextSourceLabel(latestFlipContextMessage?.flipContext),
    [latestFlipContextMessage]
  )
  const hasRetainedFlipContext = Boolean(latestFlipContextMessage?.flipContext)
  const retainedFlipContextSnippet = React.useMemo(
    () => summarizeContextSnippet(latestFlipContextMessage?.flipContext),
    [latestFlipContextMessage]
  )

  const refreshRuntimeStatus = React.useCallback(async () => {
    setIsCheckingStatus(true)

    try {
      const bridge = getLocalAiBridge()
      const result = await bridge.status(runtimePayload)
      applyBackgroundStatusResult(result, runtimePayload)
      setLastError('')
      return result
    } catch (error) {
      const nextError = formatChatError(error, t)
      applyBackgroundStatusError(nextError, runtimePayload)
      return null
    } finally {
      setIsCheckingStatus(false)
    }
  }, [
    applyBackgroundStatusError,
    applyBackgroundStatusResult,
    runtimePayload,
    t,
  ])

  React.useEffect(() => {
    refreshRuntimeStatus()
  }, [refreshRuntimeStatus])

  const runtimeProgress = React.useMemo(
    () => normalizeRuntimeProgress(statusResult?.runtimeProgress),
    [statusResult]
  )

  React.useEffect(() => {
    if (!isStartingRuntime && !runtimeProgress?.active) {
      return undefined
    }

    let cancelled = false
    let timerId = null

    const pollProgress = async () => {
      try {
        if (!global.localAi) {
          return
        }

        const result = await global.localAi.status(
          runtimeProgressPollingPayload
        )

        if (!cancelled) {
          applyBackgroundStatusResult(result, runtimeProgressPollingPayload)
        }
      } catch {
        // Keep the latest visible progress state until start settles.
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
    applyBackgroundStatusResult,
    isStartingRuntime,
    runtimeProgress?.active,
    runtimeProgressPollingPayload,
  ])

  const ensureInteractiveRuntimeReady = React.useCallback(async () => {
    if (!localAi.enabled) {
      throw new Error(t('Enable Local AI first in AI settings.'))
    }

    const bridge = getLocalAiBridge()
    const result = await bridge.start(runtimePayload)

    setStatusResult(result)

    if (result?.sidecarReachable !== true) {
      throw new Error(formatRuntimeStatusError(result, t))
    }

    setLastError('')
    return {bridge, result}
  }, [localAi.enabled, runtimePayload, t])

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
      persistLocally: storeChatLocally && outgoingAttachments.length === 0,
    })
    const nextHistory = [...messages, userMessage].slice(-CHAT_HISTORY_LIMIT)

    setMessages(nextHistory)
    setDraft('')
    setAttachments([])
    composerRef.current?.blur()
    setLastError('')
    setIsSending(true)

    try {
      const {bridge} = await ensureInteractiveRuntimeReady()
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
      const followUpFlipContext =
        outgoingAttachments.length === 0 &&
        FLIP_REQUEST_PATTERN.test(effectivePrompt) &&
        latestFlipContextMessage?.flipContext
          ? latestFlipContextMessage.flipContext
          : ''
      const currentFlipContext = buildFlipContextSummary({
        prompt: effectivePrompt,
        attachments: outgoingAttachments,
        bundledSampleMeta: bundledSampleFlip?.meta,
        flipAnalysis,
      })
      const bridgeMessages = nextHistory.map((entry) =>
        toBridgeMessage(entry, {
          // Keep raw image payloads only for the current turn. Older image
          // attachments stay visible in the UI but are represented by their
          // textual chat history on follow-up turns, which avoids empty
          // multimodal responses from the local runtime on stale image context.
          includeImages:
            outgoingAttachments.length > 0 && entry.id === userMessage.id,
        })
      )
      const result = await bridge.chat({
        ...runtimePayload,
        messages: [
          SYSTEM_CHAT_MESSAGE,
          ...(followUpFlipContext
            ? [
                {
                  role: 'system',
                  content:
                    `The user is asking about the last discussed flip without reattaching images. ` +
                    `Use the following retained flip context instead of expecting image payloads:\n${followUpFlipContext}`,
                },
              ]
            : []),
          ...(analysisContext
            ? [
                {
                  role: 'system',
                  content: `Attached flip analysis from the local runtime:\n${analysisContext}`,
                },
              ]
            : []),
          ...(outgoingAttachments.length > 0
            ? [OCR_IMAGE_CHAT_SYSTEM_MESSAGE]
            : []),
          ...bridgeMessages,
        ],
        generationOptions:
          outgoingAttachments.length > 0
            ? {
                temperature: 0,
                num_predict: 256,
              }
            : null,
        timeoutMs: outgoingAttachments.length > 0 ? 90 * 1000 : 60 * 1000,
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
          createChatMessage('assistant', displayText, {
            flipAnalysis,
            flipContext: currentFlipContext || followUpFlipContext || null,
            persistLocally:
              storeChatLocally && outgoingAttachments.length === 0,
          }),
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
    ensureInteractiveRuntimeReady,
    isSending,
    latestFlipContextMessage,
    messages,
    runtimePayload,
    storeChatLocally,
    t,
  ])

  const handleDraftKeyDown = React.useCallback(
    (event) => {
      if (
        event.key === 'Enter' &&
        !event.shiftKey &&
        !event.nativeEvent?.isComposing
      ) {
        event.preventDefault()
        handleSend()
      }
    },
    [handleSend]
  )

  const handleClearConversation = React.useCallback(() => {
    setMessages([])
    setAttachments([])
    setDraft('')
    setLastError('')
    clearStoredChatHistory()
    clearStoredDraft()
  }, [])

  const handleQuickPrompt = React.useCallback((value) => {
    setDraft(value)
  }, [])

  const handleClearFlipContext = React.useCallback(() => {
    setMessages((current) =>
      current.map((message) =>
        message && message.flipContext
          ? {...message, flipContext: null}
          : message
      )
    )
    setLastError('')
  }, [])

  const shouldBootstrapManagedLocalAi = React.useMemo(() => {
    const currentEndpoint = String(
      localAi.endpoint || localAi.baseUrl || ''
    ).trim()

    return (
      !localAi.enabled &&
      localAi.runtimeBackend !== 'local-runtime-service' &&
      String(localAi.model || '').trim() === '' &&
      String(localAi.visionModel || '').trim() === '' &&
      currentEndpoint === DEFAULT_LOCAL_AI_SETTINGS.endpoint
    )
  }, [
    localAi.baseUrl,
    localAi.enabled,
    localAi.endpoint,
    localAi.model,
    localAi.runtimeBackend,
    localAi.visionModel,
  ])

  const handleEnableLocalAi = React.useCallback(() => {
    updateLocalAiSettings(
      localAi.runtimeBackend === 'local-runtime-service' ||
        (localAi.runtimeBackend === 'ollama-direct' &&
          !shouldBootstrapManagedLocalAi)
        ? {enabled: true}
        : {
            enabled: true,
            ...buildMolmo2OResearchPreset(),
          }
    )
  }, [
    localAi.runtimeBackend,
    shouldBootstrapManagedLocalAi,
    updateLocalAiSettings,
  ])

  const startLocalAiRuntime = React.useCallback(
    async (nextSettingsPatch) => {
      setIsStartingRuntime(true)
      setLastError('')

      const nextLocalAi = buildLocalAiSettings({
        ...localAi,
        ...nextSettingsPatch,
      })
      const nextPayload = buildLocalAiRuntimePayload(nextLocalAi)
      const managedRuntime = Boolean(getManagedLocalRuntimeFamily(nextLocalAi))
      const managedRuntimeMemoryReference = managedRuntime
        ? resolveManagedLocalRuntimeMemoryReference(nextLocalAi.runtimeFamily)
        : ''

      if (managedRuntime && !hasManagedLocalAiTrustApproval(nextLocalAi)) {
        setManagedRuntimeTrustPatch(nextSettingsPatch)
        setIsManagedRuntimeTrustDialogOpen(true)
        setIsStartingRuntime(false)
        return false
      }

      try {
        activeRuntimePayloadKeyRef.current = getRuntimePayloadKey(nextPayload)
        setActiveRuntimePayload(nextPayload)
        setStatusResult((current) => ({
          ...(current || {}),
          enabled: true,
          status: 'starting',
          runtimeProgress: {
            active: true,
            status: managedRuntime ? 'installing' : 'starting',
            stage: 'prepare_runtime_request',
            message: managedRuntime
              ? 'Preparing the managed local runtime on this device.'
              : 'Preparing the local runtime on this device.',
            progressPercent: 2,
          },
        }))
        updateLocalAiSettings(nextSettingsPatch)
        if (managedRuntimeMemoryReference) {
          updateAiSolverSettings({
            localAiMemoryReference: managedRuntimeMemoryReference,
          })
        }
        const bridge = getLocalAiBridge()
        const result = await bridge.start(nextPayload)
        setStatusResult(result)
        const ready = result && result.sidecarReachable === true
        setLastError(ready ? '' : formatRuntimeStatusError(result, t))
        return ready
      } catch (error) {
        const nextError = formatChatError(error, t)
        setLastError(nextError)
        appendAssistantErrorToast(nextError)
        return false
      } finally {
        setIsStartingRuntime(false)
        activeRuntimePayloadKeyRef.current = ''
        setActiveRuntimePayload(null)
      }
    },
    [
      appendAssistantErrorToast,
      localAi,
      t,
      updateAiSolverSettings,
      updateLocalAiSettings,
    ]
  )

  const handleStartLocalAi = React.useCallback(async () => {
    const nextSettingsPatch =
      localAi.runtimeBackend === 'local-runtime-service' ||
      (localAi.runtimeBackend === 'ollama-direct' &&
        !shouldBootstrapManagedLocalAi)
        ? {enabled: true}
        : {
            enabled: true,
            ...buildMolmo2OResearchPreset(),
          }

    return startLocalAiRuntime(nextSettingsPatch)
  }, [
    localAi.runtimeBackend,
    shouldBootstrapManagedLocalAi,
    startLocalAiRuntime,
  ])

  const handleFixLocalAiAutomatically = React.useCallback(async () => {
    const nextSettingsPatch = {
      enabled: true,
      ...buildLocalAiRepairPreset(localAi, {
        preferManaged:
          shouldBootstrapManagedLocalAi ||
          localAi.runtimeBackend === 'local-runtime-service',
      }),
    }

    return startLocalAiRuntime(nextSettingsPatch)
  }, [localAi, shouldBootstrapManagedLocalAi, startLocalAiRuntime])

  const closeManagedRuntimeTrustDialog = React.useCallback(() => {
    setIsManagedRuntimeTrustDialogOpen(false)
    setManagedRuntimeTrustPatch(null)
  }, [])

  const approveManagedRuntimeTrust = React.useCallback(async () => {
    const nextSettingsPatch = {
      ...((managedRuntimeTrustPatch && managedRuntimeTrustPatch) || {}),
      ...buildManagedLocalAiTrustApprovalPatch(),
    }

    setIsManagedRuntimeTrustDialogOpen(false)
    setManagedRuntimeTrustPatch(null)
    await startLocalAiRuntime(nextSettingsPatch)
  }, [managedRuntimeTrustPatch, startLocalAiRuntime])

  const handleEnableAndStartLocalAi = React.useCallback(async () => {
    handleEnableLocalAi()
    return handleStartLocalAi()
  }, [handleEnableLocalAi, handleStartLocalAi])

  const handleOpenChatMode = React.useCallback(async () => {
    const readyNow = Boolean(
      localAi.enabled && statusResult && statusResult.sidecarReachable === true
    )

    if (readyNow) {
      router.push('/ai-chat?mode=chat')
      return
    }

    const ready = localAi.enabled
      ? await handleStartLocalAi()
      : await handleEnableAndStartLocalAi()

    if (ready) {
      router.push('/ai-chat?mode=chat')
    }
  }, [
    handleEnableAndStartLocalAi,
    handleStartLocalAi,
    localAi.enabled,
    router,
    statusResult,
  ])

  const handleToggleStoredChat = React.useCallback(
    (event) => {
      const nextValue = Boolean(event?.target?.checked)
      setStoreChatLocally(nextValue)

      if (!nextValue) {
        clearStoredChatHistory()
        clearStoredDraft()
        toast({
          render: () => (
            <Toast title={t('Local chat storage turned off')}>
              {t(
                'This conversation now stays in memory only. If privacy matters, keep storage off and delete old chats you no longer want saved on this device.'
              )}
            </Toast>
          ),
        })
      } else {
        toast({
          render: () => (
            <Toast title={t('Local chat storage turned on')}>
              {t(
                'This device will keep your text-only chat timeline locally until you clear it. Attached images still stay out of saved history.'
              )}
            </Toast>
          ),
        })
      }
    },
    [t, toast]
  )

  const isRuntimeReady = Boolean(
    localAi.enabled && statusResult && statusResult.sidecarReachable === true
  )
  const runtimeProgressDisplay = React.useMemo(
    () =>
      describeRuntimeProgress(runtimeProgress, t, {
        managedRuntime: Boolean(
          getManagedLocalRuntimeFamily(activeRuntimePayload || localAi)
        ),
      }),
    [activeRuntimePayload, localAi, runtimeProgress, t]
  )
  const runtimeErrorMessage = formatRuntimeStatusError(statusResult, t)
  const startRuntimeLabel =
    runtimeProgressDisplay?.title ||
    (localAi.runtimeBackend === 'local-runtime-service'
      ? t('Start managed runtime')
      : t('Start local runtime'))
  let backendLabel = t('Custom local runtime')

  if (shouldBootstrapManagedLocalAi) {
    backendLabel = t('Managed on-device runtime')
  } else if (localAi.runtimeBackend === 'ollama-direct') {
    backendLabel = t('Ollama local runtime')
  } else if (localAi.runtimeBackend === 'local-runtime-service') {
    const managedRuntimeFamily = getManagedLocalRuntimeFamily(localAi)
    backendLabel = managedRuntimeFamily
      ? getManagedLocalRuntimeBackendLabel(t, managedRuntimeFamily)
      : t('Managed local runtime')
  }

  let openChatButtonLabel = t('Start local AI and open chat')

  if (!localAi.enabled) {
    openChatButtonLabel = t('Enable local AI and open chat')
  } else if (isRuntimeReady) {
    openChatButtonLabel = t('Chat with IdenaAI')
  }
  let runtimeStatusLabel = t('Disabled')

  if (shouldBootstrapManagedLocalAi && !localAi.enabled) {
    runtimeStatusLabel = t('Ready to set up')
  } else if (runtimeProgressDisplay) {
    runtimeStatusLabel =
      runtimeProgressDisplay.status === 'installing'
        ? t('Installing')
        : t('Starting')
  } else if (isCheckingStatus) {
    runtimeStatusLabel = t('Checking runtime')
  } else if (isRuntimeReady) {
    runtimeStatusLabel = t('Ready')
  } else if (localAi.enabled) {
    runtimeStatusLabel = t('Needs attention')
  }
  let storageHelperText = t(
    'This chat is ephemeral right now unless you turn local storage on.'
  )

  if (attachments.length > 0) {
    storageHelperText = t('{{count}} images attached for this message', {
      count: attachments.length,
    })
  } else if (storeChatLocally) {
    storageHelperText = t(
      'Text-only messages in this chat will be kept locally until you clear them.'
    )
  }

  let runtimeStatusTone = 'orange'

  if (isRuntimeReady) {
    runtimeStatusTone = 'green'
  } else if (runtimeProgressDisplay) {
    runtimeStatusTone = 'blue'
  }

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
        <Stack spacing={3} w="full">
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
                isLoading={isStartingRuntime}
                onClick={handleFixLocalAiAutomatically}
              >
                {t('Fix automatically')}
              </SecondaryButton>
              <SecondaryButton
                minW="fit-content"
                onClick={() => router.push('/settings/ai')}
              >
                {t('Custom path')}
              </SecondaryButton>
            </HStack>
          </Flex>
          {runtimeProgressDisplay ? (
            <Box>
              <Progress
                value={runtimeProgressDisplay.progressPercent ?? undefined}
                isIndeterminate={
                  !Number.isFinite(runtimeProgressDisplay.progressPercent)
                }
                hasStripe
                isAnimated
              />
              <Flex align="center" justify="space-between" mt={2} gap={3}>
                <Text color="muted" fontSize="xs">
                  {runtimeProgressDisplay.detail ||
                    t(
                      'The first setup can take several minutes while runtime packages and model files are prepared.'
                    )}
                </Text>
                {Number.isFinite(runtimeProgressDisplay.progressPercent) ? (
                  <Text color="muted" fontSize="xs" fontWeight={600}>
                    {runtimeProgressDisplay.progressPercent}%
                  </Text>
                ) : null}
              </Flex>
            </Box>
          ) : null}
        </Stack>
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
              'Local AI is off. Turn it on once and IdenaAI will prepare the on-device runtime for you.'
            )}
          </Text>
          <HStack spacing={2}>
            <PrimaryButton
              isLoading={isStartingRuntime}
              onClick={handleEnableAndStartLocalAi}
            >
              {t('Turn on local AI')}
            </PrimaryButton>
            <SecondaryButton onClick={() => router.push('/settings/ai')}>
              {t('Open settings')}
            </SecondaryButton>
          </HStack>
        </Flex>
      </ErrorAlert>
    )
  }

  if (showModeChooser) {
    return (
      <Layout
        loading={loading}
        syncing={syncing}
        offline={offline}
        allowWhenNodeUnavailable
      >
        <Page minW={0}>
          <Stack spacing={6} maxW="4xl">
            <Stack spacing={2}>
              <HStack spacing={3} align="center">
                <ChatIcon boxSize="6" color="brandBlue.500" />
                <PageTitle mb={0}>{t('IdenaAI')}</PageTitle>
              </HStack>
              <Text color="muted" maxW="3xl">
                {t(
                  'Open local chat or teach the model on 5-flip chunks. On a fresh install, IdenaAI can prepare the local runtime for you automatically.'
                )}
              </Text>
            </Stack>

            <Box
              bg="white"
              borderWidth="1px"
              borderColor="gray.100"
              borderRadius="xl"
              px={4}
              py={3}
            >
              <HStack spacing={2} wrap="wrap" align="center">
                <Badge colorScheme={runtimeStatusTone}>
                  {runtimeStatusLabel}
                </Badge>
                <Badge variant="subtle">
                  {formatAiProviderLabel('local-ai')}
                </Badge>
                <Text color="muted" fontSize="sm" noOfLines={1}>
                  {backendLabel}
                </Text>
              </HStack>
            </Box>

            <SimpleGrid columns={[1, 1, 2]} spacing={4}>
              <Box
                bg="white"
                borderWidth="1px"
                borderColor="gray.100"
                borderRadius="xl"
                px={5}
                py={5}
              >
                <Stack spacing={3} h="full">
                  <Badge colorScheme="green" alignSelf="flex-start">
                    {t('Chat')}
                  </Badge>
                  <Text fontSize="xl" fontWeight={700}>
                    {t('Chat with IdenaAI')}
                  </Text>
                  <Text color="muted" flex={1}>
                    {t(
                      'Open direct local chat, attach images, and ask for FLIP reasoning or general Idena help. On first use, IdenaAI can prepare the local runtime automatically.'
                    )}
                  </Text>
                  <PrimaryButton
                    variant="solid"
                    isLoading={isStartingRuntime}
                    onClick={handleOpenChatMode}
                  >
                    {openChatButtonLabel}
                  </PrimaryButton>
                </Stack>
              </Box>

              <Box
                bg="white"
                borderWidth="1px"
                borderColor="gray.100"
                borderRadius="xl"
                px={5}
                py={5}
              >
                <Stack spacing={3} h="full">
                  <Badge colorScheme="blue" alignSelf="flex-start">
                    {t('Developer mode')}
                  </Badge>
                  <Text fontSize="xl" fontWeight={700}>
                    {t('Train your AI on flips')}
                  </Text>
                  <Text color="muted" flex={1}>
                    {t(
                      'Annotate 5 bundled FLIP examples, train locally, and keep your saved or trained progress on this Mac.'
                    )}
                  </Text>
                  {isValidationRunning ? (
                    <Text color="orange.500" fontSize="sm">
                      {t(
                        'This training flow is unavailable while a validation session is running.'
                      )}
                    </Text>
                  ) : null}
                  <SecondaryButton
                    isDisabled={isValidationRunning}
                    onClick={() =>
                      router.push(
                        '/settings/ai-human-teacher?developer=1&action=start'
                      )
                    }
                  >
                    {t('Train your AI on flips')}
                  </SecondaryButton>
                </Stack>
              </Box>
            </SimpleGrid>

            {runtimeAlert}
          </Stack>
        </Page>
      </Layout>
    )
  }

  return (
    <Layout
      loading={loading}
      syncing={syncing}
      offline={offline}
      allowWhenNodeUnavailable
    >
      <Page minW={0} px={[4, 6, 8]} py={4} overflow="hidden">
        <Input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          display="none"
          onChange={handlePickAttachments}
        />

        <Flex direction="column" flex={1} w="full" minH={0} gap={4}>
          <Flex
            align={['flex-start', 'center']}
            direction={['column', 'row']}
            justify="space-between"
            gap={3}
          >
            <Stack spacing={1}>
              <HStack spacing={3} align="center">
                <ChatIcon boxSize="6" color="brandBlue.500" />
                <PageTitle mb={0}>{t('IdenaAI')}</PageTitle>
              </HStack>
            </Stack>
            <HStack
              spacing={2}
              wrap="wrap"
              justify={['flex-start', 'flex-end']}
            >
              <Badge colorScheme={runtimeStatusTone}>
                {runtimeStatusLabel}
              </Badge>
              <Badge variant="subtle">{backendLabel}</Badge>
              <SecondaryButton
                leftIcon={<SyncIcon boxSize="4" />}
                isLoading={isCheckingStatus}
                onClick={refreshRuntimeStatus}
              >
                {t('Refresh')}
              </SecondaryButton>
              <SecondaryButton
                leftIcon={<SettingsIcon boxSize="4" />}
                onClick={() => router.push('/settings/ai')}
              >
                {t('AI settings')}
              </SecondaryButton>
            </HStack>
          </Flex>

          {!isRuntimeReady ? runtimeAlert : null}

          <Box
            bg="white"
            borderWidth="1px"
            borderColor="gray.100"
            borderRadius="2xl"
            boxShadow="sm"
            flex={1}
            minH={0}
            display="flex"
            flexDirection="column"
            overflow="hidden"
          >
            <Flex
              px={4}
              py={3}
              borderBottomWidth="1px"
              borderBottomColor="gray.100"
              justify="space-between"
              align={['flex-start', 'center']}
              direction={['column', 'row']}
              gap={3}
            >
              <Stack spacing={1} minW={0}>
                <HStack spacing={2}>
                  <Text fontWeight={700}>{t('Conversation')}</Text>
                  <HelpPopover label={t('Chat help')}>
                    {[
                      t('Enter sends. Shift+Enter adds a new line.'),
                      t(
                        'The composer stays compact after send so the timeline remains easier to read.'
                      ),
                      t(
                        'Add images only when they help the answer or flip analysis.'
                      ),
                    ]}
                  </HelpPopover>
                </HStack>
              </Stack>

              <HStack spacing={2} wrap="wrap">
                <Badge colorScheme={storeChatLocally ? 'green' : 'gray'}>
                  {storeChatLocally
                    ? t('Saved locally')
                    : t('Not saved locally')}
                </Badge>
                <Button
                  size="sm"
                  variant="ghost"
                  colorScheme="blue"
                  leftIcon={<UploadIcon boxSize="4" />}
                  onClick={handleOpenAttachmentPicker}
                >
                  {t('Add images')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  colorScheme="blue"
                  onClick={handleClearConversation}
                >
                  {t('New chat')}
                </Button>
              </HStack>
            </Flex>

            {(hasRetainedFlipContext || willUseRetainedFlipContext) && (
              <Box
                px={4}
                py={3}
                borderBottomWidth="1px"
                borderBottomColor="gray.100"
                bg={willUseRetainedFlipContext ? 'blue.50' : 'gray.50'}
              >
                <Flex
                  justify="space-between"
                  align={['flex-start', 'center']}
                  direction={['column', 'row']}
                  gap={3}
                >
                  <HStack spacing={3} minW={0} align="flex-start">
                    <Badge
                      colorScheme={willUseRetainedFlipContext ? 'blue' : 'gray'}
                    >
                      {willUseRetainedFlipContext
                        ? t('Will reuse flip context')
                        : t('Flip context kept')}
                    </Badge>
                    <Stack spacing={1} minW={0}>
                      <Text fontSize="sm" noOfLines={2}>
                        {retainedFlipContextSnippet ||
                          t(
                            'A recent flip discussion can be reused without resending images.'
                          )}
                      </Text>
                      {retainedFlipContextSource ? (
                        <Text color="muted" fontSize="xs" noOfLines={1}>
                          {t('Source')}: {retainedFlipContextSource}
                        </Text>
                      ) : null}
                    </Stack>
                  </HStack>
                  <HStack spacing={2}>
                    <HelpPopover label={t('Retained flip context')}>
                      {[
                        t(
                          'This keeps the last discussed flip available for follow-up questions without reattaching images.'
                        ),
                        t(
                          'Clear it if you want the next answer to ignore that older flip context.'
                        ),
                      ]}
                    </HelpPopover>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleClearFlipContext}
                    >
                      {t('Clear')}
                    </Button>
                  </HStack>
                </Flex>
              </Box>
            )}

            <Box
              flex={1}
              minH={0}
              overflowY="auto"
              px={[3, 4]}
              py={4}
              bg="gray.50"
            >
              {messages.length > 0 ? (
                <Stack spacing={4} maxW="4xl" mx="auto" w="full">
                  {messages.map((message) => (
                    <ChatMessage key={message.id} message={message} />
                  ))}
                  {isSending ? (
                    <Flex justify="flex-start">
                      <Box
                        bg="white"
                        borderWidth="1px"
                        borderColor="gray.100"
                        borderRadius="2xl"
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
                  ) : null}
                  <Box ref={scrollAnchorRef} />
                </Stack>
              ) : (
                <Flex h="full" align="center" justify="center">
                  <Stack
                    spacing={5}
                    align="center"
                    maxW="2xl"
                    textAlign="center"
                  >
                    <Stack spacing={2}>
                      <Text fontWeight={600}>
                        {t('Start with a short message.')}
                      </Text>
                      <Text color="muted" fontSize="sm">
                        {t(
                          'The reply will appear here in the timeline. Keep local storage off if you want this chat to stay ephemeral.'
                        )}
                      </Text>
                    </Stack>
                    <HStack spacing={2} flexWrap="wrap" justify="center">
                      {QUICK_PROMPTS.slice(0, 4).map((prompt) => (
                        <Button
                          key={prompt}
                          size="sm"
                          variant="ghost"
                          colorScheme="blue"
                          onClick={() => handleQuickPrompt(prompt)}
                        >
                          {t(prompt)}
                        </Button>
                      ))}
                    </HStack>
                  </Stack>
                </Flex>
              )}
            </Box>

            <Divider />

            <Box px={[3, 4]} py={4} bg="white">
              <Stack spacing={3} maxW="4xl" mx="auto" w="full">
                {attachments.length > 0 ? (
                  <Box
                    bg="gray.50"
                    borderWidth="1px"
                    borderColor="gray.100"
                    borderRadius="xl"
                    px={3}
                    py={3}
                  >
                    <Stack spacing={3}>
                      <Flex
                        justify="space-between"
                        align={['flex-start', 'center']}
                        direction={['column', 'row']}
                        gap={2}
                      >
                        <HStack spacing={2}>
                          <PhotoIcon boxSize="4" color="brandBlue.500" />
                          <Text fontWeight={600}>
                            {t('Images ready ({{count}})', {
                              count: attachments.length,
                            })}
                          </Text>
                        </HStack>
                        <Button
                          size="sm"
                          variant="ghost"
                          leftIcon={<DeleteIcon boxSize="4" />}
                          onClick={handleClearAttachments}
                        >
                          {t('Clear images')}
                        </Button>
                      </Flex>
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
                              h="96px"
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
                              <Text fontSize="xs" color="muted" noOfLines={1}>
                                {attachment.fileName}
                              </Text>
                            </Box>
                          </Box>
                        ))}
                      </SimpleGrid>
                    </Stack>
                  </Box>
                ) : null}

                <Box
                  borderWidth="1px"
                  borderColor={isComposerFocused ? 'blue.200' : 'gray.100'}
                  borderRadius="2xl"
                  bg="gray.50"
                  px={3}
                  py={3}
                  boxShadow={
                    isComposerFocused
                      ? '0 0 0 1px rgba(66,153,225,0.12)'
                      : 'none'
                  }
                >
                  <ChakraTextarea
                    ref={composerRef}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={handleDraftKeyDown}
                    onFocus={() => setIsComposerFocused(true)}
                    onBlur={() => setIsComposerFocused(false)}
                    resize="none"
                    minH={`${CHAT_COMPOSER_COLLAPSED_HEIGHT}px`}
                    border="none"
                    bg="transparent"
                    px={1}
                    py={1}
                    _focus={{boxShadow: 'none'}}
                    _placeholder={{color: 'muted'}}
                    placeholder={t(
                      'Write to IdenaAI… Ask about a flip, your node, validation, or strategy.'
                    )}
                  />
                </Box>

                <Flex
                  justify="space-between"
                  align={['flex-start', 'center']}
                  direction={['column', 'row']}
                  gap={3}
                >
                  <Stack spacing={2}>
                    <HStack spacing={3} wrap="wrap">
                      <ChakraCheckbox
                        size="sm"
                        isChecked={storeChatLocally}
                        onChange={handleToggleStoredChat}
                      >
                        {t('Store text chat locally on this device')}
                      </ChakraCheckbox>
                      <HelpPopover label={t('Local storage privacy')}>
                        {[
                          t(
                            'Stored chat stays only on this desktop profile. You are responsible for your own privacy.'
                          ),
                          t(
                            'If you want to reduce the chance of old chats leaking into future AI reuse or training, keep storage off and delete saved conversations you no longer need.'
                          ),
                          t(
                            'Attached images stay out of saved chat history even when local storage is on.'
                          ),
                        ]}
                      </HelpPopover>
                    </HStack>
                    <Text color="muted" fontSize="xs">
                      {storageHelperText}
                    </Text>
                  </Stack>

                  <HStack spacing={2} alignSelf={['stretch', 'auto']}>
                    <Button
                      size="sm"
                      variant="ghost"
                      leftIcon={<UploadIcon boxSize="4" />}
                      onClick={handleOpenAttachmentPicker}
                    >
                      {t('Add images')}
                    </Button>
                    <Tooltip
                      label={t('Enter sends. Shift+Enter adds a new line.')}
                    >
                      <IconButton
                        aria-label={t('Send message')}
                        icon={<SendIcon boxSize="4" />}
                        colorScheme="blue"
                        borderRadius="full"
                        onClick={handleSend}
                        isLoading={isSending}
                        isDisabled={
                          (!String(draft || '').trim() &&
                            attachments.length === 0) ||
                          !isRuntimeReady
                        }
                      />
                    </Tooltip>
                  </HStack>
                </Flex>

                {lastError ? <ErrorAlert>{lastError}</ErrorAlert> : null}
              </Stack>
            </Box>
          </Box>
        </Flex>
      </Page>
      <ManagedRuntimeTrustDialog
        isOpen={isManagedRuntimeTrustDialogOpen}
        onClose={closeManagedRuntimeTrustDialog}
        onConfirm={approveManagedRuntimeTrust}
        isLoading={isStartingRuntime}
        title={t('Trust managed on-device AI')}
        confirmLabel={t('Trust and start')}
        runtimeName={getManagedLocalRuntimeName(t, managedRuntimeTrustFamily)}
        extraNote={getManagedLocalRuntimeTrustNote(
          t,
          managedRuntimeTrustFamily
        )}
      />
    </Layout>
  )
}
