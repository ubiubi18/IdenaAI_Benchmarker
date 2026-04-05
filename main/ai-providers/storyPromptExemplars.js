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
        'Positive: before: A courier carries a birdcage through a theater doorway. trigger: The cage snags a curtain cord. reaction: The curtain tears loose and the cage door swings open. after: The fallen curtain and open cage stay visible beside the courier.',
      negative:
        'Negative: before: A person interacts with both jar and cat. trigger: The person uses jar as a clear tool. reaction: Same kitchen again with only a changed face. after: The person observes the final result.',
      cue: 'Use short literal noun-verb sentences, make the aftermath physically obvious, and vary the archetype instead of defaulting to spills.',
    },
    [STORY_PROMPT_VARIANTS.GEMINI]: {
      positive:
        'Positive: before: A gardener props a tall sunflower beside a porch rail. trigger: A gust slams the screen door into the pot. reaction: The pot cracks and the sunflower bends across the steps. after: The cracked pot and bent sunflower stay visible on the porch.',
      negative:
        'Negative: same porch repeated four times, tiny expression changes, and the final panel only says the gardener feels worried.',
      cue: 'Keep each panel composition visibly distinct and rotate between bent, blocked, tangled, revealed, or runaway outcomes instead of repeating spills.',
    },
    [STORY_PROMPT_VARIANTS.ANTHROPIC]: {
      positive:
        'Positive: before: A student holds a flashlight near a basement door. trigger: The door swings open and a ghost appears on the stairs. reaction: The flashlight drops and its beam sweeps across hanging coats. after: The student backs against the wall while the ghost and fallen flashlight remain visible.',
      negative:
        'Negative: abstract fear with no concrete accident, repeated staircase views, and no stable result state.',
      cue: 'Prefer calm, literal, everyday physical scenes with one coherent cause-and-effect chain, and vary the visible consequence type.',
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
