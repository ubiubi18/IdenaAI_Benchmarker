const crypto = require('crypto')
const path = require('path')
const fs = require('fs-extra')

const TRAINING_PACKAGE_REVIEW_STATUSES = new Set([
  'draft',
  'reviewed',
  'approved',
  'rejected',
])
const NO_FALLBACK = Symbol('no-local-ai-storage-fallback')

let appDataPath = null

try {
  // eslint-disable-next-line global-require
  appDataPath = require('../app-data-path')
} catch (error) {
  appDataPath = null
}

function resolveUserDataPath() {
  if (!appDataPath) {
    throw new Error('app-data-path is unavailable in this environment')
  }

  return appDataPath('userData')
}

function omitRawImageFields(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value
  }

  const next = {...value}

  delete next.images
  delete next.rawImage
  delete next.rawImages
  delete next.imageData
  delete next.base64
  delete next.dataUrl

  return next
}

function sanitizeCollectionItems(value, field) {
  if (!Array.isArray(value && value[field])) {
    return value
  }

  return {
    ...value,
    [field]: value[field].map((item) => omitRawImageFields(item)),
  }
}

function sanitizeForPersistence(filePath, obj) {
  const normalizedPath = String(filePath || '')

  if (normalizedPath.includes(`${path.sep}captures${path.sep}`)) {
    return sanitizeCollectionItems(omitRawImageFields(obj), 'captures')
  }

  if (normalizedPath.includes(`${path.sep}training-candidates${path.sep}`)) {
    return sanitizeCollectionItems(
      omitRawImageFields(normalizeTrainingCandidatePackage(obj)),
      'items'
    )
  }

  return obj
}

function normalizeTrainingPackageReviewStatus(value, fallback = 'draft') {
  const nextStatus = String(value || fallback)
    .trim()
    .toLowerCase()

  if (!TRAINING_PACKAGE_REVIEW_STATUSES.has(nextStatus)) {
    return fallback
  }

  return nextStatus
}

function getFederatedReadyFromReviewStatus(reviewStatus) {
  return (
    normalizeTrainingPackageReviewStatus(reviewStatus, 'draft') === 'approved'
  )
}

function normalizeTrainingPackageReviewedAt(value, reviewStatus) {
  if (reviewStatus === 'draft') {
    return null
  }

  const raw = String(value || '').trim()

  if (!raw) {
    return null
  }

  const nextDate = new Date(raw)

  if (!Number.isFinite(nextDate.getTime())) {
    return null
  }

  return nextDate.toISOString()
}

function normalizeTrainingCandidatePackage(packageData) {
  if (
    !packageData ||
    typeof packageData !== 'object' ||
    Array.isArray(packageData)
  ) {
    return packageData
  }

  const reviewStatus = normalizeTrainingPackageReviewStatus(
    packageData.reviewStatus,
    'draft'
  )

  return {
    ...packageData,
    reviewStatus,
    reviewedAt: normalizeTrainingPackageReviewedAt(
      packageData.reviewedAt,
      reviewStatus
    ),
    federatedReady: getFederatedReadyFromReviewStatus(reviewStatus),
  }
}

function createLocalAiStorage({
  baseDir,
  getUserDataPath = resolveUserDataPath,
} = {}) {
  function resolveBaseDir() {
    return baseDir || path.join(getUserDataPath(), 'local-ai')
  }

  function resolveLocalAiPath(...segments) {
    return path.join(resolveBaseDir(), ...segments)
  }

  async function ensureDir(dirPath) {
    await fs.ensureDir(dirPath)
    return dirPath
  }

  async function exists(filePath) {
    return fs.pathExists(filePath)
  }

  async function writeJsonAtomic(filePath, obj) {
    const targetPath = String(filePath || '').trim()

    if (!targetPath) {
      throw new Error('filePath is required')
    }

    const dirPath = path.dirname(targetPath)
    const tempPath = path.join(
      dirPath,
      `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.tmp`
    )

    await fs.ensureDir(dirPath)
    await fs.writeFile(
      tempPath,
      `${JSON.stringify(sanitizeForPersistence(targetPath, obj), null, 2)}\n`,
      'utf8'
    )

    try {
      await fs.move(tempPath, targetPath, {overwrite: true})
    } catch (error) {
      await fs.remove(tempPath).catch(() => {})
      throw error
    }

    return targetPath
  }

  async function readJson(filePath, fallbackValue) {
    try {
      return await fs.readJson(filePath)
    } catch (error) {
      if (error && error.code === 'ENOENT' && arguments.length > 1) {
        return fallbackValue
      }

      throw error
    }
  }

  async function readBuffer(filePath) {
    const targetPath = String(filePath || '').trim()

    if (!targetPath) {
      throw new Error('filePath is required')
    }

    return fs.readFile(targetPath)
  }

  async function readTrainingCandidatePackage(
    filePath,
    fallbackValue = NO_FALLBACK
  ) {
    try {
      return normalizeTrainingCandidatePackage(await readJson(filePath))
    } catch (error) {
      if (error && error.code === 'ENOENT' && fallbackValue !== NO_FALLBACK) {
        if (fallbackValue === null) {
          return null
        }

        return normalizeTrainingCandidatePackage(fallbackValue)
      }

      throw error
    }
  }

  async function updateTrainingCandidatePackageReview(filePath, review = {}) {
    const targetPath = String(filePath || '').trim()

    if (!targetPath) {
      throw new Error('filePath is required')
    }

    const reviewStatus = normalizeTrainingPackageReviewStatus(
      review.reviewStatus,
      ''
    )

    if (!TRAINING_PACKAGE_REVIEW_STATUSES.has(reviewStatus)) {
      throw new Error('reviewStatus is invalid')
    }

    const currentPackage = await readTrainingCandidatePackage(targetPath)
    const nextPackage = {
      ...currentPackage,
      reviewStatus,
      reviewedAt:
        reviewStatus === 'draft'
          ? null
          : normalizeTrainingPackageReviewedAt(
              review.reviewedAt || new Date().toISOString(),
              reviewStatus
            ),
      federatedReady: getFederatedReadyFromReviewStatus(reviewStatus),
    }

    await writeJsonAtomic(targetPath, nextPackage)

    return normalizeTrainingCandidatePackage(nextPackage)
  }

  async function writeBuffer(filePath, buffer) {
    const targetPath = String(filePath || '').trim()

    if (!targetPath) {
      throw new Error('filePath is required')
    }

    const nextBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)

    await fs.ensureDir(path.dirname(targetPath))
    await fs.writeFile(targetPath, nextBuffer)
    return targetPath
  }

  async function copyFile(sourcePath, targetPath) {
    const nextSourcePath = String(sourcePath || '').trim()
    const nextTargetPath = String(targetPath || '').trim()

    if (!nextSourcePath || !nextTargetPath) {
      throw new Error('sourcePath and targetPath are required')
    }

    await fs.ensureDir(path.dirname(nextTargetPath))
    await fs.copy(nextSourcePath, nextTargetPath, {overwrite: true})
    return nextTargetPath
  }

  async function fileSize(filePath) {
    const targetPath = String(filePath || '').trim()

    if (!targetPath) {
      throw new Error('filePath is required')
    }

    const stats = await fs.stat(targetPath)
    return Number(stats.size)
  }

  async function sha256File(filePath) {
    return sha256(await readBuffer(filePath))
  }

  function sha256(bufferOrString) {
    if (
      !Buffer.isBuffer(bufferOrString) &&
      typeof bufferOrString !== 'string'
    ) {
      throw new TypeError('sha256 expects a Buffer or string input')
    }

    return crypto.createHash('sha256').update(bufferOrString).digest('hex')
  }

  return {
    copyFile,
    ensureDir,
    exists,
    fileSize,
    readJson,
    readBuffer,
    readTrainingCandidatePackage,
    resolveLocalAiPath,
    sha256,
    sha256File,
    updateTrainingCandidatePackageReview,
    writeBuffer,
    writeJsonAtomic,
  }
}

module.exports = {
  createLocalAiStorage,
}
