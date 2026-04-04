import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react'
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
  getAdversarialImage,
  protectFlipImage,
} from '../../screens/flips/utils'
import {Step} from '../../screens/flips/types'
import {
  IconButton2,
  SecondaryButton,
  PrimaryButton,
} from '../../shared/components/button'
import {
  Toast,
  Page,
  Input,
  Select,
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
import {areEqual, areEqualExceptOne, shuffle} from '../../shared/utils/arr'
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

const CUSTOM_MODEL_OPTION = '__custom_model__'

const REASONING_MODEL_PRESETS = {
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
    'gpt-4.1',
    'gpt-4.1-mini',
    'gpt-4o',
    'gpt-4o-mini',
    'o4-mini',
  ],
  gemini: [
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-pro',
    'gemini-1.5-flash',
  ],
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

const IMAGE_MODEL_PRESETS = {
  openai: ['gpt-image-1-mini', 'gpt-image-1.5', 'gpt-image-1'],
  'openai-compatible': ['gpt-image-1-mini', 'gpt-image-1.5', 'gpt-image-1'],
  gemini: ['gemini-2.5-flash-image', 'gemini-2.0-flash-exp-image-generation'],
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

// OpenAI image-generation pricing snapshot (USD per image),
// from OpenAI model docs/pricing pages, checked on 2026-03-30.
const OPENAI_IMAGE_PRICING_USD_PER_IMAGE = {
  'gpt-image-1': {
    '1024x1024': 0.042,
    '1024x1536': 0.063,
    '1536x1024': 0.063,
  },
  'gpt-image-1.5': {
    '1024x1024': 0.034,
    '1024x1536': 0.05,
    '1536x1024': 0.05,
  },
  'gpt-image-1-mini': {
    '1024x1024': 0.011,
    '1024x1536': 0.015,
    '1536x1024': 0.015,
  },
}

const MAX_INLINE_JSON_BYTES = 2 * 1024 * 1024
const JSON_IMPORT_CHUNK_SIZE = 8
const IDENA_PANEL_WIDTH = 440
const IDENA_PANEL_HEIGHT = 330
const IDENA_COMPOSITE_WIDTH = IDENA_PANEL_WIDTH * 2
const IDENA_COMPOSITE_HEIGHT = IDENA_PANEL_HEIGHT * 2
const DEFAULT_AI_IMAGE_SIZE = '1024x1024'
const MAX_SUBMIT_PANEL_DATA_URL_LENGTH = 130000

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

function normalizeImageModelForPricing(model) {
  const normalized = String(model || '')
    .trim()
    .toLowerCase()
  if (!normalized) return 'gpt-image-1'
  if (normalized.includes('gpt-image-1-mini')) return 'gpt-image-1-mini'
  if (normalized.includes('gpt-image-1.5')) return 'gpt-image-1.5'
  if (normalized.includes('gpt-image-1')) return 'gpt-image-1'
  return null
}

function isValidShuffleOrder(originalOrder, nextOrder, adversarialImageId) {
  return (
    !areEqual(originalOrder, nextOrder) &&
    !areEqualExceptOne(originalOrder, nextOrder, adversarialImageId)
  )
}

function buildValidShuffleOrder(order, originalOrder, adversarialImageId) {
  const workingOrder = Array.isArray(order) ? order.slice() : []
  if (workingOrder.length < 2) {
    return workingOrder
  }

  for (let attempt = 0; attempt < 32; attempt += 1) {
    const candidate = shuffle(workingOrder.slice())
    if (isValidShuffleOrder(originalOrder, candidate, adversarialImageId)) {
      return candidate
    }
  }

  for (let offset = 1; offset < workingOrder.length; offset += 1) {
    const candidate = workingOrder.map(
      (_, index) => workingOrder[(index + offset) % workingOrder.length]
    )
    if (isValidShuffleOrder(originalOrder, candidate, adversarialImageId)) {
      return candidate
    }
  }

  return workingOrder
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

function extractPanelDataUrl(panel) {
  if (typeof panel === 'string') {
    return panel.trim()
  }
  if (panel && typeof panel.imageDataUrl === 'string') {
    return panel.imageDataUrl.trim()
  }
  return ''
}

function loadDataImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new window.Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Unable to decode generated image'))
    image.src = dataUrl
  })
}

function drawImageCover(ctx, image, targetWidth, targetHeight) {
  const sourceWidth = image.naturalWidth || image.width
  const sourceHeight = image.naturalHeight || image.height
  if (!sourceWidth || !sourceHeight) {
    return false
  }
  const sourceRatio = sourceWidth / sourceHeight
  const targetRatio = targetWidth / targetHeight
  let cropWidth = sourceWidth
  let cropHeight = sourceHeight
  let cropX = 0
  let cropY = 0

  if (sourceRatio > targetRatio) {
    cropWidth = Math.round(sourceHeight * targetRatio)
    cropX = Math.max(0, Math.floor((sourceWidth - cropWidth) / 2))
  } else if (sourceRatio < targetRatio) {
    cropHeight = Math.round(sourceWidth / targetRatio)
    cropY = Math.max(0, Math.floor((sourceHeight - cropHeight) / 2))
  }

  ctx.drawImage(
    image,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    0,
    0,
    targetWidth,
    targetHeight
  )
  return true
}

function encodeJpegWithBudget(
  canvas,
  maxLength = MAX_SUBMIT_PANEL_DATA_URL_LENGTH
) {
  const qualitySteps = [0.9, 0.82, 0.74, 0.66, 0.58, 0.5, 0.42]
  let fallback = ''
  for (const quality of qualitySteps) {
    const encoded = canvas.toDataURL('image/jpeg', quality)
    fallback = encoded
    if (encoded.length <= maxLength) {
      return encoded
    }
  }
  return fallback
}

async function compressPanelForSubmit(dataUrl) {
  const image = await loadDataImage(dataUrl)
  const firstPass = document.createElement('canvas')
  firstPass.width = IDENA_PANEL_WIDTH
  firstPass.height = IDENA_PANEL_HEIGHT
  const firstCtx = firstPass.getContext('2d')
  firstCtx.clearRect(0, 0, firstPass.width, firstPass.height)
  if (!drawImageCover(firstCtx, image, firstPass.width, firstPass.height)) {
    throw new Error('Generated panel has invalid dimensions')
  }

  const firstEncoded = encodeJpegWithBudget(firstPass)
  if (firstEncoded.length <= MAX_SUBMIT_PANEL_DATA_URL_LENGTH) {
    return firstEncoded
  }

  const fallback = document.createElement('canvas')
  fallback.width = 320
  fallback.height = 240
  const fallbackCtx = fallback.getContext('2d')
  fallbackCtx.clearRect(0, 0, fallback.width, fallback.height)
  if (!drawImageCover(fallbackCtx, image, fallback.width, fallback.height)) {
    throw new Error('Generated panel has invalid dimensions')
  }

  return encodeJpegWithBudget(fallback, 115000)
}

async function compressPanelsForSubmit(images) {
  const source = Array.isArray(images) ? images.slice(0, 4) : []
  return Promise.all(
    source.map(async (imageDataUrl) => {
      const value = String(imageDataUrl || '').trim()
      if (!value.startsWith('data:')) return value
      return compressPanelForSubmit(value)
    })
  )
}

function pickSubmitImageSource(flip = {}) {
  const protectedImages = Array.isArray(flip.protectedImages)
    ? flip.protectedImages.slice(0, 4)
    : []
  if (protectedImages.some((item) => Boolean(String(item || '').trim()))) {
    return protectedImages
  }
  return Array.isArray(flip.images) ? flip.images.slice(0, 4) : []
}

async function prepareFlipForSubmit(flip = {}) {
  const sourceImages = pickSubmitImageSource(flip)
  const protectedImages = await compressPanelsForSubmit(sourceImages)
  return {
    ...flip,
    protectedImages,
  }
}

async function normalizePanelForBuilder(dataUrl) {
  const image = await loadDataImage(dataUrl)
  const sourceWidth = image.naturalWidth || image.width
  const sourceHeight = image.naturalHeight || image.height
  if (!sourceWidth || !sourceHeight) {
    throw new Error('Generated panel has invalid dimensions')
  }

  const canvas = document.createElement('canvas')
  canvas.width = IDENA_PANEL_WIDTH
  canvas.height = IDENA_PANEL_HEIGHT
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  // Keep the center area and fill the target panel size exactly.
  const sourceRatio = sourceWidth / sourceHeight
  const targetRatio = IDENA_PANEL_WIDTH / IDENA_PANEL_HEIGHT
  let cropWidth = sourceWidth
  let cropHeight = sourceHeight
  let cropX = 0
  let cropY = 0

  if (sourceRatio > targetRatio) {
    cropWidth = Math.round(sourceHeight * targetRatio)
    cropX = Math.max(0, Math.floor((sourceWidth - cropWidth) / 2))
  } else if (sourceRatio < targetRatio) {
    cropHeight = Math.round(sourceWidth / targetRatio)
    cropY = Math.max(0, Math.floor((sourceHeight - cropHeight) / 2))
  }

  ctx.drawImage(
    image,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    0,
    0,
    IDENA_PANEL_WIDTH,
    IDENA_PANEL_HEIGHT
  )

  return canvas.toDataURL('image/png')
}

async function splitCompositeIntoPanels(dataUrl) {
  const image = await loadDataImage(dataUrl)
  const sourceWidth = image.naturalWidth || image.width
  const sourceHeight = image.naturalHeight || image.height
  if (!sourceWidth || !sourceHeight) {
    throw new Error('Generated composite image has invalid dimensions')
  }

  const normalizedCompositeCanvas = document.createElement('canvas')
  normalizedCompositeCanvas.width = IDENA_COMPOSITE_WIDTH
  normalizedCompositeCanvas.height = IDENA_COMPOSITE_HEIGHT
  const compositeCtx = normalizedCompositeCanvas.getContext('2d')

  const sourceRatio = sourceWidth / sourceHeight
  const targetRatio = IDENA_COMPOSITE_WIDTH / IDENA_COMPOSITE_HEIGHT
  let cropWidth = sourceWidth
  let cropHeight = sourceHeight
  let cropX = 0
  let cropY = 0

  if (sourceRatio > targetRatio) {
    cropWidth = Math.round(sourceHeight * targetRatio)
    cropX = Math.max(0, Math.floor((sourceWidth - cropWidth) / 2))
  } else if (sourceRatio < targetRatio) {
    cropHeight = Math.round(sourceWidth / targetRatio)
    cropY = Math.max(0, Math.floor((sourceHeight - cropHeight) / 2))
  }

  compositeCtx.drawImage(
    image,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    0,
    0,
    IDENA_COMPOSITE_WIDTH,
    IDENA_COMPOSITE_HEIGHT
  )

  const panels = []
  for (let row = 0; row < 2; row += 1) {
    for (let col = 0; col < 2; col += 1) {
      const panelCanvas = document.createElement('canvas')
      panelCanvas.width = IDENA_PANEL_WIDTH
      panelCanvas.height = IDENA_PANEL_HEIGHT
      const panelCtx = panelCanvas.getContext('2d')
      panelCtx.drawImage(
        normalizedCompositeCanvas,
        col * IDENA_PANEL_WIDTH,
        row * IDENA_PANEL_HEIGHT,
        IDENA_PANEL_WIDTH,
        IDENA_PANEL_HEIGHT,
        0,
        0,
        IDENA_PANEL_WIDTH,
        IDENA_PANEL_HEIGHT
      )
      panels.push(panelCanvas.toDataURL('image/png'))
    }
  }

  return panels
}

async function normalizeGeneratedPanelsForBuilder(rawPanels) {
  const list = Array.isArray(rawPanels) ? rawPanels.slice(0, 4) : []
  if (!list.length) {
    throw new Error('Generated flip must contain image panels')
  }

  if (list.length === 1) {
    const compositeDataUrl = extractPanelDataUrl(list[0])
    if (!compositeDataUrl.startsWith('data:')) {
      throw new Error('Generated composite image is missing')
    }
    return splitCompositeIntoPanels(compositeDataUrl)
  }

  if (list.length < 4) {
    throw new Error('Generated flip must contain 4 panels')
  }

  return Promise.all(
    list.slice(0, 4).map(async (panel, index) => {
      const imageDataUrl = extractPanelDataUrl(panel)
      if (!imageDataUrl.startsWith('data:')) {
        throw new Error(`Panel ${index + 1} image is missing`)
      }
      return normalizePanelForBuilder(imageDataUrl)
    })
  )
}

async function buildCompositeNoiseFromPanels(panels) {
  const sources = (Array.isArray(panels) ? panels : [])
    .map((panel) => String(panel || '').trim())
    .filter((panel) => panel.startsWith('data:'))
    .slice(0, 4)

  if (!sources.length) {
    return ''
  }

  const loaded = await Promise.all(
    sources.map(
      (src) =>
        new Promise((resolve) => {
          const image = new Image()
          image.onload = () => resolve(image)
          image.onerror = () => resolve(null)
          image.src = src
        })
    )
  )
  const images = loaded.filter(Boolean)
  if (!images.length) {
    return ''
  }

  const canvas = document.createElement('canvas')
  canvas.width = IDENA_PANEL_WIDTH
  canvas.height = IDENA_PANEL_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return ''
  }

  const cols = 4
  const rows = 3
  const tileW = Math.ceil(IDENA_PANEL_WIDTH / cols)
  const tileH = Math.ceil(IDENA_PANEL_HEIGHT / rows)

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const source = images[Math.floor(Math.random() * images.length)]
      if (source) {
        const sw = Math.max(
          40,
          Math.floor(source.width * (0.2 + Math.random() * 0.45))
        )
        const sh = Math.max(
          40,
          Math.floor(source.height * (0.2 + Math.random() * 0.45))
        )
        const sxMax = Math.max(0, source.width - sw)
        const syMax = Math.max(0, source.height - sh)
        const sx = sxMax > 0 ? Math.floor(Math.random() * sxMax) : 0
        const sy = syMax > 0 ? Math.floor(Math.random() * syMax) : 0
        const dx = col * tileW
        const dy = row * tileH

        ctx.globalAlpha = 0.95
        ctx.drawImage(source, sx, sy, sw, sh, dx, dy, tileW, tileH)
      }
    }
  }

  ctx.globalAlpha = 1
  return canvas.toDataURL('image/png')
}

async function applyLegacyNoiseToPanel(panels, noisePanelIndex) {
  const nextPanels = Array.isArray(panels) ? panels.slice(0, 4) : []
  const parsedNoiseIndex = Number(noisePanelIndex)
  if (!Number.isFinite(parsedNoiseIndex)) {
    return {
      panels: nextPanels,
      applied: false,
      noisePanelIndex: null,
      error: '',
    }
  }
  const targetIndex = Math.max(0, Math.min(3, Math.trunc(parsedNoiseIndex)))
  const sourcePanel = String(nextPanels[targetIndex] || '').trim()
  if (!sourcePanel.startsWith('data:')) {
    return {
      panels: nextPanels,
      applied: false,
      noisePanelIndex: targetIndex,
      error: '',
    }
  }

  try {
    const noiseCandidates = nextPanels
      .map((panel) => String(panel || '').trim())
      .filter((panel) => panel.startsWith('data:'))
    let adversarialSource = ''
    if (noiseCandidates.length >= 4) {
      adversarialSource = String(
        (await getAdversarialImage(noiseCandidates)) || ''
      ).trim()
    }
    if (!adversarialSource.startsWith('data:')) {
      adversarialSource = await buildCompositeNoiseFromPanels(noiseCandidates)
    }
    if (!String(adversarialSource || '').startsWith('data:')) {
      throw new Error('Unable to compose legacy adversarial noise image')
    }
    const noisyPanel = await protectFlipImage(adversarialSource)
    const normalizedNoisyPanel = await normalizePanelForBuilder(noisyPanel)
    nextPanels[targetIndex] = normalizedNoisyPanel
    return {
      panels: nextPanels,
      applied: true,
      noisePanelIndex: targetIndex,
      error: '',
    }
  } catch (error) {
    return {
      panels: nextPanels,
      applied: false,
      noisePanelIndex: targetIndex,
      error: String((error && error.message) || error || '').trim(),
    }
  }
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

  if (
    /timeout of \d+ms exceeded/i.test(message) ||
    /timed out after retries/i.test(message)
  ) {
    return 'Image generation timed out. Retry once, or switch to a faster/cheaper image model (for example gpt-image-1-mini). You can also increase request timeout in AI settings.'
  }

  return message
}

function normalizeKeywordText(item) {
  if (!item) return ''
  if (typeof item === 'string') return item.trim()
  return String(item.name || item.keyword || item.word || '').trim()
}

function keywordPairForPrompt(keywords) {
  const words = Array.isArray(keywords && keywords.words) ? keywords.words : []
  const first = normalizeKeywordText(words[0])
  const second = normalizeKeywordText(words[1])
  return [first, second]
}

function normalizeStoryPanelsInput(value) {
  const source = Array.isArray(value) ? value.slice(0, 4) : []
  while (source.length < 4) {
    source.push('')
  }
  return source.map((item, idx) => {
    const text =
      item && typeof item === 'object'
        ? String(
            item.description ||
              item.text ||
              item.panelText ||
              item.panel_text ||
              item.caption ||
              ''
          )
        : String(item || '')
    const normalized = text.trim().replace(/\s+/g, ' ')
    if (normalized) return normalized
    return `Panel ${idx + 1}: continue story.`
  })
}

function coerceStoryPanelsDraft(value) {
  const source = Array.isArray(value) ? value.slice(0, 4) : []
  while (source.length < 4) {
    source.push('')
  }
  return source.map((item) => {
    if (item && typeof item === 'object') {
      return String(
        item.description ||
          item.text ||
          item.panelText ||
          item.panel_text ||
          item.caption ||
          ''
      )
    }
    return String(item || '')
  })
}

function normalizeStoryOptionFromBackend(item, index) {
  const next = item && typeof item === 'object' ? item : {}
  let complianceSource = {}
  if (
    next.complianceReport &&
    typeof next.complianceReport === 'object' &&
    !Array.isArray(next.complianceReport)
  ) {
    complianceSource = next.complianceReport
  } else if (
    next.compliance_report &&
    typeof next.compliance_report === 'object' &&
    !Array.isArray(next.compliance_report)
  ) {
    complianceSource = next.compliance_report
  }
  const complianceReport = Object.entries(complianceSource).reduce(
    (acc, [key, value]) => {
      const raw = String(value || '')
        .trim()
        .toLowerCase()
      if (raw === 'pass' || raw === 'fail') {
        acc[key] = raw
      } else if (value === true || raw === 'true' || raw === 'ok') {
        acc[key] = 'pass'
      } else if (value === false || raw === 'false') {
        acc[key] = 'fail'
      }
      return acc
    },
    {}
  )
  const failedComplianceKeys = Object.entries(complianceReport)
    .filter(([, status]) => status === 'fail')
    .map(([key]) => key)
  let riskSource = []
  if (Array.isArray(next.riskFlags)) {
    riskSource = next.riskFlags
  } else if (Array.isArray(next.risk_flags)) {
    riskSource = next.risk_flags
  }
  const riskFlags = riskSource
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .slice(0, 3)
  let qualityReport = null
  if (next.qualityReport && typeof next.qualityReport === 'object') {
    qualityReport = next.qualityReport
  } else if (next.quality_report && typeof next.quality_report === 'object') {
    qualityReport = next.quality_report
  }
  const qualityFailures =
    qualityReport && Array.isArray(qualityReport.failures)
      ? qualityReport.failures.map((failure) => String(failure || '').trim())
      : []
  const qualityScore =
    qualityReport && Number.isFinite(Number(qualityReport.score))
      ? Number(qualityReport.score)
      : null
  const isStoryboardStarter = Boolean(
    next.isStoryboardStarter || next.is_storyboard_starter
  )
  const isWeakStoryDraft =
    isStoryboardStarter ||
    failedComplianceKeys.length > 0 ||
    riskFlags.length > 0 ||
    qualityFailures.length > 0

  return {
    id: String(next.id || `option-${index + 1}`),
    title: String(
      next.title ||
        next.final_story_title ||
        next.finalStoryTitle ||
        `Option ${index + 1}`
    ),
    panels: normalizeStoryPanelsInput(next.panels),
    includeNoise: Boolean(next.includeNoise),
    noisePanelIndex:
      Number.isFinite(Number(next.noisePanelIndex)) &&
      Number(next.noisePanelIndex) >= 0 &&
      Number(next.noisePanelIndex) < 4
        ? Number(next.noisePanelIndex)
        : null,
    rationale: String(next.rationale || '').trim(),
    editingTip: String(next.editingTip || next.editing_tip || '').trim(),
    isStoryboardStarter,
    isWeakStoryDraft,
    storySummary: String(next.storySummary || next.story_summary || '').trim(),
    complianceReport,
    failedComplianceKeys,
    riskFlags,
    qualityScore,
    qualityFailures,
    revisionIfRisky: String(
      next.revisionIfRisky || next.revision_if_risky || ''
    ).trim(),
    senseSelection: (() => {
      if (next.senseSelection && typeof next.senseSelection === 'object') {
        return next.senseSelection
      }
      if (next.sense_selection && typeof next.sense_selection === 'object') {
        return next.sense_selection
      }
      if (next.semanticLock && typeof next.semanticLock === 'object') {
        return next.semanticLock
      }
      if (next.semantic_lock && typeof next.semantic_lock === 'object') {
        return next.semantic_lock
      }
      return null
    })(),
  }
}

function getStoryDraftReview(option) {
  const next = option && typeof option === 'object' ? option : {}
  if (next.isStoryboardStarter) {
    return {
      kind: 'starter',
      label: 'Weak draft',
      description:
        'Readable starting point, but you should rewrite it or run Optimize before building images.',
    }
  }
  if (next.isWeakStoryDraft) {
    return {
      kind: 'review',
      label: 'Needs review',
      description:
        'Usable draft, but check the trigger, consequence, and final aftermath before building images.',
    }
  }
  return {
    kind: 'strong',
    label: 'Ready to edit',
    description:
      'Looks usable as a base draft. You can still personalize the 4 panels before building.',
  }
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
  const didAutostepSubmitRef = useRef(false)
  const pendingSubmitStepOpenRef = useRef(false)
  const didAutoOpenAiGuideRef = useRef(false)
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
  const [showGlobalJsonTools, setShowGlobalJsonTools] = useState(false)
  const [showBenchmarkAdvanced, setShowBenchmarkAdvanced] = useState(false)
  const [isGeneratingStoryOptions, setIsGeneratingStoryOptions] =
    useState(false)
  const [storyOptions, setStoryOptions] = useState([])
  const [selectedStoryId, setSelectedStoryId] = useState('')
  const [storyOptionCount, setStoryOptionCount] = useState(1)
  const [aiProviderKeyStatus, setAiProviderKeyStatus] = useState({
    checked: false,
    hasKey: false,
    provider: '',
  })
  const [showAiGuideDetails, setShowAiGuideDetails] = useState(false)
  const [storyPanelsDraft, setStoryPanelsDraft] = useState(
    coerceStoryPanelsDraft([])
  )
  const [storyIncludeNoise, setStoryIncludeNoise] = useState(false)
  const [storyNoisePanelIndex, setStoryNoisePanelIndex] = useState(0)
  const [isGeneratingFlipPanels, setIsGeneratingFlipPanels] = useState(false)
  const [generatedFlipPanels, setGeneratedFlipPanels] = useState([])
  const [flipBuildStatus, setFlipBuildStatus] = useState({
    kind: 'idle',
    message: '',
  })
  const [aiReasoningModel, setAiReasoningModel] = useState('')
  const [aiImageModel, setAiImageModel] = useState('gpt-image-1-mini')
  const [aiImageSize, setAiImageSize] = useState(DEFAULT_AI_IMAGE_SIZE)
  const [aiGenerationMode, setAiGenerationMode] = useState('fast')
  const [aiImageStyle, setAiImageStyle] = useState(
    'Single-panel cartoon illustration, flat bright colors, clean line art, consistent environment.'
  )
  const [generationCostLedger, setGenerationCostLedger] = useState([])
  const benchmarkSessionDisclosure = useDisclosure()
  const aiGuideDisclosure = useDisclosure()

  const aiSolverSettings = useMemo(
    () => ({...DEFAULT_AI_SOLVER_SETTINGS, ...(settings.aiSolver || {})}),
    [settings.aiSolver]
  )
  const isLegacyOnlyMode =
    aiSolverSettings.legacyHeuristicEnabled &&
    aiSolverSettings.legacyHeuristicOnly

  useEffect(() => {
    let cancelled = false

    async function loadProviderKeyStatus() {
      if (
        isLegacyOnlyMode ||
        !global.aiSolver ||
        typeof global.aiSolver.hasProviderKey !== 'function'
      ) {
        if (!cancelled) {
          setAiProviderKeyStatus({
            checked: true,
            hasKey: true,
            provider: String(aiSolverSettings.provider || ''),
          })
        }
        return
      }

      try {
        const state = await global.aiSolver.hasProviderKey({
          provider: aiSolverSettings.provider,
        })
        if (!cancelled) {
          setAiProviderKeyStatus({
            checked: true,
            hasKey: Boolean(state && state.hasKey),
            provider: String(
              (state && state.provider) || aiSolverSettings.provider || ''
            ),
          })
        }
      } catch (error) {
        if (!cancelled) {
          setAiProviderKeyStatus({
            checked: true,
            hasKey: false,
            provider: String(aiSolverSettings.provider || ''),
          })
        }
      }
    }

    loadProviderKeyStatus()

    return () => {
      cancelled = true
    }
  }, [aiSolverSettings.provider, isLegacyOnlyMode])

  useEffect(() => {
    if (didAutoOpenAiGuideRef.current) return
    if (!aiProviderKeyStatus.checked) return
    if (typeof window === 'undefined') return

    const dismissed = window.localStorage.getItem(
      'idenaAiBenchmarkGuideDismissedV1'
    )
    const shouldAutoOpen =
      router.query?.focus === 'ai-benchmark' ||
      dismissed !== '1' ||
      !aiSolverSettings.enabled ||
      !aiProviderKeyStatus.hasKey

    if (shouldAutoOpen) {
      aiGuideDisclosure.onOpen()
      didAutoOpenAiGuideRef.current = true
    }
  }, [
    aiGuideDisclosure,
    aiProviderKeyStatus.checked,
    aiProviderKeyStatus.hasKey,
    aiSolverSettings.enabled,
    router.query,
  ])

  useEffect(() => {
    if (!String(aiReasoningModel || '').trim()) {
      setAiReasoningModel(String(aiSolverSettings.model || 'gpt-4.1-mini'))
    }
  }, [aiReasoningModel, aiSolverSettings.model])

  const reasoningModelOptions = useMemo(() => {
    const provider = String(aiSolverSettings.provider || 'openai')
      .trim()
      .toLowerCase()
    const base = Array.isArray(REASONING_MODEL_PRESETS[provider])
      ? REASONING_MODEL_PRESETS[provider]
      : []
    const merged = [
      ...base,
      String(aiSolverSettings.model || '').trim(),
      String(aiReasoningModel || '').trim(),
    ]
      .map((item) => String(item || '').trim())
      .filter(Boolean)
    return Array.from(new Set(merged))
  }, [aiReasoningModel, aiSolverSettings.model, aiSolverSettings.provider])

  const imageModelOptions = useMemo(() => {
    const provider = String(aiSolverSettings.provider || 'openai')
      .trim()
      .toLowerCase()
    const base = Array.isArray(IMAGE_MODEL_PRESETS[provider])
      ? IMAGE_MODEL_PRESETS[provider]
      : IMAGE_MODEL_PRESETS.openai
    const merged = [...base, String(aiImageModel || '').trim()]
      .map((item) => String(item || '').trim())
      .filter(Boolean)
    return Array.from(new Set(merged))
  }, [aiImageModel, aiSolverSettings.provider])

  const currentReasoningModel = String(
    aiReasoningModel || aiSolverSettings.model || ''
  ).trim()
  const currentImageModel = String(aiImageModel || '').trim()

  const reasoningSelectValue = reasoningModelOptions.includes(
    currentReasoningModel
  )
    ? currentReasoningModel
    : CUSTOM_MODEL_OPTION

  const imageSelectValue = imageModelOptions.includes(currentImageModel)
    ? currentImageModel
    : CUSTOM_MODEL_OPTION
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

  const generationTotals = useMemo(() => {
    const totals = generationCostLedger.reduce(
      (acc, item) => ({
        estimatedUsd:
          acc.estimatedUsd +
          (Number.isFinite(Number(item.estimatedUsd))
            ? Number(item.estimatedUsd)
            : 0),
        actualUsd:
          acc.actualUsd +
          (Number.isFinite(Number(item.actualUsd))
            ? Number(item.actualUsd)
            : 0),
        promptTokens:
          acc.promptTokens +
          (Number(item.tokenUsage && item.tokenUsage.promptTokens) || 0),
        completionTokens:
          acc.completionTokens +
          (Number(item.tokenUsage && item.tokenUsage.completionTokens) || 0),
        totalTokens:
          acc.totalTokens +
          (Number(item.tokenUsage && item.tokenUsage.totalTokens) || 0),
      }),
      {
        estimatedUsd: 0,
        actualUsd: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      }
    )

    return {
      ...totals,
      count: generationCostLedger.length,
    }
  }, [generationCostLedger])

  const aiImageGenerationCostHint = useMemo(() => {
    const normalizedSize = String(aiImageSize || '').trim()
    const pricingModel = normalizeImageModelForPricing(aiImageModel)
    if (!pricingModel) {
      return null
    }
    const pricingBySize = OPENAI_IMAGE_PRICING_USD_PER_IMAGE[pricingModel]
    const unitUsd = pricingBySize && pricingBySize[normalizedSize]
    if (!Number.isFinite(unitUsd)) {
      return null
    }
    const cheapestEntry = Object.entries(pricingBySize).sort(
      (a, b) => Number(a[1]) - Number(b[1])
    )[0]
    return {
      model: pricingModel,
      unitUsd,
      fourPanelsUsd: unitUsd * 4,
      cheapestSize: cheapestEntry ? cheapestEntry[0] : normalizedSize,
      cheapestUnitUsd: cheapestEntry ? Number(cheapestEntry[1]) : unitUsd,
    }
  }, [aiImageModel, aiImageSize])

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
            keywordSource: 'node',
            keywordPairId: 0,
            availableKeywords: [],
            nodeAvailableKeywords: [],
            didShowBadFlip,
          }

        const persistedFlips = global.flipStore?.getFlips()

        // eslint-disable-next-line no-shadow
        const availableKeywords = flipKeyWordPairs.filter(
          ({id, used}) => !used && !isPendingKeywordPair(persistedFlips, id)
        )

        if (!availableKeywords.length) {
          return {
            keywordSource: 'node',
            keywordPairId: 0,
            availableKeywords: [],
            nodeAvailableKeywords: [],
            didShowBadFlip,
          }
        }

        // eslint-disable-next-line no-shadow
        const [{id: keywordPairId}] = availableKeywords

        return {
          keywordSource: 'node',
          keywordPairId,
          availableKeywords,
          nodeAvailableKeywords: availableKeywords,
          didShowBadFlip,
        }
      },
      protectFlip: async (flip) => ({
        protectedImages: await compressPanelsForSubmit(
          Array.isArray(flip.images) ? flip.images : Array.from({length: 4})
        ),
        adversarialImage: '',
      }),
      loadAdversarial: async () => Promise.resolve(),
      shuffleAdversarial: async (flip) =>
        Promise.resolve({
          order: Array.isArray(flip.originalOrder)
            ? flip.originalOrder.slice()
            : [0, 1, 2, 3],
        }),
      submitFlip: async (flip) => publishFlip(await prepareFlipForSubmit(flip)),
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

  const [keywordA, keywordB] = useMemo(
    () => keywordPairForPrompt(keywords),
    [keywords]
  )
  const keywordSource = String(current.context.keywordSource || 'node')
    .trim()
    .toLowerCase()
  const isRandomKeywordSource = keywordSource === 'random'
  const hasUsableKeywords = useMemo(() => {
    const words = Array.isArray(keywords && keywords.words)
      ? keywords.words.slice(0, 2)
      : []
    return (
      words.length === 2 &&
      words.every((word) =>
        Boolean(String((word && (word.name || word.word)) || '').trim())
      )
    )
  }, [keywords])

  const flipNeedsShuffle = useMemo(
    () =>
      areEqual(order, originalOrder) ||
      areEqualExceptOne(originalOrder, order, adversarialImageId),
    [adversarialImageId, order, originalOrder]
  )

  const draftImages = useMemo(
    () => images.map((image, idx) => protectedImages[idx] || image),
    [images, protectedImages]
  )

  const not = (state) => !current.matches({editing: state})
  const is = (state) => current.matches({editing: state})
  const either = (...states) =>
    eitherState(current, ...states.map((s) => ({editing: s})))

  const openSubmitStepWithKeywordFallback = useCallback(() => {
    if (hasUsableKeywords) {
      send('PICK_SUBMIT')
      return
    }
    pendingSubmitStepOpenRef.current = true
    send('PICK_KEYWORDS')
  }, [hasUsableKeywords, send])

  const approveRandomKeywordsForSubmit = useCallback(() => {
    pendingSubmitStepOpenRef.current = true
    send('USE_RANDOM_KEYWORDS')
  }, [send])

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

  const shuffleDraftForSubmit = useCallback(async () => {
    send('PICK_SHUFFLE')
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })
    const targetOrder = buildValidShuffleOrder(
      order,
      originalOrder,
      adversarialImageId
    )
    send('MANUAL_SHUFFLE', {order: targetOrder})
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })
    send('PICK_SUBMIT')
  }, [adversarialImageId, order, originalOrder, send])

  const ensureAiSolverBridge = () => {
    if (!global.aiSolver) {
      throw new Error('AI solver bridge is not available in this build')
    }
  }

  const closeAiGuide = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('idenaAiBenchmarkGuideDismissedV1', '1')
    }
    aiGuideDisclosure.onClose()
  }

  const applyStoryOptionToDraft = (option) => {
    const next = option && typeof option === 'object' ? option : null
    if (!next) return
    setSelectedStoryId(next.id)
    setStoryPanelsDraft(normalizeStoryPanelsInput(next.panels))
    setStoryIncludeNoise(Boolean(next.includeNoise))
    if (next.includeNoise) {
      if (Number.isFinite(Number(next.noisePanelIndex))) {
        setStoryNoisePanelIndex(Number(next.noisePanelIndex))
      }
    }
  }

  const ensureAiRunReady = async ({requireEnabled = false} = {}) => {
    ensureAiSolverBridge()

    // Manual benchmark runs in the flip builder should work even if
    // auto-session AI helper is disabled in global settings.
    if (requireEnabled && !aiSolverSettings.enabled) {
      throw new Error('AI helper is disabled')
    }

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

  const appendGenerationLedger = ({
    action,
    provider,
    model,
    tokenUsage,
    estimatedUsd,
    actualUsd,
  }) => {
    setGenerationCostLedger((prev) =>
      [
        {
          id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
          time: new Date().toISOString(),
          action: String(action || 'unknown'),
          provider: String(provider || aiSolverSettings.provider),
          model: String(model || aiReasoningModel || aiSolverSettings.model),
          tokenUsage: tokenUsage || null,
          estimatedUsd:
            Number.isFinite(Number(estimatedUsd)) && Number(estimatedUsd) >= 0
              ? Number(estimatedUsd)
              : null,
          actualUsd:
            Number.isFinite(Number(actualUsd)) && Number(actualUsd) >= 0
              ? Number(actualUsd)
              : null,
        },
      ]
        .concat(prev)
        .slice(0, 30)
    )
  }

  const generateStoryAlternatives = async ({
    optimize = false,
    basePanels = null,
  } = {}) => {
    setIsGeneratingStoryOptions(true)
    try {
      await ensureAiRunReady()
      ensureAiSolverBridge()

      const reasoningModel = String(
        aiReasoningModel || aiSolverSettings.model
      ).trim()
      const isFastMode = aiGenerationMode !== 'strict'
      let storyTemperature = 0.72
      if (isFastMode && optimize) {
        storyTemperature = 0.82
      } else if (!isFastMode && !optimize) {
        storyTemperature = 0.8
      } else if (!isFastMode && optimize) {
        storyTemperature = 0.9
      }
      const seededPanels =
        optimize && Array.isArray(basePanels) && basePanels.length > 0
          ? normalizeStoryPanelsInput(basePanels)
          : storyPanelsDraft

      const response = await global.aiSolver.generateStoryOptions({
        ...baseRunPayload,
        fastStoryMode: isFastMode,
        provider: aiSolverSettings.provider,
        model: reasoningModel,
        storyOptionCount,
        keywords: [keywordA, keywordB],
        includeNoise: storyIncludeNoise,
        noisePanelIndex: storyNoisePanelIndex,
        customStoryPanels: seededPanels,
        hasCustomStory: optimize,
        maxOutputTokens: Math.max(
          300,
          toInt(aiSolverSettings.maxOutputTokens, 120)
        ),
        temperature: storyTemperature,
      })

      const options = Array.isArray(response && response.stories)
        ? response.stories.map((item, index) =>
            normalizeStoryOptionFromBackend(item, index)
          )
        : []

      if (!options.length) {
        throw new Error('Story generation returned no options')
      }

      setStoryOptions(options)
      const defaultSelected = options[0]
      if (defaultSelected) {
        applyStoryOptionToDraft(defaultSelected)
        if (!optimize) {
          setStoryIncludeNoise(Boolean(defaultSelected.includeNoise))
          setStoryNoisePanelIndex(
            Number.isFinite(Number(defaultSelected.noisePanelIndex))
              ? Number(defaultSelected.noisePanelIndex)
              : storyNoisePanelIndex
          )
        }
      }

      appendGenerationLedger({
        action: optimize ? 'story_optimize' : 'story_generate',
        provider: response.provider,
        model: response.model,
        tokenUsage: response.tokenUsage,
        estimatedUsd:
          response.costs && Number.isFinite(Number(response.costs.estimatedUsd))
            ? Number(response.costs.estimatedUsd)
            : null,
        actualUsd:
          response.costs && Number.isFinite(Number(response.costs.actualUsd))
            ? Number(response.costs.actualUsd)
            : null,
      })

      const fallbackStorySeed = options.some((item) => item.isStoryboardStarter)
      const fallbackWasUsed = Boolean(
        response && response.metrics && response.metrics.fallback_used
      )
      const weakDraftReturned = options.some((item) => item.isWeakStoryDraft)
      let storyOptionsMessage = t(
        'Choose the better option, customize if needed, then build flip.'
      )
      if (storyOptionCount === 1) {
        storyOptionsMessage = t(
          'Review the story draft, rewrite any weak panel text, then build flip.'
        )
      }
      if (weakDraftReturned && !fallbackStorySeed && !fallbackWasUsed) {
        storyOptionsMessage = t(
          'The AI returned a weak but editable draft. Tighten the place, trigger, and aftermath yourself or run Optimize story further.'
        )
      }
      if (fallbackStorySeed || fallbackWasUsed) {
        storyOptionsMessage = t(
          'The AI returned a rough storyboard starter. It is loaded into the panel editor so you can rewrite the place, trigger, and aftermath, or run Optimize story further before building the flip.'
        )
      }

      notify(t('Story options generated'), storyOptionsMessage)
    } catch (error) {
      const message = formatAiRunError(error)
      notify(t('Unable to generate story options'), message, 'error')
      if (/API key missing|AI helper is disabled/i.test(message)) {
        router.push('/settings/ai')
      }
    } finally {
      setIsGeneratingStoryOptions(false)
    }
  }

  const applyGeneratedPanelsToBuilder = async (
    panels,
    {returnToSubmit = false, autoShuffleSubmit = false} = {}
  ) => {
    const normalizedPanels = await normalizeGeneratedPanelsForBuilder(panels)
    const shouldReturnToSubmit = returnToSubmit || is('submit')

    // Ensure CHANGE_IMAGES events are handled by the editor state.
    send('PICK_IMAGES')
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })

    for (let index = 0; index < 4; index += 1) {
      const imageDataUrl = String(normalizedPanels[index] || '').trim()
      // eslint-disable-next-line no-await-in-loop
      await Promise.resolve(
        send('CHANGE_IMAGES', {image: imageDataUrl, currentIndex: index})
      )
    }

    if (shouldReturnToSubmit) {
      if (autoShuffleSubmit) {
        await shuffleDraftForSubmit()
        return
      }
      await new Promise((resolve) => {
        setTimeout(resolve, 0)
      })
      send('PICK_SUBMIT')
    }
  }

  const buildFlipWithAi = async ({regenerateIndices = [0, 1, 2, 3]} = {}) => {
    setIsGeneratingFlipPanels(true)
    setFlipBuildStatus({
      kind: 'running',
      message: t('Building flip panels...'),
    })
    const startedAt = Date.now()
    try {
      await ensureAiRunReady()
      ensureAiSolverBridge()
      const reasoningModel = String(
        aiReasoningModel || aiSolverSettings.model
      ).trim()
      const isFastMode = aiGenerationMode !== 'strict'
      const selectedStoryOption = storyOptions.find(
        (item) => String(item.id) === String(selectedStoryId)
      )

      const response = await global.aiSolver.generateFlipPanels({
        ...baseRunPayload,
        fastBuild: isFastMode,
        provider: aiSolverSettings.provider,
        model: reasoningModel,
        textAuditModel: reasoningModel,
        textAuditEnabled: !isFastMode,
        textAuditMaxRetries: isFastMode ? 0 : 1,
        imageModel: aiImageModel,
        imageSize: aiImageSize,
        imageStyle: '',
        visualStyle: aiImageStyle,
        keywords: [keywordA, keywordB],
        storyPanels: storyPanelsDraft,
        storyOptions,
        selectedStoryId,
        senseSelection:
          selectedStoryOption && selectedStoryOption.senseSelection
            ? selectedStoryOption.senseSelection
            : null,
        includeNoise: storyIncludeNoise,
        noisePanelIndex: storyNoisePanelIndex,
        regenerateIndices,
        existingPanels: generatedFlipPanels.map((item) => item.imageDataUrl),
      })

      const nextPanels = Array.isArray(response && response.panels)
        ? response.panels.slice(0, 4)
        : []
      if (nextPanels.length < 4) {
        throw new Error('Panel generation returned less than 4 panels')
      }
      if (
        response &&
        response.selectedStory &&
        typeof response.selectedStory === 'object'
      ) {
        const nextStoryId = String(response.selectedStory.id || '').trim()
        if (nextStoryId && nextStoryId !== String(selectedStoryId)) {
          setSelectedStoryId(nextStoryId)
        }
        if (Array.isArray(response.selectedStory.panels)) {
          setStoryPanelsDraft(
            normalizeStoryPanelsInput(response.selectedStory.panels)
          )
        }
      }

      const normalizedPanelDataUrls = await normalizeGeneratedPanelsForBuilder(
        nextPanels
      )
      let finalPanelDataUrls = normalizedPanelDataUrls.slice(0, 4)
      const normalizedNoiseIndex = Math.max(
        0,
        Math.min(3, toInt(storyNoisePanelIndex, 0))
      )
      const shouldApplyLegacyNoise =
        storyIncludeNoise && regenerateIndices.includes(normalizedNoiseIndex)
      let noiseApplyResult = {
        applied: false,
        noisePanelIndex: normalizedNoiseIndex,
        error: '',
      }

      if (shouldApplyLegacyNoise) {
        noiseApplyResult = await applyLegacyNoiseToPanel(
          finalPanelDataUrls,
          normalizedNoiseIndex
        )
        finalPanelDataUrls = noiseApplyResult.panels
        if (noiseApplyResult.error) {
          notify(
            t('Noise post-process failed'),
            noiseApplyResult.error,
            'warning'
          )
        }
      }

      setGeneratedFlipPanels(
        finalPanelDataUrls.map((imageDataUrl, index) => ({
          ...(typeof nextPanels[index] === 'object' ? nextPanels[index] : {}),
          index,
          imageDataUrl,
          legacyNoiseApplied:
            Boolean(noiseApplyResult.applied) &&
            index === Number(noiseApplyResult.noisePanelIndex),
        }))
      )

      // Make generated result immediately visible in the regular builder draft.
      // Keep user in submit step when this action was triggered there.
      await applyGeneratedPanelsToBuilder(finalPanelDataUrls, {
        returnToSubmit: true,
        autoShuffleSubmit: true,
      })

      if (
        noiseApplyResult.applied &&
        Number.isFinite(Number(noiseApplyResult.noisePanelIndex))
      ) {
        setStoryNoisePanelIndex(Number(noiseApplyResult.noisePanelIndex))
      } else if (
        response.includeNoise &&
        Number.isFinite(Number(response.noisePanelIndex))
      ) {
        setStoryNoisePanelIndex(Number(response.noisePanelIndex))
      }

      appendGenerationLedger({
        action:
          regenerateIndices.length === 4
            ? 'flip_build'
            : `flip_regenerate_${regenerateIndices.join('_')}`,
        provider: response.provider,
        model: response.imageModel || response.model,
        tokenUsage: response.tokenUsage,
        estimatedUsd:
          response.costs && Number.isFinite(Number(response.costs.estimatedUsd))
            ? Number(response.costs.estimatedUsd)
            : null,
        actualUsd:
          response.costs && Number.isFinite(Number(response.costs.actualUsd))
            ? Number(response.costs.actualUsd)
            : null,
      })

      const textAuditItems = Array.isArray(response.textAuditByPanel)
        ? response.textAuditByPanel
        : []
      const textAuditFailed = textAuditItems.filter(
        (item) => item && item.checked && item.hasText
      )
      const textAuditRetried = Math.max(
        0,
        Number(response.textOverlayRetryCount) || 0
      )

      notify(
        t('Flip panels generated'),
        noiseApplyResult.applied
          ? t(
              'Panels were applied and shuffled for submit. Legacy adversarial image noise was applied to panel {{panel}}. You can still reshuffle or regenerate panels.',
              {panel: Number(noiseApplyResult.noisePanelIndex) + 1}
            )
          : t(
              'Panels were applied and shuffled for submit. You can still reshuffle or regenerate panels.'
            )
      )
      if (
        response &&
        response.renderFeedback &&
        response.renderFeedback.switchedToAlternativeOption
      ) {
        notify(
          t('Switched to stronger rendered story'),
          t(
            'The original story rendered weakly, so the stronger alternative story option was used for the generated panels.'
          )
        )
      } else if (
        response &&
        response.renderFeedback &&
        response.renderFeedback.verdict === 'replan_story'
      ) {
        notify(
          t('Rendered story looks weak'),
          t(
            'The rendered sequence still looks ambiguous after generation. Consider switching story option or regenerating again.'
          ),
          'warning'
        )
      }
      if (textAuditFailed.length > 0) {
        notify(
          t('Text detected in generated panel'),
          t(
            'One or more panels still contain text after retries. Use "Redo panel" for affected panels before submit.'
          ),
          'warning'
        )
      } else if (textAuditRetried > 0) {
        notify(
          t('Text audit retries applied'),
          t(
            '{{count}} panel retry attempts were used to remove detected text overlays.',
            {count: textAuditRetried}
          )
        )
      }
      const elapsedMs = Math.max(0, Date.now() - startedAt)
      setFlipBuildStatus({
        kind: 'success',
        message:
          textAuditRetried > 0
            ? t(
                'Panels generated and applied to draft ({{elapsed}} ms, text-audit retries: {{retries}}).',
                {
                  elapsed: elapsedMs,
                  retries: textAuditRetried,
                }
              )
            : t('Panels generated and applied to draft ({{elapsed}} ms).', {
                elapsed: elapsedMs,
              }),
      })
    } catch (error) {
      const message = formatAiRunError(error)
      notify(t('Flip generation failed'), message, 'error')
      setFlipBuildStatus({
        kind: 'error',
        message,
      })
      if (/API key missing|AI helper is disabled/i.test(message)) {
        router.push('/settings/ai')
      }
    } finally {
      setIsGeneratingFlipPanels(false)
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
    if (pendingSubmitStepOpenRef.current && hasUsableKeywords) {
      pendingSubmitStepOpenRef.current = false
      send('PICK_SUBMIT')
    }
  }, [hasUsableKeywords, send])

  useEffect(() => {
    if (router.query?.focus === 'ai-benchmark') {
      const element = document.getElementById('ai-benchmark')
      if (element && typeof element.scrollIntoView === 'function') {
        element.scrollIntoView({block: 'start', behavior: 'smooth'})
      }
    }

    if (
      current.matches('editing') &&
      String(router.query?.autostep || '')
        .trim()
        .toLowerCase() === 'submit' &&
      !didAutostepSubmitRef.current
    ) {
      didAutostepSubmitRef.current = true
      openSubmitStepWithKeywordFallback()
    }
  }, [current, openSubmitStepWithKeywordFallback, router.query])

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
  const activeStoryDraft =
    storyOptions.find((item) => String(item.id) === String(selectedStoryId)) ||
    storyOptions[0] ||
    null
  const activeStoryDraftReview = activeStoryDraft
    ? getStoryDraftReview(activeStoryDraft)
    : null
  let aiProviderKeyStatusLabel = t('Checking...')
  let aiProviderKeyStatusColor = 'muted'
  if (isLegacyOnlyMode) {
    aiProviderKeyStatusLabel = t('Not required in legacy-only mode')
  } else if (!aiProviderKeyStatus.checked) {
    aiProviderKeyStatusLabel = t('Checking...')
  } else if (aiProviderKeyStatus.hasKey) {
    aiProviderKeyStatusLabel = t('Ready')
    aiProviderKeyStatusColor = 'green.500'
  } else {
    aiProviderKeyStatusLabel = t('Missing')
    aiProviderKeyStatusColor = 'orange.500'
  }
  const flipBuildStatusBorderColorByKind = {
    idle: 'gray.100',
    running: 'gray.100',
    success: 'green.200',
    error: 'red.200',
  }
  const flipBuildStatusBgByKind = {
    idle: 'gray.50',
    running: 'gray.50',
    success: 'green.50',
    error: 'red.50',
  }
  const flipBuildStatusTextColorByKind = {
    idle: 'muted',
    running: 'muted',
    success: 'green.800',
    error: 'red.800',
  }
  const flipBuildStatusText =
    flipBuildStatus.kind === 'idle'
      ? t(
          'No generated result yet. Click "Build flips" to generate and auto-apply panels to the draft.'
        )
      : flipBuildStatus.message

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
                      {t('Bulk JSON import (advanced)')}
                    </Text>
                    <Stack isInline spacing={2}>
                      <SecondaryButton
                        onClick={openSubmitStepWithKeywordFallback}
                      >
                        {t('Open submit step')}
                      </SecondaryButton>
                      <SecondaryButton
                        onClick={() => setShowGlobalJsonTools((v) => !v)}
                      >
                        {showGlobalJsonTools
                          ? t('Hide advanced import')
                          : t('Show advanced import')}
                      </SecondaryButton>
                    </Stack>
                  </Stack>
                  <Text color="muted" fontSize="xs">
                    {showGlobalJsonTools
                      ? t(
                          'Visible in every step: load JSON, then add to queue or run now.'
                        )
                      : t(
                          'Hidden by default for simple flow. Enable only when importing large external datasets.'
                        )}
                  </Text>
                  {showGlobalJsonTools ? (
                    <>
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
                    </>
                  ) : null}
                </Stack>
              </Box>
              {is('keywords') && (
                <FlipStoryStep>
                  <FlipStepBody minH="180px">
                    <Box>
                      <FlipKeywordPanel>
                        {is('keywords.loaded') && (
                          <>
                            <Box
                              mb={3}
                              p={2}
                              borderWidth="1px"
                              borderColor={
                                isRandomKeywordSource
                                  ? 'orange.200'
                                  : 'green.200'
                              }
                              borderRadius="md"
                              bg={
                                isRandomKeywordSource ? 'orange.50' : 'green.50'
                              }
                            >
                              <Text
                                fontSize="xs"
                                color={
                                  isRandomKeywordSource
                                    ? 'orange.800'
                                    : 'green.800'
                                }
                              >
                                {isRandomKeywordSource
                                  ? t(
                                      'Keyword source: Local random test words (off-chain, not from synced node).'
                                    )
                                  : t(
                                      'Keyword source: Node keywords (preferred, from synced node).'
                                    )}
                              </Text>
                            </Box>
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
                          <Stack spacing={2}>
                            <FlipKeyword>
                              <FlipKeywordName>
                                {t('Missing keywords')}
                              </FlipKeywordName>
                            </FlipKeyword>
                            <Text fontSize="xs" color="muted">
                              {t(
                                'Preferred path is node keywords. If node keywords are unavailable, approve local random test words explicitly.'
                              )}
                            </Text>
                            <Stack isInline spacing={2}>
                              <SecondaryButton
                                onClick={() => send('USE_NODE_KEYWORDS')}
                              >
                                {t('Retry node keywords')}
                              </SecondaryButton>
                              <SecondaryButton
                                onClick={approveRandomKeywordsForSubmit}
                              >
                                {t('Load random test words')}
                              </SecondaryButton>
                            </Stack>
                          </Stack>
                        )}
                      </FlipKeywordPanel>
                      {isOffline && <CommunityTranslationUnavailable />}
                    </Box>
                    <FlipStoryAside>
                      <IconButton2
                        icon={<RefreshIcon />}
                        isDisabled={is('keywords.loading')}
                        onClick={() => send('USE_NODE_KEYWORDS')}
                      >
                        {t('Retry node keywords')}
                      </IconButton2>
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
                        icon={<RefreshIcon />}
                        isDisabled={is('keywords.loading')}
                        onClick={approveRandomKeywordsForSubmit}
                      >
                        {t('Use random test words (off-chain)')}
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
                  {!hasUsableKeywords && (
                    <Box
                      mb={4}
                      borderWidth="1px"
                      borderColor="orange.200"
                      borderRadius="md"
                      p={3}
                      bg="orange.50"
                    >
                      <Stack spacing={2}>
                        <Text fontSize="sm" fontWeight={500} color="orange.800">
                          {t(
                            'No node keywords loaded. Approve local random test words only for off-chain testing.'
                          )}
                        </Text>
                        <Stack isInline justify="flex-end">
                          <SecondaryButton
                            onClick={() => send('USE_NODE_KEYWORDS')}
                          >
                            {t('Retry node keywords')}
                          </SecondaryButton>
                          <SecondaryButton
                            onClick={approveRandomKeywordsForSubmit}
                          >
                            {t('Load random test words')}
                          </SecondaryButton>
                        </Stack>
                      </Stack>
                    </Box>
                  )}
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
                      <Box
                        borderWidth="1px"
                        borderColor="blue.050"
                        borderRadius="md"
                        p={3}
                        bg="blue.012"
                      >
                        <Stack spacing={3}>
                          <Flex
                            align={['flex-start', 'center']}
                            justify="space-between"
                            direction={['column', 'row']}
                          >
                            <Box>
                              <Text fontSize="sm" fontWeight={500}>
                                {t('Quick start')}
                              </Text>
                              <Text fontSize="xs" color="muted">
                                {t(
                                  '1. Choose provider and set a session API key. 2. Generate one draft and edit weak panels. 3. Build images or add the draft to the benchmark queue.'
                                )}
                              </Text>
                            </Box>
                            <Stack isInline spacing={2}>
                              <SecondaryButton
                                onClick={aiGuideDisclosure.onOpen}
                              >
                                {t('Setup & FAQ')}
                              </SecondaryButton>
                              <SecondaryButton
                                onClick={() => router.push('/settings/ai')}
                              >
                                {t('AI settings')}
                              </SecondaryButton>
                            </Stack>
                          </Flex>
                          <SimpleGrid columns={[1, 3]} spacing={2}>
                            <Box
                              borderWidth="1px"
                              borderColor="gray.100"
                              borderRadius="md"
                              p={2}
                              bg="white"
                            >
                              <Text fontSize="xs" color="muted">
                                {t('Provider')}
                              </Text>
                              <Text fontSize="sm" fontWeight={500}>
                                {String(aiSolverSettings.provider || 'openai')}
                              </Text>
                            </Box>
                            <Box
                              borderWidth="1px"
                              borderColor="gray.100"
                              borderRadius="md"
                              p={2}
                              bg="white"
                            >
                              <Text fontSize="xs" color="muted">
                                {t('Session API key')}
                              </Text>
                              <Text
                                fontSize="sm"
                                fontWeight={500}
                                color={aiProviderKeyStatusColor}
                              >
                                {aiProviderKeyStatusLabel}
                              </Text>
                            </Box>
                            <Box
                              borderWidth="1px"
                              borderColor="gray.100"
                              borderRadius="md"
                              p={2}
                              bg="white"
                            >
                              <Text fontSize="xs" color="muted">
                                {t('Advanced options')}
                              </Text>
                              <Text fontSize="sm" fontWeight={500}>
                                {t('Hidden unless you need them')}
                              </Text>
                            </Box>
                          </SimpleGrid>
                          <Stack isInline justify="flex-end" spacing={2}>
                            <SecondaryButton
                              onClick={() =>
                                setShowAiGuideDetails((value) => !value)
                              }
                            >
                              {showAiGuideDetails
                                ? t('Hide inline FAQ')
                                : t('Show inline FAQ')}
                            </SecondaryButton>
                          </Stack>
                          {showAiGuideDetails ? (
                            <Stack spacing={2}>
                              <Box
                                borderWidth="1px"
                                borderColor="gray.100"
                                borderRadius="md"
                                p={2}
                                bg="white"
                              >
                                <Text fontSize="sm" fontWeight={500}>
                                  {t('What is flip generation?')}
                                </Text>
                                <Text fontSize="xs" color="muted">
                                  {t(
                                    'Generate a story draft from the current keyword pair, rewrite any weak panel text, then build four images from the edited draft.'
                                  )}
                                </Text>
                              </Box>
                              <Box
                                borderWidth="1px"
                                borderColor="gray.100"
                                borderRadius="md"
                                p={2}
                                bg="white"
                              >
                                <Text fontSize="sm" fontWeight={500}>
                                  {t('What is flip solving / benchmark mode?')}
                                </Text>
                                <Text fontSize="xs" color="muted">
                                  {t(
                                    'Use the queue below to run short or long benchmark sessions on saved draft flips. Solving happens on those queued flips, not only on the story generator.'
                                  )}
                                </Text>
                              </Box>
                              <Box
                                borderWidth="1px"
                                borderColor="gray.100"
                                borderRadius="md"
                                p={2}
                                bg="white"
                              >
                                <Text fontSize="sm" fontWeight={500}>
                                  {t('When should I use advanced settings?')}
                                </Text>
                                <Text fontSize="xs" color="muted">
                                  {t(
                                    'Only when you want to tune retries, timeouts, custom models, or benchmark queue behavior. The default path should work with fewer clicks.'
                                  )}
                                </Text>
                              </Box>
                            </Stack>
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
                          <Text fontSize="sm" fontWeight={500}>
                            {t('AI-assisted flip generation')}
                          </Text>
                          <Text fontSize="xs" color="muted">
                            {t(
                              'Keyword source: {{source}}. Keywords: {{a}} / {{b}}. Generate one or two story drafts, customize panel text, then build flip panels.',
                              {
                                source: isRandomKeywordSource
                                  ? 'local random test (off-chain)'
                                  : 'node (preferred)',
                                a: keywordA || '-',
                                b: keywordB || '-',
                              }
                            )}
                          </Text>
                          <SimpleGrid columns={[1, 6]} spacing={2}>
                            <Box>
                              <Text fontSize="xs" color="muted" mb={1}>
                                {t('Generation mode')}
                              </Text>
                              <Select
                                value={aiGenerationMode}
                                onChange={(e) =>
                                  setAiGenerationMode(
                                    String(
                                      e && e.target ? e.target.value : 'fast'
                                    )
                                  )
                                }
                              >
                                <option value="fast">{t('Fast')}</option>
                                <option value="strict">{t('Strict')}</option>
                              </Select>
                              <Text fontSize="xs" color="muted" mt={1}>
                                {aiGenerationMode === 'strict'
                                  ? t(
                                      'Strict mode runs deeper story checks and can take longer.'
                                    )
                                  : t(
                                      'Fast mode prioritizes speed with lighter checks.'
                                    )}
                              </Text>
                            </Box>
                            <Box>
                              <Text fontSize="xs" color="muted" mb={1}>
                                {t('Reasoning model (story + audit)')}
                              </Text>
                              <Select
                                value={reasoningSelectValue}
                                onChange={(e) => {
                                  const next = String(
                                    e && e.target ? e.target.value : ''
                                  ).trim()
                                  if (next && next !== CUSTOM_MODEL_OPTION) {
                                    setAiReasoningModel(next)
                                  }
                                }}
                              >
                                {reasoningModelOptions.map((modelId) => (
                                  <option key={modelId} value={modelId}>
                                    {modelId}
                                  </option>
                                ))}
                                <option value={CUSTOM_MODEL_OPTION}>
                                  {t('Custom model ID...')}
                                </option>
                              </Select>
                              {reasoningSelectValue === CUSTOM_MODEL_OPTION ? (
                                <Input
                                  mt={1}
                                  value={aiReasoningModel}
                                  onChange={(e) =>
                                    setAiReasoningModel(e.target.value)
                                  }
                                  placeholder={
                                    aiSolverSettings.model || 'gpt-4.1-mini'
                                  }
                                />
                              ) : null}
                            </Box>
                            <Box>
                              <Text fontSize="xs" color="muted" mb={1}>
                                {t('Image model')}
                              </Text>
                              <Select
                                value={imageSelectValue}
                                onChange={(e) => {
                                  const next = String(
                                    e && e.target ? e.target.value : ''
                                  ).trim()
                                  if (next && next !== CUSTOM_MODEL_OPTION) {
                                    setAiImageModel(next)
                                  }
                                }}
                              >
                                {imageModelOptions.map((modelId) => (
                                  <option key={modelId} value={modelId}>
                                    {modelId}
                                  </option>
                                ))}
                                <option value={CUSTOM_MODEL_OPTION}>
                                  {t('Custom model ID...')}
                                </option>
                              </Select>
                              {imageSelectValue === CUSTOM_MODEL_OPTION ? (
                                <Input
                                  mt={1}
                                  value={aiImageModel}
                                  onChange={(e) =>
                                    setAiImageModel(e.target.value)
                                  }
                                  placeholder="gpt-image-1-mini"
                                />
                              ) : null}
                              <Text fontSize="xs" color="muted" mt={1}>
                                {t(
                                  'Custom model IDs are allowed (for example: nano-banana or provider-specific variants).'
                                )}
                              </Text>
                            </Box>
                            <Box>
                              <Text fontSize="xs" color="muted" mb={1}>
                                {t('Image size')}
                              </Text>
                              <Input
                                value={aiImageSize}
                                onChange={(e) => setAiImageSize(e.target.value)}
                                placeholder={DEFAULT_AI_IMAGE_SIZE}
                              />
                              <Text fontSize="xs" color="muted" mt={1}>
                                {t(
                                  'Provider output is normalized to Idena panel size 440x330 (2x2 composite: 880x660) before submit.'
                                )}
                              </Text>
                              {aiImageGenerationCostHint ? (
                                <Text fontSize="xs" color="muted" mt={1}>
                                  {`Estimated image cost (${
                                    aiImageGenerationCostHint.model
                                  }): ~$${aiImageGenerationCostHint.unitUsd.toFixed(
                                    3
                                  )} per image, ~$${aiImageGenerationCostHint.fourPanelsUsd.toFixed(
                                    3
                                  )} for 4 panels.`}
                                </Text>
                              ) : null}
                              <Text fontSize="xs" color="muted" mt={1}>
                                {aiImageGenerationCostHint
                                  ? `Cheapest known ${
                                      aiImageGenerationCostHint.model
                                    } size is ${
                                      aiImageGenerationCostHint.cheapestSize
                                    } (~$${aiImageGenerationCostHint.cheapestUnitUsd.toFixed(
                                      3
                                    )}/image, ~$${(
                                      aiImageGenerationCostHint.cheapestUnitUsd *
                                      4
                                    ).toFixed(3)} per 4-panel flip).`
                                  : t(
                                      'Known price hints are available for gpt-image-1, gpt-image-1.5, and gpt-image-1-mini.'
                                    )}
                              </Text>
                            </Box>
                            <Box>
                              <Text fontSize="xs" color="muted" mb={1}>
                                {t('Story options')}
                              </Text>
                              <Select
                                value={String(storyOptionCount)}
                                onChange={(e) =>
                                  setStoryOptionCount(
                                    Math.max(
                                      1,
                                      Math.min(
                                        2,
                                        toInt(
                                          e && e.target
                                            ? e.target.value
                                            : storyOptionCount,
                                          1
                                        )
                                      )
                                    )
                                  )
                                }
                              >
                                <option value="1">
                                  {t('1 strong editable draft')}
                                </option>
                                <option value="2">{t('2 alternatives')}</option>
                              </Select>
                              <Text fontSize="xs" color="muted" mt={1}>
                                {storyOptionCount === 1
                                  ? t(
                                      'Recommended for live use when you want one stronger draft and less fallback pressure.'
                                    )
                                  : t(
                                      'Use two options when you want comparison and can tolerate stricter reranking.'
                                    )}
                              </Text>
                            </Box>
                            <Box>
                              <Text fontSize="xs" color="muted" mb={1}>
                                {t('Noise panel index (0-3)')}
                              </Text>
                              <Input
                                type="number"
                                min={0}
                                max={3}
                                value={storyNoisePanelIndex}
                                onChange={(e) =>
                                  setStoryNoisePanelIndex(
                                    Math.max(
                                      0,
                                      Math.min(3, toInt(e.target.value, 0))
                                    )
                                  )
                                }
                              />
                            </Box>
                          </SimpleGrid>
                          <Text fontSize="xs" color="muted">
                            {t(
                              'Reasoning model handles storyline generation and text-audit; image model handles panel rendering. Use cheaper image models to reduce cost.'
                            )}
                          </Text>
                          <Flex align="center" justify="space-between">
                            <Text fontSize="sm" color="muted">
                              {t(
                                'Apply legacy adversarial image noise to one panel (human chooses index, AI helper executes).'
                              )}
                            </Text>
                            <Switch
                              isChecked={storyIncludeNoise}
                              onChange={() =>
                                setStoryIncludeNoise(!storyIncludeNoise)
                              }
                            />
                          </Flex>
                          <Textarea
                            value={aiImageStyle}
                            onChange={(e) => setAiImageStyle(e.target.value)}
                            minH="76px"
                            placeholder={t(
                              'Visual style instructions (applies to all panels)'
                            )}
                          />
                          <Stack isInline justify="flex-end" spacing={2}>
                            <SecondaryButton
                              isLoading={isGeneratingStoryOptions}
                              onClick={() =>
                                generateStoryAlternatives({optimize: false})
                              }
                            >
                              {storyOptionCount === 1
                                ? t('Generate 1 story draft')
                                : t('Generate 2 story options')}
                            </SecondaryButton>
                            <SecondaryButton
                              isLoading={isGeneratingStoryOptions}
                              onClick={() =>
                                generateStoryAlternatives({optimize: true})
                              }
                            >
                              {t('Optimize story further')}
                            </SecondaryButton>
                          </Stack>

                          {storyOptions.length > 0 ? (
                            <SimpleGrid columns={[1, 2]} spacing={2}>
                              {storyOptions.map((option) => {
                                const reviewState = getStoryDraftReview(option)
                                const hasComplianceReport =
                                  Object.keys(option.complianceReport || {})
                                    .length > 0
                                const optionIsSelected =
                                  String(selectedStoryId) === String(option.id)
                                let optionBorderColor = 'gray.100'
                                if (optionIsSelected) {
                                  optionBorderColor = 'blue.300'
                                } else if (reviewState.kind !== 'strong') {
                                  optionBorderColor = 'orange.200'
                                }
                                const optionBg =
                                  reviewState.kind === 'strong'
                                    ? 'white'
                                    : 'orange.012'
                                const reviewBorderColor =
                                  reviewState.kind === 'strong'
                                    ? 'green.100'
                                    : 'orange.200'
                                const reviewAccentColor =
                                  reviewState.kind === 'strong'
                                    ? 'green.500'
                                    : 'orange.500'
                                return (
                                  <Box
                                    key={option.id}
                                    borderWidth="1px"
                                    borderColor={optionBorderColor}
                                    borderRadius="md"
                                    p={2}
                                    bg={optionBg}
                                  >
                                    <Stack spacing={1}>
                                      <Text fontSize="sm" fontWeight={500}>
                                        {option.title}
                                      </Text>
                                      <Box
                                        borderWidth="1px"
                                        borderColor={reviewBorderColor}
                                        borderRadius="md"
                                        p={2}
                                        bg="white"
                                      >
                                        <Text
                                          fontSize="xs"
                                          fontWeight={500}
                                          color={reviewAccentColor}
                                        >
                                          {reviewState.label}
                                        </Text>
                                        <Text fontSize="xs" color="muted">
                                          {reviewState.description}
                                        </Text>
                                        {Number.isFinite(
                                          Number(option.qualityScore)
                                        ) ? (
                                          <Text
                                            fontSize="xs"
                                            color="muted"
                                            mt={1}
                                          >
                                            {t('Quality score: {{score}}', {
                                              score: option.qualityScore,
                                            })}
                                          </Text>
                                        ) : null}
                                      </Box>
                                      {option.panels.map((panel, idx) => (
                                        <Text
                                          key={`${option.id}-panel-${idx}`}
                                          fontSize="xs"
                                          color="muted"
                                        >
                                          {`${idx + 1}. ${panel}`}
                                        </Text>
                                      ))}
                                      {option.rationale ? (
                                        <Text fontSize="xs" color="muted">
                                          {option.rationale}
                                        </Text>
                                      ) : null}
                                      {option.editingTip ? (
                                        <Text fontSize="xs" color="blue.500">
                                          {option.editingTip}
                                        </Text>
                                      ) : null}
                                      {option.storySummary ? (
                                        <Text fontSize="xs" color="muted">
                                          {option.storySummary}
                                        </Text>
                                      ) : null}
                                      {option.failedComplianceKeys.length >
                                      0 ? (
                                        <Text fontSize="xs" color="orange.500">
                                          {`Compliance risk: ${option.failedComplianceKeys.join(
                                            ', '
                                          )}`}
                                        </Text>
                                      ) : null}
                                      {option.failedComplianceKeys.length ===
                                        0 && hasComplianceReport ? (
                                        <Text fontSize="xs" color="green.500">
                                          {t('Compliance checks passed')}
                                        </Text>
                                      ) : null}
                                      {option.riskFlags.length > 0 ? (
                                        <Text fontSize="xs" color="orange.500">
                                          {`Risk flags: ${option.riskFlags.join(
                                            ' | '
                                          )}`}
                                        </Text>
                                      ) : null}
                                      {option.qualityFailures.length > 0 ? (
                                        <Text fontSize="xs" color="orange.500">
                                          {`Story quality warnings: ${option.qualityFailures.join(
                                            ', '
                                          )}`}
                                        </Text>
                                      ) : null}
                                      <Stack isInline justify="flex-end">
                                        <SecondaryButton
                                          onClick={() => {
                                            applyStoryOptionToDraft(option)
                                          }}
                                        >
                                          {reviewState.kind === 'strong'
                                            ? t('Use this story')
                                            : t('Use this draft')}
                                        </SecondaryButton>
                                        {reviewState.kind !== 'strong' ? (
                                          <SecondaryButton
                                            isLoading={isGeneratingStoryOptions}
                                            onClick={async () => {
                                              applyStoryOptionToDraft(option)
                                              await generateStoryAlternatives({
                                                optimize: true,
                                                basePanels: option.panels,
                                              })
                                            }}
                                          >
                                            {t('Optimize this weak draft')}
                                          </SecondaryButton>
                                        ) : null}
                                      </Stack>
                                    </Stack>
                                  </Box>
                                )
                              })}
                            </SimpleGrid>
                          ) : null}

                          {activeStoryDraft && activeStoryDraftReview ? (
                            <Box
                              borderWidth="1px"
                              borderColor={
                                activeStoryDraftReview.kind === 'strong'
                                  ? 'green.100'
                                  : 'orange.200'
                              }
                              borderRadius="md"
                              p={3}
                              bg={
                                activeStoryDraftReview.kind === 'strong'
                                  ? 'green.012'
                                  : 'orange.012'
                              }
                            >
                              <Stack spacing={2}>
                                <Text
                                  fontSize="sm"
                                  fontWeight={500}
                                  color={
                                    activeStoryDraftReview.kind === 'strong'
                                      ? 'green.500'
                                      : 'orange.500'
                                  }
                                >
                                  {`${activeStoryDraft.title}: ${activeStoryDraftReview.label}`}
                                </Text>
                                <Text fontSize="xs" color="muted">
                                  {activeStoryDraftReview.description}
                                </Text>
                                <Text fontSize="xs" color="muted">
                                  {activeStoryDraftReview.kind === 'strong'
                                    ? t(
                                        'Recommended flow: make any final wording tweaks, then build all 4 panels.'
                                      )
                                    : t(
                                        'Recommended flow: rewrite the place, trigger, and visible aftermath first. If it still feels weak, run Optimize this weak draft.'
                                      )}
                                </Text>
                                {activeStoryDraftReview.kind !== 'strong' ? (
                                  <Stack isInline justify="flex-end">
                                    <SecondaryButton
                                      isLoading={isGeneratingStoryOptions}
                                      onClick={() =>
                                        generateStoryAlternatives({
                                          optimize: true,
                                          basePanels: storyPanelsDraft,
                                        })
                                      }
                                    >
                                      {t('Optimize selected draft')}
                                    </SecondaryButton>
                                  </Stack>
                                ) : null}
                              </Stack>
                            </Box>
                          ) : null}

                          <SimpleGrid columns={[1, 2]} spacing={2}>
                            {storyPanelsDraft.map((panelText, panelIndex) => (
                              <Box key={`story-panel-draft-${panelIndex}`}>
                                <Text fontSize="xs" color="muted" mb={1}>
                                  {t('Panel {{idx}} text', {
                                    idx: panelIndex + 1,
                                  })}
                                </Text>
                                <Textarea
                                  value={panelText}
                                  onChange={(e) =>
                                    setStoryPanelsDraft((prev) => {
                                      const next = coerceStoryPanelsDraft(prev)
                                      next[panelIndex] = e.target.value
                                      return next
                                    })
                                  }
                                  minH="62px"
                                />
                              </Box>
                            ))}
                          </SimpleGrid>

                          <Stack isInline justify="flex-end" spacing={2}>
                            <PrimaryButton
                              isLoading={isGeneratingFlipPanels}
                              onClick={() =>
                                buildFlipWithAi({
                                  regenerateIndices: [0, 1, 2, 3],
                                })
                              }
                            >
                              {t('Build flips')}
                            </PrimaryButton>
                            <SecondaryButton
                              isDisabled={generatedFlipPanels.length < 4}
                              onClick={async () => {
                                try {
                                  await applyGeneratedPanelsToBuilder(
                                    generatedFlipPanels,
                                    {
                                      returnToSubmit: true,
                                      autoShuffleSubmit: true,
                                    }
                                  )
                                  notify(
                                    t('Generated flip applied'),
                                    t(
                                      'Draft updated and shuffled. You can submit now or reshuffle.'
                                    )
                                  )
                                } catch (error) {
                                  notify(
                                    t('Unable to apply generated flip'),
                                    error.toString(),
                                    'error'
                                  )
                                }
                              }}
                            >
                              {t('Accept and use flip')}
                            </SecondaryButton>
                          </Stack>

                          <Box
                            borderWidth="1px"
                            borderColor={
                              flipBuildStatusBorderColorByKind[
                                flipBuildStatus.kind
                              ] || 'gray.100'
                            }
                            borderRadius="md"
                            p={2}
                            bg={
                              flipBuildStatusBgByKind[flipBuildStatus.kind] ||
                              'gray.50'
                            }
                          >
                            <Text
                              fontSize="xs"
                              color={
                                flipBuildStatusTextColorByKind[
                                  flipBuildStatus.kind
                                ] || 'muted'
                              }
                            >
                              {flipBuildStatusText}
                            </Text>
                          </Box>

                          {generatedFlipPanels.length > 0 ? (
                            <>
                              <SimpleGrid columns={[1, 2, 4]} spacing={2}>
                                {generatedFlipPanels.map((panel) => (
                                  <Box
                                    key={`generated-panel-${panel.index}`}
                                    borderWidth="1px"
                                    borderColor="gray.100"
                                    borderRadius="md"
                                    p={1}
                                  >
                                    <Text fontSize="xs" color="muted" mb={1}>
                                      {t('Panel {{idx}}', {
                                        idx: Number(panel.index) + 1,
                                      })}
                                    </Text>
                                    <img
                                      src={panel.imageDataUrl}
                                      alt={`generated-panel-${panel.index}`}
                                      style={{
                                        width: '100%',
                                        height: 120,
                                        objectFit: 'cover',
                                        borderRadius: 6,
                                        border: '1px solid rgba(0,0,0,0.08)',
                                      }}
                                    />
                                  </Box>
                                ))}
                              </SimpleGrid>
                              <Stack isInline justify="flex-end" spacing={2}>
                                <SecondaryButton
                                  isLoading={isGeneratingFlipPanels}
                                  onClick={() =>
                                    buildFlipWithAi({
                                      regenerateIndices: [0, 1, 2, 3],
                                    })
                                  }
                                >
                                  {t('Redo whole flip')}
                                </SecondaryButton>
                                {[0, 1, 2, 3].map((index) => (
                                  <SecondaryButton
                                    key={`redo-panel-${index}`}
                                    isLoading={isGeneratingFlipPanels}
                                    onClick={() =>
                                      buildFlipWithAi({
                                        regenerateIndices: [index],
                                      })
                                    }
                                  >
                                    {t('Redo panel {{idx}}', {idx: index + 1})}
                                  </SecondaryButton>
                                ))}
                              </Stack>
                            </>
                          ) : null}
                        </Stack>
                      </Box>

                      <Box
                        borderWidth="1px"
                        borderColor="gray.100"
                        borderRadius="md"
                        p={3}
                      >
                        <Stack spacing={1}>
                          <Text fontSize="sm" fontWeight={500}>
                            {t('Flip generation cost tracker')}
                          </Text>
                          <Text fontSize="xs" color="muted">
                            {`${
                              generationTotals.count
                            } actions | estimated ${formatUsd(
                              generationTotals.estimatedUsd
                            )} | actual ${formatUsd(
                              generationTotals.actualUsd
                            )} | tokens ${generationTotals.totalTokens}`}
                          </Text>
                          {generationCostLedger.length > 0 ? (
                            <Stack spacing={1} maxH="120px" overflowY="auto">
                              {generationCostLedger.map((item) => (
                                <Text key={item.id} fontSize="xs" color="muted">
                                  {`${item.action} | ${item.provider} ${
                                    item.model
                                  } | est ${formatUsd(
                                    item.estimatedUsd
                                  )} | actual ${formatUsd(
                                    item.actualUsd
                                  )} | tok ${
                                    (item.tokenUsage &&
                                      item.tokenUsage.totalTokens) ||
                                    0
                                  }`}
                                </Text>
                              ))}
                            </Stack>
                          ) : (
                            <Text fontSize="xs" color="muted">
                              {t('No generation actions yet.')}
                            </Text>
                          )}
                        </Stack>
                      </Box>
                      <Box
                        borderWidth="1px"
                        borderColor="blue.050"
                        borderRadius="md"
                        p={3}
                        bg="blue.012"
                      >
                        <Stack spacing={2}>
                          <Text fontSize="sm" fontWeight={500}>
                            {t('Quick benchmark flow')}
                          </Text>
                          <Text fontSize="xs" color="muted">
                            {t(
                              'Simple path: Add current draft to queue, then run short or long session. Advanced options are hidden by default.'
                            )}
                          </Text>
                          <Text fontSize="xs" color="muted">
                            {t('Queue size: {{count}}', {
                              count: builderQueueTotal,
                            })}
                          </Text>
                          <Stack isInline justify="flex-end" spacing={2}>
                            <SecondaryButton
                              isLoading={isBuilderQueueLoading}
                              onClick={reloadBuilderQueue}
                            >
                              {t('Reload queue')}
                            </SecondaryButton>
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
                            <PrimaryButton
                              isLoading={isBuilderQueueRunning}
                              onClick={() => runBuilderQueue({preset: 'short'})}
                            >
                              {t('Run short (6)')}
                            </PrimaryButton>
                            <PrimaryButton
                              isLoading={isBuilderQueueRunning}
                              onClick={() => runBuilderQueue({preset: 'long'})}
                            >
                              {t('Run long (14)')}
                            </PrimaryButton>
                          </Stack>
                          <Stack isInline justify="flex-end" spacing={2}>
                            <SecondaryButton
                              onClick={() =>
                                setShowBenchmarkAdvanced((v) => !v)
                              }
                            >
                              {showBenchmarkAdvanced
                                ? t('Hide advanced AI settings')
                                : t('Advanced AI settings')}
                            </SecondaryButton>
                          </Stack>
                        </Stack>
                      </Box>
                      {showBenchmarkAdvanced ? (
                        <>
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
                              <Input
                                value={aiSolverSettings.provider}
                                isReadOnly
                              />
                            </Box>
                            <Box>
                              <Text fontSize="xs" color="muted" mb={1}>
                                {t('Model')}
                              </Text>
                              <Input
                                value={aiSolverSettings.model}
                                isReadOnly
                              />
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
                              onChange={() =>
                                setBuilderDequeue(!builderDequeue)
                              }
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
                              onClick={() =>
                                runBuilderQueue({preset: 'custom'})
                              }
                            >
                              {t('Run queue (custom)')}
                            </PrimaryButton>
                          </Stack>

                          <Text color="muted" fontSize="sm">
                            {t('Queue size: {{count}}', {
                              count: builderQueueTotal,
                            })}
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
                                {modelCostEstimate.tokenProfile.basis ===
                                'last_run'
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
                                  modelCostEstimate.short
                                    .expectedCompletionTokens
                                } out tokens | expected ${
                                  modelCostEstimate.pricing
                                    ? formatUsd(
                                        modelCostEstimate.short.expectedCost
                                      )
                                    : '-'
                                } | worst ${
                                  modelCostEstimate.pricing
                                    ? formatUsd(
                                        modelCostEstimate.short.worstCost
                                      )
                                    : '-'
                                }`}
                              </Text>
                              <Text fontSize="xs" color="muted">
                                {`long(14): ~${
                                  modelCostEstimate.long.expectedPromptTokens
                                } in / ${
                                  modelCostEstimate.long
                                    .expectedCompletionTokens
                                } out tokens | expected ${
                                  modelCostEstimate.pricing
                                    ? formatUsd(
                                        modelCostEstimate.long.expectedCost
                                      )
                                    : '-'
                                } | worst ${
                                  modelCostEstimate.pricing
                                    ? formatUsd(
                                        modelCostEstimate.long.worstCost
                                      )
                                    : '-'
                                }`}
                              </Text>
                              <Text fontSize="xs" color="muted">
                                {`custom(${
                                  modelCostEstimate.custom.flipCount
                                }): ~${
                                  modelCostEstimate.custom.expectedPromptTokens
                                } in / ${
                                  modelCostEstimate.custom
                                    .expectedCompletionTokens
                                } out tokens | expected ${
                                  modelCostEstimate.pricing
                                    ? formatUsd(
                                        modelCostEstimate.custom.expectedCost
                                      )
                                    : '-'
                                } | worst ${
                                  modelCostEstimate.pricing
                                    ? formatUsd(
                                        modelCostEstimate.custom.worstCost
                                      )
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
                                  <Stack
                                    spacing={1}
                                    maxH="110px"
                                    overflowY="auto"
                                  >
                                    {sessionPackPreview.shortFlips.length ? (
                                      sessionPackPreview.shortFlips.map(
                                        (item) => (
                                          <Text
                                            key={`short-${
                                              item.id || item.hash
                                            }`}
                                            fontSize="xs"
                                            color="muted"
                                          >
                                            {item.hash}
                                          </Text>
                                        )
                                      )
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
                                  <Stack
                                    spacing={1}
                                    maxH="110px"
                                    overflowY="auto"
                                  >
                                    {sessionPackPreview.longFlips.length ? (
                                      sessionPackPreview.longFlips.map(
                                        (item) => (
                                          <Text
                                            key={`long-${item.id || item.hash}`}
                                            fontSize="xs"
                                            color="muted"
                                          >
                                            {item.hash}
                                          </Text>
                                        )
                                      )
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
                                  builderLiveState.isRunning
                                    ? 'running'
                                    : 'idle'
                                } | ${
                                  builderLiveState.provider ||
                                  aiSolverSettings.provider
                                } ${
                                  builderLiveState.model ||
                                  aiSolverSettings.model
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
                                      (builderLiveCurrentFlip.flipIndex || 0) +
                                      1
                                    } ${
                                      builderLiveCurrentFlip.hash || '-'
                                    } -> ${String(
                                      builderLiveCurrentFlip.answer ||
                                        'analyzing'
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
                                } batches, ${
                                  builderLastRun.elapsedMs
                                }ms | left ${
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
                                  {builderLastRun.summary.evaluation.labeled >
                                  0 ? (
                                    <Text fontSize="xs" color="muted">
                                      {`accuracy labeled ${toPercent(
                                        builderLastRun.summary.evaluation
                                          .accuracyLabeled
                                      )} (${
                                        builderLastRun.summary.evaluation
                                          .correct
                                      }/${
                                        builderLastRun.summary.evaluation
                                          .labeled
                                      }) | accuracy answered ${toPercent(
                                        builderLastRun.summary.evaluation
                                          .accuracyAnswered
                                      )} (${
                                        builderLastRun.summary.evaluation
                                          .correctAnswered
                                      }/${
                                        builderLastRun.summary.evaluation
                                          .answered
                                      })`}
                                    </Text>
                                  ) : null}
                                  {builderLastRun.summary.evaluation.labeled <
                                  1 ? (
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
                        </>
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
            <>
              {flipNeedsShuffle ? (
                <Text fontSize="xs" color="muted">
                  {t('Shuffle is required before submit.')}
                </Text>
              ) : null}
              <SecondaryButton
                isDisabled={is('submit.submitting')}
                onClick={shuffleDraftForSubmit}
              >
                {flipNeedsShuffle ? t('Shuffle now') : t('Reshuffle')}
              </SecondaryButton>
              <PrimaryButton
                isDisabled={is('submit.submitting') || flipNeedsShuffle}
                isLoading={is('submit.submitting')}
                loadingText={t('Publishing')}
                onClick={() => {
                  if (flipNeedsShuffle) {
                    failToast('Shuffle is required before submit')
                    return
                  }
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
            </>
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
          isOpen={aiGuideDisclosure.isOpen}
          onClose={closeAiGuide}
          size="3xl"
        >
          <ModalOverlay />
          <ModalContent>
            <ModalHeader>{t('AI benchmark helper quick start')}</ModalHeader>
            <ModalCloseButton />
            <ModalBody>
              <Stack spacing={4}>
                <Box
                  borderWidth="1px"
                  borderColor="blue.050"
                  borderRadius="md"
                  p={3}
                  bg="blue.012"
                >
                  <Text fontSize="sm" fontWeight={500}>
                    {t('Before you start')}
                  </Text>
                  <Text fontSize="sm" color="muted" mt={1}>
                    {t(
                      'To run the IdenaAI benchmark helper, choose your preferred AI provider, insert a session API key for that provider, and keep advanced settings hidden unless you really need them.'
                    )}
                  </Text>
                </Box>

                <SimpleGrid columns={[1, 2]} spacing={3}>
                  <Box
                    borderWidth="1px"
                    borderColor="gray.100"
                    borderRadius="md"
                    p={3}
                  >
                    <Text fontSize="sm" fontWeight={500}>
                      {t('Flip generation')}
                    </Text>
                    <Text fontSize="xs" color="muted" mt={1}>
                      {t(
                        'Generate one draft from the current keyword pair, rewrite any weak panel text, then build the 4 panel images. This is the fastest way to create a benchmarkable flip.'
                      )}
                    </Text>
                  </Box>
                  <Box
                    borderWidth="1px"
                    borderColor="gray.100"
                    borderRadius="md"
                    p={3}
                  >
                    <Text fontSize="sm" fontWeight={500}>
                      {t('Flip solving / benchmark queue')}
                    </Text>
                    <Text fontSize="xs" color="muted" mt={1}>
                      {t(
                        'Add drafts to the queue below and run short or long sessions. That is the built-in path for solving flips with your chosen provider and comparing runs.'
                      )}
                    </Text>
                  </Box>
                </SimpleGrid>

                <Box
                  borderWidth="1px"
                  borderColor="gray.100"
                  borderRadius="md"
                  p={3}
                >
                  <Stack spacing={2}>
                    <Text fontSize="sm" fontWeight={500}>
                      {t('FAQ')}
                    </Text>
                    <Text fontSize="xs" color="muted">
                      {t(
                        'Do I need advanced settings? Usually no. The default path is provider -> API key -> generate draft -> edit weak panels -> build images or queue the draft.'
                      )}
                    </Text>
                    <Text fontSize="xs" color="muted">
                      {t(
                        'What should I do with weak drafts? Keep them editable, rewrite the place/trigger/aftermath yourself, or run Optimize story further. Weak does not automatically mean unusable.'
                      )}
                    </Text>
                    <Text fontSize="xs" color="muted">
                      {t(
                        'When should I open AI settings? On first setup, when you change provider/model, or when a session key is missing.'
                      )}
                    </Text>
                  </Stack>
                </Box>
              </Stack>
            </ModalBody>
            <ModalFooter>
              <Stack isInline spacing={2}>
                <SecondaryButton onClick={closeAiGuide}>
                  {t('Stay in builder')}
                </SecondaryButton>
                <PrimaryButton
                  onClick={() => {
                    closeAiGuide()
                    router.push('/settings/ai')
                  }}
                >
                  {t('Open AI settings')}
                </PrimaryButton>
              </Stack>
            </ModalFooter>
          </ModalContent>
        </Modal>

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
      </Page>
    </Layout>
  )
}
