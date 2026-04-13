const os = require('os')
const path = require('path')
const fs = require('fs-extra')

const {createLocalAiStorage} = require('./storage')

describe('local-ai storage', () => {
  let tempDir
  let storage

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'idena-local-ai-'))
    storage = createLocalAiStorage({
      baseDir: path.join(tempDir, 'local-ai'),
    })
  })

  afterEach(async () => {
    await fs.remove(tempDir)
  })

  it('writes json atomically and reads fallback values', async () => {
    const filePath = storage.resolveLocalAiPath('captures', 'index.json')

    await expect(storage.readJson(filePath, {ok: false})).resolves.toEqual({
      ok: false,
    })

    await storage.writeJsonAtomic(filePath, {ok: true, items: ['flip-a']})

    await expect(storage.exists(filePath)).resolves.toBe(true)
    await expect(storage.readJson(filePath)).resolves.toEqual({
      ok: true,
      items: ['flip-a'],
    })
  })

  it('creates parent directories safely and leaves no temp file behind after atomic writes', async () => {
    const dirPath = storage.resolveLocalAiPath('nested', 'captures')
    const filePath = storage.resolveLocalAiPath(
      'nested',
      'captures',
      'state.json'
    )

    await expect(storage.ensureDir(dirPath)).resolves.toBe(dirPath)
    await storage.writeJsonAtomic(filePath, {ok: true})

    await expect(storage.exists(dirPath)).resolves.toBe(true)
    await expect(storage.exists(filePath)).resolves.toBe(true)
    await expect(fs.readdir(path.dirname(filePath))).resolves.toEqual(
      expect.not.arrayContaining([
        expect.stringMatching(/^\.state\.json\..+\.tmp$/),
      ])
    )
  })

  it('omits raw image-like fields from persisted capture metadata', async () => {
    const filePath = storage.resolveLocalAiPath('captures', 'index.json')

    await storage.writeJsonAtomic(filePath, {
      capturedCount: 1,
      images: ['data:image/png;base64,AAA='],
      captures: [
        {
          flipHash: 'flip-a',
          epoch: 12,
          panelCount: 2,
          images: ['left', 'right'],
          rawImage: 'opaque',
          rawImages: ['opaque-a', 'opaque-b'],
          imageData: 'opaque-image-data',
          base64: 'opaque-base64',
          dataUrl: 'data:image/png;base64,BBB=',
        },
      ],
    })

    await expect(storage.readJson(filePath)).resolves.toEqual({
      capturedCount: 1,
      captures: [
        {
          flipHash: 'flip-a',
          epoch: 12,
          panelCount: 2,
        },
      ],
    })
  })

  it('omits raw image-like fields from persisted training-candidate packages', async () => {
    const filePath = storage.resolveLocalAiPath(
      'training-candidates',
      'epoch-12-candidates.json'
    )

    await storage.writeJsonAtomic(filePath, {
      eligibleCount: 1,
      images: ['data:image/png;base64,AAA='],
      items: [
        {
          flipHash: 'flip-a',
          epoch: 12,
          finalAnswer: 'left',
          images: ['left', 'right'],
          rawImage: 'opaque',
          rawImages: ['opaque-a', 'opaque-b'],
          imageData: 'opaque-image-data',
          base64: 'opaque-base64',
          dataUrl: 'data:image/png;base64,BBB=',
        },
      ],
    })

    await expect(storage.readJson(filePath)).resolves.toEqual({
      eligibleCount: 1,
      reviewStatus: 'draft',
      reviewedAt: null,
      federatedReady: false,
      items: [
        {
          flipHash: 'flip-a',
          epoch: 12,
          finalAnswer: 'left',
        },
      ],
    })
  })

  it('treats existing packages without reviewStatus as draft', async () => {
    const filePath = storage.resolveLocalAiPath(
      'training-candidates',
      'epoch-12-candidates.json'
    )

    await storage.writeJsonAtomic(filePath, {
      schemaVersion: 1,
      epoch: 12,
      eligibleCount: 1,
      excludedCount: 0,
      items: [],
      excluded: [],
    })

    await expect(
      storage.readTrainingCandidatePackage(filePath)
    ).resolves.toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        epoch: 12,
        reviewStatus: 'draft',
        reviewedAt: null,
        federatedReady: false,
      })
    )
  })

  it('persists reviewed package status updates', async () => {
    const filePath = storage.resolveLocalAiPath(
      'training-candidates',
      'epoch-12-candidates.json'
    )

    await storage.writeJsonAtomic(filePath, {
      schemaVersion: 1,
      epoch: 12,
      reviewStatus: 'draft',
      reviewedAt: null,
      eligibleCount: 1,
      excludedCount: 0,
      items: [],
      excluded: [],
    })

    const result = await storage.updateTrainingCandidatePackageReview(
      filePath,
      {
        reviewStatus: 'reviewed',
      }
    )

    expect(result).toEqual(
      expect.objectContaining({
        reviewStatus: 'reviewed',
        reviewedAt: expect.any(String),
        federatedReady: false,
      })
    )
    await expect(
      storage.readTrainingCandidatePackage(filePath)
    ).resolves.toEqual(
      expect.objectContaining({
        reviewStatus: 'reviewed',
        reviewedAt: expect.any(String),
        federatedReady: false,
      })
    )
  })

  it('persists approved package status updates', async () => {
    const filePath = storage.resolveLocalAiPath(
      'training-candidates',
      'epoch-12-candidates.json'
    )

    await storage.writeJsonAtomic(filePath, {
      schemaVersion: 1,
      epoch: 12,
      reviewStatus: 'draft',
      reviewedAt: null,
      eligibleCount: 1,
      excludedCount: 0,
      items: [],
      excluded: [],
    })

    await storage.updateTrainingCandidatePackageReview(filePath, {
      reviewStatus: 'approved',
    })

    await expect(
      storage.readTrainingCandidatePackage(filePath)
    ).resolves.toEqual(
      expect.objectContaining({
        reviewStatus: 'approved',
        reviewedAt: expect.any(String),
        federatedReady: true,
      })
    )
  })

  it('persists rejected package status updates', async () => {
    const filePath = storage.resolveLocalAiPath(
      'training-candidates',
      'epoch-12-candidates.json'
    )

    await storage.writeJsonAtomic(filePath, {
      schemaVersion: 1,
      epoch: 12,
      reviewStatus: 'draft',
      reviewedAt: null,
      eligibleCount: 1,
      excludedCount: 0,
      items: [],
      excluded: [],
    })

    await storage.updateTrainingCandidatePackageReview(filePath, {
      reviewStatus: 'rejected',
    })

    await expect(
      storage.readTrainingCandidatePackage(filePath)
    ).resolves.toEqual(
      expect.objectContaining({
        reviewStatus: 'rejected',
        reviewedAt: expect.any(String),
        federatedReady: false,
      })
    )
  })

  it('resets federatedReady when an approved package is changed back to reviewed', async () => {
    const filePath = storage.resolveLocalAiPath(
      'training-candidates',
      'epoch-12-candidates.json'
    )

    await storage.writeJsonAtomic(filePath, {
      schemaVersion: 1,
      epoch: 12,
      reviewStatus: 'approved',
      reviewedAt: '2026-01-01T00:00:00.000Z',
      federatedReady: true,
      eligibleCount: 1,
      excludedCount: 0,
      items: [],
      excluded: [],
    })

    await storage.updateTrainingCandidatePackageReview(filePath, {
      reviewStatus: 'reviewed',
    })

    await expect(
      storage.readTrainingCandidatePackage(filePath)
    ).resolves.toEqual(
      expect.objectContaining({
        reviewStatus: 'reviewed',
        reviewedAt: expect.any(String),
        federatedReady: false,
      })
    )
  })

  it('hashes strings and buffers', () => {
    expect(storage.sha256('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
    )
    expect(storage.sha256(Buffer.from('hello'))).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
    )
  })
})
