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
      items: [
        {
          flipHash: 'flip-a',
          epoch: 12,
          finalAnswer: 'left',
        },
      ],
    })
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
