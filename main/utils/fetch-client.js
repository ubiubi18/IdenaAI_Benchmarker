const {Readable} = require('stream')

function appendParams(url, params) {
  const nextUrl = new URL(url)
  if (params && typeof params === 'object') {
    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined || value === null) return
      nextUrl.searchParams.set(key, String(value))
    })
  }
  return nextUrl.toString()
}

function normalizeHeaders(headers = {}) {
  return Object.entries(headers || {}).reduce((acc, [key, value]) => {
    if (value !== undefined && value !== null) {
      acc[key] = String(value)
    }
    return acc
  }, {})
}

function normalizeResponseHeaders(headers) {
  const result = {}
  headers.forEach((value, key) => {
    result[key.toLowerCase()] = value
  })
  return result
}

function applyTransforms(value, transforms = []) {
  return transforms.reduce((nextValue, transform) => {
    if (typeof transform !== 'function') return nextValue
    return transform(nextValue)
  }, value)
}

async function parseResponseBody(response, responseType, transforms = []) {
  if (responseType === 'stream') {
    return Readable.fromWeb(response.body)
  }
  if (responseType === 'arraybuffer') {
    return Buffer.from(await response.arrayBuffer())
  }

  const text = await response.text()
  if (!text) return applyTransforms(null, transforms)

  if (transforms.length > 0) {
    return applyTransforms(text, transforms)
  }

  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    return JSON.parse(text)
  }

  try {
    return JSON.parse(text)
  } catch (_) {
    return text
  }
}

function createTimeoutController(timeout) {
  const timeoutMs = Number(timeout)
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return {signal: undefined, clear: () => {}}
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  }
}

async function request(defaults = {}, config = {}) {
  const {
    baseURL,
    method = 'get',
    url = '',
    params,
    data,
    headers,
    timeout,
    responseType,
    validateStatus = (status) => status >= 200 && status < 300,
    transformRequest = [],
    transformResponse = [],
  } = {...defaults, ...config}

  const requestUrl = appendParams(new URL(url, baseURL).toString(), params)
  const nextHeaders = normalizeHeaders(headers)
  let body = data

  if (body !== undefined) {
    body = applyTransforms(body, transformRequest)
    if (
      body &&
      typeof body === 'object' &&
      !(body instanceof Buffer) &&
      typeof body.pipe !== 'function'
    ) {
      if (
        !Object.keys(nextHeaders).some(
          (key) => key.toLowerCase() === 'content-type'
        )
      ) {
        nextHeaders['Content-Type'] = 'application/json'
      }
      body = JSON.stringify(body)
    }
  }

  const timeoutController = createTimeoutController(timeout)

  try {
    const response = await fetch(requestUrl, {
      method: String(method || 'get').toUpperCase(),
      headers: nextHeaders,
      body,
      signal: timeoutController.signal,
    })
    const responseData = await parseResponseBody(
      response,
      responseType,
      transformResponse
    )
    const result = {
      data: responseData,
      status: response.status,
      statusText: response.statusText,
      headers: normalizeResponseHeaders(response.headers),
      config,
    }

    if (!validateStatus(response.status)) {
      const error = new Error(
        `Request failed with status code ${response.status}`
      )
      error.response = result
      throw error
    }

    return result
  } catch (error) {
    if (error && error.name === 'AbortError') {
      const timeoutError = new Error(`timeout of ${timeout}ms exceeded`)
      timeoutError.code = 'ECONNABORTED'
      throw timeoutError
    }
    throw error
  } finally {
    timeoutController.clear()
  }
}

function createFetchClient(defaults = {}) {
  const client = {
    request: (config = {}) => request(defaults, config),
    get: (url, config = {}) =>
      request(defaults, {...config, method: 'get', url}),
    post: (url, data, config = {}) =>
      request(defaults, {...config, method: 'post', url, data}),
    create: (nextDefaults = {}) =>
      createFetchClient({...defaults, ...nextDefaults}),
  }

  return client
}

module.exports = createFetchClient()
module.exports.createFetchClient = createFetchClient
