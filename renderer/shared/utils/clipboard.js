export function getImageURLFromClipboard(
  maxWidth = 147 * 2,
  maxHeight = 110 * 2
) {
  if (
    !global.clipboard ||
    typeof global.clipboard.readImageDataUrl !== 'function'
  ) {
    return null
  }

  return global.clipboard.readImageDataUrl({
    maxWidth,
    maxHeight,
    softResize: true,
  })
}

export function writeImageURLToClipboard(url) {
  if (
    global.clipboard &&
    typeof global.clipboard.writeImageDataUrl === 'function'
  ) {
    global.clipboard.writeImageDataUrl(url)
  }
}
