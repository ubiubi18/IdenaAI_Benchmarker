const {STORY_PANEL_ROLES} = require('./storySchema')

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'by',
  'for',
  'from',
  'in',
  'into',
  'is',
  'it',
  'of',
  'on',
  'or',
  'the',
  'their',
  'then',
  'to',
  'with',
])

const ABSTRACT_PATTERNS = [
  /\binteracts with\b/i,
  /\buses?(?: [a-z]+){0,4} as a tool\b/i,
  /\bobserves?(?: the)?(?: final)? result\b/i,
  /\bnotices?(?: the)? result\b/i,
  /\breacts somehow\b/i,
  /\bsomething changes\b/i,
  /\bsomething happens\b/i,
  /\bthe action continues\b/i,
  /\bthe story continues\b/i,
  /\ba visible change occurs\b/i,
  /\ba clear change occurs\b/i,
  /\bcontinues the same scene\b/i,
]

const GENERIC_WORDING_PATTERNS = [
  /\bclearly visible\b/i,
  /\bin the same scene\b/i,
  /\bin a stable everyday setting\b/i,
  /\bvisible consequence\b/i,
  /\bvisible state change\b/i,
  /\bthe situation changes\b/i,
  /\bthe scene changes\b/i,
  /\bfinal result\b/i,
]

const GENERIC_STATE_CHANGE_PATTERNS = [
  /\bn\/a\b/i,
  /\bclear visible change from previous panel\b/i,
  /\bvisible change from previous panel\b/i,
  /\bwhat changed visibly\b/i,
  /\bsomething changes\b/i,
  /\bthe situation changes\b/i,
]

const CONCRETE_ACTION_PATTERNS = [
  /\bappears?\b/i,
  /\barrives?\b/i,
  /\bbacks? away\b/i,
  /\bbreaks?\b/i,
  /\bbumps?\b/i,
  /\bcarries?\b/i,
  /\bcatches?\b/i,
  /\bchases?\b/i,
  /\bchecks?\b/i,
  /\bcloses?\b/i,
  /\bcollides?\b/i,
  /\bcovers?\b/i,
  /\bcarves?\b/i,
  /\bcracks?\b/i,
  /\bcuts?\b/i,
  /\bdrops?\b/i,
  /\benters?\b/i,
  /\bextinguishes?\b/i,
  /\bfalls?\b/i,
  /\bfreezes?\b/i,
  /\bgrabs?\b/i,
  /\bhides?\b/i,
  /\bhits?\b/i,
  /\bignites?\b/i,
  /\bjolts?\b/i,
  /\bknocks?\b/i,
  /\blands?\b/i,
  /\blifts?\b/i,
  /\bmoves?\b/i,
  /\bopens?\b/i,
  /\bplaces?\b/i,
  /\bpicks? up\b/i,
  /\bpositions?\b/i,
  /\bpours?\b/i,
  /\bputs?\b/i,
  /\bpulls?\b/i,
  /\bpushes?\b/i,
  /\bruns?\b/i,
  /\bsaws?\b/i,
  /\bscatters?\b/i,
  /\bslides?\b/i,
  /\bspills?\b/i,
  /\bspreads?\b/i,
  /\bstarts?\b/i,
  /\bstartles?\b/i,
  /\bsteps? back\b/i,
  /\bsweeps?\b/i,
  /\btears?\b/i,
  /\bthrows?\b/i,
  /\btopples?\b/i,
  /\bturns?\b/i,
  /\buncovers?\b/i,
  /\bunlocks?\b/i,
  /\bwalks?\b/i,
  /\bwaves?\b/i,
  /\bwrites?\b/i,
  /\bshapes?\b/i,
  /\bsets? down\b/i,
  /\bpresents?\b/i,
  /\bshows?\b/i,
  /\btakes? form\b/i,
]

const EXTERNAL_CHANGE_PATTERNS = [
  /\bappears?\b/i,
  /\bbreaks?\b/i,
  /\bcarves?\b/i,
  /\bchips scatter\b/i,
  /\bcracks?\b/i,
  /\bcutting\b/i,
  /\bdrops?\b/i,
  /\bfalls?\b/i,
  /\bfinished\b/i,
  /\bhits? the floor\b/i,
  /\bignites?\b/i,
  /\bknocks? over\b/i,
  /\blands?\b/i,
  /\blifts?\b/i,
  /\bpicks? up\b/i,
  /\bpresents?\b/i,
  /\bputs?\b/i,
  /\bscatter(?:s|ed)?\b/i,
  /\bspills?\b/i,
  /\bspreads?\b/i,
  /\bstarts?\b/i,
  /\bshatters?\b/i,
  /\bshapes?\b/i,
  /\bslides?\b/i,
  /\btakes? form\b/i,
  /\btopples?\b/i,
  /\bwet floor\b/i,
  /\bbroken\b/i,
  /\bscattered\b/i,
]

const REACTION_PATTERNS = [
  /\bbacks? away\b/i,
  /\bcovers? face\b/i,
  /\bducks?\b/i,
  /\bfreezes?\b/i,
  /\bgrabs?\b/i,
  /\bgasps?\b/i,
  /\bjolts?\b/i,
  /\blooks? back\b/i,
  /\bruns?\b/i,
  /\bstartles?\b/i,
  /\bsteps? back\b/i,
  /\bturns? sharply\b/i,
]

const RESULT_STATE_PATTERNS = [
  /\bafterward\b/i,
  /\bends? with\b/i,
  /\bfinished\b/i,
  /\bfinally\b/i,
  /\bholds?\b/i,
  /\blies?\b/i,
  /\bnow\b/i,
  /\bplaces?\b/i,
  /\bcloses?\b/i,
  /\bremains?\b/i,
  /\brests?\b/i,
  /\bsafe\b/i,
  /\bsettles?\b/i,
  /\bspilled\b/i,
  /\bstands?\b/i,
  /\bstays?\b/i,
  /\bputs?\b/i,
  /\bshows?\b/i,
  /\bstored\b/i,
  /\bfinished\b/i,
  /\bcompleted\b/i,
]

const EMOTION_PATTERNS = [
  /\bafraid\b/i,
  /\bangry\b/i,
  /\bfear\b/i,
  /\bpanic\b/i,
  /\brelieved\b/i,
  /\bscared\b/i,
  /\bshock\b/i,
  /\bshocked\b/i,
  /\bstartled\b/i,
  /\bsurprised\b/i,
  /\bworried\b/i,
]

function normalizeText(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function toPanelDetails(story) {
  const item = story && typeof story === 'object' ? story : {}
  let source = []
  if (Array.isArray(item.panelDetails)) {
    source = item.panelDetails.slice(0, 4)
  } else if (Array.isArray(item.panels)) {
    source = item.panels.slice(0, 4).map((description, index) => ({
      panel: index + 1,
      role: STORY_PANEL_ROLES[index] || `panel_${index + 1}`,
      description,
      stateChangeFromPrevious: index === 0 ? 'n/a' : '',
      requiredVisibles: [],
    }))
  }

  while (source.length < 4) {
    const index = source.length
    source.push({
      panel: index + 1,
      role: STORY_PANEL_ROLES[index] || `panel_${index + 1}`,
      description: '',
      stateChangeFromPrevious: index === 0 ? 'n/a' : '',
      requiredVisibles: [],
    })
  }

  return source.map((panel, index) => ({
    panel: index + 1,
    role:
      normalizeText(panel.role || STORY_PANEL_ROLES[index]) ||
      STORY_PANEL_ROLES[index],
    description: normalizeText(panel.description || panel.text),
    stateChangeFromPrevious: normalizeText(
      panel.stateChangeFromPrevious || panel.state_change_from_previous
    ),
    requiredVisibles: Array.isArray(
      panel.requiredVisibles || panel.required_visibles
    )
      ? (panel.requiredVisibles || panel.required_visibles)
          .map((entry) => normalizeText(entry))
          .filter(Boolean)
      : [],
  }))
}

function getMatchedLabels(text, patterns) {
  return patterns
    .filter((pattern) => pattern.test(text))
    .map((pattern) =>
      String(pattern)
        .replace(/^\/\\b?/, '')
        .replace(/\\b\/i$/, '')
        .replace(/^\//, '')
        .replace(/\/i$/, '')
    )
}

function countPatternMatches(text, patterns) {
  return getMatchedLabels(text, patterns).length
}

function buildDescriptionPatternStats(text) {
  const description = normalizeText(text)
  const abstractHits = getMatchedLabels(description, ABSTRACT_PATTERNS)
  const genericHits = getMatchedLabels(description, GENERIC_WORDING_PATTERNS)
  const concreteActionCount = countPatternMatches(
    description,
    CONCRETE_ACTION_PATTERNS
  )
  const externalChangeFromDescription =
    countPatternMatches(description, EXTERNAL_CHANGE_PATTERNS) > 0
  const reactionCount = countPatternMatches(description, REACTION_PATTERNS)
  const emotionCount = countPatternMatches(description, EMOTION_PATTERNS)
  const resultCount = countPatternMatches(description, RESULT_STATE_PATTERNS)

  return {
    description,
    abstractHits,
    genericHits,
    concreteActionCount,
    externalChangeFromDescription,
    reactionCount,
    emotionCount,
    resultCount,
  }
}

function isGenericStateChange(text) {
  const value = normalizeText(text)
  if (!value) return false
  return GENERIC_STATE_CHANGE_PATTERNS.some((pattern) => pattern.test(value))
}

function tokenize(text) {
  return normalizeText(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token && !STOPWORDS.has(token))
}

function tokenizeToSet(text) {
  return new Set(tokenize(text))
}

function jaccardSimilarityFromSets(leftTokens, rightTokens) {
  if (leftTokens.size < 1 || rightTokens.size < 1) return 0

  let intersection = 0
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) {
      intersection += 1
    }
  })

  const union = new Set([...leftTokens, ...rightTokens]).size
  return union > 0 ? intersection / union : 0
}

function hasTriggerEventSignal(panelCheck) {
  return (
    Boolean(panelCheck && panelCheck.concreteActionCount > 0) ||
    Boolean(panelCheck && panelCheck.externalChange)
  )
}

function hasReactionSignal(panelCheck) {
  return (
    Boolean(panelCheck && panelCheck.reactionCount > 0) ||
    Boolean(panelCheck && panelCheck.emotionCount > 0) ||
    Boolean(panelCheck && panelCheck.concreteActionCount > 0) ||
    Boolean(panelCheck && panelCheck.externalChange)
  )
}

function hasResultSignal(panelCheck) {
  return (
    Boolean(panelCheck && panelCheck.resultCount > 0) ||
    Boolean(panelCheck && panelCheck.externalChange)
  )
}

function buildPanelChecks(panelDetails) {
  return panelDetails.map((panel, index) => {
    const patternStats = buildDescriptionPatternStats(panel.description)
    const stateChangeFromPrevious = normalizeText(panel.stateChangeFromPrevious)
    const genericStateChange =
      index === 0 ? false : isGenericStateChange(stateChangeFromPrevious)

    return {
      panel: index + 1,
      role: panel.role,
      description: patternStats.description,
      abstractHits: patternStats.abstractHits,
      genericHits: patternStats.genericHits,
      concreteActionCount: patternStats.concreteActionCount,
      reactionCount: patternStats.reactionCount,
      emotionCount: patternStats.emotionCount,
      resultCount: patternStats.resultCount,
      descriptionTokens: tokenizeToSet(patternStats.description),
      externalChange:
        index === 0
          ? false
          : Boolean(
              patternStats.externalChangeFromDescription ||
                (stateChangeFromPrevious && !genericStateChange)
            ),
      genericStateChange,
    }
  })
}

function evaluateStoryQuality(story) {
  const panelDetails = toPanelDetails(story)
  const panelChecks = buildPanelChecks(panelDetails)
  const consecutiveSimilarities = []
  const nearDuplicatePairs = []

  for (let index = 0; index < panelChecks.length - 1; index += 1) {
    const similarity = jaccardSimilarityFromSets(
      panelChecks[index].descriptionTokens,
      panelChecks[index + 1].descriptionTokens
    )
    const roundedSimilarity = Number(similarity.toFixed(2))
    consecutiveSimilarities.push(roundedSimilarity)
    if (roundedSimilarity >= 0.65) {
      nearDuplicatePairs.push({
        leftPanel: index + 1,
        rightPanel: index + 2,
        similarity: roundedSimilarity,
      })
    }
  }

  const abstractHits = panelChecks.reduce(
    (acc, panel) => acc.concat(panel.abstractHits),
    []
  )
  const genericPhraseHits = panelChecks.reduce(
    (acc, panel) => acc.concat(panel.genericHits),
    []
  )
  const concreteActionCount = panelChecks.reduce(
    (acc, panel) => acc + panel.concreteActionCount,
    0
  )
  const externalChangeCount = panelChecks.filter(
    (panel) => panel.externalChange
  ).length
  const weakStateChangeCount = panelChecks
    .slice(1)
    .filter((panel) => panel.genericStateChange).length

  const hasInitialState =
    panelChecks[0].description.length >= 18 &&
    panelChecks[0].abstractHits.length < 1
  const hasTriggerEvent = hasTriggerEventSignal(panelChecks[1])
  const hasReaction = hasReactionSignal(panelChecks[2])
  const hasResultState = hasResultSignal(panelChecks[3])

  const emotionalPanelIndexes = panelChecks
    .map((panel, index) => (panel.emotionCount > 0 ? index : -1))
    .filter((index) => index >= 0)

  const emotionalWithoutVisibleConsequence = emotionalPanelIndexes.some(
    (panelIndex) => {
      const relatedChecks = panelChecks.slice(
        panelIndex,
        Math.min(panelChecks.length, panelIndex + 2)
      )
      return !relatedChecks.some((panel) => panel.externalChange)
    }
  )

  const lowConcretenessFail =
    abstractHits.length > 0 ||
    genericPhraseHits.length >= 2 ||
    (concreteActionCount < 2 && externalChangeCount < 2)

  const weakProgressionFail =
    externalChangeCount < 2 ||
    nearDuplicatePairs.length > 0 ||
    weakStateChangeCount >= 2 ||
    !hasTriggerEvent ||
    !hasResultState

  const failures = []
  if (!hasInitialState) failures.push('missing_initial_state')
  if (!hasTriggerEvent) failures.push('missing_trigger_event')
  if (!hasReaction) failures.push('missing_reaction')
  if (!hasResultState) failures.push('missing_result_state')
  if (emotionalWithoutVisibleConsequence) {
    failures.push('emotional_no_visible_consequence')
  }
  if (lowConcretenessFail) failures.push('low_concreteness')
  if (weakProgressionFail) failures.push('weak_progression')
  if (nearDuplicatePairs.length > 0) failures.push('near_duplicate_panels')

  const score = clampScore(
    74 +
      concreteActionCount * 6 +
      externalChangeCount * 8 -
      abstractHits.length * 18 -
      genericPhraseHits.length * 10 -
      weakStateChangeCount * 6 -
      nearDuplicatePairs.length * 22 -
      (emotionalWithoutVisibleConsequence ? 16 : 0) -
      (hasInitialState ? 0 : 10) -
      (hasTriggerEvent ? 0 : 12) -
      (hasReaction ? 0 : 10) -
      (hasResultState ? 0 : 12)
  )

  return {
    ok: failures.length < 1 && score >= 60,
    score,
    failures: Array.from(new Set(failures)),
    panelChecks: panelChecks.map(({descriptionTokens, ...panel}) => panel),
    metrics: {
      hasInitialState,
      hasTriggerEvent,
      hasReaction,
      hasResultState,
      externalChangeCount,
      concreteActionCount,
      abstractHitCount: abstractHits.length,
      genericPhraseCount: genericPhraseHits.length,
      weakStateChangeCount,
      maxConsecutiveSimilarity:
        consecutiveSimilarities.length > 0
          ? Math.max(...consecutiveSimilarities)
          : 0,
      nearDuplicatePairs,
      emotionalWithoutVisibleConsequence,
      lowConcretenessFail,
      weakProgressionFail,
    },
  }
}

module.exports = {
  evaluateStoryQuality,
}
