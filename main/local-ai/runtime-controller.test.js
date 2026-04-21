const os = require('os')

const {
  createDefaultRuntimeController,
  resolveManagedLocalRuntimeFlavor,
  resolveManagedMolmo2RuntimeFlavor,
} = require('./runtime-controller')

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
})
