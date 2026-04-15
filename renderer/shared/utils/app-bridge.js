function createFallbackAppBridge() {
  return {
    reload: () => {},
    requestConfirmQuit: () => {},
    showMainWindow: () => {},
    onConfirmQuit: () => () => {},
  }
}

export function getAppBridge() {
  if (
    typeof window !== 'undefined' &&
    window.idena &&
    window.idena.app &&
    typeof window.idena.app === 'object'
  ) {
    return window.idena.app
  }

  return createFallbackAppBridge()
}
