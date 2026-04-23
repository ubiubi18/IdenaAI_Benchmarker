function loadPersistenceValueFromDb(db, key) {
  const normalizedKey = String(key || '').trim()

  if (!normalizedKey) {
    return null
  }

  const state = db.getState() || {}

  if (
    state &&
    typeof state === 'object' &&
    !Array.isArray(state) &&
    Object.prototype.hasOwnProperty.call(state, normalizedKey)
  ) {
    return state[normalizedKey] || null
  }

  const legacyValue = db.get(normalizedKey).value()
  return legacyValue || null
}

function persistPersistenceItemToDb(db, key, value) {
  const normalizedKey = String(key || '').trim()

  if (!normalizedKey) {
    throw new Error('Persistence key must be a non-empty string')
  }

  const state = db.getState()
  const nextState =
    state && typeof state === 'object' && !Array.isArray(state)
      ? {...state}
      : {}

  if (value == null) {
    delete nextState[normalizedKey]
  } else {
    nextState[normalizedKey] = value
  }

  db.setState(nextState).write()
  return true
}

module.exports = {
  loadPersistenceValueFromDb,
  persistPersistenceItemToDb,
}
