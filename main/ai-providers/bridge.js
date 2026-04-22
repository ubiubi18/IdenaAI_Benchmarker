const axios = require('axios')
const {execFile} = require('child_process')
const fs = require('fs-extra')
const path = require('path')
const {promisify} = require('util')

const {
  PROVIDERS,
  DEFAULT_MODELS,
  PROVIDER_CONFIG_DEFAULTS,
  OPENAI_COMPATIBLE_PROVIDERS,
} = require('./constants')
const {promptTemplate, systemPromptTemplate} = require('./prompt')
const {sanitizeBenchmarkProfile} = require('./profile')
const {
  extractJsonBlock,
  normalizeAnswer,
  normalizeConfidence,
  normalizeDecision,
} = require('./decision')
const {selectSensePair} = require('./senseSelector')
const {
  STORY_COMPLIANCE_KEYS,
  STORY_PANEL_ROLES,
  createStoryOptionsGeminiResponseSchema,
  createStoryOptionsOpenAiResponseFormat,
  normalizeStoryOptionCount,
  validateStoryOptionsPayload,
} = require('./storySchema')
const {evaluateStoryQuality} = require('./storyQuality')
const {selectStoryOptionPair} = require('./storyDiversity')
const {
  buildRenderedStoryRepairGuidance,
  createEmptyRenderedStoryMetrics,
  evaluateRenderedStoryFeedback,
  mergeRenderedStoryMetrics,
  recordRenderedStoryMetrics,
} = require('./renderFeedback')
const {buildStoryPromptExemplarLines} = require('./storyPromptExemplars')
const {
  createRenderedPanelValidatorHooks,
  createStoryValidatorHooks,
  runRenderedPanelValidatorHooks,
  runStoryValidatorHooks,
} = require('./storyValidatorHooks')
const {withRetries, mapWithConcurrency} = require('./concurrency')
const {
  callOpenAi,
  callOpenAiImage,
  testOpenAiProvider,
  listOpenAiModels,
} = require('./providers/openai')
const {
  callGemini,
  callGeminiImage,
  testGeminiProvider,
  listGeminiModels,
} = require('./providers/gemini')
const {
  callAnthropic,
  testAnthropicProvider,
  listAnthropicModels,
} = require('./providers/anthropic')
const {
  LEGACY_HEURISTIC_PROVIDER,
  LEGACY_HEURISTIC_MODEL,
  LEGACY_HEURISTIC_STRATEGY,
  solveLegacyHeuristicDecision,
} = require('./providers/legacy-heuristic')

const SUPPORTED_PROVIDERS = Object.values(PROVIDERS)
const MAX_CONSULTANTS = 4

// Snapshot values for transparent benchmark estimation. Update as providers
// revise pricing. Values are USD per 1M tokens or per generated image.
const OPENAI_TEXT_PRICING_USD_PER_MTOK = {
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

const SUPPORTED_PROVIDER_IMAGE_SIZES = ['1024x1024', '1536x1024', '1024x1536']

const SEMANTIC_ROLE_VALUES = [
  'actor',
  'tool',
  'object',
  'location',
  'concept_representation',
]

const RISK_BEARING_KEYWORD_HINTS = new Set([
  'chainsaw',
  'gun',
  'knife',
  'poison',
  'fire',
  'explosive',
  'explosives',
  'bomb',
  'rifle',
  'pistol',
  'blade',
  'machete',
  'blood',
  'gore',
  'corpse',
  'dead',
  'death',
  'attack',
  'violent',
])

const ACTOR_KEYWORD_HINTS = new Set([
  'clown',
  'person',
  'man',
  'woman',
  'child',
  'kid',
  'boy',
  'girl',
  'nurse',
  'doctor',
  'teacher',
  'police',
  'officer',
  'worker',
  'chef',
  'farmer',
  'dog',
  'cat',
  'bird',
  'robot',
])

const TOOL_KEYWORD_HINTS = new Set([
  'chainsaw',
  'gun',
  'knife',
  'hammer',
  'saw',
  'drill',
  'wrench',
  'scissors',
  'brush',
  'paintbrush',
  'telescope',
  'camera',
  'broom',
  'shovel',
])

const LOCATION_KEYWORD_HINTS = new Set([
  'kitchen',
  'workshop',
  'garage',
  'hospital',
  'school',
  'park',
  'garden',
  'beach',
  'forest',
  'office',
  'factory',
  'stadium',
  'festival',
  'museum',
  'library',
])

const CONCEPT_REPRESENTATIONS = {
  freedom: 'open birdcage with a broken chain',
  justice: 'balanced scale on a courthouse table',
  time: 'large hourglass and wall clock',
  peace: 'white flag and olive branch on a table',
  love: 'heart-shaped paper card and two linked rings',
  danger: 'yellow hazard sign on a stand',
  hope: 'lit lantern at dawn near a window',
}

const MIN_IMAGE_REQUEST_TIMEOUT_MS = 180 * 1000
const MIN_IMAGE_SEARCH_REQUEST_TIMEOUT_MS = 20 * 1000
const IMAGE_TIMEOUT_BACKOFF_STEPS_MS = [0, 90 * 1000, 180 * 1000]
const PYTHON_FLIP_PIPELINE_SCRIPT = path.resolve(
  __dirname,
  '..',
  '..',
  'scripts',
  'idena_flip_pipeline.py'
)
const DEFAULT_PYTHON_FLIP_PIPELINE_TIMEOUT_MS = 20000
const execFileAsync = promisify(execFile)

function resolvePythonInterpreterCommand() {
  const configured = String(
    process.env.IDENAAI_PYTHON ||
      (process.platform === 'win32' ? 'py -3' : 'python3')
  ).trim()
  const parts = configured.split(/\s+/g).filter(Boolean)
  return {
    command: parts[0] || 'python3',
    args: parts.slice(1),
  }
}

let appDataPath = null

try {
  // eslint-disable-next-line global-require
  appDataPath = require('../app-data-path')
} catch (error) {
  appDataPath = null
}

function resolveUserDataPath() {
  if (!appDataPath) {
    throw new Error('app-data-path is unavailable in this environment')
  }
  return appDataPath('userData')
}

function normalizeProvider(provider) {
  const normalized = String(provider || '')
    .trim()
    .toLowerCase()

  if (!SUPPORTED_PROVIDERS.includes(normalized)) {
    throw new Error(`Unsupported provider: ${provider}`)
  }

  return normalized
}

function isOpenAiCompatibleProvider(provider) {
  return OPENAI_COMPATIBLE_PROVIDERS.includes(provider)
}

function supportsImageGenerationProvider(provider) {
  return isOpenAiCompatibleProvider(provider) || provider === PROVIDERS.Gemini
}

function isLocalAiProvider(provider) {
  return provider === PROVIDERS.LocalAI
}

function normalizeLocalAiConfidenceBand(value) {
  const confidence = String(value || '')
    .trim()
    .toLowerCase()

  switch (confidence) {
    case 'high':
      return 0.9
    case 'medium':
      return 0.66
    case 'low':
      return 0.42
    default:
      return 0
  }
}

function normalizeLocalAiClassificationScore(value) {
  const classification = String(value || '')
    .trim()
    .toLowerCase()

  switch (classification) {
    case 'consistent':
      return 1
    case 'ambiguous':
      return 0.45
    case 'inconsistent':
      return 0
    default:
      return 0
  }
}

function summarizeLocalAiCheckSide(label, result = {}) {
  const classification = String(result.classification || 'unknown').trim()
  const confidence = String(result.confidence || 'unknown').trim()
  const detail = String(result.reason || result.lastError || '').trim()

  return `${label}: ${classification} (${confidence})${
    detail ? `, ${detail}` : ''
  }`
}

function buildLocalAiDecisionFromChecks(left = {}, right = {}) {
  const leftConfidence = normalizeLocalAiConfidenceBand(left.confidence)
  const rightConfidence = normalizeLocalAiConfidenceBand(right.confidence)
  const leftScore =
    normalizeLocalAiClassificationScore(left.classification) * leftConfidence
  const rightScore =
    normalizeLocalAiClassificationScore(right.classification) * rightConfidence
  const leftClassification = String(left.classification || '')
    .trim()
    .toLowerCase()
  const rightClassification = String(right.classification || '')
    .trim()
    .toLowerCase()

  let answer = 'skip'

  if (
    leftClassification === 'consistent' &&
    rightClassification !== 'consistent'
  ) {
    answer = 'left'
  } else if (
    rightClassification === 'consistent' &&
    leftClassification !== 'consistent'
  ) {
    answer = 'right'
  } else if (leftScore > rightScore + 0.12) {
    answer = 'left'
  } else if (rightScore > leftScore + 0.12) {
    answer = 'right'
  }

  const confidence =
    answer === 'skip'
      ? Math.min(0.45, Math.max(leftConfidence, rightConfidence) * 0.5)
      : Math.min(
          0.95,
          Math.max(
            0.35,
            Math.max(leftScore, rightScore),
            Math.abs(leftScore - rightScore) + 0.45
          )
        )

  return {
    answer,
    confidence,
    reasoning: [
      summarizeLocalAiCheckSide('left', left),
      summarizeLocalAiCheckSide('right', right),
    ].join(' | '),
  }
}

function resolveProviderConfig(provider, providerConfig = null) {
  const defaults =
    PROVIDER_CONFIG_DEFAULTS &&
    PROVIDER_CONFIG_DEFAULTS[provider] &&
    typeof PROVIDER_CONFIG_DEFAULTS[provider] === 'object'
      ? PROVIDER_CONFIG_DEFAULTS[provider]
      : null

  const overrides =
    providerConfig && typeof providerConfig === 'object' ? providerConfig : null

  if (!defaults && !overrides) {
    return null
  }

  return {
    ...(defaults || {}),
    ...(overrides || {}),
  }
}

function normalizeConsultantWeight(value, fallback = 1) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }
  return Math.min(10, Math.max(0.05, parsed))
}

function toUsd(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

function resolveOpenAiTextPricing(model) {
  const normalized = String(model || '')
    .trim()
    .toLowerCase()
  if (!normalized) {
    return null
  }

  if (OPENAI_TEXT_PRICING_USD_PER_MTOK[normalized]) {
    return OPENAI_TEXT_PRICING_USD_PER_MTOK[normalized]
  }

  const prefix = Object.keys(OPENAI_TEXT_PRICING_USD_PER_MTOK).find((key) =>
    normalized.startsWith(`${key}-`)
  )

  return prefix ? OPENAI_TEXT_PRICING_USD_PER_MTOK[prefix] : null
}

function estimateTextCostUsd(usage = {}, model = '') {
  const pricing = resolveOpenAiTextPricing(model)
  if (!pricing) {
    return null
  }

  const promptTokens = toUsd(usage.promptTokens)
  const completionTokens = toUsd(usage.completionTokens)

  return (
    (promptTokens / 1000000) * toUsd(pricing.input) +
    (completionTokens / 1000000) * toUsd(pricing.output)
  )
}

function resolveOpenAiImageUnitPrice(model, size) {
  const normalizedModel = String(model || '')
    .trim()
    .toLowerCase()
  const normalizedSize = String(size || '').trim() || '1024x1024'
  const byModel = OPENAI_IMAGE_PRICING_USD_PER_IMAGE[normalizedModel]
  if (!byModel) return null
  return byModel[normalizedSize] || byModel['1024x1024'] || null
}

function parseImageSizeParts(value) {
  const match = String(value || '')
    .trim()
    .match(/^(\d{2,5})x(\d{2,5})$/i)
  if (!match) {
    return null
  }

  const width = Number(match[1])
  const height = Number(match[2])
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null
  }

  return {width, height}
}

function normalizeProviderImageSize(value, fallback = '1536x1024') {
  const requested = String(value || '').trim()
  if (SUPPORTED_PROVIDER_IMAGE_SIZES.includes(requested)) {
    return requested
  }

  const parsedRequested = parseImageSizeParts(requested)
  if (!parsedRequested) {
    return fallback
  }

  const requestedRatio = parsedRequested.width / parsedRequested.height
  const [closest] = SUPPORTED_PROVIDER_IMAGE_SIZES.map((size) => {
    const parsedSize = parseImageSizeParts(size)
    const ratio = parsedSize.width / parsedSize.height
    return {
      size,
      ratioDelta: Math.abs(ratio - requestedRatio),
      areaDelta: Math.abs(
        parsedSize.width * parsedSize.height -
          parsedRequested.width * parsedRequested.height
      ),
    }
  }).sort((a, b) => {
    if (a.ratioDelta !== b.ratioDelta) {
      return a.ratioDelta - b.ratioDelta
    }
    return a.areaDelta - b.areaDelta
  })

  return closest ? closest.size : fallback
}

function normalizeKeywordValue(item) {
  if (item == null) return ''
  if (typeof item === 'string') {
    return item
      .replace(/[\r\n\t]/g, ' ')
      .replace(/[{}<>\\`$]/g, '')
      .replace(/\s+/g, ' ')
      .slice(0, 80)
      .trim()
  }
  if (typeof item === 'object') {
    return normalizeKeywordValue(item.name || item.keyword || item.word || '')
  }
  return ''
}

function normalizeHumanStorySeed(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
}

function reduceStoryBoilerplate(text) {
  return String(text || '')
    .replace(/\bin a stable everyday setting\b/gi, 'nearby')
    .replace(/\bin an everyday setting\b/gi, 'nearby')
    .replace(/\bin a stable setting\b/gi, 'nearby')
    .replace(/\bin the same scene\b/gi, 'nearby')
    .replace(/\bstill clearly visible\b/gi, 'visible')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeKeywords(payload) {
  const source = Array.isArray(payload && payload.keywords)
    ? payload.keywords
    : []
  const values = source
    .map((item) => normalizeKeywordValue(item))
    .filter(Boolean)
    .slice(0, 2)

  if (values.length >= 2) return values
  if (values.length === 1) return [values[0], '']
  return ['', '']
}

function getLockedSenseSelection(value, keywordA, keywordB) {
  if (
    value &&
    typeof value === 'object' &&
    value.chosen_senses &&
    value.chosen_senses.keyword_1 &&
    value.chosen_senses.keyword_2
  ) {
    return value
  }
  return selectSensePair({keywordA, keywordB})
}

function getLockedSense(value, key, fallbackKeyword = '') {
  const source =
    value &&
    value.chosen_senses &&
    value.chosen_senses[key] &&
    typeof value.chosen_senses[key] === 'object'
      ? value.chosen_senses[key]
      : {}
  return {
    keyword: normalizeKeywordValue(source.keyword || fallbackKeyword),
    sense_id: String(source.sense_id || '').trim(),
    gloss: String(source.gloss || '').trim(),
    usage_rank: Math.max(1, Number.parseInt(source.usage_rank, 10) || 1),
    visual_concreteness_score: clamp01(source.visual_concreteness_score),
    causal_story_score: clamp01(source.causal_story_score),
    example_visual_form: String(source.example_visual_form || '').trim(),
    synonyms_for_prompting: Array.isArray(source.synonyms_for_prompting)
      ? source.synonyms_for_prompting
          .map((item) => String(item || '').trim())
          .filter(Boolean)
          .slice(0, 5)
      : [],
    prompt_label: String(source.prompt_label || '').trim(),
    safety_note: String(source.safety_note || '').trim(),
    tags: Array.isArray(source.tags)
      ? source.tags
          .map((item) =>
            String(item || '')
              .trim()
              .toLowerCase()
          )
          .filter(Boolean)
          .slice(0, 8)
      : [],
  }
}

function clamp01(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.max(0, Math.min(1, numeric))
}

function senseHasTag(sense, tag) {
  return Boolean(
    sense &&
      Array.isArray(sense.tags) &&
      sense.tags.includes(
        String(tag || '')
          .trim()
          .toLowerCase()
      )
  )
}

function senseHasAnyTag(sense, tags) {
  return Array.isArray(tags) && tags.some((tag) => senseHasTag(sense, tag))
}

function isEmotionSense(sense) {
  return senseHasTag(sense, 'emotion')
}

function isToolSense(sense) {
  return senseHasTag(sense, 'tool')
}

function isActorSense(sense) {
  return senseHasAnyTag(sense, ['actor', 'person'])
}

function isMotionSense(sense) {
  return senseHasTag(sense, 'motion')
}

function isReflectionSense(sense) {
  return senseHasTag(sense, 'reflection')
}

function getSensePromptLabel(sense, fallbackKeyword = '') {
  const promptLabel = String(
    sense && sense.prompt_label ? sense.prompt_label : ''
  ).trim()
  if (promptLabel) return promptLabel
  if (
    sense &&
    Array.isArray(sense.synonyms_for_prompting) &&
    sense.synonyms_for_prompting.length > 0
  ) {
    return String(sense.synonyms_for_prompting[0] || '').trim()
  }
  return (
    normalizeKeywordValue((sense && sense.keyword) || fallbackKeyword) ||
    'object'
  )
}

function formatSensePromptLines(senseSelection, keywordA, keywordB) {
  const selection = getLockedSenseSelection(senseSelection, keywordA, keywordB)
  const firstSense = getLockedSense(selection, 'keyword_1', keywordA)
  const secondSense = getLockedSense(selection, 'keyword_2', keywordB)
  const notes = [firstSense.safety_note, secondSense.safety_note]
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index)
  const emotionalPair =
    isEmotionSense(firstSense) || isEmotionSense(secondSense)
  const elevatedRiskPair =
    senseHasAnyTag(firstSense, ['elevated_risk']) ||
    senseHasAnyTag(secondSense, ['elevated_risk'])

  return [
    'Locked sense selection (must not drift across panels):',
    `- Keyword 1 "${normalizeKeywordValue(keywordA) || '-'}" -> ${
      firstSense.gloss || getSensePromptLabel(firstSense, keywordA)
    } (sense_id: ${firstSense.sense_id || '-'})`,
    `  Preferred visual form: ${
      firstSense.example_visual_form ||
      getSensePromptLabel(firstSense, keywordA)
    }.`,
    firstSense.synonyms_for_prompting.length > 0
      ? `  Synonyms allowed for prompting: ${firstSense.synonyms_for_prompting.join(
          ', '
        )}.`
      : '',
    `- Keyword 2 "${normalizeKeywordValue(keywordB) || '-'}" -> ${
      secondSense.gloss || getSensePromptLabel(secondSense, keywordB)
    } (sense_id: ${secondSense.sense_id || '-'})`,
    `  Preferred visual form: ${
      secondSense.example_visual_form ||
      getSensePromptLabel(secondSense, keywordB)
    }.`,
    secondSense.synonyms_for_prompting.length > 0
      ? `  Synonyms allowed for prompting: ${secondSense.synonyms_for_prompting.join(
          ', '
        )}.`
      : '',
    '- Keep these meanings locked across the full story and every panel prompt.',
    emotionalPair
      ? '- If the locked sense includes an emotion, show a visible trigger and a visible external consequence. Emotion alone is not enough.'
      : '',
    elevatedRiskPair
      ? '- Keep risky tools, flames, or firearms visible in a non-graphic context only. No direct harm to a person or animal.'
      : '',
    notes.length > 0 ? `- Sense-specific safety notes: ${notes.join(' ')}` : '',
  ].filter(Boolean)
}

function getContentSafetyBoundaryLines() {
  return [
    '- Allow ordinary fear, tension, conflict, surprise, creepy atmosphere, safe tool use, accidental mess, and non-graphic consequences when they improve clarity.',
    '- Reject only clearly extreme or provider-triggering content such as sexual content, graphic violence, gore, explicit injury, direct weapon harm against a person or animal, torture, dismemberment, or body horror.',
    '- Prefer minimal safety intervention. Keep the story concrete instead of flattening it into a harmless non-event.',
  ]
}

function buildSingleStoryPairFitLines(senseSelection, keywordA, keywordB) {
  const selection = getLockedSenseSelection(senseSelection, keywordA, keywordB)
  const firstSense = getLockedSense(selection, 'keyword_1', keywordA)
  const secondSense = getLockedSense(selection, 'keyword_2', keywordB)
  const firstLabel = getSensePromptLabel(firstSense, keywordA)
  const secondLabel = getSensePromptLabel(secondSense, keywordB)
  const firstKeyword = normalizeKeywordValue(keywordA)
  const secondKeyword = normalizeKeywordValue(keywordB)
  const firstActorLike =
    isActorSense(firstSense) || isStoryActorLikeLabel(firstLabel)
  const secondActorLike =
    isActorSense(secondSense) || isStoryActorLikeLabel(secondLabel)
  const firstToolLike =
    isToolSense(firstSense) ||
    hasAnyKeywordHint(firstKeyword, TOOL_KEYWORD_HINTS)
  const secondToolLike =
    isToolSense(secondSense) ||
    hasAnyKeywordHint(secondKeyword, TOOL_KEYWORD_HINTS)
  const firstSettingLike =
    senseHasAnyTag(firstSense, ['setting', 'season']) ||
    hasAnyKeywordHint(firstKeyword, LOCATION_KEYWORD_HINTS)
  const secondSettingLike =
    senseHasAnyTag(secondSense, ['setting', 'season']) ||
    hasAnyKeywordHint(secondKeyword, LOCATION_KEYWORD_HINTS)
  const firstMotionLike = isMotionSense(firstSense)
  const secondMotionLike = isMotionSense(secondSense)
  const emotionalPair =
    isEmotionSense(firstSense) || isEmotionSense(secondSense)
  const reflectivePair =
    isReflectionSense(firstSense) || isReflectionSense(secondSense)
  const bothMostlyObjects =
    !emotionalPair &&
    !firstActorLike &&
    !secondActorLike &&
    !firstSettingLike &&
    !secondSettingLike &&
    !firstToolLike &&
    !secondToolLike

  const lines = ['Pair-fit steering:']

  if (emotionalPair) {
    lines.push(
      '- Anchor the emotion to one visible trigger and one physical aftermath. Do not stop at a facial expression.'
    )
  }

  if (
    (firstActorLike && secondToolLike) ||
    (secondActorLike && firstToolLike)
  ) {
    lines.push(
      '- Use the actor and tool in one believable task, rehearsal, repair, cleanup, performance, or work moment instead of forcing danger for its own sake.'
    )
  }

  if (
    (firstSettingLike && !secondSettingLike) ||
    (secondSettingLike && !firstSettingLike)
  ) {
    lines.push(
      '- Treat the setting keyword as the stage for the event, not as a decorative background. Let the other keyword cause the visible change inside that place.'
    )
  }

  if (
    (firstMotionLike && !secondMotionLike) ||
    (secondMotionLike && !firstMotionLike)
  ) {
    lines.push(
      '- Turn the motion-like keyword into the trigger beat, then let the other keyword show the strongest visible consequence.'
    )
  }

  if (reflectivePair) {
    lines.push(
      '- Use reflection, reveal, concealment, or mistaken appearance as the causal hook, not as a static prop-only scene.'
    )
  }

  if (bothMostlyObjects) {
    lines.push(
      '- If both keywords are mostly objects, place them inside one believable human situation such as packing, cleaning, rehearsal, delivery, costume prep, shopping, repair, or travel.'
    )
    lines.push(
      '- Avoid object-object collisions as the default. Prefer snag, reveal, tangle, blocked path, runaway object, concealment, recovery, repair-gone-wrong, or a chase after something slipping free.'
    )
  }

  if (lines.length === 1) {
    lines.push(
      '- If the pair feels awkward, solve it with one simple human situation that naturally makes both keywords matter.'
    )
  }

  return lines
}

function chooseDeterministicItem(items, seed, fallback = '') {
  const list = Array.isArray(items) ? items.filter(Boolean) : []
  if (list.length < 1) return fallback
  return list[hashScore(seed) % list.length]
}

function chooseDeterministicAftermathPattern({
  seed,
  primaryLabel,
  secondaryLabel,
  supportProp,
  looseItems,
  reactionBeat,
  aftermathBeat,
  preferredPatternId = '',
}) {
  const patterns = [
    {
      id: 'scatter',
      panel3: `The ${supportProp} tips and ${looseItems} scatter while ${reactionBeat}.`,
      panel4: `The toppled ${supportProp}, scattered ${looseItems}, and ${aftermathBeat} remain obvious in the final panel.`,
    },
    {
      id: 'crooked',
      panel3: `The ${supportProp} twists sideways and leaves the ${secondaryLabel} hanging crooked while ${reactionBeat}.`,
      panel4: `The crooked ${secondaryLabel}, twisted ${supportProp}, and ${aftermathBeat} remain obvious in the final panel.`,
    },
    {
      id: 'reveal',
      panel3: `The ${supportProp} snaps open and reveals bright contents around the ${secondaryLabel} while ${reactionBeat}.`,
      panel4: `The open ${supportProp}, revealed contents, and ${aftermathBeat} remain easy to read in the final panel.`,
    },
    {
      id: 'roll',
      panel3: `The ${supportProp} rolls away and drags the ${secondaryLabel} out of place while ${reactionBeat}.`,
      panel4: `The runaway ${supportProp}, displaced ${secondaryLabel}, and ${aftermathBeat} hold the last panel together.`,
    },
    {
      id: 'tangle',
      panel3: `A loose strap from the ${supportProp} wraps around the ${secondaryLabel} and tangles it against the ${primaryLabel} while ${reactionBeat}.`,
      panel4: `The tangled ${secondaryLabel}, shifted ${supportProp}, and ${aftermathBeat} stay easy to read in the final panel.`,
    },
    {
      id: 'unfurl',
      panel3: `The ${supportProp} pops open and a folded cloth unfurls behind the ${secondaryLabel} while ${reactionBeat}.`,
      panel4: `The unfurled cloth, open ${supportProp}, and ${aftermathBeat} remain obvious in the final image.`,
    },
    {
      id: 'block',
      panel3: `The ${supportProp} swings across the route and blocks the ${secondaryLabel} in place while ${reactionBeat}.`,
      panel4: `The blocked path, caught ${secondaryLabel}, and ${aftermathBeat} stay easy to read in the final panel.`,
    },
    {
      id: 'light',
      panel3: `The ${supportProp} swings wide and throws a bright strip of light across the ${secondaryLabel} while ${reactionBeat}.`,
      panel4: `The bright light, exposed ${secondaryLabel}, and ${aftermathBeat} define the final panel at a glance.`,
    },
    {
      id: 'recovery',
      panel3: `The ${primaryLabel} catches the ${secondaryLabel} against the ${supportProp} and steadies it while ${reactionBeat}.`,
      panel4: `The re-hooked ${secondaryLabel}, steadied ${supportProp}, and ${aftermathBeat} make the new situation obvious in the final panel.`,
    },
  ]

  const preferred = patterns.find(
    (pattern) => pattern.id === preferredPatternId
  )
  if (preferred) {
    return preferred
  }
  return chooseDeterministicItem(patterns, `${seed}|aftermath`, patterns[0])
}

function chooseDeterministicFallbackArchetype({
  seed,
  primaryLabel,
  secondaryLabel,
  supportProp,
  allowReveal = true,
  allowCollision = true,
}) {
  const patterns = [
    {
      id: 'collision',
      trigger: `A sudden bump sends the ${primaryLabel} into the ${secondaryLabel} in one readable beat.`,
      reactionBeat: `the ${secondaryLabel} jerks away from the ${primaryLabel}`,
      aftermathBeat: `the changed positions of the ${primaryLabel} and ${secondaryLabel}`,
      preferredAftermath: 'scatter',
    },
    {
      id: 'snag',
      trigger: `The ${primaryLabel} snags on the ${supportProp} and yanks the ${secondaryLabel} sideways in one sharp beat.`,
      reactionBeat: `the ${secondaryLabel} twists against the ${supportProp}`,
      aftermathBeat: `the ${primaryLabel} caught against the crooked ${secondaryLabel}`,
      preferredAftermath: 'crooked',
    },
    {
      id: 'reveal',
      trigger: `The ${supportProp} snaps open and unexpectedly reveals the ${secondaryLabel} behind the ${primaryLabel}.`,
      reactionBeat: `the ${primaryLabel} ends up dragged against the opened ${supportProp}`,
      aftermathBeat: `the opened ${supportProp} with the ${secondaryLabel} newly exposed`,
      preferredAftermath: 'reveal',
    },
    {
      id: 'runaway',
      trigger: `The ${secondaryLabel} rolls away from the ${supportProp} and pulls the ${primaryLabel} after it.`,
      reactionBeat: `the ${primaryLabel} skids after the moving ${secondaryLabel}`,
      aftermathBeat: `the runaway ${secondaryLabel} and displaced ${primaryLabel}`,
      preferredAftermath: 'roll',
    },
    {
      id: 'tangle',
      trigger: `The ${primaryLabel} slips through the ${secondaryLabel} and tangles it against the ${supportProp}.`,
      reactionBeat: `the ${secondaryLabel} tightens around the ${primaryLabel}`,
      aftermathBeat: `the tangled ${secondaryLabel} around the shifted ${primaryLabel}`,
      preferredAftermath: 'tangle',
    },
    {
      id: 'block',
      trigger: `The ${secondaryLabel} swings across the ${supportProp} and blocks the ${primaryLabel} in one sudden beat.`,
      reactionBeat: `the ${primaryLabel} stops short against the blocked path`,
      aftermathBeat: `the ${secondaryLabel} now blocking the ${primaryLabel}`,
      preferredAftermath: 'block',
    },
    {
      id: 'light',
      trigger: `The ${supportProp} swings aside and exposes the ${secondaryLabel} in a hard beam beside the ${primaryLabel}.`,
      reactionBeat: `the ${primaryLabel} recoils from the sudden bright reveal`,
      aftermathBeat: `the newly lit ${secondaryLabel} beside the shifted ${primaryLabel}`,
      preferredAftermath: 'light',
    },
    {
      id: 'recovery',
      trigger: `The ${secondaryLabel} slips loose from the ${supportProp}, and the ${primaryLabel} lunges to catch it before it drops.`,
      reactionBeat: `the ${primaryLabel} braces the ${secondaryLabel} against the ${supportProp}`,
      aftermathBeat: `the ${secondaryLabel} now caught and steadied beside the ${primaryLabel}`,
      preferredAftermath: 'recovery',
    },
    {
      id: 'conceal',
      trigger: `The ${supportProp} swings in front of the ${secondaryLabel} and hides it from the ${primaryLabel} in one sudden beat.`,
      reactionBeat: `the ${primaryLabel} leans around the ${supportProp} trying to find the hidden ${secondaryLabel}`,
      aftermathBeat: `the ${secondaryLabel} now partly hidden behind the shifted ${supportProp}`,
      preferredAftermath: 'block',
    },
    {
      id: 'escape',
      trigger: `The ${secondaryLabel} slips free from the ${supportProp} and darts away, forcing the ${primaryLabel} to chase after it.`,
      reactionBeat: `the ${primaryLabel} lunges after the escaping ${secondaryLabel}`,
      aftermathBeat: `the ${secondaryLabel} now out of reach from the stretched ${primaryLabel}`,
      preferredAftermath: 'roll',
    },
    {
      id: 'repair',
      trigger: `While trying to straighten the ${supportProp}, the ${primaryLabel} knocks the ${secondaryLabel} into a new position in one awkward repair beat.`,
      reactionBeat: `the ${primaryLabel} freezes with one hand still on the ${supportProp}`,
      aftermathBeat: `the ${secondaryLabel} left in a newly fixed but obviously changed arrangement`,
      preferredAftermath: 'recovery',
    },
    {
      id: 'mistaken',
      trigger: `A shifted flap on the ${supportProp} makes the ${secondaryLabel} look like something else for a split second, and the ${primaryLabel} reacts to the mistaken appearance.`,
      reactionBeat: `the ${primaryLabel} jerks back before noticing what the ${secondaryLabel} really is`,
      aftermathBeat: `the ${secondaryLabel} now clearly revealed beside the moved ${supportProp}`,
      preferredAftermath: 'reveal',
    },
  ]

  const filteredPatterns = allowReveal
    ? patterns
    : patterns.filter((pattern) => pattern.id !== 'reveal')
  const finalPatterns = allowCollision
    ? filteredPatterns
    : filteredPatterns.filter((pattern) => pattern.id !== 'collision')

  return chooseDeterministicItem(
    finalPatterns,
    `${seed}|archetype`,
    finalPatterns[0]
  )
}

function withIndefiniteArticle(text) {
  const value = String(text || '').trim()
  if (!value) return ''
  return /^[aeiou]/i.test(value) ? `an ${value}` : `a ${value}`
}

function prependSeedToPanel(panelText, humanStorySeed) {
  const seed = normalizeHumanStorySeed(humanStorySeed)
  if (!seed) return panelText
  return `${seed} ${panelText}`
}

function isHumanLikeActorLabel(value) {
  const normalized = normalizeKeywordValue(value).trim().toLowerCase()
  if (!normalized) return false
  return /\b(person|man|woman|child|kid|boy|girl|pilot|king|queen|clown|nurse|doctor|teacher|officer|chef|farmer|worker)\b/.test(
    normalized
  )
}

function isCreatureLikeActorLabel(value) {
  const normalized = normalizeKeywordValue(value).trim().toLowerCase()
  if (!normalized) return false
  return /\b(dog|cat|bird|wolf|centaur|ghost|robot)\b/.test(normalized)
}

function isStoryActorLikeLabel(value) {
  return (
    isHumanLikeActorLabel(value) ||
    isCreatureLikeActorLabel(value) ||
    hasAnyKeywordHint(value, ACTOR_KEYWORD_HINTS)
  )
}

function inferRecurringSubjectLabel({
  storyPanels = [],
  keywordA = '',
  keywordB = '',
  senseSelection = null,
}) {
  const selection = getLockedSenseSelection(senseSelection, keywordA, keywordB)
  const firstSense = getLockedSense(selection, 'keyword_1', keywordA)
  const secondSense = getLockedSense(selection, 'keyword_2', keywordB)
  const panelText = normalizeStoryPanels(storyPanels).join(' ').toLowerCase()
  const actorCandidates = [
    getSensePromptLabel(firstSense, keywordA),
    getSensePromptLabel(secondSense, keywordB),
    normalizeKeywordValue(keywordA),
    normalizeKeywordValue(keywordB),
  ].filter(Boolean)

  const panelActorMatch = panelText.match(
    /\b(disappointed pilot|pilot|person|man|woman|child|kid|boy|girl|king|queen|clown|nurse|doctor|teacher|officer|chef|farmer|worker|ghost|wolf|centaur|robot|dog|cat|bird)\b/i
  )
  if (panelActorMatch && panelActorMatch[1]) {
    return String(panelActorMatch[1]).trim()
  }

  const humanCandidate = actorCandidates.find(isHumanLikeActorLabel)
  if (humanCandidate) return humanCandidate

  const creatureCandidate = actorCandidates.find(isCreatureLikeActorLabel)
  if (creatureCandidate) return creatureCandidate

  const genericActor = actorCandidates.find((candidate) =>
    hasAnyKeywordHint(candidate, ACTOR_KEYWORD_HINTS)
  )
  if (genericActor) return genericActor

  return 'person'
}

function buildPanelContinuityLines({
  storyPanels = [],
  keywordA = '',
  keywordB = '',
  senseSelection = null,
}) {
  const selection = getLockedSenseSelection(senseSelection, keywordA, keywordB)
  const firstSense = getLockedSense(selection, 'keyword_1', keywordA)
  const secondSense = getLockedSense(selection, 'keyword_2', keywordB)
  const subjectLabel = inferRecurringSubjectLabel({
    storyPanels,
    keywordA,
    keywordB,
    senseSelection,
  })
  const seed = `${normalizeStoryPanels(storyPanels).join(
    '|'
  )}|${keywordA}|${keywordB}|${firstSense.sense_id || 'sense1'}|${
    secondSense.sense_id || 'sense2'
  }`
  const recurringFirstLabel = getSensePromptLabel(firstSense, keywordA)
  const recurringSecondLabel = getSensePromptLabel(secondSense, keywordB)

  if (isHumanLikeActorLabel(subjectLabel)) {
    const hairDescriptor = chooseDeterministicItem(
      [
        'short dark hair',
        'curly brown hair',
        'neat black hair',
        'wavy dark hair',
      ],
      `${seed}|hair`,
      'short dark hair'
    )
    const outfitColor = chooseDeterministicItem(
      ['blue', 'green', 'red', 'mustard yellow'],
      `${seed}|outfit-color`,
      'blue'
    )
    const outfitPiece = chooseDeterministicItem(
      ['jacket', 'shirt', 'hoodie', 'coat'],
      `${seed}|outfit-piece`,
      'jacket'
    )
    const accent = chooseDeterministicItem(
      [
        'dark pants',
        'white sneakers',
        'a small shoulder bag',
        'rolled sleeves',
      ],
      `${seed}|accent`,
      'dark pants'
    )

    return [
      'Continuity anchor for the full 4-panel sequence:',
      `- Recurring subject: keep the same ${subjectLabel} in every panel where this character appears.`,
      `- Keep the same face, age, hair, and outfit colors in all panels. Use ${hairDescriptor}, a ${outfitColor} ${outfitPiece}, and ${accent}.`,
      `- Keep recurring keyword objects visually consistent too: the same ${recurringFirstLabel} design and the same ${recurringSecondLabel} design whenever they reappear.`,
      '- Keep the same background location, lighting family, and cartoon rendering style across all 4 panels; only the action, pose, camera distance, and visible story state should change.',
      '- Do not change clothing colors, face, hairstyle, or prop design between panels unless the story explicitly shows that change.',
    ]
  }

  if (isCreatureLikeActorLabel(subjectLabel)) {
    const markingDescriptor = chooseDeterministicItem(
      [
        'a pale blue glow',
        'dark ear tips',
        'a white chest patch',
        'a torn cloak edge',
      ],
      `${seed}|markings`,
      'a pale blue glow'
    )
    return [
      'Continuity anchor for the full 4-panel sequence:',
      `- Recurring subject: keep the same ${subjectLabel} in every panel where this character appears.`,
      `- Keep the same body shape, face, silhouette, and distinctive markings in all panels, including ${markingDescriptor}.`,
      `- Keep recurring keyword objects visually consistent too: the same ${recurringFirstLabel} design and the same ${recurringSecondLabel} design whenever they reappear.`,
      '- Keep the same background location, lighting family, and cartoon rendering style across all 4 panels; only the action, pose, camera distance, and visible story state should change.',
      '- Do not redesign the recurring creature or prop between panels unless the story explicitly shows that change.',
    ]
  }

  return [
    'Continuity anchor for the full 4-panel sequence:',
    `- Keep the same recurring subject or main prop design in every panel where it appears, anchored around ${withIndefiniteArticle(
      subjectLabel
    )}.`,
    `- Keep the same ${recurringFirstLabel} design and the same ${recurringSecondLabel} design whenever they reappear.`,
    '- Keep the same background location, lighting family, and cartoon rendering style across all 4 panels; only the action, pose, camera distance, and visible story state should change.',
    '- Do not change object colors, face-like features, shape language, or prop details between panels unless the story explicitly shows that change.',
  ]
}

function buildPanelDifferentiationLines(panelIndex, role) {
  const safeRole = String(role || '')
    .trim()
    .toLowerCase()
  const roleName = STORY_PANEL_ROLES[panelIndex] || safeRole || 'progression'

  if (roleName === 'before') {
    return [
      'Panel-specific differentiation:',
      '- Use an establishing view that clearly shows the place, the recurring subject, and both key props before the main change.',
      '- Keep this panel calmer and more intact than the later panels. Do not show the biggest consequence yet.',
    ]
  }

  if (roleName === 'trigger') {
    return [
      'Panel-specific differentiation:',
      '- Change the camera distance, angle, or crop from panel 1 so this panel captures the exact instant the trigger begins.',
      '- Show one crisp new contact, snag, reveal, blockage, or motion that was not visible in panel 1.',
    ]
  }

  if (roleName === 'reaction') {
    return [
      'Panel-specific differentiation:',
      '- Make this the peak visible consequence of the sequence, with the strongest motion, displacement, or reaction.',
      '- Make panel 3 the most visually dramatic frame. Do not let it look like a small variation of panel 2.',
    ]
  }

  if (roleName === 'after') {
    return [
      'Panel-specific differentiation:',
      '- Change the framing again so panel 4 reads as a settled aftermath, not a replay of panel 3.',
      '- Show the final changed layout at a glance with stable positions, open/revealed elements, or a clearly altered environment.',
    ]
  }

  return [
    'Panel-specific differentiation:',
    '- Change framing, pose, and visible state so this panel is clearly distinct from adjacent panels.',
  ]
}

function buildStoryboardDifferentiationLines() {
  return [
    'Panel-to-panel differentiation requirements:',
    '- Across the four quadrants, vary camera distance and framing: establishing setup, trigger moment, peak consequence, and settled aftermath.',
    '- Keep adjacent panels visibly different in pose, crop, object layout, and dominant action.',
    '- Do not let multiple quadrants look like the same room crop with only tiny expression changes.',
    '- Make panel 3 the most dramatic frame and panel 4 the clearest stable result frame.',
  ]
}

function isTruthyFlag(value) {
  if (typeof value === 'boolean') return value
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
  return (
    normalized === '1' ||
    normalized === 'true' ||
    normalized === 'yes' ||
    normalized === 'on'
  )
}

function shouldUsePythonFlipPipeline(payload = {}) {
  if (typeof payload.usePythonFlipPipeline === 'boolean') {
    return payload.usePythonFlipPipeline
  }
  if (payload.usePythonFlipPipeline != null) {
    return isTruthyFlag(payload.usePythonFlipPipeline)
  }
  return isTruthyFlag(process.env.IDENAAI_USE_PY_FLIP_PIPELINE)
}

function keywordTokenSet(value) {
  return new Set(
    String(value || '')
      .trim()
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .filter(Boolean)
  )
}

function hasAnyKeywordHint(value, hints) {
  const tokens = keywordTokenSet(value)
  for (const hint of hints) {
    if (tokens.has(hint)) {
      return true
    }
  }
  return false
}

function normalizeSemanticRole(value, fallback = 'object') {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
  return SEMANTIC_ROLE_VALUES.includes(normalized) ? normalized : fallback
}

function normalizeRiskLevel(value) {
  return String(value || '')
    .trim()
    .toLowerCase() === 'risk-bearing'
    ? 'risk-bearing'
    : 'neutral'
}

function classifyKeywordRole(value) {
  if (hasAnyKeywordHint(value, LOCATION_KEYWORD_HINTS)) {
    return 'location'
  }
  if (hasAnyKeywordHint(value, TOOL_KEYWORD_HINTS)) {
    return 'tool'
  }
  if (hasAnyKeywordHint(value, ACTOR_KEYWORD_HINTS)) {
    return 'actor'
  }
  return 'object'
}

function compileConceptKeyword(value) {
  const raw = normalizeKeywordValue(value)
  const key = String(raw || '')
    .trim()
    .toLowerCase()
  if (CONCEPT_REPRESENTATIONS[key]) {
    return {
      renderableKeyword: CONCEPT_REPRESENTATIONS[key],
      role: 'concept_representation',
    }
  }
  return {
    renderableKeyword: raw,
    role: classifyKeywordRole(raw),
  }
}

function buildPanelsFromPythonStory(story) {
  const sourcePanels =
    story && Array.isArray(story.panels) ? story.panels.slice(0, 4) : []
  while (sourcePanels.length < 4) {
    sourcePanels.push({})
  }
  return sourcePanels.map((panel, index) => {
    const value = panel && typeof panel === 'object' ? panel : {}
    const scene = String(
      value.scene_description || value.sceneDescription || ''
    )
      .trim()
      .replace(/\s+/g, ' ')
    const action = String(value.action || '')
      .trim()
      .replace(/\s+/g, ' ')
    const required = Array.isArray(value.required_visibles)
      ? value.required_visibles
          .map((entry) => normalizeKeywordValue(entry))
          .filter(Boolean)
          .slice(0, 4)
      : []
    const combined = [scene, action]
      .concat(required.length ? [`Visible: ${required.join(', ')}`] : [])
      .filter(Boolean)
      .join('. ')
    return normalizeStoryPanel(combined, index)
  })
}

function buildStoryOptionsFromPythonPipeline({
  keywordA,
  keywordB,
  includeNoise,
  storyPanels,
  semanticPlan = null,
}) {
  const normalizedPanels = normalizeStoryPanels(storyPanels)
  const semanticPromptLines = formatSemanticContractForPrompt(
    normalizeSemanticContract(
      semanticPlan,
      buildSemanticContract({keywordA, keywordB})
    )
  )
  const semanticPrompt = semanticPromptLines.join(' ')
  const primaryRationale = [
    'Generated by Python structured pipeline (semantic pre-processing + strict 4-panel schema).',
    semanticPrompt,
  ]
    .filter(Boolean)
    .join(' ')
    .trim()

  const primaryStory = normalizeStoryOption(
    {
      id: 'option-1',
      title: 'Option 1',
      panels: normalizedPanels,
      includeNoise,
      noisePanelIndex: includeNoise
        ? chooseNoisePanelIndex(`${keywordA}-${keywordB}`)
        : null,
      rationale: primaryRationale,
      storySummary: semanticPrompt
        ? `Safe semantic plan: ${semanticPrompt.slice(0, 220)}`
        : 'Safe semantic plan generated by Python pipeline.',
    },
    0
  )

  const fallbackStories = buildKeywordFallbackStories({
    keywordA,
    keywordB,
    includeNoise,
    customStory: normalizedPanels,
  })
  const secondaryBase =
    fallbackStories[1] ||
    normalizeStoryOption(
      {
        id: 'option-2',
        title: 'Option 2',
        panels: normalizedPanels.map((panel, idx) =>
          idx === 0 ? `${panel} (alternative opening)` : panel
        ),
        rationale: 'Alternative variant derived from Python semantic pipeline.',
      },
      1
    )

  const secondaryStory = normalizeStoryOption(
    {
      ...secondaryBase,
      id: 'option-2',
      title: String(secondaryBase.title || 'Option 2').trim() || 'Option 2',
      rationale: [
        'Alternative variant derived from Python semantic pipeline.',
        String(secondaryBase.rationale || '').trim(),
      ]
        .filter(Boolean)
        .join(' | '),
    },
    1
  )

  return [primaryStory, secondaryStory]
}

async function runPythonFlipStoryPipelineDefault({
  keywordA,
  keywordB,
  provider = PROVIDERS.OpenAI,
  timeoutMs = DEFAULT_PYTHON_FLIP_PIPELINE_TIMEOUT_MS,
}) {
  const scriptExists = await fs.pathExists(PYTHON_FLIP_PIPELINE_SCRIPT)
  if (!scriptExists) {
    throw new Error(
      `Python pipeline script not found: ${PYTHON_FLIP_PIPELINE_SCRIPT}`
    )
  }

  const args = [
    PYTHON_FLIP_PIPELINE_SCRIPT,
    normalizeKeywordValue(keywordA) || '-',
    normalizeKeywordValue(keywordB) || '-',
    '--story-only',
    '--provider',
    provider === PROVIDERS.Gemini ? 'gemini' : 'openai',
  ]

  const python = resolvePythonInterpreterCommand()
  const {stdout} = await execFileAsync(
    python.command,
    python.args.concat(args),
    {
      timeout: Math.max(
        5000,
        Number(timeoutMs) || DEFAULT_PYTHON_FLIP_PIPELINE_TIMEOUT_MS
      ),
      maxBuffer: 4 * 1024 * 1024,
      cwd: path.dirname(PYTHON_FLIP_PIPELINE_SCRIPT),
    }
  )

  const parsed = extractJsonBlock(stdout)
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Python pipeline returned invalid JSON payload')
  }

  const storyPanels = buildPanelsFromPythonStory(parsed.story || {})
  if (!hasMeaningfulStoryPanels(storyPanels)) {
    throw new Error('Python pipeline returned low-value story panels')
  }

  return {
    semanticPlan:
      parsed.semantic_plan && typeof parsed.semantic_plan === 'object'
        ? parsed.semantic_plan
        : null,
    storyPanels,
    raw: parsed,
  }
}

function makeSafeUseContext({
  keyword,
  role,
  riskLevel,
  defaultSafeContext = 'N/A',
}) {
  if (riskLevel !== 'risk-bearing') {
    return defaultSafeContext
  }

  const normalized = String(keyword || '')
    .trim()
    .toLowerCase()
  if (normalized.includes('chainsaw') || normalized.includes('saw')) {
    return 'Bright woodworking studio, protective goggles and gloves, cutting only a wooden log.'
  }
  if (
    normalized.includes('knife') ||
    normalized.includes('blade') ||
    normalized.includes('machete')
  ) {
    return 'Culinary classroom, chef supervision, cutting vegetables on a board.'
  }
  if (
    normalized.includes('gun') ||
    normalized.includes('rifle') ||
    normalized.includes('pistol')
  ) {
    return 'Sports range safety drill with empty training prop and instructor supervision.'
  }
  if (normalized.includes('fire') || normalized.includes('explosive')) {
    return 'Controlled safety demonstration zone with extinguisher and trained supervisor.'
  }
  if (normalized.includes('poison')) {
    return 'Laboratory safety lesson with sealed hazard container and protective equipment.'
  }

  if (role === 'tool') {
    return 'Professional workshop environment with protective gear and supervised safe-use handling.'
  }
  return 'Well-lit public setting with harmless everyday task and no threat cues.'
}

function resolveDisjointRoles(roleA, roleB) {
  const normalizedA = normalizeSemanticRole(roleA, 'object')
  const normalizedB = normalizeSemanticRole(roleB, 'object')

  if (normalizedA !== normalizedB) {
    return [normalizedA, normalizedB]
  }

  if (normalizedA === 'actor') {
    return ['actor', 'object']
  }
  if (normalizedA === 'tool') {
    return ['tool', 'object']
  }
  if (normalizedA === 'location') {
    return ['location', 'object']
  }
  if (normalizedA === 'concept_representation') {
    return ['concept_representation', 'object']
  }

  return [normalizedA, normalizedB]
}

function buildOverarchingIntent({
  keywordA,
  keywordB,
  roleA,
  roleB,
  humanStorySeed,
  riskLevelA,
  riskLevelB,
}) {
  const seed = normalizeHumanStorySeed(humanStorySeed)
  if (seed) {
    return `Use this human seed as the safe narrative anchor: ${seed}`
  }

  if (riskLevelA === 'risk-bearing' || riskLevelB === 'risk-bearing') {
    return `Create a harmless supervised task where ${keywordA} and ${keywordB} stay clearly visible throughout one causal sequence.`
  }

  if (roleA === 'actor' && roleB === 'tool') {
    return `${keywordA} uses ${keywordB} to complete an everyday practical task with clear before-action-after progression.`
  }
  if (roleA === 'location' || roleB === 'location') {
    return `One simple event chain unfolds in a stable location where ${keywordA} and ${keywordB} remain visible.`
  }
  return `Build a literal physical cause-effect sequence connecting ${keywordA} and ${keywordB}.`
}

function buildSemanticContract({keywordA, keywordB, humanStorySeed = ''}) {
  const firstKeyword = normalizeKeywordValue(keywordA)
  const secondKeyword = normalizeKeywordValue(keywordB)

  const firstCompiled = compileConceptKeyword(firstKeyword)
  const secondCompiled = compileConceptKeyword(secondKeyword)
  const riskLevelA = hasAnyKeywordHint(firstKeyword, RISK_BEARING_KEYWORD_HINTS)
    ? 'risk-bearing'
    : 'neutral'
  const riskLevelB = hasAnyKeywordHint(
    secondKeyword,
    RISK_BEARING_KEYWORD_HINTS
  )
    ? 'risk-bearing'
    : 'neutral'
  const [roleA, roleB] = resolveDisjointRoles(
    firstCompiled.role,
    secondCompiled.role
  )

  const safeContextA = makeSafeUseContext({
    keyword: firstKeyword,
    role: roleA,
    riskLevel: riskLevelA,
  })
  const safeContextB = makeSafeUseContext({
    keyword: secondKeyword,
    role: roleB,
    riskLevel: riskLevelB,
    defaultSafeContext: safeContextA,
  })

  const mergedSafeContext =
    safeContextA !== 'N/A' || safeContextB !== 'N/A'
      ? [safeContextA, safeContextB]
          .filter(Boolean)
          .filter((value, index, list) => list.indexOf(value) === index)
          .join(' ')
      : 'N/A'

  return {
    keyword_1_analysis: {
      keyword: firstKeyword || 'keyword-1',
      renderable_keyword: firstCompiled.renderableKeyword || firstKeyword,
      role: roleA,
      risk_level: riskLevelA,
      safe_use_context: safeContextA,
    },
    keyword_2_analysis: {
      keyword: secondKeyword || 'keyword-2',
      renderable_keyword: secondCompiled.renderableKeyword || secondKeyword,
      role: roleB,
      risk_level: riskLevelB,
      safe_use_context: safeContextB,
    },
    safe_use_context: mergedSafeContext,
    overarching_intent: buildOverarchingIntent({
      keywordA: firstKeyword || 'keyword-1',
      keywordB: secondKeyword || 'keyword-2',
      roleA,
      roleB,
      humanStorySeed,
      riskLevelA,
      riskLevelB,
    }),
  }
}

function normalizeSemanticKeywordAnalysis(value, fallbackKeyword) {
  const item = value && typeof value === 'object' ? value : {}
  const keyword = normalizeKeywordValue(item.keyword || fallbackKeyword)
  const renderableKeyword = normalizeKeywordValue(
    item.renderable_keyword || item.renderableKeyword || keyword
  )
  return {
    keyword: keyword || fallbackKeyword,
    renderable_keyword: renderableKeyword || keyword || fallbackKeyword,
    role: normalizeSemanticRole(item.role, classifyKeywordRole(keyword)),
    risk_level: normalizeRiskLevel(item.risk_level || item.riskLevel),
    safe_use_context: String(item.safe_use_context || item.safeUseContext || '')
      .trim()
      .slice(0, 260),
  }
}

function normalizeSemanticContract(value, fallbackContract) {
  const fallback =
    fallbackContract && typeof fallbackContract === 'object'
      ? fallbackContract
      : buildSemanticContract({keywordA: 'keyword-1', keywordB: 'keyword-2'})
  const raw = value && typeof value === 'object' ? value : {}

  const first = normalizeSemanticKeywordAnalysis(
    raw.keyword_1_analysis || raw.keyword1 || raw.keywordA,
    fallback.keyword_1_analysis.keyword
  )
  const second = normalizeSemanticKeywordAnalysis(
    raw.keyword_2_analysis || raw.keyword2 || raw.keywordB,
    fallback.keyword_2_analysis.keyword
  )
  const [roleA, roleB] = resolveDisjointRoles(first.role, second.role)

  return {
    keyword_1_analysis: {
      ...first,
      role: roleA,
    },
    keyword_2_analysis: {
      ...second,
      role: roleB,
    },
    safe_use_context: String(raw.safe_use_context || raw.safeUseContext || '')
      .trim()
      .slice(0, 320),
    overarching_intent: String(
      raw.overarching_intent || raw.overarchingIntent || ''
    )
      .trim()
      .slice(0, 420),
  }
}

function _mergeSemanticContract(rawText, fallbackContract) {
  const fallback =
    fallbackContract && typeof fallbackContract === 'object'
      ? fallbackContract
      : null
  if (!fallback) return null

  try {
    const parsed = extractJsonBlock(rawText) || {}
    const source =
      parsed &&
      parsed.semantic_pre_processing &&
      typeof parsed.semantic_pre_processing === 'object'
        ? parsed.semantic_pre_processing
        : parsed
    return normalizeSemanticContract(source, fallback)
  } catch (error) {
    return fallback
  }
}

function formatSemanticContractForPrompt(contract) {
  if (!contract || typeof contract !== 'object') {
    return []
  }
  const first = contract.keyword_1_analysis || {}
  const second = contract.keyword_2_analysis || {}
  const safeContext =
    String(contract.safe_use_context || '').trim() ||
    [first.safe_use_context, second.safe_use_context]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .filter((value, index, list) => list.indexOf(value) === index)
      .join(' ')

  return [
    'Semantic pre-processing contract (must be preserved):',
    `- Keyword 1: ${first.keyword || '-'} | role=${
      first.role || 'object'
    } | renderable=${first.renderable_keyword || first.keyword || '-'} | risk=${
      first.risk_level || 'neutral'
    }`,
    `- Keyword 2: ${second.keyword || '-'} | role=${
      second.role || 'object'
    } | renderable=${
      second.renderable_keyword || second.keyword || '-'
    } | risk=${second.risk_level || 'neutral'}`,
    safeContext && safeContext !== 'N/A'
      ? `- Safe-use context: ${safeContext}`
      : '- Safe-use context: N/A',
    String(contract.overarching_intent || '').trim()
      ? `- Overarching intent: ${String(contract.overarching_intent).trim()}`
      : '',
  ].filter(Boolean)
}

function normalizeStoryPanel(value, index) {
  const text =
    value && typeof value === 'object'
      ? String(
          value.description ||
            value.text ||
            value.panelText ||
            value.panel_text ||
            value.caption ||
            ''
        )
      : String(value || '')
  const normalized = reduceStoryBoilerplate(text.trim().replace(/\s+/g, ' '))
  if (normalized) {
    return normalized
  }
  return `Panel ${index + 1}: add a clear event in the story.`
}

function normalizeStoryPanels(value) {
  const source = Array.isArray(value) ? value.slice(0, 4) : []
  while (source.length < 4) {
    source.push('')
  }
  return source.map((item, index) => normalizeStoryPanel(item, index))
}

function normalizeStoryPanelDetail(value, index) {
  const item = value && typeof value === 'object' ? value : {}
  const requiredVisibles = Array.isArray(
    item.requiredVisibles || item.required_visibles
  )
    ? (item.requiredVisibles || item.required_visibles)
        .map((entry) => String(entry || '').trim())
        .filter(Boolean)
        .slice(0, 5)
    : []
  const role =
    String(item.role || STORY_PANEL_ROLES[index] || '')
      .trim()
      .toLowerCase() ||
    STORY_PANEL_ROLES[index] ||
    `panel_${index + 1}`
  return {
    panel: index + 1,
    role,
    description: normalizeStoryPanel(value, index),
    requiredVisibles,
    stateChangeFromPrevious: String(
      item.stateChangeFromPrevious || item.state_change_from_previous || ''
    ).trim(),
  }
}

function normalizeStoryOption(value, index) {
  const item = value && typeof value === 'object' ? value : {}
  const title =
    String(
      item.title || item.final_story_title || item.finalStoryTitle || ''
    ).trim() || `Option ${index + 1}`
  const storySummary = String(
    item.storySummary || item.story_summary || ''
  ).trim()
  let complianceSource = {}
  if (
    item.complianceReport &&
    typeof item.complianceReport === 'object' &&
    !Array.isArray(item.complianceReport)
  ) {
    complianceSource = item.complianceReport
  } else if (
    item.compliance_report &&
    typeof item.compliance_report === 'object' &&
    !Array.isArray(item.compliance_report)
  ) {
    complianceSource = item.compliance_report
  }
  const complianceReport = STORY_COMPLIANCE_KEYS.reduce((acc, key) => {
    const rawValue = String(complianceSource[key] || '')
      .trim()
      .toLowerCase()
    if (rawValue === 'pass' || rawValue === 'fail') {
      acc[key] = rawValue
    } else if (
      complianceSource[key] === true ||
      rawValue === 'true' ||
      rawValue === 'ok'
    ) {
      acc[key] = 'pass'
    } else if (complianceSource[key] === false || rawValue === 'false') {
      acc[key] = 'fail'
    }
    return acc
  }, {})
  let riskSource = []
  if (Array.isArray(item.riskFlags)) {
    riskSource = item.riskFlags
  } else if (Array.isArray(item.risk_flags)) {
    riskSource = item.risk_flags
  }
  const riskFlags = riskSource
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .slice(0, 6)
  const revisionIfRisky = String(
    item.revisionIfRisky || item.revision_if_risky || ''
  ).trim()
  const failedChecks = Object.entries(complianceReport)
    .filter(([, status]) => status === 'fail')
    .map(([key]) => key)
  const autoRationale = []
  if (failedChecks.length) {
    autoRationale.push(`failed checks: ${failedChecks.join(', ')}`)
  }
  if (riskFlags.length) {
    autoRationale.push(`risk flags: ${riskFlags.join('; ')}`)
  }
  const rationale =
    String(item.rationale || '').trim() || autoRationale.join(' | ')
  const editingTip = String(item.editingTip || item.editing_tip || '').trim()
  const panelSource = Array.isArray(item.panels) ? item.panels.slice(0, 4) : []
  while (panelSource.length < 4) {
    panelSource.push('')
  }
  const panelDetails = panelSource.map((panel, panelIndex) =>
    normalizeStoryPanelDetail(panel, panelIndex)
  )
  let senseSelection = null
  if (item.senseSelection && typeof item.senseSelection === 'object') {
    senseSelection = item.senseSelection
  } else if (item.sense_selection && typeof item.sense_selection === 'object') {
    senseSelection = item.sense_selection
  } else if (item.semanticLock && typeof item.semanticLock === 'object') {
    senseSelection = item.semanticLock
  } else if (item.semantic_lock && typeof item.semantic_lock === 'object') {
    senseSelection = item.semantic_lock
  }

  let qualityReport = null
  if (item.qualityReport && typeof item.qualityReport === 'object') {
    qualityReport = item.qualityReport
  } else if (item.quality_report && typeof item.quality_report === 'object') {
    qualityReport = item.quality_report
  }

  return {
    id: String(item.id || `option-${index + 1}`),
    title,
    panels: panelDetails.map((panel) => panel.description),
    panelDetails,
    includeNoise: Boolean(item.includeNoise),
    noisePanelIndex: Number.isFinite(Number(item.noisePanelIndex))
      ? Math.max(0, Math.min(3, Number(item.noisePanelIndex)))
      : null,
    rationale,
    editingTip,
    isStoryboardStarter: Boolean(
      item.isStoryboardStarter || item.is_storyboard_starter
    ),
    isProviderEditableDraft: Boolean(
      item.isProviderEditableDraft || item.is_provider_editable_draft
    ),
    storySummary,
    complianceReport,
    riskFlags,
    revisionIfRisky,
    senseSelection,
    qualityReport,
  }
}

function parseStrictStoryOptions(rawText, expectedStoryCount = 2) {
  const text = String(rawText || '').trim()
  const normalizedStoryCount = normalizeStoryOptionCount(expectedStoryCount)
  if (!text) {
    return {
      ok: false,
      errorType: 'empty_response',
      error: 'Empty provider response',
      errors: ['Empty provider response'],
    }
  }

  let parsed = null
  try {
    parsed = extractJsonBlock(text)
  } catch (error) {
    return {
      ok: false,
      errorType: 'json_extract',
      error: String((error && error.message) || error || '').trim(),
      errors: [String((error && error.message) || error || '').trim()],
    }
  }

  const validation = validateStoryOptionsPayload(parsed, normalizedStoryCount)
  if (!validation.ok) {
    return {
      ok: false,
      errorType: 'schema_validation',
      error: validation.error,
      errors: validation.errors,
      parsed,
    }
  }

  return {
    ok: true,
    parsed,
    stories: parsed.stories
      .slice(0, normalizedStoryCount)
      .map((story, index) => normalizeStoryOption(story, index)),
  }
}

const STORY_PROVIDER_OUTCOMES = {
  SUCCESS: 'schema_valid_success',
  SCHEMA_INVALID: 'schema_invalid',
  REFUSAL: 'refusal',
  SAFETY_BLOCK: 'safety_block',
  TRUNCATION: 'truncation',
  TRANSPORT_ERROR: 'transport_error',
}

function createStoryStructuredOutputOptions(provider, expectedStoryCount = 2) {
  const normalizedStoryCount = normalizeStoryOptionCount(expectedStoryCount)
  if (isOpenAiCompatibleProvider(provider)) {
    return {
      responseFormat:
        createStoryOptionsOpenAiResponseFormat(normalizedStoryCount),
    }
  }

  if (provider === PROVIDERS.Gemini) {
    return {
      responseSchema:
        createStoryOptionsGeminiResponseSchema(normalizedStoryCount),
    }
  }

  return null
}

function sanitizeStoryLogText(value, limit = 280) {
  const max = Number.isFinite(Number(limit)) ? Math.max(40, Number(limit)) : 280
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, max)
}

function buildStorySchemaRetryPrompt(
  basePrompt,
  strictParseResult,
  expectedStoryCount = 2
) {
  const parseResult =
    strictParseResult && typeof strictParseResult === 'object'
      ? strictParseResult
      : {}
  const normalizedStoryCount = normalizeStoryOptionCount(expectedStoryCount)
  const errorDetail = sanitizeStoryLogText(
    parseResult.error || parseResult.errorType || 'schema validation failed',
    220
  )

  return [
    basePrompt,
    '',
    'Schema retry:',
    'The previous response did not match the required strict JSON schema.',
    `Return exactly ${normalizedStoryCount} story option${
      normalizedStoryCount === 1 ? '' : 's'
    } and nothing else.`,
    normalizedStoryCount === 1
      ? 'Each story must include title, story_summary, and 4 panel objects. compliance_report, risk_flags, and revision_if_risky are optional in single-story mode.'
      : 'Each story must include title, story_summary, 4 panel objects, compliance_report, risk_flags, and revision_if_risky.',
    'Each panel must be an object with: panel, role, description, required_visibles, state_change_from_previous.',
    'Panel roles must be exactly: before, trigger, reaction, after.',
    'Do not return panels as plain strings.',
    `Previous schema error: ${errorDetail}`,
    'Return strict JSON only. No markdown, commentary, or code fences.',
  ].join('\n')
}

function buildStorySafeReinterpretationPrompt({
  basePrompt,
  keywordA,
  keywordB,
  outcome = '',
  outcomeDetail = '',
}) {
  const safeKeywordA = normalizeKeywordValue(keywordA) || '-'
  const safeKeywordB = normalizeKeywordValue(keywordB) || '-'
  const normalizedOutcome = String(outcome || '').trim() || 'refusal'
  const detail = sanitizeStoryLogText(outcomeDetail, 220)

  return [
    basePrompt,
    '',
    'Safe reinterpretation retry:',
    `The previous attempt hit a ${normalizedOutcome} or policy concern.`,
    `Preserve both keywords visibly: "${safeKeywordA}" and "${safeKeywordB}".`,
    'Preserve the locked senses already provided above. Do not drift to new meanings.',
    'Apply only minimal safety reframing needed to avoid refusal.',
    'Keep ordinary fear, tension, surprise, creepy atmosphere, safe tool use, and non-graphic conflict if they help clarity.',
    'If a risky tool, fire, or weapon appears, keep it visible in a non-graphic context with no direct harm to a person or animal.',
    'Do not flatten the scene into a generic harmless non-event.',
    'Keep the same strict JSON schema and explicit before -> trigger -> reaction -> after progression.',
    detail ? `Previous refusal/block detail: ${detail}` : '',
    'Return strict JSON only. No markdown, apology, or policy explanation.',
  ]
    .filter(Boolean)
    .join('\n')
}

function buildStoryOptionRepairPrompt({
  basePrompt,
  keywordA,
  keywordB,
  existingStories = [],
  missingCount = 1,
  requestedStoryCount = 2,
}) {
  const safeKeywordA = normalizeKeywordValue(keywordA) || '-'
  const safeKeywordB = normalizeKeywordValue(keywordB) || '-'
  const normalizedRequestedCount =
    normalizeStoryOptionCount(requestedStoryCount)
  const normalizedMissingCount = Math.max(1, Number(missingCount) || 1)
  const keptConcepts = (Array.isArray(existingStories) ? existingStories : [])
    .slice(0, normalizedRequestedCount)
    .map((story, index) => {
      const concept = storyOptionToMainPromptConcept(
        story,
        safeKeywordA,
        safeKeywordB
      )
      return `Kept concept ${index + 1}:\n${concept}`
    })
    .join('\n\n')

  return [
    basePrompt,
    '',
    'Option repair retry:',
    `The previous attempt produced fewer than ${normalizedRequestedCount} usable story option${
      normalizedRequestedCount === 1 ? '' : 's'
    } after validation. We still need ${normalizedMissingCount} more strong option${
      normalizedMissingCount === 1 ? '' : 's'
    }.`,
    `Keep both keywords visible: "${safeKeywordA}" and "${safeKeywordB}".`,
    'Preserve the locked senses already provided above.',
    `Return exactly ${normalizedMissingCount} fresh option${
      normalizedMissingCount === 1 ? '' : 's'
    } in the same strict JSON schema, but make ${
      normalizedMissingCount === 1 ? 'it' : 'them'
    } genuinely different from any kept concept listed below.`,
    'Change the scene, trigger, prop, or aftermath instead of rephrasing the same setup.',
    keptConcepts
      ? `Already kept concepts to avoid duplicating:\n${keptConcepts}`
      : '',
    'Return strict JSON only. No markdown, commentary, or explanation.',
  ]
    .filter(Boolean)
    .join('\n')
}

function buildSingleStoryDraftRescuePrompt({
  keywordA,
  keywordB,
  senseSelection,
}) {
  const safeKeywordA = normalizeKeywordValue(keywordA) || 'keyword 1'
  const safeKeywordB = normalizeKeywordValue(keywordB) || 'keyword 2'
  const lockedSenseLines = formatSensePromptLines(
    senseSelection,
    safeKeywordA,
    safeKeywordB
  )

  return [
    'Provider draft rescue:',
    'Return exactly 4 plain storyboard lines only.',
    'Each line must be one real panel beat in order: before, trigger, reaction, after.',
    'Write an actual storyboard, not JSON, not instructions to the user, and not meta commentary.',
    'Do not say things like "choose a room", "bring X into the scene", or "show the consequence".',
    'Use one specific place, one visible trigger, one concrete physical consequence, and one final stable image.',
    `Keep "${safeKeywordA}" and "${safeKeywordB}" visibly important in the actual scene.`,
    ...buildSingleStoryPairFitLines(senseSelection, safeKeywordA, safeKeywordB),
    'No numbering, no labels, no markdown, no JSON, and no commentary.',
    ...lockedSenseLines,
  ].join('\n')
}

function buildSingleStoryLastChanceRescuePrompt({
  keywordA,
  keywordB,
  senseSelection,
  customStory,
}) {
  const safeKeywordA = normalizeKeywordValue(keywordA) || 'keyword 1'
  const safeKeywordB = normalizeKeywordValue(keywordB) || 'keyword 2'
  const lockedSenseLines = formatSensePromptLines(
    senseSelection,
    safeKeywordA,
    safeKeywordB
  )
  const baseStory = normalizeStoryPanels(customStory)
  const customStoryHint =
    baseStory.length > 0
      ? `If useful, keep the user's draft direction but rewrite it into better visual beats:
1) ${baseStory[0]}
2) ${baseStory[1]}
3) ${baseStory[2]}
4) ${baseStory[3]}`
      : ''

  return [
    'Last-chance provider storyboard rescue:',
    'Write one usable 4-panel silent storyboard for a human editor.',
    'Return exactly 4 plain lines only.',
    `Keywords: "${safeKeywordA}" and "${safeKeywordB}".`,
    'Line 1: specific setup in one place.',
    'Line 2: the exact trigger that visibly changes the scene.',
    'Line 3: the strongest visible consequence.',
    'Line 4: a stable final aftermath that is obvious at a glance.',
    'Use varied visible consequence types: blocked routes, bright exposure, snapped straps, doors swinging open, rolling objects, bent props, tangles, reveals, recovery beats, or occasional spills.',
    ...buildSingleStoryPairFitLines(senseSelection, safeKeywordA, safeKeywordB),
    'Forbidden filler: "choose a room", "bring X into the scene", "show the consequence", "interacts with both", "uses X as a tool", "observes the final result".',
    'No numbering, no labels, no markdown, no JSON, no commentary.',
    ...lockedSenseLines,
    customStoryHint,
  ]
    .filter(Boolean)
    .join('\n')
}

function buildSingleStoryScaffoldRewritePrompt({
  keywordA,
  keywordB,
  senseSelection,
  scaffoldPanels = [],
}) {
  const safeKeywordA = normalizeKeywordValue(keywordA) || 'keyword 1'
  const safeKeywordB = normalizeKeywordValue(keywordB) || 'keyword 2'
  const lockedSenseLines = formatSensePromptLines(
    senseSelection,
    safeKeywordA,
    safeKeywordB
  )
  const normalizedScaffold = normalizeStoryPanels(scaffoldPanels)
  const scaffoldText = normalizedScaffold
    .map((panel, index) => `${index + 1}) ${panel}`)
    .join('\n')

  return [
    'Concrete storyboard rewrite:',
    'Rewrite the weak scaffold below into one actual 4-panel silent storyboard.',
    'Return exactly 4 plain storyboard lines only.',
    'Each line must describe what is visibly happening in that panel, not give instructions to the user.',
    `Keep "${safeKeywordA}" and "${safeKeywordB}" visibly important in the scene.`,
    'Use one specific place, one visible trigger, one concrete physical consequence, and one stable final aftermath.',
    'Do not default every rewrite to an object spilling. Other good outcomes are blocked routes, doors swinging open, props hanging crooked, straps tangling, lights turning, repaired arrangements, curtains falling, or objects rolling away.',
    'Bad: "Pick one specific actor or object and one specific place..."',
    'Bad: "Use X as the trigger that makes the scene change..."',
    'Good: "At an airport gate, a disappointed pilot sets a milk carton on a rolling suitcase."',
    'Good: "The suitcase clips a curtain cord, the curtain tears loose, and the milk carton ends up wedged under the seat frame."',
    ...buildSingleStoryPairFitLines(senseSelection, safeKeywordA, safeKeywordB),
    'No numbering, no labels, no markdown, no JSON, and no commentary.',
    ...lockedSenseLines,
    'Weak scaffold to rewrite:',
    scaffoldText,
  ]
    .filter(Boolean)
    .join('\n')
}

function buildSingleStorySpecificityRewritePrompt({
  keywordA,
  keywordB,
  senseSelection,
  draftPanels = [],
}) {
  const safeKeywordA = normalizeKeywordValue(keywordA) || 'keyword 1'
  const safeKeywordB = normalizeKeywordValue(keywordB) || 'keyword 2'
  const lockedSenseLines = formatSensePromptLines(
    senseSelection,
    safeKeywordA,
    safeKeywordB
  )
  const normalizedDraft = normalizeStoryPanels(draftPanels)
  const draftText = normalizedDraft
    .map((panel, index) => `${index + 1}) ${panel}`)
    .join('\n')

  return [
    'Specificity rewrite:',
    'Rewrite the readable but too-neutral storyboard below into one more vivid 4-panel silent storyboard.',
    'Keep the same core causal idea when possible, but make the beats more specific and imageable.',
    'Return exactly 4 plain storyboard lines only.',
    'Each line must describe one panel beat: before, trigger, reaction, after.',
    `Keep "${safeKeywordA}" and "${safeKeywordB}" visibly important in the actual scene.`,
    'Add a real place, a clearer actor or prop anchor, a crisper trigger, and a more specific final aftermath.',
    'Replace generic phrases like "interacts with", "uses as a tool", or "observes the result" with concrete visible actions.',
    'Do not default to overturned furniture, toppled props, or spills when a blocked route, bright reveal, repaired setup, stable separation, or clearer visible aftermath would read better.',
    ...buildSingleStoryPairFitLines(senseSelection, safeKeywordA, safeKeywordB),
    'No numbering, no labels, no markdown, no JSON, and no commentary.',
    ...lockedSenseLines,
    'Readable but weak draft to rewrite more specifically:',
    draftText,
  ]
    .filter(Boolean)
    .join('\n')
}

function classifyTextualStoryProviderOutcome(rawText) {
  const text = String(rawText || '').trim()
  if (!text) return null
  if (text.startsWith('{') || text.startsWith('[')) {
    return null
  }

  const normalized = text.toLowerCase()

  if (
    /content policy|safety policy|blocked due to safety|violates?.{0,30}(policy|safety)|graphic violence|explicit sexual content|weapon harm against/i.test(
      normalized
    )
  ) {
    return STORY_PROVIDER_OUTCOMES.SAFETY_BLOCK
  }

  if (
    /i('| a)?m sorry|sorry,? but|i cannot|i can't|i won('| no)?t|unable to|not able to|must decline|cannot comply|can't help with that/i.test(
      normalized
    )
  ) {
    return STORY_PROVIDER_OUTCOMES.REFUSAL
  }

  return null
}

function classifyStoryProviderOutcome({normalizedResponse, strictParse}) {
  const response =
    normalizedResponse && typeof normalizedResponse === 'object'
      ? normalizedResponse
      : {}
  const providerMeta =
    response.providerMeta && typeof response.providerMeta === 'object'
      ? response.providerMeta
      : {}
  const textualOutcome = classifyTextualStoryProviderOutcome(response.rawText)
  const refusalDetail = sanitizeStoryLogText(providerMeta.refusal || '', 220)
  const blockReason = sanitizeStoryLogText(
    providerMeta.blockReason || providerMeta.finishReason || '',
    120
  )

  if (
    providerMeta.safetyBlock ||
    textualOutcome === STORY_PROVIDER_OUTCOMES.SAFETY_BLOCK
  ) {
    return {
      outcome: STORY_PROVIDER_OUTCOMES.SAFETY_BLOCK,
      detail: refusalDetail || blockReason || 'Provider safety block',
      providerMeta,
      strictParse,
    }
  }

  if (
    providerMeta.refusal ||
    textualOutcome === STORY_PROVIDER_OUTCOMES.REFUSAL
  ) {
    return {
      outcome: STORY_PROVIDER_OUTCOMES.REFUSAL,
      detail: refusalDetail || 'Provider refusal',
      providerMeta,
      strictParse,
    }
  }

  if (providerMeta.truncated) {
    return {
      outcome: STORY_PROVIDER_OUTCOMES.TRUNCATION,
      detail: blockReason || 'Provider output truncated',
      providerMeta,
      strictParse,
    }
  }

  if (strictParse && strictParse.ok) {
    return {
      outcome: STORY_PROVIDER_OUTCOMES.SUCCESS,
      detail: '',
      providerMeta,
      strictParse,
    }
  }

  return {
    outcome: STORY_PROVIDER_OUTCOMES.SCHEMA_INVALID,
    detail: sanitizeStoryLogText(
      strictParse && (strictParse.error || strictParse.errorType),
      220
    ),
    providerMeta,
    strictParse,
  }
}

function createStoryGenerationMetrics() {
  return {
    parse_fail: 0,
    audit_fail: 0,
    fallback_used: false,
    safe_replan_used: false,
    low_concreteness_fail: 0,
    weak_progression_fail: 0,
    retries_per_story: 0,
    total_latency_ms: 0,
  }
}

function recordStoryQualityMetrics(metrics, qualityReport) {
  const target = metrics && typeof metrics === 'object' ? metrics : null
  const report =
    qualityReport && typeof qualityReport === 'object' ? qualityReport : null
  if (!target || !report || !report.metrics) {
    return
  }
  if (report.metrics.lowConcretenessFail) {
    target.low_concreteness_fail += 1
  }
  if (report.metrics.weakProgressionFail) {
    target.weak_progression_fail += 1
  }
}

function sortStoriesByQuality(stories) {
  return (Array.isArray(stories) ? stories.slice() : []).sort((left, right) => {
    const leftScore =
      left &&
      left.qualityReport &&
      Number.isFinite(Number(left.qualityReport.score))
        ? Number(left.qualityReport.score)
        : -1
    const rightScore =
      right &&
      right.qualityReport &&
      Number.isFinite(Number(right.qualityReport.score))
        ? Number(right.qualityReport.score)
        : -1
    return rightScore - leftScore
  })
}

function dedupeStoriesForSelection(stories) {
  const seen = new Set()
  const deduped = []

  ;(Array.isArray(stories) ? stories : []).forEach((story) => {
    if (!story || typeof story !== 'object') {
      return
    }
    const details = Array.isArray(story.panelDetails)
      ? story.panelDetails.slice(0, 4)
      : []
    const signature = JSON.stringify(
      details.map((panel, index) => ({
        role: String(
          panel && panel.role ? panel.role : STORY_PANEL_ROLES[index]
        )
          .trim()
          .toLowerCase(),
        description: String(panel && panel.description ? panel.description : '')
          .trim()
          .toLowerCase(),
        stateChangeFromPrevious: String(
          panel && panel.stateChangeFromPrevious
            ? panel.stateChangeFromPrevious
            : ''
        )
          .trim()
          .toLowerCase(),
      }))
    )
    if (seen.has(signature)) {
      return
    }
    seen.add(signature)
    deduped.push(story)
  })

  return deduped
}

function createStoryQualityCacheKey(story) {
  const item = story && typeof story === 'object' ? story : {}
  const panelDetails = Array.isArray(item.panelDetails)
    ? item.panelDetails.slice(0, 4)
    : []

  return JSON.stringify({
    title: String(item.title || '')
      .trim()
      .toLowerCase(),
    storySummary: String(item.storySummary || '')
      .trim()
      .toLowerCase(),
    panels: panelDetails.map((panel, index) => ({
      role: String(panel && panel.role ? panel.role : STORY_PANEL_ROLES[index])
        .trim()
        .toLowerCase(),
      description: String(panel && panel.description ? panel.description : '')
        .trim()
        .toLowerCase(),
      stateChangeFromPrevious: String(
        panel && panel.stateChangeFromPrevious
          ? panel.stateChangeFromPrevious
          : ''
      )
        .trim()
        .toLowerCase(),
      requiredVisibles: Array.isArray(panel && panel.requiredVisibles)
        ? panel.requiredVisibles
            .map((entry) =>
              String(entry || '')
                .trim()
                .toLowerCase()
            )
            .filter(Boolean)
            .sort()
        : [],
    })),
  })
}

function isPlaceholderStoryPanel(panelText) {
  const value = String(panelText || '')
    .trim()
    .toLowerCase()
  return /^panel\s*[1-4]\s*:\s*add a clear event in the story(?:\s*\(.*\))?\.?$/.test(
    value
  )
}

function isLowValueStoryPanel(panelText) {
  const value = String(panelText || '')
    .trim()
    .toLowerCase()
  if (!value) return true
  if (isPlaceholderStoryPanel(value)) return true
  if (/^add a clear event in the story(?:\s*\(.*\))?\.?$/.test(value)) {
    return true
  }
  if (/^panel\s*[1-4]\s*:\s*continue story\.?$/.test(value)) {
    return true
  }
  if (/^panel\s*[1-4]\s*:\s*continue the story\.?$/.test(value)) {
    return true
  }
  if (/^panel\s*[1-4]\s*:\s*describe panel/i.test(value)) {
    return true
  }
  if (
    /^(choose|pick|use|bring|show|end|rewrite)\b/.test(value) &&
    /(specific place|specific actor|bring .* into the scene|use .* as the trigger|show the biggest visible consequence|show the strongest physical consequence|rewrite the ending|final stable image|before anything changes|not as a background detail)/.test(
      value
    )
  ) {
    return true
  }
  return false
}

function hasMeaningfulStoryPanels(panels) {
  if (!Array.isArray(panels)) return false
  const meaningfulPanels = panels
    .map((panel) => String(panel || '').trim())
    .filter((panel) => panel && !isLowValueStoryPanel(panel))

  if (meaningfulPanels.length < 3) return false

  const uniquePanels = new Set(
    meaningfulPanels.map((panel) => panel.toLowerCase())
  )
  return uniquePanels.size >= 3
}

function normalizeKeywordFallbackValue(value, fallback) {
  const normalized = normalizeKeywordValue(value)
  return normalized || fallback
}

function buildLocalFallbackEditingTip(selection, keywordA, keywordB) {
  const safeKeywordA = normalizeKeywordValue(keywordA) || 'keyword 1'
  const safeKeywordB = normalizeKeywordValue(keywordB) || 'keyword 2'
  const lockedSelection = getLockedSenseSelection(
    selection,
    safeKeywordA,
    safeKeywordB
  )
  const chosenFirstSense = getLockedSense(
    lockedSelection,
    'keyword_1',
    safeKeywordA
  )
  const chosenSecondSense = getLockedSense(
    lockedSelection,
    'keyword_2',
    safeKeywordB
  )
  const usesLiteralFallbackSense =
    senseHasTag(chosenFirstSense, 'fallback') ||
    senseHasTag(chosenSecondSense, 'fallback')

  if (lockedSelection.used_raw_keyword_fallback || usesLiteralFallbackSense) {
    return `These keywords stayed ambiguous, so use this local backup as a rough storyboard proposal. Personalize the place, actor, trigger, and visible aftermath before building images for "${safeKeywordA}" and "${safeKeywordB}".`
  }

  return 'Treat this as a local backup idea, not a finished answer. If a beat feels stiff, rewrite the place, prop, trigger, or aftermath in your own words before building images.'
}

function buildProviderDraftEditingTip(keywordA, keywordB) {
  const safeKeywordA = normalizeKeywordValue(keywordA) || 'keyword 1'
  const safeKeywordB = normalizeKeywordValue(keywordB) || 'keyword 2'
  return `The provider produced a readable draft, but it was still weak for auto-approval. Rewrite the place, trigger, and visible aftermath in your own words before building images for "${safeKeywordA}" and "${safeKeywordB}".`
}

function isProviderMeaningfulDraftCandidate(story) {
  const item = story && typeof story === 'object' ? story : null
  if (!item) return false
  const source = String(item.candidateSource || '')
    .trim()
    .toLowerCase()
  if (!source || source === 'local_fallback') return false
  return hasMeaningfulStoryPanels(item.panels)
}

function isProviderDraftRescueCandidate(story) {
  const item = story && typeof story === 'object' ? story : null
  if (!isProviderMeaningfulDraftCandidate(item)) return false
  const report =
    item.qualityReport && typeof item.qualityReport === 'object'
      ? item.qualityReport
      : null
  if (!report || !Number.isFinite(Number(report.score))) return false
  const failures = Array.isArray(report.failures) ? report.failures : []
  const allowedFailures = new Set([
    'low_concreteness',
    'weak_progression',
    'missing_result_state',
    'missing_reaction',
  ])
  if (
    failures.length < 1 ||
    failures.some((failure) => !allowedFailures.has(failure))
  ) {
    return false
  }
  const metrics =
    report.metrics && typeof report.metrics === 'object' ? report.metrics : {}
  if (!metrics.hasTriggerEvent) return false
  if (Number(metrics.externalChangeCount) < 1) return false
  return Number(report.score) >= 58
}

function pickBestProviderDraftCandidate(stories, options = {}) {
  const useStrictFilter = options.strict !== false
  return sortStoriesByQuality(
    (Array.isArray(stories) ? stories : []).filter(
      useStrictFilter
        ? isProviderDraftRescueCandidate
        : isProviderMeaningfulDraftCandidate
    )
  )[0]
}

function buildExpandedStoryProfile(baseProfile, options = {}) {
  const profile =
    baseProfile && typeof baseProfile === 'object' ? baseProfile : {}
  const growthFactor = Math.max(1, Number(options.growthFactor) || 1)
  const extraTokens = Math.max(0, Number(options.extraTokens) || 0)
  const minOutputTokens = Math.max(0, Number(options.minOutputTokens) || 0)
  const extraTimeoutMs = Math.max(0, Number(options.extraTimeoutMs) || 0)
  const nextMaxOutputTokens = Math.max(
    minOutputTokens,
    Number(profile.maxOutputTokens || 0) + extraTokens,
    Math.ceil(Number(profile.maxOutputTokens || 0) * growthFactor)
  )
  const nextRequestTimeoutMs = Math.max(
    Number(profile.requestTimeoutMs || 0) + extraTimeoutMs,
    Number(profile.requestTimeoutMs || 0)
  )

  return {
    ...profile,
    maxOutputTokens: nextMaxOutputTokens,
    requestTimeoutMs: nextRequestTimeoutMs,
    deadlineMs: Math.max(
      Number(profile.deadlineMs || 0) + extraTimeoutMs,
      nextRequestTimeoutMs + 5000
    ),
  }
}

function hasReachableProviderStoryAttempt(attemptHistory) {
  return (Array.isArray(attemptHistory) ? attemptHistory : []).some(
    (attempt) => {
      const outcome = String(
        attempt && attempt.outcome ? attempt.outcome : ''
      ).trim()
      return (
        Boolean(outcome) && outcome !== STORY_PROVIDER_OUTCOMES.TRANSPORT_ERROR
      )
    }
  )
}

function buildProviderDraftRescueStory({
  story,
  keywordA,
  keywordB,
  senseSelection,
  index = 0,
  rationale,
}) {
  const item = story && typeof story === 'object' ? story : {}
  return normalizeStoryOption(
    {
      ...item,
      title: String(item.title || '').trim() || `Option ${index + 1}`,
      rationale: String(rationale || '').trim(),
      editingTip: buildProviderDraftEditingTip(keywordA, keywordB),
      isStoryboardStarter: false,
      isProviderEditableDraft: true,
      senseSelection,
      qualityReport:
        item.qualityReport && typeof item.qualityReport === 'object'
          ? item.qualityReport
          : null,
    },
    index
  )
}

function buildKeywordFallbackPanels(
  keywordA,
  keywordB,
  variant,
  humanStorySeed,
  senseSelection
) {
  const selection = getLockedSenseSelection(senseSelection, keywordA, keywordB)
  const firstSense = getLockedSense(selection, 'keyword_1', keywordA)
  const secondSense = getLockedSense(selection, 'keyword_2', keywordB)
  const usesLiteralFallbackSense =
    senseHasTag(firstSense, 'fallback') || senseHasTag(secondSense, 'fallback')

  const looksLikeActorLabel = (label) => {
    const normalized = normalizeKeywordValue(label).trim().toLowerCase()
    if (!normalized) return false
    if (ACTOR_KEYWORD_HINTS.has(normalized)) {
      return true
    }
    return /\b(person|man|woman|child|kid|boy|girl|pilot|king|queen|clown|nurse|doctor|teacher|officer|chef|farmer|wolf|centaur|robot|ghost)\b/.test(
      normalized
    )
  }

  const buildRawKeywordStoryboardStarterPanels = () => {
    const primaryLabel = getSensePromptLabel(firstSense, keywordA)
    const secondaryLabel = getSensePromptLabel(secondSense, keywordB)
    let actorLabel = 'person'
    if (looksLikeActorLabel(primaryLabel)) {
      actorLabel = primaryLabel
    } else if (looksLikeActorLabel(secondaryLabel)) {
      actorLabel = secondaryLabel
    }
    const actorIsPrimary = actorLabel === primaryLabel
    const actorIsSecondary = actorLabel === secondaryLabel
    const place = chooseDeterministicItem(
      [
        'airport gate',
        'school gym',
        'busy kitchen',
        'garage workbench',
        'festival tent',
        'museum hallway',
      ],
      `${primaryLabel}|${secondaryLabel}|${variant}|place`,
      'busy kitchen'
    )
    const supportProp = chooseDeterministicItem(
      ['rolling suitcase', 'small table', 'wooden stool', 'plastic crate'],
      `${primaryLabel}|${secondaryLabel}|${variant}|prop`,
      'small table'
    )
    const archetype = chooseDeterministicFallbackArchetype({
      seed: `${primaryLabel}|${secondaryLabel}|${variant}`,
      primaryLabel,
      secondaryLabel,
      supportProp,
      allowReveal: false,
      allowCollision: actorIsPrimary || actorIsSecondary,
    })
    const spillObject = chooseDeterministicItem(
      ['papers', 'flowers', 'tools', 'cups'],
      `${primaryLabel}|${secondaryLabel}|${variant}|spill`,
      'papers'
    )
    const scenario = chooseDeterministicItem(
      [
        {
          actor: 'shopper',
          place: 'store aisle',
          setup: `arranges loose supplies beside ${withIndefiniteArticle(
            supportProp
          )}`,
        },
        {
          actor: 'stagehand',
          place: 'backstage prop corner',
          setup: `sorts props beside ${withIndefiniteArticle(supportProp)}`,
        },
        {
          actor: 'traveler',
          place: 'airport waiting area',
          setup: `packs belongings around ${withIndefiniteArticle(
            supportProp
          )}`,
        },
        {
          actor: 'teacher',
          place: 'classroom supply table',
          setup: `sets out materials beside ${withIndefiniteArticle(
            supportProp
          )}`,
        },
        {
          actor: 'vendor',
          place: 'festival booth',
          setup: `sorts stock beside ${withIndefiniteArticle(supportProp)}`,
        },
        {
          actor: 'gardener',
          place: 'potting bench',
          setup: `arranges tools beside ${withIndefiniteArticle(supportProp)}`,
        },
      ],
      `${primaryLabel}|${secondaryLabel}|${variant}|scenario`,
      {
        actor: 'shopper',
        place: 'store aisle',
        setup: `arranges supplies beside ${withIndefiniteArticle(supportProp)}`,
      }
    )

    if (variant === 1) {
      if (actorIsPrimary) {
        const actorPrimaryAftermath = chooseDeterministicAftermathPattern({
          seed: `${primaryLabel}|${secondaryLabel}|${variant}|actor-primary`,
          primaryLabel,
          secondaryLabel,
          supportProp,
          looseItems: spillObject,
          reactionBeat:
            archetype.id === 'collision'
              ? `the ${primaryLabel} recoils from the ${secondaryLabel}`
              : archetype.reactionBeat,
          aftermathBeat:
            archetype.id === 'collision'
              ? `the new gap between the ${primaryLabel} and ${secondaryLabel}`
              : archetype.aftermathBeat,
          preferredPatternId: archetype.preferredAftermath,
        })
        return [
          prependSeedToPanel(
            `At a ${place}, the ${primaryLabel} ${scenario.setup} with the ${secondaryLabel} nearby.`,
            humanStorySeed
          ),
          archetype.id === 'collision'
            ? `The ${secondaryLabel} jerks into motion and bumps the ${supportProp}, startling the ${primaryLabel}.`
            : archetype.trigger,
          actorPrimaryAftermath.panel3,
          actorPrimaryAftermath.panel4,
        ]
      }

      if (actorIsSecondary) {
        const actorSecondaryAftermath = chooseDeterministicAftermathPattern({
          seed: `${primaryLabel}|${secondaryLabel}|${variant}|actor-secondary`,
          primaryLabel,
          secondaryLabel,
          supportProp,
          looseItems: spillObject,
          reactionBeat:
            archetype.id === 'collision'
              ? `the ${secondaryLabel} jumps back from the moving ${primaryLabel}`
              : archetype.reactionBeat,
          aftermathBeat:
            archetype.id === 'collision'
              ? `the shifted ${primaryLabel} and startled ${secondaryLabel}`
              : archetype.aftermathBeat,
          preferredPatternId: archetype.preferredAftermath,
        })
        return [
          prependSeedToPanel(
            `At a ${place}, the ${secondaryLabel} ${scenario.setup} while keeping the ${primaryLabel} nearby.`,
            humanStorySeed
          ),
          archetype.id === 'collision'
            ? `The ${secondaryLabel} slips and sends the ${primaryLabel} skidding across the ${supportProp}.`
            : archetype.trigger,
          actorSecondaryAftermath.panel3,
          actorSecondaryAftermath.panel4,
        ]
      }

      const neutralAftermath = chooseDeterministicAftermathPattern({
        seed: `${primaryLabel}|${secondaryLabel}|${variant}|neutral`,
        primaryLabel,
        secondaryLabel,
        supportProp,
        looseItems: spillObject,
        reactionBeat:
          archetype.id === 'collision'
            ? `the ${secondaryLabel} drops to the floor beside the ${primaryLabel}`
            : archetype.reactionBeat,
        aftermathBeat:
          archetype.id === 'collision'
            ? `the fallen ${secondaryLabel} and shifted ${primaryLabel}`
            : archetype.aftermathBeat,
        preferredPatternId: archetype.preferredAftermath,
      })
      return [
        prependSeedToPanel(
          `In a ${scenario.place}, a ${scenario.actor} ${scenario.setup} with the ${primaryLabel} and the ${secondaryLabel} together.`,
          humanStorySeed
        ),
        archetype.trigger,
        neutralAftermath.panel3,
        neutralAftermath.panel4,
      ]
    }

    if (actorIsPrimary) {
      const actorPrimaryReturnAftermath = chooseDeterministicAftermathPattern({
        seed: `${primaryLabel}|${secondaryLabel}|${variant}|actor-primary-return`,
        primaryLabel,
        secondaryLabel,
        supportProp,
        looseItems: spillObject,
        reactionBeat:
          archetype.id === 'collision'
            ? `the ${primaryLabel} loses grip on the ${secondaryLabel}`
            : archetype.reactionBeat,
        aftermathBeat:
          archetype.id === 'collision'
            ? `the ${primaryLabel} facing the displaced ${secondaryLabel}`
            : archetype.aftermathBeat,
        preferredPatternId: archetype.preferredAftermath,
      })
      return [
        prependSeedToPanel(
          `In a ${place}, the ${primaryLabel} ${scenario.setup} with the ${secondaryLabel} close by.`,
          humanStorySeed
        ),
        archetype.trigger,
        actorPrimaryReturnAftermath.panel3,
        actorPrimaryReturnAftermath.panel4,
      ]
    }

    if (actorIsSecondary) {
      const actorSecondaryReturnAftermath = chooseDeterministicAftermathPattern(
        {
          seed: `${primaryLabel}|${secondaryLabel}|${variant}|actor-secondary-return`,
          primaryLabel,
          secondaryLabel,
          supportProp,
          looseItems: spillObject,
          reactionBeat:
            archetype.id === 'collision'
              ? `the ${primaryLabel} skids past the ${secondaryLabel}`
              : archetype.reactionBeat,
          aftermathBeat:
            archetype.id === 'collision'
              ? `the moved ${primaryLabel} and unsettled ${secondaryLabel}`
              : archetype.aftermathBeat,
          preferredPatternId: archetype.preferredAftermath,
        }
      )
      return [
        prependSeedToPanel(
          `In a ${place}, the ${secondaryLabel} ${scenario.setup} with the ${primaryLabel} close by.`,
          humanStorySeed
        ),
        archetype.trigger,
        actorSecondaryReturnAftermath.panel3,
        actorSecondaryReturnAftermath.panel4,
      ]
    }

    const fallbackAftermath = chooseDeterministicAftermathPattern({
      seed: `${primaryLabel}|${secondaryLabel}|${variant}|fallback`,
      primaryLabel,
      secondaryLabel,
      supportProp,
      looseItems: spillObject,
      reactionBeat:
        archetype.id === 'collision'
          ? `the ${secondaryLabel} flips away from the ${primaryLabel}`
          : archetype.reactionBeat,
      aftermathBeat:
        archetype.id === 'collision'
          ? `the changed positions of the ${primaryLabel} and ${secondaryLabel}`
          : archetype.aftermathBeat,
      preferredPatternId: archetype.preferredAftermath,
    })
    return [
      prependSeedToPanel(
        `In a ${scenario.place}, a ${scenario.actor} ${scenario.setup} with the ${primaryLabel} and the ${secondaryLabel} side by side.`,
        humanStorySeed
      ),
      archetype.trigger,
      fallbackAftermath.panel3,
      fallbackAftermath.panel4,
    ]
  }

  const buildEmotionLockedFallbackPanels = (emotionSense, triggerSense) => {
    const seed = `${emotionSense.sense_id}|${triggerSense.sense_id}|${variant}`
    const carriedObject = chooseDeterministicItem(
      [
        {
          item: 'flashlight',
          panel3Beat: 'drops hard and its beam sweeps across the wall',
          finalBeat: 'the fallen flashlight still shining toward the trigger',
        },
        {
          item: 'fruit bowl',
          panel3Beat: 'hits the floor and fruit rolls under the table',
          finalBeat: 'the fallen bowl and rolling fruit on the floor',
        },
        {
          item: 'folding chair',
          panel3Beat: 'snaps shut and skids across the landing',
          finalBeat: 'the half-folded chair blocking part of the path',
        },
        {
          item: 'umbrella',
          panel3Beat: 'springs open across the hallway',
          finalBeat:
            'the open umbrella lying between the person and the trigger',
        },
      ],
      `${seed}|object`,
      {
        item: 'flashlight',
        panel3Beat: 'drops hard and its beam sweeps across the wall',
        finalBeat: 'the fallen flashlight still shining toward the trigger',
      }
    )
    const location = chooseDeterministicItem(
      ['hallway', 'living room', 'studio corridor', 'quiet stair landing'],
      `${seed}|location`,
      'hallway'
    )
    const triggerLabel = getSensePromptLabel(triggerSense, keywordB)
    const reactionLabel = getSensePromptLabel(emotionSense, keywordA)

    if (variant === 1) {
      return [
        prependSeedToPanel(
          `A calm person sets a ${
            carriedObject.item
          } on a small table in a ${location} while ${withIndefiniteArticle(
            triggerLabel
          )} moves into view nearby.`,
          humanStorySeed
        ),
        `The ${triggerLabel} suddenly becomes impossible to miss, and the person jerks in a ${reactionLabel} as the ${carriedObject.item} slides off the table.`,
        `The ${carriedObject.item} ${carriedObject.panel3Beat} while the ${triggerLabel} stays clearly visible.`,
        `The person steps back, still showing the ${reactionLabel}, with ${carriedObject.finalBeat} and the ${triggerLabel} nearby.`,
      ]
    }

    return [
      prependSeedToPanel(
        `A calm person carries a ${
          carriedObject.item
        } through a ${location} while ${withIndefiniteArticle(
          triggerLabel
        )} starts to appear nearby.`,
        humanStorySeed
      ),
      `The ${triggerLabel} moves fully into view, and the person jolts in a ${reactionLabel} as the ${carriedObject.item} slips from their hand.`,
      `The ${carriedObject.item} ${carriedObject.panel3Beat} while the ${triggerLabel} remains visible.`,
      `The startled person backs away with ${carriedObject.finalBeat} and the ${triggerLabel} still visible in the ${location}.`,
    ]
  }

  const buildToolLockedFallbackPanels = (toolSense, actorSense, otherSense) => {
    const actorLabel = isActorSense(actorSense)
      ? getSensePromptLabel(actorSense, actorSense.keyword || 'person')
      : 'person'
    const toolLabel = getSensePromptLabel(toolSense, keywordA)

    let location = 'bright workshop'
    let workObject = 'wooden log'
    let visibleResult = 'a carved shape becomes obvious'
    if (toolSense.keyword === 'gun') {
      location = 'training range lane'
      workObject = 'hinged metal plate'
      visibleResult = 'the metal plate swings backward from the impact'
    } else if (toolSense.keyword === 'fire') {
      location = 'controlled demo table'
      workObject = 'lantern wick'
      visibleResult = 'the lantern glows with a steady visible flame'
    } else if (toolSense.keyword === 'chainsaw') {
      location = 'bright workshop'
      workObject = 'wooden log'
      visibleResult = 'a clean carved shape becomes obvious in the wood'
    } else if (toolSense.keyword === 'mirror') {
      location = 'quiet dressing room'
      workObject = 'standing mirror frame'
      visibleResult = 'the mirror surface changes visibly'
    } else if (senseHasTag(toolSense, 'repair')) {
      location = 'sunlit workbench'
      workObject = 'window frame gap'
      visibleResult = 'the repaired gap looks sealed and clean'
    } else if (otherSense && otherSense.sense_id) {
      workObject = getSensePromptLabel(otherSense, otherSense.keyword)
    }

    if (variant === 1) {
      return [
        prependSeedToPanel(
          `A ${actorLabel} stands in a ${location} with a ${toolLabel} beside the ${workObject}.`,
          humanStorySeed
        ),
        `The ${actorLabel} starts one clear action with the ${toolLabel} on the ${workObject}.`,
        `That action causes an obvious external change as ${visibleResult}.`,
        `The ${actorLabel} steps back from the finished result while the ${toolLabel} rests safely nearby.`,
      ]
    }

    return [
      prependSeedToPanel(
        `A ${actorLabel} prepares the ${workObject} in a ${location} with the ${toolLabel} ready.`,
        humanStorySeed
      ),
      `The ${actorLabel} uses the ${toolLabel} in one concrete step on the ${workObject}.`,
      `A visible state change appears immediately as ${visibleResult}.`,
      `The completed result stays in view while the ${toolLabel} is set aside in the same ${location}.`,
    ]
  }

  const buildMotionLockedFallbackPanels = (motionSense, anchorSense) => {
    const seed = `${motionSense.sense_id}|${anchorSense.sense_id}|${variant}`
    const movingObject = chooseDeterministicItem(
      ['glass vase', 'picture frame', 'ceramic bowl', 'table lamp'],
      `${seed}|moving-object`,
      'glass vase'
    )
    const anchorLabel = getSensePromptLabel(anchorSense, keywordB)
    const location = chooseDeterministicItem(
      ['hallway table', 'bedroom shelf', 'studio stand', 'living room cabinet'],
      `${seed}|location`,
      'hallway table'
    )

    return [
      prependSeedToPanel(
        `A person places a ${movingObject} beside the ${anchorLabel} on a ${location}.`,
        humanStorySeed
      ),
      `The ${movingObject} starts a clear ${getSensePromptLabel(
        motionSense,
        keywordA
      )} toward the ${anchorLabel} as the edge tips.`,
      `The ${movingObject} falls, the ${anchorLabel} shifts hard, and visible pieces or debris spread across the floor.`,
      `The fallen ${movingObject} lies beside the changed ${anchorLabel} in the new stable state.`,
    ]
  }

  const buildReflectionLockedFallbackPanels = (reflectionSense, otherSense) => {
    const seed = `${reflectionSense.sense_id}|${otherSense.sense_id}|${variant}`
    const otherLabel = getSensePromptLabel(otherSense, keywordB)
    const cleaningTool = chooseDeterministicItem(
      ['cloth', 'spray bottle', 'soft brush'],
      `${seed}|tool`,
      'cloth'
    )
    const room = chooseDeterministicItem(
      ['quiet bedroom', 'hallway corner', 'dressing room'],
      `${seed}|room`,
      'quiet bedroom'
    )

    return [
      prependSeedToPanel(
        `A person wipes a ${getSensePromptLabel(
          reflectionSense,
          keywordA
        )} in a ${room} with a ${cleaningTool}.`,
        humanStorySeed
      ),
      `The ${otherLabel} appears clearly inside the ${getSensePromptLabel(
        reflectionSense,
        keywordA
      )}, changing the reflection in a way the person can see.`,
      `The ${cleaningTool} drops and the ${getSensePromptLabel(
        reflectionSense,
        keywordA
      )} tilts as the ${otherLabel} remains visible in it.`,
      `The fallen ${cleaningTool} and angled ${getSensePromptLabel(
        reflectionSense,
        keywordA
      )} stay in view with the ${otherLabel} still reflected inside.`,
    ]
  }

  const buildGenericLockedFallbackPanels = (primarySense, secondarySense) => {
    const seed = `${primarySense.sense_id}|${secondarySense.sense_id}|${variant}`
    const primaryLabel = getSensePromptLabel(primarySense, keywordA)
    const secondaryLabel = getSensePromptLabel(secondarySense, keywordB)
    const prop = chooseDeterministicItem(
      ['box', 'bucket', 'jar', 'basket'],
      `${seed}|prop`,
      'box'
    )
    const looseItems = chooseDeterministicItem(
      ['flowers', 'tools', 'postcards', 'cloth strips'],
      `${seed}|loose-items`,
      'flowers'
    )
    const scenario = chooseDeterministicItem(
      [
        {
          actor: 'shopper',
          intro: `A shopper compares the ${primaryLabel} and the ${secondaryLabel} beside a ${prop} in a store aisle.`,
          variantTwo: `In a store aisle, a shopper rearranges the ${primaryLabel} near the ${secondaryLabel} and a ${prop}.`,
        },
        {
          actor: 'stagehand',
          intro: `A stagehand sets the ${primaryLabel} and the ${secondaryLabel} beside a ${prop} in a backstage prop corner.`,
          variantTwo: `Backstage, a stagehand repositions the ${primaryLabel} near the ${secondaryLabel} and a ${prop}.`,
        },
        {
          actor: 'traveler',
          intro: `A traveler keeps the ${primaryLabel} and the ${secondaryLabel} beside a ${prop} in an airport waiting area.`,
          variantTwo: `In an airport waiting area, a traveler shifts the ${primaryLabel} near the ${secondaryLabel} and a ${prop}.`,
        },
        {
          actor: 'teacher',
          intro: `A teacher sorts the ${primaryLabel} and the ${secondaryLabel} beside a ${prop} on a classroom supply table.`,
          variantTwo: `At a classroom supply table, a teacher rearranges the ${primaryLabel} near the ${secondaryLabel} and a ${prop}.`,
        },
      ],
      `${seed}|scenario`,
      {
        actor: 'shopper',
        intro: `A shopper compares the ${primaryLabel} and the ${secondaryLabel} beside a ${prop} in a store aisle.`,
        variantTwo: `In a store aisle, a shopper rearranges the ${primaryLabel} near the ${secondaryLabel} and a ${prop}.`,
      }
    )
    const archetype = chooseDeterministicFallbackArchetype({
      seed,
      primaryLabel,
      secondaryLabel,
      supportProp: prop,
      allowReveal:
        !isStoryActorLikeLabel(primaryLabel) &&
        !isStoryActorLikeLabel(secondaryLabel),
    })

    if (variant === 1) {
      const variantOneAftermath = chooseDeterministicAftermathPattern({
        seed: `${seed}|variant-1`,
        primaryLabel,
        secondaryLabel,
        supportProp: prop,
        looseItems,
        reactionBeat: archetype.reactionBeat,
        aftermathBeat:
          archetype.id === 'collision'
            ? `the new positions of the ${primaryLabel} and ${secondaryLabel}`
            : archetype.aftermathBeat,
        preferredPatternId: archetype.preferredAftermath,
      })
      return [
        prependSeedToPanel(scenario.intro, humanStorySeed),
        archetype.trigger,
        variantOneAftermath.panel3,
        variantOneAftermath.panel4,
      ]
    }

    const variantTwoAftermath = chooseDeterministicAftermathPattern({
      seed: `${seed}|variant-2`,
      primaryLabel,
      secondaryLabel,
      supportProp: prop,
      looseItems,
      reactionBeat: archetype.reactionBeat,
      aftermathBeat: archetype.aftermathBeat,
      preferredPatternId: archetype.preferredAftermath,
    })
    return [
      prependSeedToPanel(scenario.variantTwo, humanStorySeed),
      archetype.trigger,
      variantTwoAftermath.panel3,
      variantTwoAftermath.panel4,
    ]
  }

  if (selection.used_raw_keyword_fallback || usesLiteralFallbackSense) {
    return buildRawKeywordStoryboardStarterPanels()
  }

  if (isEmotionSense(firstSense) || isEmotionSense(secondSense)) {
    return isEmotionSense(firstSense)
      ? buildEmotionLockedFallbackPanels(firstSense, secondSense)
      : buildEmotionLockedFallbackPanels(secondSense, firstSense)
  }

  if (isToolSense(firstSense) || isToolSense(secondSense)) {
    const toolSense = isToolSense(firstSense) ? firstSense : secondSense
    let actorSense = null
    if (isActorSense(firstSense)) {
      actorSense = firstSense
    } else if (isActorSense(secondSense)) {
      actorSense = secondSense
    } else {
      actorSense = {
        sense_id: 'generic_person',
        prompt_label: 'person',
        keyword: 'person',
        tags: ['person'],
      }
    }
    const otherSense = toolSense === firstSense ? secondSense : firstSense
    return buildToolLockedFallbackPanels(toolSense, actorSense, otherSense)
  }

  if (isMotionSense(firstSense) || isMotionSense(secondSense)) {
    return isMotionSense(firstSense)
      ? buildMotionLockedFallbackPanels(firstSense, secondSense)
      : buildMotionLockedFallbackPanels(secondSense, firstSense)
  }

  if (isReflectionSense(firstSense) || isReflectionSense(secondSense)) {
    return isReflectionSense(firstSense)
      ? buildReflectionLockedFallbackPanels(firstSense, secondSense)
      : buildReflectionLockedFallbackPanels(secondSense, firstSense)
  }

  return buildGenericLockedFallbackPanels(firstSense, secondSense)
}

function buildKeywordFallbackStories({
  keywordA,
  keywordB,
  includeNoise = false,
  customStory = null,
  humanStorySeed = '',
  senseSelection = null,
  fallbackReasonText = '',
}) {
  const safeKeywordA = normalizeKeywordFallbackValue(keywordA, 'object A')
  const safeKeywordB = normalizeKeywordFallbackValue(keywordB, 'object B')
  const selection = getLockedSenseSelection(
    senseSelection,
    safeKeywordA,
    safeKeywordB
  )
  const fallbackFirstSense = getLockedSense(
    selection,
    'keyword_1',
    safeKeywordA
  )
  const fallbackSecondSense = getLockedSense(
    selection,
    'keyword_2',
    safeKeywordB
  )
  const isStoryboardStarter =
    selection.used_raw_keyword_fallback ||
    senseHasTag(fallbackFirstSense, 'fallback') ||
    senseHasTag(fallbackSecondSense, 'fallback')
  const editingTip = buildLocalFallbackEditingTip(
    selection,
    safeKeywordA,
    safeKeywordB
  )
  const normalizedCustomPanels = normalizeStoryPanels(customStory || [])
  const hasCustomPanels = hasMeaningfulStoryPanels(normalizedCustomPanels)
  const noisePanelIndex = includeNoise
    ? chooseNoisePanelIndex(`${safeKeywordA}-${safeKeywordB}`)
    : null

  const optionOnePanels = hasCustomPanels
    ? normalizedCustomPanels
    : buildKeywordFallbackPanels(
        safeKeywordA,
        safeKeywordB,
        0,
        humanStorySeed,
        selection
      )

  const optionTwoPanels = hasCustomPanels
    ? normalizedCustomPanels.map((panel, index) =>
        index === 0 ? `${panel} (alternative opening)` : panel
      )
    : buildKeywordFallbackPanels(
        safeKeywordA,
        safeKeywordB,
        1,
        humanStorySeed,
        selection
      )

  const fallbackReason = String(fallbackReasonText || '').trim()
  const primaryFallbackRationale = fallbackReason
    ? `Local fallback storyboard draft shown because ${fallbackReason}.`
    : 'Local fallback storyboard draft shown because provider output could not be parsed reliably.'
  const secondaryFallbackRationale = fallbackReason
    ? `Alternative local fallback storyboard draft shown because ${fallbackReason}.`
    : 'Alternative local fallback storyboard draft shown because provider output could not be parsed reliably.'

  return [
    normalizeStoryOption(
      {
        id: 'option-1',
        title: 'Option 1',
        panels: optionOnePanels,
        rationale: primaryFallbackRationale,
        editingTip,
        isStoryboardStarter,
        includeNoise,
        noisePanelIndex,
        senseSelection: selection,
      },
      0
    ),
    normalizeStoryOption(
      {
        id: 'option-2',
        title: 'Option 2',
        panels: optionTwoPanels,
        rationale: secondaryFallbackRationale,
        editingTip,
        isStoryboardStarter,
        includeNoise,
        noisePanelIndex,
        senseSelection: selection,
      },
      1
    ),
  ]
}

function buildEmergencyStoryboardStarterStories({
  keywordA,
  keywordB,
  includeNoise = false,
  customStory = null,
  humanStorySeed = '',
  senseSelection = null,
  emergencyReasonText = '',
  requestedStoryCount = 1,
}) {
  const baseStories = buildKeywordFallbackStories({
    keywordA,
    keywordB,
    includeNoise,
    customStory,
    humanStorySeed,
    senseSelection,
    fallbackReasonText: emergencyReasonText,
  })
  const reasonText = String(emergencyReasonText || '').trim()
  const primaryRationale = reasonText
    ? `Emergency editable storyboard draft shown because ${reasonText}. It does not meet automatic quality requirements yet.`
    : 'Emergency editable storyboard draft shown because the provider did not return a usable draft. It does not meet automatic quality requirements yet.'
  const secondaryRationale = reasonText
    ? `Alternative emergency editable storyboard draft shown because ${reasonText}. It does not meet automatic quality requirements yet.`
    : 'Alternative emergency editable storyboard draft shown because the provider did not return a usable draft. It does not meet automatic quality requirements yet.'

  return baseStories.slice(0, requestedStoryCount).map((story, index) => ({
    ...story,
    rationale: index === 0 ? primaryRationale : secondaryRationale,
    editingTip: `${buildLocalFallbackEditingTip(
      senseSelection,
      keywordA,
      keywordB
    )} This draft is intentionally weakly approved for manual review: either use it as a base or regenerate/optimize it.`,
    isStoryboardStarter: true,
  }))
}

function normalizeStoryOptionFromStructuredItem(item, index) {
  const option = item && typeof item === 'object' ? item : {}
  const sourcePanels = Array.isArray(option.panels)
    ? option.panels.slice(0, 4)
    : []
  while (sourcePanels.length < 4) {
    sourcePanels.push({})
  }
  const normalizedPanels = sourcePanels.map((panel, panelIndex) => {
    const value = panel && typeof panel === 'object' ? panel : {}
    const scene = String(
      value.scene_description || value.sceneDescription || ''
    )
      .trim()
      .replace(/\s+/g, ' ')
    const action = String(value.action || '')
      .trim()
      .replace(/\s+/g, ' ')
    const required = Array.isArray(value.required_visibles)
      ? value.required_visibles
          .map((entry) => String(entry || '').trim())
          .filter(Boolean)
          .slice(0, 4)
      : []
    const parts = [scene, action]
      .concat(required.length ? [`Visible: ${required.join(', ')}`] : [])
      .filter(Boolean)
    if (parts.length > 0) {
      return normalizeStoryPanel(parts.join('. '), panelIndex)
    }
    return normalizeStoryPanel('', panelIndex)
  })

  return normalizeStoryOption(
    {
      id: String(option.option_id || option.id || `option-${index + 1}`).trim(),
      title:
        String(
          option.option_title || option.title || `Option ${index + 1}`
        ).trim() || `Option ${index + 1}`,
      panels: normalizedPanels,
      storySummary: String(
        option.story_summary ||
          option.storySummary ||
          option.overview ||
          option.rationale ||
          ''
      ).trim(),
      rationale: String(option.rationale || '').trim(),
    },
    index
  )
}

function parseStoryOptions(rawText, context = {}) {
  const contextValue = context && typeof context === 'object' ? context : {}
  try {
    const parsed = extractJsonBlock(rawText) || {}
    if (Array.isArray(parsed) && parsed.length) {
      const normalized = parsed
        .slice(0, 2)
        .map((item, index) => normalizeStoryOption(item, index))
      if (normalized.some((item) => hasMeaningfulStoryPanels(item.panels))) {
        return normalized
      }
    }
    if (Array.isArray(parsed && parsed.stories) && parsed.stories.length) {
      const normalized = parsed.stories
        .slice(0, 2)
        .map((item, index) => normalizeStoryOption(item, index))
      if (normalized.some((item) => hasMeaningfulStoryPanels(item.panels))) {
        return normalized
      }
    }
    if (Array.isArray(parsed && parsed.options) && parsed.options.length) {
      const normalized = parsed.options
        .slice(0, 2)
        .map((item, index) => normalizeStoryOption(item, index))
      if (normalized.some((item) => hasMeaningfulStoryPanels(item.panels))) {
        return normalized
      }
    }
    if (
      Array.isArray(parsed && parsed.story_options) &&
      parsed.story_options.length
    ) {
      const normalized = parsed.story_options
        .slice(0, 2)
        .map((item, index) =>
          normalizeStoryOptionFromStructuredItem(item, index)
        )
      if (normalized.some((item) => hasMeaningfulStoryPanels(item.panels))) {
        return normalized
      }
    }
    if (Array.isArray(parsed && parsed.panels) && parsed.panels.length) {
      const normalized = [normalizeStoryOption(parsed, 0)]
      if (hasMeaningfulStoryPanels(normalized[0].panels)) {
        return normalized
      }
    }
    if (
      parsed &&
      (parsed.final_story_title ||
        parsed.finalStoryTitle ||
        parsed.story_summary)
    ) {
      const normalized = [normalizeStoryOption(parsed, 0)]
      if (hasMeaningfulStoryPanels(normalized[0].panels)) {
        return normalized
      }
    }
  } catch (error) {
    // Fallback below.
  }

  // Fallback: split model text into 4 lines and mirror into 2 options.
  const lines = String(rawText || '')
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s*[-*]\s*/, '')
        .replace(/^panel\s*[1-4]\s*[:.)-]?\s*/i, '')
        .trim()
    )
    .filter((line) => line && /[A-Za-z0-9]/.test(line))
    .slice(0, 4)
  if (lines.length >= 4) {
    const panels = normalizeStoryPanels(lines)
    const fallback = [
      normalizeStoryOption({title: 'Option 1', panels}, 0),
      normalizeStoryOption(
        {
          title: 'Option 2',
          panels: panels.map((line, idx) =>
            idx === 0 ? `${line} (alternative opening)` : line
          ),
        },
        1
      ),
    ]
    if (fallback.some((item) => hasMeaningfulStoryPanels(item.panels))) {
      return fallback
    }
  }

  if (contextValue.allowLocalFallback === false) {
    return []
  }

  return buildKeywordFallbackStories({
    keywordA: contextValue.keywordA,
    keywordB: contextValue.keywordB,
    includeNoise: Boolean(contextValue.includeNoise),
    customStory: contextValue.customStory || null,
    humanStorySeed: contextValue.humanStorySeed || '',
    senseSelection: contextValue.senseSelection || null,
  })
}

function chooseNoisePanelIndex(seed, preferred = null) {
  if (Number.isFinite(Number(preferred))) {
    return Math.max(0, Math.min(3, Number(preferred)))
  }
  return hashScore(String(seed || Date.now())) % 4
}

function buildStoryCreativityLines({fastMode = false}) {
  if (fastMode) {
    return [
      'Creative steering:',
      '- Think like a storyboard partner helping a human creator get to a strong idea quickly.',
      '- Give vivid, editable story seeds, not stiff compliance prose.',
      '- Specific places, props, reveals, accidents, and reactions beat generic object bumps.',
      '- Rotate archetypes: snag-and-reveal, runaway object, tangled props, blocked path, crooked result, concealment reveal, repair, escape, recovery.',
      '- Vary the trigger mechanism too: conceal/reveal, slip-and-chase, mistaken appearance, blocked route, awkward repair, escape, or sudden exposure to light.',
      '- Allow suspense, humor, eerie tone, awkwardness, and small surprises if the panel order stays obvious.',
      '- Do not default to bump-and-spill stories unless that is clearly the strongest fit.',
      '- Do not default to toppled racks, overturned trunks, dropped bags, or spilled contents as the ending shape.',
      '- Prefer final frames defined by a reveal, blocked route, trapped pose, bright exposure, repaired arrangement, clear escape gap, or newly stable layout instead of generic wreckage.',
      '- Never write filler like "one concrete move", "visible external change", or "stable aftermath".',
    ]
  }

  return [
    'Creative direction:',
    '- Think like a storyboard collaborator, not a policy robot.',
    '- Return ideas a human would actually want to personalize and rewrite.',
    '- Specific rooms, props, accidents, reveals, and aftermaths beat neutral keyword collisions.',
    '- Rotate story archetypes instead of repeating the same collision template: snag/reveal, blockage, runaway object, tangled props, concealment/discovery, crooked-result, repair, escape, cleanup, recovery.',
    '- Vary the trigger and reaction mechanism too: conceal/reveal, slip-and-chase, mistaken appearance, blocked route, awkward repair, escape, sudden exposure, pursuit, or containment.',
    '- Small suspense, weirdness, irony, or eerie mood are welcome if the order stays instantly readable.',
    '- If the keywords feel awkward together, invent a human situation that makes them feel natural.',
    '- Do not default to drops, spills, and broken objects unless they are truly the clearest version.',
    '- Do not keep ending on overturned props or toppled furniture when a more specific aftermath would read better.',
    '- Prefer end states defined by reveals, blocked routes, exposure to light, trapped or tangled poses, repaired setups, clear escape paths, or newly stable arrangements.',
    '- Never write filler like "one concrete move", "visible external change", or "stable aftermath".',
  ]
}

function buildSingleStoryPromptLines({
  safeKeywordA,
  safeKeywordB,
  includeNoise,
  hasCustomStory,
  baseStory,
  senseSelection,
  lockedSenseLines,
  contentSafetyBoundaryLines,
  creativityLines,
  exemplarConfig,
  outputEnvelopeLines,
  outputSchema,
  fastMode = false,
}) {
  const customStoryHint = hasCustomStory
    ? `Use this draft as seed and improve it:
1) ${baseStory[0]}
2) ${baseStory[1]}
3) ${baseStory[2]}
4) ${baseStory[3]}`
    : ''
  const noiseHint = includeNoise
    ? 'Noise is added later to one panel. Keep the story coherent and keep the main objects large and readable.'
    : ''

  return [
    'Generate exactly 1 editable 4-panel flip storyboard as strict JSON only.',
    fastMode
      ? 'Goal: produce one vivid, human-editable story seed quickly.'
      : 'Goal: produce one vivid, human-editable storyboard a person would actually want to refine.',
    'Think like a storyboard collaborator, not a policy robot.',
    'Write one concrete micro-story from the two keywords with a clear before -> trigger -> reaction -> after flow.',
    'Keep it specific, visual, and easy to personalize. Do not write instruction-like filler.',
    '',
    ...creativityLines,
    '',
    'Hard rules:',
    '- both keywords must visibly matter in the action, not just sit in the background',
    '- one single story chain only',
    '- panel 4 must be a real visible consequence of panel 3',
    '- make panel 1 and panel 4 clearly look different',
    '- do not default the peak or ending to toppled props, overturned furniture, or scattered contents unless that is truly the clearest story beat',
    '- no letters, numbers, labels, logos, watermarks, signs, or text-dependent clues',
    ...contentSafetyBoundaryLines,
    '- no waking-up template, no thumbs up/down ending, no counting trick, no page/screen keyword cheat',
    '',
    'Aim for:',
    '- one specific place',
    '- one readable trigger moment',
    '- one strong visible consequence',
    '- one final image that makes the new situation obvious at a glance',
    '- natural wording instead of compliance prose',
    '',
    'Good story shapes:',
    '- reveal and reaction',
    '- obstacle and workaround',
    '- runaway object or blocked path',
    '- chase after something slipping free',
    '- mistaken appearance followed by reveal',
    '- awkward repair or recovery attempt',
    '- tangle, snag, concealment, recovery, repair, or crooked-result aftermath',
    '',
    ...buildSingleStoryPairFitLines(senseSelection, safeKeywordA, safeKeywordB),
    '',
    ...exemplarConfig.lines,
    '',
    ...lockedSenseLines,
    '',
    `Keyword 1: ${safeKeywordA}`,
    `Keyword 2: ${safeKeywordB}`,
    noiseHint,
    customStoryHint,
    'Return strict JSON with this exact envelope schema:',
    ...outputEnvelopeLines,
    'Concept schema:',
    outputSchema,
    'Return JSON only. No markdown.',
  ]
    .filter(Boolean)
    .join('\n')
}

function buildStoryOptionsPrompt({
  provider,
  keywordA,
  keywordB,
  includeNoise,
  customStory,
  senseSelection,
  exemplarsEnabled = true,
  requestedStoryCount = 2,
}) {
  const safeKeywordA = normalizeKeywordValue(keywordA) || '-'
  const safeKeywordB = normalizeKeywordValue(keywordB) || '-'
  const normalizedStoryCount = normalizeStoryOptionCount(requestedStoryCount)
  const storyCountLabel =
    normalizedStoryCount === 1 ? 'one strong' : 'two distinct'
  const baseStory = normalizeStoryPanels(customStory)
  const hasCustomStory = Array.isArray(customStory) && customStory.length > 0
  const lockedSenseLines = formatSensePromptLines(
    senseSelection,
    safeKeywordA,
    safeKeywordB
  )
  const contentSafetyBoundaryLines = getContentSafetyBoundaryLines()
  const creativityLines = buildStoryCreativityLines({fastMode: false})
  const exemplarConfig = buildStoryPromptExemplarLines({
    provider,
    fastMode: false,
    enabled: exemplarsEnabled,
  })
  const outputEnvelopeLines =
    normalizedStoryCount === 1
      ? ['{', '  "stories": [', '    <concept_1_in_schema_below>', '  ]', '}']
      : [
          '{',
          '  "stories": [',
          '    <concept_1_in_schema_below>,',
          '    <concept_2_in_schema_below>',
          '  ]',
          '}',
        ]

  const outputSchema = `{
  "keywords": ["<keyword1>", "<keyword2>"],
  "final_story_title": "<very short internal label>",
  "story_summary": "<1 sentence, plain and literal>",
  "panels": [
    {
      "panel": 1,
      "role": "before",
      "description": "<clear visual description>",
      "required_visibles": ["<...>", "<...>"],
      "state_change_from_previous": "n/a"
    },
    {
      "panel": 2,
      "role": "trigger",
      "description": "<clear visual description>",
      "required_visibles": ["<...>", "<...>"],
      "state_change_from_previous": "<what changed visibly>"
    },
    {
      "panel": 3,
      "role": "reaction",
      "description": "<clear visual description>",
      "required_visibles": ["<...>", "<...>"],
      "state_change_from_previous": "<what changed visibly>"
    },
    {
      "panel": 4,
      "role": "after",
      "description": "<clear visual description>",
      "required_visibles": ["<...>", "<...>"],
      "state_change_from_previous": "<what changed visibly>"
    }
  ],
  "compliance_report": {
    "keyword_relevance": "pass/fail",
    "no_text_needed": "pass/fail",
    "no_order_labels": "pass/fail",
    "no_inappropriate_content": "pass/fail",
    "single_story_only": "pass/fail",
    "no_waking_up_template": "pass/fail",
    "no_thumbs_up_down": "pass/fail",
    "no_enumeration_logic": "pass/fail",
    "no_screen_or_page_keyword_cheat": "pass/fail",
    "causal_clarity": "pass/fail",
    "consensus_clarity": "pass/fail"
  },
  "risk_flags": ["<list any remaining ambiguity or report-risk factors>"],
  "revision_if_risky": "<if any risk flag exists, rewrite the concept once and provide the safer version instead>"
}`
  const singleStoryOutputSchema = `{
  "title": "Option 1",
  "story_summary": "<1 sentence, plain and literal>",
  "panels": [
    {
      "panel": 1,
      "role": "before",
      "description": "<clear visual description>",
      "required_visibles": ["<...>", "<...>"],
      "state_change_from_previous": "n/a"
    },
    {
      "panel": 2,
      "role": "trigger",
      "description": "<clear visual description>",
      "required_visibles": ["<...>", "<...>"],
      "state_change_from_previous": "<what changed visibly>"
    },
    {
      "panel": 3,
      "role": "reaction",
      "description": "<clear visual description>",
      "required_visibles": ["<...>", "<...>"],
      "state_change_from_previous": "<what changed visibly>"
    },
    {
      "panel": 4,
      "role": "after",
      "description": "<clear visual description>",
      "required_visibles": ["<...>", "<...>"],
      "state_change_from_previous": "<what changed visibly>"
    }
  ]
}`

  const customStoryHint = hasCustomStory
    ? `Custom user draft panels to preserve/improve:
1) ${baseStory[0]}
2) ${baseStory[1]}
3) ${baseStory[2]}
4) ${baseStory[3]}`
    : ''
  const noiseHint = includeNoise
    ? 'Additional instruction: keep all 4 panels as one coherent story. Noise, if enabled, is applied later as adversarial image distortion on one panel; do not introduce random unrelated scenes.'
    : 'Additional instruction: do not include any extra noise semantics.'

  if (normalizedStoryCount === 1) {
    return buildSingleStoryPromptLines({
      safeKeywordA,
      safeKeywordB,
      includeNoise,
      hasCustomStory,
      baseStory,
      senseSelection,
      lockedSenseLines,
      contentSafetyBoundaryLines,
      creativityLines,
      exemplarConfig,
      outputEnvelopeLines,
      outputSchema: singleStoryOutputSchema,
      fastMode: false,
    })
  }

  return [
    'You are an Idena flip storyline planner and compliance checker.',
    'Goal:',
    `Create ${storyCountLabel} 4-panel, wordless, single-story flip concept${
      normalizedStoryCount === 1 ? '' : 's'
    } from two Idena keywords.`,
    'Your priority is clear compliance plus creative quality. Your priority order is:',
    '1. rule compliance,',
    '2. avoid clearly extreme/provider-triggering content while keeping normal tension,',
    '3. high human consensus,',
    '4. clear visual causality.',
    '5. creative-but-readable scene design.',
    '',
    ...creativityLines,
    '',
    'Hard constraints:',
    '- Both keywords must be clearly and concretely visible in the story.',
    '- The flip must be solvable without reading any text.',
    '- Do not use any letters, numbers, arrows, labels, captions, signs, interface text, clocks, calendars, scoreboards, book pages, posters, or subtitles if reading them is needed.',
    ...contentSafetyBoundaryLines,
    '- Do not use several unrelated mini-stories.',
    '- Do not use the waking-up template.',
    '- Do not end with thumbs up or thumbs down.',
    '- Do not rely on a sequence of enumerated objects or counting logic.',
    '- Do not satisfy the keywords only by showing them inside a page, screen, painting, or printed collage.',
    '- Use exactly one coherent before-event-after storyline across 4 images.',
    '',
    'Design rules for low report risk:',
    '- Prefer everyday physical actions and visible cause-effect.',
    '- Avoid symbolism, wordplay, or dream logic when a concrete scene would work better.',
    '- Avoid tiny details that must be noticed to solve the sequence.',
    '- Avoid camera-angle tricks that make two panels look like duplicates.',
    '- Avoid multiple equally plausible orders.',
    '- Avoid stories where the main change happens off-screen.',
    '- Make the transition between panels 1-2-3-4 visibly progressive.',
    '- Prefer actions a child could understand instantly.',
    '',
    '4-panel storyboard checklist (must be applied during generation):',
    '1. Before: starting situation is obvious.',
    '2. Trigger: change clearly begins.',
    '3. Peak change: strongest causal event is visible.',
    '4. After: stable consequence is obvious and clearly follows panel 3.',
    'If panel 4 is not a real consequence of panel 3, reject the candidate.',
    '',
    'What to optimize for:',
    '- one single story chain only',
    '- vivid readable scene design',
    '- visible causality from panel to panel',
    '- clear progression with no near-duplicates',
    '- stable visual anchors across all 4 panels',
    '- big readable state changes even at small size',
    '',
    'Story shapes that often work:',
    '- mishap and aftermath',
    '- reveal and reaction',
    '- obstacle and workaround',
    '- pursuit, escape, containment, or recovery',
    '- repair, transformation, loss, or cleanup',
    '- snag-and-reveal or tangled-prop chain reactions',
    '- runaway object, blocked path, or crooked-result reversals',
    '',
    'Fast rejection rules:',
    '- reject if more than one panel order seems plausible',
    '- reject if two panels are near-duplicates',
    '- reject if the main event happens off-screen',
    '- reject if the story needs explanation',
    '- reject if keywords are present but not functionally important',
    '- reject if ending is only emotion without visible outcome',
    '',
    'Scoring rubric (1-5 for each candidate before final selection):',
    '- keyword_clarity',
    '- single_story_clarity',
    '- causality',
    '- visual_difference',
    '- consensus_safety',
    '- literalness',
    '- ending_strength',
    'Mandatory thresholds:',
    '- causality >= 4',
    '- consensus_safety >= 4',
    '- keyword_clarity >= 4',
    '',
    'Internal workflow:',
    '1. Interpret both keywords using the locked senses below.',
    '2. Generate 3 candidate storylines that pass the checklist/rubric.',
    '3. For each candidate, run a compliance audit:',
    '   - keyword_relevance',
    '   - no_text_needed',
    '   - no_order_labels',
    '   - no_inappropriate_content',
    '   - single_story_only',
    '   - no_waking_up_template',
    '   - no_thumbs_up_down',
    '   - no_enumeration_logic',
    '   - no_screen_or_page_keyword_cheat',
    '   - causal_clarity',
    '   - consensus_clarity',
    '4. Reject any candidate that fails any hard constraint.',
    '5. Among remaining candidates, choose the one with:',
    '   - the clearest causal chain,',
    '   - the least ambiguity,',
    '   - the most literal keyword visibility,',
    '   - the lowest report risk.',
    `6. Output exactly ${normalizedStoryCount} final concept${
      normalizedStoryCount === 1 ? '' : 's'
    }${normalizedStoryCount === 1 ? '.' : ' with different actions/scenes.'}`,
    '',
    'Output format:',
    'Return strict JSON with this exact envelope schema:',
    ...outputEnvelopeLines,
    'Concept schema:',
    outputSchema,
    '',
    'Decision rule:',
    'If there is any meaningful ambiguity, simplify while keeping the scene vivid and concrete.',
    'If a keyword is only weakly implied, make it more literal.',
    'If the concept is clever but not instantly readable, discard it.',
    'Optimize for "clear, vivid, and easy to personalize".',
    'Never output placeholder text such as "Panel 1: add a clear event in the story."',
    'Avoid stock phrases like "in a stable everyday setting", "still clearly visible", or "in the same scene".',
    'Use concrete visual actions and vary wording across panels.',
    'Return story beats a human could quickly rewrite into something better, not compliance filler.',
    normalizedStoryCount === 1
      ? 'Focus on one strong, editable storyboard a human can quickly personalize.'
      : 'Never duplicate concept_1 as concept_2.',
    ...exemplarConfig.lines,
    '',
    'Extra design heuristics:',
    '- make one keyword the actor/object and the other the obstacle/tool/location',
    '- avoid abstract nouns unless converted into an obvious physical scene',
    '- avoid panel 1 and panel 4 looking too similar',
    '- avoid "spot the tiny difference" stories',
    '- avoid meme-style or internet-native imagery that could feel like text-dependent inference',
    '',
    ...lockedSenseLines,
    '',
    `Keyword 1: ${safeKeywordA}`,
    `Keyword 2: ${safeKeywordB}`,
    noiseHint,
    customStoryHint,
    'Return strict JSON only. No markdown.',
  ]
    .filter(Boolean)
    .join('\n')
}

function buildStoryOptionsPromptFast({
  provider,
  keywordA,
  keywordB,
  includeNoise,
  customStory,
  senseSelection,
  exemplarsEnabled = true,
  requestedStoryCount = 2,
}) {
  const safeKeywordA = normalizeKeywordValue(keywordA) || '-'
  const safeKeywordB = normalizeKeywordValue(keywordB) || '-'
  const normalizedStoryCount = normalizeStoryOptionCount(requestedStoryCount)
  const baseStory = normalizeStoryPanels(customStory)
  const hasCustomStory = Array.isArray(customStory) && customStory.length > 0
  const lockedSenseLines = formatSensePromptLines(
    senseSelection,
    safeKeywordA,
    safeKeywordB
  )
  const contentSafetyBoundaryLines = getContentSafetyBoundaryLines()
  const creativityLines = buildStoryCreativityLines({fastMode: true})
  const exemplarConfig = buildStoryPromptExemplarLines({
    provider,
    fastMode: true,
    enabled: exemplarsEnabled,
  })
  const customStoryHint = hasCustomStory
    ? `Use this draft as seed and improve it:
1) ${baseStory[0]}
2) ${baseStory[1]}
3) ${baseStory[2]}
4) ${baseStory[3]}`
    : ''
  const noiseHint = includeNoise
    ? 'Noise is added later to one panel. Keep one coherent story.'
    : ''

  if (normalizedStoryCount === 1) {
    const outputEnvelopeLines = [
      '{',
      '  "stories": [',
      '    <concept_1_in_schema_below>',
      '  ]',
      '}',
    ]
    const outputSchema = `{
  "title": "Option 1",
  "story_summary": "<1 sentence, plain and literal>",
  "panels": [
    {"panel":1,"role":"before","description":"...","required_visibles":["...","..."],"state_change_from_previous":"n/a"},
    {"panel":2,"role":"trigger","description":"...","required_visibles":["...","..."],"state_change_from_previous":"..."},
    {"panel":3,"role":"reaction","description":"...","required_visibles":["...","..."],"state_change_from_previous":"..."},
    {"panel":4,"role":"after","description":"...","required_visibles":["...","..."],"state_change_from_previous":"..."}
  ]
}`
    return buildSingleStoryPromptLines({
      safeKeywordA,
      safeKeywordB,
      includeNoise,
      hasCustomStory,
      baseStory,
      senseSelection,
      lockedSenseLines,
      contentSafetyBoundaryLines,
      creativityLines,
      exemplarConfig,
      outputEnvelopeLines,
      outputSchema,
      fastMode: true,
    })
  }

  return [
    `Generate exactly ${normalizedStoryCount} ${
      normalizedStoryCount === 1
        ? 'strong editable flip story option'
        : 'distinct flip story options'
    } as strict JSON only.`,
    'Goal: fast, vivid, editable 4-panel story seeds for Idena flips.',
    'Rules:',
    '- one single story chain only',
    '- clear structure: before -> trigger -> reaction -> after',
    '- both keywords must be visually present and relevant',
    '- no text overlays, letters, numbers, labels, logos, or watermarks',
    ...contentSafetyBoundaryLines,
    '- no counting puzzles, no symbolism, no surreal jokes',
    normalizedStoryCount === 1
      ? '- make the one option vivid, specific, and easy for a human to tweak'
      : '- keep the two options meaningfully different in scene, action, or outcome',
    '- vary archetype choice; do not default to bump-and-spill unless it is the clearest fit',
    '- panel 4 must be a visible consequence of panel 3',
    '- each panel must show a visible state progression from the previous panel',
    '- avoid repeated stock phrases; use natural concise wording',
    ...creativityLines,
    ...exemplarConfig.lines,
    ...lockedSenseLines,
    'Output JSON schema:',
    '{',
    '  "stories": [',
    '    {',
    '      "title": "Option 1",',
    '      "story_summary": "...",',
    '      "panels": [',
    '        {"panel":1,"role":"before","description":"...","required_visibles":["...","..."],"state_change_from_previous":"n/a"},',
    '        {"panel":2,"role":"trigger","description":"...","required_visibles":["...","..."],"state_change_from_previous":"..."},',
    '        {"panel":3,"role":"reaction","description":"...","required_visibles":["...","..."],"state_change_from_previous":"..."},',
    '        {"panel":4,"role":"after","description":"...","required_visibles":["...","..."],"state_change_from_previous":"..."}',
    '      ],',
    '      "compliance_report": {',
    '        "keyword_relevance": "pass",',
    '        "no_text_needed": "pass",',
    '        "no_order_labels": "pass",',
    '        "no_inappropriate_content": "pass",',
    '        "single_story_only": "pass",',
    '        "no_waking_up_template": "pass",',
    '        "no_thumbs_up_down": "pass",',
    '        "no_enumeration_logic": "pass",',
    '        "no_screen_or_page_keyword_cheat": "pass",',
    '        "causal_clarity": "pass",',
    '        "consensus_clarity": "pass"',
    '      },',
    '      "risk_flags": [],',
    '      "revision_if_risky": ""',
    normalizedStoryCount === 1 ? '    }' : '    },',
    ...(normalizedStoryCount === 1
      ? []
      : [
          '    {',
          '      "title": "Option 2",',
          '      "story_summary": "...",',
          '      "panels": [',
          '        {"panel":1,"role":"before","description":"...","required_visibles":["...","..."],"state_change_from_previous":"n/a"},',
          '        {"panel":2,"role":"trigger","description":"...","required_visibles":["...","..."],"state_change_from_previous":"..."},',
          '        {"panel":3,"role":"reaction","description":"...","required_visibles":["...","..."],"state_change_from_previous":"..."},',
          '        {"panel":4,"role":"after","description":"...","required_visibles":["...","..."],"state_change_from_previous":"..."}',
          '      ],',
          '      "compliance_report": {',
          '        "keyword_relevance": "pass",',
          '        "no_text_needed": "pass",',
          '        "no_order_labels": "pass",',
          '        "no_inappropriate_content": "pass",',
          '        "single_story_only": "pass",',
          '        "no_waking_up_template": "pass",',
          '        "no_thumbs_up_down": "pass",',
          '        "no_enumeration_logic": "pass",',
          '        "no_screen_or_page_keyword_cheat": "pass",',
          '        "causal_clarity": "pass",',
          '        "consensus_clarity": "pass"',
          '      },',
          '      "risk_flags": [],',
          '      "revision_if_risky": ""',
          '    }',
        ]),
    '  ]',
    '}',
    `Keyword 1: ${safeKeywordA}`,
    `Keyword 2: ${safeKeywordB}`,
    noiseHint,
    customStoryHint,
    'Return JSON only. No markdown.',
  ]
    .filter(Boolean)
    .join('\n')
}

function storyOptionToMainPromptConcept(option, keywordA, keywordB) {
  const normalized = option && typeof option === 'object' ? option : {}
  const keywords = [
    normalizeKeywordValue(keywordA),
    normalizeKeywordValue(keywordB),
  ]
    .filter(Boolean)
    .slice(0, 2)
  const safeKeywords = keywords.length ? keywords : ['keyword-1', 'keyword-2']
  const roleByPanel = STORY_PANEL_ROLES
  const complianceReport = STORY_COMPLIANCE_KEYS.reduce((acc, key) => {
    const value =
      normalized.complianceReport && normalized.complianceReport[key]
    const status =
      String(value || '')
        .trim()
        .toLowerCase() === 'fail'
        ? 'fail'
        : 'pass'
    acc[key] = status
    return acc
  }, {})
  const panelDetails = Array.isArray(normalized.panelDetails)
    ? normalized.panelDetails.slice(0, 4)
    : null
  const getDefaultStateChange = (panelIndex) =>
    panelIndex === 0 ? 'n/a' : 'Clear visible change from previous panel.'

  return {
    keywords: safeKeywords,
    final_story_title: String(normalized.title || 'Safe story').trim(),
    story_summary: String(
      normalized.storySummary ||
        normalized.rationale ||
        'A clear four-step visual story.'
    ).trim(),
    panels: (panelDetails || normalizeStoryPanels(normalized.panels)).map(
      (panel, index) => ({
        panel: index + 1,
        role:
          (panel &&
            typeof panel === 'object' &&
            String(panel.role || '')
              .trim()
              .toLowerCase()) ||
          roleByPanel[index] ||
          'progression',
        description:
          panel && typeof panel === 'object'
            ? String(panel.description || '').trim()
            : String(panel || '').trim(),
        required_visibles:
          panel &&
          typeof panel === 'object' &&
          Array.isArray(panel.requiredVisibles) &&
          panel.requiredVisibles.length > 0
            ? panel.requiredVisibles
            : safeKeywords,
        state_change_from_previous:
          panel && typeof panel === 'object'
            ? String(panel.stateChangeFromPrevious || '').trim() ||
              getDefaultStateChange(index)
            : getDefaultStateChange(index),
      })
    ),
    compliance_report: complianceReport,
    risk_flags: Array.isArray(normalized.riskFlags)
      ? normalized.riskFlags
          .map((item) => String(item || '').trim())
          .filter(Boolean)
      : [],
    revision_if_risky: String(normalized.revisionIfRisky || '').trim(),
  }
}

function buildStoryAuditPrompt(basePrompt, conceptJson) {
  return [
    basePrompt,
    '',
    'Audit this concept and hard-reject only clearly extreme or provider-triggering content.',
    'If any hard constraint fails or there is meaningful ambiguity, rewrite it into a safer but still concrete concept.',
    'Keep ordinary fear, tension, creepy atmosphere, safe tool use, and non-graphic conflict when they improve causal clarity.',
    'Keep the rewritten concept specific and visually rich, not generic.',
    'Re-audit using this checklist before returning:',
    '- before -> trigger -> peak change -> after must be explicit',
    '- panel 4 must be a direct visible consequence of panel 3',
    '- one single event chain only',
    '- no near-duplicate panels',
    '- no off-screen main event',
    '- no text dependence and no counting logic',
    'Re-score minimum thresholds:',
    '- causality >= 4',
    '- consensus_safety >= 4',
    '- keyword_clarity >= 4',
    'Return JSON only in the same schema.',
    'Concept JSON to audit:',
    JSON.stringify(conceptJson, null, 2),
  ].join('\n')
}

function summarizeStoryDraftForLog(story) {
  const currentStory = story && typeof story === 'object' ? story : {}
  const qualityReport =
    currentStory.qualityReport && typeof currentStory.qualityReport === 'object'
      ? currentStory.qualityReport
      : {}
  const metrics =
    qualityReport.metrics && typeof qualityReport.metrics === 'object'
      ? qualityReport.metrics
      : {}
  const panels = normalizeStoryPanels(currentStory.panels)
  return {
    title: sanitizeStoryLogText(currentStory.title, 60),
    source: sanitizeStoryLogText(currentStory.candidateSource, 60),
    score: Number.isFinite(Number(qualityReport.score))
      ? Number(qualityReport.score)
      : null,
    failures: Array.isArray(qualityReport.failures)
      ? qualityReport.failures.slice(0, 6)
      : [],
    externalChangeCount: Number.isFinite(Number(metrics.externalChangeCount))
      ? Number(metrics.externalChangeCount)
      : null,
    maxConsecutiveSimilarity: Number.isFinite(
      Number(metrics.maxConsecutiveSimilarity)
    )
      ? Number(metrics.maxConsecutiveSimilarity)
      : null,
    panelPreview: panels
      .slice(0, 2)
      .map((panel) => sanitizeStoryLogText(panel, 90)),
  }
}

function summarizeStoryDraftCollectionForLog(stories, limit = 3) {
  const list = Array.isArray(stories) ? stories : []
  return list.slice(0, limit).map((story) => summarizeStoryDraftForLog(story))
}

function shouldRunStoryAudit(rawText, stories) {
  if (!Array.isArray(stories) || stories.length < 1) return false
  const value = String(rawText || '')
    .trim()
    .toLowerCase()
  if (!value) return false
  return (
    value.includes('"panels"') ||
    value.includes('"stories"') ||
    value.includes('"options"') ||
    value.includes('final_story_title') ||
    value.includes('story_summary')
  )
}

function buildPanelPrompt({
  panelText,
  storyPanels = [],
  keywordA,
  keywordB,
  visualStyle,
  panelIndex,
  includeNoise = false,
  noisePanelIndex = null,
  senseSelection = null,
}) {
  const isNoisePanel =
    includeNoise && Number.isFinite(Number(noisePanelIndex))
      ? Number(noisePanelIndex) === Number(panelIndex)
      : false

  const role = STORY_PANEL_ROLES[panelIndex] || 'progression'
  const previousPanelText =
    panelIndex > 0
      ? normalizeStoryPanel(storyPanels[panelIndex - 1], panelIndex - 1)
      : ''
  const nextPanelText =
    panelIndex < 3
      ? normalizeStoryPanel(storyPanels[panelIndex + 1], panelIndex + 1)
      : ''
  const lockedSenseLines = formatSensePromptLines(
    senseSelection,
    keywordA,
    keywordB
  )
  const continuityLines = buildPanelContinuityLines({
    storyPanels,
    keywordA,
    keywordB,
    senseSelection,
  })
  const differentiationLines = buildPanelDifferentiationLines(panelIndex, role)
  return [
    `Create panel ${
      panelIndex + 1
    } of 4 (role: ${role}) for one coherent visual story.`,
    `Keywords that must remain visually present across the story: ${keywordA} and ${keywordB}.`,
    ...lockedSenseLines,
    ...continuityLines,
    ...differentiationLines,
    `Panel description: ${panelText}`,
    previousPanelText ? `Previous panel context: ${previousPanelText}` : '',
    nextPanelText ? `Next panel context: ${nextPanelText}` : '',
    'Hard constraints:',
    '- Wordless image. No letters, numbers, arrows, signs, labels, UI text, logos, watermarks.',
    '- Keep one main actor/object chain and stable environment unless change itself is the event.',
    '- Show a clear visible state change from previous panel.',
    '- Keep ordinary tension, surprise, creepy atmosphere, and non-graphic conflict if they help the story. Do not escalate into graphic injury, gore, or direct weapon harm to a person or animal.',
    '- Avoid surrealism, jokes, metaphor-heavy symbolism, and duplicate-looking frames.',
    isNoisePanel
      ? '- This panel is marked for post-process adversarial pixel noise later. Keep objects large and readable before distortion.'
      : '',
    'Style requirements:',
    visualStyle,
    'Output image only.',
  ].join('\n')
}

function buildStoryboardSheetPrompt({
  storyPanels = [],
  keywordA,
  keywordB,
  visualStyle,
  includeNoise = false,
  noisePanelIndex = null,
  senseSelection = null,
}) {
  const lockedSenseLines = formatSensePromptLines(
    senseSelection,
    keywordA,
    keywordB
  )
  const continuityLines = buildPanelContinuityLines({
    storyPanels,
    keywordA,
    keywordB,
    senseSelection,
  })
  const differentiationLines = buildStoryboardDifferentiationLines()
  const normalizedPanels = normalizeStoryPanels(storyPanels)
  const panelLines = normalizedPanels.map((panelText, index) => {
    const role = STORY_PANEL_ROLES[index] || 'progression'
    return `- Panel ${index + 1} (${role}): ${panelText}`
  })

  return [
    'Create one single 2x2 storyboard sheet image with four silent comic panels in reading order.',
    `Keywords that must remain visually present across the story: ${keywordA} and ${keywordB}.`,
    ...lockedSenseLines,
    ...continuityLines,
    ...differentiationLines,
    'Layout requirements:',
    '- Show exactly four panels arranged as a 2x2 grid with clear visual separation.',
    '- Reading order must be top-left panel 1, top-right panel 2, bottom-left panel 3, bottom-right panel 4.',
    '- Keep each panel large and readable. Do not add panel numbers, speech bubbles, captions, letters, logos, watermarks, or UI text.',
    '- Keep one coherent environment and recurring subject across the whole sheet.',
    '- Make each quadrant visibly distinct in action, pose, camera framing, and state progression.',
    includeNoise
      ? `- Panel ${
          Number(noisePanelIndex) + 1
        } may receive adversarial noise later, so keep its main objects large and centered.`
      : '',
    'Storyboard content:',
    ...panelLines,
    'Style requirements:',
    visualStyle,
    'Output image only.',
  ]
    .filter(Boolean)
    .join('\n')
}

function createEmptyPanelTextAuditResult() {
  return {
    checked: false,
    passed: true,
    hasText: false,
    attempts: 0,
    retriesUsed: 0,
    reason: '',
    detectedText: [],
  }
}

function createEmptyRenderedPanelAuditResult() {
  return {
    invoked: false,
    passed: true,
    failureReasons: [],
    shouldRetryPanel: false,
    shouldReplan: false,
    panelRepairReason: '',
    ocr_text_check: {status: 'not_configured', passed: true},
    keyword_visibility_check: {status: 'not_configured', passed: true},
    alignment_check: {status: 'not_configured', passed: true},
    policy_risk_check: {status: 'not_configured', passed: true},
    summary: {
      invoked: false,
      passed: true,
      failureReasons: [],
      shouldRetryPanel: false,
      shouldReplan: false,
      panelRepairReason: '',
    },
  }
}

function buildPanelValidatorRetrySuffix({
  summary = {},
  validatorResult = {},
  keywordA = '',
  keywordB = '',
}) {
  const repairReason = String(summary.panelRepairReason || '').trim()
  const recommendations = []
  const layerRecommendations = [
    validatorResult.ocr_text_check &&
      validatorResult.ocr_text_check.retryRecommendation,
    validatorResult.keyword_visibility_check &&
      validatorResult.keyword_visibility_check.retryRecommendation,
    validatorResult.alignment_check &&
      validatorResult.alignment_check.retryRecommendation,
    validatorResult.policy_risk_check &&
      validatorResult.policy_risk_check.retryRecommendation,
  ]
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)

  if (repairReason === 'ocr_text_leakage') {
    recommendations.push(
      'Critical retry: previous output contained forbidden text or logo-like markings.',
      'Do not draw any letters, numbers, labels, logos, signs, UI text, or watermarks.',
      'Replace any text-bearing object with a text-free visual equivalent.'
    )
  }

  if (repairReason === 'keyword_visibility') {
    recommendations.push(
      'Critical retry: both keywords were not visually recognizable enough.',
      `Make "${keywordA}" and "${keywordB}" explicitly visible as concrete scene elements, not vague hints.`,
      'Keep the key objects or reactions large, central, and easy to recognize at a glance.'
    )
  }

  if (repairReason === 'alignment_mismatch') {
    recommendations.push(
      'Critical retry: previous output drifted from the planned panel description.',
      'Follow the planned panel literally and show the main event with a clear visible consequence.',
      'Keep the same scene, actor, and causal action chain as the panel description.'
    )
  }

  if (repairReason === 'policy_risk') {
    recommendations.push(
      'Critical retry: previous output became too extreme or provider-triggering.',
      'Keep the same keywords and scene intent, but depict it in a clearly non-graphic, non-injury, no-direct-harm way.',
      'Allow tension, fear, and eerie atmosphere without gore, explicit injury, or direct weapon harm to a person or animal.'
    )
  }

  return ['', ...recommendations, ...layerRecommendations]
    .filter(Boolean)
    .join('\n')
}

function buildLegacyTextAuditFromValidator({
  validatorResult = null,
  checked = false,
  attempts = 0,
  retriesUsed = 0,
  reason = '',
}) {
  const ocrCheck =
    validatorResult && validatorResult.ocr_text_check
      ? validatorResult.ocr_text_check
      : {passed: true, detectedText: []}
  const detectedText = Array.isArray(ocrCheck.detectedText)
    ? ocrCheck.detectedText
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .slice(0, 6)
    : []
  const ocrFailed = ocrCheck.passed === false || ocrCheck.status === 'fail'

  return {
    checked,
    passed: !ocrFailed,
    hasText: ocrFailed,
    attempts,
    retriesUsed,
    reason: String(reason || '').trim(),
    detectedText,
  }
}

function getRemoteErrorPayload(data) {
  if (!data) {
    return {}
  }

  if (typeof data === 'string') {
    return {message: data}
  }

  if (typeof data !== 'object') {
    return {}
  }

  if (data.error && typeof data.error === 'object') {
    return {
      message: data.error.message || '',
      code: data.error.code || data.error.type || '',
      type: data.error.type || '',
    }
  }

  return {
    message: data.message || data.error_description || '',
    code: data.code || '',
    type: data.type || '',
  }
}

function createProviderErrorMessage({provider, model, operation, error}) {
  const status = error && error.response && error.response.status
  const statusText = error && error.response && error.response.statusText
  const remote = getRemoteErrorPayload(
    error && error.response && error.response.data
  )

  const marker = []
  if (Number.isFinite(status)) {
    marker.push(String(status))
  }
  if (remote.code) {
    marker.push(String(remote.code))
  } else if (remote.type) {
    marker.push(String(remote.type))
  } else if (error && error.code) {
    marker.push(String(error.code))
  }

  const reason =
    String(remote.message || '').trim() ||
    String(statusText || '').trim() ||
    String((error && error.message) || '').trim() ||
    String(error || 'Unknown error')

  const markerText = marker.length ? ` (${marker.join(' ')})` : ''
  return `${String(provider || 'provider')} ${String(
    operation || 'request'
  )} failed${markerText} for model ${String(model || '').trim()}: ${reason}`
}

function getResponseStatus(error) {
  return error && error.response && error.response.status
}

function getRetryAfterMs(error) {
  const headers = (error && error.response && error.response.headers) || {}
  const raw = headers['retry-after'] || headers['Retry-After']
  if (raw == null) {
    return null
  }

  const asNumber = Number(raw)
  if (Number.isFinite(asNumber) && asNumber >= 0) {
    return asNumber * 1000
  }

  const asDate = Date.parse(String(raw))
  if (Number.isFinite(asDate)) {
    return Math.max(0, asDate - Date.now())
  }

  return null
}

function isTimeoutError(error) {
  const timeoutCode = String(error && error.code ? error.code : '')
    .trim()
    .toUpperCase()
  if (timeoutCode === 'ECONNABORTED') {
    return true
  }

  const message = String((error && error.message) || '')
    .trim()
    .toLowerCase()
  if (!message) {
    return false
  }

  return (
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('deadline exceeded')
  )
}

function buildImageTimeoutCandidates(
  baseTimeoutMs,
  {
    minimumTimeoutMs = MIN_IMAGE_REQUEST_TIMEOUT_MS,
    stepsMs = IMAGE_TIMEOUT_BACKOFF_STEPS_MS,
  } = {}
) {
  const base = Math.max(
    minimumTimeoutMs,
    Number(baseTimeoutMs) || minimumTimeoutMs
  )
  const values = stepsMs.map((step) => base + step)
  return Array.from(new Set(values))
}

function buildImageProfileCandidates({provider, imageModel, imageSize}) {
  const model = String(imageModel || '').trim() || 'gpt-image-1-mini'
  const size = normalizeProviderImageSize(imageSize)
  const candidates = [{imageModel: model, imageSize: size, reason: 'requested'}]

  if (size !== '1024x1024') {
    candidates.push({
      imageModel: model,
      imageSize: '1024x1024',
      reason: 'smaller-size',
    })
  }

  if (isOpenAiCompatibleProvider(provider)) {
    if (model.toLowerCase() !== 'gpt-image-1-mini') {
      candidates.push({
        imageModel: 'gpt-image-1-mini',
        imageSize: '1024x1024',
        reason: 'faster-model',
      })
    }
  }

  return candidates.filter((item, index, list) => {
    const key = `${item.imageModel}|${item.imageSize}`
    return (
      list.findIndex((entry) => {
        const entryKey = `${entry.imageModel}|${entry.imageSize}`
        return entryKey === key
      }) === index
    )
  })
}

function resolveSheetImageSize(requestedImageSize) {
  const normalized = normalizeProviderImageSize(requestedImageSize)
  if (normalized === '1536x1024') {
    return normalized
  }
  return '1536x1024'
}

function hashScore(value) {
  const text = String(value || '')
  let score = 17
  for (let index = 0; index < text.length; index += 1) {
    score = (score * 131 + text.charCodeAt(index)) % 2147483647
  }
  return score
}

function buildSwapPlan(flips) {
  const total = Array.isArray(flips) ? flips.length : 0
  if (!total) {
    return []
  }

  const swapTarget = Math.ceil(total / 2)
  const scored = flips.map((flip, index) => ({
    index,
    score: hashScore(`${flip && flip.hash ? flip.hash : ''}:${index}`),
  }))

  scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score
    }
    return a.index - b.index
  })

  const swapPlan = Array(total).fill(false)
  for (let index = 0; index < swapTarget; index += 1) {
    const target = scored[index]
    if (target) {
      swapPlan[target.index] = true
    }
  }

  return swapPlan
}

function remapDecisionIfSwapped(decision, swapped) {
  if (!swapped) {
    return decision
  }

  if (decision.answer === 'left') {
    return {...decision, answer: 'right'}
  }

  if (decision.answer === 'right') {
    return {...decision, answer: 'left'}
  }

  return decision
}

function normalizeConsultProviders(payload, primaryProvider, primaryModel) {
  const legacyHeuristicEnabled = Boolean(
    payload && payload.legacyHeuristicEnabled
  )
  const legacyHeuristicOnly = Boolean(
    legacyHeuristicEnabled && payload && payload.legacyHeuristicOnly
  )
  const primaryWeight = normalizeConsultantWeight(
    payload && payload.ensemblePrimaryWeight,
    1
  )
  const result = []
  const seen = new Set()

  if (!legacyHeuristicOnly) {
    result.push({
      provider: primaryProvider,
      model: primaryModel,
      source: 'primary',
      weight: primaryWeight,
    })
    seen.add(`${primaryProvider}:${String(primaryModel).toLowerCase()}`)
  }

  const providerConfig =
    payload &&
    payload.providerConfig &&
    typeof payload.providerConfig === 'object'
      ? payload.providerConfig
      : null

  const rawCandidates = Array.isArray(payload && payload.consultProviders)
    ? payload.consultProviders
    : []

  const consultSlotsFromSettings =
    payload && payload.ensembleEnabled && !legacyHeuristicOnly
      ? [
          {
            enabled: payload.ensembleProvider2Enabled,
            provider: payload.ensembleProvider2,
            model: payload.ensembleModel2,
            source: 'ensemble-slot-2',
            weight: payload.ensembleProvider2Weight,
          },
          {
            enabled: payload.ensembleProvider3Enabled,
            provider: payload.ensembleProvider3,
            model: payload.ensembleModel3,
            source: 'ensemble-slot-3',
            weight: payload.ensembleProvider3Weight,
          },
        ]
      : []

  const legacyHeuristicFromSettings = legacyHeuristicEnabled
    ? [
        {
          strategy: LEGACY_HEURISTIC_STRATEGY,
          source: 'legacy-heuristic',
          weight: payload.legacyHeuristicWeight,
        },
      ]
    : []

  const candidateList = legacyHeuristicOnly
    ? legacyHeuristicFromSettings
    : rawCandidates
        .concat(consultSlotsFromSettings)
        .concat(legacyHeuristicFromSettings)

  candidateList.forEach((candidate) => {
    if (!candidate || result.length >= MAX_CONSULTANTS) return
    if (candidate.enabled === false) return

    const strategy = String(candidate.strategy || '')
      .trim()
      .toLowerCase()
    const providerLike = String(candidate.provider || '')
      .trim()
      .toLowerCase()

    if (
      strategy === LEGACY_HEURISTIC_STRATEGY ||
      providerLike === LEGACY_HEURISTIC_PROVIDER
    ) {
      const strategyKey = `${LEGACY_HEURISTIC_PROVIDER}:${LEGACY_HEURISTIC_MODEL}`
      if (seen.has(strategyKey)) {
        return
      }

      seen.add(strategyKey)
      result.push({
        provider: LEGACY_HEURISTIC_PROVIDER,
        model: LEGACY_HEURISTIC_MODEL,
        source:
          String(candidate.source || 'legacy-heuristic').trim() ||
          'legacy-heuristic',
        weight: normalizeConsultantWeight(candidate.weight, 1),
        internalStrategy: LEGACY_HEURISTIC_STRATEGY,
      })
      return
    }

    let provider = ''
    try {
      provider = normalizeProvider(candidate.provider || primaryProvider)
    } catch (error) {
      return
    }

    const model = String(candidate.model || '').trim()
    if (!model) return

    const key = `${provider}:${model.toLowerCase()}`
    if (seen.has(key)) return

    seen.add(key)
    result.push({
      provider,
      model,
      source: String(candidate.source || 'consult').trim() || 'consult',
      weight: normalizeConsultantWeight(candidate.weight, 1),
      providerConfig:
        provider === PROVIDERS.Anthropic ||
        provider === PROVIDERS.OpenAICompatible
          ? candidate.providerConfig || providerConfig || null
          : candidate.providerConfig || null,
    })
  })

  return result.slice(0, MAX_CONSULTANTS)
}

function decisionToDistribution(decision = {}) {
  if (decision.error) {
    return {
      left: 0,
      right: 0,
      skip: 0,
      weight: 0,
    }
  }

  const answer = normalizeAnswer(decision.answer)
  const confidence = normalizeConfidence(decision.confidence)
  if (confidence <= 0) {
    return {
      left: 0,
      right: 0,
      skip: 0,
      weight: 0,
    }
  }

  const remainder = (1 - confidence) / 2
  const distribution = {
    left: remainder,
    right: remainder,
    skip: remainder,
    weight: 1,
  }
  distribution[answer] = confidence

  return distribution
}

function resolveProbabilityWinner(probabilities, tieBreakerKey = '') {
  const answers = ['left', 'right', 'skip']
  const maxProbability = Math.max(
    probabilities.left,
    probabilities.right,
    probabilities.skip
  )
  const tiedAnswers = answers.filter(
    (answer) => Math.abs(probabilities[answer] - maxProbability) < 1e-9
  )

  if (tiedAnswers.length <= 1) {
    return {
      answer: tiedAnswers[0] || 'skip',
      tieBreakApplied: false,
      tieBreakCandidates: null,
    }
  }

  const rankedAnswers = tiedAnswers.slice().sort((a, b) => {
    const scoreDelta =
      hashScore(`${tieBreakerKey}:${b}`) - hashScore(`${tieBreakerKey}:${a}`)
    if (scoreDelta !== 0) {
      return scoreDelta
    }
    return a.localeCompare(b)
  })

  return {
    answer: rankedAnswers[0],
    tieBreakApplied: true,
    tieBreakCandidates: tiedAnswers,
  }
}

function aggregateConsultantDecisions(decisions = [], tieBreakerKey = '') {
  if (!Array.isArray(decisions) || decisions.length === 0) {
    return {
      answer: 'skip',
      confidence: 0,
      reasoning: 'No consultant decisions available',
      probabilities: null,
      contributors: 0,
      totalWeight: 0,
      tieBreakApplied: false,
      tieBreakCandidates: null,
    }
  }

  if (decisions.length === 1) {
    const item = decisions[0]
    return {
      answer: normalizeAnswer(item.answer),
      confidence: normalizeConfidence(item.confidence),
      reasoning: item.reasoning,
      probabilities: null,
      contributors: item.error ? 0 : 1,
      totalWeight: item.error ? 0 : normalizeConsultantWeight(item.weight, 1),
      tieBreakApplied: false,
      tieBreakCandidates: null,
    }
  }

  const totals = {left: 0, right: 0, skip: 0}
  let contributors = 0
  let totalWeight = 0

  decisions.forEach((decision) => {
    const distribution = decisionToDistribution(decision)
    if (distribution.weight <= 0) return
    const decisionWeight = normalizeConsultantWeight(decision.weight, 1)
    totals.left += distribution.left * decisionWeight
    totals.right += distribution.right * decisionWeight
    totals.skip += distribution.skip * decisionWeight
    contributors += 1
    totalWeight += decisionWeight
  })

  if (contributors <= 0 || totalWeight <= 0) {
    const fallback = decisions.find((item) => !item.error) || decisions[0]
    return {
      answer: normalizeAnswer(fallback && fallback.answer),
      confidence: normalizeConfidence(fallback && fallback.confidence),
      reasoning:
        'All consultant requests failed; using fallback consultant decision',
      probabilities: null,
      contributors: 0,
      totalWeight: 0,
      tieBreakApplied: false,
      tieBreakCandidates: null,
    }
  }

  const probabilities = {
    left: totals.left / totalWeight,
    right: totals.right / totalWeight,
    skip: totals.skip / totalWeight,
  }

  const {answer, tieBreakApplied, tieBreakCandidates} =
    resolveProbabilityWinner(probabilities, tieBreakerKey)

  return {
    answer,
    confidence: normalizeConfidence(probabilities[answer]),
    reasoning: `ensemble average probabilities left=${probabilities.left.toFixed(
      3
    )}, right=${probabilities.right.toFixed(
      3
    )}, skip=${probabilities.skip.toFixed(3)}${
      tieBreakApplied
        ? `, tie-break ${answer} over ${tieBreakCandidates
            .filter((item) => item !== answer)
            .join('/')}`
        : ''
    }`,
    probabilities,
    contributors,
    totalWeight,
    tieBreakApplied,
    tieBreakCandidates,
  }
}

function chooseRandomSide() {
  return Math.random() < 0.5 ? 'left' : 'right'
}

function resolveSecondPassStrategy({useFrameReasoning, secondPass}) {
  if (useFrameReasoning) {
    return secondPass ? 'annotated_frame_review' : 'frame_reasoning'
  }

  return secondPass ? 'uncertainty_recheck' : 'initial_decision'
}

function normalizeImageList(value) {
  if (!Array.isArray(value)) {
    return []
  }

  return value.map((item) => String(item || '').trim()).filter(Boolean)
}

function resolveVisionModeForFlip(profile, flip) {
  const requested = String(
    profile && profile.flipVisionMode ? profile.flipVisionMode : 'composite'
  )
    .trim()
    .toLowerCase()

  if (requested === 'composite') {
    return {
      requested,
      applied: 'composite',
      leftFrames: [],
      rightFrames: [],
      fallbackReason: null,
    }
  }

  const leftFrames = normalizeImageList(flip && flip.leftFrames).slice(0, 4)
  const rightFrames = normalizeImageList(flip && flip.rightFrames).slice(0, 4)

  if (!leftFrames.length || !rightFrames.length) {
    return {
      requested,
      applied: 'composite',
      leftFrames: [],
      rightFrames: [],
      fallbackReason: 'missing_frames',
    }
  }

  return {
    requested,
    applied:
      requested === 'frames_single_pass' || requested === 'frames_two_pass'
        ? requested
        : 'composite',
    leftFrames,
    rightFrames,
    fallbackReason:
      requested === 'frames_single_pass' || requested === 'frames_two_pass'
        ? null
        : 'unsupported_mode',
  }
}

function buildProviderFlipForVision({
  flip,
  swapped,
  visionMode,
  leftFrames,
  rightFrames,
}) {
  const baseFlip = swapped
    ? {
        ...flip,
        leftImage: flip.rightImage,
        rightImage: flip.leftImage,
      }
    : {...flip}

  if (visionMode === 'composite') {
    return {
      ...baseFlip,
      leftFrames: Array.isArray(baseFlip.leftFrames) ? baseFlip.leftFrames : [],
      rightFrames: Array.isArray(baseFlip.rightFrames)
        ? baseFlip.rightFrames
        : [],
      images: [baseFlip.leftImage, baseFlip.rightImage].filter(Boolean),
    }
  }

  const effectiveLeftFrames = swapped ? rightFrames : leftFrames
  const effectiveRightFrames = swapped ? leftFrames : rightFrames

  return {
    ...baseFlip,
    leftFrames: effectiveLeftFrames,
    rightFrames: effectiveRightFrames,
    images: effectiveLeftFrames.concat(effectiveRightFrames),
  }
}

function createEmptyTokenUsage() {
  return {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  }
}

function normalizeTokenUsage(usage = {}) {
  const promptTokens = Number(usage.promptTokens)
  const completionTokens = Number(usage.completionTokens)
  const totalTokens = Number(usage.totalTokens)

  const normalizedPrompt =
    Number.isFinite(promptTokens) && promptTokens >= 0 ? promptTokens : 0
  const normalizedCompletion =
    Number.isFinite(completionTokens) && completionTokens >= 0
      ? completionTokens
      : 0

  const normalizedTotal =
    Number.isFinite(totalTokens) && totalTokens >= 0
      ? totalTokens
      : normalizedPrompt + normalizedCompletion

  return {
    promptTokens: normalizedPrompt,
    completionTokens: normalizedCompletion,
    totalTokens: normalizedTotal,
  }
}

function normalizeProviderResponse(providerResponse) {
  if (typeof providerResponse === 'string') {
    return {
      rawText: providerResponse,
      tokenUsage: createEmptyTokenUsage(),
      providerMeta: null,
    }
  }

  if (providerResponse && typeof providerResponse === 'object') {
    let rawText = ''
    let providerMeta = null

    if (typeof providerResponse.rawText === 'string') {
      rawText = providerResponse.rawText
    } else if (typeof providerResponse.content === 'string') {
      rawText = providerResponse.content
    }

    if (
      providerResponse.providerMeta &&
      typeof providerResponse.providerMeta === 'object'
    ) {
      providerMeta = providerResponse.providerMeta
    } else if (
      providerResponse.meta &&
      typeof providerResponse.meta === 'object'
    ) {
      providerMeta = providerResponse.meta
    }

    return {
      rawText,
      tokenUsage: normalizeTokenUsage(providerResponse.usage),
      providerMeta,
    }
  }

  return {
    rawText: '',
    tokenUsage: createEmptyTokenUsage(),
    providerMeta: null,
  }
}

function normalizeFastMode(providerMeta = null) {
  if (
    !providerMeta ||
    typeof providerMeta !== 'object' ||
    !providerMeta.fastMode ||
    typeof providerMeta.fastMode !== 'object'
  ) {
    return null
  }

  const {fastMode} = providerMeta
  return {
    requested: fastMode.requested === true,
    requestedServiceTier: fastMode.requestedServiceTier || null,
    requestedReasoningEffort: fastMode.requestedReasoningEffort || null,
    appliedServiceTier: fastMode.appliedServiceTier || null,
    compatibilityFallbackUsed: fastMode.compatibilityFallbackUsed === true,
    missingRequestedParameters: Array.isArray(
      fastMode.missingRequestedParameters
    )
      ? fastMode.missingRequestedParameters.filter(Boolean)
      : [],
    priorityDowngraded: fastMode.priorityDowngraded === true,
  }
}

function summarizeConsultantFastMode(consultantDecisions = []) {
  const entries = consultantDecisions
    .map((item) => normalizeFastMode(item && item.providerMeta))
    .filter((item) => item && item.requested)

  if (!entries.length) {
    return null
  }

  const missingRequestedParameters = Array.from(
    new Set(
      entries.flatMap((item) =>
        Array.isArray(item.missingRequestedParameters)
          ? item.missingRequestedParameters
          : []
      )
    )
  )

  return {
    requested: true,
    requestedServiceTier:
      entries.find((item) => item.requestedServiceTier)?.requestedServiceTier ||
      null,
    requestedReasoningEffort:
      entries.find((item) => item.requestedReasoningEffort)
        ?.requestedReasoningEffort || null,
    appliedServiceTier:
      entries.find((item) => item.appliedServiceTier)?.appliedServiceTier ||
      null,
    compatibilityFallbackUsed: entries.some(
      (item) => item.compatibilityFallbackUsed
    ),
    missingRequestedParameters,
    priorityDowngraded: entries.some((item) => item.priorityDowngraded),
  }
}

function addTokenUsage(left = {}, right = {}) {
  const a = normalizeTokenUsage(left)
  const b = normalizeTokenUsage(right)
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  }
}

function summarizeTokenUsage(results) {
  return results.reduce(
    (acc, item) => {
      const usage = normalizeTokenUsage(item && item.tokenUsage)
      const hasUsage =
        usage.promptTokens > 0 ||
        usage.completionTokens > 0 ||
        usage.totalTokens > 0

      return {
        promptTokens: acc.promptTokens + usage.promptTokens,
        completionTokens: acc.completionTokens + usage.completionTokens,
        totalTokens: acc.totalTokens + usage.totalTokens,
        flipsWithUsage: acc.flipsWithUsage + (hasUsage ? 1 : 0),
      }
    },
    {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      flipsWithUsage: 0,
    }
  )
}

function normalizeUsdCost(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function createEmptyCostSummary() {
  return {
    estimatedUsd: null,
    actualUsd: null,
  }
}

function normalizeCostSummary(costs = {}) {
  return {
    estimatedUsd: normalizeUsdCost(costs.estimatedUsd),
    actualUsd: normalizeUsdCost(costs.actualUsd),
  }
}

function addCostSummary(left = {}, right = {}) {
  const a = normalizeCostSummary(left)
  const b = normalizeCostSummary(right)

  return {
    estimatedUsd:
      a.estimatedUsd == null && b.estimatedUsd == null
        ? null
        : (a.estimatedUsd || 0) + (b.estimatedUsd || 0),
    actualUsd:
      a.actualUsd == null && b.actualUsd == null
        ? null
        : (a.actualUsd || 0) + (b.actualUsd || 0),
  }
}

function estimateProviderTextCostSummary(provider, model, usage = {}) {
  if (
    !provider ||
    provider === LEGACY_HEURISTIC_PROVIDER ||
    isLocalAiProvider(provider)
  ) {
    return createEmptyCostSummary()
  }

  if (!isOpenAiCompatibleProvider(provider)) {
    return createEmptyCostSummary()
  }

  const estimatedUsd = estimateTextCostUsd(usage, model)

  return {
    estimatedUsd: normalizeUsdCost(estimatedUsd),
    actualUsd: normalizeUsdCost(estimatedUsd),
  }
}

function summarizeCostSummary(results = []) {
  const totals = results.reduce(
    (acc, item) => {
      const costs = normalizeCostSummary(item && item.costs)
      return {
        estimatedUsd:
          acc.estimatedUsd +
          (costs.estimatedUsd == null ? 0 : costs.estimatedUsd),
        actualUsd:
          acc.actualUsd + (costs.actualUsd == null ? 0 : costs.actualUsd),
        itemsWithEstimated:
          acc.itemsWithEstimated + (costs.estimatedUsd == null ? 0 : 1),
        itemsWithActual:
          acc.itemsWithActual + (costs.actualUsd == null ? 0 : 1),
      }
    },
    {
      estimatedUsd: 0,
      actualUsd: 0,
      itemsWithEstimated: 0,
      itemsWithActual: 0,
    }
  )

  return {
    estimatedUsd: totals.itemsWithEstimated > 0 ? totals.estimatedUsd : null,
    actualUsd: totals.itemsWithActual > 0 ? totals.actualUsd : null,
    itemsWithEstimated: totals.itemsWithEstimated,
    itemsWithActual: totals.itemsWithActual,
  }
}

function normalizeValidationReportKeywords(keywords = []) {
  if (!Array.isArray(keywords)) {
    return []
  }

  return keywords
    .map((item, index) => {
      if (item && typeof item === 'object') {
        const name = String(item.name || item.keyword || '').trim()
        const desc = String(item.desc || item.description || '').trim()
        if (!name && !desc) {
          return null
        }
        return {
          name: name || `keyword-${index + 1}`,
          desc,
        }
      }

      const keywordName = String(item || '').trim()
      if (!keywordName) {
        return null
      }
      return {name: keywordName, desc: ''}
    })
    .filter(Boolean)
    .slice(0, 2)
}

function buildValidationReportReviewPrompt({keywords = []} = {}) {
  const normalizedKeywords = normalizeValidationReportKeywords(keywords)
  const keywordLines = normalizedKeywords.length
    ? normalizedKeywords.map((item, index) => {
        const detail = item.desc ? ` - ${item.desc}` : ''
        return `${index + 1}. ${item.name}${detail}`
      })
    : ['1. keyword unavailable', '2. keyword unavailable']

  return [
    'You are reviewing one already-selected Idena validation flip sequence during the long-session keyword check.',
    'You will receive exactly 4 ordered frames for the chosen story and the 2 official keywords.',
    'Decide whether the chosen sequence should be APPROVED or REPORTED.',
    'Report only for clear rule violations:',
    '- one keyword is missing, irrelevant, or not clearly visible in the chosen sequence',
    '- the sequence depends on reading text to solve',
    '- numbers, letters, arrows, labels, or overlays indicate frame order',
    '- inappropriate, adult, or graphic content is present',
    '- the 4 frames contain multiple unrelated stories instead of one coherent sequence',
    '- the flip uses an obvious waking-up template',
    '- the flip ends with a thumbs up/down style answer cue',
    '- the keywords only appear inside a page, screen, painting, poster, or printed collage',
    'Do not report merely because the story is awkward, low quality, or hard.',
    'If you are uncertain, choose "approve".',
    'Return JSON only with this shape:',
    '{"decision":"approve"|"report","confidence":0.0,"reason":"short reason","triggeredRules":["keyword_missing"]}',
    '',
    'Keywords:',
    ...keywordLines,
  ].join('\n')
}

function normalizeValidationReportDecision(parsed) {
  const rawDecision = String(
    (parsed && (parsed.decision || parsed.answer || parsed.verdict)) || ''
  )
    .trim()
    .toLowerCase()

  const decision = [
    'report',
    'reported',
    'reject',
    'flag',
    'bad',
    'invalid',
  ].includes(rawDecision)
    ? 'report'
    : 'approve'

  const reason = String(
    (parsed && (parsed.reason || parsed.reasoning || parsed.summary)) || ''
  )
    .trim()
    .slice(0, 240)

  const triggeredRules = Array.isArray(parsed && parsed.triggeredRules)
    ? parsed.triggeredRules
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .slice(0, 8)
    : []

  return {
    decision,
    confidence: normalizeConfidence(parsed && parsed.confidence),
    reason,
    triggeredRules,
  }
}

function aggregateValidationReportReviews(reviews = []) {
  let approveScore = 0
  let reportScore = 0
  let totalWeight = 0
  let bestApprove = null
  let bestApproveScore = -1
  let bestReport = null
  let bestReportScore = -1

  reviews.forEach((item) => {
    const weight = normalizeConsultantWeight(item && item.weight, 1)
    const confidence = normalizeConfidence(item && item.confidence)
    const score = weight * confidence

    totalWeight += weight

    if (item && item.decision === 'report') {
      reportScore += score
      if (score > bestReportScore) {
        bestReportScore = score
        bestReport = item
      }
      return
    }

    approveScore += score
    if (score > bestApproveScore) {
      bestApproveScore = score
      bestApprove = item
    }
  })

  if (reportScore <= 0 && approveScore <= 0) {
    return {
      decision: 'approve',
      confidence: 0,
      reason: 'insufficient signal',
      triggeredRules: [],
      totalWeight,
    }
  }

  const decision = reportScore > approveScore ? 'report' : 'approve'
  const chosenScore = decision === 'report' ? reportScore : approveScore
  const bestReview = decision === 'report' ? bestReport : bestApprove

  return {
    decision,
    confidence:
      totalWeight > 0 ? Math.max(0, Math.min(1, chosenScore / totalWeight)) : 0,
    reason:
      (bestReview && bestReview.reason) ||
      (decision === 'report'
        ? 'reported by automated review'
        : 'approved by automated review'),
    triggeredRules:
      decision === 'report' &&
      bestReview &&
      Array.isArray(bestReview.triggeredRules)
        ? bestReview.triggeredRules
        : [],
    totalWeight,
  }
}

function createAiProviderBridge(logger, dependencies = {}) {
  const providerKeys = new Map(
    Object.values(PROVIDERS).map((provider) => [provider, null])
  )

  const now =
    typeof dependencies.now === 'function' ? dependencies.now : () => Date.now()
  const httpClient = dependencies.httpClient || axios

  const getUserDataPath =
    typeof dependencies.getUserDataPath === 'function'
      ? dependencies.getUserDataPath
      : resolveUserDataPath

  const invokeProvider =
    typeof dependencies.invokeProvider === 'function'
      ? dependencies.invokeProvider
      : runProvider

  const runPythonFlipStoryPipeline =
    typeof dependencies.runPythonFlipStoryPipeline === 'function'
      ? dependencies.runPythonFlipStoryPipeline
      : runPythonFlipStoryPipelineDefault

  const writeBenchmarkLog =
    typeof dependencies.writeBenchmarkLog === 'function'
      ? dependencies.writeBenchmarkLog
      : writeBenchmarkLogDefault
  const storyValidatorHooks = createStoryValidatorHooks(
    dependencies.storyValidatorHooks
  )
  const localAiManager = dependencies.localAiManager || null
  const getLocalAiPayload =
    typeof dependencies.getLocalAiPayload === 'function'
      ? dependencies.getLocalAiPayload
      : (payload = {}) => payload

  const sleep =
    typeof dependencies.sleep === 'function'
      ? dependencies.sleep
      : (ms) =>
          new Promise((resolve) => {
            setTimeout(resolve, ms)
          })

  function withOperationTimeout(promise, timeoutMs, message) {
    const normalizedTimeoutMs = Number(timeoutMs)
    if (!Number.isFinite(normalizedTimeoutMs) || normalizedTimeoutMs <= 0) {
      return promise
    }

    let timeoutId = null

    return Promise.race([
      promise,
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(message))
        }, normalizedTimeoutMs)
      }),
    ]).finally(() => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    })
  }

  function getApiKey(provider) {
    const key = providerKeys.get(provider)
    if (!key) {
      throw new Error(`API key is not set for provider: ${provider}`)
    }
    return key
  }

  function ensureLocalAiManager() {
    if (
      !localAiManager ||
      typeof localAiManager.checkFlipSequence !== 'function'
    ) {
      throw new Error('Local AI runtime bridge is not available')
    }

    return localAiManager
  }

  function buildLocalAiPayload(payload = {}) {
    return getLocalAiPayload(payload)
  }

  function buildLocalAiNeutralFramePrompt({
    hash,
    forceDecision,
    firstCandidateLabel,
    secondCandidateLabel,
  }) {
    return `
You are solving an Idena short-session flip benchmark.
You are given 8 ordered frame images:
- Images 1-4 belong to the first shown candidate: OPTION ${firstCandidateLabel} (in temporal order)
- Images 5-8 belong to the second shown candidate: OPTION ${secondCandidateLabel} (in temporal order)

Task:
1) Inspect each frame separately and identify the main actors, action, and visible state.
2) If readable text exists, transcribe it and translate it to English if needed.
3) Build one short story summary for OPTION ${firstCandidateLabel} and one for OPTION ${secondCandidateLabel}.
4) Compare the two candidate stories using chronology, visible cause -> effect, and consistent entities.
5) Decide which candidate is more coherent.
6) Return JSON only.

Allowed JSON schema:
{"answer":"a|b|skip","confidence":0.0,"reasoning":"short optional note"}

Rules:
- Use only ${forceDecision ? 'a|b' : 'a|b|skip'} for "answer"
- "confidence" must be between 0 and 1
- Candidate labels are runtime labels only. Do not use label identity or first-vs-second position as a hint.
- If solving clearly requires reading text, or visible order labels/numbers/letters/arrows/captions are drawn on the images, treat the flip as report-worthy and return skip unless forceDecision forbids it.
- If inappropriate, NSFW, or graphic violent content is present, treat the flip as report-worthy and return skip unless forceDecision forbids it.
- Keep reasoning concise and factual and mention one concrete visual cue
${
  forceDecision
    ? '- You must choose a or b unless the flip is clearly report-worthy.'
    : '- If both candidates are ambiguous, equally weak, or clearly report-worthy, return "skip".'
}

Flip hash: ${hash}
`.trim()
  }

  function normalizeLocalAiCandidateAnswer(answer) {
    const value = String(answer || '')
      .trim()
      .toLowerCase()

    if (['a', 'option a', 'candidate a'].includes(value)) {
      return 'a'
    }

    if (['b', 'option b', 'candidate b'].includes(value)) {
      return 'b'
    }

    if (['left', 'l', '1'].includes(value)) {
      return 'a'
    }

    if (['right', 'r', '2'].includes(value)) {
      return 'b'
    }

    return 'skip'
  }

  function extractLocalAiCandidateAnswerFromText(rawText) {
    const text = String(rawText || '')
      .trim()
      .toLowerCase()

    if (!text) {
      throw new Error('Empty local AI multimodal response')
    }

    const answerFieldMatch = text.match(
      /"answer"\s*:\s*"?(a|b|skip|left|right|option a|option b|candidate a|candidate b)"?/i
    )
    if (answerFieldMatch && answerFieldMatch[1]) {
      return answerFieldMatch[1]
    }

    const explicitPhraseMatch = text.match(
      /\b(answer|choose|pick|select|option)\b[^.\n:]*\b(a|b|skip|left|right)\b/i
    )
    if (explicitPhraseMatch && explicitPhraseMatch[2]) {
      return explicitPhraseMatch[2]
    }

    const compactTokenMatch = text.match(/^\s*(a|b|skip|left|right)\b/i)
    if (compactTokenMatch && compactTokenMatch[1]) {
      return compactTokenMatch[1]
    }

    throw new Error('Provider response does not contain a recognizable answer')
  }

  function translateLocalAiCandidateDecision(parsed, optionAMapsTo) {
    const candidateAnswer = normalizeLocalAiCandidateAnswer(
      parsed && parsed.answer
    )
    const confidence = normalizeConfidence(parsed && parsed.confidence)
    const reasoning =
      typeof (parsed && parsed.reasoning) === 'string'
        ? parsed.reasoning.slice(0, 240)
        : undefined

    if (candidateAnswer === 'skip') {
      return {
        answer: 'skip',
        confidence,
        reasoning,
      }
    }

    const oppositeOption = optionAMapsTo === 'left' ? 'right' : 'left'
    const answer = candidateAnswer === 'a' ? optionAMapsTo : oppositeOption

    return {
      answer,
      confidence,
      reasoning,
    }
  }

  function parseLocalAiCandidateDecision(rawText, optionAMapsTo) {
    try {
      const parsed = extractJsonBlock(rawText)
      return translateLocalAiCandidateDecision(parsed, optionAMapsTo)
    } catch {
      const fallbackAnswer = extractLocalAiCandidateAnswerFromText(rawText)
      return translateLocalAiCandidateDecision(
        {answer: fallbackAnswer, confidence: 0.5, reasoning: rawText},
        optionAMapsTo
      )
    }
  }

  async function runLocalAiDirectMultimodalProvider({
    manager,
    runtimePayload,
    flip,
    profile,
    leftImages,
    rightImages,
  }) {
    const optionAMapsTo =
      hashScore(`${flip.hash}:candidate-a`) % 2 === 0 ? 'left' : 'right'
    const optionAImages = optionAMapsTo === 'left' ? leftImages : rightImages
    const optionBImages = optionAMapsTo === 'left' ? rightImages : leftImages
    const firstCandidateKey =
      hashScore(`${flip.hash}:candidate-presentation`) % 2 === 0 ? 'a' : 'b'
    const secondCandidateKey = firstCandidateKey === 'a' ? 'b' : 'a'
    const prompt = buildLocalAiNeutralFramePrompt({
      hash: flip.hash,
      forceDecision: profile.forceDecision,
      firstCandidateLabel: firstCandidateKey.toUpperCase(),
      secondCandidateLabel: secondCandidateKey.toUpperCase(),
    })
    const images =
      firstCandidateKey === 'a'
        ? optionAImages.concat(optionBImages)
        : optionBImages.concat(optionAImages)
    const preferredVisionModels = Array.from(
      new Set(
        [String(runtimePayload.visionModel || '').trim()]
          .concat(
            Array.isArray(runtimePayload.visionModelFallbacks)
              ? runtimePayload.visionModelFallbacks
              : []
          )
          .map((item) => String(item || '').trim())
          .filter(Boolean)
      )
    )
    const triedVisionModels = new Set()
    let lastError = null

    for (const visionModel of preferredVisionModels) {
      if (!triedVisionModels.has(visionModel)) {
        triedVisionModels.add(visionModel)

        const directResponse = await withOperationTimeout(
          manager.chat({
            ...runtimePayload,
            visionModel,
            responseFormat: 'json',
            generationOptions: {
              temperature: 0,
              num_predict: 96,
            },
            messages: [
              {
                role: 'user',
                content: prompt,
                images,
              },
            ],
          }),
          runtimePayload.timeoutMs,
          `Local AI direct multimodal request timed out after ${runtimePayload.timeoutMs}ms`
        )

        if (directResponse.ok && String(directResponse.text || '').trim()) {
          try {
            const translatedDecision = parseLocalAiCandidateDecision(
              directResponse.text,
              optionAMapsTo
            )

            return {
              content: JSON.stringify(translatedDecision),
              meta: {
                mode: 'direct_multimodal',
                runtime: directResponse,
                visionModel,
                optionAMapsTo,
                firstCandidateKey,
              },
            }
          } catch (error) {
            lastError = error.toString()
          }
        }

        if (!lastError) {
          lastError =
            directResponse.lastError ||
            directResponse.error ||
            `Local AI direct multimodal request failed for ${visionModel}`
        }
      }
    }

    throw new Error(lastError || 'Local AI direct multimodal request failed')
  }

  async function runLocalAiProvider({model, flip, profile}) {
    const manager = ensureLocalAiManager()
    const leftImages =
      Array.isArray(flip.leftFrames) && flip.leftFrames.length
        ? flip.leftFrames
        : [flip.leftImage].filter(Boolean)
    const rightImages =
      Array.isArray(flip.rightFrames) && flip.rightFrames.length
        ? flip.rightFrames
        : [flip.rightImage].filter(Boolean)

    if (!leftImages.length || !rightImages.length) {
      throw new Error('Local AI provider requires left/right flip images')
    }

    const runtimePayload = buildLocalAiPayload({
      model,
      timeoutMs: profile.requestTimeoutMs,
    })

    if (
      profile.flipVisionMode === 'frames_single_pass' ||
      profile.flipVisionMode === 'frames_two_pass'
    ) {
      return runLocalAiDirectMultimodalProvider({
        manager,
        runtimePayload,
        flip,
        profile,
        leftImages,
        rightImages,
      })
    }

    const [left, right] = await Promise.all([
      withOperationTimeout(
        manager.checkFlipSequence({
          ...runtimePayload,
          images: leftImages,
        }),
        runtimePayload.timeoutMs,
        `Local AI left sequence check timed out after ${runtimePayload.timeoutMs}ms`
      ),
      withOperationTimeout(
        manager.checkFlipSequence({
          ...runtimePayload,
          images: rightImages,
        }),
        runtimePayload.timeoutMs,
        `Local AI right sequence check timed out after ${runtimePayload.timeoutMs}ms`
      ),
    ])

    const decision = buildLocalAiDecisionFromChecks(left, right)

    return {
      content: JSON.stringify({
        answer: decision.answer,
        confidence: decision.confidence,
        reasoning: decision.reasoning,
      }),
      meta: {
        left,
        right,
      },
    }
  }

  function setProviderKey({provider, apiKey}) {
    const normalized = normalizeProvider(provider)

    if (isLocalAiProvider(normalized)) {
      throw new Error('Local AI does not use session API keys')
    }

    const key = String(apiKey || '').trim()

    if (!key) {
      throw new Error('API key is empty')
    }

    providerKeys.set(normalized, key)
    logger.info('AI provider key updated', {provider: normalized})

    return {ok: true, provider: normalized}
  }

  function clearProviderKey({provider}) {
    const normalized = normalizeProvider(provider)

    if (isLocalAiProvider(normalized)) {
      return {ok: true, provider: normalized}
    }

    providerKeys.set(normalized, null)
    logger.info('AI provider key cleared', {provider: normalized})
    return {ok: true, provider: normalized}
  }

  function hasProviderKey({provider}) {
    const normalized = normalizeProvider(provider)

    if (isLocalAiProvider(normalized)) {
      return {
        ok: true,
        provider: normalized,
        hasKey: false,
        error: 'local_ai_uses_runtime',
      }
    }

    const key = providerKeys.get(normalized)
    return {
      ok: true,
      provider: normalized,
      hasKey: Boolean(key),
    }
  }

  async function runProvider({
    provider,
    model,
    flip,
    profile,
    apiKey,
    providerConfig,
    promptText = '',
    promptOptions = {},
  }) {
    if (isLocalAiProvider(provider)) {
      return runLocalAiProvider({
        model,
        flip,
        profile,
      })
    }

    const resolvedApiKey = apiKey || getApiKey(provider)
    const resolvedProviderConfig = resolveProviderConfig(
      provider,
      providerConfig
    )
    const prompt =
      String(promptText || '').trim() ||
      promptTemplate({
        hash: flip.hash,
        forceDecision: Boolean(promptOptions.forceDecision),
        secondPass: Boolean(promptOptions.secondPass),
        promptTemplateOverride: profile.promptTemplateOverride,
        uncertaintyRepromptInstruction: profile.uncertaintyRepromptInstruction,
        flipVisionMode: promptOptions.flipVisionMode || profile.flipVisionMode,
        promptPhase: promptOptions.promptPhase || 'decision',
        frameReasoning: promptOptions.frameReasoning || '',
      })
    const systemPrompt = systemPromptTemplate()

    if (isOpenAiCompatibleProvider(provider)) {
      return callOpenAi({
        httpClient,
        apiKey: resolvedApiKey,
        model,
        flip,
        prompt,
        systemPrompt,
        profile,
        providerConfig: resolvedProviderConfig,
        promptOptions,
      })
    }

    if (provider === PROVIDERS.Anthropic) {
      return callAnthropic({
        httpClient,
        apiKey: resolvedApiKey,
        model,
        flip,
        prompt,
        systemPrompt,
        profile,
        providerConfig: resolvedProviderConfig,
        promptOptions,
      })
    }

    return callGemini({
      httpClient,
      apiKey: resolvedApiKey,
      model,
      flip,
      prompt,
      systemPrompt,
      profile,
      providerConfig: resolvedProviderConfig,
      promptOptions,
    })
  }

  async function runImageProvider({
    provider,
    imageModel,
    prompt,
    profile,
    apiKey,
    providerConfig,
    size = '1024x1024',
    quality = '',
    style = '',
  }) {
    const resolvedApiKey = apiKey || getApiKey(provider)
    const resolvedProviderConfig = resolveProviderConfig(
      provider,
      providerConfig
    )

    if (isOpenAiCompatibleProvider(provider)) {
      return callOpenAiImage({
        httpClient,
        apiKey: resolvedApiKey,
        model: imageModel,
        prompt,
        profile,
        providerConfig: resolvedProviderConfig,
        size,
        quality,
        style,
      })
    }

    if (provider === PROVIDERS.Gemini) {
      return callGeminiImage({
        httpClient,
        apiKey: resolvedApiKey,
        model: imageModel,
        prompt,
        profile,
        providerConfig: resolvedProviderConfig,
        size,
        quality,
        style,
      })
    }

    throw new Error(
      `Image generation is not supported for provider: ${provider}. Supported providers: openai-compatible and gemini.`
    )
  }

  async function testProvider({provider, model, providerConfig}) {
    const normalized = normalizeProvider(provider)
    const finalModel = String(model || DEFAULT_MODELS[normalized]).trim()
    const startedAt = now()
    const profile = sanitizeBenchmarkProfile()

    if (isLocalAiProvider(normalized)) {
      const manager = ensureLocalAiManager()
      const result = await manager.status({
        ...buildLocalAiPayload({
          model: finalModel,
          timeoutMs: profile.requestTimeoutMs,
        }),
        refresh: true,
      })

      if (!result || result.sidecarReachable !== true) {
        throw new Error(
          String((result && (result.lastError || result.error)) || '').trim() ||
            'Local AI runtime is unavailable'
        )
      }

      return {
        ok: true,
        provider: normalized,
        model: finalModel,
        latencyMs: now() - startedAt,
      }
    }

    const apiKey = getApiKey(normalized)
    const resolvedProviderConfig = resolveProviderConfig(
      normalized,
      providerConfig
    )

    try {
      await withRetries(1, async (attempt) => {
        try {
          if (isOpenAiCompatibleProvider(normalized)) {
            await testOpenAiProvider({
              httpClient,
              apiKey,
              model: finalModel,
              profile,
              providerConfig: resolvedProviderConfig,
            })
          } else if (normalized === PROVIDERS.Anthropic) {
            await testAnthropicProvider({
              httpClient,
              apiKey,
              model: finalModel,
              profile,
              providerConfig: resolvedProviderConfig,
            })
          } else {
            await testGeminiProvider({
              httpClient,
              apiKey,
              model: finalModel,
              profile,
              providerConfig: resolvedProviderConfig,
            })
          }
        } catch (error) {
          const status = getResponseStatus(error)
          const timeoutCode = String(error && error.code ? error.code : '')
            .trim()
            .toUpperCase()
          const isTimeout = timeoutCode === 'ECONNABORTED'
          if ((status === 429 || isTimeout) && attempt < 1) {
            const retryAfterMs = isTimeout
              ? 1800
              : getRetryAfterMs(error) || 1200
            logger.info('AI provider test retrying after transient failure', {
              provider: normalized,
              model: finalModel,
              retryAfterMs,
              timeout: isTimeout,
            })
            await sleep(retryAfterMs)
          }
          throw error
        }
      })
    } catch (error) {
      const message = createProviderErrorMessage({
        provider: normalized,
        model: finalModel,
        operation: 'test',
        error,
      })
      logger.error('AI provider test failed', {
        provider: normalized,
        model: finalModel,
        error: message,
      })
      throw new Error(message)
    }

    return {
      ok: true,
      provider: normalized,
      model: finalModel,
      latencyMs: now() - startedAt,
    }
  }

  async function listModels({provider, providerConfig}) {
    const normalized = normalizeProvider(provider)

    if (isLocalAiProvider(normalized)) {
      const manager = ensureLocalAiManager()
      const result = await manager.listModels(
        buildLocalAiPayload({allowRuntimeStart: false})
      )
      const message = String(
        (result && (result.lastError || result.error)) || ''
      ).trim()

      if (result && result.ok === false) {
        throw new Error(message || 'Local AI runtime is unavailable')
      }

      const unique = Array.from(
        new Set(
          (Array.isArray(result && result.models) ? result.models : [])
            .map((item) => String(item || '').trim())
            .filter(Boolean)
        )
      ).sort((a, b) => a.localeCompare(b))

      return {
        ok: true,
        provider: normalized,
        total: unique.length,
        models: unique,
      }
    }

    const profile = sanitizeBenchmarkProfile()
    const apiKey = getApiKey(normalized)
    const resolvedProviderConfig = resolveProviderConfig(
      normalized,
      providerConfig
    )

    try {
      let models = []
      if (isOpenAiCompatibleProvider(normalized)) {
        models = await listOpenAiModels({
          httpClient,
          apiKey,
          profile,
          providerConfig: resolvedProviderConfig,
        })
      } else if (normalized === PROVIDERS.Anthropic) {
        models = await listAnthropicModels({
          httpClient,
          apiKey,
          profile,
          providerConfig: resolvedProviderConfig,
        })
      } else {
        models = await listGeminiModels({
          httpClient,
          apiKey,
          profile,
          providerConfig: resolvedProviderConfig,
        })
      }

      const unique = Array.from(
        new Set(models.map((item) => String(item || '').trim()).filter(Boolean))
      ).sort((a, b) => a.localeCompare(b))

      return {
        ok: true,
        provider: normalized,
        total: unique.length,
        models: unique,
      }
    } catch (error) {
      const message = createProviderErrorMessage({
        provider: normalized,
        model: '-',
        operation: 'list_models',
        error,
      })

      logger.error('AI provider model list failed', {
        provider: normalized,
        error: message,
      })

      throw new Error(message)
    }
  }

  async function generateStoryOptions(payload = {}) {
    const requestedStoryCount = normalizeStoryOptionCount(
      payload.storyOptionCount
    )
    const disableLocalFallback = payload.disableLocalFallback === true
    const fastStoryMode = payload.fastStoryMode === true
    const provider = normalizeProvider(payload.provider)
    const model = String(payload.model || DEFAULT_MODELS[provider]).trim()
    const providerConfig = payload.providerConfig || null
    const [keywordA, keywordB] = normalizeKeywords(payload)
    const senseSelection = getLockedSenseSelection(null, keywordA, keywordB)
    const humanStorySeed = ''
    const includeNoise = Boolean(payload.includeNoise)
    const customStory = normalizeStoryPanels(payload.customStoryPanels)
    const hasCustomStory = Boolean(payload.hasCustomStory)
    const optimizeIntent = String(payload.optimizeIntent || '').trim()
    const specificityOptimizeRequested =
      optimizeIntent === 'specificity' &&
      requestedStoryCount === 1 &&
      hasCustomStory &&
      hasMeaningfulStoryPanels(customStory)
    const storyExemplarsEnabled = payload.storyExemplarsEnabled !== false
    const promptExemplarConfig = buildStoryPromptExemplarLines({
      provider,
      fastMode: fastStoryMode,
      enabled: storyExemplarsEnabled,
    })

    const hasCustomTemperature =
      Number.isFinite(Number(payload.temperature)) &&
      Number(payload.temperature) >= 0
    const defaultTemperature = fastStoryMode ? 0.7 : 0.85
    let defaultStoryRequestTimeoutMs = 34000
    if (fastStoryMode) {
      defaultStoryRequestTimeoutMs = requestedStoryCount === 1 ? 18000 : 22000
    } else if (requestedStoryCount === 1) {
      defaultStoryRequestTimeoutMs = 28000
    }
    let defaultStoryMaxOutputTokens = 2600
    if (fastStoryMode) {
      defaultStoryMaxOutputTokens = requestedStoryCount === 1 ? 1800 : 2200
    } else if (requestedStoryCount === 1) {
      defaultStoryMaxOutputTokens = 2600
    }
    let minimumStoryRequestTimeoutMs = 34000
    if (fastStoryMode) {
      minimumStoryRequestTimeoutMs = requestedStoryCount === 1 ? 20000 : 24000
    } else if (requestedStoryCount === 1) {
      minimumStoryRequestTimeoutMs = 30000
    }

    let minimumStoryMaxOutputTokens = 3200
    if (fastStoryMode) {
      minimumStoryMaxOutputTokens = requestedStoryCount === 1 ? 1800 : 2200
    } else if (requestedStoryCount === 1) {
      minimumStoryMaxOutputTokens = 2600
    }

    let profile = sanitizeBenchmarkProfile({
      benchmarkProfile: 'custom',
      requestTimeoutMs: Math.max(
        Number(payload.requestTimeoutMs || defaultStoryRequestTimeoutMs),
        minimumStoryRequestTimeoutMs
      ),
      maxOutputTokens: Math.max(
        Number(payload.maxOutputTokens || defaultStoryMaxOutputTokens),
        minimumStoryMaxOutputTokens
      ),
      temperature: hasCustomTemperature
        ? Number(payload.temperature)
        : defaultTemperature,
      maxRetries: payload.maxRetries || 2,
      maxConcurrency: 1,
      deadlineMs: Math.max(
        Math.max(
          Number(payload.requestTimeoutMs || defaultStoryRequestTimeoutMs),
          minimumStoryRequestTimeoutMs
        ) + 5000,
        fastStoryMode ? 16000 : 22000
      ),
    })
    profile = {
      ...profile,
      requestTimeoutMs: Math.max(
        Number(profile.requestTimeoutMs) || 0,
        minimumStoryRequestTimeoutMs
      ),
      maxOutputTokens: Math.max(
        Number(profile.maxOutputTokens) || 0,
        minimumStoryMaxOutputTokens
      ),
      deadlineMs: Math.max(
        Number(profile.deadlineMs) || 0,
        Math.max(
          Number(profile.requestTimeoutMs) || 0,
          minimumStoryRequestTimeoutMs
        ) + 5000,
        fastStoryMode ? 16000 : 22000
      ),
    }
    const startedAt = now()
    const storyMetrics = createStoryGenerationMetrics()
    const storyEvaluationCache = new Map()
    let fallbackCandidateQuality = null
    let storyFallbackReasonText = 'provider output could not be parsed reliably'
    const providerDraftRejectedCandidates = []

    function evaluateCandidateStories(candidateStories, source) {
      const accepted = []
      const rejected = []
      const storyCandidates = Array.isArray(candidateStories)
        ? candidateStories
        : []

      storyCandidates.forEach((candidate, index) => {
        const normalizedStory = normalizeStoryOption(
          {
            ...(candidate && typeof candidate === 'object' ? candidate : {}),
            id:
              candidate && typeof candidate === 'object' && candidate.id
                ? candidate.id
                : `option-${index + 1}`,
            senseSelection,
          },
          index
        )
        const qualityCacheKey = createStoryQualityCacheKey(normalizedStory)
        let cachedEvaluation = storyEvaluationCache.get(qualityCacheKey)

        if (!cachedEvaluation) {
          cachedEvaluation = {
            qualityReport: evaluateStoryQuality(normalizedStory),
            isMeaningful: hasMeaningfulStoryPanels(normalizedStory.panels),
          }
          storyEvaluationCache.set(qualityCacheKey, cachedEvaluation)
        }

        const {qualityReport} = cachedEvaluation
        const storyWithQuality = {
          ...normalizedStory,
          qualityReport,
          candidateSource: source,
        }
        const {isMeaningful} = cachedEvaluation

        if (!isMeaningful || !qualityReport.ok) {
          recordStoryQualityMetrics(storyMetrics, qualityReport)
          logger.info('AI story quality reject', {
            provider,
            model,
            source,
            option: index + 1,
            meaningfulPanels: isMeaningful,
            failures: qualityReport.failures,
            score: qualityReport.score,
            externalChangeCount: qualityReport.metrics.externalChangeCount,
            maxConsecutiveSimilarity:
              qualityReport.metrics.maxConsecutiveSimilarity,
          })
          rejected.push(storyWithQuality)
          return
        }

        accepted.push(storyWithQuality)
      })

      return {
        accepted,
        rejected,
      }
    }

    function collectProviderDraftRejectedCandidates(quality) {
      const rejectedStories =
        quality && Array.isArray(quality.rejected) ? quality.rejected : []
      rejectedStories.forEach((story) => {
        if (!isProviderMeaningfulDraftCandidate(story)) return
        const signature = normalizeStoryPanels(story.panels)
          .join('|')
          .toLowerCase()
        const alreadyTracked = providerDraftRejectedCandidates.some(
          (candidate) =>
            normalizeStoryPanels(candidate.panels).join('|').toLowerCase() ===
            signature
        )
        if (!alreadyTracked) {
          providerDraftRejectedCandidates.push(story)
          logger.info('AI story provider draft candidate retained for rescue', {
            provider,
            model,
            candidate: summarizeStoryDraftForLog(story),
            rescuePoolSize: providerDraftRejectedCandidates.length,
          })
        }
      })
    }

    function rerankStoriesForDiversity(candidateStories, primaryStories = []) {
      const pool = dedupeStoriesForSelection(candidateStories)
      let selection = selectStoryOptionPair(pool, {
        requestedCount: requestedStoryCount,
      })
      const baselineSelection = selectStoryOptionPair(
        dedupeStoriesForSelection(primaryStories),
        {
          requestedCount: requestedStoryCount,
        }
      )

      if (
        baselineSelection.selectedPair &&
        selection.selectedPair &&
        primaryStories.length >= requestedStoryCount
      ) {
        const selectedUsesFallback = selection.selectedStories.some(
          (story) =>
            String(
              story && story.candidateSource ? story.candidateSource : ''
            ) === 'local_fallback'
        )
        const baselineDiversityAdequate =
          baselineSelection.selectedPair.pairwiseDiversityScore >= 52
        const improvement =
          selection.selectedPair.finalCombinedScore -
          baselineSelection.selectedPair.finalCombinedScore

        if (
          selectedUsesFallback &&
          baselineDiversityAdequate &&
          improvement < 6
        ) {
          logger.info('AI story diversity rejection reasons', {
            provider,
            model,
            storyIds: selection.selectedPair.storyIds,
            reasons: ['quality_first_keep_primary_pair'],
            pairwiseDiversityScore:
              selection.selectedPair.pairwiseDiversityScore,
            finalCombinedScore: selection.selectedPair.finalCombinedScore,
            baselineCombinedScore:
              baselineSelection.selectedPair.finalCombinedScore,
          })
          selection = baselineSelection
        }
      }

      logger.info('AI story diversity candidate quality scores', {
        provider,
        model,
        candidates: selection.candidateQualityScores,
      })

      if (selection.pairwiseScores.length > 0) {
        logger.info('AI story diversity pairwise scores', {
          provider,
          model,
          pairs: selection.pairwiseScores.map((pair) => ({
            storyIds: pair.storyIds,
            qualityScores: pair.qualityScores,
            averageQuality: pair.averageQuality,
            minQuality: pair.minQuality,
            qualityFloorPenalty: pair.qualityFloorPenalty,
            pairwiseDiversityScore: pair.pairwiseDiversityScore,
            diversityBonus: pair.diversityBonus,
            finalCombinedScore: pair.finalCombinedScore,
            diversityRejectionReasons: pair.diversityRejectionReasons,
          })),
        })
      }

      const rejectedPairs = selection.pairwiseScores.filter(
        (pair) =>
          Array.isArray(pair.diversityRejectionReasons) &&
          pair.diversityRejectionReasons.length > 0 &&
          (!selection.selectedPair ||
            pair.pairKey !== selection.selectedPair.pairKey)
      )
      rejectedPairs.forEach((pair) => {
        logger.info('AI story diversity rejection reasons', {
          provider,
          model,
          storyIds: pair.storyIds,
          reasons: pair.diversityRejectionReasons,
          pairwiseDiversityScore: pair.pairwiseDiversityScore,
          finalCombinedScore: pair.finalCombinedScore,
        })
      })

      if (selection.selectedPair) {
        logger.info('AI story final selected option pair', {
          provider,
          model,
          storyIds: selection.selectedPair.storyIds,
          qualityScores: selection.selectedPair.qualityScores,
          pairwiseDiversityScore: selection.selectedPair.pairwiseDiversityScore,
          finalCombinedScore: selection.selectedPair.finalCombinedScore,
          diversityWeakness: selection.diversityWeakness,
        })
      } else if (selection.diversityWeakness) {
        logger.info('AI story final selected option pair', {
          provider,
          model,
          storyIds: selection.selectedStories.map((story) => story.id),
          qualityScores: selection.selectedStories.map((story) =>
            story &&
            story.qualityReport &&
            Number.isFinite(Number(story.qualityReport.score))
              ? Number(story.qualityReport.score)
              : 0
          ),
          pairwiseDiversityScore: 0,
          finalCombinedScore: 0,
          diversityWeakness: selection.diversityWeakness,
        })
      }

      return {
        pool,
        selection,
      }
    }

    function getFallbackCandidateQuality() {
      if (fallbackCandidateQuality) {
        return fallbackCandidateQuality
      }

      fallbackCandidateQuality = evaluateCandidateStories(
        buildKeywordFallbackStories({
          keywordA,
          keywordB,
          includeNoise,
          customStory: hasCustomStory ? customStory : null,
          humanStorySeed,
          senseSelection,
          fallbackReasonText: storyFallbackReasonText,
        }),
        'local_fallback'
      )

      return fallbackCandidateQuality
    }

    async function finalizeStoryResult({
      stories: resultStories,
      promptText: resultPromptText,
      generationPath: resultGenerationPath = null,
      semanticPlan = null,
      usage: resultUsage,
      estimatedCostUsd: resultEstimatedCostUsd,
    }) {
      const validatorHooks = await runStoryValidatorHooks({
        hooks: storyValidatorHooks,
        stories: resultStories,
        context: {
          provider,
          model,
          keywordA,
          keywordB,
          promptText: resultPromptText,
          senseSelection,
          metrics: storyMetrics,
          generationPath: resultGenerationPath,
        },
      })

      storyMetrics.total_latency_ms = now() - startedAt
      logger.info('AI story quality metrics', {
        provider,
        model,
        ...storyMetrics,
      })

      return {
        ok: true,
        provider,
        model,
        latencyMs: storyMetrics.total_latency_ms,
        stories: resultStories,
        senseSelection,
        tokenUsage: resultUsage,
        costs: {
          estimatedUsd: resultEstimatedCostUsd,
          actualUsd: resultEstimatedCostUsd,
        },
        promptText: resultPromptText,
        generationPath: resultGenerationPath,
        semanticPlan,
        metrics: storyMetrics,
        validatorHooks,
      }
    }

    logger.info('AI story sense selection', {
      rawKeywords: senseSelection.raw_keywords,
      candidateSenses: senseSelection.candidate_senses,
      rejectedSenses: senseSelection.rejected_senses,
      chosenSenses: senseSelection.chosen_senses,
      compatibilityScores: senseSelection.compatibility_scores,
      selectionSource: senseSelection.selection_source,
      topPairWasWeak: senseSelection.top_pair_was_weak,
      attemptedNextBestPair: senseSelection.attempted_next_best_pair,
    })
    logger.info('AI story prompt steering', {
      provider,
      model,
      fastStoryMode,
      exemplarsEnabled: promptExemplarConfig.enabled,
      promptVariantUsed: promptExemplarConfig.variant,
      exemplarLineCount: promptExemplarConfig.lines.length,
      maxOutputTokens: profile.maxOutputTokens,
      requestTimeoutMs: profile.requestTimeoutMs,
    })

    if (shouldUsePythonFlipPipeline(payload)) {
      try {
        const pythonResult = await runPythonFlipStoryPipeline({
          keywordA,
          keywordB,
          provider,
          timeoutMs:
            Number(payload.pythonPipelineTimeoutMs) ||
            Number(profile.requestTimeoutMs) ||
            DEFAULT_PYTHON_FLIP_PIPELINE_TIMEOUT_MS,
        })
        const pythonStories = buildStoryOptionsFromPythonPipeline({
          keywordA,
          keywordB,
          includeNoise,
          storyPanels: pythonResult.storyPanels,
          semanticPlan: pythonResult.semanticPlan,
        })
          .slice(0, requestedStoryCount)
          .map((story, index) =>
            normalizeStoryOption(
              {
                ...story,
                id: `option-${index + 1}`,
                senseSelection,
              },
              index
            )
          )
        const pythonQuality = evaluateCandidateStories(
          pythonStories,
          'python_story_pipeline'
        )

        if (pythonQuality.accepted.length >= requestedStoryCount) {
          return finalizeStoryResult({
            stories: pythonQuality.accepted.slice(0, requestedStoryCount),
            promptText: 'python:idena_flip_pipeline',
            generationPath: 'python_story_pipeline',
            semanticPlan:
              pythonResult.semanticPlan &&
              typeof pythonResult.semanticPlan === 'object'
                ? pythonResult.semanticPlan
                : null,
            usage: createEmptyTokenUsage(),
            estimatedCostUsd: null,
          })
        }

        if (pythonStories.length > 0) {
          logger.info(
            'Python story pipeline returned stories but quality gating rejected at least one candidate',
            {
              provider,
              model,
              acceptedStories: pythonQuality.accepted.length,
              rejectedStories: pythonQuality.rejected.length,
            }
          )
        }
      } catch (pythonError) {
        logger.info(
          'Python story pipeline unavailable, falling back to provider LLM flow',
          {
            provider,
            model,
            error: String(
              (pythonError && pythonError.message) || pythonError || ''
            )
              .trim()
              .slice(0, 280),
          }
        )
      }
    }

    const promptText = fastStoryMode
      ? buildStoryOptionsPromptFast({
          provider,
          keywordA,
          keywordB,
          includeNoise,
          customStory: hasCustomStory ? customStory : null,
          senseSelection,
          exemplarsEnabled: storyExemplarsEnabled,
          requestedStoryCount,
        })
      : buildStoryOptionsPrompt({
          provider,
          keywordA,
          keywordB,
          includeNoise,
          customStory: hasCustomStory ? customStory : null,
          senseSelection,
          exemplarsEnabled: storyExemplarsEnabled,
          requestedStoryCount,
        })
    const apiKey = getApiKey(provider)
    let combinedUsage = createEmptyTokenUsage()
    const attemptHistory = []

    async function invokeStructuredStoryAttempt({
      promptText: attemptPromptText,
      promptPhase,
      attemptLabel,
      profileOverride = profile,
      requestHash = `story-option-${startedAt}`,
      expectedStoryCount = requestedStoryCount,
    }) {
      const structuredOutput = createStoryStructuredOutputOptions(
        provider,
        expectedStoryCount
      )
      try {
        const providerResponse = await invokeProvider({
          provider,
          model,
          flip: {
            hash: requestHash,
            leftImage: '',
            rightImage: '',
            images: [],
          },
          profile: profileOverride,
          apiKey,
          providerConfig,
          promptText: attemptPromptText,
          promptOptions: {
            promptPhase,
            ...(structuredOutput ? {structuredOutput} : {}),
          },
        })

        const normalizedResponse = normalizeProviderResponse(providerResponse)
        combinedUsage = addTokenUsage(
          combinedUsage,
          normalizedResponse.tokenUsage
        )
        const strictParse = parseStrictStoryOptions(
          normalizedResponse.rawText,
          expectedStoryCount
        )
        const classification = classifyStoryProviderOutcome({
          normalizedResponse,
          strictParse,
        })
        const attempt = {
          ...classification,
          normalizedResponse,
          strictParse,
          promptText: attemptPromptText,
          promptPhase,
          attemptLabel,
        }

        attemptHistory.push({
          attempt: attemptLabel,
          promptPhase,
          outcome: attempt.outcome,
          detail: attempt.detail,
        })

        logger.info('AI story provider outcome classification', {
          provider,
          model,
          attempt: attemptLabel,
          promptPhase,
          outcome: attempt.outcome,
          finishReason: sanitizeStoryLogText(
            attempt.providerMeta && attempt.providerMeta.finishReason,
            60
          ),
          blockReason: sanitizeStoryLogText(
            attempt.providerMeta && attempt.providerMeta.blockReason,
            60
          ),
          refusal: sanitizeStoryLogText(
            attempt.providerMeta && attempt.providerMeta.refusal,
            160
          ),
          detail: attempt.detail,
        })

        return attempt
      } catch (error) {
        const detail = sanitizeStoryLogText(
          (error && error.message) || error || '',
          220
        )
        const attempt = {
          outcome: STORY_PROVIDER_OUTCOMES.TRANSPORT_ERROR,
          detail,
          error,
          normalizedResponse: null,
          strictParse: null,
          providerMeta: {},
          promptText: attemptPromptText,
          promptPhase,
          attemptLabel,
        }

        attemptHistory.push({
          attempt: attemptLabel,
          promptPhase,
          outcome: attempt.outcome,
          detail,
        })

        logger.info('AI story provider outcome classification', {
          provider,
          model,
          attempt: attemptLabel,
          promptPhase,
          outcome: attempt.outcome,
          detail,
        })

        return attempt
      }
    }

    function recordStoryAttemptOutcome(attempt) {
      const currentAttempt =
        attempt && typeof attempt === 'object' ? attempt : {outcome: ''}

      storyMetrics.safe_replan_used =
        storyMetrics.safe_replan_used ||
        Boolean(
          currentAttempt.providerMeta &&
            currentAttempt.providerMeta.safeReplanUsed
        )

      if (currentAttempt.outcome === STORY_PROVIDER_OUTCOMES.SCHEMA_INVALID) {
        storyMetrics.parse_fail += 1
        logger.info('AI story parse_fail', {
          provider,
          model,
          attempt: currentAttempt.attemptLabel,
          errorType:
            currentAttempt.strictParse && currentAttempt.strictParse.errorType,
          error: currentAttempt.detail,
        })
      } else if (currentAttempt.outcome === STORY_PROVIDER_OUTCOMES.REFUSAL) {
        logger.info('AI story refusal', {
          provider,
          model,
          attempt: currentAttempt.attemptLabel,
          detail: currentAttempt.detail,
        })
      } else if (
        currentAttempt.outcome === STORY_PROVIDER_OUTCOMES.SAFETY_BLOCK
      ) {
        logger.info('AI story blocked', {
          provider,
          model,
          attempt: currentAttempt.attemptLabel,
          detail: currentAttempt.detail,
        })
      }
    }

    async function runStoryRetry({
      fromAttempt,
      retryPromptText,
      promptPhase,
      attemptLabel,
      reason,
      logMessage = 'AI story retry path',
      profileOverride = profile,
      requestHash = `story-option-${startedAt}`,
      expectedStoryCount = requestedStoryCount,
    }) {
      storyMetrics.retries_per_story += 1
      logger.info(logMessage, {
        provider,
        model,
        from: fromAttempt ? fromAttempt.attemptLabel : 'initial',
        to: attemptLabel,
        reason,
      })
      const retryAttempt = await invokeStructuredStoryAttempt({
        promptText: retryPromptText,
        promptPhase,
        attemptLabel,
        profileOverride,
        requestHash,
        expectedStoryCount,
      })
      recordStoryAttemptOutcome(retryAttempt)
      return retryAttempt
    }

    async function runMissingStoryRepairAttempt({
      sourceAttempt,
      basePromptText,
      existingStories,
      missingCount,
      attemptIndex,
    }) {
      const repairAttemptLabel =
        attemptIndex === 1
          ? 'provider_story_options_repair_missing'
          : `provider_story_options_repair_missing_${attemptIndex}`
      const repairPromptPhase =
        attemptIndex === 1
          ? 'story_options_repair_missing'
          : `story_options_repair_missing_${attemptIndex}`

      let repairAttempt = await runStoryRetry({
        fromAttempt: sourceAttempt,
        retryPromptText: buildStoryOptionRepairPrompt({
          basePrompt: basePromptText,
          keywordA,
          keywordB,
          existingStories,
          missingCount,
          requestedStoryCount,
        }),
        promptPhase: repairPromptPhase,
        attemptLabel: repairAttemptLabel,
        reason: `usable_story_count_${existingStories.length}`,
        logMessage: 'AI story repair path',
        expectedStoryCount: missingCount,
      })

      if (repairAttempt.outcome === STORY_PROVIDER_OUTCOMES.SCHEMA_INVALID) {
        repairAttempt = await runStoryRetry({
          fromAttempt: repairAttempt,
          retryPromptText: buildStorySchemaRetryPrompt(
            repairAttempt.promptText,
            repairAttempt.strictParse,
            missingCount
          ),
          promptPhase: `${repairPromptPhase}_schema_retry`,
          attemptLabel: `${repairAttemptLabel}_schema_retry`,
          reason: 'schema_invalid_after_repair_missing',
          expectedStoryCount: missingCount,
        })
      } else if (repairAttempt.outcome === STORY_PROVIDER_OUTCOMES.TRUNCATION) {
        const expandedProfile = {
          ...profile,
          maxOutputTokens: Math.max(
            Number(profile.maxOutputTokens) + 300,
            Math.ceil(Number(profile.maxOutputTokens) * 1.4)
          ),
        }
        repairAttempt = await runStoryRetry({
          fromAttempt: repairAttempt,
          retryPromptText: repairAttempt.promptText || basePromptText,
          promptPhase: `${repairPromptPhase}_truncation_retry`,
          attemptLabel: `${repairAttemptLabel}_truncation_retry`,
          reason: 'truncation_after_repair_missing',
          profileOverride: expandedProfile,
          expectedStoryCount: missingCount,
        })
      }

      return repairAttempt
    }

    async function runSingleStoryDraftRescueAttempt({
      attemptLabel = 'provider_story_options_freeform_rescue',
      promptPhase = 'story_options_freeform_rescue',
      profileOverride = buildExpandedStoryProfile(profile, {
        minOutputTokens: 1800,
        growthFactor: 1.6,
        extraTokens: 500,
        extraTimeoutMs: 6000,
      }),
      requestHash = `story-option-rescue-${startedAt}`,
      lastChance = false,
    } = {}) {
      if (requestedStoryCount !== 1) {
        return {
          quality: {accepted: [], rejected: []},
          parsedStories: [],
        }
      }

      storyMetrics.retries_per_story += 1
      logger.info('AI story provider draft rescue path', {
        provider,
        model,
        reason: lastChance
          ? 'single_story_last_chance_rescue'
          : 'single_story_freeform_rescue',
        attempt: attemptLabel,
        maxOutputTokens: profileOverride.maxOutputTokens,
      })

      try {
        const providerResponse = await invokeProvider({
          provider,
          model,
          flip: {
            hash: requestHash,
            leftImage: '',
            rightImage: '',
            images: [],
          },
          profile: profileOverride,
          apiKey,
          providerConfig,
          promptText: lastChance
            ? buildSingleStoryLastChanceRescuePrompt({
                keywordA,
                keywordB,
                senseSelection,
                customStory: hasCustomStory ? customStory : null,
              })
            : buildSingleStoryDraftRescuePrompt({
                keywordA,
                keywordB,
                senseSelection,
              }),
          promptOptions: {
            promptPhase,
          },
        })

        const normalizedResponse = normalizeProviderResponse(providerResponse)
        combinedUsage = addTokenUsage(
          combinedUsage,
          normalizedResponse.tokenUsage
        )
        attemptHistory.push({
          attempt: attemptLabel,
          promptPhase,
          outcome: normalizedResponse.rawText
            ? 'freeform_story_draft'
            : 'empty',
          detail: sanitizeStoryLogText(normalizedResponse.rawText, 180),
        })

        const parsedStories = parseStoryOptions(normalizedResponse.rawText, {
          keywordA,
          keywordB,
          includeNoise,
          customStory: hasCustomStory ? customStory : null,
          humanStorySeed,
          senseSelection,
          allowLocalFallback: false,
        }).slice(0, 1)
        const quality = evaluateCandidateStories(
          parsedStories,
          'provider_story_options_freeform_rescue'
        )
        collectProviderDraftRejectedCandidates(quality)
        return {
          quality,
          parsedStories,
        }
      } catch (error) {
        attemptHistory.push({
          attempt: attemptLabel,
          promptPhase,
          outcome: 'transport_error',
          detail: sanitizeStoryLogText(
            (error && error.message) || error || '',
            180
          ),
        })
        return {
          quality: {accepted: [], rejected: []},
          parsedStories: [],
        }
      }
    }

    async function runSingleStoryScaffoldRewriteAttempt({
      scaffoldPanels = [],
      attemptLabel = 'provider_story_options_scaffold_rewrite',
      promptPhase = 'story_options_scaffold_rewrite',
      profileOverride = buildExpandedStoryProfile(profile, {
        minOutputTokens: 2200,
        growthFactor: 1.8,
        extraTokens: 700,
        extraTimeoutMs: 8000,
      }),
      requestHash = `story-option-scaffold-rewrite-${startedAt}`,
    } = {}) {
      if (requestedStoryCount !== 1) {
        return {
          quality: {accepted: [], rejected: []},
          parsedStories: [],
        }
      }

      storyMetrics.retries_per_story += 1
      logger.info('AI story provider draft rescue path', {
        provider,
        model,
        reason: 'single_story_scaffold_rewrite',
        attempt: attemptLabel,
        maxOutputTokens: profileOverride.maxOutputTokens,
      })

      try {
        const providerResponse = await invokeProvider({
          provider,
          model,
          flip: {
            hash: requestHash,
            leftImage: '',
            rightImage: '',
            images: [],
          },
          profile: profileOverride,
          apiKey,
          providerConfig,
          promptText: buildSingleStoryScaffoldRewritePrompt({
            keywordA,
            keywordB,
            senseSelection,
            scaffoldPanels,
          }),
          promptOptions: {
            promptPhase,
          },
        })

        const normalizedResponse = normalizeProviderResponse(providerResponse)
        combinedUsage = addTokenUsage(
          combinedUsage,
          normalizedResponse.tokenUsage
        )
        attemptHistory.push({
          attempt: attemptLabel,
          promptPhase,
          outcome: normalizedResponse.rawText
            ? 'freeform_story_draft'
            : 'empty',
          detail: sanitizeStoryLogText(normalizedResponse.rawText, 180),
        })

        const parsedStories = parseStoryOptions(normalizedResponse.rawText, {
          keywordA,
          keywordB,
          includeNoise,
          customStory: hasCustomStory ? customStory : null,
          humanStorySeed,
          senseSelection,
          allowLocalFallback: false,
        }).slice(0, 1)
        const quality = evaluateCandidateStories(
          parsedStories,
          'provider_story_options_scaffold_rewrite'
        )
        collectProviderDraftRejectedCandidates(quality)
        return {
          quality,
          parsedStories,
        }
      } catch (error) {
        attemptHistory.push({
          attempt: attemptLabel,
          promptPhase,
          outcome: 'transport_error',
          detail: sanitizeStoryLogText(
            (error && error.message) || error || '',
            180
          ),
        })
        return {
          quality: {accepted: [], rejected: []},
          parsedStories: [],
        }
      }
    }

    async function runSingleStorySpecificityRewriteAttempt({
      draftPanels = [],
      attemptLabel = 'provider_story_options_specificity_rewrite',
      promptPhase = 'story_options_specificity_rewrite',
      profileOverride = buildExpandedStoryProfile(profile, {
        minOutputTokens: 2100,
        growthFactor: 1.7,
        extraTokens: 600,
        extraTimeoutMs: 7000,
      }),
      requestHash = `story-option-specificity-rewrite-${startedAt}`,
    } = {}) {
      if (requestedStoryCount !== 1) {
        return {
          quality: {accepted: [], rejected: []},
          parsedStories: [],
        }
      }

      storyMetrics.retries_per_story += 1
      logger.info('AI story provider draft rescue path', {
        provider,
        model,
        reason: 'single_story_specificity_rewrite',
        attempt: attemptLabel,
        maxOutputTokens: profileOverride.maxOutputTokens,
      })

      try {
        const providerResponse = await invokeProvider({
          provider,
          model,
          flip: {
            hash: requestHash,
            leftImage: '',
            rightImage: '',
            images: [],
          },
          profile: profileOverride,
          apiKey,
          providerConfig,
          promptText: buildSingleStorySpecificityRewritePrompt({
            keywordA,
            keywordB,
            senseSelection,
            draftPanels,
          }),
          promptOptions: {
            promptPhase,
          },
        })

        const normalizedResponse = normalizeProviderResponse(providerResponse)
        combinedUsage = addTokenUsage(
          combinedUsage,
          normalizedResponse.tokenUsage
        )
        attemptHistory.push({
          attempt: attemptLabel,
          promptPhase,
          outcome: normalizedResponse.rawText
            ? 'freeform_story_draft'
            : 'empty',
          detail: sanitizeStoryLogText(normalizedResponse.rawText, 180),
        })

        const parsedStories = parseStoryOptions(normalizedResponse.rawText, {
          keywordA,
          keywordB,
          includeNoise,
          customStory: hasCustomStory ? customStory : null,
          humanStorySeed,
          senseSelection,
          allowLocalFallback: false,
        }).slice(0, 1)
        const quality = evaluateCandidateStories(
          parsedStories,
          'provider_story_options_specificity_rewrite'
        )
        collectProviderDraftRejectedCandidates(quality)
        return {
          quality,
          parsedStories,
        }
      } catch (error) {
        attemptHistory.push({
          attempt: attemptLabel,
          promptPhase,
          outcome: 'transport_error',
          detail: sanitizeStoryLogText(
            (error && error.message) || error || '',
            180
          ),
        })
        return {
          quality: {accepted: [], rejected: []},
          parsedStories: [],
        }
      }
    }

    function evaluateAcceptedStoriesFromAttempt(attempt, sourceLabel) {
      const currentAttempt =
        attempt && typeof attempt === 'object' ? attempt : {}
      const attemptSource = String(
        sourceLabel || currentAttempt.attemptLabel || 'provider_story_options'
      )
      const parsedStories =
        currentAttempt.outcome === STORY_PROVIDER_OUTCOMES.SUCCESS &&
        currentAttempt.strictParse &&
        Array.isArray(currentAttempt.strictParse.stories)
          ? currentAttempt.strictParse.stories
          : []
      let qualitySource = attemptSource
      let quality = evaluateCandidateStories(parsedStories, qualitySource)

      if (
        quality.accepted.length < requestedStoryCount &&
        currentAttempt.normalizedResponse &&
        currentAttempt.normalizedResponse.rawText
      ) {
        const salvagedStories = parseStoryOptions(
          currentAttempt.normalizedResponse.rawText,
          {
            keywordA,
            keywordB,
            includeNoise,
            customStory: hasCustomStory ? customStory : null,
            humanStorySeed,
            senseSelection,
            allowLocalFallback: false,
          }
        )
        const salvageQuality = evaluateCandidateStories(
          salvagedStories,
          `${qualitySource}_lenient_salvage`
        )
        if (salvageQuality.accepted.length > quality.accepted.length) {
          quality = salvageQuality
          qualitySource = `${qualitySource}_lenient_salvage`
          logger.info('AI story lenient salvage path', {
            provider,
            model,
            from: currentAttempt.attemptLabel,
            acceptedStories: salvageQuality.accepted.length,
            rejectedStories: salvageQuality.rejected.length,
          })
        }
      }

      return {
        quality,
        qualitySource,
      }
    }

    let selectedAttempt = null

    if (specificityOptimizeRequested) {
      const specificityRewrite = await runSingleStorySpecificityRewriteAttempt({
        draftPanels: customStory,
        attemptLabel: 'provider_story_options_specificity_optimize',
        promptPhase: 'story_options_specificity_optimize',
        requestHash: `story-option-specificity-optimize-${startedAt}`,
      })

      if (specificityRewrite.quality.accepted.length > 0) {
        const directUsage = normalizeTokenUsage(combinedUsage)
        const directEstimatedCostUsd = isOpenAiCompatibleProvider(provider)
          ? estimateTextCostUsd(directUsage, model)
          : null

        return finalizeStoryResult({
          stories: specificityRewrite.quality.accepted
            .slice(0, requestedStoryCount)
            .map((story, index) =>
              normalizeStoryOption(
                {
                  ...story,
                  id: `option-${index + 1}`,
                  title:
                    String(story && story.title ? story.title : '').trim() ||
                    `Option ${index + 1}`,
                  senseSelection,
                  qualityReport:
                    story &&
                    story.qualityReport &&
                    typeof story.qualityReport === 'object'
                      ? story.qualityReport
                      : null,
                },
                index
              )
            ),
          promptText: buildSingleStorySpecificityRewritePrompt({
            keywordA,
            keywordB,
            senseSelection,
            draftPanels: customStory,
          }),
          generationPath: 'provider_story_options_specificity_optimize',
          usage: directUsage,
          estimatedCostUsd: directEstimatedCostUsd,
        })
      }
    }

    selectedAttempt = await invokeStructuredStoryAttempt({
      promptText,
      promptPhase: 'story_options',
      attemptLabel: 'provider_story_options',
    })

    recordStoryAttemptOutcome(selectedAttempt)

    if (selectedAttempt.outcome === STORY_PROVIDER_OUTCOMES.SCHEMA_INVALID) {
      selectedAttempt = await runStoryRetry({
        fromAttempt: selectedAttempt,
        retryPromptText: buildStorySchemaRetryPrompt(
          promptText,
          selectedAttempt.strictParse,
          requestedStoryCount
        ),
        promptPhase: 'story_options_schema_retry',
        attemptLabel: 'provider_story_options_schema_retry',
        reason: 'schema_invalid',
        expectedStoryCount: requestedStoryCount,
      })
    } else if (
      selectedAttempt.outcome === STORY_PROVIDER_OUTCOMES.REFUSAL ||
      selectedAttempt.outcome === STORY_PROVIDER_OUTCOMES.SAFETY_BLOCK
    ) {
      storyMetrics.safe_replan_used = true
      selectedAttempt = await runStoryRetry({
        fromAttempt: selectedAttempt,
        retryPromptText: buildStorySafeReinterpretationPrompt({
          basePrompt: promptText,
          keywordA,
          keywordB,
          outcome: selectedAttempt.outcome,
          outcomeDetail: selectedAttempt.detail,
        }),
        promptPhase: 'story_options_safe_replan',
        attemptLabel: 'provider_story_options_safe_replan',
        reason: selectedAttempt.outcome,
        logMessage: 'AI story safe reinterpretation path',
        expectedStoryCount: requestedStoryCount,
      })

      if (selectedAttempt.outcome === STORY_PROVIDER_OUTCOMES.SCHEMA_INVALID) {
        selectedAttempt = await runStoryRetry({
          fromAttempt: selectedAttempt,
          retryPromptText: buildStorySchemaRetryPrompt(
            selectedAttempt.promptText,
            selectedAttempt.strictParse,
            requestedStoryCount
          ),
          promptPhase: 'story_options_safe_replan_schema_retry',
          attemptLabel: 'provider_story_options_safe_replan_schema_retry',
          reason: 'schema_invalid_after_safe_replan',
          expectedStoryCount: requestedStoryCount,
        })
      }
    } else if (selectedAttempt.outcome === STORY_PROVIDER_OUTCOMES.TRUNCATION) {
      const expandedProfile = {
        ...profile,
        maxOutputTokens: Math.max(
          Number(profile.maxOutputTokens) + 400,
          Math.ceil(Number(profile.maxOutputTokens) * 1.5)
        ),
      }
      selectedAttempt = await runStoryRetry({
        fromAttempt: selectedAttempt,
        retryPromptText: promptText,
        promptPhase: 'story_options_truncation_retry',
        attemptLabel: 'provider_story_options_truncation_retry',
        reason: 'truncation',
        profileOverride: expandedProfile,
        expectedStoryCount: requestedStoryCount,
      })
    }

    let {quality: initialQuality, qualitySource: initialQualitySource} =
      evaluateAcceptedStoriesFromAttempt(
        selectedAttempt,
        selectedAttempt.attemptLabel || 'provider_story_options'
      )
    collectProviderDraftRejectedCandidates(initialQuality)
    if (
      initialQuality.accepted.length < requestedStoryCount &&
      providerDraftRejectedCandidates.length > 0
    ) {
      logger.info('AI story provider draft pool after initial quality gate', {
        provider,
        model,
        acceptedCount: initialQuality.accepted.length,
        rejectedRescueCandidates: providerDraftRejectedCandidates.length,
        rejectedDrafts: summarizeStoryDraftCollectionForLog(
          providerDraftRejectedCandidates
        ),
      })
    }

    const shouldSkipRepairForProviderDraftRescue =
      requestedStoryCount === 1 &&
      initialQuality.accepted.length < 1 &&
      Boolean(pickBestProviderDraftCandidate(providerDraftRejectedCandidates))

    if (
      initialQuality.accepted.length < requestedStoryCount &&
      !shouldSkipRepairForProviderDraftRescue &&
      selectedAttempt.outcome !== STORY_PROVIDER_OUTCOMES.REFUSAL &&
      selectedAttempt.outcome !== STORY_PROVIDER_OUTCOMES.SAFETY_BLOCK &&
      selectedAttempt.outcome !== STORY_PROVIDER_OUTCOMES.TRANSPORT_ERROR
    ) {
      let repairAttemptCount = 0

      while (
        initialQuality.accepted.length < requestedStoryCount &&
        repairAttemptCount < 2
      ) {
        repairAttemptCount += 1
        const previousAcceptedCount = initialQuality.accepted.length
        const replacementAttempt = await runMissingStoryRepairAttempt({
          sourceAttempt: selectedAttempt,
          basePromptText: promptText,
          existingStories: initialQuality.accepted,
          missingCount: requestedStoryCount - initialQuality.accepted.length,
          attemptIndex: repairAttemptCount,
        })
        const replacementEvaluation = evaluateAcceptedStoriesFromAttempt(
          replacementAttempt,
          replacementAttempt.attemptLabel ||
            'provider_story_options_repair_missing'
        )
        collectProviderDraftRejectedCandidates(replacementEvaluation.quality)

        if (replacementEvaluation.quality.accepted.length > 0) {
          const mergedCandidates = dedupeStoriesForSelection(
            initialQuality.accepted.concat(
              replacementEvaluation.quality.accepted
            )
          )
          initialQuality = evaluateCandidateStories(
            mergedCandidates,
            'provider_story_options_repaired_merge'
          )
          initialQualitySource = 'provider_story_options_repaired_merge'
        }

        if (
          initialQuality.accepted.length >= requestedStoryCount ||
          replacementAttempt.outcome === STORY_PROVIDER_OUTCOMES.REFUSAL ||
          replacementAttempt.outcome === STORY_PROVIDER_OUTCOMES.SAFETY_BLOCK ||
          replacementAttempt.outcome === STORY_PROVIDER_OUTCOMES.TRANSPORT_ERROR
        ) {
          break
        }

        if (
          initialQuality.accepted.length <= previousAcceptedCount &&
          replacementEvaluation.quality.accepted.length < 1
        ) {
          break
        }
      }
    }

    if (
      requestedStoryCount === 1 &&
      initialQuality.accepted.length < 1 &&
      selectedAttempt.outcome !== STORY_PROVIDER_OUTCOMES.REFUSAL &&
      selectedAttempt.outcome !== STORY_PROVIDER_OUTCOMES.SAFETY_BLOCK &&
      selectedAttempt.outcome !== STORY_PROVIDER_OUTCOMES.TRANSPORT_ERROR
    ) {
      const freeformRescue = await runSingleStoryDraftRescueAttempt()
      if (freeformRescue.quality.accepted.length > 0) {
        initialQuality = freeformRescue.quality
        initialQualitySource = 'provider_story_options_freeform_rescue'
      } else {
        collectProviderDraftRejectedCandidates(freeformRescue.quality)
        const lastChanceRescue = await runSingleStoryDraftRescueAttempt({
          attemptLabel: 'provider_story_options_last_chance_rescue',
          promptPhase: 'story_options_last_chance_rescue',
          profileOverride: buildExpandedStoryProfile(profile, {
            minOutputTokens: 2400,
            growthFactor: 2,
            extraTokens: 1000,
            extraTimeoutMs: 10000,
          }),
          requestHash: `story-option-last-chance-${startedAt}`,
          lastChance: true,
        })
        if (lastChanceRescue.quality.accepted.length > 0) {
          initialQuality = lastChanceRescue.quality
          initialQualitySource = 'provider_story_options_last_chance_rescue'
        } else {
          collectProviderDraftRejectedCandidates(lastChanceRescue.quality)
          const rewriteSeedStory = pickBestProviderDraftCandidate(
            providerDraftRejectedCandidates,
            {
              strict: false,
            }
          )
          if (rewriteSeedStory) {
            const specificityRewrite =
              await runSingleStorySpecificityRewriteAttempt({
                draftPanels: normalizeStoryPanels(rewriteSeedStory.panels),
              })
            if (specificityRewrite.quality.accepted.length > 0) {
              initialQuality = specificityRewrite.quality
              initialQualitySource =
                'provider_story_options_specificity_rewrite'
            } else {
              collectProviderDraftRejectedCandidates(specificityRewrite.quality)
            }
          }
          if (initialQuality.accepted.length < 1) {
            const scaffoldPanels = rewriteSeedStory
              ? normalizeStoryPanels(rewriteSeedStory.panels)
              : buildKeywordFallbackPanels(
                  keywordA,
                  keywordB,
                  0,
                  humanStorySeed,
                  senseSelection
                )
            const scaffoldRewrite = await runSingleStoryScaffoldRewriteAttempt({
              scaffoldPanels,
            })
            if (scaffoldRewrite.quality.accepted.length > 0) {
              initialQuality = scaffoldRewrite.quality
              initialQualitySource = 'provider_story_options_scaffold_rewrite'
            } else {
              collectProviderDraftRejectedCandidates(scaffoldRewrite.quality)
            }
          }
        }
      }
    }

    const providerReachable = hasReachableProviderStoryAttempt(attemptHistory)

    if (selectedAttempt.outcome === STORY_PROVIDER_OUTCOMES.SCHEMA_INVALID) {
      storyFallbackReasonText =
        'provider output did not match the required story format'
    } else if (initialQuality.accepted.length < requestedStoryCount) {
      storyFallbackReasonText = `provider did not produce enough strong story option${
        requestedStoryCount === 1 ? '' : 's'
      } after repair attempts`
    } else {
      storyFallbackReasonText = 'provider output could not be parsed reliably'
    }

    let stories = initialQuality.accepted.slice(0, requestedStoryCount)
    const finalPromptText = selectedAttempt.promptText || promptText
    let generationPath =
      selectedAttempt.outcome === STORY_PROVIDER_OUTCOMES.SUCCESS
        ? selectedAttempt.attemptLabel
        : null
    if (stories.length < 1 && requestedStoryCount === 1) {
      const rescuedProviderDraft = pickBestProviderDraftCandidate(
        providerDraftRejectedCandidates,
        {strict: true}
      )
      const broadProviderDraft =
        rescuedProviderDraft ||
        (providerReachable
          ? pickBestProviderDraftCandidate(providerDraftRejectedCandidates, {
              strict: false,
            })
          : null)
      if (broadProviderDraft) {
        logger.info('AI story provider draft rescue path', {
          provider,
          model,
          source: broadProviderDraft.candidateSource,
          rescueStrength: rescuedProviderDraft ? 'strict' : 'broad',
          failures:
            broadProviderDraft.qualityReport &&
            broadProviderDraft.qualityReport.failures,
          score:
            broadProviderDraft.qualityReport &&
            broadProviderDraft.qualityReport.score,
        })
        stories = [
          buildProviderDraftRescueStory({
            story: broadProviderDraft,
            keywordA,
            keywordB,
            senseSelection,
            index: 0,
            rationale:
              'Provider draft kept as an editable storyboard draft after stronger repair attempts still judged it too weak for auto-approval.',
          }),
        ]
        generationPath = `${selectedAttempt.attemptLabel}_provider_draft_rescue`
      } else if (providerReachable) {
        logger.info('AI story provider draft rescue unavailable', {
          provider,
          model,
          rejectedRescueCandidates: providerDraftRejectedCandidates.length,
          attempts: attemptHistory,
        })
      }
    }
    if (!generationPath && initialQualitySource.endsWith('_lenient_salvage')) {
      generationPath = initialQualitySource
    }

    if (
      !fastStoryMode &&
      selectedAttempt.outcome === STORY_PROVIDER_OUTCOMES.SUCCESS &&
      shouldRunStoryAudit(selectedAttempt.normalizedResponse.rawText, stories)
    ) {
      const auditedStories = []

      for (let index = 0; index < stories.length; index += 1) {
        const seedConcept = storyOptionToMainPromptConcept(
          stories[index],
          keywordA,
          keywordB
        )
        const auditPromptText = buildStoryAuditPrompt(
          finalPromptText,
          seedConcept
        )
        try {
          // eslint-disable-next-line no-await-in-loop
          const auditAttempt = await invokeStructuredStoryAttempt({
            promptText: auditPromptText,
            promptPhase: 'story_audit',
            attemptLabel: `story_audit_option_${index + 1}`,
            requestHash: `story-audit-${startedAt}-${index + 1}`,
            expectedStoryCount: 1,
          })
          const auditedCandidates =
            auditAttempt.outcome === STORY_PROVIDER_OUTCOMES.SUCCESS &&
            auditAttempt.strictParse &&
            Array.isArray(auditAttempt.strictParse.stories)
              ? auditAttempt.strictParse.stories
              : []
          const auditedQuality = evaluateCandidateStories(
            auditedCandidates,
            auditAttempt.attemptLabel || 'story_audit'
          )
          const auditedStory = auditedQuality.accepted.find((story) =>
            hasMeaningfulStoryPanels(story.panels)
          )

          if (auditedStory) {
            auditedStories.push(auditedStory)
          } else {
            storyMetrics.audit_fail += 1
            logger.info('AI story audit_fail', {
              provider,
              model,
              option: index + 1,
              outcome: auditAttempt.outcome,
              errorType:
                auditAttempt.strictParse && auditAttempt.strictParse.errorType,
              error: auditAttempt.detail,
            })
            auditedStories.push(stories[index])
          }
        } catch (auditError) {
          storyMetrics.audit_fail += 1
          logger.info('Story audit pass failed, keeping first-pass concept', {
            provider,
            model,
            option: index + 1,
            error: String(
              (auditError && auditError.message) || auditError || ''
            )
              .trim()
              .slice(0, 280),
          })
          auditedStories.push(stories[index])
        }
      }

      if (auditedStories.length > 0) {
        stories = auditedStories.slice(0, requestedStoryCount)
      }
    }

    const providerDraftPool = providerReachable
      ? sortStoriesByQuality(providerDraftRejectedCandidates)
          .filter(isProviderMeaningfulDraftCandidate)
          .map((story, index) =>
            buildProviderDraftRescueStory({
              story,
              keywordA,
              keywordB,
              senseSelection,
              index,
              rationale:
                'Provider draft kept as an editable storyboard draft because stronger versions did not pass automatic quality checks.',
            })
          )
      : []
    if (providerDraftPool.length > 0) {
      logger.info('AI story provider draft selection pool', {
        provider,
        model,
        poolSize: providerDraftPool.length,
        drafts: summarizeStoryDraftCollectionForLog(providerDraftPool),
      })
    }
    const allowLocalFallback = disableLocalFallback
      ? !providerReachable
      : requestedStoryCount > 1 || !providerReachable
    const fallbackQuality = allowLocalFallback
      ? getFallbackCandidateQuality()
      : {accepted: [], rejected: []}
    const shouldMixFallbackIntoSelection =
      requestedStoryCount > 1 || stories.length < requestedStoryCount
    const selectionPool = dedupeStoriesForSelection(
      shouldMixFallbackIntoSelection
        ? stories.concat(providerDraftPool, fallbackQuality.accepted)
        : stories
    )
    const diversitySelection = rerankStoriesForDiversity(selectionPool, stories)

    if (diversitySelection.selection.selectedStories.length > 0) {
      stories = diversitySelection.selection.selectedStories.slice(
        0,
        requestedStoryCount
      )
    }

    if (stories.length < requestedStoryCount) {
      const seenPanels = new Set(
        stories.map((item) =>
          normalizeStoryPanels(item.panels).join('|').toLowerCase()
        )
      )

      for (const fallbackStory of selectionPool) {
        if (stories.length >= requestedStoryCount) break
        const signature = normalizeStoryPanels(fallbackStory.panels)
          .join('|')
          .toLowerCase()
        const isDuplicate = seenPanels.has(signature)
        const isMeaningful = hasMeaningfulStoryPanels(fallbackStory.panels)
        if (!isDuplicate && isMeaningful) {
          seenPanels.add(signature)
          stories.push(fallbackStory)
        }
      }
    }

    stories = stories.slice(0, requestedStoryCount).map((story, index) =>
      normalizeStoryOption(
        {
          ...story,
          id: `option-${index + 1}`,
          title:
            requestedStoryCount === 1 &&
            /^option\s+\d+$/i.test(
              String(story && story.title ? story.title : '').trim()
            )
              ? 'Option 1'
              : String(story && story.title ? story.title : '').trim() || null,
          senseSelection,
          qualityReport:
            story &&
            story.qualityReport &&
            typeof story.qualityReport === 'object'
              ? story.qualityReport
              : null,
        },
        index
      )
    )

    if (stories.length < 1) {
      if (!allowLocalFallback) {
        logger.info('AI story emergency editable draft path', {
          provider,
          model,
          lastOutcome: selectedAttempt.outcome,
          attempts: attemptHistory,
          rejectedRescueCandidates: providerDraftRejectedCandidates.length,
          rejectedDrafts: summarizeStoryDraftCollectionForLog(
            providerDraftRejectedCandidates
          ),
        })
        stories = buildEmergencyStoryboardStarterStories({
          keywordA,
          keywordB,
          includeNoise,
          customStory: hasCustomStory ? customStory : null,
          humanStorySeed,
          senseSelection,
          emergencyReasonText:
            'the provider was reachable but rescue attempts still did not yield a usable storyboard draft',
          requestedStoryCount,
        })
      } else {
        const emergencyFallbackQuality = getFallbackCandidateQuality()
        stories = emergencyFallbackQuality.accepted.slice(
          0,
          requestedStoryCount
        )
        if (stories.length < 1) {
          stories = sortStoriesByQuality(
            emergencyFallbackQuality.rejected
          ).slice(0, requestedStoryCount)
        }
      }
    }

    const fallbackUsed = stories.some((story) =>
      /local fallback(?: storyboard (?:starter|draft))? (?:generated|shown) because/i.test(
        String(story && story.rationale ? story.rationale : '')
      )
    )
    storyMetrics.fallback_used = fallbackUsed
    if (fallbackUsed) {
      logger.info('AI story final fallback path', {
        provider,
        model,
        lastOutcome: selectedAttempt.outcome,
        attempts: attemptHistory,
        rejectedRescueCandidates: providerDraftRejectedCandidates.length,
        rejectedDrafts: summarizeStoryDraftCollectionForLog(
          providerDraftRejectedCandidates
        ),
      })
      logger.info('AI story fallback sense lock', {
        rawKeywords: senseSelection.raw_keywords,
        chosenSenses: senseSelection.chosen_senses,
        fallbackUsedLockedSenses: !senseSelection.used_raw_keyword_fallback,
        selectionSource: senseSelection.selection_source,
      })
    }

    const usage = normalizeTokenUsage(combinedUsage)
    const estimatedCostUsd = isOpenAiCompatibleProvider(provider)
      ? estimateTextCostUsd(usage, model)
      : null

    return finalizeStoryResult({
      stories,
      promptText: finalPromptText,
      generationPath:
        generationPath || (fallbackUsed ? 'local_fallback' : generationPath),
      usage,
      estimatedCostUsd,
    })
  }

  async function generateFlipPanels(payload = {}) {
    const provider = normalizeProvider(payload.provider)
    const fastBuild = payload.fastBuild !== false
    const model = String(payload.model || DEFAULT_MODELS[provider]).trim()
    const imageModel = String(payload.imageModel || 'gpt-image-1-mini').trim()
    const requestedImageSize = String(payload.imageSize || '1024x1024').trim()
    const imageSize = normalizeProviderImageSize(requestedImageSize)
    const imageQuality = String(payload.imageQuality || '').trim()
    const imageStyle = String(payload.imageStyle || '').trim()
    const providerConfig = payload.providerConfig || null
    const apiKey = getApiKey(provider)
    const [keywordA, keywordB] = normalizeKeywords(payload)
    const senseSelection = getLockedSenseSelection(
      payload.senseSelection,
      keywordA,
      keywordB
    )
    const storyPanels = normalizeStoryPanels(payload.storyPanels)
    const selectedStoryId = String(payload.selectedStoryId || '').trim()
    const normalizedStoryOptions = Array.isArray(payload.storyOptions)
      ? payload.storyOptions.slice(0, 4).map((item, index) =>
          normalizeStoryOption(
            {
              ...(item && typeof item === 'object' ? item : {}),
              senseSelection:
                item &&
                typeof item === 'object' &&
                item.senseSelection &&
                typeof item.senseSelection === 'object'
                  ? item.senseSelection
                  : senseSelection,
            },
            index
          )
        )
      : []
    const matchedSelectedStory = selectedStoryId
      ? normalizedStoryOptions.find(
          (item) => String(item && item.id ? item.id : '') === selectedStoryId
        ) || null
      : null
    const activeStory = normalizeStoryOption(
      {
        ...(matchedSelectedStory || {}),
        id:
          selectedStoryId ||
          String(
            (matchedSelectedStory && matchedSelectedStory.id) || 'option-1'
          ).trim(),
        title: String(
          (matchedSelectedStory && matchedSelectedStory.title) || 'Option 1'
        ).trim(),
        panels: storyPanels,
        senseSelection,
      },
      0
    )
    const alternativeStoryOptions = normalizedStoryOptions.filter(
      (item) =>
        String(item && item.id ? item.id : '') !== String(activeStory.id)
    )
    const includeNoise = Boolean(payload.includeNoise)
    const noisePanelIndex = chooseNoisePanelIndex(
      payload.noiseSeed || `${keywordA}-${keywordB}-${Date.now()}`,
      payload.noisePanelIndex
    )
    const visualStyle =
      String(payload.visualStyle || '').trim() ||
      'Single-panel cartoon illustration, flat bright colors, clean line art, consistent environment and character style with no text overlays.'

    if (!supportsImageGenerationProvider(provider)) {
      throw new Error(
        `Flip image generation is not available for provider: ${provider}. Supported providers: openai-compatible and gemini.`
      )
    }

    const existingPanels = normalizeImageList(payload.existingPanels).slice(
      0,
      4
    )
    while (existingPanels.length < 4) {
      existingPanels.push('')
    }

    const requestedRegenerateIndices = Array.isArray(payload.regenerateIndices)
      ? payload.regenerateIndices
          .map((value) => Number.parseInt(value, 10))
          .filter((value) => Number.isFinite(value) && value >= 0 && value < 4)
      : []

    const regenerateIndices = requestedRegenerateIndices.length
      ? Array.from(new Set(requestedRegenerateIndices))
      : [0, 1, 2, 3]
    const requestedPanelRenderMode = String(
      payload.panelRenderMode || ''
    ).trim()
    const panelRenderMode = (
      requestedPanelRenderMode || (fastBuild ? 'sheet_fast' : 'panels')
    ).toLowerCase()

    const imageRequestTimeoutMs = Math.max(
      Number(payload.requestTimeoutMs) || 0,
      fastBuild ? 45 * 1000 : MIN_IMAGE_REQUEST_TIMEOUT_MS
    )
    const textAuditEnabled =
      typeof payload.textAuditEnabled === 'boolean'
        ? payload.textAuditEnabled
        : !fastBuild
    const validatorEnabled =
      typeof payload.validatorEnabled === 'boolean'
        ? payload.validatorEnabled
        : textAuditEnabled
    const renderFeedbackEnabled =
      typeof payload.renderFeedbackEnabled === 'boolean'
        ? payload.renderFeedbackEnabled
        : true
    const textAuditModel = String(payload.textAuditModel || 'gpt-5.4').trim()
    const validatorModel = String(
      payload.validatorModel || textAuditModel
    ).trim()
    const textAuditMaxRetries = Math.max(
      0,
      Math.min(
        3,
        Number.parseInt(payload.textAuditMaxRetries, 10) || (fastBuild ? 0 : 2)
      )
    )
    const validatorMaxRetries = Math.max(
      0,
      Math.min(
        3,
        Number.parseInt(payload.validatorMaxRetries, 10) || textAuditMaxRetries
      )
    )
    const renderFeedbackIteration = Math.max(
      0,
      Number.parseInt(payload.renderFeedbackIteration, 10) || 0
    )
    const renderFeedbackSwitchCount = Math.max(
      0,
      Number.parseInt(payload.renderFeedbackSwitchCount, 10) || 0
    )
    const renderFeedbackMaxRepairs = Math.max(
      0,
      Math.min(2, Number.parseInt(payload.renderFeedbackMaxRepairs, 10) || 1)
    )
    const renderFeedbackMaxSwitches = Math.max(
      0,
      Math.min(2, Number.parseInt(payload.renderFeedbackMaxSwitches, 10) || 1)
    )
    const renderFeedbackHistory = Array.isArray(payload.renderFeedbackHistory)
      ? payload.renderFeedbackHistory.slice(0, 8)
      : []
    const repairGuidanceByPanel =
      payload.repairGuidanceByPanel &&
      typeof payload.repairGuidanceByPanel === 'object' &&
      !Array.isArray(payload.repairGuidanceByPanel)
        ? payload.repairGuidanceByPanel
        : {}
    const textAuditRequestTimeoutMs = Math.max(
      Number(payload.textAuditRequestTimeoutMs) || 0,
      12 * 1000
    )

    const profile = sanitizeBenchmarkProfile({
      benchmarkProfile: 'custom',
      requestTimeoutMs: imageRequestTimeoutMs,
      maxOutputTokens: 64,
      temperature: 0,
      maxRetries: payload.maxRetries ?? 1,
      maxConcurrency: 1,
      deadlineMs: 180000,
    })
    // Keep image generation timeout independent from strict short-session text limits.
    profile.requestTimeoutMs = imageRequestTimeoutMs
    const textAuditProfile = sanitizeBenchmarkProfile({
      benchmarkProfile: 'custom',
      requestTimeoutMs: textAuditRequestTimeoutMs,
      maxOutputTokens: 80,
      temperature: 0,
      maxRetries: 0,
      maxConcurrency: 1,
      deadlineMs: Math.max(textAuditRequestTimeoutMs + 2000, 15000),
    })
    textAuditProfile.requestTimeoutMs = textAuditRequestTimeoutMs
    const startedAt = now()
    const renderedPanelValidatorHooks = createRenderedPanelValidatorHooks(
      dependencies.storyValidatorHooks,
      {
        providerAudit: validatorEnabled
          ? async ({context, promptText}) => {
              const panelImageDataUrl = String(
                context.panelImageDataUrl || ''
              ).trim()
              if (!panelImageDataUrl) {
                throw new Error('rendered_panel_validator_missing_image')
              }

              return invokeProvider({
                provider,
                model: validatorModel,
                flip: {
                  hash: `rendered-panel-validator-${startedAt}-${context.panelIndex}-${context.attempt}`,
                  leftImage: '',
                  rightImage: '',
                  images: [panelImageDataUrl],
                },
                profile: textAuditProfile,
                apiKey,
                providerConfig,
                promptText,
                promptOptions: {
                  promptPhase: 'rendered_panel_validator',
                },
              })
            }
          : null,
      }
    )

    logger.info('AI flip image generation profile', {
      provider,
      model,
      imageModel,
      imageSize,
      panelRenderModeRequested: requestedPanelRenderMode || null,
      panelRenderMode,
      requestedImageSize,
      requestTimeoutMs: profile.requestTimeoutMs,
      maxRetries: profile.maxRetries,
      textAuditEnabled,
      textAuditModel,
      textAuditMaxRetries,
      textAuditRequestTimeoutMs: textAuditProfile.requestTimeoutMs,
      validatorEnabled,
      validatorModel: validatorEnabled ? validatorModel : '',
      validatorMaxRetries,
      renderFeedbackEnabled,
      selectedStoryId: activeStory.id,
      alternativeStoryCount: alternativeStoryOptions.length,
    })
    if (requestedImageSize && requestedImageSize !== imageSize) {
      logger.info('AI image size normalized for provider request', {
        provider,
        requestedImageSize,
        normalizedImageSize: imageSize,
      })
    }
    const canUseSheetFastMode =
      panelRenderMode === 'sheet_fast' &&
      regenerateIndices.length === 4 &&
      renderFeedbackIteration === 0
    const sheetPanelMetadata = storyPanels
      .slice(0, 4)
      .map((panelStory, index) => ({
        index,
        panelStory: panelStory || '',
        generated: true,
      }))

    if (canUseSheetFastMode) {
      const sheetPrompt = buildStoryboardSheetPrompt({
        storyPanels,
        keywordA,
        keywordB,
        visualStyle,
        includeNoise,
        noisePanelIndex,
        senseSelection,
      })
      const sheetImageSize = resolveSheetImageSize(imageSize)
      const timeoutCandidates = buildImageTimeoutCandidates(
        fastBuild
          ? Math.min(profile.requestTimeoutMs, 75 * 1000)
          : profile.requestTimeoutMs
      )
      const imageProfileCandidates = buildImageProfileCandidates({
        provider,
        imageModel,
        imageSize: sheetImageSize,
      })
      let sheetResponse = null
      let sheetImageModel = imageModel
      let sheetImageSizeUsed = sheetImageSize
      let timeoutFailure = null

      try {
        for (
          let profileIndex = 0;
          profileIndex < imageProfileCandidates.length && !sheetResponse;
          profileIndex += 1
        ) {
          const profileCandidate = imageProfileCandidates[profileIndex]
          for (
            let timeoutIndex = 0;
            timeoutIndex < timeoutCandidates.length && !sheetResponse;
            timeoutIndex += 1
          ) {
            const timeoutMs = timeoutCandidates[timeoutIndex]
            const imageProfile = {
              ...profile,
              requestTimeoutMs: timeoutMs,
            }
            try {
              // eslint-disable-next-line no-await-in-loop
              sheetResponse = await withRetries(profile.maxRetries, () =>
                runImageProvider({
                  provider,
                  imageModel: profileCandidate.imageModel,
                  prompt: sheetPrompt,
                  profile: imageProfile,
                  apiKey,
                  providerConfig: resolveProviderConfig(
                    provider,
                    providerConfig
                  ),
                  size: profileCandidate.imageSize,
                  quality: imageQuality,
                  style: imageStyle,
                })
              )
              if (sheetResponse) {
                sheetImageModel = profileCandidate.imageModel
                sheetImageSizeUsed = profileCandidate.imageSize
                if (profileIndex > 0) {
                  logger.info('AI image generation fallback profile used', {
                    provider,
                    panel: 'sheet',
                    imageModel: profileCandidate.imageModel,
                    imageSize: profileCandidate.imageSize,
                    reason: profileCandidate.reason,
                  })
                }
              }
            } catch (error) {
              if (isTimeoutError(error)) {
                timeoutFailure = error
                logger.info('AI storyboard sheet timeout, escalating timeout', {
                  provider,
                  imageModel: profileCandidate.imageModel,
                  imageSize: profileCandidate.imageSize,
                  timeoutMs,
                  nextTimeoutMs:
                    timeoutCandidates[timeoutIndex + 1] || timeoutMs,
                })
              } else {
                throw error
              }
            }
          }
        }

        if (!sheetResponse && timeoutFailure) {
          throw new Error(
            `Storyboard sheet generation timed out (model ${imageModel}, size ${sheetImageSize}, tried timeouts: ${timeoutCandidates.join(
              'ms, '
            )}ms, fallback profiles: ${imageProfileCandidates
              .map((item) => `${item.imageModel}@${item.imageSize}`)
              .join(', ')}).`
          )
        }

        if (sheetResponse && String(sheetResponse.imageDataUrl || '').trim()) {
          const sheetUsage = addTokenUsage(
            createEmptyTokenUsage(),
            sheetResponse.usage || createEmptyTokenUsage()
          )
          const sheetEstimatedTextCostUsd = estimateTextCostUsd(
            sheetUsage,
            model
          )
          const imageUnitPrice = isOpenAiCompatibleProvider(provider)
            ? resolveOpenAiImageUnitPrice(sheetImageModel, sheetImageSizeUsed)
            : null
          const sheetEstimatedImageCostUsd = Number.isFinite(imageUnitPrice)
            ? imageUnitPrice
            : 0
          const sheetEstimatedUsd =
            (sheetEstimatedTextCostUsd || 0) + sheetEstimatedImageCostUsd

          logger.info('AI storyboard sheet mode used', {
            provider,
            model,
            imageModel: sheetImageModel,
            imageSize: sheetImageSizeUsed,
          })

          return {
            ok: true,
            provider,
            model,
            imageModel,
            imageSize: sheetImageSizeUsed,
            latencyMs: now() - startedAt,
            includeNoise,
            noisePanelIndex: includeNoise ? noisePanelIndex : null,
            generatedPanelCount: 1,
            textAuditEnabled: false,
            textAuditModel: '',
            textAuditMaxRetries: 0,
            validatorEnabled: false,
            validatorModel: '',
            validatorMaxRetries: 0,
            panelRenderModeUsed: 'sheet_fast',
            selectedStory: {
              id: activeStory.id,
              title: activeStory.title,
              panels: storyPanels.slice(0, 4),
              senseSelection,
            },
            textOverlayRetryCount: 0,
            senseSelection,
            textAuditByPanel: Array.from({length: 4}, () =>
              createEmptyPanelTextAuditResult()
            ),
            validatorAuditByPanel: Array.from({length: 4}, () =>
              createEmptyRenderedPanelAuditResult()
            ),
            validatorMetrics: {
              validator_invoked: 0,
              ocr_fail: 0,
              visibility_fail: 0,
              alignment_fail: 0,
              policy_fail: 0,
              validator_retry_count: 0,
              panel_repair_reason: [],
            },
            panels: [
              {
                index: 0,
                imageDataUrl: String(sheetResponse.imageDataUrl || '').trim(),
                imageModelUsed: sheetImageModel,
                imageSizeUsed: sheetImageSizeUsed,
                panelPrompt: sheetPrompt,
                panelStory: storyPanels.join(' | '),
                generated: true,
                isCompositeSheet: true,
              },
            ],
            panelMetadataByIndex: sheetPanelMetadata.map((item, index) => ({
              ...item,
              panelPrompt: sheetPrompt,
              imageModelUsed: sheetImageModel,
              imageSizeUsed: sheetImageSizeUsed,
              generated: true,
              index,
            })),
            imageFallbackUsed:
              String(sheetImageModel || '').trim() !==
                String(imageModel || '').trim() ||
              String(sheetImageSizeUsed || '').trim() !==
                String(sheetImageSize || '').trim(),
            tokenUsage: normalizeTokenUsage(sheetUsage),
            costs: {
              estimatedUsd: sheetEstimatedUsd,
              actualUsd: sheetEstimatedUsd,
              estimatedTextUsd: sheetEstimatedTextCostUsd,
              estimatedImageUsd: Number.isFinite(sheetEstimatedImageCostUsd)
                ? sheetEstimatedImageCostUsd
                : null,
            },
          }
        }
      } catch (error) {
        logger.info('AI storyboard sheet mode fallback', {
          provider,
          model,
          error: String((error && error.message) || error || '')
            .trim()
            .slice(0, 240),
        })
      }
    }

    const nextPanels = existingPanels.slice(0, 4)
    const promptByPanel = Array.from({length: 4}, () => '')
    const panelImageModelUsed = Array.from({length: 4}, () => imageModel)
    const panelImageSizeUsed = Array.from({length: 4}, () => imageSize)
    const textAuditByPanel = Array.from({length: 4}, () =>
      createEmptyPanelTextAuditResult()
    )
    const validatorAuditByPanel = Array.from({length: 4}, () =>
      createEmptyRenderedPanelAuditResult()
    )
    const validatorMetrics = {
      validator_invoked: 0,
      ocr_fail: 0,
      visibility_fail: 0,
      alignment_fail: 0,
      policy_fail: 0,
      validator_retry_count: 0,
      panel_repair_reason: [],
    }
    let usage = createEmptyTokenUsage()
    let generatedCount = 0
    let estimatedImageCostUsd = 0
    let textOverlayRetryCount = 0
    let renderFeedbackMetrics = createEmptyRenderedStoryMetrics()

    for (let panelIndex = 0; panelIndex < 4; panelIndex += 1) {
      const shouldGenerate = regenerateIndices.includes(panelIndex)
      const panelPromptBaseRaw = buildPanelPrompt({
        panelText: storyPanels[panelIndex],
        storyPanels,
        keywordA,
        keywordB,
        visualStyle,
        panelIndex,
        includeNoise,
        noisePanelIndex,
        senseSelection,
      })
      const storyRepairGuidance = String(
        repairGuidanceByPanel[panelIndex] || ''
      ).trim()
      const panelPromptBase = storyRepairGuidance
        ? `${panelPromptBaseRaw}\n${storyRepairGuidance}`
        : panelPromptBaseRaw

      if (shouldGenerate) {
        const panelProviderConfig = resolveProviderConfig(
          provider,
          providerConfig
        )
        let panelResponse = null
        let panelImageModel = imageModel
        let panelImageSize = imageSize
        let acceptedPrompt = panelPromptBase
        let acceptedAudit = createEmptyPanelTextAuditResult()
        let acceptedValidatorAudit = createEmptyRenderedPanelAuditResult()

        for (
          let attempt = 0;
          attempt <= validatorMaxRetries && !panelResponse;
          attempt += 1
        ) {
          const retrySuffix =
            attempt > 0
              ? buildPanelValidatorRetrySuffix({
                  summary: acceptedValidatorAudit.summary,
                  validatorResult: acceptedValidatorAudit,
                  keywordA,
                  keywordB,
                })
              : ''
          const panelPrompt = retrySuffix
            ? `${panelPromptBase}\n${retrySuffix}`
            : panelPromptBase

          let currentPanelResponse = null
          const timeoutCandidates = buildImageTimeoutCandidates(
            fastBuild
              ? Math.min(profile.requestTimeoutMs, 90 * 1000)
              : profile.requestTimeoutMs
          )
          const imageProfileCandidates = buildImageProfileCandidates({
            provider,
            imageModel,
            imageSize,
          })
          let timeoutFailure = null
          for (
            let profileIndex = 0;
            profileIndex < imageProfileCandidates.length &&
            !currentPanelResponse;
            profileIndex += 1
          ) {
            const profileCandidate = imageProfileCandidates[profileIndex]
            for (
              let timeoutIndex = 0;
              timeoutIndex < timeoutCandidates.length && !currentPanelResponse;
              timeoutIndex += 1
            ) {
              const timeoutMs = timeoutCandidates[timeoutIndex]
              const imageProfile = {
                ...profile,
                requestTimeoutMs: timeoutMs,
              }
              try {
                // eslint-disable-next-line no-await-in-loop
                currentPanelResponse = await withRetries(
                  profile.maxRetries,
                  () =>
                    runImageProvider({
                      provider,
                      imageModel: profileCandidate.imageModel,
                      prompt: panelPrompt,
                      profile: imageProfile,
                      apiKey,
                      providerConfig: panelProviderConfig,
                      size: profileCandidate.imageSize,
                      quality: imageQuality,
                      style: imageStyle,
                    })
                )
                if (currentPanelResponse) {
                  panelImageModel = profileCandidate.imageModel
                  panelImageSize = profileCandidate.imageSize
                  if (profileIndex > 0) {
                    logger.info('AI image generation fallback profile used', {
                      provider,
                      panel: panelIndex + 1,
                      imageModel: profileCandidate.imageModel,
                      imageSize: profileCandidate.imageSize,
                      reason: profileCandidate.reason,
                    })
                  }
                }
              } catch (error) {
                if (isTimeoutError(error)) {
                  timeoutFailure = error
                  logger.info(
                    'AI image generation timeout, escalating timeout',
                    {
                      provider,
                      imageModel: profileCandidate.imageModel,
                      imageSize: profileCandidate.imageSize,
                      panel: panelIndex + 1,
                      totalPanels: 4,
                      timeoutMs,
                      nextTimeoutMs:
                        timeoutCandidates[timeoutIndex + 1] || timeoutMs,
                    }
                  )
                } else {
                  throw error
                }
              }
            }
          }

          if (!currentPanelResponse && timeoutFailure) {
            throw new Error(
              `Image generation timed out after retries (panel ${
                panelIndex + 1
              }/4, model ${imageModel}, size ${imageSize}, tried timeouts: ${timeoutCandidates.join(
                'ms, '
              )}ms, fallback profiles: ${imageProfileCandidates
                .map((item) => `${item.imageModel}@${item.imageSize}`)
                .join(', ')}).`
            )
          }

          usage = addTokenUsage(
            usage,
            currentPanelResponse.usage || createEmptyTokenUsage()
          )
          panelImageModelUsed[panelIndex] = panelImageModel
          panelImageSizeUsed[panelIndex] = panelImageSize
          const unitPrice = isOpenAiCompatibleProvider(provider)
            ? resolveOpenAiImageUnitPrice(panelImageModel, panelImageSize)
            : null
          if (unitPrice != null) {
            estimatedImageCostUsd += unitPrice
          }

          const panelImageDataUrl = String(
            currentPanelResponse.imageDataUrl || ''
          ).trim()
          if (!validatorEnabled || !panelImageDataUrl) {
            panelResponse = currentPanelResponse
            acceptedPrompt = panelPrompt
            acceptedValidatorAudit = createEmptyRenderedPanelAuditResult()
            acceptedValidatorAudit.summary = {
              ...acceptedValidatorAudit.summary,
              invoked: false,
            }
            acceptedAudit = buildLegacyTextAuditFromValidator({
              validatorResult: acceptedValidatorAudit,
              checked: false,
              attempts: attempt + 1,
              retriesUsed: attempt,
              reason: validatorEnabled ? '' : 'disabled',
            })
          } else {
            // eslint-disable-next-line no-await-in-loop
            const validatorResult = await runRenderedPanelValidatorHooks({
              hooks: renderedPanelValidatorHooks,
              context: {
                auditCacheKey: `rendered-panel-${startedAt}-${panelIndex}-${attempt}`,
                panelIndex,
                attempt,
                panelStory: storyPanels[panelIndex],
                storyPanels,
                keywordA,
                keywordB,
                keywords: [keywordA, keywordB],
                panelPrompt,
                panelImageDataUrl,
                senseSelection,
              },
            })
            const summary =
              validatorResult && validatorResult.summary
                ? validatorResult.summary
                : createEmptyRenderedPanelAuditResult().summary

            acceptedValidatorAudit = {
              ...validatorResult,
              invoked: Boolean(summary.invoked),
              passed: Boolean(summary.passed),
              failureReasons: Array.isArray(summary.failureReasons)
                ? summary.failureReasons.slice(0, 8)
                : [],
              shouldRetryPanel: Boolean(summary.shouldRetryPanel),
              shouldReplan: Boolean(summary.shouldReplan),
              panelRepairReason: String(summary.panelRepairReason || '').trim(),
            }
            acceptedAudit = buildLegacyTextAuditFromValidator({
              validatorResult: acceptedValidatorAudit,
              checked: Boolean(summary.invoked),
              attempts: attempt + 1,
              retriesUsed: attempt,
              reason: acceptedValidatorAudit.panelRepairReason,
            })

            if (summary.invoked) {
              validatorMetrics.validator_invoked += 1
            }
            if (summary.failureReasons.includes('ocr_fail')) {
              validatorMetrics.ocr_fail += 1
            }
            if (summary.failureReasons.includes('visibility_fail')) {
              validatorMetrics.visibility_fail += 1
            }
            if (summary.failureReasons.includes('alignment_fail')) {
              validatorMetrics.alignment_fail += 1
            }
            if (summary.failureReasons.includes('policy_fail')) {
              validatorMetrics.policy_fail += 1
            }

            const canRetry =
              summary.shouldRetryPanel && attempt < validatorMaxRetries

            if (canRetry) {
              textOverlayRetryCount += 1
              validatorMetrics.validator_retry_count += 1
              if (acceptedValidatorAudit.panelRepairReason) {
                validatorMetrics.panel_repair_reason.push({
                  panel: panelIndex,
                  attempt: attempt + 1,
                  reason: acceptedValidatorAudit.panelRepairReason,
                })
              }
              logger.info('AI rendered panel validator retry', {
                provider,
                panel: panelIndex + 1,
                attempt: attempt + 1,
                failureReasons: acceptedValidatorAudit.failureReasons,
                panelRepairReason: acceptedValidatorAudit.panelRepairReason,
                shouldReplan: acceptedValidatorAudit.shouldReplan,
              })
            } else {
              panelResponse = currentPanelResponse
              acceptedPrompt = panelPrompt
              logger.info('AI rendered panel validator result', {
                provider,
                panel: panelIndex + 1,
                attempt: attempt + 1,
                invoked: acceptedValidatorAudit.invoked,
                passed: acceptedValidatorAudit.passed,
                failureReasons: acceptedValidatorAudit.failureReasons,
                panelRepairReason: acceptedValidatorAudit.panelRepairReason,
                shouldReplan: acceptedValidatorAudit.shouldReplan,
              })
            }
          }
        }

        if (!panelResponse) {
          throw new Error(
            `Panel ${panelIndex + 1} generation failed after validator retries`
          )
        }

        nextPanels[panelIndex] = String(panelResponse.imageDataUrl || '').trim()
        promptByPanel[panelIndex] = acceptedPrompt
        textAuditByPanel[panelIndex] = acceptedAudit
        validatorAuditByPanel[panelIndex] = acceptedValidatorAudit
        generatedCount += 1
      } else {
        promptByPanel[panelIndex] = panelPromptBase
      }
    }

    if (nextPanels.some((item) => !String(item || '').trim())) {
      throw new Error(
        'Panel generation returned incomplete images. Regenerate missing panels.'
      )
    }

    const estimatedTextCostUsd = estimateTextCostUsd(usage, model)
    const estimatedUsd =
      (estimatedTextCostUsd || 0) +
      (Number.isFinite(estimatedImageCostUsd) ? estimatedImageCostUsd : 0)

    const baseResult = {
      ok: true,
      provider,
      model,
      imageModel,
      imageSize,
      latencyMs: now() - startedAt,
      includeNoise,
      noisePanelIndex: includeNoise ? noisePanelIndex : null,
      generatedPanelCount: generatedCount,
      textAuditEnabled,
      textAuditModel: textAuditEnabled ? textAuditModel : '',
      textAuditMaxRetries,
      validatorEnabled,
      validatorModel: validatorEnabled ? validatorModel : '',
      validatorMaxRetries,
      selectedStory: {
        id: activeStory.id,
        title: activeStory.title,
        panels: storyPanels.slice(0, 4),
        senseSelection,
      },
      textOverlayRetryCount,
      senseSelection,
      textAuditByPanel,
      validatorAuditByPanel,
      validatorMetrics,
      panels: nextPanels.map((imageDataUrl, index) => ({
        index,
        imageDataUrl,
        imageModelUsed: panelImageModelUsed[index] || imageModel,
        imageSizeUsed: panelImageSizeUsed[index] || imageSize,
        panelPrompt: promptByPanel[index] || '',
        panelStory: storyPanels[index] || '',
        generated: regenerateIndices.includes(index),
      })),
      imageFallbackUsed: panelImageModelUsed.some(
        (usedModel, index) =>
          String(usedModel || '').trim() !== String(imageModel || '').trim() ||
          String(panelImageSizeUsed[index] || '').trim() !==
            String(imageSize || '').trim()
      ),
      tokenUsage: normalizeTokenUsage(usage),
      costs: {
        estimatedUsd,
        actualUsd: estimatedUsd,
        estimatedTextUsd: estimatedTextCostUsd,
        estimatedImageUsd: Number.isFinite(estimatedImageCostUsd)
          ? estimatedImageCostUsd
          : null,
      },
    }

    const fullStoryBuild = regenerateIndices.length === 4
    const renderFeedbackReport = evaluateRenderedStoryFeedback({
      storyPanels,
      renderedPanels: baseResult.panels,
      textAuditByPanel,
      validatorAuditByPanel,
      keywords: [keywordA, keywordB],
      hasAlternativeOption:
        fullStoryBuild && alternativeStoryOptions.length > 0,
    })
    renderFeedbackMetrics = recordRenderedStoryMetrics(
      renderFeedbackMetrics,
      renderFeedbackReport
    )
    const nextRenderHistory = renderFeedbackHistory.concat([
      {
        storyId: activeStory.id,
        verdict: renderFeedbackReport.verdict,
        score: renderFeedbackReport.score,
        failureReasons: renderFeedbackReport.failureReasons,
        repairPanelIndices: renderFeedbackReport.repairPanelIndices,
      },
    ])

    logger.info('AI rendered story feedback', {
      provider,
      model,
      storyId: activeStory.id,
      verdict: renderFeedbackReport.verdict,
      score: renderFeedbackReport.score,
      failureReasons: renderFeedbackReport.failureReasons,
      repairPanelIndices: renderFeedbackReport.repairPanelIndices,
      keywordCoverage: renderFeedbackReport.metrics.keywordCoverage,
      nearDuplicatePairs: renderFeedbackReport.nearDuplicatePairs,
    })

    if (
      renderFeedbackEnabled &&
      renderFeedbackReport.verdict === 'repair_selected_panels' &&
      renderFeedbackReport.repairPanelIndices.length > 0 &&
      renderFeedbackIteration < renderFeedbackMaxRepairs
    ) {
      logger.info('AI rendered story repair', {
        provider,
        model,
        storyId: activeStory.id,
        repairPanelIndices: renderFeedbackReport.repairPanelIndices,
        failureReasons: renderFeedbackReport.failureReasons,
      })
      const repairedResult = await generateFlipPanels({
        ...payload,
        storyPanels,
        senseSelection,
        existingPanels: nextPanels,
        regenerateIndices: renderFeedbackReport.repairPanelIndices,
        repairGuidanceByPanel: buildRenderedStoryRepairGuidance(
          renderFeedbackReport,
          {
            keywordA,
            keywordB,
          }
        ),
        renderFeedbackIteration: renderFeedbackIteration + 1,
        renderFeedbackSwitchCount,
        renderFeedbackHistory: nextRenderHistory,
      })
      repairedResult.renderFeedbackMetrics = mergeRenderedStoryMetrics(
        renderFeedbackMetrics,
        repairedResult.renderFeedbackMetrics
      )
      return repairedResult
    }

    if (
      renderFeedbackEnabled &&
      fullStoryBuild &&
      renderFeedbackReport.verdict ===
        'reject_story_and_use_alternative_option' &&
      alternativeStoryOptions.length > 0 &&
      renderFeedbackSwitchCount < renderFeedbackMaxSwitches
    ) {
      const alternativeStory = alternativeStoryOptions[0]
      logger.info('AI rendered story reject', {
        provider,
        model,
        storyId: activeStory.id,
        failureReasons: renderFeedbackReport.failureReasons,
        alternativeStoryId: alternativeStory.id,
      })
      const alternativeResult = await generateFlipPanels({
        ...payload,
        storyPanels: normalizeStoryPanels(alternativeStory.panels),
        senseSelection:
          alternativeStory.senseSelection &&
          typeof alternativeStory.senseSelection === 'object'
            ? alternativeStory.senseSelection
            : senseSelection,
        selectedStoryId: alternativeStory.id,
        existingPanels: ['', '', '', ''],
        regenerateIndices: [0, 1, 2, 3],
        renderFeedbackIteration: 0,
        renderFeedbackSwitchCount: renderFeedbackSwitchCount + 1,
        renderFeedbackHistory: nextRenderHistory,
        repairGuidanceByPanel: {},
      })
      const alternativeFeedback =
        alternativeResult.renderFeedback &&
        alternativeResult.renderFeedback.report &&
        typeof alternativeResult.renderFeedback.report === 'object'
          ? alternativeResult.renderFeedback.report
          : {score: 0, verdict: 'replan_story'}

      if (
        alternativeFeedback.verdict === 'accept_rendered_story' ||
        alternativeFeedback.score > renderFeedbackReport.score
      ) {
        renderFeedbackMetrics.switched_to_alternative_option += 1
        alternativeResult.renderFeedback = {
          ...(alternativeResult.renderFeedback || {}),
          switchedToAlternativeOption: true,
          previousStoryId: activeStory.id,
          previousStoryTitle: activeStory.title,
        }
        alternativeResult.renderFeedbackMetrics = mergeRenderedStoryMetrics(
          renderFeedbackMetrics,
          alternativeResult.renderFeedbackMetrics
        )
        return alternativeResult
      }
    }

    if (
      renderFeedbackEnabled &&
      renderFeedbackReport.verdict === 'replan_story'
    ) {
      logger.info('AI rendered story reject', {
        provider,
        model,
        storyId: activeStory.id,
        failureReasons: renderFeedbackReport.failureReasons,
        verdict: renderFeedbackReport.verdict,
      })
    }

    return {
      ...baseResult,
      renderFeedback: {
        verdict: renderFeedbackReport.verdict,
        report: renderFeedbackReport,
        selectedStoryId: activeStory.id,
        history: nextRenderHistory,
        switchedToAlternativeOption: false,
      },
      renderFeedbackMetrics,
    }
  }

  async function generateImageSearchResults(payload = {}) {
    const provider = normalizeProvider(payload.provider)
    const model = String(payload.model || DEFAULT_MODELS[provider]).trim()
    const imageModel = String(payload.imageModel || 'gpt-image-1-mini').trim()
    const requestedImageSize = String(payload.imageSize || '1024x1024').trim()
    const imageSize = normalizeProviderImageSize(requestedImageSize)
    const imageQuality = String(payload.imageQuality || '').trim()
    const imageStyle = String(payload.imageStyle || '').trim()
    const maxImages = Math.max(
      1,
      Math.min(8, Number.parseInt(payload.maxImages, 10) || 4)
    )
    const prompt = String(payload.prompt || '')
      .trim()
      .slice(0, 2400)
    const providerConfig = payload.providerConfig || null
    const apiKey = getApiKey(provider)

    if (!prompt) {
      throw new Error('Prompt is required for AI image search')
    }

    if (!supportsImageGenerationProvider(provider)) {
      throw new Error(
        `AI image search is not available for provider: ${provider}. Supported providers: openai-compatible and gemini.`
      )
    }

    const imageRequestTimeoutMs = Math.max(
      Number(payload.requestTimeoutMs) || 0,
      MIN_IMAGE_SEARCH_REQUEST_TIMEOUT_MS
    )

    const profile = sanitizeBenchmarkProfile({
      benchmarkProfile: 'custom',
      requestTimeoutMs: imageRequestTimeoutMs,
      maxOutputTokens: 32,
      temperature: 0,
      maxRetries: payload.maxRetries ?? 1,
      maxConcurrency: 1,
      deadlineMs: 60000,
    })
    profile.requestTimeoutMs = imageRequestTimeoutMs

    const startedAt = now()
    const images = []
    let usage = createEmptyTokenUsage()
    let estimatedImageCostUsd = 0

    for (let index = 0; index < maxImages; index += 1) {
      const variantPrompt =
        maxImages > 1
          ? `${prompt}\n\nCreate variant ${
              index + 1
            } with a different composition.`
          : prompt

      const timeoutCandidates = buildImageTimeoutCandidates(
        profile.requestTimeoutMs,
        {
          minimumTimeoutMs: MIN_IMAGE_SEARCH_REQUEST_TIMEOUT_MS,
          stepsMs: [0],
        }
      )
      let response = null
      let timeoutFailure = null
      for (
        let timeoutIndex = 0;
        timeoutIndex < timeoutCandidates.length && !response;
        timeoutIndex += 1
      ) {
        const timeoutMs = timeoutCandidates[timeoutIndex]
        const imageProfile = {
          ...profile,
          requestTimeoutMs: timeoutMs,
        }
        try {
          // eslint-disable-next-line no-await-in-loop
          response = await withRetries(profile.maxRetries, () =>
            runImageProvider({
              provider,
              imageModel,
              prompt: variantPrompt,
              profile: imageProfile,
              apiKey,
              providerConfig: resolveProviderConfig(provider, providerConfig),
              size: imageSize,
              quality: imageQuality,
              style: imageStyle,
            })
          )
        } catch (error) {
          if (isTimeoutError(error)) {
            timeoutFailure = error
            logger.info('AI image search timeout, escalating timeout', {
              provider,
              imageModel,
              variant: index + 1,
              totalVariants: maxImages,
              timeoutMs,
              nextTimeoutMs: timeoutCandidates[timeoutIndex + 1] || timeoutMs,
            })
          } else {
            throw error
          }
        }
      }

      if (!response && timeoutFailure) {
        throw new Error(
          `AI image search timed out after retries (variant ${
            index + 1
          }/${maxImages}, model ${imageModel}, size ${imageSize}, tried timeouts: ${timeoutCandidates.join(
            'ms, '
          )}ms).`
        )
      }

      const imageDataUrl = String(response.imageDataUrl || '').trim()
      if (!imageDataUrl) {
        throw new Error('AI image search returned empty image payload')
      }

      images.push({
        image: imageDataUrl,
        thumbnail: imageDataUrl,
      })
      usage = addTokenUsage(usage, response.usage || createEmptyTokenUsage())
      const unitPrice = isOpenAiCompatibleProvider(provider)
        ? resolveOpenAiImageUnitPrice(imageModel, imageSize)
        : null
      if (unitPrice != null) {
        estimatedImageCostUsd += unitPrice
      }
    }

    const estimatedTextCostUsd = estimateTextCostUsd(usage, model)
    const estimatedUsd =
      (estimatedTextCostUsd || 0) +
      (Number.isFinite(estimatedImageCostUsd) ? estimatedImageCostUsd : 0)

    return {
      ok: true,
      provider,
      model,
      imageModel,
      imageSize,
      requestedImageSize,
      latencyMs: now() - startedAt,
      images,
      tokenUsage: normalizeTokenUsage(usage),
      costs: {
        estimatedUsd,
        actualUsd: estimatedUsd,
        estimatedTextUsd: estimatedTextCostUsd,
        estimatedImageUsd: Number.isFinite(estimatedImageCostUsd)
          ? estimatedImageCostUsd
          : null,
      },
    }
  }

  async function writeBenchmarkLogDefault(entry) {
    try {
      const dir = path.join(getUserDataPath(), 'ai-benchmark')
      await fs.ensureDir(dir)
      await fs.appendFile(
        path.join(dir, 'session-metrics.jsonl'),
        `${JSON.stringify(entry)}\n`
      )
    } catch (error) {
      logger.error('Unable to write AI benchmark log', {
        error: error.toString(),
      })
    }
  }

  async function solveFlipBatch(payload = {}) {
    const provider = normalizeProvider(payload.provider)
    const model = String(payload.model || DEFAULT_MODELS[provider]).trim()
    const legacyOnlyMode = Boolean(
      payload && payload.legacyHeuristicEnabled && payload.legacyHeuristicOnly
    )
    const flips = Array.isArray(payload.flips) ? payload.flips : []
    const providerConfig = payload.providerConfig || null
    const consultProviders = normalizeConsultProviders(payload, provider, model)
    const consultProvidersWithKeys = consultProviders.map((consultant) => ({
      ...consultant,
      apiKey:
        consultant.internalStrategy === LEGACY_HEURISTIC_STRATEGY ||
        isLocalAiProvider(consultant.provider)
          ? null
          : getApiKey(consultant.provider),
    }))

    if (!flips.length) {
      throw new Error('No flips provided')
    }
    if (!consultProviders.length) {
      throw new Error('No consultant strategies available')
    }

    const profile = sanitizeBenchmarkProfile(payload)
    const basePromptOptions =
      payload &&
      payload.promptOptions &&
      typeof payload.promptOptions === 'object'
        ? payload.promptOptions
        : {}
    const startedAt = now()
    const deadlineAt = startedAt + profile.deadlineMs
    const swapPlan = buildSwapPlan(flips)
    const interFlipDelayMs = Math.max(0, Number(profile.interFlipDelayMs) || 0)
    const onFlipStart =
      typeof payload.onFlipStart === 'function' ? payload.onFlipStart : null
    const onFlipResult =
      typeof payload.onFlipResult === 'function' ? payload.onFlipResult : null

    function emitFlipStart(event) {
      if (!onFlipStart) {
        return
      }
      try {
        onFlipStart(event)
      } catch (error) {
        logger.error('AI solver onFlipStart callback failed', {
          error: error.toString(),
        })
      }
    }

    function emitFlipResult(event) {
      if (!onFlipResult) {
        return
      }
      try {
        onFlipResult(event)
      } catch (error) {
        logger.error('AI solver onFlipResult callback failed', {
          error: error.toString(),
        })
      }
    }

    async function solveSingleFlip(flip, flipIndex) {
      const flipStartedAt = now()
      const swapped = swapPlan[flipIndex] === true
      const vision = resolveVisionModeForFlip(profile, flip)
      const availableLeftFrames = normalizeImageList(flip.leftFrames).slice(
        0,
        4
      )
      const availableRightFrames = normalizeImageList(flip.rightFrames).slice(
        0,
        4
      )
      const deepFrameReviewAvailable =
        availableLeftFrames.length > 0 && availableRightFrames.length > 0

      if (flipStartedAt >= deadlineAt) {
        if (profile.forceDecision) {
          const forcedAnswer = chooseRandomSide()
          return {
            hash: flip.hash,
            answer: forcedAnswer,
            rawAnswerBeforeRemap: 'skip',
            finalAnswerAfterRemap: forcedAnswer,
            confidence: 0,
            reasoning: `deadline exceeded, random fallback ${forcedAnswer}`,
            latencyMs: 0,
            error: 'deadline_exceeded',
            sideSwapped: swapped,
            flipVisionModeRequested: vision.requested,
            flipVisionModeApplied: vision.applied,
            flipVisionModeFallback: vision.fallbackReason,
            forcedDecision: true,
            forcedDecisionReason: 'deadline_exceeded',
            forcedDecisionPolicy: 'random',
            tokenUsage: createEmptyTokenUsage(),
          }
        }
        return {
          hash: flip.hash,
          answer: 'skip',
          rawAnswerBeforeRemap: 'skip',
          finalAnswerAfterRemap: 'skip',
          confidence: 0,
          reasoning: 'deadline exceeded before request',
          latencyMs: 0,
          error: 'deadline_exceeded',
          sideSwapped: swapped,
          flipVisionModeRequested: vision.requested,
          flipVisionModeApplied: vision.applied,
          flipVisionModeFallback: vision.fallbackReason,
          tokenUsage: createEmptyTokenUsage(),
        }
      }

      const providerFlip = buildProviderFlipForVision({
        flip,
        swapped,
        visionMode: vision.applied,
        leftFrames: vision.leftFrames,
        rightFrames: vision.rightFrames,
      })
      const deepFrameReviewFlip = deepFrameReviewAvailable
        ? buildProviderFlipForVision({
            flip,
            swapped,
            visionMode: 'frames_two_pass',
            leftFrames: availableLeftFrames,
            rightFrames: availableRightFrames,
          })
        : null

      emitFlipStart({
        type: 'flip-start',
        flipIndex,
        hash: flip.hash,
        leftImage: flip.leftImage,
        rightImage: flip.rightImage,
        leftFrames: vision.leftFrames,
        rightFrames: vision.rightFrames,
        sideSwapped: swapped,
        flipVisionModeRequested: vision.requested,
        flipVisionModeApplied: vision.applied,
        flipVisionModeFallback: vision.fallbackReason,
      })

      const callProviderPass = async ({
        secondPass = false,
        allowSkip = true,
        deepFrameReview = false,
      } = {}) => {
        const useFrameReasoning =
          vision.applied === 'frames_two_pass' ||
          (deepFrameReview && deepFrameReviewAvailable)
        const passFlipVisionMode = useFrameReasoning
          ? 'frames_two_pass'
          : vision.applied
        const passFlip = useFrameReasoning ? deepFrameReviewFlip : providerFlip

        const invokeConsultantOnce = async (consultant, promptOptions) =>
          withRetries(profile.maxRetries, async (attempt) => {
            try {
              return await invokeProvider({
                provider: consultant.provider,
                model: consultant.model,
                flip: passFlip,
                profile,
                apiKey: consultant.apiKey,
                providerConfig: consultant.providerConfig || providerConfig,
                promptOptions,
              })
            } catch (error) {
              const status = getResponseStatus(error)
              if (status === 429 && attempt < profile.maxRetries) {
                const retryAfterMs =
                  getRetryAfterMs(error) || Math.max(500, 700 * (attempt + 1))
                await sleep(retryAfterMs)
              }
              throw error
            }
          })

        const solveConsultant = async (consultant) => {
          try {
            if (consultant.internalStrategy === LEGACY_HEURISTIC_STRATEGY) {
              const heuristicRawDecision = solveLegacyHeuristicDecision({
                flip: passFlip,
              })
              const heuristicDecision = remapDecisionIfSwapped(
                heuristicRawDecision,
                swapped
              )

              return {
                provider: consultant.provider,
                model: consultant.model,
                weight: normalizeConsultantWeight(consultant.weight, 1),
                answer: normalizeAnswer(heuristicDecision.answer),
                confidence: normalizeConfidence(heuristicDecision.confidence),
                reasoning: heuristicDecision.reasoning,
                rawAnswerBeforeRemap: normalizeAnswer(
                  heuristicRawDecision.answer
                ),
                finalAnswerAfterRemap: normalizeAnswer(
                  heuristicDecision.answer
                ),
                error: null,
                tokenUsage: createEmptyTokenUsage(),
                costs: createEmptyCostSummary(),
                frameReasoningUsed: false,
              }
            }

            let decisionResponse
            let combinedTokenUsage = createEmptyTokenUsage()
            let frameReasoningUsed = false

            if (useFrameReasoning) {
              const frameReasoningResponse = await invokeConsultantOnce(
                consultant,
                {
                  ...basePromptOptions,
                  secondPass,
                  forceDecision: false,
                  flipVisionMode: 'frames_two_pass',
                  promptPhase: 'frame_reasoning',
                }
              )
              const normalizedFrameReasoning = normalizeProviderResponse(
                frameReasoningResponse
              )
              combinedTokenUsage = addTokenUsage(
                combinedTokenUsage,
                normalizedFrameReasoning.tokenUsage
              )
              frameReasoningUsed = true

              decisionResponse = await invokeConsultantOnce(consultant, {
                ...basePromptOptions,
                secondPass,
                forceDecision: !allowSkip,
                flipVisionMode: 'frames_two_pass',
                promptPhase: 'decision_from_frame_reasoning',
                frameReasoning: normalizedFrameReasoning.rawText,
              })
            } else {
              decisionResponse = await invokeConsultantOnce(consultant, {
                ...basePromptOptions,
                secondPass,
                forceDecision: !allowSkip,
                flipVisionMode: passFlipVisionMode,
                promptPhase: 'decision',
              })
            }

            const {rawText, tokenUsage, providerMeta} =
              normalizeProviderResponse(decisionResponse)
            combinedTokenUsage = addTokenUsage(combinedTokenUsage, tokenUsage)

            const parsed = extractJsonBlock(rawText)
            const rawDecision = normalizeDecision(parsed)
            const decision = remapDecisionIfSwapped(rawDecision, swapped)

            return {
              provider: consultant.provider,
              model: consultant.model,
              weight: normalizeConsultantWeight(consultant.weight, 1),
              answer: normalizeAnswer(decision.answer),
              confidence: normalizeConfidence(decision.confidence),
              reasoning: decision.reasoning,
              rawAnswerBeforeRemap: normalizeAnswer(rawDecision.answer),
              finalAnswerAfterRemap: normalizeAnswer(decision.answer),
              error: null,
              tokenUsage: combinedTokenUsage,
              costs: estimateProviderTextCostSummary(
                consultant.provider,
                consultant.model,
                combinedTokenUsage
              ),
              frameReasoningUsed,
              providerMeta,
            }
          } catch (error) {
            const message = createProviderErrorMessage({
              provider: consultant.provider,
              model: consultant.model,
              operation: 'request',
              error,
            })
            return {
              provider: consultant.provider,
              model: consultant.model,
              weight: normalizeConsultantWeight(consultant.weight, 1),
              answer: 'skip',
              confidence: 0,
              reasoning: 'provider error',
              error: message,
              tokenUsage: createEmptyTokenUsage(),
              costs: createEmptyCostSummary(),
              frameReasoningUsed: false,
              providerMeta: null,
            }
          }
        }

        const consultantDecisions = await Promise.all(
          consultProvidersWithKeys.map((consultant) =>
            solveConsultant(consultant)
          )
        )

        const aggregate = aggregateConsultantDecisions(
          consultantDecisions,
          flip.hash
        )
        const consultantTokenUsage = consultantDecisions.reduce(
          (acc, item) => addTokenUsage(acc, item.tokenUsage),
          createEmptyTokenUsage()
        )
        const consultantCosts = consultantDecisions.reduce(
          (acc, item) => addCostSummary(acc, item.costs),
          createEmptyCostSummary()
        )
        const consultedProviders = consultantDecisions.map(
          ({
            provider: consultProvider,
            model: consultModel,
            weight: itemWeight,
            answer,
            confidence,
            error,
          }) => ({
            provider: consultProvider,
            model: consultModel,
            weight: normalizeConsultantWeight(itemWeight, 1),
            answer,
            confidence,
            error,
          })
        )
        const providerErrors = consultantDecisions
          .filter((item) => item.error)
          .map((item) => item.error)
        const singleConsultantDecision =
          consultantDecisions.length === 1 ? consultantDecisions[0] : null
        const rawAnswerBeforeRemap = singleConsultantDecision
          ? normalizeAnswer(singleConsultantDecision.rawAnswerBeforeRemap)
          : aggregate.answer
        const finalAnswerAfterRemap = singleConsultantDecision
          ? normalizeAnswer(singleConsultantDecision.finalAnswerAfterRemap)
          : aggregate.answer
        const fastMode = summarizeConsultantFastMode(consultantDecisions)

        return {
          hash: flip.hash,
          answer: aggregate.answer,
          confidence: aggregate.confidence,
          reasoning: aggregate.reasoning,
          rawAnswerBeforeRemap,
          finalAnswerAfterRemap,
          error:
            providerErrors.length > 0
              ? providerErrors.slice(0, 3).join(' | ')
              : null,
          sideSwapped: swapped,
          flipVisionModeRequested: vision.requested,
          flipVisionModeApplied: vision.applied,
          flipVisionModeFallback: vision.fallbackReason,
          tokenUsage: consultantTokenUsage,
          costs: consultantCosts,
          secondPass,
          secondPassStrategy: resolveSecondPassStrategy({
            useFrameReasoning,
            secondPass,
          }),
          frameReasoningUsed: consultantDecisions.some(
            (item) => item.frameReasoningUsed
          ),
          deepFrameReviewAvailable,
          consultedProviders,
          ensembleProbabilities: aggregate.probabilities,
          ensembleContributors: aggregate.contributors,
          ensembleTotalWeight: aggregate.totalWeight,
          ensembleConsulted: consultantDecisions.length,
          ensembleTieBreakApplied: aggregate.tieBreakApplied,
          ensembleTieBreakCandidates: aggregate.tieBreakCandidates,
          fastMode,
        }
      }

      const allowSkipFirstPass = !(
        profile.forceDecision && !profile.uncertaintyRepromptEnabled
      )
      const firstPassResult = await callProviderPass({
        secondPass: false,
        allowSkip: allowSkipFirstPass,
      })
      let finalResult = firstPassResult
      let mergedTokenUsage = addTokenUsage(
        createEmptyTokenUsage(),
        firstPassResult.tokenUsage
      )
      let mergedCosts = addCostSummary(
        createEmptyCostSummary(),
        firstPassResult.costs
      )

      const shouldReprompt =
        profile.uncertaintyRepromptEnabled &&
        deadlineAt - now() >= profile.uncertaintyRepromptMinRemainingMs &&
        (firstPassResult.answer === 'skip' ||
          firstPassResult.confidence < profile.uncertaintyConfidenceThreshold)

      if (shouldReprompt) {
        const secondPassResult = await callProviderPass({
          secondPass: true,
          allowSkip: false,
          deepFrameReview: true,
        })
        mergedTokenUsage = addTokenUsage(
          mergedTokenUsage,
          secondPassResult.tokenUsage
        )
        mergedCosts = addCostSummary(mergedCosts, secondPassResult.costs)
        finalResult = {
          ...secondPassResult,
          uncertaintyRepromptUsed: true,
          firstPass: {
            answer: firstPassResult.answer,
            confidence: firstPassResult.confidence,
            error: firstPassResult.error,
            reasoning: firstPassResult.reasoning,
            rawAnswerBeforeRemap: firstPassResult.rawAnswerBeforeRemap,
            strategy: firstPassResult.secondPassStrategy,
          },
        }
      }

      if (profile.forceDecision && finalResult.answer === 'skip') {
        const forcedAnswer = chooseRandomSide()
        finalResult = {
          ...finalResult,
          answer: forcedAnswer,
          finalAnswerAfterRemap: forcedAnswer,
          forcedDecision: true,
          forcedDecisionPolicy: 'random',
          forcedDecisionReason: finalResult.error
            ? 'provider_error'
            : 'uncertain_or_skip',
          reasoning: finalResult.reasoning
            ? `${finalResult.reasoning}; random fallback ${forcedAnswer}`
            : `random fallback ${forcedAnswer}`,
        }
      }

      return {
        ...finalResult,
        latencyMs: now() - flipStartedAt,
        tokenUsage: mergedTokenUsage,
        costs: mergedCosts,
      }
    }

    function toProgressEvent(flip, flipIndex, result) {
      return {
        type: 'flip-result',
        flipIndex,
        hash: flip.hash,
        leftImage: flip.leftImage,
        rightImage: flip.rightImage,
        leftFrames: normalizeImageList(flip.leftFrames).slice(0, 4),
        rightFrames: normalizeImageList(flip.rightFrames).slice(0, 4),
        ...result,
      }
    }

    let results = []
    if (profile.maxConcurrency <= 1) {
      for (let flipIndex = 0; flipIndex < flips.length; flipIndex += 1) {
        // eslint-disable-next-line no-await-in-loop
        const result = await solveSingleFlip(flips[flipIndex], flipIndex)
        results.push(result)
        emitFlipResult(toProgressEvent(flips[flipIndex], flipIndex, result))

        if (interFlipDelayMs > 0 && flipIndex < flips.length - 1) {
          // eslint-disable-next-line no-await-in-loop
          await sleep(interFlipDelayMs)
        }
      }
    } else {
      results = await mapWithConcurrency(
        flips,
        profile.maxConcurrency,
        async (flip, flipIndex) => {
          const result = await solveSingleFlip(flip, flipIndex)
          emitFlipResult(toProgressEvent(flip, flipIndex, result))
          return result
        }
      )
    }

    const tokenUsageSummary = summarizeTokenUsage(results)
    const costSummary = summarizeCostSummary(results)
    const reportedProvider = legacyOnlyMode
      ? LEGACY_HEURISTIC_PROVIDER
      : provider
    const reportedModel = legacyOnlyMode ? LEGACY_HEURISTIC_MODEL : model
    const summary = {
      totalFlips: results.length,
      elapsedMs: now() - startedAt,
      skipped: results.filter((x) => x.answer === 'skip').length,
      left: results.filter((x) => x.answer === 'left').length,
      right: results.filter((x) => x.answer === 'right').length,
      consultedProviders: consultProviders.map(
        ({provider: itemProvider, model: itemModel, weight: itemWeight}) => ({
          provider: itemProvider,
          model: itemModel,
          weight: normalizeConsultantWeight(itemWeight, 1),
        })
      ),
      tokens: tokenUsageSummary,
      costs: costSummary,
      diagnostics: {
        swapped: results.filter((x) => x.sideSwapped === true).length,
        notSwapped: results.filter((x) => x.sideSwapped !== true).length,
        rawLeft: results.filter((x) => x.rawAnswerBeforeRemap === 'left')
          .length,
        rawRight: results.filter((x) => x.rawAnswerBeforeRemap === 'right')
          .length,
        rawSkip: results.filter((x) => x.rawAnswerBeforeRemap === 'skip')
          .length,
        finalLeft: results.filter((x) => x.finalAnswerAfterRemap === 'left')
          .length,
        finalRight: results.filter((x) => x.finalAnswerAfterRemap === 'right')
          .length,
        finalSkip: results.filter((x) => x.finalAnswerAfterRemap === 'skip')
          .length,
        remappedDecisions: results.filter((x) => {
          if (
            x.rawAnswerBeforeRemap !== 'left' &&
            x.rawAnswerBeforeRemap !== 'right'
          ) {
            return false
          }
          return x.rawAnswerBeforeRemap !== x.finalAnswerAfterRemap
        }).length,
        providerErrors: results.filter((x) => Boolean(x.error)).length,
      },
    }

    await writeBenchmarkLog({
      time: new Date().toISOString(),
      provider: reportedProvider,
      model: reportedModel,
      profile,
      session: payload.session || null,
      summary,
      flips: results.map(
        ({
          hash,
          answer,
          confidence,
          latencyMs,
          error,
          reasoning,
          sideSwapped,
          rawAnswerBeforeRemap,
          finalAnswerAfterRemap,
          tokenUsage,
          uncertaintyRepromptUsed,
          forcedDecision,
          forcedDecisionPolicy,
          forcedDecisionReason,
          firstPass,
          secondPassStrategy,
          frameReasoningUsed,
          flipVisionModeRequested,
          flipVisionModeApplied,
          flipVisionModeFallback,
          consultedProviders,
          ensembleProbabilities,
          ensembleContributors,
          ensembleTotalWeight,
          ensembleConsulted,
        }) => ({
          hash,
          answer,
          confidence,
          latencyMs,
          error,
          reasoning,
          sideSwapped,
          rawAnswerBeforeRemap,
          finalAnswerAfterRemap,
          tokenUsage,
          uncertaintyRepromptUsed,
          forcedDecision,
          forcedDecisionPolicy,
          forcedDecisionReason,
          firstPass,
          secondPassStrategy,
          frameReasoningUsed,
          flipVisionModeRequested,
          flipVisionModeApplied,
          flipVisionModeFallback,
          consultedProviders,
          ensembleProbabilities,
          ensembleContributors,
          ensembleTotalWeight,
          ensembleConsulted,
        })
      ),
    })

    return {
      provider: reportedProvider,
      model: reportedModel,
      profile,
      summary,
      results,
    }
  }

  async function reviewValidationReports(payload = {}) {
    const provider = normalizeProvider(payload.provider)
    const model = String(payload.model || DEFAULT_MODELS[provider]).trim()
    const flips = Array.isArray(payload.flips) ? payload.flips : []
    const providerConfig = payload.providerConfig || null
    const consultProviders = normalizeConsultProviders(payload, provider, model)

    if (
      isLocalAiProvider(provider) ||
      consultProviders.some((consultant) =>
        isLocalAiProvider(consultant.provider)
      )
    ) {
      throw new Error(
        'Local AI is not supported for validation report review yet. Use a cloud provider for automatic report review.'
      )
    }

    const consultProvidersWithKeys = consultProviders.map((consultant) => ({
      ...consultant,
      apiKey:
        consultant.internalStrategy === LEGACY_HEURISTIC_STRATEGY ||
        isLocalAiProvider(consultant.provider)
          ? null
          : getApiKey(consultant.provider),
    }))

    if (!flips.length) {
      throw new Error('No validation report flips provided')
    }
    if (!consultProviders.length) {
      throw new Error('No consultant strategies available')
    }

    const profile = sanitizeBenchmarkProfile(payload)
    const startedAt = now()
    const interFlipDelayMs = Math.max(0, Number(profile.interFlipDelayMs) || 0)

    async function reviewSingleFlip(flip) {
      const flipStartedAt = now()
      const sequenceImages = normalizeImageList(flip && flip.images).slice(0, 4)

      if (!sequenceImages.length) {
        return {
          hash: flip && flip.hash ? flip.hash : '',
          decision: 'approve',
          confidence: 0,
          reason: 'missing sequence images',
          triggeredRules: [],
          error: 'missing_images',
          latencyMs: now() - flipStartedAt,
          tokenUsage: createEmptyTokenUsage(),
          costs: createEmptyCostSummary(),
          consultedProviders: [],
        }
      }

      const promptText = buildValidationReportReviewPrompt({
        keywords: flip && flip.keywords,
      })

      const consultantReviews = await Promise.all(
        consultProvidersWithKeys.map(async (consultant) => {
          try {
            const providerResponse = await withRetries(
              profile.maxRetries,
              async (attempt) => {
                try {
                  return await invokeProvider({
                    provider: consultant.provider,
                    model: consultant.model,
                    flip: {
                      hash: flip.hash,
                      images: sequenceImages,
                    },
                    profile,
                    apiKey: consultant.apiKey,
                    providerConfig: consultant.providerConfig || providerConfig,
                    promptText,
                    promptOptions: {
                      promptPhase: 'report_review',
                    },
                  })
                } catch (error) {
                  const status = getResponseStatus(error)
                  if (status === 429 && attempt < profile.maxRetries) {
                    const retryAfterMs =
                      getRetryAfterMs(error) ||
                      Math.max(500, 700 * (attempt + 1))
                    await sleep(retryAfterMs)
                  }
                  throw error
                }
              }
            )

            const normalizedResponse =
              normalizeProviderResponse(providerResponse)
            const parsed = extractJsonBlock(normalizedResponse.rawText)
            const review = normalizeValidationReportDecision(parsed)

            return {
              provider: consultant.provider,
              model: consultant.model,
              weight: normalizeConsultantWeight(consultant.weight, 1),
              decision: review.decision,
              confidence: review.confidence,
              reason: review.reason,
              triggeredRules: review.triggeredRules,
              error: null,
              tokenUsage: normalizedResponse.tokenUsage,
              costs: estimateProviderTextCostSummary(
                consultant.provider,
                consultant.model,
                normalizedResponse.tokenUsage
              ),
            }
          } catch (error) {
            const message = createProviderErrorMessage({
              provider: consultant.provider,
              model: consultant.model,
              operation: 'validation_report_review',
              error,
            })

            return {
              provider: consultant.provider,
              model: consultant.model,
              weight: normalizeConsultantWeight(consultant.weight, 1),
              decision: 'approve',
              confidence: 0,
              reason: 'provider error',
              triggeredRules: [],
              error: message,
              tokenUsage: createEmptyTokenUsage(),
              costs: createEmptyCostSummary(),
            }
          }
        })
      )

      const aggregate = aggregateValidationReportReviews(consultantReviews)
      const consultantTokenUsage = consultantReviews.reduce(
        (acc, item) => addTokenUsage(acc, item.tokenUsage),
        createEmptyTokenUsage()
      )
      const consultantCosts = consultantReviews.reduce(
        (acc, item) => addCostSummary(acc, item.costs),
        createEmptyCostSummary()
      )
      const providerErrors = consultantReviews
        .filter((item) => item.error)
        .map((item) => item.error)

      return {
        hash: flip.hash,
        decision: aggregate.decision,
        confidence: aggregate.confidence,
        reason: aggregate.reason,
        triggeredRules: aggregate.triggeredRules,
        error:
          providerErrors.length > 0
            ? providerErrors.slice(0, 3).join(' | ')
            : null,
        latencyMs: now() - flipStartedAt,
        tokenUsage: consultantTokenUsage,
        costs: consultantCosts,
        consultedProviders: consultantReviews.map(
          ({
            provider: consultProvider,
            model: consultModel,
            weight: itemWeight,
            decision,
            confidence,
            error,
          }) => ({
            provider: consultProvider,
            model: consultModel,
            weight: normalizeConsultantWeight(itemWeight, 1),
            decision,
            confidence,
            error,
          })
        ),
      }
    }

    const results = []
    for (let flipIndex = 0; flipIndex < flips.length; flipIndex += 1) {
      // eslint-disable-next-line no-await-in-loop
      const result = await reviewSingleFlip(flips[flipIndex])
      results.push(result)

      if (interFlipDelayMs > 0 && flipIndex < flips.length - 1) {
        // eslint-disable-next-line no-await-in-loop
        await sleep(interFlipDelayMs)
      }
    }

    const tokenUsageSummary = summarizeTokenUsage(results)
    const costSummary = summarizeCostSummary(results)
    const summary = {
      totalFlips: results.length,
      elapsedMs: now() - startedAt,
      approved: results.filter((item) => item.decision === 'approve').length,
      reported: results.filter((item) => item.decision === 'report').length,
      consultedProviders: consultProviders.map(
        ({provider: itemProvider, model: itemModel, weight: itemWeight}) => ({
          provider: itemProvider,
          model: itemModel,
          weight: normalizeConsultantWeight(itemWeight, 1),
        })
      ),
      tokens: tokenUsageSummary,
      costs: costSummary,
      diagnostics: {
        providerErrors: results.filter((item) => Boolean(item.error)).length,
      },
    }

    return {
      provider,
      model,
      profile,
      summary,
      results,
    }
  }

  return {
    setProviderKey,
    clearProviderKey,
    hasProviderKey,
    testProvider,
    listModels,
    generateImageSearchResults,
    generateStoryOptions,
    generateFlipPanels,
    solveFlipBatch,
    reviewValidationReports,
  }
}

module.exports = {
  createAiProviderBridge,
  normalizeProvider,
}
