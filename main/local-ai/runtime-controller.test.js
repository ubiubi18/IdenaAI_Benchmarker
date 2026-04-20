const os = require('os')

const {resolveManagedMolmo2RuntimeFlavor} = require('./runtime-controller')

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
})
