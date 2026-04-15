const path = require('path')
const fs = require('fs-extra')

const DEFAULT_INDEXER_BASE_URL = 'https://api.idena.io/api'

function trimText(value) {
  return String(value || '').trim()
}

function safeInt(value, fallback = 0) {
  const next = Number.parseInt(value, 10)
  return Number.isFinite(next) ? next : fallback
}

function safeFloat(value, fallback = 0) {
  const next = Number.parseFloat(value)
  return Number.isFinite(next) ? next : fallback
}

function normalizeRankingPolicy(value = {}) {
  const source = value && typeof value === 'object' ? value : {}
  return {
    sourcePriority: trimText(source.sourcePriority) || 'local-node-first',
    allowPublicIndexerFallback: source.allowPublicIndexerFallback !== false,
    extraFlipBaseline: Math.max(0, safeInt(source.extraFlipBaseline, 3)),
    excludeBadAuthors: source.excludeBadAuthors === true,
    excludeRepeatReportOffenders: source.excludeRepeatReportOffenders === true,
    maxRepeatReportOffenses: Math.max(
      0,
      safeInt(source.maxRepeatReportOffenses, 1)
    ),
    strongConsensusBonus: safeFloat(source.strongConsensusBonus, 0.15),
    weakConsensusPenalty: safeFloat(source.weakConsensusPenalty, 0.1),
    reportedVotePenaltyPerVote: safeFloat(
      source.reportedVotePenaltyPerVote,
      0.12
    ),
    wrongWordsVotePenaltyPerVote: safeFloat(
      source.wrongWordsVotePenaltyPerVote,
      0.2
    ),
    extraFlipPenaltyPerExtraFlip: safeFloat(
      source.extraFlipPenaltyPerExtraFlip,
      0.08
    ),
    badAuthorPenalty: safeFloat(source.badAuthorPenalty, 0.6),
    repeatReportPenalty: safeFloat(source.repeatReportPenalty, 0.45),
    qualifiedStatusBonus: safeFloat(source.qualifiedStatusBonus, 0.2),
    weaklyQualifiedStatusBonus: safeFloat(
      source.weaklyQualifiedStatusBonus,
      0.08
    ),
    reportedStatusPenalty: safeFloat(source.reportedStatusPenalty, 0.5),
    minWeight: safeFloat(source.minWeight, 0.05),
    maxWeight: safeFloat(source.maxWeight, 3),
  }
}

function normalizeConsensusLabel(value) {
  const text = trimText(value).toLowerCase()
  if (!text) return ''
  if (text === 'l' || text === 'left') return 'left'
  if (text === 'r' || text === 'right') return 'right'
  if (text === 'report' || text === 'reported') return 'reported'
  if (text === 'skip' || text === 'inappropriate') return 'skip'
  return text
}

function normalizedStatusBoost(status, policy) {
  const next = trimText(status).toLowerCase()
  if (next === 'qualified') return policy.qualifiedStatusBonus
  if (next === 'weaklyqualified') return policy.weaklyQualifiedStatusBonus
  if (next === 'reported' || next === 'notqualified') {
    return -policy.reportedStatusPenalty
  }
  return 0
}

function applyWeightingPolicy(signals, policy) {
  const next = {...signals}

  if (policy.excludeBadAuthors && next.authorBadWrongWords) {
    return {
      ...next,
      trainingWeight: 0,
      excluded: true,
      exclusionReason: 'bad_author_wrong_words',
    }
  }

  if (
    policy.excludeRepeatReportOffenders &&
    next.authorRepeatReportOffenses > policy.maxRepeatReportOffenses
  ) {
    return {
      ...next,
      trainingWeight: 0,
      excluded: true,
      exclusionReason: 'repeat_report_offender',
    }
  }

  let weight = 1
  const strength = trimText(next.consensusStrength).toLowerCase()

  if (strength === 'strong') weight += policy.strongConsensusBonus
  else if (strength === 'weak') weight -= policy.weakConsensusPenalty

  weight += normalizedStatusBoost(next.status, policy)
  weight -= next.votesReported * policy.reportedVotePenaltyPerVote
  weight -= next.wrongWordsVotes * policy.wrongWordsVotePenaltyPerVote
  weight -= next.authorExtraFlipCount * policy.extraFlipPenaltyPerExtraFlip

  if (next.authorBadWrongWords) {
    weight -= policy.badAuthorPenalty
  }

  if (next.authorRepeatReportOffenses > 0) {
    weight -= next.authorRepeatReportOffenses * policy.repeatReportPenalty
  }

  if (next.gradeScore > 0) {
    weight += Math.min(next.gradeScore / 10, 1)
  }

  return {
    ...next,
    trainingWeight: Math.max(
      policy.minWeight,
      Math.min(policy.maxWeight, Number(weight.toFixed(6)))
    ),
    excluded: false,
    exclusionReason: '',
  }
}

function buildModernSignals({
  cid,
  author,
  epoch,
  consensusLabel,
  consensusStrength,
  votesReported,
  gradeScore,
  grade,
  status,
  wrongWordsVotes,
  shortRespCount,
  longRespCount,
  withPrivatePart,
  authorBadReason,
  authorBadWrongWords,
  authorRepeatReportOffenses,
  authorExtraFlipCount,
  rankingSource,
  policy,
}) {
  return applyWeightingPolicy(
    {
      sourceKind: 'modern_epoch_capture',
      sourceName: 'idena-modern-capture',
      sourcePriority: 'local-node-first',
      rankingSource,
      cid: trimText(cid),
      author: trimText(author).toLowerCase(),
      epoch: trimText(epoch),
      consensusLabel: normalizeConsensusLabel(consensusLabel),
      consensusStrength: trimText(consensusStrength),
      votesLeft: 0,
      votesRight: 0,
      votesReported: safeInt(votesReported),
      gradeScore: safeFloat(gradeScore),
      grade: trimText(grade),
      status: trimText(status),
      wrongWordsVotes: safeInt(wrongWordsVotes),
      shortRespCount: safeInt(shortRespCount),
      longRespCount: safeInt(longRespCount),
      withPrivatePart: withPrivatePart === true,
      authorBadReason: trimText(authorBadReason),
      authorBadWrongWords: authorBadWrongWords === true,
      authorRepeatReportOffenses: safeInt(authorRepeatReportOffenses),
      authorExtraFlipCount: safeInt(authorExtraFlipCount),
      trainingWeight: 1,
      excluded: false,
      exclusionReason: '',
    },
    policy
  )
}

function normalizeWords(value) {
  const words =
    value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const word1 =
    words.word1 && typeof words.word1 === 'object' ? words.word1 : {}
  const word2 =
    words.word2 && typeof words.word2 === 'object' ? words.word2 : {}
  return {
    word1: trimText(word1.name),
    word2: trimText(word2.name),
  }
}

function needsPublicFallback(entry = {}) {
  return !trimText(entry.author) && !safeFloat(entry.gradeScore, 0)
}

function buildAuthorCounters(flips = [], extraFlipBaseline = 3) {
  const counts = new Map()
  const flagged = new Map()

  for (const item of Array.isArray(flips) ? flips : []) {
    const author = trimText(item.author).toLowerCase()
    if (author) {
      counts.set(author, (counts.get(author) || 0) + 1)

      const status = trimText(item.status).toLowerCase()
      const wrongWords = item.wrongWords === true
      const wrongWordsVotes = safeInt(item.wrongWordsVotes, 0)
      if (
        status === 'reported' ||
        status === 'notqualified' ||
        wrongWords ||
        wrongWordsVotes > 0
      ) {
        flagged.set(author, (flagged.get(author) || 0) + 1)
      }
    }
  }

  const extraFlipCounts = {}
  const repeatReportCounts = {}

  for (const [author, count] of counts.entries()) {
    extraFlipCounts[author] = Math.max(count - extraFlipBaseline, 0)
  }

  for (const [author, count] of flagged.entries()) {
    repeatReportCounts[author] = Math.max(count - 1, 0)
  }

  return {extraFlipCounts, repeatReportCounts}
}

function deriveUserDataPath(storage) {
  return path.dirname(storage.resolveLocalAiPath())
}

async function readJson(filePath, fallbackValue) {
  try {
    return await fs.readJson(filePath)
  } catch (error) {
    if (error && error.code === 'ENOENT' && arguments.length > 1) {
      return fallbackValue
    }
    throw error
  }
}

async function writeJsonAtomic(filePath, payload) {
  await fs.ensureDir(path.dirname(filePath))
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  await fs.move(tempPath, filePath, {overwrite: true})
}

function createRpcClient({fetchImpl, url, apiKey}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch_unavailable')
  }

  return {
    async call(method, ...params) {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          method,
          params,
          id: 1,
          key: apiKey,
        }),
      })

      const body = await response.json()
      if (body && body.error) {
        throw new Error(body.error.message || 'rpc_error')
      }
      return body.result
    },
  }
}

async function readSettings(userDataPath) {
  return readJson(path.join(userDataPath, 'settings.json'), {})
}

function resolveRpcUrl(settings, override) {
  const explicit = trimText(override)
  if (explicit) return explicit

  if (settings && settings.useExternalNode) {
    return trimText(settings.url) || DEFAULT_INDEXER_BASE_URL
  }

  const port = safeInt(settings && settings.internalPort, 9119)
  return `http://127.0.0.1:${port}`
}

async function resolveRpcKey(userDataPath, settings, override) {
  const explicit = trimText(override)
  if (explicit) return explicit

  if (settings && settings.useExternalNode) {
    return trimText(settings.externalApiKey)
  }

  if (trimText(settings && settings.internalApiKey)) {
    return trimText(settings.internalApiKey)
  }

  const apiKeyPath = path.join(userDataPath, 'node', 'datadir', 'api.key')
  try {
    return trimText(await fs.readFile(apiKeyPath, 'utf8'))
  } catch {
    return ''
  }
}

async function maybeFetchFlipPayload({
  rpc,
  flipHash,
  payloadPath,
  fetchFlipPayloads,
}) {
  if (await fs.pathExists(payloadPath)) {
    const cached = await readJson(payloadPath, {})
    return {
      payloadPath,
      payloadAvailable: true,
      payloadError: '',
      localNodeWords: cached.localNodeWords || {},
    }
  }

  if (!fetchFlipPayloads) {
    return {
      payloadPath: null,
      payloadAvailable: false,
      payloadError: 'flip_payload_fetch_disabled',
      localNodeWords: {},
    }
  }

  try {
    const [flipPayload, wordsPayload] = await Promise.all([
      rpc.call('flip_get', flipHash),
      rpc.call('flip_words', flipHash),
    ])
    const localNodeWords = Array.isArray(wordsPayload && wordsPayload.words)
      ? {
          word1Index: wordsPayload.words[0],
          word2Index: wordsPayload.words[1],
        }
      : {}

    const normalized = {
      hash: flipHash,
      hex: trimText(flipPayload && flipPayload.hex),
      privateHex: trimText(flipPayload && flipPayload.privateHex),
      localNodeWords,
      capturedAt: new Date().toISOString(),
    }
    await writeJsonAtomic(payloadPath, normalized)
    return {
      payloadPath,
      payloadAvailable: true,
      payloadError: '',
      localNodeWords,
    }
  } catch (error) {
    return {
      payloadPath: null,
      payloadAvailable: false,
      payloadError: error.toString(),
      localNodeWords: {},
    }
  }
}

async function buildPublicEpochSnapshot({
  fetchImpl,
  indexerBaseUrl,
  epoch,
  fallbackPath,
  forceRefresh = false,
}) {
  if (!forceRefresh && (await fs.pathExists(fallbackPath))) {
    return readJson(fallbackPath, {})
  }

  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch_unavailable')
  }

  async function getPaged(pathname) {
    let continuationToken = null
    const items = []
    do {
      const query = new URLSearchParams({limit: '100'})
      if (continuationToken) {
        query.set('continuationToken', continuationToken)
      }
      const url = `${indexerBaseUrl}${pathname}?${query.toString()}`
      const response = await fetchImpl(url, {
        method: 'GET',
        headers: {Accept: 'application/json'},
      })
      const payload = await response.json()
      const result = Array.isArray(payload.result) ? payload.result : []
      items.push(...result)
      continuationToken = trimText(payload.continuationToken) || null
    } while (continuationToken)
    return items
  }

  const [flips, authorsBad] = await Promise.all([
    getPaged(`/Epoch/${epoch}/Flips`),
    getPaged(`/Epoch/${epoch}/Authors/Bad`),
  ])

  const snapshot = {
    schemaVersion: 'idena.flip-index.v1',
    indexerType: 'public-indexer-fallback',
    epoch,
    fetchedAt: new Date().toISOString(),
    baseUrl: indexerBaseUrl,
    flips: flips
      .map((item) => ({
        cid: trimText(item.cid),
        author: trimText(item.author).toLowerCase(),
        epoch: safeInt(item.epoch, epoch),
        shortRespCount: safeInt(item.shortRespCount, 0),
        longRespCount: safeInt(item.longRespCount, 0),
        status: trimText(item.status),
        answer: trimText(item.answer),
        wrongWords: item.wrongWords === true,
        wrongWordsVotes: safeInt(item.wrongWordsVotes, 0),
        withPrivatePart: item.withPrivatePart === true,
        grade: item.grade,
        gradeScore: safeFloat(item.gradeScore, 0),
        words: normalizeWords(item.words),
      }))
      .filter((item) => item.cid),
    authorsBad: authorsBad
      .map((item) => ({
        address: trimText(item.address).toLowerCase(),
        reason: trimText(item.reason),
        wrongWords: item.wrongWords === true,
        prevState: trimText(item.prevState),
        state: trimText(item.state),
      }))
      .filter((item) => item.address),
  }

  await writeJsonAtomic(fallbackPath, snapshot)
  return snapshot
}

function createModernTrainingCollector({
  storage,
  fetchImpl = typeof fetch === 'function' ? fetch : null,
  logger,
} = {}) {
  if (!storage || typeof storage.resolveLocalAiPath !== 'function') {
    throw new Error('storage is required')
  }

  async function buildCandidatePackage({
    epoch,
    candidates,
    rankingPolicy,
    allowPublicIndexerFallback,
    fetchFlipPayloads = false,
    requireFlipPayloads = false,
    rpcUrl,
    rpcKey,
    refreshPublicFallback = false,
  } = {}) {
    const activePolicy = normalizeRankingPolicy(rankingPolicy)
    const fallbackEnabled =
      typeof allowPublicIndexerFallback === 'boolean'
        ? allowPublicIndexerFallback
        : activePolicy.allowPublicIndexerFallback

    const userDataPath = deriveUserDataPath(storage)
    const settings = await readSettings(userDataPath)
    const localIndexPath = storage.resolveLocalAiPath(
      'indexer',
      'epochs',
      `epoch-${epoch}.json`
    )
    const fallbackIndexPath = storage.resolveLocalAiPath(
      'indexer-fallback',
      'epochs',
      `epoch-${epoch}.json`
    )
    const modernPayloadDir = storage.resolveLocalAiPath(
      'modern-payloads',
      `epoch-${epoch}`
    )

    const resolvedRpcUrl = resolveRpcUrl(settings, rpcUrl)
    const resolvedRpcKey = await resolveRpcKey(userDataPath, settings, rpcKey)
    const rpc = createRpcClient({
      fetchImpl,
      url: resolvedRpcUrl,
      apiKey: resolvedRpcKey,
    })

    await fs.ensureDir(modernPayloadDir)

    const localEntries = []
    for (const candidate of Array.isArray(candidates) ? candidates : []) {
      const capture = candidate.capture || {}
      const flipHash = trimText(capture.flipHash)
      const payloadState = await maybeFetchFlipPayload({
        rpc,
        flipHash,
        payloadPath: path.join(modernPayloadDir, `${flipHash}.json`),
        fetchFlipPayloads,
      })
      localEntries.push({
        cid: flipHash,
        author: trimText(capture.author).toLowerCase(),
        epoch,
        sessionType: capture.sessionType,
        panelCount: capture.panelCount,
        timestamp: capture.timestamp,
        capturedAt: capture.capturedAt,
        consensus: capture.consensus || {},
        orders: Array.isArray(capture.orders) ? capture.orders : [],
        words: Array.isArray(capture.words) ? capture.words : [],
        selectedOrder: trimText(capture.selectedOrder).toLowerCase() || null,
        relevance: trimText(capture.relevance).toLowerCase() || null,
        best: capture.best === true,
        payloadPath: payloadState.payloadPath,
        payloadAvailable: payloadState.payloadAvailable,
        payloadError: payloadState.payloadError,
        localNodeWords: payloadState.localNodeWords,
      })
    }

    const localSnapshot = {
      schemaVersion: 'idena.flip-index.v1',
      indexerType: 'local-node-indexer',
      epoch,
      generatedAt: new Date().toISOString(),
      sourcePriority: activePolicy.sourcePriority,
      flipCount: localEntries.length,
      flips: localEntries,
    }
    await writeJsonAtomic(localIndexPath, localSnapshot)

    let publicSnapshot = null
    let publicFlipsByCid = {}
    let badAuthorsByAddress = {}
    let extraFlipCounts = {}
    let repeatReportCounts = {}

    const shouldAttemptFallback =
      fallbackEnabled &&
      localEntries.some((entry) => needsPublicFallback(entry))

    if (shouldAttemptFallback) {
      publicSnapshot = await buildPublicEpochSnapshot({
        fetchImpl,
        indexerBaseUrl: DEFAULT_INDEXER_BASE_URL,
        epoch,
        fallbackPath: fallbackIndexPath,
        forceRefresh: refreshPublicFallback,
      })
      publicFlipsByCid = Object.fromEntries(
        (publicSnapshot.flips || []).map((item) => [item.cid, item])
      )
      badAuthorsByAddress = Object.fromEntries(
        (publicSnapshot.authorsBad || []).map((item) => [item.address, item])
      )
      const counters = buildAuthorCounters(
        publicSnapshot.flips || [],
        activePolicy.extraFlipBaseline
      )
      extraFlipCounts = counters.extraFlipCounts
      repeatReportCounts = counters.repeatReportCounts
    }

    const items = []
    const excluded = []

    for (const candidate of Array.isArray(candidates) ? candidates : []) {
      const baseItem = candidate.item || {}
      const capture = candidate.capture || {}
      const localEntry = localEntries.find(
        ({cid}) => cid === capture.flipHash
      ) || {
        payloadAvailable: false,
      }
      const publicEntry = publicFlipsByCid[capture.flipHash]
      const author = trimText(
        (publicEntry && publicEntry.author) || localEntry.author
      ).toLowerCase()
      const badAuthor = badAuthorsByAddress[author] || {}
      const signals = buildModernSignals({
        cid: capture.flipHash,
        author,
        epoch,
        consensusLabel:
          (capture.consensus && capture.consensus.finalAnswer) ||
          (capture.consensus && capture.consensus.reported ? 'reported' : ''),
        consensusStrength: capture.consensus && capture.consensus.strength,
        votesReported: (publicEntry && publicEntry.wrongWordsVotes) || 0,
        gradeScore: publicEntry && publicEntry.gradeScore,
        grade: publicEntry && publicEntry.grade,
        status: publicEntry && publicEntry.status,
        wrongWordsVotes: publicEntry && publicEntry.wrongWordsVotes,
        shortRespCount: publicEntry && publicEntry.shortRespCount,
        longRespCount: publicEntry && publicEntry.longRespCount,
        withPrivatePart: publicEntry && publicEntry.withPrivatePart,
        authorBadReason: badAuthor.reason,
        authorBadWrongWords:
          badAuthor.wrongWords === true ||
          trimText(badAuthor.reason) === 'WrongWords',
        authorRepeatReportOffenses: repeatReportCounts[author] || 0,
        authorExtraFlipCount: extraFlipCounts[author] || 0,
        rankingSource: publicEntry
          ? 'public_indexer_fallback'
          : 'local_node_indexer',
        policy: activePolicy,
      })

      const reasons = []
      if (requireFlipPayloads && !localEntry.payloadAvailable) {
        reasons.push('missing_flip_payload')
      }
      if (signals.excluded) {
        reasons.push(signals.exclusionReason)
      }

      if (reasons.length) {
        excluded.push({
          flipHash: capture.flipHash || null,
          reasons: Array.from(new Set(reasons.filter(Boolean))),
          audit: signals,
        })
      } else {
        items.push({
          ...baseItem,
          source: {
            kind: signals.sourceKind,
            name: signals.sourceName,
            priority: signals.sourcePriority,
          },
          rankingSource: signals.rankingSource,
          trainingWeight: signals.trainingWeight,
          payloadPath: localEntry.payloadPath || null,
          words: {
            localNode: localEntry.localNodeWords || {},
            publicIndexer: publicEntry ? publicEntry.words || {} : {},
          },
          audit: signals,
        })
      }
    }

    if (logger && typeof logger.debug === 'function') {
      logger.debug('Built modern Local AI training candidates', {
        epoch,
        localCount: localEntries.length,
        eligibleCount: items.length,
        excludedCount: excluded.length,
        fallbackUsed: Boolean(publicSnapshot),
      })
    }

    return {
      items,
      excluded,
      sourcePriority: activePolicy.sourcePriority,
      rankingPolicy: activePolicy,
      localIndexPath,
      fallbackIndexPath: publicSnapshot ? fallbackIndexPath : null,
      fallbackUsed: Boolean(publicSnapshot),
    }
  }

  return {buildCandidatePackage}
}

module.exports = {
  createModernTrainingCollector,
}
