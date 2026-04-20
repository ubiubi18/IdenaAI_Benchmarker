const os = require('os')

const {
  createDefaultRuntimeController,
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
})
