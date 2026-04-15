function createFallbackImageSearchBridge() {
  return {
    search: async () => [],
  }
}

export function getImageSearchBridge() {
  if (
    typeof window !== 'undefined' &&
    window.idena &&
    window.idena.imageSearch &&
    typeof window.idena.imageSearch === 'object'
  ) {
    return window.idena.imageSearch
  }

  return createFallbackImageSearchBridge()
}
