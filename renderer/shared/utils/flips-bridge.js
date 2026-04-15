function createFallbackFlipsBridge() {
  return {
    getFlips: () => [],
    getFlip: () => undefined,
    saveFlips: () => {},
    addDraft: () => {},
    updateDraft: () => [],
    deleteDraft: () => null,
    clear: () => {},
  }
}

export function getFlipsBridge() {
  if (
    typeof window !== 'undefined' &&
    window.idena &&
    window.idena.flips &&
    typeof window.idena.flips === 'object'
  ) {
    return window.idena.flips
  }

  return createFallbackFlipsBridge()
}
