import nanoid from 'nanoid'

let idenaDb = null
let fallbackDb = null
const SUBLEVEL_SEPARATOR = '\x00'

function createNotFoundError() {
  const error = new Error('NotFound')
  error.notFound = true
  return error
}

function createInMemoryDb() {
  const store = new Map()

  return {
    async get(key) {
      if (!store.has(key)) {
        throw createNotFoundError()
      }
      return store.get(key)
    },
    async put(key, value) {
      store.set(key, value)
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
            if (type === 'put') {
              store.set(key, value)
            } else if (type === 'del') {
              store.delete(key)
            }
          })
          return undefined
        },
      }
    },
    async clear() {
      store.clear()
      return undefined
    },
    async clearByPrefix(prefix) {
      Array.from(store.keys()).forEach((key) => {
        if (String(key).startsWith(prefix)) {
          store.delete(key)
        }
      })
      return undefined
    },
    isOpen() {
      return true
    },
    async close() {
      return undefined
    },
  }
}

function isUsableDb(value) {
  return (
    value &&
    typeof value.get === 'function' &&
    typeof value.put === 'function' &&
    typeof value.batch === 'function' &&
    typeof value.clear === 'function' &&
    (!value._db || typeof value._db.open === 'function')
  )
}

function getFallbackDb() {
  if (fallbackDb === null) {
    fallbackDb = createInMemoryDb()
  }

  return fallbackDb
}

export function createSublevelDb(db, prefix, options = {}) {
  const valueEncoding = options.valueEncoding || undefined
  const prefixKey = `${String(prefix)}${SUBLEVEL_SEPARATOR}`
  const withPrefix = (key) => `${prefixKey}${String(key)}`

  const encodeValue = (value) => {
    if (valueEncoding === 'json') {
      return JSON.stringify(value)
    }

    return value
  }

  const decodeValue = (value) => {
    if (valueEncoding === 'json' && typeof value === 'string') {
      return JSON.parse(value)
    }

    return value
  }

  return {
    async get(key) {
      return decodeValue(await db.get(withPrefix(key)))
    },
    async put(key, value) {
      return db.put(withPrefix(key), encodeValue(value))
    },
    batch() {
      const batch = db.batch()

      return {
        put(key, value) {
          batch.put(withPrefix(key), encodeValue(value))
          return this
        },
        del(key) {
          batch.del(withPrefix(key))
          return this
        },
        write() {
          return batch.write()
        },
      }
    },
    async clear() {
      if (typeof db.clearByPrefix === 'function') {
        return db.clearByPrefix(prefixKey)
      }

      return undefined
    },
    isOpen() {
      return typeof db.isOpen === 'function' ? db.isOpen() : true
    },
    close() {
      return typeof db.close === 'function' ? db.close() : Promise.resolve()
    },
  }
}

export function requestDb(name = 'db') {
  if (idenaDb === null) {
    const hasNativeDb =
      typeof global.levelup === 'function' &&
      typeof global.leveldown === 'function' &&
      typeof global.dbPath === 'function'

    if (hasNativeDb) {
      try {
        const nextDb = global.levelup(global.leveldown(global.dbPath(name)))
        idenaDb = isUsableDb(nextDb) ? nextDb : getFallbackDb()
      } catch {
        idenaDb = getFallbackDb()
      }
    } else {
      idenaDb = getFallbackDb()
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', async () => {
        if (idenaDb?.isOpen()) await idenaDb.close()
      })
    }
  }
  return idenaDb
}

export const epochDb = (db, epoch = -1, options = {}) => {
  const sub = typeof global.sub === 'function' ? global.sub : createSublevelDb
  const epochPrefix = `epoch${epoch}`

  const nextOptions = {
    valueEncoding: 'json',
    ...options,
  }

  let targetDb

  switch (typeof db) {
    case 'string':
      targetDb = sub(sub(requestDb(), db), epochPrefix, nextOptions)
      break
    case 'object':
      targetDb = sub(db, epochPrefix, nextOptions)
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
    .put('ids', await safeReadIds(db).filter((x) => x !== id))
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
