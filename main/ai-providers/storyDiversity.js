const LOCATION_GROUPS = {
  hallway: ['hallway', 'corridor'],
  workshop: ['workshop', 'garage', 'studio', 'workbench', 'bench'],
  park: ['park', 'garden', 'playground'],
  school: ['school', 'classroom', 'locker'],
  basement: ['basement', 'cellar'],
  kitchen: ['kitchen', 'counter', 'sink'],
  bedroom: ['bedroom', 'bedside'],
  street: ['street', 'road', 'sidewalk', 'crosswalk'],
  yard: ['yard', 'porch', 'patio'],
  forest: ['forest', 'woods'],
  booth: ['booth', 'stall'],
  stairs: ['stairs', 'staircase', 'steps'],
  window_scene: ['window', 'windowsill'],
  water_edge: ['beach', 'shore', 'dock', 'lake', 'river'],
}

const TRIGGER_GROUPS = {
  appearance: ['appear', 'appears', 'appeared', 'emerge', 'emerges', 'emerged'],
  opening: ['open', 'opens', 'opened', 'swing', 'swings', 'unlock', 'unlocks'],
  drop_spill: [
    'drop',
    'drops',
    'dropped',
    'spill',
    'spills',
    'spilled',
    'knock',
    'knocks',
  ],
  fall: ['fall', 'falls', 'fell', 'topple', 'topples', 'collapse', 'collapses'],
  cut_carve: [
    'cut',
    'cuts',
    'cutting',
    'carve',
    'carves',
    'carving',
    'slice',
    'slices',
  ],
  movement: [
    'run',
    'runs',
    'move',
    'moves',
    'rush',
    'rushes',
    'slide',
    'slides',
  ],
  release: ['release', 'releases', 'released', 'escape', 'escapes', 'escaped'],
  ignition: [
    'ignite',
    'ignites',
    'burn',
    'burns',
    'burning',
    'light',
    'lights',
  ],
  reveal: ['reveal', 'reveals', 'revealed', 'show', 'shows', 'shown'],
  growth: ['grow', 'grows', 'grown', 'rise', 'rises', 'sprout', 'sprouts'],
  break: ['break', 'breaks', 'broke', 'broken', 'shatter', 'shatters'],
}

const ACTION_GROUPS = {
  carry: ['carry', 'carries', 'carried', 'hold', 'holds', 'held'],
  write: ['write', 'writes', 'wrote', 'draw', 'draws'],
  pick_up: [
    'pick',
    'picks',
    'picked',
    'grab',
    'grabs',
    'grabbed',
    'retrieve',
    'retrieves',
  ],
  step_back: [
    'step',
    'steps',
    'stepped',
    'back',
    'recoil',
    'recoils',
    'retreat',
    'retreats',
  ],
  cut_carve: [
    'cut',
    'cuts',
    'cutting',
    'carve',
    'carves',
    'carving',
    'shape',
    'shapes',
  ],
  pour_spill: ['pour', 'pours', 'poured', 'spill', 'spills', 'spilled'],
  open_close: ['open', 'opens', 'opened', 'close', 'closes', 'closed'],
  chase_escape: ['chase', 'chases', 'flee', 'flees', 'escape', 'escapes'],
  repair_clean: [
    'repair',
    'repairs',
    'clean',
    'cleans',
    'wipe',
    'wipes',
    'fix',
    'fixes',
  ],
  present_show: ['present', 'presents', 'show', 'shows', 'display', 'displays'],
}

const OUTCOME_GROUPS = {
  mess: ['puddle', 'mess', 'spill', 'wet', 'scattered', 'broken', 'shards'],
  recovery: ['safe', 'stored', 'folder', 'retrieved', 'recovered', 'saved'],
  retreat: ['away', 'retreated', 'back', 'wall', 'distance'],
  completion: ['finished', 'completed', 'complete', 'sculpture', 'figure'],
  open_result: ['open', 'opened'],
  contained: ['inside', 'trapped', 'sealed', 'closed'],
  growth: ['upright', 'grown', 'taller', 'healthy'],
}

const EMOTION_GROUPS = {
  shock: [
    'shock',
    'shocked',
    'startle',
    'startled',
    'jolt',
    'jolts',
    'surprise',
    'surprised',
  ],
  fear: [
    'fear',
    'afraid',
    'scared',
    'fright',
    'frightened',
    'panic',
    'panicked',
  ],
  relief: ['relief', 'relieved', 'calm', 'settled'],
  joy: ['happy', 'joy', 'smile', 'smiles', 'celebrate', 'celebrates'],
  anger: ['angry', 'anger', 'mad', 'furious'],
  sadness: ['sad', 'cry', 'cries', 'crying'],
}

const COMPOSITION_GROUPS = {
  doorway: ['door', 'doorway', 'threshold'],
  window_frame: ['window', 'windowsill'],
  tabletop: ['table', 'desk', 'workbench', 'bench'],
  stair_view: ['stairs', 'staircase', 'steps'],
  floor_focus: ['floor', 'ground', 'puddle'],
  overhead: ['overhead', 'above', 'from above'],
  closeup: ['close', 'closeup', 'close-up'],
}

const HUMAN_TERMS = [
  'person',
  'student',
  'clown',
  'child',
  'man',
  'woman',
  'worker',
  'artist',
  'farmer',
  'teacher',
]

const ANIMAL_TERMS = ['cat', 'dog', 'wolf', 'horse', 'bird', 'monkey', 'bear']

const CREATURE_TERMS = ['ghost', 'spirit', 'monster', 'fairy', 'dragon']

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'the',
  'of',
  'to',
  'in',
  'on',
  'at',
  'by',
  'with',
  'while',
  'through',
  'into',
  'from',
  'near',
  'beside',
  'under',
  'over',
  'as',
  'is',
  'are',
  'was',
  'were',
  'be',
  'being',
  'been',
  'it',
  'its',
  'their',
  'them',
  'this',
  'that',
  'now',
  'still',
  'same',
  'scene',
  'visible',
  'clearly',
  'panel',
  'story',
  'across',
  'against',
  'toward',
  'towards',
  'inside',
  'outside',
  'up',
  'down',
  'off',
  'for',
  'after',
  'before',
  'trigger',
  'reaction',
  'result',
])

const GENERIC_OBJECT_TOKENS = new Set([
  'person',
  'people',
  'someone',
  'student',
  'clown',
  'child',
  'man',
  'woman',
  'ghost',
  'spirit',
  'hallway',
  'room',
  'scene',
  'area',
  'place',
  'object',
  'thing',
])

function clampScore(value) {
  if (!Number.isFinite(Number(value))) return 0
  return Math.max(0, Math.min(100, Number(value)))
}

function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
}

function tokenize(text) {
  return normalizeText(text)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token && !STOPWORDS.has(token) && !/^\d+$/.test(token))
}

function buildTokenSet(text) {
  return new Set(tokenize(text))
}

function jaccardSimilarity(leftSet, rightSet) {
  const left = leftSet instanceof Set ? leftSet : new Set()
  const right = rightSet instanceof Set ? rightSet : new Set()
  if (left.size < 1 && right.size < 1) return 1
  if (left.size < 1 || right.size < 1) return 0

  let overlap = 0
  left.forEach((token) => {
    if (right.has(token)) overlap += 1
  })

  return overlap / (left.size + right.size - overlap)
}

function differenceFromSets(leftSet, rightSet, neutral = 0.35) {
  const left = leftSet instanceof Set ? leftSet : new Set()
  const right = rightSet instanceof Set ? rightSet : new Set()
  if (left.size < 1 && right.size < 1) return neutral
  return 1 - jaccardSimilarity(left, right)
}

function extractGroupTags(text, groups) {
  const normalizedText = normalizeText(text)
  const tokens = buildTokenSet(text)
  return new Set(
    Object.entries(groups)
      .filter(([, terms]) =>
        terms.some((term) => {
          const normalizedTerm = normalizeText(term)
          return normalizedTerm.includes(' ')
            ? normalizedText.includes(normalizedTerm)
            : tokens.has(normalizedTerm)
        })
      )
      .map(([tag]) => tag)
  )
}

function getPanelText(story, roleIndex) {
  const roles = ['before', 'trigger', 'reaction', 'after']
  const details = Array.isArray(story && story.panelDetails)
    ? story.panelDetails.slice(0, 4)
    : []
  const byRole = details.find(
    (panel) =>
      String(panel && panel.role ? panel.role : '')
        .trim()
        .toLowerCase() === roles[roleIndex]
  )
  if (byRole && byRole.description) {
    return String(byRole.description || '').trim()
  }
  const panels = Array.isArray(story && story.panels)
    ? story.panels.slice(0, 4)
    : []
  return String(panels[roleIndex] || '').trim()
}

function getStateChangeText(story, roleIndex) {
  const details = Array.isArray(story && story.panelDetails)
    ? story.panelDetails.slice(0, 4)
    : []
  const panel =
    details[roleIndex] && typeof details[roleIndex] === 'object'
      ? details[roleIndex]
      : {}
  return String(panel.stateChangeFromPrevious || '').trim()
}

function getRequiredVisibleTokens(story) {
  const details = Array.isArray(story && story.panelDetails)
    ? story.panelDetails.slice(0, 4)
    : []
  const tokens = []
  details.forEach((panel) => {
    const visibles = Array.isArray(panel && panel.requiredVisibles)
      ? panel.requiredVisibles
      : []
    visibles.forEach((item) => {
      tokens.push(...tokenize(item))
    })
  })
  return new Set(tokens)
}

function extractActorTags(text) {
  const tokens = buildTokenSet(text)
  const tags = new Set()
  if (HUMAN_TERMS.some((term) => tokens.has(term))) tags.add('human_actor')
  if (ANIMAL_TERMS.some((term) => tokens.has(term))) tags.add('animal_actor')
  if (CREATURE_TERMS.some((term) => tokens.has(term)))
    tags.add('creature_actor')
  if (!tags.size) tags.add('object_led')
  if (tokens.has('crowd') || tokens.has('audience') || tokens.has('group')) {
    tags.add('crowd_frame')
  } else {
    tags.add('single_subject')
  }
  return tags
}

function extractObjectTokens(story) {
  const text = [
    getPanelText(story, 0),
    getPanelText(story, 1),
    getPanelText(story, 2),
    getPanelText(story, 3),
  ].join(' ')
  const tokens = new Set([
    ...buildTokenSet(text),
    ...getRequiredVisibleTokens(story),
  ])
  GENERIC_OBJECT_TOKENS.forEach((token) => tokens.delete(token))
  return tokens
}

function extractStoryDiversityProfile(story) {
  const beforeText = getPanelText(story, 0)
  const triggerText = getPanelText(story, 1)
  const reactionText = getPanelText(story, 2)
  const afterText = getPanelText(story, 3)
  const fullText = [beforeText, triggerText, reactionText, afterText].join(' ')
  const afterStateText = `${afterText} ${getStateChangeText(story, 3)}`

  return {
    locationTags: extractGroupTags(fullText, LOCATION_GROUPS),
    actorTags: extractActorTags(beforeText || fullText),
    triggerTags: extractGroupTags(triggerText, TRIGGER_GROUPS),
    actionTags: extractGroupTags(fullText, ACTION_GROUPS),
    outcomeTags: extractGroupTags(afterStateText, OUTCOME_GROUPS),
    emotionTags: extractGroupTags(fullText, EMOTION_GROUPS),
    compositionTags: extractGroupTags(fullText, COMPOSITION_GROUPS),
    objectTokens: extractObjectTokens(story),
    triggerTokens: buildTokenSet(triggerText),
    actionTokens: buildTokenSet(`${triggerText} ${reactionText}`),
    outcomeTokens: buildTokenSet(afterStateText),
    panelTokenSets: [beforeText, triggerText, reactionText, afterText].map(
      (text) => buildTokenSet(text)
    ),
  }
}

function scoreDimension(leftSet, rightSet, neutral = 0.35) {
  const score = differenceFromSets(leftSet, rightSet, neutral)
  return Math.max(0, Math.min(1, score))
}

function evaluateStoryDiversityPair(leftStory, rightStory) {
  const leftProfile = extractStoryDiversityProfile(leftStory)
  const rightProfile = extractStoryDiversityProfile(rightStory)

  const dimensions = {
    location_difference: scoreDimension(
      leftProfile.locationTags,
      rightProfile.locationTags,
      0.25
    ),
    actor_framing_difference: scoreDimension(
      leftProfile.actorTags,
      rightProfile.actorTags,
      0.2
    ),
    trigger_type_difference: Math.max(
      scoreDimension(leftProfile.triggerTags, rightProfile.triggerTags, 0.25),
      scoreDimension(leftProfile.triggerTokens, rightProfile.triggerTokens, 0.2)
    ),
    object_difference: scoreDimension(
      leftProfile.objectTokens,
      rightProfile.objectTokens,
      0.2
    ),
    action_difference: Math.max(
      scoreDimension(leftProfile.actionTags, rightProfile.actionTags, 0.25),
      scoreDimension(leftProfile.actionTokens, rightProfile.actionTokens, 0.2)
    ),
    outcome_difference: Math.max(
      scoreDimension(leftProfile.outcomeTags, rightProfile.outcomeTags, 0.25),
      scoreDimension(leftProfile.outcomeTokens, rightProfile.outcomeTokens, 0.2)
    ),
    emotional_arc_difference: scoreDimension(
      leftProfile.emotionTags,
      rightProfile.emotionTags,
      0.2
    ),
    visual_composition_difference: scoreDimension(
      leftProfile.compositionTags,
      rightProfile.compositionTags,
      0.2
    ),
  }

  const weightedScore =
    dimensions.location_difference * 14 +
    dimensions.actor_framing_difference * 10 +
    dimensions.trigger_type_difference * 16 +
    dimensions.object_difference * 12 +
    dimensions.action_difference * 16 +
    dimensions.outcome_difference * 14 +
    dimensions.emotional_arc_difference * 10 +
    dimensions.visual_composition_difference * 8

  const panelSimilarities = leftProfile.panelTokenSets.map((tokens, index) =>
    jaccardSimilarity(tokens, rightProfile.panelTokenSets[index])
  )
  const meanPanelSimilarity =
    panelSimilarities.reduce((sum, value) => sum + value, 0) /
    Math.max(panelSimilarities.length, 1)
  const triggerSimilarity = jaccardSimilarity(
    leftProfile.triggerTokens,
    rightProfile.triggerTokens
  )
  const actionSimilarity = jaccardSimilarity(
    leftProfile.actionTokens,
    rightProfile.actionTokens
  )
  const outcomeSimilarity = jaccardSimilarity(
    leftProfile.outcomeTokens,
    rightProfile.outcomeTokens
  )

  const penalties = []
  let awkwardPenalty = 0

  if (meanPanelSimilarity >= 0.68) {
    penalties.push('near_duplicate_story_shape')
    awkwardPenalty += 22
  }
  if (
    jaccardSimilarity(leftProfile.locationTags, rightProfile.locationTags) >=
      0.7 &&
    triggerSimilarity >= 0.6
  ) {
    penalties.push('same_scene_template')
    awkwardPenalty += 10
  }
  if (triggerSimilarity >= 0.72) {
    penalties.push('same_trigger_shape')
    awkwardPenalty += 10
  }
  if (actionSimilarity >= 0.72) {
    penalties.push('same_action_shape')
    awkwardPenalty += 8
  }
  if (outcomeSimilarity >= 0.72) {
    penalties.push('same_outcome_shape')
    awkwardPenalty += 8
  }

  return {
    score: clampScore(weightedScore - awkwardPenalty),
    dimensions,
    metrics: {
      meanPanelSimilarity,
      triggerSimilarity,
      actionSimilarity,
      outcomeSimilarity,
      awkwardPenalty,
    },
    rejectionReasons: penalties,
  }
}

function getStoryQualityScore(story) {
  const score =
    story &&
    story.qualityReport &&
    Number.isFinite(Number(story.qualityReport.score))
      ? Number(story.qualityReport.score)
      : 0
  return clampScore(score)
}

function compareCandidates(left, right) {
  if (right.finalCombinedScore !== left.finalCombinedScore) {
    return right.finalCombinedScore - left.finalCombinedScore
  }
  if (right.averageQuality !== left.averageQuality) {
    return right.averageQuality - left.averageQuality
  }
  if (right.pairwiseDiversityScore !== left.pairwiseDiversityScore) {
    return right.pairwiseDiversityScore - left.pairwiseDiversityScore
  }
  return String(left.pairKey).localeCompare(String(right.pairKey))
}

function sortSelectedStories(stories) {
  return (Array.isArray(stories) ? stories.slice() : []).sort((left, right) => {
    const qualityDelta =
      getStoryQualityScore(right) - getStoryQualityScore(left)
    if (qualityDelta !== 0) {
      return qualityDelta
    }
    return String(left && left.id ? left.id : '').localeCompare(
      String(right && right.id ? right.id : '')
    )
  })
}

function selectStoryOptionPair(stories, options = {}) {
  const requestedCount = Math.max(
    1,
    Math.min(2, Number.parseInt(options.requestedCount, 10) || 2)
  )
  const candidates = Array.isArray(stories) ? stories.slice() : []
  const candidateQualityScores = candidates.map((story, index) => ({
    index,
    id: `${
      String(
        story && story.candidateSource ? story.candidateSource : 'candidate'
      ).trim() || 'candidate'
    }:${String(story && story.id ? story.id : `candidate-${index + 1}`)}`,
    storyId: String(story && story.id ? story.id : `candidate-${index + 1}`),
    title: String(story && story.title ? story.title : '').trim(),
    qualityScore: getStoryQualityScore(story),
    source: String(
      story && story.candidateSource ? story.candidateSource : ''
    ).trim(),
  }))

  if (requestedCount === 1 || candidates.length < 2) {
    const topStories =
      candidates.length > 0
        ? candidates
            .slice()
            .sort(
              (left, right) =>
                getStoryQualityScore(right) - getStoryQualityScore(left)
            )
            .slice(0, requestedCount)
        : []
    return {
      candidateQualityScores,
      pairwiseScores: [],
      selectedStories: topStories,
      selectedPair: null,
      diversityWeakness: candidates.length < 2 ? 'insufficient_candidates' : '',
    }
  }

  const pairwiseScores = []
  for (let leftIndex = 0; leftIndex < candidates.length - 1; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < candidates.length;
      rightIndex += 1
    ) {
      const leftStory = candidates[leftIndex]
      const rightStory = candidates[rightIndex]
      const leftQuality = getStoryQualityScore(leftStory)
      const rightQuality = getStoryQualityScore(rightStory)
      const averageQuality = (leftQuality + rightQuality) / 2
      const minQuality = Math.min(leftQuality, rightQuality)
      const qualityFloorPenalty = Math.max(0, 85 - minQuality) * 0.8
      const diversity = evaluateStoryDiversityPair(leftStory, rightStory)
      const diversityBonus = Math.min(10, diversity.score * 0.14)
      const finalCombinedScore =
        averageQuality - qualityFloorPenalty + diversityBonus

      pairwiseScores.push({
        leftIndex,
        rightIndex,
        pairKey: `${candidateQualityScores[leftIndex].id}+${candidateQualityScores[rightIndex].id}`,
        storyIds: [
          candidateQualityScores[leftIndex].id,
          candidateQualityScores[rightIndex].id,
        ],
        storyTitles: [
          candidateQualityScores[leftIndex].title,
          candidateQualityScores[rightIndex].title,
        ],
        qualityScores: [leftQuality, rightQuality],
        averageQuality,
        minQuality,
        qualityFloorPenalty,
        pairwiseDiversityScore: diversity.score,
        diversityBonus,
        finalCombinedScore,
        diversityDimensions: diversity.dimensions,
        diversityMetrics: diversity.metrics,
        diversityRejectionReasons: diversity.rejectionReasons,
      })
    }
  }

  pairwiseScores.sort(compareCandidates)
  const selectedPair = pairwiseScores[0] || null
  const selectedStories = selectedPair
    ? sortSelectedStories([
        candidates[selectedPair.leftIndex],
        candidates[selectedPair.rightIndex],
      ])
    : sortSelectedStories(candidates).slice(0, requestedCount)

  return {
    candidateQualityScores,
    pairwiseScores,
    selectedStories,
    selectedPair,
    diversityWeakness:
      selectedPair && selectedPair.pairwiseDiversityScore < 45
        ? 'low_diversity_pair'
        : '',
  }
}

module.exports = {
  evaluateStoryDiversityPair,
  selectStoryOptionPair,
}
