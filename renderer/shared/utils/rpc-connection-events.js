export const RPC_CONNECTION_CHANGED_EVENT = 'idena-rpc-connection-changed'

export function emitRpcConnectionChanged(detail = {}) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.dispatchEvent(
      new CustomEvent(RPC_CONNECTION_CHANGED_EVENT, {
        detail,
      })
    )
  } catch {
    // ignore best-effort refresh notifications
  }
}
