export function getIdentityPublishedFlipsCount(identity) {
  if (!identity || typeof identity !== 'object') {
    return 0
  }

  const publishedFlips = Array.isArray(identity.flips)
    ? identity.flips.length
    : 0
  const pairedFlips = Array.isArray(identity.flipsWithPair)
    ? identity.flipsWithPair.length
    : 0
  const madeFlips = Number.parseInt(identity.madeFlips, 10)
  const normalizedMadeFlips =
    Number.isFinite(madeFlips) && madeFlips >= 0 ? madeFlips : 0

  return Math.max(publishedFlips, pairedFlips, normalizedMadeFlips)
}
