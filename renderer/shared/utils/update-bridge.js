function createFallbackUpdateBridge() {
  return {
    __idenaFallback: true,
    onEvent: () => () => {},
    startChecking: () => {},
    updateUi: () => {},
    updateNode: () => {},
  }
}

export function getUpdateBridge() {
  if (
    typeof window !== 'undefined' &&
    window.idena &&
    window.idena.updates &&
    typeof window.idena.updates === 'object'
  ) {
    return {
      __idenaFallback: false,
      ...window.idena.updates,
    }
  }

  return createFallbackUpdateBridge()
}
