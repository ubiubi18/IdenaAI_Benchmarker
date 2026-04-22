import {decode} from 'rlp'

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => {
      reject(
        new Error(
          `Unable to load validation flip image${source ? ` (${source})` : ''}`
        )
      )
    }
    image.src = source
  })
}

function drawContain(context, image, target) {
  const sourceWidth = image.naturalWidth || image.width || target.width
  const sourceHeight = image.naturalHeight || image.height || target.height
  const ratio = Math.min(
    target.width / sourceWidth,
    target.height / sourceHeight
  )
  const drawWidth = sourceWidth * ratio
  const drawHeight = sourceHeight * ratio
  const offsetX = target.x + (target.width - drawWidth) / 2
  const offsetY = target.y + (target.height - drawHeight) / 2

  context.fillStyle = '#000000'
  context.fillRect(target.x, target.y, target.width, target.height)
  context.drawImage(image, offsetX, offsetY, drawWidth, drawHeight)
}

function resolveOrderedSources({images, order}) {
  return (
    Array.isArray(order) && order.length
      ? order.map((index) => images && images[index])
      : images || []
  ).filter(Boolean)
}

async function loadOrderedImages({images, order}) {
  const orderedSources = resolveOrderedSources({images, order})

  if (!orderedSources.length) {
    throw new Error('Flip has no image sources to compose')
  }

  return Promise.all(orderedSources.map((source) => loadImage(source)))
}

export async function composeStoryImage({images, order}) {
  const loadedImages = await loadOrderedImages({images, order})

  const frameWidth = 512
  const frameHeight = 384
  const canvas = document.createElement('canvas')
  canvas.width = frameWidth
  canvas.height = frameHeight * loadedImages.length

  const context = canvas.getContext('2d')
  context.fillStyle = '#000000'
  context.fillRect(0, 0, canvas.width, canvas.height)

  loadedImages.forEach((image, index) => {
    drawContain(context, image, {
      x: 0,
      y: frameHeight * index,
      width: frameWidth,
      height: frameHeight,
    })
  })

  return canvas.toDataURL('image/png')
}

export async function composeStoryFrames({images, order}) {
  const loadedImages = await loadOrderedImages({images, order})
  const frameWidth = 512
  const frameHeight = 384

  return loadedImages.map((image) => {
    const canvas = document.createElement('canvas')
    canvas.width = frameWidth
    canvas.height = frameHeight

    const context = canvas.getContext('2d')
    context.fillStyle = '#000000'
    context.fillRect(0, 0, canvas.width, canvas.height)

    drawContain(context, image, {
      x: 0,
      y: 0,
      width: frameWidth,
      height: frameHeight,
    })

    return canvas.toDataURL('image/png')
  })
}

function toObjectUrl(buffer) {
  const bytes = Uint8Array.from(buffer || [])
  return URL.createObjectURL(new Blob([bytes], {type: 'image/png'}))
}

function normalizeOrders(rawOrders) {
  if (!Array.isArray(rawOrders)) {
    return []
  }

  return rawOrders.map((order) =>
    Array.isArray(order) ? order.map(([idx = 0]) => idx) : []
  )
}

function normalizeExpectedAnswer(value) {
  const raw = String(value || '')
    .trim()
    .toLowerCase()
  if (!raw) {
    return null
  }
  if (raw === 'left' || raw === 'l') {
    return 'left'
  }
  if (raw === 'right' || raw === 'r') {
    return 'right'
  }
  if (raw === 'skip' || raw === 'report' || raw === 'inappropriate') {
    return 'skip'
  }
  return null
}

function resolveExpectedAnswer(item) {
  if (!item || typeof item !== 'object') {
    return null
  }

  const candidates = [
    item.expectedAnswer,
    item.expected_answer,
    item.consensusAnswer,
    item.humanConsensus,
    item.label,
    item.answer,
    item.target,
    item.correct,
    item.groundTruth,
    Array.isArray(item.agreed_answer) ? item.agreed_answer[0] : null,
    Array.isArray(item.agreedAnswer) ? item.agreedAnswer[0] : null,
  ]

  for (let index = 0; index < candidates.length; index += 1) {
    const normalized = normalizeExpectedAnswer(candidates[index])
    if (normalized) {
      return normalized
    }
  }

  return null
}

function decodeProtocolFlip({hex, publicHex, privateHex}) {
  let images
  let orders

  if (privateHex && privateHex !== '0x') {
    ;[images] = decode(publicHex || hex)
    let privateImages
    ;[privateImages, orders] = decode(privateHex)
    images = images.concat(privateImages)
  } else {
    ;[images, orders] = decode(hex)
  }

  return {
    images: (images || []).map((bytes) => toObjectUrl(bytes)),
    orders: normalizeOrders(orders),
  }
}

export async function decodedFlipToAiFlip({
  hash,
  images,
  orders,
  expectedAnswer,
}) {
  const flipHash = String(hash || '').trim()
  if (!flipHash) {
    throw new Error('Flip hash is required')
  }

  const leftOrder = Array.isArray(orders && orders[0]) ? orders[0] : []
  const rightOrder = Array.isArray(orders && orders[1]) ? orders[1] : []

  const leftImage = await composeStoryImage({images, order: leftOrder})
  const rightImage = await composeStoryImage({images, order: rightOrder})
  const leftFrames = await composeStoryFrames({images, order: leftOrder})
  const rightFrames = await composeStoryFrames({images, order: rightOrder})

  const result = {
    hash: flipHash,
    leftImage,
    rightImage,
    leftFrames,
    rightFrames,
  }
  const normalizedExpectedAnswer = normalizeExpectedAnswer(expectedAnswer)
  if (normalizedExpectedAnswer) {
    result.expectedAnswer = normalizedExpectedAnswer
  }
  return result
}

export async function protocolFlipToAiFlip(item, index = 0) {
  const hash =
    String(item && item.hash).trim() || `protocol-flip-${Date.now()}-${index}`

  const {images, orders} = decodeProtocolFlip(item || {})

  try {
    return await decodedFlipToAiFlip({
      hash,
      images,
      orders,
      expectedAnswer: resolveExpectedAnswer(item),
    })
  } finally {
    images.forEach((src) => {
      if (typeof src === 'string' && src.startsWith('blob:')) {
        URL.revokeObjectURL(src)
      }
    })
  }
}

function isAiReadyFlip(item) {
  return Boolean(item && item.leftImage && item.rightImage)
}

function isProtocolFlip(item) {
  return Boolean(item && (item.hex || item.publicHex))
}

function isDecodedFlip(item) {
  return Boolean(
    item && Array.isArray(item.images) && Array.isArray(item.orders)
  )
}

export async function normalizeInputFlip(item, index = 0) {
  if (isAiReadyFlip(item)) {
    const leftFrames = Array.isArray(item && item.leftFrames)
      ? item.leftFrames
          .slice(0, 4)
          .map((frame) => String(frame || '').trim())
          .filter(Boolean)
      : []
    const rightFrames = Array.isArray(item && item.rightFrames)
      ? item.rightFrames
          .slice(0, 4)
          .map((frame) => String(frame || '').trim())
          .filter(Boolean)
      : []

    const result = {
      hash:
        String(item.hash || '').trim() || `input-flip-${Date.now()}-${index}`,
      leftImage: String(item.leftImage),
      rightImage: String(item.rightImage),
    }
    if (leftFrames.length && rightFrames.length) {
      result.leftFrames = leftFrames
      result.rightFrames = rightFrames
    }
    const expectedAnswer = resolveExpectedAnswer(item)
    if (expectedAnswer) {
      result.expectedAnswer = expectedAnswer
    }
    return result
  }

  if (isProtocolFlip(item)) {
    return protocolFlipToAiFlip(item, index)
  }

  if (isDecodedFlip(item)) {
    const hash =
      String(item.hash || '').trim() || `decoded-flip-${Date.now()}-${index}`
    return decodedFlipToAiFlip({
      hash,
      images: item.images,
      orders: item.orders,
      expectedAnswer: resolveExpectedAnswer(item),
    })
  }

  throw new Error(
    'Unsupported flip format. Expected {leftImage,rightImage} or decrypted {hex/privateHex/publicHex} or {images,orders}.'
  )
}

export function extractInputFlipList(raw) {
  if (Array.isArray(raw)) {
    return raw
  }

  if (!raw || typeof raw !== 'object') {
    return []
  }

  if (Array.isArray(raw.flips)) {
    return raw.flips
  }

  if (Array.isArray(raw.result)) {
    return raw.result
  }

  if (raw.result && Array.isArray(raw.result.flips)) {
    return raw.result.flips
  }

  if (raw.result && typeof raw.result === 'object') {
    const {result} = raw
    if (
      isAiReadyFlip(result) ||
      isProtocolFlip(result) ||
      isDecodedFlip(result)
    ) {
      return [result]
    }
  }

  if (isAiReadyFlip(raw) || isProtocolFlip(raw) || isDecodedFlip(raw)) {
    return [raw]
  }

  const entries = Object.entries(raw)
  const mappedFlips = entries
    .map(([key, value]) => {
      if (!value || typeof value !== 'object') {
        return null
      }
      if (
        !(isAiReadyFlip(value) || isProtocolFlip(value) || isDecodedFlip(value))
      ) {
        return null
      }
      return {
        ...value,
        hash: String(value.hash || key).trim(),
      }
    })
    .filter(Boolean)

  if (mappedFlips.length) {
    return mappedFlips
  }

  return []
}

export async function normalizeInputFlips(raw) {
  const list = extractInputFlipList(raw)

  if (!list.length) {
    throw new Error(
      'No flips in provided payload. Expected an array, {flips:[...]}, or RPC envelope {result:{...}}.'
    )
  }

  const result = []
  // Parse sequentially to keep memory stable when importing many protocol flips.
  // eslint-disable-next-line no-restricted-syntax
  for (const [index, item] of list.entries()) {
    // eslint-disable-next-line no-await-in-loop
    result.push(await normalizeInputFlip(item, index))
  }

  return result
}

export async function normalizeInputFlipsInChunks(
  raw,
  {chunkSize = 8, onChunk} = {}
) {
  const list = extractInputFlipList(raw)

  if (!list.length) {
    throw new Error(
      'No flips in provided payload. Expected an array, {flips:[...]}, or RPC envelope {result:{...}}.'
    )
  }

  const safeChunkSize = Math.max(1, Number.parseInt(chunkSize, 10) || 8)
  const shouldCollect = typeof onChunk !== 'function'
  const all = shouldCollect ? [] : null
  let chunk = []

  for (const [index, item] of list.entries()) {
    // eslint-disable-next-line no-await-in-loop
    const normalized = await normalizeInputFlip(item, index)
    chunk.push(normalized)

    if (chunk.length >= safeChunkSize) {
      if (typeof onChunk === 'function') {
        // eslint-disable-next-line no-await-in-loop
        await onChunk(chunk, {
          processed: index + 1,
          total: list.length,
          done: index + 1 >= list.length,
        })
      }
      if (shouldCollect) {
        all.push(...chunk)
      }
      chunk = []
    }
  }

  if (chunk.length) {
    if (typeof onChunk === 'function') {
      await onChunk(chunk, {
        processed: list.length,
        total: list.length,
        done: true,
      })
    }
    if (shouldCollect) {
      all.push(...chunk)
    }
  }

  return shouldCollect ? all : []
}
