function createFallbackInvitesBridge() {
  return {
    getInvites: () => [],
    getInvite: () => undefined,
    addInvite: () => null,
    updateInvite: () => {},
    removeInvite: () => {},
    clearInvites: () => {},
    getActivationTx: () => '',
    setActivationTx: () => {},
    clearActivationTx: () => {},
    getActivationCode: () => '',
    setActivationCode: () => {},
    clearActivationCode: () => {},
  }
}

export function getInvitesBridge() {
  if (
    typeof window !== 'undefined' &&
    window.idena &&
    window.idena.invites &&
    typeof window.idena.invites === 'object'
  ) {
    return window.idena.invites
  }

  return createFallbackInvitesBridge()
}
