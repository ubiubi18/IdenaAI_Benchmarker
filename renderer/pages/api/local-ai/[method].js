const {
  DEV_LOCAL_AI_ALLOWED_METHODS,
  getDevLocalAiManager,
  isDevBrowserRequest,
  sanitizeBridgeValue,
} = require('../../../server/local-ai-dev-bridge')

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '128mb',
    },
    responseLimit: false,
  },
}

export default async function handler(req, res) {
  if (!isDevBrowserRequest(req)) {
    res.status(404).json({
      error:
        'Local AI dev bridge is only available on localhost in development',
    })
    return
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.status(405).json({error: 'Method not allowed'})
    return
  }

  const method = String(req.query?.method || '').trim()

  if (!DEV_LOCAL_AI_ALLOWED_METHODS.has(method)) {
    res.status(404).json({
      error: `Unsupported Local AI dev bridge method: ${method}`,
    })
    return
  }

  const manager = getDevLocalAiManager()
  const managerMethod = manager && manager[method]

  if (typeof managerMethod !== 'function') {
    res.status(404).json({
      error: `Local AI manager method is unavailable: ${method}`,
    })
    return
  }

  try {
    const payload =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? req.body
        : {}
    const result = await managerMethod(payload)
    res.status(200).json(sanitizeBridgeValue(result))
  } catch (error) {
    const message = String(
      error && error.message ? error.message : error || ''
    ).trim()
    res.status(500).json({
      error: message || `Local AI dev bridge request failed for ${method}`,
      lastError: message || `Local AI dev bridge request failed for ${method}`,
      method,
    })
  }
}
