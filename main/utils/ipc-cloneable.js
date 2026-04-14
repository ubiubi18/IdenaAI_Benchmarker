function isPlainObject(value) {
  if (!value || Object.prototype.toString.call(value) !== '[object Object]') {
    return false
  }

  const prototype = Object.getPrototypeOf(value)

  return prototype === Object.prototype || prototype === null
}

function toIpcCloneable(value, seen = new WeakSet()) {
  if (value === null || typeof value === 'undefined') {
    return value
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }

  if (typeof value === 'bigint') {
    return value.toString()
  }

  if (typeof value === 'function' || typeof value === 'symbol') {
    return undefined
  }

  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null
  }

  if (value instanceof Error) {
    return {
      name: String(value.name || 'Error'),
      message: String(value.message || ''),
      stack: String(value.stack || ''),
    }
  }

  if (Buffer.isBuffer(value)) {
    return value.toString('base64')
  }

  if (ArrayBuffer.isView(value)) {
    return Array.from(value)
  }

  if (value instanceof ArrayBuffer) {
    return Array.from(new Uint8Array(value))
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return null
    }

    seen.add(value)

    const normalizedArray = value.map((item) => {
      const normalized = toIpcCloneable(item, seen)
      return typeof normalized === 'undefined' ? null : normalized
    })

    seen.delete(value)

    return normalizedArray
  }

  if (!isPlainObject(value)) {
    return undefined
  }

  if (seen.has(value)) {
    return null
  }

  seen.add(value)

  const normalizedObject = Object.entries(value).reduce(
    (result, [key, entryValue]) => {
      const normalized = toIpcCloneable(entryValue, seen)

      if (typeof normalized !== 'undefined') {
        result[key] = normalized
      }

      return result
    },
    {}
  )

  seen.delete(value)

  return normalizedObject
}

module.exports = {
  toIpcCloneable,
}
