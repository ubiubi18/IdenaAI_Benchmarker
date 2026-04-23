const levelup = require('levelup')
const leveldown = require('leveldown')
const sub = require('subleveldown')

const flips = require('./stores/flips')
const invites = require('./stores/invites')
const {prepareDb, dbPath} = require('./stores/setup')
const {toIpcCloneable} = require('./utils/ipc-cloneable')
const {
  FLIPS_SYNC_COMMAND,
  INVITES_SYNC_COMMAND,
  PERSISTENCE_SYNC_COMMAND,
  STORAGE_COMMAND,
} = require('./channels')
const {
  loadPersistenceValueFromDb,
  persistPersistenceItemToDb,
} = require('./persistence-store')

const dbRegistry = new Map()
const persistenceStoreNames = new Set([
  'settings',
  'flipFilter',
  'validation2',
  'validationResults',
  'flipArchive',
  'validationNotification',
])

function ok(value) {
  return {ok: true, value}
}

function fail(error) {
  return {
    ok: false,
    error: {
      name: String((error && error.name) || 'Error'),
      message: String((error && error.message) || 'Unknown bridge error'),
      notFound: Boolean(error && error.notFound),
      code:
        error && typeof error.code !== 'undefined'
          ? String(error.code)
          : undefined,
    },
  }
}

function runSync(fn) {
  try {
    return ok(fn())
  } catch (error) {
    return fail(error)
  }
}

async function runAsync(fn) {
  try {
    return ok(await fn())
  } catch (error) {
    return fail(error)
  }
}

function getDb(name = 'db') {
  if (!dbRegistry.has(name)) {
    dbRegistry.set(name, levelup(leveldown(dbPath(name))))
  }

  return dbRegistry.get(name)
}

function normalizeStorageKey(key) {
  if (typeof key === 'string' && key.trim()) {
    return key
  }

  if (typeof key === 'number' && Number.isFinite(key)) {
    return String(key)
  }

  throw new Error('Storage key must be a non-empty string or finite number')
}

function normalizeSublevelOptions(valueEncoding) {
  return typeof valueEncoding === 'string' && valueEncoding.trim()
    ? {valueEncoding}
    : undefined
}

function createStorageTarget({namespace, valueEncoding, epoch}) {
  const rootDb = getDb('db')
  const normalizedNamespace = String(namespace || '').trim()

  switch (normalizedNamespace) {
    case 'flips':
      return sub(rootDb, 'flips', normalizeSublevelOptions(valueEncoding))
    case 'votings': {
      const rootStore = sub(rootDb, 'votings')

      if (Number.isInteger(epoch)) {
        return sub(rootStore, `epoch${epoch}`, {valueEncoding: 'json'})
      }

      return sub(rootDb, 'votings', normalizeSublevelOptions(valueEncoding))
    }
    case 'updates':
      return sub(rootDb, 'updates', normalizeSublevelOptions(valueEncoding))
    case 'profile':
      return sub(rootDb, 'profile', normalizeSublevelOptions(valueEncoding))
    case 'onboarding':
      return sub(rootDb, 'onboarding', {valueEncoding: 'json'})
    default:
      throw new Error(`Unsupported storage namespace: ${normalizedNamespace}`)
  }
}

function dispatchFlips(action, payload = {}) {
  switch (action) {
    case 'getFlips':
      return flips.getFlips()
    case 'getFlip':
      return flips.getFlip(payload.id)
    case 'saveFlips':
      return flips.saveFlips(payload.flips)
    case 'addDraft':
      return flips.addDraft(payload.draft)
    case 'updateDraft':
      return flips.updateDraft(payload.draft)
    case 'deleteDraft':
      return flips.deleteDraft(payload.id)
    case 'clear':
      return flips.clear()
    default:
      throw new Error(`Unsupported flips action: ${action}`)
  }
}

function dispatchInvites(action, payload = {}) {
  switch (action) {
    case 'getInvites':
      return invites.getInvites()
    case 'getInvite':
      return invites.getInvite(payload.id)
    case 'addInvite':
      return invites.addInvite(payload.invite)
    case 'updateInvite':
      return invites.updateInvite(payload.id, payload.invite)
    case 'removeInvite':
      return invites.removeInvite(payload.invite)
    case 'clearInvites':
      return invites.clearInvites()
    case 'getActivationTx':
      return invites.getActivationTx()
    case 'setActivationTx':
      return invites.setActivationTx(payload.hash)
    case 'clearActivationTx':
      return invites.clearActivationTx()
    case 'getActivationCode':
      return invites.getActivationCode()
    case 'setActivationCode':
      return invites.setActivationCode(payload.code)
    case 'clearActivationCode':
      return invites.clearActivationCode()
    default:
      throw new Error(`Unsupported invites action: ${action}`)
  }
}

function dispatchPersistence(action, payload = {}) {
  const storeName = String(payload.storeName || '').trim()

  if (!persistenceStoreNames.has(storeName)) {
    throw new Error(`Unsupported persistence store: ${storeName}`)
  }

  const db = prepareDb(storeName)

  switch (action) {
    case 'loadState':
      return db.getState() || {}
    case 'loadValue':
      return loadPersistenceValueFromDb(db, payload.key)
    case 'persistItem':
      return persistPersistenceItemToDb(db, payload.key, payload.value)
    case 'persistState':
      db.setState(payload.state).write()
      return true
    default:
      throw new Error(`Unsupported persistence action: ${action}`)
  }
}

async function dispatchStorage(payload = {}) {
  const targetDb = createStorageTarget(payload)
  const action = String(payload.action || '').trim()

  switch (action) {
    case 'get':
      return targetDb.get(normalizeStorageKey(payload.key))
    case 'put':
      await targetDb.put(normalizeStorageKey(payload.key), payload.value)
      return true
    case 'clear':
      await targetDb.clear()
      return true
    case 'batchWrite': {
      let batch = targetDb.batch()

      for (const operation of Array.isArray(payload.operations)
        ? payload.operations
        : []) {
        const nextOperation =
          operation && typeof operation === 'object' ? operation : {}

        if (nextOperation.type === 'put') {
          batch = batch.put(
            normalizeStorageKey(nextOperation.key),
            nextOperation.value
          )
        } else if (nextOperation.type === 'del') {
          batch = batch.del(normalizeStorageKey(nextOperation.key))
        }
      }

      await batch.write()
      return true
    }
    default:
      throw new Error(`Unsupported storage action: ${action}`)
  }
}

function registerRendererDataBridge({onTrusted, handleTrusted}) {
  onTrusted(FLIPS_SYNC_COMMAND, (event, action, payload) => {
    event.returnValue = toIpcCloneable(
      runSync(() => dispatchFlips(action, payload))
    )
  })

  onTrusted(INVITES_SYNC_COMMAND, (event, action, payload) => {
    event.returnValue = toIpcCloneable(
      runSync(() => dispatchInvites(action, payload))
    )
  })

  onTrusted(PERSISTENCE_SYNC_COMMAND, (event, action, payload) => {
    event.returnValue = toIpcCloneable(
      runSync(() => dispatchPersistence(action, payload))
    )
  })

  handleTrusted(STORAGE_COMMAND, async (_event, payload) =>
    runAsync(() => dispatchStorage(payload))
  )
}

module.exports = {
  registerRendererDataBridge,
}
