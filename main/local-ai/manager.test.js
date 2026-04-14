const os = require('os')
const path = require('path')
const fs = require('fs-extra')

const {createLocalAiStorage} = require('./storage')
const {createLocalAiManager} = require('./manager')
const {
  LOCAL_AI_BASE_MODEL_ID,
  LOCAL_AI_CONTRACT_VERSION,
  LOCAL_AI_PUBLIC_MODEL_ID,
  LOCAL_AI_PUBLIC_VISION_ID,
  LOCAL_AI_REASONER_BACKEND,
  LOCAL_AI_RUNTIME_BACKEND,
  LOCAL_AI_VISION_BACKEND,
} = require('./constants')

function mockLogger() {
  return {
    debug: jest.fn(),
    error: jest.fn(),
  }
}

describe('local-ai manager', () => {
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

  it('skips explicitly ineligible captures when consensus signals are available', async () => {
    const logger = mockLogger()
    const manager = createLocalAiManager({logger, storage, isDev: true})

    await expect(
      manager.captureFlip({
        flipHash: 'flip-reported',
        epoch: 12,
        sessionType: 'short',
        images: ['left', 'right'],
        consensus: {
          finalAnswer: 'left',
          reported: true,
        },
      })
    ).resolves.toMatchObject({
      ok: false,
      skipped: true,
      reasons: ['reported'],
      capturedCount: 0,
    })

    await expect(
      manager.captureFlip({
        flipHash: 'flip-unresolved',
        epoch: 12,
        sessionType: 'short',
        images: ['left', 'right'],
        consensus: {},
      })
    ).resolves.toMatchObject({
      ok: false,
      skipped: true,
      reasons: ['missing_consensus'],
      capturedCount: 0,
    })

    await expect(
      manager.captureFlip({
        flipHash: 'flip-invalid',
        epoch: 12,
        sessionType: 'short',
        images: ['left', 'right'],
        consensus: {
          finalAnswerAfterRemap: 'skip',
          reported: false,
        },
      })
    ).resolves.toMatchObject({
      ok: false,
      skipped: true,
      reasons: ['invalid_consensus'],
      capturedCount: 0,
    })

    await manager.captureFlip({
      flipHash: 'flip-unknown',
      epoch: 12,
      sessionType: 'short',
      images: ['left', 'right'],
    })

    const captureIndex = await storage.readJson(
      storage.resolveLocalAiPath('captures', 'index.json')
    )

    expect(captureIndex.capturedCount).toBe(1)
    expect(captureIndex.captures).toEqual([
      expect.objectContaining({
        flipHash: 'flip-unknown',
        epoch: 12,
        panelCount: 2,
      }),
    ])
  })

  it('persists capture metadata and builds a conservative epoch manifest', async () => {
    const logger = mockLogger()
    const manager = createLocalAiManager({logger, storage})

    await manager.captureFlip({
      flipHash: 'flip-a',
      epoch: 12,
      sessionType: 'short',
      images: ['left', 'right'],
      consensus: {
        finalAnswer: 'left',
        reported: false,
      },
    })
    await manager.captureFlip({
      flipHash: 'flip-b',
      epoch: 12,
      sessionType: 'short',
      images: ['left', 'right'],
    })
    await manager.captureFlip({
      flipHash: 'flip-d',
      epoch: 13,
      sessionType: 'short',
      images: ['left', 'right'],
      consensus: {
        finalAnswer: 'left',
        reported: false,
      },
    })

    const rehydrated = createLocalAiManager({logger: mockLogger(), storage})

    await expect(rehydrated.status()).resolves.toMatchObject({
      capturedCount: 3,
      running: false,
    })

    const summary = await rehydrated.buildManifest(12)
    const manifest = await storage.readJson(summary.manifestPath)
    const captureIndex = await storage.readJson(
      storage.resolveLocalAiPath('captures', 'index.json')
    )

    expect(summary).toMatchObject({
      epoch: 12,
      eligibleCount: 1,
      excludedCount: 2,
    })
    expect(manifest).toMatchObject({
      epoch: 12,
      publicModelId: LOCAL_AI_PUBLIC_MODEL_ID,
      publicVisionId: LOCAL_AI_PUBLIC_VISION_ID,
      runtimeBackend: LOCAL_AI_RUNTIME_BACKEND,
      reasonerBackend: LOCAL_AI_REASONER_BACKEND,
      visionBackend: LOCAL_AI_VISION_BACKEND,
      contractVersion: LOCAL_AI_CONTRACT_VERSION,
      baseModelId: LOCAL_AI_BASE_MODEL_ID,
      baseModelHash: storage.sha256(LOCAL_AI_BASE_MODEL_ID),
      deltaType: 'pending_adapter',
      adapterFormat: 'peft_lora_v1',
      adapterSha256: null,
      trainingConfigHash: expect.any(String),
      eligibleFlipHashes: ['flip-a'],
      flipCount: 1,
      skippedCount: 2,
    })
    expect(manifest.excluded).toEqual(
      expect.arrayContaining([
        {flipHash: 'flip-b', reasons: ['missing_consensus']},
        {flipHash: 'flip-d', reasons: ['epoch_mismatch']},
      ])
    )
    expect(manifest.inconsistencyFlags).toEqual(
      expect.arrayContaining([
        'contains_unresolved_captures',
        'contains_other_epoch_captures',
      ])
    )
    expect(captureIndex.capturedCount).toBe(3)
    expect(captureIndex.captures[0]).toEqual(
      expect.objectContaining({
        flipHash: 'flip-a',
        epoch: 12,
        panelCount: 2,
        timestamp: expect.any(Number),
      })
    )
    expect(JSON.stringify(captureIndex)).not.toContain('"images"')
  })

  it('promotes manifests to a concrete adapter contract when a local adapter artifact is registered', async () => {
    const logger = mockLogger()
    const manager = createLocalAiManager({logger, storage})

    await manager.captureFlip({
      flipHash: 'flip-a',
      epoch: 12,
      sessionType: 'short',
      images: ['left', 'right'],
      consensus: {
        finalAnswer: 'left',
        reported: false,
      },
    })

    await storage.writeJsonAtomic(
      storage.resolveLocalAiPath('adapters', 'epoch-12.json'),
      {
        epoch: 12,
        baseModelId: LOCAL_AI_BASE_MODEL_ID,
        baseModelHash: storage.sha256(LOCAL_AI_BASE_MODEL_ID),
        adapterFormat: 'peft_lora_v1',
        adapterSha256: 'adapter-sha-epoch-12',
        trainingConfigHash: 'training-config-epoch-12',
        adapterArtifact: {
          file: 'epoch-12-lora.safetensors',
          sizeBytes: 2048,
        },
      }
    )

    const summary = await manager.buildManifest(12)
    const manifest = await storage.readJson(summary.manifestPath)

    expect(manifest).toMatchObject({
      epoch: 12,
      deltaType: 'lora_adapter',
      adapterFormat: 'peft_lora_v1',
      adapterSha256: 'adapter-sha-epoch-12',
      trainingConfigHash: 'training-config-epoch-12',
      adapterArtifact: {
        file: 'epoch-12-lora.safetensors',
        sizeBytes: 2048,
      },
    })
  })

  it('registers and reloads adapter artifacts from a local file', async () => {
    const logger = mockLogger()
    const manager = createLocalAiManager({logger, storage})
    const sourcePath = storage.resolveLocalAiPath(
      'artifacts',
      'epoch-12-registration.safetensors'
    )
    const adapterBuffer = Buffer.from('registered-adapter-bytes')

    await storage.writeBuffer(sourcePath, adapterBuffer)

    const registered = await manager.registerAdapterArtifact({
      epoch: 12,
      sourcePath,
    })
    const reloaded = await manager.loadAdapterArtifact({epoch: 12})

    expect(registered).toMatchObject({
      epoch: 12,
      adapterManifestPath: storage.resolveLocalAiPath(
        'adapters',
        'epoch-12.json'
      ),
      baseModelId: LOCAL_AI_BASE_MODEL_ID,
      deltaType: 'lora_adapter',
      adapterFormat: 'peft_lora_v1',
      adapterSha256: storage.sha256(adapterBuffer),
      adapterArtifact: {
        file: 'epoch-12-registration.safetensors',
        sourcePath,
        sizeBytes: adapterBuffer.length,
      },
    })
    expect(reloaded).toMatchObject({
      epoch: 12,
      adapterManifestPath: storage.resolveLocalAiPath(
        'adapters',
        'epoch-12.json'
      ),
      deltaType: 'lora_adapter',
      adapterSha256: storage.sha256(adapterBuffer),
      adapterArtifact: {
        file: 'epoch-12-registration.safetensors',
        sourcePath,
        sizeBytes: adapterBuffer.length,
      },
    })
  })

  it('builds a local post-consensus training-candidate package conservatively', async () => {
    const captureIndexPath = storage.resolveLocalAiPath(
      'captures',
      'index.json'
    )

    await storage.writeJsonAtomic(captureIndexPath, {
      version: 1,
      capturedCount: 4,
      captures: [
        {
          flipHash: 'flip-a',
          epoch: 12,
          sessionType: 'short',
          panelCount: 2,
          timestamp: 1710000000000,
          capturedAt: '2026-01-01T00:00:00.000Z',
          consensus: {
            finalAnswer: 'left',
            reported: false,
          },
          rawImage: 'opaque',
        },
        {
          flipHash: 'flip-b',
          epoch: 12,
          sessionType: 'short',
          panelCount: 2,
          timestamp: 1710000001000,
          capturedAt: '2026-01-01T00:01:00.000Z',
        },
        {
          flipHash: 'flip-c',
          epoch: 12,
          sessionType: 'short',
          panelCount: 2,
          timestamp: 1710000002000,
          capturedAt: '2026-01-01T00:02:00.000Z',
          consensus: {
            finalAnswer: 'right',
            reported: true,
          },
        },
        {
          flipHash: 'flip-d',
          epoch: 12,
          sessionType: 'short',
          panelCount: 2,
          timestamp: 1710000003000,
          capturedAt: '2026-01-01T00:03:00.000Z',
          consensus: {
            finalAnswer: 'skip',
            reported: false,
          },
        },
      ],
    })

    const manager = createLocalAiManager({logger: mockLogger(), storage})
    const summary = await manager.buildTrainingCandidatePackage(12)
    const candidatePackage = await storage.readJson(summary.packagePath)

    expect(summary).toMatchObject({
      epoch: 12,
      eligibleCount: 1,
      excludedCount: 3,
    })
    expect(candidatePackage).toMatchObject({
      schemaVersion: 1,
      packageType: 'local-ai-training-candidates',
      epoch: 12,
      publicModelId: LOCAL_AI_PUBLIC_MODEL_ID,
      publicVisionId: LOCAL_AI_PUBLIC_VISION_ID,
      runtimeBackend: LOCAL_AI_RUNTIME_BACKEND,
      reasonerBackend: LOCAL_AI_REASONER_BACKEND,
      visionBackend: LOCAL_AI_VISION_BACKEND,
      contractVersion: LOCAL_AI_CONTRACT_VERSION,
      baseModelId: LOCAL_AI_BASE_MODEL_ID,
      baseModelHash: storage.sha256(LOCAL_AI_BASE_MODEL_ID),
      deltaType: 'pending_adapter',
      adapterFormat: 'peft_lora_v1',
      adapterSha256: null,
      trainingConfigHash: expect.any(String),
      reviewStatus: 'draft',
      reviewedAt: null,
      federatedReady: false,
      eligibleCount: 1,
      excludedCount: 3,
    })
    expect(candidatePackage.items).toEqual([
      {
        flipHash: 'flip-a',
        epoch: 12,
        sessionType: 'short',
        panelCount: 2,
        timestamp: 1710000000000,
        capturedAt: '2026-01-01T00:00:00.000Z',
        finalAnswer: 'left',
      },
    ])
    expect(candidatePackage.excluded).toEqual(
      expect.arrayContaining([
        {flipHash: 'flip-b', reasons: ['missing_consensus']},
        {flipHash: 'flip-c', reasons: ['reported']},
        {flipHash: 'flip-d', reasons: ['invalid_consensus']},
      ])
    )
    expect(candidatePackage.inconsistencyFlags).toEqual(
      expect.arrayContaining([
        'contains_unresolved_captures',
        'contains_reported_captures',
        'contains_invalid_consensus',
      ])
    )
    expect(JSON.stringify(candidatePackage)).not.toContain('"images"')
    expect(JSON.stringify(candidatePackage)).not.toContain('"rawImage"')
  })

  it('skips malformed eligible items without crashing training-candidate packaging', async () => {
    const logger = mockLogger()
    const captureIndexPath = storage.resolveLocalAiPath(
      'captures',
      'index.json'
    )

    await storage.writeJsonAtomic(captureIndexPath, {
      version: 1,
      capturedCount: 2,
      captures: [
        {
          flipHash: 'flip-a',
          epoch: 12,
          sessionType: 'short',
          panelCount: 2,
          timestamp: 1710000000000,
          capturedAt: '2026-01-01T00:00:00.000Z',
          consensus: {
            finalAnswer: 'left',
            reported: false,
          },
        },
        {
          flipHash: 'flip-b',
          epoch: 12,
          sessionType: 'short',
          panelCount: 2,
          timestamp: 1710000001000,
          capturedAt: 'not-a-date',
          consensus: {
            finalAnswer: 'right',
            reported: false,
          },
        },
      ],
    })

    const manager = createLocalAiManager({logger, storage})
    const summary = await manager.buildTrainingCandidatePackage(12)
    const candidatePackage = await storage.readJson(summary.packagePath)

    expect(summary).toMatchObject({
      epoch: 12,
      eligibleCount: 1,
      excludedCount: 1,
    })
    expect(candidatePackage.items).toHaveLength(1)
    expect(candidatePackage.excluded).toEqual(
      expect.arrayContaining([
        {flipHash: 'flip-b', reasons: ['packaging_failed']},
      ])
    )
    expect(logger.error).toHaveBeenCalledWith(
      'Unable to package local AI training candidate',
      expect.objectContaining({
        flipHash: 'flip-b',
        epoch: 12,
      })
    )
  })

  it('loads saved training-candidate packages and defaults missing review state to draft', async () => {
    const filePath = storage.resolveLocalAiPath(
      'training-candidates',
      'epoch-12-candidates.json'
    )

    await storage.writeJsonAtomic(filePath, {
      schemaVersion: 1,
      packageType: 'local-ai-training-candidates',
      epoch: 12,
      eligibleCount: 1,
      excludedCount: 0,
      items: [{flipHash: 'flip-a', finalAnswer: 'left'}],
      excluded: [],
    })

    const manager = createLocalAiManager({logger: mockLogger(), storage})

    await expect(
      manager.loadTrainingCandidatePackage({epoch: 12})
    ).resolves.toMatchObject({
      epoch: 12,
      eligibleCount: 1,
      excludedCount: 0,
      packagePath: filePath,
      package: expect.objectContaining({
        reviewStatus: 'draft',
        reviewedAt: null,
        federatedReady: false,
      }),
    })
  })

  it('updates saved training-candidate review status locally', async () => {
    const filePath = storage.resolveLocalAiPath(
      'training-candidates',
      'epoch-12-candidates.json'
    )

    await storage.writeJsonAtomic(filePath, {
      schemaVersion: 1,
      packageType: 'local-ai-training-candidates',
      epoch: 12,
      reviewStatus: 'draft',
      reviewedAt: null,
      eligibleCount: 1,
      excludedCount: 0,
      items: [{flipHash: 'flip-a', finalAnswer: 'left'}],
      excluded: [],
    })

    const manager = createLocalAiManager({logger: mockLogger(), storage})
    const result = await manager.updateTrainingCandidatePackageReview({
      epoch: 12,
      reviewStatus: 'approved',
    })

    expect(result).toMatchObject({
      epoch: 12,
      eligibleCount: 1,
      excludedCount: 0,
      packagePath: filePath,
      package: expect.objectContaining({
        reviewStatus: 'approved',
        reviewedAt: expect.any(String),
        federatedReady: true,
      }),
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

  it('refreshes Local AI sidecar health and model status without requiring cloud providers', async () => {
    const manager = createLocalAiManager({
      logger: mockLogger(),
      storage,
      sidecar: {
        getHealth: jest.fn(async () => ({
          ok: true,
          reachable: true,
          data: {service: 'local-ai-sidecar-stub'},
          lastError: null,
        })),
        listModels: jest.fn(async () => ({
          ok: true,
          reachable: true,
          models: ['local-stub-chat'],
          total: 1,
          lastError: null,
        })),
        chat: jest.fn(),
        captionFlip: jest.fn(),
        ocrImage: jest.fn(),
        trainEpoch: jest.fn(),
      },
    })

    await expect(
      manager.status({
        refresh: true,
        baseUrl: 'http://localhost:5050',
      })
    ).resolves.toMatchObject({
      baseUrl: 'http://localhost:5050',
      sidecarReachable: true,
      sidecarModelCount: 1,
      lastError: null,
    })
  })

  it('reports unavailable Local AI sidecar status safely when health checks fail', async () => {
    const manager = createLocalAiManager({
      logger: mockLogger(),
      storage,
      sidecar: {
        getHealth: jest.fn(async () => ({
          ok: false,
          status: 'error',
          reachable: false,
          lastError: 'Local AI sidecar is unreachable',
        })),
        listModels: jest.fn(),
        chat: jest.fn(),
        captionFlip: jest.fn(),
        ocrImage: jest.fn(),
        trainEpoch: jest.fn(),
      },
    })

    await expect(
      manager.status({
        refresh: true,
        baseUrl: 'http://localhost:5050',
      })
    ).resolves.toMatchObject({
      ok: false,
      baseUrl: 'http://localhost:5050',
      sidecarReachable: false,
      sidecarModelCount: 0,
      lastError: 'Local AI sidecar is unreachable',
    })
  })

  it('routes flipToText through the Local AI sidecar with runtime config', async () => {
    const sidecar = {
      getHealth: jest.fn(),
      listModels: jest.fn(),
      chat: jest.fn(),
      flipToText: jest.fn(async () => ({
        ok: true,
        status: 'ok',
        provider: 'local-ai',
        runtimeType: 'ollama',
        visionModel: 'moondream',
        text: 'A short local flip summary.',
        lastError: null,
      })),
      captionFlip: jest.fn(),
      ocrImage: jest.fn(),
      trainEpoch: jest.fn(),
    }
    const manager = createLocalAiManager({
      logger: mockLogger(),
      storage,
      sidecar,
    })

    await expect(
      manager.flipToText({
        runtimeType: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
        visionModel: 'moondream',
        model: 'llama3.1:8b',
        input: {
          images: ['data:image/png;base64,AAA=', 'data:image/png;base64,BBB='],
        },
      })
    ).resolves.toMatchObject({
      ok: true,
      provider: 'local-ai',
      runtimeType: 'ollama',
      visionModel: 'moondream',
      text: 'A short local flip summary.',
      baseUrl: 'http://127.0.0.1:11434',
    })

    expect(sidecar.flipToText).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeType: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
        visionModel: 'moondream',
        model: 'llama3.1:8b',
        input: {
          images: ['data:image/png;base64,AAA=', 'data:image/png;base64,BBB='],
        },
      })
    )
  })

  it('derives the legacy runtime type from runtimeBackend for Local AI flip text requests', async () => {
    const sidecar = {
      getHealth: jest.fn(),
      listModels: jest.fn(),
      chat: jest.fn(),
      flipToText: jest.fn(async (payload) => ({
        ok: true,
        status: 'ok',
        provider: 'local-ai',
        runtimeBackend: payload.runtimeBackend,
        runtimeType: payload.runtimeType,
        visionModel: payload.visionModel,
        text: 'A short local flip summary.',
        lastError: null,
      })),
      checkFlipSequence: jest.fn(),
      captionFlip: jest.fn(),
      ocrImage: jest.fn(),
      trainEpoch: jest.fn(),
    }
    const manager = createLocalAiManager({
      logger: mockLogger(),
      storage,
      sidecar,
    })

    await expect(
      manager.flipToText({
        runtimeBackend: 'ollama-direct',
        visionModel: 'moondream',
        model: 'llama3.1:8b',
        input: {
          images: ['data:image/png;base64,AAA=', 'data:image/png;base64,BBB='],
        },
      })
    ).resolves.toMatchObject({
      ok: true,
      provider: 'local-ai',
      runtimeBackend: 'ollama-direct',
      runtimeType: 'ollama',
      baseUrl: 'http://127.0.0.1:11434',
    })

    expect(sidecar.flipToText).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeBackend: 'ollama-direct',
        runtimeType: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
      })
    )
  })

  it('routes checkFlipSequence through the Local AI sidecar with runtime config', async () => {
    const sidecar = {
      getHealth: jest.fn(),
      listModels: jest.fn(),
      chat: jest.fn(),
      flipToText: jest.fn(),
      checkFlipSequence: jest.fn(async () => ({
        ok: true,
        status: 'ok',
        provider: 'local-ai',
        runtimeType: 'ollama',
        model: 'llama3.1:8b',
        visionModel: 'moondream',
        classification: 'consistent',
        confidence: 'high',
        reason: 'The action progresses clearly from one panel to the next.',
        sequenceText: 'A child picks up a ball and then throws it.',
        lastError: null,
      })),
      captionFlip: jest.fn(),
      ocrImage: jest.fn(),
      trainEpoch: jest.fn(),
    }
    const manager = createLocalAiManager({
      logger: mockLogger(),
      storage,
      sidecar,
    })

    await expect(
      manager.checkFlipSequence({
        runtimeType: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
        visionModel: 'moondream',
        model: 'llama3.1:8b',
        input: {
          images: ['data:image/png;base64,AAA=', 'data:image/png;base64,BBB='],
        },
      })
    ).resolves.toMatchObject({
      ok: true,
      provider: 'local-ai',
      runtimeType: 'ollama',
      model: 'llama3.1:8b',
      visionModel: 'moondream',
      classification: 'consistent',
      confidence: 'high',
      sequenceText: 'A child picks up a ball and then throws it.',
      baseUrl: 'http://127.0.0.1:11434',
    })

    expect(sidecar.checkFlipSequence).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeType: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
        visionModel: 'moondream',
        model: 'llama3.1:8b',
        input: {
          images: ['data:image/png;base64,AAA=', 'data:image/png;base64,BBB='],
        },
      })
    )
  })
})
