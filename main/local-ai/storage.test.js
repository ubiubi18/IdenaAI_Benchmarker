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

  it('hashes strings and buffers', () => {
    expect(storage.sha256('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
    )
    expect(storage.sha256(Buffer.from('hello'))).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
    )
  })
})
