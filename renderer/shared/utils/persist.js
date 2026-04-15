import {getSharedGlobal} from './shared-global'

const PERSISTENCE_STORE_MAP = {
  settings: 'settings',
  flipFilter: 'flipFilter',
  validation2: 'validationSession',
  validationResults: 'validationResults',
  flipArchive: 'flipArchive',
  validationNotification: 'validationNotification',
}

function createFallbackPersistenceStore() {
  return {
    loadState: () => ({}),
    loadValue: () => null,
    persistItem: () => false,
    persistState: () => false,
  }
}

function getPersistenceStore(dbName) {
  const storeKey = PERSISTENCE_STORE_MAP[String(dbName || '').trim()]

  if (
    storeKey &&
    typeof window !== 'undefined' &&
    window.idena &&
    window.idena.storage &&
    typeof window.idena.storage === 'object' &&
    window.idena.storage[storeKey] &&
    typeof window.idena.storage[storeKey] === 'object'
  ) {
    return window.idena.storage[storeKey]
  }

  return createFallbackPersistenceStore()
}

export function loadPersistentState(dbName) {
  try {
    const value = getPersistenceStore(dbName).loadState()
    return Object.keys(value).length === 0 ? null : value || null
  } catch (error) {
    return null
  }
}

export function loadPersistentStateValue(dbName, key) {
  if ((key ?? null) === null) {
    throw new Error('loadItem requires key to be passed')
  }
  try {
    return getPersistenceStore(dbName).loadValue(key) || null
  } catch {
    const state = loadPersistentState(dbName)
    return (state && state[key]) || null
  }
}

export function persistItem(dbName, key, value) {
  try {
    getPersistenceStore(dbName).persistItem(key, value)
  } catch {
    getSharedGlobal('logger', console).error(
      'error writing to file: ',
      dbName,
      key,
      value
    )
  }
}

export function persistState(name, state) {
  try {
    getPersistenceStore(name).persistState(state)
  } catch {
    getSharedGlobal('logger', console).error(
      'error writing to file: ',
      name,
      state
    )
  }
}

/**
 * Checks if action or action list has the name passed
 * @param {(string|string[])} actionList
 * @param {string} action
 */
export function shouldPersist(actionList, action) {
  if (!actionList || actionList.length === 0) {
    return true
  }
  const actionName = Array.isArray(action) ? action[0] : action.type
  return Array.isArray(actionList)
    ? actionList.includes(actionName)
    : actionList === actionName
}
