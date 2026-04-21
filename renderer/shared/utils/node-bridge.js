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
    return {
      __idenaFallback: false,
      ...window.idena.node,
    }
  }

  return createFallbackNodeBridge()
}
