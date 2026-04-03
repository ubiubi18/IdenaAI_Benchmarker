const MIN_VISUAL_CONCRETENESS_SCORE = 0.45
const MIN_CAUSAL_STORY_SCORE = 0.45

const ABSTRACT_KEYWORD_HINTS = new Set([
  'idea',
  'justice',
  'hope',
  'love',
  'peace',
  'freedom',
  'truth',
  'memory',
  'honor',
  'emotion',
  'feeling',
  'thought',
])

const CURATED_SENSE_DICTIONARY = {
  shock: [
    {
      sense_id: 'shock_emotional_startle',
      gloss: 'emotional shock or startled reaction that is visible on a person',
      usage_rank: 1,
      visual_concreteness_score: 0.94,
      causal_story_score: 0.96,
      example_visual_form:
        'a person recoiling and dropping a cup after a sudden surprise',
      synonyms_for_prompting: ['startled reaction', 'sudden fright', 'alarm'],
      prompt_label: 'startled reaction',
      tags: ['emotion', 'reaction'],
    },
    {
      sense_id: 'shock_electric_jolt',
      gloss: 'electric shock or electrical jolt with sparks or current',
      usage_rank: 2,
      visual_concreteness_score: 0.76,
      causal_story_score: 0.42,
      example_visual_form: 'a sparking outlet or crackling electric arc',
      synonyms_for_prompting: ['electric jolt', 'spark'],
      prompt_label: 'electric jolt',
      tags: ['element', 'electricity', 'visible_change'],
    },
    {
      sense_id: 'shock_abstract_surprise',
      gloss: 'abstract surprise with no clear drawable trigger or aftermath',
      usage_rank: 3,
      visual_concreteness_score: 0.24,
      causal_story_score: 0.32,
      example_visual_form: 'someone vaguely reacting to unseen news',
      synonyms_for_prompting: ['surprise'],
      prompt_label: 'surprise',
      tags: ['emotion', 'abstract'],
    },
  ],
  ghost: [
    {
      sense_id: 'ghost_visible_spirit',
      gloss: 'visible ghost figure or floating spirit',
      usage_rank: 1,
      visual_concreteness_score: 0.95,
      causal_story_score: 0.84,
      example_visual_form: 'a pale floating ghost figure in a hallway',
      synonyms_for_prompting: ['ghost figure', 'spirit'],
      prompt_label: 'ghost figure',
      tags: ['entity', 'visible_trigger'],
    },
    {
      sense_id: 'ghost_social_disappearance',
      gloss: 'ghosting someone in a social or messaging sense',
      usage_rank: 2,
      visual_concreteness_score: 0.18,
      causal_story_score: 0.3,
      example_visual_form: 'a message conversation with no reply',
      synonyms_for_prompting: ['ignore'],
      prompt_label: 'social disappearance',
      tags: ['abstract', 'social'],
    },
  ],
  clown: [
    {
      sense_id: 'clown_performer',
      gloss: 'clown performer in costume and makeup',
      usage_rank: 1,
      visual_concreteness_score: 0.97,
      causal_story_score: 0.82,
      example_visual_form:
        'a clown performer in costume on a stage or workshop floor',
      synonyms_for_prompting: ['clown performer', 'costumed clown'],
      prompt_label: 'clown performer',
      tags: ['person', 'actor'],
    },
    {
      sense_id: 'clown_around_behavior',
      gloss: 'to clown around in an abstract joking sense',
      usage_rank: 2,
      visual_concreteness_score: 0.28,
      causal_story_score: 0.4,
      example_visual_form: 'someone acting silly without a clear object',
      synonyms_for_prompting: ['joke around'],
      prompt_label: 'joking behavior',
      tags: ['abstract', 'behavior'],
    },
  ],
  chainsaw: [
    {
      sense_id: 'chainsaw_cutting_tool',
      gloss: 'chainsaw as a power cutting tool used on wood or ice',
      usage_rank: 1,
      visual_concreteness_score: 0.96,
      causal_story_score: 0.88,
      example_visual_form: 'a chainsaw cutting a log on a workbench',
      synonyms_for_prompting: ['chainsaw', 'power saw'],
      prompt_label: 'chainsaw',
      safety_note: 'show cutting wood or ice, not harming a being',
      tags: ['tool', 'motion', 'elevated_risk'],
    },
    {
      sense_id: 'chainsaw_horror_threat',
      gloss: 'chainsaw used as a violent threat against a person or animal',
      usage_rank: 2,
      visual_concreteness_score: 0.9,
      causal_story_score: 0.18,
      example_visual_form: 'someone chased with a chainsaw',
      synonyms_for_prompting: ['weapon threat'],
      prompt_label: 'chainsaw threat',
      safety_note: 'reject this sense',
      tags: ['extreme', 'provider_risk', 'weapon'],
    },
  ],
  fire: [
    {
      sense_id: 'fire_visible_flame',
      gloss: 'visible fire or open flame',
      usage_rank: 1,
      visual_concreteness_score: 0.96,
      causal_story_score: 0.84,
      example_visual_form: 'a controlled flame in a fireplace or campfire',
      synonyms_for_prompting: ['flame', 'open fire'],
      prompt_label: 'visible flame',
      safety_note: 'keep the flame controlled and non-graphic',
      tags: ['element', 'visible_change', 'elevated_risk'],
    },
    {
      sense_id: 'fire_job_dismissal',
      gloss: 'to fire someone from a job',
      usage_rank: 2,
      visual_concreteness_score: 0.22,
      causal_story_score: 0.26,
      example_visual_form: 'a person receiving bad office news',
      synonyms_for_prompting: ['dismiss'],
      prompt_label: 'job dismissal',
      tags: ['abstract', 'social'],
    },
  ],
  gun: [
    {
      sense_id: 'gun_visible_firearm_object',
      gloss: 'clearly visible gun object handled without firing or harm',
      usage_rank: 1,
      visual_concreteness_score: 0.95,
      causal_story_score: 0.62,
      example_visual_form:
        'a training pistol on a bench or in a supervised safety drill',
      synonyms_for_prompting: ['gun', 'firearm'],
      prompt_label: 'gun',
      safety_note: 'keep it visible but unfired, with no aiming at a being',
      tags: ['tool', 'object', 'elevated_risk'],
    },
    {
      sense_id: 'gun_direct_harm',
      gloss: 'gun used to shoot directly at a person or animal',
      usage_rank: 2,
      visual_concreteness_score: 0.92,
      causal_story_score: 0.2,
      example_visual_form: 'aiming a gun at a living target',
      synonyms_for_prompting: ['shooting'],
      prompt_label: 'gun harm',
      safety_note: 'reject this sense',
      tags: ['extreme', 'provider_risk', 'weapon'],
    },
    {
      sense_id: 'gun_caulking_tool',
      gloss: 'caulking gun used as a repair tool',
      usage_rank: 3,
      visual_concreteness_score: 0.74,
      causal_story_score: 0.66,
      example_visual_form: 'a caulking gun sealing a window frame',
      synonyms_for_prompting: ['caulk gun'],
      prompt_label: 'caulking gun',
      tags: ['tool', 'repair'],
    },
  ],
  fall: [
    {
      sense_id: 'fall_drop_downward',
      gloss: 'physical falling or dropping downward',
      usage_rank: 1,
      visual_concreteness_score: 0.91,
      causal_story_score: 0.9,
      example_visual_form: 'a book slipping from a hand to the floor',
      synonyms_for_prompting: ['drop', 'tumble', 'falling motion'],
      prompt_label: 'falling motion',
      tags: ['motion', 'visible_change'],
    },
    {
      sense_id: 'fall_autumn_season',
      gloss: 'fall as the autumn season with leaves and orange trees',
      usage_rank: 2,
      visual_concreteness_score: 0.8,
      causal_story_score: 0.48,
      example_visual_form: 'orange autumn leaves in a park',
      synonyms_for_prompting: ['autumn'],
      prompt_label: 'autumn season',
      tags: ['season', 'setting'],
    },
    {
      sense_id: 'fall_abstract_decline',
      gloss: 'fall as abstract decline or defeat',
      usage_rank: 3,
      visual_concreteness_score: 0.2,
      causal_story_score: 0.24,
      example_visual_form: 'a symbolic downward chart',
      synonyms_for_prompting: ['decline'],
      prompt_label: 'decline',
      tags: ['abstract'],
    },
  ],
  mirror: [
    {
      sense_id: 'mirror_reflective_object',
      gloss: 'a reflective mirror surface or looking glass',
      usage_rank: 1,
      visual_concreteness_score: 0.95,
      causal_story_score: 0.76,
      example_visual_form: 'a wall mirror showing a clear reflection',
      synonyms_for_prompting: ['mirror', 'reflection', 'looking glass'],
      prompt_label: 'mirror',
      tags: ['object', 'reflection'],
    },
    {
      sense_id: 'mirror_copy_action',
      gloss: 'to mirror something in an abstract copy or match sense',
      usage_rank: 2,
      visual_concreteness_score: 0.24,
      causal_story_score: 0.34,
      example_visual_form: 'two vague matching gestures',
      synonyms_for_prompting: ['copy', 'match'],
      prompt_label: 'copy action',
      tags: ['abstract'],
    },
  ],
}

const PAIR_SCORE_OVERRIDES = {
  'chainsaw_cutting_tool|clown_performer': {
    visual_clarity: 0.04,
    causal_fit: 0.12,
    naturalness: 0.08,
    awkward_penalty: -0.02,
  },
  'chainsaw_cutting_tool|clown_around_behavior': {
    visual_clarity: -0.08,
    causal_fit: -0.14,
    naturalness: -0.12,
    awkward_penalty: 0.12,
  },
  'ghost_visible_spirit|shock_emotional_startle': {
    visual_clarity: 0.06,
    causal_fit: 0.2,
    naturalness: 0.14,
    awkward_penalty: -0.02,
  },
  'ghost_visible_spirit|shock_electric_jolt': {
    visual_clarity: -0.05,
    causal_fit: -0.2,
    naturalness: -0.14,
    awkward_penalty: 0.12,
  },
}

function clamp(value, min = 0, max = 1) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return min
  return Math.max(min, Math.min(max, numeric))
}

function roundScore(value) {
  return Math.round(clamp(value, -10, 10) * 1000) / 1000
}

function normalizeKeyword(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
}

function uniqueTrimmedStrings(values, maxItems = 5) {
  if (!Array.isArray(values)) return []
  const result = []
  for (const value of values) {
    const normalized = String(value || '').trim()
    if (normalized && !result.includes(normalized)) {
      result.push(normalized)
      if (result.length >= maxItems) break
    }
  }
  return result
}

function usageRankToScore(rank) {
  return clamp(1 - Math.max(0, Number(rank) - 1) * 0.18)
}

function cloneSense(keyword, value, index) {
  const entry = value && typeof value === 'object' ? value : {}
  const normalizedKeyword = normalizeKeyword(keyword)
  return {
    keyword: normalizedKeyword,
    sense_id:
      String(entry.sense_id || '').trim() ||
      `${normalizedKeyword || 'keyword'}_sense_${index + 1}`,
    gloss: String(entry.gloss || '').trim(),
    usage_rank: Math.max(1, Number.parseInt(entry.usage_rank, 10) || index + 1),
    visual_concreteness_score: clamp(entry.visual_concreteness_score),
    causal_story_score: clamp(entry.causal_story_score),
    example_visual_form: String(entry.example_visual_form || '').trim(),
    synonyms_for_prompting: uniqueTrimmedStrings(entry.synonyms_for_prompting),
    prompt_label:
      String(entry.prompt_label || '').trim() ||
      String(entry.example_visual_form || '').trim() ||
      normalizedKeyword,
    safety_note: String(entry.safety_note || '').trim(),
    tags: uniqueTrimmedStrings(entry.tags, 8).map((tag) => tag.toLowerCase()),
  }
}

function buildRawKeywordFallbackSense(keyword) {
  const normalizedKeyword = normalizeKeyword(keyword)
  const looksAbstract = ABSTRACT_KEYWORD_HINTS.has(normalizedKeyword)
  return {
    keyword: normalizedKeyword,
    sense_id: `${normalizedKeyword || 'keyword'}_literal_fallback`,
    gloss: looksAbstract
      ? `the most drawable literal visual stand-in for "${normalizedKeyword}"`
      : `the ordinary literal visible meaning of "${normalizedKeyword}"`,
    usage_rank: 1,
    visual_concreteness_score: looksAbstract ? 0.46 : 0.72,
    causal_story_score: looksAbstract ? 0.46 : 0.64,
    example_visual_form: looksAbstract
      ? `a simple visible object scene that stands in for ${normalizedKeyword}`
      : `a clearly visible ${normalizedKeyword} in one causal scene`,
    synonyms_for_prompting: normalizedKeyword ? [normalizedKeyword] : [],
    prompt_label: normalizedKeyword || 'literal visual form',
    safety_note: '',
    tags: looksAbstract ? ['fallback', 'abstract'] : ['fallback', 'object'],
  }
}

function isAbstractSense(sense) {
  return Boolean(
    sense &&
      Array.isArray(sense.tags) &&
      sense.tags.some((tag) => tag === 'abstract')
  )
}

function hasTag(sense, tag) {
  return Boolean(
    sense &&
      Array.isArray(sense.tags) &&
      sense.tags.some(
        (entry) =>
          entry ===
          String(tag || '')
            .trim()
            .toLowerCase()
      )
  )
}

function hasAnyTag(sense, tags) {
  return Array.isArray(tags) && tags.some((tag) => hasTag(sense, tag))
}

function shouldRejectSense(sense) {
  if (hasAnyTag(sense, ['extreme', 'provider_risk'])) {
    return 'provider_triggering_extreme'
  }
  if (sense.visual_concreteness_score < MIN_VISUAL_CONCRETENESS_SCORE) {
    return 'low_visual_concreteness'
  }
  if (sense.causal_story_score < MIN_CAUSAL_STORY_SCORE) {
    return 'low_causal_story_score'
  }
  return ''
}

function getSenseCandidates(keyword) {
  const normalizedKeyword = normalizeKeyword(keyword)
  const source = CURATED_SENSE_DICTIONARY[normalizedKeyword]
  const accepted = []
  const rejected = []

  if (Array.isArray(source) && source.length > 0) {
    source
      .map((entry, index) => cloneSense(normalizedKeyword, entry, index))
      .forEach((sense) => {
        const rejectionReason = shouldRejectSense(sense)
        if (rejectionReason) {
          rejected.push({
            ...sense,
            rejection_reason: rejectionReason,
          })
        } else {
          accepted.push(sense)
        }
      })
  }

  if (!accepted.length) {
    accepted.push(buildRawKeywordFallbackSense(normalizedKeyword))
  }

  accepted.sort((left, right) => {
    if (left.usage_rank !== right.usage_rank) {
      return left.usage_rank - right.usage_rank
    }
    return left.sense_id.localeCompare(right.sense_id)
  })

  return {
    keyword: normalizedKeyword,
    candidate_senses: accepted,
    rejected_senses: rejected,
    used_builtin_dictionary: Array.isArray(source) && source.length > 0,
  }
}

function isEmotionSense(sense) {
  return hasTag(sense, 'emotion')
}

function isVisibleTriggerSense(sense) {
  return hasAnyTag(sense, [
    'entity',
    'visible_trigger',
    'object',
    'reflection',
    'tool',
    'motion',
    'element',
    'visible_change',
  ])
}

function isActorSense(sense) {
  return hasAnyTag(sense, ['actor', 'person'])
}

function isToolSense(sense) {
  return hasTag(sense, 'tool')
}

function pairOverrideKey(firstSenseId, secondSenseId) {
  return [String(firstSenseId || ''), String(secondSenseId || '')]
    .sort((left, right) => left.localeCompare(right))
    .join('|')
}

function getPairScoreOverride(firstSenseId, secondSenseId) {
  return (
    PAIR_SCORE_OVERRIDES[pairOverrideKey(firstSenseId, secondSenseId)] || null
  )
}

function scoreSensePair(firstSense, secondSense) {
  let visualClarity =
    (firstSense.visual_concreteness_score +
      secondSense.visual_concreteness_score) /
    2
  let causalFit =
    (firstSense.causal_story_score + secondSense.causal_story_score) / 2
  let naturalness =
    (usageRankToScore(firstSense.usage_rank) +
      usageRankToScore(secondSense.usage_rank)) /
    2
  let awkwardPenalty = 0

  const firstIsEmotion = isEmotionSense(firstSense)
  const secondIsEmotion = isEmotionSense(secondSense)
  const firstIsVisibleTrigger = isVisibleTriggerSense(firstSense)
  const secondIsVisibleTrigger = isVisibleTriggerSense(secondSense)

  if (
    (firstIsEmotion && secondIsVisibleTrigger) ||
    (secondIsEmotion && firstIsVisibleTrigger)
  ) {
    visualClarity += 0.08
    causalFit += 0.18
    naturalness += 0.1
  } else if (firstIsEmotion || secondIsEmotion) {
    awkwardPenalty += 0.12
  }

  if (
    (isToolSense(firstSense) &&
      (isActorSense(secondSense) || secondIsVisibleTrigger)) ||
    (isToolSense(secondSense) &&
      (isActorSense(firstSense) || firstIsVisibleTrigger))
  ) {
    causalFit += 0.14
    naturalness += 0.08
  }

  if (
    (hasTag(firstSense, 'reflection') &&
      hasAnyTag(secondSense, ['entity', 'person', 'actor'])) ||
    (hasTag(secondSense, 'reflection') &&
      hasAnyTag(firstSense, ['entity', 'person', 'actor']))
  ) {
    visualClarity += 0.06
    causalFit += 0.12
    naturalness += 0.06
  }

  if (
    (hasTag(firstSense, 'motion') && secondIsVisibleTrigger) ||
    (hasTag(secondSense, 'motion') && firstIsVisibleTrigger)
  ) {
    visualClarity += 0.05
    causalFit += 0.1
    naturalness += 0.05
  }

  const abstractCount =
    Number(isAbstractSense(firstSense)) + Number(isAbstractSense(secondSense))
  if (abstractCount > 0) {
    visualClarity -= 0.18 * abstractCount
    causalFit -= 0.22 * abstractCount
    naturalness -= 0.18 * abstractCount
    awkwardPenalty += 0.28 * abstractCount
  }

  if (
    hasAnyTag(firstSense, ['elevated_risk']) ||
    hasAnyTag(secondSense, ['elevated_risk'])
  ) {
    awkwardPenalty += 0.08
  }

  if (isToolSense(firstSense) && isToolSense(secondSense)) {
    naturalness -= 0.08
    awkwardPenalty += 0.12
  }

  if (
    (hasTag(firstSense, 'season') && !hasTag(secondSense, 'setting')) ||
    (hasTag(secondSense, 'season') && !hasTag(firstSense, 'setting'))
  ) {
    naturalness -= 0.08
    awkwardPenalty += 0.08
  }

  if (hasAnyTag(firstSense, ['extreme', 'provider_risk'])) {
    causalFit -= 0.18
    naturalness -= 0.12
    awkwardPenalty += 0.6
  }
  if (hasAnyTag(secondSense, ['extreme', 'provider_risk'])) {
    causalFit -= 0.18
    naturalness -= 0.12
    awkwardPenalty += 0.6
  }

  const override = getPairScoreOverride(
    firstSense.sense_id,
    secondSense.sense_id
  )
  if (override) {
    visualClarity += Number(override.visual_clarity) || 0
    causalFit += Number(override.causal_fit) || 0
    naturalness += Number(override.naturalness) || 0
    awkwardPenalty += Number(override.awkward_penalty) || 0
  }

  visualClarity = clamp(visualClarity)
  causalFit = clamp(causalFit)
  naturalness = clamp(naturalness)
  awkwardPenalty = clamp(awkwardPenalty)

  const totalScore = clamp(
    visualClarity * 0.34 +
      causalFit * 0.38 +
      naturalness * 0.28 -
      awkwardPenalty * 0.32
  )
  const weakPair =
    totalScore < 0.58 ||
    visualClarity < 0.52 ||
    causalFit < 0.52 ||
    awkwardPenalty > 0.42

  return {
    visual_clarity: roundScore(visualClarity),
    causal_fit: roundScore(causalFit),
    naturalness: roundScore(naturalness),
    awkward_penalty: roundScore(awkwardPenalty),
    total_score: roundScore(totalScore),
    weak_pair: weakPair,
  }
}

function selectSensePair({keywordA, keywordB}) {
  const firstKeyword = normalizeKeyword(keywordA)
  const secondKeyword = normalizeKeyword(keywordB)
  const firstCandidates = getSenseCandidates(firstKeyword)
  const secondCandidates = getSenseCandidates(secondKeyword)

  const scoredPairs = []
  firstCandidates.candidate_senses.forEach((firstSense) => {
    secondCandidates.candidate_senses.forEach((secondSense) => {
      const score = scoreSensePair(firstSense, secondSense)
      scoredPairs.push({
        keyword_1_sense: firstSense,
        keyword_2_sense: secondSense,
        keyword_1_sense_id: firstSense.sense_id,
        keyword_2_sense_id: secondSense.sense_id,
        ...score,
      })
    })
  })

  scoredPairs.sort((left, right) => {
    if (right.total_score !== left.total_score) {
      return right.total_score - left.total_score
    }
    const leftUsage =
      Number(left.keyword_1_sense.usage_rank) +
      Number(left.keyword_2_sense.usage_rank)
    const rightUsage =
      Number(right.keyword_1_sense.usage_rank) +
      Number(right.keyword_2_sense.usage_rank)
    if (leftUsage !== rightUsage) {
      return leftUsage - rightUsage
    }
    return pairOverrideKey(
      left.keyword_1_sense_id,
      left.keyword_2_sense_id
    ).localeCompare(
      pairOverrideKey(right.keyword_1_sense_id, right.keyword_2_sense_id)
    )
  })

  const topPair = scoredPairs[0] || null
  let chosenPair = null
  let attemptedNextBestPair = false

  for (let index = 0; index < scoredPairs.length; index += 1) {
    const pair = scoredPairs[index]
    if (pair) {
      if (index > 0) {
        attemptedNextBestPair = true
      }
      if (!pair.weak_pair) {
        chosenPair = pair
        break
      }
    }
  }

  let usedRawKeywordFallback = false
  let selectionSource = 'curated_dictionary'
  let fallbackReason = ''

  if (!chosenPair) {
    const fallbackFirstSense = buildRawKeywordFallbackSense(firstKeyword)
    const fallbackSecondSense = buildRawKeywordFallbackSense(secondKeyword)
    const fallbackScore = scoreSensePair(
      fallbackFirstSense,
      fallbackSecondSense
    )
    chosenPair = {
      keyword_1_sense: fallbackFirstSense,
      keyword_2_sense: fallbackSecondSense,
      keyword_1_sense_id: fallbackFirstSense.sense_id,
      keyword_2_sense_id: fallbackSecondSense.sense_id,
      ...fallbackScore,
    }
    usedRawKeywordFallback = true
    selectionSource = 'literal_keyword_fallback'
    fallbackReason = 'no_non_weak_curated_pair'
  }

  return {
    raw_keywords: [firstKeyword, secondKeyword],
    candidate_senses: {
      keyword_1: firstCandidates.candidate_senses,
      keyword_2: secondCandidates.candidate_senses,
    },
    rejected_senses: {
      keyword_1: firstCandidates.rejected_senses,
      keyword_2: secondCandidates.rejected_senses,
    },
    compatibility_scores: scoredPairs.map((pair, index) => ({
      rank: index + 1,
      keyword_1_sense_id: pair.keyword_1_sense_id,
      keyword_2_sense_id: pair.keyword_2_sense_id,
      visual_clarity: pair.visual_clarity,
      causal_fit: pair.causal_fit,
      naturalness: pair.naturalness,
      awkward_penalty: pair.awkward_penalty,
      total_score: pair.total_score,
      weak_pair: pair.weak_pair,
    })),
    chosen_senses: {
      keyword_1: chosenPair.keyword_1_sense,
      keyword_2: chosenPair.keyword_2_sense,
    },
    selected_pair: {
      keyword_1_sense_id: chosenPair.keyword_1_sense_id,
      keyword_2_sense_id: chosenPair.keyword_2_sense_id,
      visual_clarity: chosenPair.visual_clarity,
      causal_fit: chosenPair.causal_fit,
      naturalness: chosenPair.naturalness,
      awkward_penalty: chosenPair.awkward_penalty,
      total_score: chosenPair.total_score,
      weak_pair: chosenPair.weak_pair,
    },
    used_raw_keyword_fallback: usedRawKeywordFallback,
    attempted_next_best_pair: attemptedNextBestPair,
    top_pair_was_weak: Boolean(topPair && topPair.weak_pair),
    selection_source: selectionSource,
    fallback_reason: fallbackReason,
  }
}

module.exports = {
  CURATED_SENSE_DICTIONARY,
  buildRawKeywordFallbackSense,
  getSenseCandidates,
  scoreSensePair,
  selectSensePair,
}
