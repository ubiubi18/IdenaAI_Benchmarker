import {getSharedGlobal} from './shared-global'

function getPersistenceBridge() {
  if (
    typeof window !== 'undefined' &&
    window.idena &&
    window.idena.persistence &&
    typeof window.idena.persistence === 'object'
  ) {
    return window.idena.persistence
  }

  return {
    loadState: () => ({}),
    loadValue: () => null,
    persistItem: () => false,
    persistState: () => false,
  }
}

export function loadPersistentState(dbName) {
  try {
    const value = getPersistenceBridge().loadState(dbName)
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
    return getPersistenceBridge().loadValue(dbName, key) || null
  } catch {
    const state = loadPersistentState(dbName)
    return (state && state[key]) || null
  }
}

export function persistItem(dbName, key, value) {
  try {
    getPersistenceBridge().persistItem(dbName, key, value)
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
    getPersistenceBridge().persistState(name, state)
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
