import {loadPersistentState} from '../utils/persist'
import {postJson} from '../utils/http-client'

export const BASE_INTERNAL_API_PORT = 9129
export const BASE_API_URL = 'http://localhost:9009'

function getRpcBridge() {
  if (
    typeof window !== 'undefined' &&
    window.idena &&
    window.idena.rpc &&
    typeof window.idena.rpc.call === 'function'
  ) {
    return window.idena.rpc
  }

  return null
}

function getRpcFallbackParams() {
  const state = loadPersistentState('settings')
  if (!state) {
    return {
      url: `http://127.0.0.1:${BASE_INTERNAL_API_PORT}`,
      key: '',
    }
  }
  if (!state.useExternalNode) {
    return {
      url: `http://127.0.0.1:${state.internalPort}`,
      key: state.internalApiKey,
    }
  }
  return {
    url: state.url || BASE_API_URL,
    key: state.externalApiKey,
  }
}

export function getRpcParams() {
  const {url} = getRpcFallbackParams()
  return {url}
}

export const apiUrl = (path) => {
  const state = loadPersistentState('settings')
  if (state?.apiUrl) return new URL(path, state?.apiUrl)
  return new URL(path, global.env.INDEXER_URL || 'https://api.idena.io/api/')
}

export default function createApiClient() {
  const rpcBridge = getRpcBridge()

  if (rpcBridge) {
    return {
      async post(path, body) {
        if (path !== '/') {
          throw new Error(`Unsupported RPC path: ${path}`)
        }

        return {
          data: await rpcBridge.call(body),
        }
      },
    }
  }

  const params = getRpcFallbackParams()
  return {
    async post(path, body = {}) {
      return postJson(new URL(path, params.url).toString(), {
        ...body,
        key: params.key,
      })
    },
  }
}
