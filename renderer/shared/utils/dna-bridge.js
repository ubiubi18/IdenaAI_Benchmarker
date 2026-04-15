function createFallbackDnaBridge() {
  return {
    checkLink: async () => undefined,
    onLink: () => () => {},
  }
}

export function getDnaBridge() {
  if (
    typeof window !== 'undefined' &&
    window.idena &&
    window.idena.dna &&
    typeof window.idena.dna === 'object'
  ) {
    return window.idena.dna
  }

  return createFallbackDnaBridge()
}
