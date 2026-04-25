const os = require('os')
const path = require('path')
const fs = require('fs-extra')

const {
  buildManagedLocalAiServerArgs,
  buildManagedRuntimeEnv,
  createDefaultRuntimeController,
  estimateManagedRuntimeInstallBytes,
  resolveManagedLocalRuntimeFlavor,
  resolveManagedMolmo2RuntimeFlavor,
  sha256File,
} = require('./runtime-controller')

describe('managed local runtime server args', () => {
  it('does not force trust_remote_code for managed runtimes', () => {
    const args = buildManagedLocalAiServerArgs({
      backend: 'transformers',
      host: '127.0.0.1',
      port: 11436,
      modelPath: '/tmp/model-snapshot',
      displayModelId: 'OpenGVLab/InternVL3_5-1B-HF',
      modelRevision: '123abc',
    })

    expect(args).toEqual([
      path.resolve(__dirname, '..', '..', 'scripts', 'local_ai_server.py'),
      '--backend',
      'transformers',
      '--host',
      '127.0.0.1',
      '--port',
      '11436',
      '--model',
      '/tmp/model-snapshot',
      '--display-model-id',
      'OpenGVLab/InternVL3_5-1B-HF',
      '--model-revision',
      '123abc',
    ])
    expect(args).not.toContain('--trust-remote-code')
  })
})

describe('managed local runtime environment', () => {
  it('disables Xet for managed downloads and runtime startup', () => {
    const env = buildManagedRuntimeEnv('/tmp/idena-managed-runtime')

    expect(env).toMatchObject({
      HF_HOME: '/tmp/idena-managed-runtime/hf-home',
      HUGGINGFACE_HUB_CACHE: '/tmp/idena-managed-runtime/hf-home/hub',
      TRANSFORMERS_CACHE: '/tmp/idena-managed-runtime/hf-home/transformers',
      HF_HUB_DISABLE_TELEMETRY: '1',
      HF_HUB_DISABLE_XET: '1',
      PYTHONUNBUFFERED: '1',
    })
  })
})

describe('managed local runtime hashing', () => {
  it('hashes files via stream instead of loading them into memory', async () => {
    const filePath = path.join(
      os.tmpdir(),
      `idena-managed-runtime-hash-${Date.now()}.txt`
    )
    const readFileSpy = jest.spyOn(fs, 'readFile')

    await fs.writeFile(filePath, 'stream me')

    await expect(sha256File(filePath)).resolves.toBe(
      '072e61241ebf17f37fd33dbe578b6819619f17cd56144512a070999cfb4bdd40'
    )
    expect(readFileSpy).not.toHaveBeenCalled()

    await fs.remove(filePath)
  })
})

describe('managed local runtime flavor selection', () => {
  const originalPlatform = process.platform
  const originalArch = process.arch

  afterEach(() => {
    jest.restoreAllMocks()
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      configurable: true,
    })
    Object.defineProperty(process, 'arch', {
      value: originalArch,
      configurable: true,
    })
  })

  it('uses mlx-vlm on Apple Silicon even under Rosetta', () => {
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      configurable: true,
    })
    Object.defineProperty(process, 'arch', {
      value: 'x64',
      configurable: true,
    })
    jest.spyOn(os, 'cpus').mockReturnValue([{model: 'Apple M1 Max'}])

    expect(resolveManagedMolmo2RuntimeFlavor()).toBe('mlx-vlm')
  })

  it('keeps transformers on non-Apple or non-macOS hosts', () => {
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      configurable: true,
    })
    Object.defineProperty(process, 'arch', {
      value: 'x64',
      configurable: true,
    })
    jest.spyOn(os, 'cpus').mockReturnValue([{model: 'Intel(R) Core(TM) i9'}])

    expect(resolveManagedMolmo2RuntimeFlavor()).toBe('transformers')
  })

  it('forces transformers for the InternVL3.5-8B managed runtime on Apple Silicon', () => {
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      configurable: true,
    })
    Object.defineProperty(process, 'arch', {
      value: 'arm64',
      configurable: true,
    })
    jest.spyOn(os, 'cpus').mockReturnValue([{model: 'Apple M3 Max'}])

    expect(
      resolveManagedLocalRuntimeFlavor({
        preferredFlavor: 'transformers',
        supportsMlx: false,
      })
    ).toBe('transformers')
  })

  it('estimates a larger managed install footprint for larger pinned snapshots', () => {
    const lightInstallBytes = estimateManagedRuntimeInstallBytes(
      {
        verifyFiles: {
          'model.safetensors': {
            size: String(2 * 1024 * 1024 * 1024),
          },
        },
      },
      'transformers'
    )
    const heavyInstallBytes = estimateManagedRuntimeInstallBytes(
      {
        verifyFiles: {
          'model-00001-of-00002.safetensors': {
            size: String(8 * 1024 * 1024 * 1024),
          },
          'model-00002-of-00002.safetensors': {
            size: String(8 * 1024 * 1024 * 1024),
          },
        },
      },
      'transformers'
    )

    expect(heavyInstallBytes).toBeGreaterThan(lightInstallBytes)
  })

  it('requires explicit trust approval before starting the managed Molmo2 runtime', async () => {
    const controller = createDefaultRuntimeController()

    await expect(
      controller.start({
        runtimeBackend: 'local-runtime-service',
        runtimeFamily: 'molmo2-o',
        baseUrl: 'http://127.0.0.1:8080',
        model: 'allenai/Molmo2-O-7B',
      })
    ).rejects.toMatchObject({
      code: 'managed_runtime_trust_required',
    })
  })

  it('requires explicit trust approval before starting the compact managed Molmo2-4B runtime', async () => {
    const controller = createDefaultRuntimeController()

    await expect(
      controller.start({
        runtimeBackend: 'local-runtime-service',
        runtimeFamily: 'molmo2-4b',
        baseUrl: 'http://127.0.0.1:8080',
        model: 'allenai/Molmo2-4B',
      })
    ).rejects.toMatchObject({
      code: 'managed_runtime_trust_required',
    })
  })

  it('requires explicit trust approval before starting the experimental InternVL3.5-8B runtime', async () => {
    const controller = createDefaultRuntimeController()

    await expect(
      controller.start({
        runtimeBackend: 'local-runtime-service',
        runtimeFamily: 'internvl3.5-8b',
        baseUrl: 'http://127.0.0.1:8080',
        model: 'OpenGVLab/InternVL3_5-8B-HF',
      })
    ).rejects.toMatchObject({
      code: 'managed_runtime_trust_required',
    })
  })

  it('requires explicit trust approval before starting the light InternVL3.5-1B runtime', async () => {
    const controller = createDefaultRuntimeController()

    await expect(
      controller.start({
        runtimeBackend: 'local-runtime-service',
        runtimeFamily: 'internvl3.5-1b',
        baseUrl: 'http://127.0.0.1:8080',
        model: 'OpenGVLab/InternVL3_5-1B-HF',
      })
    ).rejects.toMatchObject({
      code: 'managed_runtime_trust_required',
    })
  })

  it('rejects unsafe Ollama executable path overrides', async () => {
    const controller = createDefaultRuntimeController()

    await expect(
      controller.start({
        runtimeBackend: 'ollama-direct',
        baseUrl: 'http://127.0.0.1:11434',
        ollamaCommandPath: '/bin/sh',
      })
    ).rejects.toMatchObject({
      code: 'invalid_ollama_command_path',
    })
  })

  it('rejects unsafe managed Python executable path overrides', async () => {
    const baseDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'idena-managed-runtime-python-path-')
    )
    const controller = createDefaultRuntimeController({baseDir})
    const statfsSpy = jest
      .spyOn(fs.promises, 'statfs')
      .mockResolvedValue({bavail: 1024 * 1024 * 1024, bsize: 4096})

    await expect(
      controller.start({
        runtimeBackend: 'local-runtime-service',
        runtimeFamily: 'molmo2-o',
        baseUrl: 'http://127.0.0.1:8080',
        model: 'allenai/Molmo2-O-7B',
        managedRuntimeTrustVersion: 2,
        managedRuntimePythonPath: '/bin/bash',
      })
    ).rejects.toMatchObject({
      code: 'invalid_python_command_path',
    })

    expect(statfsSpy).toHaveBeenCalled()

    await fs.remove(baseDir)
  })

  it('fails early when the managed runtime does not have enough free disk space', async () => {
    const baseDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'idena-managed-runtime-disk-space-')
    )
    const controller = createDefaultRuntimeController({baseDir})
    const statfsSpy = jest
      .spyOn(fs.promises, 'statfs')
      .mockResolvedValue({bavail: 1024, bsize: 4096})

    await expect(
      controller.start({
        runtimeBackend: 'local-runtime-service',
        runtimeFamily: 'internvl3.5-8b',
        baseUrl: 'http://127.0.0.1:8080',
        model: 'OpenGVLab/InternVL3_5-8B-HF',
        managedRuntimeTrustVersion: 2,
      })
    ).rejects.toMatchObject({
      code: 'managed_runtime_disk_space_low',
    })

    expect(statfsSpy).toHaveBeenCalled()

    await fs.remove(baseDir)
  })
})
