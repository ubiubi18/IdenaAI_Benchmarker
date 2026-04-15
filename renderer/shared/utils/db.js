import nanoid from 'nanoid'

const rootDbRegistry = new Map()
const epochPrefixPattern = /^epoch(-?\d+)$/i

function createNotFoundError() {
  const error = new Error('NotFound')
  error.notFound = true
  return error
}

function createInMemoryDb() {
  const store = new Map()

  function createSubDb(prefix = '') {
    const nextPrefix = String(prefix || '')

    const withPrefix = (key) =>
      nextPrefix ? `${nextPrefix}:${String(key || '')}` : String(key || '')

    return {
      __idenaFallback: true,
      async get(key) {
        const nextKey = withPrefix(key)

        if (!store.has(nextKey)) {
          throw createNotFoundError()
        }

        return store.get(nextKey)
      },
      async put(key, value) {
        store.set(withPrefix(key), value)
        return undefined
      },
      batch() {
        const ops = []
        return {
          put(key, value) {
            ops.push({type: 'put', key, value})
            return this
          },
          del(key) {
            ops.push({type: 'del', key})
            return this
          },
          async write() {
            ops.forEach(({type, key, value}) => {
              const nextKey = withPrefix(key)

              if (type === 'put') {
                store.set(nextKey, value)
              } else if (type === 'del') {
                store.delete(nextKey)
              }
            })

            return undefined
          },
        }
      },
      async clear() {
        for (const key of Array.from(store.keys())) {
          if (
            !nextPrefix ||
            key.startsWith(`${nextPrefix}:`) ||
            key === nextPrefix
          ) {
            store.delete(key)
          }
        }

        return undefined
      },
      isOpen() {
        return true
      },
      async close() {
        return undefined
      },
      sub(childPrefix = '') {
        return createSubDb(
          nextPrefix
            ? `${nextPrefix}:${String(childPrefix || '')}`
            : String(childPrefix || '')
        )
      },
    }
  }

  return createSubDb('')
}

function getStorageBridge() {
  if (
    typeof window !== 'undefined' &&
    window.idena &&
    window.idena.storage &&
    typeof window.idena.storage === 'object'
  ) {
    return window.idena.storage
  }

  return null
}

function normalizeOptions(options) {
  return options && typeof options === 'object' ? options : {}
}

function hasJsonEncoding(options) {
  return normalizeOptions(options).valueEncoding === 'json'
}

function wrapStore(store, {epochFactory} = {}) {
  return {
    __idenaFallback: false,
    async get(key) {
      try {
        return await store.get(key)
      } catch (error) {
        if (
          error &&
          (error.notFound ||
            error.message === 'NotFound' ||
            String(error).includes('NotFound'))
        ) {
          throw createNotFoundError()
        }

        throw error
      }
    },
    async put(key, value) {
      return store.put(key, value)
    },
    batch() {
      const ops = []

      return {
        put(key, value) {
          ops.push({type: 'put', key, value})
          return this
        },
        del(key) {
          ops.push({type: 'del', key})
          return this
        },
        async write() {
          return store.batchWrite(ops)
        },
      }
    },
    async clear() {
      return store.clear()
    },
    isOpen() {
      return true
    },
    async close() {
      return undefined
    },
    sub(prefix, options = {}) {
      if (typeof epochFactory === 'function') {
        const match = epochPrefixPattern.exec(String(prefix || '').trim())

        if (match) {
          if (!hasJsonEncoding(options)) {
            throw new Error(`Epoch storage requires JSON encoding: ${prefix}`)
          }

          return wrapStore(epochFactory(Number(match[1])))
        }
      }

      throw new Error(`Unsupported storage scope: ${prefix || 'unknown'}`)
    },
  }
}

function createRootBridgeDb() {
  const storageBridge = getStorageBridge()

  if (!storageBridge) {
    return createInMemoryDb()
  }

  return {
    __idenaFallback: false,
    isOpen() {
      return true
    },
    async close() {
      return undefined
    },
    sub(prefix, options = {}) {
      const normalizedPrefix = String(prefix || '').trim()

      switch (normalizedPrefix) {
        case 'flips':
          return wrapStore(storageBridge.flips)
        case 'votings':
          return wrapStore(
            hasJsonEncoding(options)
              ? storageBridge.votings.json
              : storageBridge.votings,
            {
              epochFactory: storageBridge.votings.epoch,
            }
          )
        case 'updates':
          return wrapStore(storageBridge.updates)
        case 'profile':
          return wrapStore(storageBridge.profile)
        case 'onboarding':
          return wrapStore(storageBridge.onboarding)
        default:
          throw new Error(`Unsupported storage namespace: ${normalizedPrefix}`)
      }
    },
  }
}

export function requestDb(name = 'db') {
  const normalizedName =
    typeof name === 'string' && name.trim() ? name.trim() : 'db'

  const cachedDb = rootDbRegistry.get(normalizedName)

  if (
    cachedDb &&
    cachedDb.__idenaFallback &&
    normalizedName === 'db' &&
    getStorageBridge()
  ) {
    rootDbRegistry.set(normalizedName, createRootBridgeDb())
  } else if (!rootDbRegistry.has(normalizedName)) {
    rootDbRegistry.set(
      normalizedName,
      normalizedName === 'db' ? createRootBridgeDb() : createInMemoryDb()
    )
  }

  return rootDbRegistry.get(normalizedName)
}

export const epochDb = (db, epoch = -1, options = {}) => {
  const epochPrefix = `epoch${epoch}`
  const nextOptions = {
    valueEncoding: 'json',
    ...options,
  }

  let targetDb

  switch (typeof db) {
    case 'string':
      targetDb = requestDb().sub(db).sub(epochPrefix, nextOptions)
      break
    case 'object':
      if (!db || typeof db.sub !== 'function') {
        throw new Error('db should provide a sub() method')
      }
      targetDb = db.sub(epochPrefix, nextOptions)
      break
    default:
      throw new Error('db should be either string or Level instance')
  }

  return {
    async all() {
      try {
        return await loadPersistedItems(targetDb)
      } catch (error) {
        if (error.notFound) return []
        throw error
      }
    },
    load(id) {
      return targetDb.get(normalizeId(id))
    },
    put(item) {
      const {id} = item
      return id
        ? updatePersistedItem(targetDb, normalizeId(id), item)
        : addPersistedItem(targetDb, item)
    },
    async batchPut(items) {
      const ids = await safeReadIds(targetDb)

      const newItems = items.filter(({id}) => !ids.includes(normalizeId(id)))
      const newIds = []

      let batch = targetDb.batch()

      for (const {id = nanoid(), ...item} of newItems) {
        const normalizedId = normalizeId(id)
        newIds.push(normalizedId)
        batch = batch.put(normalizedId, item)
      }

      const savedItems = await Promise.all(
        ids.map(async (id) => {
          const normalizedId = normalizeId(id)
          return {
            ...(await targetDb.get(normalizedId)),
            id: normalizedId,
          }
        })
      )

      for (const {id, ...item} of savedItems) {
        batch = batch.put(id, {
          ...item,
          ...items.find((x) => x.id === id),
        })
      }

      return batch.put('ids', ids.concat(newIds)).write()
    },
    delete(id) {
      return deletePersistedItem(targetDb, normalizeId(id))
    },
    clear() {
      return clearPersistedItems(targetDb)
    },
    originDb: targetDb,
  }
}

export async function loadPersistedItems(db) {
  const ids = (await db.get('ids')).map(normalizeId)

  return Promise.all(
    ids.map(async (id) => ({
      id,
      ...(await db.get(id)),
    }))
  )
}

export async function addPersistedItem(db, {id = nanoid(), ...item}) {
  const ids = [...(await safeReadIds(db)), id]

  await db.batch().put('ids', ids).put(id, item).write()

  return {...item, id}
}

export async function updatePersistedItem(db, id, item) {
  try {
    const nextItem = {...(await db.get(id)), ...item}
    await db.put(id, nextItem)
    return {...nextItem, id}
  } catch (error) {
    if (error.notFound) return addPersistedItem(db, {id, ...item})
    throw new Error(error.message)
  }
}

export async function deletePersistedItem(db, id) {
  return db
    .batch()
    .put(
      'ids',
      (await safeReadIds(db)).filter((x) => x !== id)
    )
    .del(id)
    .write()
}

export function clearPersistedItems(db) {
  return db.clear()
}

async function safeReadIds(db) {
  try {
    return (await db.get('ids')).map(normalizeId)
  } catch (error) {
    if (error.notFound) return []
    throw new Error(error)
  }
}

function normalizeId(id) {
  return id?.toLowerCase()
}
