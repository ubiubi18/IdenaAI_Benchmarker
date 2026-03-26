async function withRetries(maxRetries, worker) {
  let attempt = 0
  while (attempt <= maxRetries) {
    try {
      return await worker(attempt)
    } catch (error) {
      if (attempt === maxRetries) {
        throw error
      }
      attempt += 1
    }
  }
  throw new Error('Retry loop terminated unexpectedly')
}

async function mapWithConcurrency(items, limit, mapper) {
  if (!items.length) return []

  const results = new Array(items.length)
  let cursor = 0

  const workers = Array.from(
    {length: Math.max(1, Math.min(limit, items.length))},
    async () => {
      while (cursor < items.length) {
        const current = cursor
        cursor += 1
        if (current >= items.length) return
        results[current] = await mapper(items[current], current)
      }
    }
  )

  await Promise.all(workers)
  return results
}

module.exports = {
  withRetries,
  mapWithConcurrency,
}
