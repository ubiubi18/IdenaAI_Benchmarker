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

function createTimeoutSignal(timeout) {
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

async function parseResponse(response) {
  const text = await response.text()
  if (!text) return null

  try {
    return JSON.parse(text)
  } catch (_) {
    return text
  }
}

export async function requestJson(
  url,
  {method = 'GET', data, params, timeout} = {}
) {
  const timeoutSignal = createTimeoutSignal(timeout)

  try {
    const response = await fetch(appendParams(url, params), {
      method,
      headers:
        data === undefined
          ? undefined
          : {
              'Content-Type': 'application/json',
            },
      body: data === undefined ? undefined : JSON.stringify(data),
      signal: timeoutSignal.signal,
    })
    const responseData = await parseResponse(response)

    if (!response.ok) {
      const error = new Error(
        `Request failed with status code ${response.status}`
      )
      error.response = {status: response.status, data: responseData}
      throw error
    }

    return {data: responseData, status: response.status}
  } catch (error) {
    if (error && error.name === 'AbortError') {
      const timeoutError = new Error(`timeout of ${timeout}ms exceeded`)
      timeoutError.code = 'ECONNABORTED'
      throw timeoutError
    }
    throw error
  } finally {
    timeoutSignal.clear()
  }
}

export const getJson = (url, options = {}) =>
  requestJson(url, {...options, method: 'GET'})

export const postJson = (url, data, options = {}) =>
  requestJson(url, {...options, method: 'POST', data})
