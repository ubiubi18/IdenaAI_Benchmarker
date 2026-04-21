import {State} from 'xstate'
import dayjs, {isDayjs} from 'dayjs'
import {
  persistItem,
  persistState,
  loadPersistentState,
  loadPersistentStateValue,
} from '../../shared/utils/persist'
import {EpochPeriod, IdentityStatus} from '../../shared/types'
import {getIdentityPublishedFlipsCount} from '../../shared/utils/identity'

export const readyFlip = ({ready}) => ready
export const VALIDATION_NODE_STABILITY_GRACE_MS = 20 * 1000
export const SHORT_SESSION_AUTO_SUBMIT_BUFFER_SECONDS = 10
export const LONG_SESSION_AUTO_SUBMIT_BUFFER_SECONDS = 15
export const AUTO_REPORT_REVIEW_RUNTIME_BUFFER_MS = 20 * 1000

const VALIDATION_SESSION_STORAGE_KEY = 'idena-validation-session'
const VALIDATION_SESSION_PERSIST_KEY = 'liveValidationSession'
const VALIDATION_STATE_SNAPSHOT_KEY = 'validationStateSnapshot'
const VALIDATION_STATE_META_KEY = 'validationStateMeta'

let runtimeValidationSession = null

function normalizeValidationStateMeta(value) {
  if (!value || typeof value !== 'object') {
    return null
  }

  const epoch = Number(value.epoch)
  const address = String(value.address || '')
    .trim()
    .toLowerCase()
  const nodeScope = String(value.nodeScope || '')
    .trim()
    .toLowerCase()
  const validationStart = Number(value.validationStart)

  if (
    !Number.isFinite(epoch) ||
    !nodeScope ||
    !Number.isFinite(validationStart)
  ) {
    return null
  }

  return {
    epoch: Math.trunc(epoch),
    address,
    nodeScope,
    validationStart,
  }
}

function normalizeValidationIdentityScope(value) {
  if (!value || typeof value !== 'object') {
    return null
  }

  const address = String(value.address || '')
    .trim()
    .toLowerCase()
  const nodeScope = String(value.nodeScope || '')
    .trim()
    .toLowerCase()

  if (!nodeScope) {
    return null
  }

  return {
    address,
    nodeScope,
  }
}

export function buildValidationStateScope({
  epoch,
  address,
  nodeScope,
  validationStart,
} = {}) {
  return normalizeValidationStateMeta({
    epoch,
    address,
    nodeScope,
    validationStart,
  })
}

export function buildValidationIdentityScope({address, nodeScope} = {}) {
  return normalizeValidationIdentityScope({address, nodeScope})
}

function matchesValidationStateScope(meta, scope) {
  const normalizedMeta = normalizeValidationStateMeta(meta)
  const normalizedScope = normalizeValidationStateMeta(scope)

  if (!normalizedScope) {
    return true
  }

  if (!normalizedMeta) {
    return false
  }

  return (
    normalizedMeta.epoch === normalizedScope.epoch &&
    normalizedMeta.nodeScope === normalizedScope.nodeScope &&
    normalizedMeta.validationStart === normalizedScope.validationStart &&
    (!normalizedScope.address ||
      normalizedMeta.address === normalizedScope.address)
  )
}

function matchesValidationStateIdentityScope(meta, scope) {
  const normalizedMeta = normalizeValidationStateMeta(meta)
  const normalizedScope = normalizeValidationIdentityScope(scope)

  if (!normalizedScope) {
    return true
  }

  if (!normalizedMeta) {
    return false
  }

  return (
    normalizedMeta.nodeScope === normalizedScope.nodeScope &&
    (!normalizedScope.address ||
      normalizedMeta.address === normalizedScope.address)
  )
}

function getStoredValidationStatePayload() {
  const persistedState = loadPersistentState('validation2')

  if (!persistedState || typeof persistedState !== 'object') {
    return {
      liveValidationSession: null,
      meta: null,
      snapshot: null,
    }
  }

  const normalizedLiveValidationSession = normalizeStoredValidationSession(
    persistedState[VALIDATION_SESSION_PERSIST_KEY]
  )

  if (
    normalizedLiveValidationSession &&
    Object.keys(persistedState).every(
      (key) => key === VALIDATION_SESSION_PERSIST_KEY
    )
  ) {
    return {
      liveValidationSession: normalizedLiveValidationSession,
      meta: null,
      snapshot: null,
    }
  }

  if (persistedState[VALIDATION_STATE_SNAPSHOT_KEY]) {
    return {
      liveValidationSession: normalizedLiveValidationSession,
      meta: normalizeValidationStateMeta(
        persistedState[VALIDATION_STATE_META_KEY]
      ),
      snapshot: persistedState[VALIDATION_STATE_SNAPSHOT_KEY] || null,
    }
  }

  return {
    liveValidationSession: normalizedLiveValidationSession,
    meta: null,
    snapshot: persistedState,
  }
}

export function buildValidationSessionNodeScope({
  runInternalNode = false,
  useExternalNode = false,
  url = '',
  internalPort,
} = {}) {
  if (runInternalNode && !useExternalNode) {
    return `internal:${String(internalPort || 'default').trim()}`
  }

  return `external:${
    String(url || '')
      .trim()
      .toLowerCase() || 'default'
  }`
}

export function getValidationSessionPhaseDeadlineAt({
  validationStart,
  shortSessionDuration,
  longSessionDuration = 0,
  sessionType = 'short',
} = {}) {
  const startedAt = Number(validationStart)
  const shortSeconds = Number(shortSessionDuration)
  const longSeconds = Number(longSessionDuration)

  if (!Number.isFinite(startedAt) || !Number.isFinite(shortSeconds)) {
    return null
  }

  if (sessionType === 'long') {
    return (
      startedAt +
      Math.max(
        0,
        shortSeconds +
          (Number.isFinite(longSeconds) ? longSeconds : 0) -
          LONG_SESSION_AUTO_SUBMIT_BUFFER_SECONDS
      ) *
        1000
    )
  }

  return (
    startedAt +
    Math.max(0, shortSeconds - SHORT_SESSION_AUTO_SUBMIT_BUFFER_SECONDS) * 1000
  )
}

export function getValidationSessionPhaseRemainingMs({
  validationStart,
  shortSessionDuration,
  longSessionDuration = 0,
  sessionType = 'short',
  now = Date.now(),
} = {}) {
  const deadlineAt = getValidationSessionPhaseDeadlineAt({
    validationStart,
    shortSessionDuration,
    longSessionDuration,
    sessionType,
  })

  if (!Number.isFinite(deadlineAt)) {
    return null
  }

  return deadlineAt - Number(now)
}

export function getValidationAutoReportDelayMs({
  validationStart,
  shortSessionDuration,
  longSessionDuration,
  requestedDelayMinutes,
  now = Date.now(),
} = {}) {
  const requestedDelayMs =
    Math.max(1, Number(requestedDelayMinutes) || 0) * 60 * 1000
  const remainingLongSolveMs = getValidationSessionPhaseRemainingMs({
    validationStart,
    shortSessionDuration,
    longSessionDuration,
    sessionType: 'long',
    now,
  })

  if (!Number.isFinite(remainingLongSolveMs)) {
    return null
  }

  const latestSafeReviewStartMs =
    remainingLongSolveMs - AUTO_REPORT_REVIEW_RUNTIME_BUFFER_MS

  if (latestSafeReviewStartMs <= 0) {
    return 0
  }

  return Math.min(requestedDelayMs, latestSafeReviewStartMs)
}

export function buildValidationSessionScopeKey({
  epoch,
  address,
  nodeScope,
  validationStart = null,
} = {}) {
  const nextEpoch = String(epoch ?? '').trim()
  const nextAddress = String(address || '')
    .trim()
    .toLowerCase()
  const nextNodeScope = String(nodeScope || '')
    .trim()
    .toLowerCase()
  const hasValidationStart =
    validationStart !== null &&
    validationStart !== undefined &&
    validationStart !== ''
  const nextValidationStart = hasValidationStart ? Number(validationStart) : NaN

  if (!nextEpoch || !nextAddress || !nextNodeScope) {
    return ''
  }

  return Number.isFinite(nextValidationStart)
    ? `${nextEpoch}:${nextAddress}:${nextNodeScope}:${Math.round(
        nextValidationStart
      )}`
    : `${nextEpoch}:${nextAddress}:${nextNodeScope}`
}

function matchesStoredValidationSessionScope(sessionScopeKey, scope = {}) {
  const fullScopeKey = buildValidationSessionScopeKey(scope)

  if (!sessionScopeKey || !fullScopeKey) {
    return false
  }

  if (sessionScopeKey === fullScopeKey) {
    return true
  }

  const legacyIdentityScopeKey = buildValidationSessionScopeKey({
    epoch: scope.epoch,
    address: scope.address,
    nodeScope: scope.nodeScope,
  })

  return Boolean(
    legacyIdentityScopeKey &&
      sessionScopeKey === legacyIdentityScopeKey &&
      fullScopeKey.startsWith(`${legacyIdentityScopeKey}:`)
  )
}

function normalizeStoredValidationSession(value) {
  if (value && typeof value === 'object' && value.scopeKey && value.sessionId) {
    return {
      scopeKey: String(value.scopeKey),
      sessionId: String(value.sessionId),
    }
  }

  return null
}

function dropStoredValidationSession() {
  runtimeValidationSession = null

  if (typeof window === 'undefined') {
    return
  }

  try {
    if (window.__idenaValidationSession) {
      delete window.__idenaValidationSession
    }

    if (window.sessionStorage) {
      window.sessionStorage.removeItem(VALIDATION_SESSION_STORAGE_KEY)
    }
  } catch {
    // ignore storage cleanup failures
  }
}

function persistValidationPayload({
  liveValidationSession = null,
  meta = null,
  snapshot = null,
} = {}) {
  const nextPayload = {}

  if (liveValidationSession) {
    nextPayload[VALIDATION_SESSION_PERSIST_KEY] = liveValidationSession
  }

  if (snapshot) {
    if (meta) {
      nextPayload[VALIDATION_STATE_META_KEY] = meta
    }
    nextPayload[VALIDATION_STATE_SNAPSHOT_KEY] = snapshot
  }

  persistState(
    'validation2',
    Object.keys(nextPayload).length ? nextPayload : null
  )
}

function readStoredValidationSession(scopeKey = '') {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const scope = window
    const globalValue = normalizeStoredValidationSession(
      scope && scope.__idenaValidationSession
    )

    if (globalValue && (!scopeKey || globalValue.scopeKey === scopeKey)) {
      return globalValue
    }

    const persistedValue = normalizeStoredValidationSession(
      loadPersistentStateValue('validation2', VALIDATION_SESSION_PERSIST_KEY)
    )

    if (persistedValue && (!scopeKey || persistedValue.scopeKey === scopeKey)) {
      return persistedValue
    }

    const storageValue = window.sessionStorage
      ? window.sessionStorage.getItem(VALIDATION_SESSION_STORAGE_KEY)
      : null

    if (!storageValue) {
      return null
    }

    const parsedValue = normalizeStoredValidationSession(
      JSON.parse(storageValue)
    )

    if (parsedValue && (!scopeKey || parsedValue.scopeKey === scopeKey)) {
      return parsedValue
    }
  } catch {
    return null
  }

  return null
}

function persistValidationSession(session) {
  runtimeValidationSession = session

  if (typeof window === 'undefined') {
    return session
  }

  try {
    const scope = window

    if (scope) {
      scope.__idenaValidationSession = session
    }

    if (window.sessionStorage) {
      window.sessionStorage.setItem(
        VALIDATION_SESSION_STORAGE_KEY,
        JSON.stringify(session)
      )
    }

    persistItem('validation2', VALIDATION_SESSION_PERSIST_KEY, session)
  } catch {
    return session
  }

  return session
}

export function rememberValidationSessionId(scope, sessionId) {
  const {epoch, address, nodeScope, validationStart} = scope || {}
  const scopeKey = buildValidationSessionScopeKey({
    epoch,
    address,
    nodeScope,
    validationStart,
  })
  const normalizedSessionId = String(sessionId || '').trim()

  if (!scopeKey || !normalizedSessionId) {
    return ''
  }

  persistValidationSession({
    scopeKey,
    sessionId: normalizedSessionId,
  })

  return normalizedSessionId
}

export function getCurrentValidationSessionId({
  epoch,
  address,
  nodeScope,
  validationStart = null,
} = {}) {
  const scopeKey = buildValidationSessionScopeKey({
    epoch,
    address,
    nodeScope,
    validationStart,
  })

  if (!scopeKey) {
    return ''
  }

  if (
    runtimeValidationSession &&
    runtimeValidationSession.scopeKey === scopeKey &&
    runtimeValidationSession.sessionId
  ) {
    return runtimeValidationSession.sessionId
  }

  if (typeof window === 'undefined') {
    return ''
  }

  try {
    const storedSession = readStoredValidationSession()

    if (storedSession) {
      if (
        matchesStoredValidationSessionScope(storedSession.scopeKey, {
          epoch,
          address,
          nodeScope,
          validationStart,
        })
      ) {
        runtimeValidationSession = storedSession
        return storedSession.sessionId
      }

      const persistedPayload = getStoredValidationStatePayload()
      dropStoredValidationSession()
      persistValidationPayload({
        meta: persistedPayload.meta,
        snapshot: persistedPayload.snapshot,
      })
    }
  } catch {
    return ''
  }

  return ''
}

export function __resetValidationSessionStateForTests({
  clearStorage = true,
} = {}) {
  dropStoredValidationSession()

  if (typeof window === 'undefined') {
    return
  }

  try {
    if (clearStorage) {
      persistState('validation2', null)
    }
  } catch {
    // ignore test cleanup failures
  }
}

export function resetValidationSessionState() {
  dropStoredValidationSession()

  if (typeof window === 'undefined') {
    return
  }

  try {
    persistState('validation2', null)
  } catch {
    // ignore runtime cleanup failures
  }
}

/**
 * Ready to be fetched flips, including extra
 * @param {*} flips
 */
export function filterReadyFlips(flips) {
  return flips.filter(readyFlip)
}

/**
 * All regular, not extra, flips regardless of it readiness
 * @param {*} flips
 */
export function filterRegularFlips(flips) {
  return flips.filter(({extra}) => !extra)
}

export const readyNotFetchedFlip = ({ready, fetched}) => ready && !fetched

export const solvableFlips = ({decoded}) => decoded

export function isRenderableValidationFlip(flip) {
  return Boolean(
    flip &&
      flip.decoded === true &&
      flip.failed !== true &&
      Array.isArray(flip.images) &&
      flip.images.length > 0 &&
      Array.isArray(flip.orders) &&
      flip.orders.length > 0
  )
}

export function hasRenderableValidationFlips(flips) {
  return Array.isArray(flips) && flips.some(isRenderableValidationFlip)
}
/**
 * Fully fetched and decoded flips
 * @param {*} flips
 */
export function filterSolvableFlips(flips) {
  return flips.filter(solvableFlips)
}

export const failedFlip = ({ready, decoded, extra}) =>
  !extra && (!ready || !decoded)

export const availableExtraFlip = ({extra, decoded}) => extra && decoded

export const missingFlip = ({ready, missing}) => ready && missing

export function rearrangeFlips(flips) {
  const solvable = []
  const loading = []
  const invalid = []
  const extras = []
  const flippedFlips = []
  for (let i = 0; i < flips.length; i += 1) {
    const {fetched, decoded, failed, extra, flipped} = flips[i]
    if (extra) {
      extras.push(flips[i])
    } else if (flipped) {
      flippedFlips.push(flips[i])
    } else if (decoded) {
      solvable.push(flips[i])
    } else if (failed || fetched) {
      invalid.push(flips[i])
    } else {
      loading.push(flips[i])
    }
  }
  solvable.sort((a, b) => a.retries - b.retries)
  return [...solvable, ...flippedFlips, ...loading, ...invalid, ...extras]
}

export function flipExtraFlip({extra, ...flip}) {
  return {...flip, extra: !extra, flipped: true}
}

export function hasEnoughAnswers(flips) {
  const solvable = flips.filter(({decoded, extra}) => decoded && !extra)
  const answered = solvable.filter(({option}) => option)
  return solvable.length && answered.length / solvable.length >= 0.6
}

export function missingHashes(flips) {
  return flips.filter(missingFlip).map(({hash}) => hash)
}

export function exponentialBackoff(retry) {
  return Math.min(2 ** retry + Math.random(), 32)
}

function toPersistableValidationState(state) {
  if (!state) return null

  const snapshot =
    typeof state.toJSON === 'function' ? state.toJSON() : {...state}

  return {
    ...snapshot,
    context: {
      ...snapshot.context,
      reports: Array.isArray(state.context?.reports)
        ? state.context.reports
        : [...(state.context?.reports ?? [])],
    },
  }
}

export function persistScopedValidationState(state, scope) {
  const persistableState = toPersistableValidationState(state)

  if (!persistableState) {
    return
  }

  const persistedPayload = getStoredValidationStatePayload()

  persistState('validation2', {
    [VALIDATION_SESSION_PERSIST_KEY]: persistedPayload.liveValidationSession,
    [VALIDATION_STATE_META_KEY]: normalizeValidationStateMeta(scope),
    [VALIDATION_STATE_SNAPSHOT_KEY]: persistableState,
  })
}

export function persistValidationState(state, scope = null) {
  if (scope) {
    persistScopedValidationState(state, scope)
    return
  }

  const persistableState = toPersistableValidationState(state)

  if (persistableState) {
    const persistedPayload = getStoredValidationStatePayload()

    persistState('validation2', {
      [VALIDATION_SESSION_PERSIST_KEY]: persistedPayload.liveValidationSession,
      [VALIDATION_STATE_META_KEY]: persistedPayload.meta,
      [VALIDATION_STATE_SNAPSHOT_KEY]: persistableState,
    })
  }
}

export function loadValidationStateDefinition(scope = null) {
  const persistedPayload = getStoredValidationStatePayload()

  if (!persistedPayload.snapshot) {
    return null
  }

  if (!matchesValidationStateScope(persistedPayload.meta, scope)) {
    clearValidationState(scope)
    return null
  }

  return persistedPayload.snapshot
}

export function loadValidationStateDefinitionByIdentityScope(scope = null) {
  const persistedPayload = getStoredValidationStatePayload()

  if (!persistedPayload.snapshot) {
    return null
  }

  if (!matchesValidationStateIdentityScope(persistedPayload.meta, scope)) {
    return null
  }

  return persistedPayload.snapshot
}

export function loadValidationState(scope = null) {
  const stateDef = loadValidationStateDefinition(scope)

  if (stateDef) {
    let reports
    try {
      reports = Array.isArray(stateDef.context?.reports)
        ? new Set([...stateDef.context.reports])
        : new Set()
    } catch {
      reports = new Set()
    }

    return State.create({
      ...stateDef,
      context: {
        ...stateDef.context,
        reports,
      },
    })
  }
}

export function shouldDiscardPersistedValidationStateForPeriod(
  currentPeriod,
  persistedState
) {
  if (!persistedState || !currentPeriod) {
    return false
  }

  if (
    currentPeriod === EpochPeriod.LongSession &&
    persistedState.matches('shortSession')
  ) {
    return true
  }

  return false
}

export function loadValidationStateForPeriod(currentPeriod, scope = null) {
  const restoredState = loadValidationState(scope)

  if (
    shouldDiscardPersistedValidationStateForPeriod(currentPeriod, restoredState)
  ) {
    clearValidationState(scope)
    return null
  }

  return restoredState
}

export function loadValidationStateByIdentityScope(scope = null) {
  const stateDef = loadValidationStateDefinitionByIdentityScope(scope)

  if (stateDef) {
    let reports
    try {
      reports = Array.isArray(stateDef.context?.reports)
        ? new Set([...stateDef.context.reports])
        : new Set()
    } catch {
      reports = new Set()
    }

    return State.create({
      ...stateDef,
      context: {
        ...stateDef.context,
        reports,
      },
    })
  }
}

export function clearValidationState(scope = null) {
  const persistedPayload = getStoredValidationStatePayload()
  const preservedSession =
    persistedPayload.liveValidationSession &&
    matchesStoredValidationSessionScope(
      persistedPayload.liveValidationSession.scopeKey,
      scope
    )
      ? persistedPayload.liveValidationSession
      : null

  if (!preservedSession) {
    dropStoredValidationSession()
  }

  persistValidationPayload({liveValidationSession: preservedSession})
}

export function shouldStartValidation(epoch, identity, scope = null) {
  const isValidationRunning = isValidationCeremonyPeriod(epoch?.currentPeriod)

  if (isValidationRunning && canValidate(identity)) {
    const validationStateDefinition = loadValidationStateDefinition(scope)
    if (validationStateDefinition) {
      const persistedValidationState = State.create(validationStateDefinition)
      const isDone = persistedValidationState.done

      const isSameEpoch = epoch.epoch === persistedValidationState.context.epoch

      if (!isSameEpoch) {
        clearValidationState(scope)
      }

      return !isDone || !isSameEpoch
    }

    return true
  }

  return false
}

export function isValidationCeremonyPeriod(currentPeriod) {
  return [EpochPeriod.ShortSession, EpochPeriod.LongSession].includes(
    currentPeriod
  )
}

export function shouldPrepareValidationSession(epoch, identity) {
  return (
    canValidate(identity) &&
    !!epoch &&
    [
      EpochPeriod.FlipLottery,
      EpochPeriod.ShortSession,
      EpochPeriod.LongSession,
    ].includes(epoch.currentPeriod)
  )
}

export function computeValidationCeremonyReadiness({
  isDev = false,
  isValidationRunning = false,
  isInternalNode = false,
  loading = false,
  offline = false,
  syncing = false,
  peersCount = 0,
  nodeReady = false,
  nodeFailed = false,
  stableSince = null,
  identity = null,
  now = Date.now(),
} = {}) {
  if (isDev && isValidationRunning) {
    return {ready: false, reason: 'dev-mode-blocked'}
  }

  if (loading) {
    return {ready: false, reason: 'loading'}
  }

  if (offline) {
    return {ready: false, reason: 'offline'}
  }

  if (isInternalNode && nodeFailed) {
    return {ready: false, reason: 'node-failed'}
  }

  if (isInternalNode && !nodeReady) {
    return {ready: false, reason: 'node-starting'}
  }

  if (syncing) {
    return {ready: false, reason: 'syncing'}
  }

  if (!Number.isFinite(peersCount) || peersCount < 1) {
    return {ready: false, reason: 'no-peers'}
  }

  if (!stableSince) {
    return {ready: false, reason: 'stabilizing'}
  }

  if (now - stableSince < VALIDATION_NODE_STABILITY_GRACE_MS) {
    return {ready: false, reason: 'stabilizing'}
  }

  if (!identity || !identity.address) {
    return {ready: false, reason: 'account-unavailable'}
  }

  if (
    !Number.isFinite(identity.nonce) ||
    !Number.isFinite(identity.mempoolNonce)
  ) {
    return {ready: false, reason: 'account-unavailable'}
  }

  if (identity.mempoolNonce < identity.nonce) {
    return {ready: false, reason: 'nonce-stale'}
  }

  return {ready: true, reason: 'ready'}
}

export function didValidate(currentEpoch, scope = null) {
  const validationStateDefinition = scope
    ? loadValidationStateDefinitionByIdentityScope(scope)
    : loadValidationStateDefinition()

  if (validationStateDefinition) {
    const {epoch} = State.create(validationStateDefinition).context
    return currentEpoch > epoch
  }

  return false
}

export function shouldExpectValidationResults(epoch, scope = null) {
  const validationStateDefinition = scope
    ? loadValidationStateDefinitionByIdentityScope(scope)
    : loadValidationStateDefinition()

  if (validationStateDefinition) {
    const {
      done,
      context: {epoch: validationEpoch},
    } = State.create(validationStateDefinition)
    return done && epoch - validationEpoch === 1
  }

  return false
}

export function hasPersistedValidationResults(epoch) {
  return !!loadPersistentStateValue('validationResults', epoch)
}

export function shouldTranslate(translations, flip) {
  if (!flip) return false

  const {words} = flip

  return !!(
    words &&
    words.length &&
    !words
      .map(({id}) => translations[id])
      .reduce((acc, curr) => !!curr && acc, true)
  )
}

export function shouldPollLongFlips(
  flips,
  {validationStart, shortSessionDuration}
) {
  return (
    flips.some(({ready}) => !ready) &&
    dayjs().isBefore(
      (isDayjs(validationStart) ? validationStart : dayjs(validationStart))
        .add(shortSessionDuration, 's')
        .add(2, 'minute')
    )
  )
}

export const decodedWithKeywords = ({decoded, words}) =>
  decoded && words?.length > 0

export function availableReportsNumber(flips) {
  return Math.floor(flips.length / 3)
}

export function canValidate(identity) {
  if (!identity) {
    return false
  }

  const {requiredFlips, state} = identity
  const publishedFlips = getIdentityPublishedFlipsCount(identity)

  const numOfFlipsToSubmit = requiredFlips - publishedFlips
  const shouldSendFlips = numOfFlipsToSubmit > 0

  return (
    ([
      IdentityStatus.Human,
      IdentityStatus.Verified,
      IdentityStatus.Newbie,
    ].includes(state) &&
      !shouldSendFlips) ||
    [
      IdentityStatus.Candidate,
      IdentityStatus.Suspended,
      IdentityStatus.Zombie,
    ].includes(state)
  )
}
