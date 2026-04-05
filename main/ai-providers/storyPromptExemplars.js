const {PROVIDERS, OPENAI_COMPATIBLE_PROVIDERS} = require('./constants')

const STORY_PROMPT_VARIANTS = {
  OPENAI_LIKE: 'openai_like_compact_exemplars',
  GEMINI: 'gemini_visual_compact_exemplars',
  ANTHROPIC: 'anthropic_literal_compact_exemplars',
}

function resolveStoryPromptVariant(provider) {
  const normalized = String(provider || '')
    .trim()
    .toLowerCase()
  if (normalized === PROVIDERS.Gemini) {
    return STORY_PROMPT_VARIANTS.GEMINI
  }
  if (normalized === PROVIDERS.Anthropic) {
    return STORY_PROMPT_VARIANTS.ANTHROPIC
  }
  if (OPENAI_COMPATIBLE_PROVIDERS.includes(normalized)) {
    return STORY_PROMPT_VARIANTS.OPENAI_LIKE
  }
  return STORY_PROMPT_VARIANTS.OPENAI_LIKE
}

function buildStoryPromptExemplarLines({
  provider,
  fastMode = false,
  enabled = true,
}) {
  if (enabled === false) {
    return {
      enabled: false,
      variant: resolveStoryPromptVariant(provider),
      lines: [],
    }
  }

  const variant = resolveStoryPromptVariant(provider)
  const heading = fastMode
    ? `Compact exemplar steering (${variant}):`
    : `Compact positive/negative exemplars (${variant}):`

  const variants = {
    [STORY_PROMPT_VARIANTS.OPENAI_LIKE]: {
      positive:
        'Positive: before: A costume assistant carries a feathered mask past a garment rack. trigger: The mask ribbon snags a hidden zipper pull. reaction: The garment bag peels open and reveals a bright stage cape. after: The open bag, hanging mask, and exposed cape stay visible beside the assistant.',
      negative:
        'Negative: before: A person interacts with both jar and cat. trigger: The person uses jar as a clear tool. reaction: Same kitchen again with only a changed face. after: The person observes the final result.',
      cue: 'Use short literal noun-verb sentences, make the aftermath physically obvious, and vary the archetype instead of defaulting to spills or overturned props.',
    },
    [STORY_PROMPT_VARIANTS.GEMINI]: {
      positive:
        'Positive: before: A gardener hangs a seed packet beside a porch hook. trigger: A gust catches the packet string and yanks open a folded shade. reaction: The shade drops across half the steps while the packet spins in the air. after: The lowered shade and dangling seed packet stay visible on the porch.',
      negative:
        'Negative: same porch repeated four times, tiny expression changes, and the final panel only says the gardener feels worried.',
      cue: 'Keep each panel composition visibly distinct and rotate between bent, blocked, tangled, revealed, or runaway outcomes instead of repeating spills or toppled furniture.',
    },
    [STORY_PROMPT_VARIANTS.ANTHROPIC]: {
      positive:
        'Positive: before: A student holds a flashlight near a basement door. trigger: The door swings open and a ghost appears on the stairs. reaction: The flashlight beam sweeps across hanging coats and catches a hidden exit sign shape in the mirror. after: The student backs against the wall while the ghost and bright beam remain visible.',
      negative:
        'Negative: abstract fear with no concrete accident, repeated staircase views, and no stable result state.',
      cue: 'Prefer calm, literal, everyday physical scenes with one coherent cause-and-effect chain, and vary the visible consequence type instead of leaning on dropped or overturned props.',
    },
  }

  const selected =
    variants[variant] || variants[STORY_PROMPT_VARIANTS.OPENAI_LIKE]
  const lines = [heading, selected.positive, selected.negative, selected.cue]

  return {
    enabled: true,
    variant,
    lines,
  }
}

module.exports = {
  buildStoryPromptExemplarLines,
  resolveStoryPromptVariant,
  STORY_PROMPT_VARIANTS,
}
