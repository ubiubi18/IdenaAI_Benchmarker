const VALIDATION_DEVNET_STATUS_THROTTLE_MS = 900

let lastValidationDevnetStatusRequestAt = 0
let cachedNativeNodeBridge = null
let cachedNodeBridge = null

function createFallbackNodeBridge() {
  return {
    __idenaFallback: true,
    onEvent: () => () => {},
    getLastLogs: () => {},
    restartNode: () => {},
    startLocalNode: () => {},
    initLocalNode: () => {},
    startValidationDevnet: () => {},
    restartValidationDevnet: () => {},
    stopValidationDevnet: () => {},
    getValidationDevnetStatus: () => {},
    getValidationDevnetLogs: () => {},
    connectValidationDevnet: () => {},
    clearExternalNodeOverride: () => {},
    stopLocalNode: () => {},
    cleanState: () => {},
    troubleshootingRestartNode: () => {},
    troubleshootingUpdateNode: () => {},
    troubleshootingResetNode: () => {},
  }
}

export function getNodeBridge() {
  if (
    typeof window !== 'undefined' &&
    window.idena &&
    window.idena.node &&
    typeof window.idena.node === 'object'
  ) {
    const bridge = window.idena.node

    if (bridge === cachedNativeNodeBridge && cachedNodeBridge) {
      return cachedNodeBridge
    }

    cachedNativeNodeBridge = bridge
    cachedNodeBridge = {
      __idenaFallback: false,
      ...bridge,
      getValidationDevnetStatus() {
        const now = Date.now()

        if (
          now - lastValidationDevnetStatusRequestAt <
          VALIDATION_DEVNET_STATUS_THROTTLE_MS
        ) {
          return false
        }

        lastValidationDevnetStatusRequestAt = now

        return bridge.getValidationDevnetStatus()
      },
    }

    return cachedNodeBridge
  }

  return createFallbackNodeBridge()
}
