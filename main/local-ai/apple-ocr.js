const fs = require('fs-extra')
const os = require('os')
const path = require('path')
const {execFile} = require('child_process')
const {promisify} = require('util')

const execFileAsync = promisify(execFile)
const OCR_SWIFT_SCRIPT = path.resolve(__dirname, 'apple-ocr.swift')

function decodeImagePayload(value) {
  if (Buffer.isBuffer(value)) {
    return {buffer: value, extension: '.png'}
  }

  const text = String(value || '').trim()
  if (!text) {
    return null
  }

  const dataUrlMatch = text.match(
    /^data:image\/([a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/
  )

  if (dataUrlMatch) {
    const subtype = String(dataUrlMatch[1] || '').toLowerCase()
    let extension = '.png'

    if (subtype === 'jpeg' || subtype === 'jpg') {
      extension = '.jpg'
    } else if (subtype === 'webp') {
      extension = '.webp'
    }

    return {
      buffer: Buffer.from(dataUrlMatch[2].replace(/\s+/g, ''), 'base64'),
      extension,
    }
  }

  if (/^[A-Za-z0-9+/=\s]+$/.test(text) && text.length > 64) {
    return {
      buffer: Buffer.from(text.replace(/\s+/g, ''), 'base64'),
      extension: '.png',
    }
  }

  return null
}

function extractRawImages(messages = []) {
  if (!Array.isArray(messages)) {
    return []
  }

  return messages.flatMap((message) => {
    const images = Array.isArray(message && message.images)
      ? message.images
      : []
    return images
      .map((item) => {
        if (
          item &&
          typeof item === 'object' &&
          !Array.isArray(item) &&
          !Buffer.isBuffer(item)
        ) {
          return (
            item.dataUrl ||
            item.imageDataUrl ||
            item.image ||
            item.src ||
            item.base64 ||
            ''
          )
        }

        return item
      })
      .filter(Boolean)
  })
}

async function runAppleVisionOcr(rawImages = []) {
  if (
    process.platform !== 'darwin' ||
    !Array.isArray(rawImages) ||
    rawImages.length === 0
  ) {
    return {
      ok: false,
      error: 'ocr_unavailable',
      lastError:
        'Apple Vision OCR is only available on macOS with attached images.',
      entries: [],
      text: '',
    }
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'idena-ocr-'))

  try {
    const imagePaths = []

    for (const [index, rawImage] of rawImages.entries()) {
      const decoded = decodeImagePayload(rawImage)
      if (decoded && decoded.buffer && decoded.buffer.length > 0) {
        const nextPath = path.join(
          tempDir,
          `image-${index + 1}${decoded.extension || '.png'}`
        )
        // eslint-disable-next-line no-await-in-loop
        await fs.writeFile(nextPath, decoded.buffer, {mode: 0o600})
        imagePaths.push(nextPath)
      }
    }

    if (imagePaths.length === 0) {
      return {
        ok: false,
        error: 'ocr_image_required',
        lastError: 'No OCR-compatible images were attached.',
        entries: [],
        text: '',
      }
    }

    const {stdout} = await execFileAsync(
      'swift',
      [OCR_SWIFT_SCRIPT, ...imagePaths],
      {
        timeout: 20000,
        maxBuffer: 4 * 1024 * 1024,
      }
    )
    const parsed = JSON.parse(String(stdout || '[]'))
    const entries = Array.isArray(parsed) ? parsed : []
    const text = entries
      .map((entry) => String((entry && entry.text) || '').trim())
      .filter(Boolean)
      .join('\n\n')
      .trim()

    return {
      ok: Boolean(text),
      entries,
      text,
      error: text ? null : 'ocr_empty',
      lastError: text ? null : 'Apple Vision OCR did not detect visible text.',
    }
  } catch (error) {
    return {
      ok: false,
      entries: [],
      text: '',
      error: 'ocr_failed',
      lastError: String(
        (error && error.message) || error || 'Apple Vision OCR failed'
      ),
    }
  } finally {
    await fs.remove(tempDir)
  }
}

module.exports = {
  extractRawImages,
  runAppleVisionOcr,
}
