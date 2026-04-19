const os = require('os')
const path = require('path')
const fs = require('fs-extra')
const {encode} = require('rlp')

const {createLocalAiStorage} = require('./storage')
const {
  createLocalAiManager,
  getTelemetryTrainingReadiness,
  parseIoregGpuOutput,
  parsePmsetBatteryOutput,
} = require('./manager')
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

async function readJsonl(filePath) {
  const raw = await fs.readFile(filePath, 'utf8')

  return raw
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function createCompleteDeveloperAnnotation(taskId, whyAnswer) {
  return {
    annotator: 'developer-test',
    frame_captions: ['frame one', 'frame two', 'frame three', 'frame four'],
    option_a_summary: 'left story',
    option_b_summary: 'right story',
    text_required: false,
    sequence_markers_present: false,
    report_required: false,
    final_answer: 'left',
    why_answer: whyAnswer || `human reason for ${taskId}`,
    confidence: 5,
  }
}

function createReadySystemTelemetry() {
  return {
    collectedAt: '2026-04-18T10:00:00.000Z',
    system: {
      cpuUsagePercent: 24,
      memoryUsagePercent: 68,
      memoryFreeGiB: 9.5,
      thermal: {
        available: true,
        pressure: 'nominal',
        cpuSpeedLimit: 0,
      },
      battery: {
        available: true,
        isCharging: true,
        percent: 95,
      },
    },
  }
}

function createReadySystemTelemetryProvider() {
  return async () => createReadySystemTelemetry()
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

  it('merges repeated flip captures into one enriched local record', async () => {
    const logger = mockLogger()
    const manager = createLocalAiManager({logger, storage})

    await manager.captureFlip({
      flipHash: 'flip-merge',
      epoch: 12,
      sessionType: 'short',
      images: ['left', 'right', 'third', 'fourth'],
      orders: [
        [0, 1, 2, 3],
        [3, 2, 1, 0],
      ],
    })

    await manager.captureFlip({
      flipHash: 'flip-merge',
      epoch: 12,
      sessionType: 'long',
      panelCount: 4,
      words: [{id: 1, name: 'apple', desc: 'fruit'}],
      selectedOrder: 'left',
      relevance: 'relevant',
      best: true,
      consensus: {
        finalAnswer: 'left',
        reported: false,
        strength: 'Strong',
      },
    })

    const captureIndex = await storage.readJson(
      storage.resolveLocalAiPath('captures', 'index.json')
    )

    expect(captureIndex.capturedCount).toBe(1)
    expect(captureIndex.captures).toHaveLength(1)
    expect(captureIndex.captures[0]).toEqual(
      expect.objectContaining({
        flipHash: 'flip-merge',
        epoch: 12,
        sessionType: 'long',
        panelCount: 4,
        orders: [
          [0, 1, 2, 3],
          [3, 2, 1, 0],
        ],
        words: [{id: 1, name: 'apple', desc: 'fruit'}],
        selectedOrder: 'left',
        relevance: 'relevant',
        best: true,
        consensus: {
          finalAnswer: 'left',
          reported: false,
          strength: 'Strong',
        },
      })
    )
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

  it('imports, registers, and reloads adapter artifacts from managed storage', async () => {
    const logger = mockLogger()
    const manager = createLocalAiManager({logger, storage})
    const adapterBuffer = Buffer.from('registered-adapter-bytes')
    const imported = await manager.importAdapterArtifact({
      epoch: 12,
      artifactFileName: 'epoch-12-registration.safetensors',
      artifactBase64: `data:application/octet-stream;base64,${adapterBuffer.toString(
        'base64'
      )}`,
    })

    const registered = await manager.registerAdapterArtifact({
      epoch: 12,
      artifactToken: imported.artifactToken,
    })
    const reloaded = await manager.loadAdapterArtifact({epoch: 12})
    const storedManifest = await storage.readJson(
      storage.resolveLocalAiPath('adapters', 'epoch-12.json')
    )

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
        sizeBytes: adapterBuffer.length,
        artifactToken: imported.artifactToken,
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
        sizeBytes: adapterBuffer.length,
        artifactToken: imported.artifactToken,
      },
    })
    expect(storedManifest).toMatchObject({
      adapterArtifact: {
        file: 'epoch-12-registration.safetensors',
        sizeBytes: adapterBuffer.length,
        artifactToken: imported.artifactToken,
        sourcePath: expect.stringContaining(
          `${path.sep}adapter-imports${path.sep}12${path.sep}`
        ),
      },
    })
  })

  it('rejects direct adapter source paths during registration', async () => {
    const logger = mockLogger()
    const manager = createLocalAiManager({logger, storage})
    const sourcePath = storage.resolveLocalAiPath(
      'artifacts',
      'epoch-12-registration.safetensors'
    )

    await storage.writeBuffer(
      sourcePath,
      Buffer.from('registered-adapter-bytes')
    )

    await expect(
      manager.registerAdapterArtifact({
        epoch: 12,
        sourcePath,
      })
    ).rejects.toThrow(
      'Direct adapter file paths are no longer accepted. Import the adapter file first.'
    )
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
        author: null,
        best: false,
        flipHash: 'flip-a',
        epoch: 12,
        sessionType: 'short',
        panelCount: 2,
        orders: [],
        relevance: null,
        selectedOrder: null,
        timestamp: 1710000000000,
        capturedAt: '2026-01-01T00:00:00.000Z',
        finalAnswer: 'left',
        words: [],
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

  it('uses the modern ranked package builder when ranking policy requests local-node-first', async () => {
    const captureIndexPath = storage.resolveLocalAiPath(
      'captures',
      'index.json'
    )

    await storage.writeJsonAtomic(captureIndexPath, {
      version: 1,
      capturedCount: 1,
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
      ],
    })

    const modernTrainingCollector = {
      buildCandidatePackage: jest.fn(async () => ({
        items: [
          {
            flipHash: 'flip-a',
            epoch: 12,
            sessionType: 'short',
            panelCount: 2,
            timestamp: 1710000000000,
            capturedAt: '2026-01-01T00:00:00.000Z',
            finalAnswer: 'left',
            trainingWeight: 1.5,
            rankingSource: 'public_indexer_fallback',
            audit: {
              cid: 'flip-a',
              author: '0xabc',
            },
          },
        ],
        excluded: [{flipHash: 'flip-z', reasons: ['missing_flip_payload']}],
        sourcePriority: 'local-node-first',
        rankingPolicy: {
          sourcePriority: 'local-node-first',
          allowPublicIndexerFallback: true,
        },
        localIndexPath: storage.resolveLocalAiPath(
          'indexer',
          'epochs',
          'epoch-12.json'
        ),
        fallbackIndexPath: storage.resolveLocalAiPath(
          'indexer-fallback',
          'epochs',
          'epoch-12.json'
        ),
        fallbackUsed: true,
      })),
    }

    const manager = createLocalAiManager({
      logger: mockLogger(),
      storage,
      modernTrainingCollector,
    })
    const summary = await manager.buildTrainingCandidatePackage({
      epoch: 12,
      rankingPolicy: {
        sourcePriority: 'local-node-first',
      },
    })
    const candidatePackage = await storage.readJson(summary.packagePath)

    expect(modernTrainingCollector.buildCandidatePackage).toHaveBeenCalledWith(
      expect.objectContaining({
        epoch: 12,
        rankingPolicy: expect.objectContaining({
          sourcePriority: 'local-node-first',
        }),
      })
    )
    expect(summary).toMatchObject({
      epoch: 12,
      eligibleCount: 1,
      excludedCount: 1,
    })
    expect(candidatePackage).toMatchObject({
      sourcePriority: 'local-node-first',
      fallbackUsed: true,
      eligibleCount: 1,
      excludedCount: 1,
      items: [
        expect.objectContaining({
          flipHash: 'flip-a',
          trainingWeight: 1.5,
          rankingSource: 'public_indexer_fallback',
        }),
      ],
      excluded: [{flipHash: 'flip-z', reasons: ['missing_flip_payload']}],
    })
  })

  it('builds a bounded human-teacher package from ranked payload-backed candidates', async () => {
    const captureIndexPath = storage.resolveLocalAiPath(
      'captures',
      'index.json'
    )

    await storage.writeJsonAtomic(captureIndexPath, {
      version: 1,
      capturedCount: 3,
      captures: [
        {
          flipHash: 'flip-a',
          epoch: 12,
          sessionType: 'short',
          panelCount: 4,
          timestamp: 1710000003000,
          capturedAt: '2026-01-01T00:03:00.000Z',
          consensus: {
            finalAnswer: 'left',
            reported: false,
            strength: 'Strong',
          },
          best: true,
        },
        {
          flipHash: 'flip-b',
          epoch: 12,
          sessionType: 'short',
          panelCount: 4,
          timestamp: 1710000002000,
          capturedAt: '2026-01-01T00:02:00.000Z',
          consensus: {
            finalAnswer: 'right',
            reported: false,
            strength: 'Weak',
          },
        },
        {
          flipHash: 'flip-c',
          epoch: 12,
          sessionType: 'short',
          panelCount: 4,
          timestamp: 1710000001000,
          capturedAt: '2026-01-01T00:01:00.000Z',
          consensus: {
            finalAnswer: 'left',
            reported: false,
            strength: 'Strong',
          },
        },
      ],
    })

    const modernTrainingCollector = {
      buildCandidatePackage: jest.fn(async () => ({
        items: [
          {
            flipHash: 'flip-a',
            epoch: 12,
            sessionType: 'short',
            panelCount: 4,
            timestamp: 1710000003000,
            capturedAt: '2026-01-01T00:03:00.000Z',
            finalAnswer: 'left',
            consensusStrength: 'Strong',
            best: true,
            payloadPath: storage.resolveLocalAiPath(
              'modern-payloads',
              'epoch-12',
              'flip-a.json'
            ),
            words: {localNode: {word1Index: 1, word2Index: 2}},
            trainingWeight: 2.0,
            rankingSource: 'public_indexer_fallback',
            source: {
              kind: 'modern',
              name: 'public',
              priority: 'local-node-first',
            },
            audit: {author: '0xabc'},
          },
          {
            flipHash: 'flip-b',
            epoch: 12,
            sessionType: 'short',
            panelCount: 4,
            timestamp: 1710000002000,
            capturedAt: '2026-01-01T00:02:00.000Z',
            finalAnswer: 'right',
            consensusStrength: 'Weak',
            payloadPath: storage.resolveLocalAiPath(
              'modern-payloads',
              'epoch-12',
              'flip-b.json'
            ),
            words: {localNode: {word1Index: 3, word2Index: 4}},
            trainingWeight: 1.0,
            rankingSource: 'local_node_indexer',
            source: {
              kind: 'modern',
              name: 'local',
              priority: 'local-node-first',
            },
            audit: {author: '0xdef'},
          },
          {
            flipHash: 'flip-c',
            epoch: 12,
            sessionType: 'short',
            panelCount: 4,
            timestamp: 1710000001000,
            capturedAt: '2026-01-01T00:01:00.000Z',
            finalAnswer: 'left',
            consensusStrength: 'Strong',
            payloadPath: storage.resolveLocalAiPath(
              'modern-payloads',
              'epoch-12',
              'flip-c.json'
            ),
            words: {localNode: {word1Index: 5, word2Index: 6}},
            trainingWeight: 0.5,
            rankingSource: 'local_node_indexer',
            source: {
              kind: 'modern',
              name: 'local',
              priority: 'local-node-first',
            },
            audit: {author: '0xghi'},
          },
        ],
        excluded: [{flipHash: 'flip-z', reasons: ['missing_flip_payload']}],
        sourcePriority: 'local-node-first',
        rankingPolicy: {
          sourcePriority: 'local-node-first',
          allowPublicIndexerFallback: true,
        },
        localIndexPath: storage.resolveLocalAiPath(
          'indexer',
          'epochs',
          'epoch-12.json'
        ),
        fallbackIndexPath: storage.resolveLocalAiPath(
          'indexer-fallback',
          'epochs',
          'epoch-12.json'
        ),
        fallbackUsed: true,
      })),
    }

    const manager = createLocalAiManager({
      logger: mockLogger(),
      storage,
      modernTrainingCollector,
    })
    const summary = await manager.buildHumanTeacherPackage({
      epoch: 12,
      batchSize: 2,
    })
    const taskPackage = await storage.readHumanTeacherPackage(
      summary.packagePath
    )

    expect(modernTrainingCollector.buildCandidatePackage).toHaveBeenCalledWith(
      expect.objectContaining({
        epoch: 12,
        fetchFlipPayloads: true,
        requireFlipPayloads: true,
      })
    )
    expect(summary).toMatchObject({
      epoch: 12,
      eligibleCount: 2,
      excludedCount: 1,
    })
    expect(taskPackage).toMatchObject({
      schemaVersion: 1,
      packageType: 'local-ai-human-teacher-tasks',
      epoch: 12,
      batchSize: 2,
      candidatePoolSize: 3,
      reviewStatus: 'draft',
      reviewedAt: null,
      annotationReady: false,
      eligibleCount: 2,
      excludedCount: 1,
      fallbackUsed: true,
    })
    expect(taskPackage.items).toEqual([
      expect.objectContaining({
        taskId: 'flip-a::human-teacher',
        sampleId: 'flip-a::human-teacher',
        flipHash: 'flip-a',
        finalAnswer: 'left',
        consensusStrength: 'Strong',
        payloadPath: storage.resolveLocalAiPath(
          'modern-payloads',
          'epoch-12',
          'flip-a.json'
        ),
        trainingWeight: 2,
        annotationStatus: 'pending',
      }),
      expect.objectContaining({
        taskId: 'flip-b::human-teacher',
        sampleId: 'flip-b::human-teacher',
        flipHash: 'flip-b',
        finalAnswer: 'right',
      }),
    ])
    expect(taskPackage.excluded).toEqual([
      {flipHash: 'flip-z', reasons: ['missing_flip_payload']},
    ])
  })

  it('rejects human-teacher packaging for the current epoch', async () => {
    const manager = createLocalAiManager({logger: mockLogger(), storage})

    await expect(
      manager.buildHumanTeacherPackage({
        epoch: 12,
        currentEpoch: 12,
      })
    ).rejects.toThrow(
      'Human-teacher packaging is only available after the session finishes and consensus exists for a past epoch'
    )
  })

  it('caps human-teacher packaging at 30 flips even when a larger batch is requested', async () => {
    const rankedItems = Array.from({length: 35}, (_, index) => ({
      flipHash: `flip-${index + 1}`,
      epoch: 12,
      sessionType: 'short',
      panelCount: 4,
      timestamp: 1710000000000 + index,
      capturedAt: new Date(1710000000000 + index * 1000).toISOString(),
      finalAnswer: index % 2 === 0 ? 'left' : 'right',
      consensusStrength: 'Strong',
      payloadPath: storage.resolveLocalAiPath(
        'modern-payloads',
        'epoch-12',
        `flip-${index + 1}.json`
      ),
      words: {localNode: {word1Index: index, word2Index: index + 1}},
      trainingWeight: 1,
      rankingSource: 'local_node_indexer',
      source: {
        kind: 'modern',
        name: 'local',
        priority: 'local-node-first',
      },
      audit: {author: `0x${index + 1}`},
    }))
    const modernTrainingCollector = {
      buildCandidatePackage: jest.fn(async () => ({
        items: rankedItems,
        excluded: [],
        sourcePriority: 'local-node-first',
        rankingPolicy: {
          sourcePriority: 'local-node-first',
          allowPublicIndexerFallback: true,
        },
      })),
    }

    const manager = createLocalAiManager({
      logger: mockLogger(),
      storage,
      modernTrainingCollector,
    })
    const summary = await manager.buildHumanTeacherPackage({
      epoch: 12,
      batchSize: 999,
    })
    const taskPackage = await storage.readHumanTeacherPackage(
      summary.packagePath
    )

    expect(summary).toMatchObject({
      epoch: 12,
      eligibleCount: 30,
      excludedCount: 0,
    })
    expect(taskPackage.batchSize).toBe(30)
    expect(taskPackage.eligibleCount).toBe(30)
    expect(taskPackage.items).toHaveLength(30)
    expect(new Set(taskPackage.items.map((item) => item.taskId)).size).toBe(30)
    expect(taskPackage.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: 'flip-35::human-teacher',
          flipHash: 'flip-35',
        }),
        expect.objectContaining({
          taskId: 'flip-6::human-teacher',
          flipHash: 'flip-6',
        }),
      ])
    )
  })

  it('loads and updates saved human-teacher package review state locally', async () => {
    const filePath = storage.resolveLocalAiPath(
      'human-teacher',
      'epoch-12-tasks.json'
    )

    await storage.writeJsonAtomic(filePath, {
      schemaVersion: 1,
      packageType: 'local-ai-human-teacher-tasks',
      epoch: 12,
      reviewStatus: 'draft',
      reviewedAt: null,
      annotationReady: false,
      eligibleCount: 1,
      excludedCount: 0,
      items: [
        {
          taskId: 'flip-a::human-teacher',
          sampleId: 'flip-a::human-teacher',
          flipHash: 'flip-a',
          finalAnswer: 'left',
          payloadPath: '/tmp/flip-a.json',
        },
      ],
      excluded: [],
    })

    const manager = createLocalAiManager({logger: mockLogger(), storage})

    await expect(
      manager.loadHumanTeacherPackage({epoch: 12})
    ).resolves.toMatchObject({
      epoch: 12,
      packagePath: filePath,
      package: expect.objectContaining({
        reviewStatus: 'draft',
        annotationReady: false,
      }),
    })

    await expect(
      manager.updateHumanTeacherPackageReview({
        epoch: 12,
        reviewStatus: 'approved',
      })
    ).resolves.toMatchObject({
      epoch: 12,
      packagePath: filePath,
      package: expect.objectContaining({
        reviewStatus: 'approved',
        annotationReady: true,
      }),
    })
  })

  it('exports human-teacher tasks into a local annotation workspace', async () => {
    const payloadPath = storage.resolveLocalAiPath(
      'modern-payloads',
      'epoch-12',
      'flip-a.json'
    )
    const filePath = storage.resolveLocalAiPath(
      'human-teacher',
      'epoch-12-tasks.json'
    )
    const publicPayload = encode([
      [Buffer.from('panel-1'), Buffer.from('panel-2')],
      [],
    ])
    const privatePayload = encode([
      [Buffer.from('panel-3'), Buffer.from('panel-4')],
      [
        [Buffer.alloc(0), Buffer.from([1]), Buffer.from([2]), Buffer.from([3])],
        [Buffer.from([3]), Buffer.from([2]), Buffer.from([1]), Buffer.alloc(0)],
      ],
    ])

    await storage.writeJsonAtomic(payloadPath, {
      hex: `0x${Buffer.from(publicPayload).toString('hex')}`,
      privateHex: `0x${Buffer.from(privatePayload).toString('hex')}`,
    })

    await storage.writeJsonAtomic(filePath, {
      schemaVersion: 1,
      packageType: 'local-ai-human-teacher-tasks',
      epoch: 12,
      reviewStatus: 'approved',
      reviewedAt: '2026-01-01T00:00:00.000Z',
      annotationReady: true,
      eligibleCount: 1,
      excludedCount: 0,
      items: [
        {
          taskId: 'flip-a::human-teacher',
          sampleId: 'flip-a::human-teacher',
          flipHash: 'flip-a',
          epoch: 12,
          finalAnswer: 'left',
          consensusStrength: 'Strong',
          payloadPath,
          words: {},
        },
      ],
      excluded: [],
    })

    const manager = createLocalAiManager({logger: mockLogger(), storage})
    const result = await manager.exportHumanTeacherTasks({
      epoch: 12,
      currentEpoch: 13,
    })

    expect(result).toMatchObject({
      epoch: 12,
      packagePath: filePath,
      outputDir: storage.resolveLocalAiPath(
        'human-teacher-exports',
        'epoch-12-tasks'
      ),
      export: expect.objectContaining({
        tasks: 1,
      }),
    })

    await expect(
      storage.exists(path.join(result.outputDir, 'tasks.jsonl'))
    ).resolves.toBe(true)
    await expect(
      storage.exists(
        path.join(
          result.outputDir,
          'tasks',
          'flip-a-human-teacher',
          'README.md'
        )
      )
    ).resolves.toBe(true)
    await expect(
      storage.exists(path.join(result.outputDir, 'workspace-metadata.json'))
    ).resolves.toBe(true)
  })

  it('loads a human-teacher annotation workspace and saves a task draft', async () => {
    const payloadPath = storage.resolveLocalAiPath(
      'modern-payloads',
      'epoch-12',
      'flip-a.json'
    )
    const filePath = storage.resolveLocalAiPath(
      'human-teacher',
      'epoch-12-tasks.json'
    )
    const publicPayload = encode([
      [Buffer.from('panel-1'), Buffer.from('panel-2')],
      [],
    ])
    const privatePayload = encode([
      [Buffer.from('panel-3'), Buffer.from('panel-4')],
      [
        [Buffer.alloc(0), Buffer.from([1]), Buffer.from([2]), Buffer.from([3])],
        [Buffer.from([3]), Buffer.from([2]), Buffer.from([1]), Buffer.alloc(0)],
      ],
    ])

    await storage.writeJsonAtomic(payloadPath, {
      hex: `0x${Buffer.from(publicPayload).toString('hex')}`,
      privateHex: `0x${Buffer.from(privatePayload).toString('hex')}`,
    })

    await storage.writeJsonAtomic(filePath, {
      schemaVersion: 1,
      packageType: 'local-ai-human-teacher-tasks',
      epoch: 12,
      reviewStatus: 'approved',
      reviewedAt: '2026-01-01T00:00:00.000Z',
      annotationReady: true,
      eligibleCount: 1,
      excludedCount: 0,
      items: [
        {
          taskId: 'flip-a::human-teacher',
          sampleId: 'flip-a::human-teacher',
          flipHash: 'flip-a',
          epoch: 12,
          finalAnswer: 'left',
          consensusStrength: 'Strong',
          payloadPath,
          words: {},
          annotationStatus: 'pending',
        },
      ],
      excluded: [],
    })

    const manager = createLocalAiManager({logger: mockLogger(), storage})
    const exportResult = await manager.exportHumanTeacherTasks({
      epoch: 12,
      currentEpoch: 13,
    })
    const workspace = await manager.loadHumanTeacherAnnotationWorkspace({
      epoch: 12,
      currentEpoch: 13,
    })
    const task = await manager.loadHumanTeacherAnnotationTask({
      epoch: 12,
      currentEpoch: 13,
      taskId: 'flip-a::human-teacher',
    })
    const saved = await manager.saveHumanTeacherAnnotationDraft({
      epoch: 12,
      currentEpoch: 13,
      taskId: 'flip-a::human-teacher',
      annotation: {
        annotator: 'tester',
        frame_captions: ['a', 'b', 'c', 'd'],
        option_a_summary: 'left story',
        option_b_summary: 'right story',
        ai_annotation: {
          task_id: 'flip-a::human-teacher',
          generated_at: '2026-04-17T12:00:00.000Z',
          runtime_backend: 'ollama-direct',
          runtime_type: 'ollama',
          model: 'qwen3.5:9b',
          vision_model: 'qwen3.5:9b',
          ordered_panel_descriptions: [
            'man looks at car',
            'man opens door',
            'man sits down',
            'car drives away',
            'man trips',
            'man falls',
            '',
            '',
          ],
          ordered_panel_text: ['', 'SALE', '', '', '', '', '', ''],
          option_a_story_analysis:
            'LEFT keeps the same actor and object through a stable sequence.',
          option_b_story_analysis:
            'RIGHT breaks chronology because the fall appears before the setup.',
          final_answer: 'right',
          why_answer: 'the AI overvalued the mirrored motion',
          confidence: 2,
          rating: 'wrong',
          text_required: false,
          sequence_markers_present: false,
          report_required: false,
        },
        ai_annotation_feedback:
          'The AI ignored that the fall happens only after the crash on the left path.',
        panel_references: [
          {
            code: 'A',
            description: 'car',
            panel_index: 0,
            x: 0.25,
            y: 0.35,
          },
        ],
        text_required: false,
        sequence_markers_present: false,
        report_required: false,
        final_answer: 'left',
        why_answer: 'left is coherent',
        confidence: 5,
      },
    })

    expect(workspace).toMatchObject({
      epoch: 12,
      workspace: expect.objectContaining({
        taskCount: 1,
        draftedCount: 0,
        completedCount: 0,
      }),
    })
    expect(task).toMatchObject({
      epoch: 12,
      task: expect.objectContaining({
        taskId: 'flip-a::human-teacher',
        panels: expect.arrayContaining([
          expect.objectContaining({
            dataUrl: expect.stringContaining('data:image/png;base64,'),
          }),
        ]),
      }),
    })
    expect(saved).toMatchObject({
      epoch: 12,
      task: expect.objectContaining({
        taskId: 'flip-a::human-teacher',
        annotationStatus: 'complete',
        annotation: expect.objectContaining({
          ai_annotation: expect.objectContaining({
            task_id: 'flip-a::human-teacher',
            model: 'qwen3.5:9b',
            final_answer: 'right',
            rating: 'wrong',
            text_required: false,
            sequence_markers_present: false,
            report_required: false,
            ordered_panel_descriptions: expect.arrayContaining([
              'man looks at car',
              'man opens door',
            ]),
            ordered_panel_text: expect.arrayContaining(['SALE']),
            option_a_story_analysis: expect.stringContaining(
              'same actor and object'
            ),
          }),
          ai_annotation_feedback: expect.stringContaining(
            'ignored that the fall happens only after the crash'
          ),
          panel_references: expect.arrayContaining([
            expect.objectContaining({
              code: 'A',
              description: 'car',
              panel_index: 0,
            }),
          ]),
        }),
      }),
      workspace: expect.objectContaining({
        annotationsPath: path.join(
          exportResult.outputDir,
          'annotations.filled.jsonl'
        ),
      }),
    })

    await expect(storage.readHumanTeacherPackage(filePath)).resolves.toEqual(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            taskId: 'flip-a::human-teacher',
            annotationStatus: 'complete',
          }),
        ],
      })
    )
  })

  it('rejects opening annotation tasks when the human-teacher package is not approved', async () => {
    const payloadPath = storage.resolveLocalAiPath(
      'modern-payloads',
      'epoch-12',
      'flip-a.json'
    )
    const filePath = storage.resolveLocalAiPath(
      'human-teacher',
      'epoch-12-tasks.json'
    )
    const publicPayload = encode([
      [Buffer.from('panel-1'), Buffer.from('panel-2')],
      [],
    ])
    const privatePayload = encode([
      [Buffer.from('panel-3'), Buffer.from('panel-4')],
      [
        [Buffer.alloc(0), Buffer.from([1]), Buffer.from([2]), Buffer.from([3])],
        [Buffer.from([3]), Buffer.from([2]), Buffer.from([1]), Buffer.alloc(0)],
      ],
    ])

    await storage.writeJsonAtomic(payloadPath, {
      hex: `0x${Buffer.from(publicPayload).toString('hex')}`,
      privateHex: `0x${Buffer.from(privatePayload).toString('hex')}`,
    })

    await storage.writeJsonAtomic(filePath, {
      schemaVersion: 1,
      packageType: 'local-ai-human-teacher-tasks',
      epoch: 12,
      reviewStatus: 'rejected',
      reviewedAt: '2026-01-01T00:00:00.000Z',
      annotationReady: false,
      eligibleCount: 1,
      excludedCount: 0,
      items: [
        {
          taskId: 'flip-a::human-teacher',
          sampleId: 'flip-a::human-teacher',
          flipHash: 'flip-a',
          epoch: 12,
          finalAnswer: 'left',
          consensusStrength: 'Strong',
          payloadPath,
          words: {},
          annotationStatus: 'pending',
        },
      ],
      excluded: [],
    })

    const manager = createLocalAiManager({logger: mockLogger(), storage})

    await expect(
      manager.loadHumanTeacherAnnotationTask({
        epoch: 12,
        currentEpoch: 13,
        taskId: 'flip-a::human-teacher',
      })
    ).rejects.toThrow(
      'Human teacher package must be approved before annotation tasks can be opened'
    )
  })

  it('loads an offline human-teacher demo workspace and saves a demo draft', async () => {
    const manager = createLocalAiManager({logger: mockLogger(), storage})

    const workspace = await manager.loadHumanTeacherDemoWorkspace({
      sampleName: 'flip-challenge-test-5-decoded-labeled',
    })
    const firstTaskId = workspace.workspace.tasks[0].taskId
    const task = await manager.loadHumanTeacherDemoTask({
      sampleName: 'flip-challenge-test-5-decoded-labeled',
      taskId: firstTaskId,
    })
    const saved = await manager.saveHumanTeacherDemoDraft({
      sampleName: 'flip-challenge-test-5-decoded-labeled',
      taskId: firstTaskId,
      annotation: {
        annotator: 'offline-demo',
        frame_captions: ['one', 'two', 'three', 'four'],
        option_a_summary: 'option a summary',
        option_b_summary: 'option b summary',
        text_required: false,
        sequence_markers_present: false,
        report_required: false,
        final_answer: 'right',
        why_answer: 'testing the offline annotator path',
        confidence: 5,
      },
    })
    const reloadedWorkspace = await manager.loadHumanTeacherDemoWorkspace({
      sampleName: 'flip-challenge-test-5-decoded-labeled',
    })

    expect(workspace).toMatchObject({
      demo: true,
      sampleName: 'flip-challenge-test-5-decoded-labeled',
      workspace: expect.objectContaining({
        taskCount: 5,
        draftedCount: 0,
        completedCount: 0,
      }),
    })
    expect(task).toMatchObject({
      demo: true,
      task: expect.objectContaining({
        taskId: firstTaskId,
        panels: expect.arrayContaining([
          expect.objectContaining({
            dataUrl: expect.stringContaining('data:image/png;base64,'),
          }),
        ]),
      }),
    })
    expect(saved).toMatchObject({
      demo: true,
      task: expect.objectContaining({
        taskId: firstTaskId,
        annotationStatus: 'complete',
      }),
    })
    expect(reloadedWorkspace.workspace).toMatchObject({
      taskCount: 5,
      draftedCount: 1,
      completedCount: 1,
    })
  })

  it('advances the offline demo session to the next 5 flips after finishing a trained demo chunk', async () => {
    const manager = createLocalAiManager({logger: mockLogger(), storage})

    const session = await manager.loadHumanTeacherDemoWorkspace({
      sampleName: 'flip-challenge-test-20-decoded-labeled',
    })

    expect(session).toMatchObject({
      demo: true,
      offset: 0,
      chunkSize: 5,
      workspace: expect.objectContaining({
        taskCount: 5,
      }),
    })

    for (const task of session.workspace.tasks) {
      await manager.saveHumanTeacherDemoDraft({
        sampleName: 'flip-challenge-test-20-decoded-labeled',
        offset: 0,
        taskId: task.taskId,
        annotation: {
          annotator: 'offline-demo',
          final_answer: 'left',
          why_answer: `demo reason for ${task.taskId}`,
          report_required: false,
          confidence: 5,
        },
      })
    }

    const finalized = await manager.finalizeHumanTeacherDemoChunk({
      sampleName: 'flip-challenge-test-20-decoded-labeled',
      offset: 0,
      trainNow: true,
    })

    expect(finalized).toMatchObject({
      demo: true,
      offset: 0,
      nextOffset: 5,
      taskCount: 5,
      training: expect.objectContaining({
        ok: true,
        status: 'demo_simulated',
        simulated: true,
      }),
      state: expect.objectContaining({
        currentOffset: 5,
        annotatedCount: 5,
        trainedChunkCount: 1,
      }),
    })

    const nextSession = await manager.loadHumanTeacherDemoWorkspace({
      sampleName: 'flip-challenge-test-20-decoded-labeled',
    })

    expect(nextSession).toMatchObject({
      demo: true,
      offset: 5,
      state: expect.objectContaining({
        currentOffset: 5,
      }),
      workspace: expect.objectContaining({
        taskCount: 5,
      }),
    })
    expect(nextSession.workspace.tasks[0].taskId).not.toBe(
      session.workspace.tasks[0].taskId
    )
  })

  it('rejects ambiguous demo chunk finalization requests', async () => {
    const manager = createLocalAiManager({logger: mockLogger(), storage})

    await expect(
      manager.finalizeHumanTeacherDemoChunk({
        sampleName: 'flip-challenge-test-20-decoded-labeled',
        trainNow: true,
        advance: true,
      })
    ).rejects.toThrow(
      'Demo chunk finalization must choose either training now or advancing to the next chunk, not both'
    )
  })

  it('expands the existing developer annotation pool to the balanced 500-flip slice without losing prior annotations', async () => {
    const manager = createLocalAiManager({logger: mockLogger(), storage})

    await storage.writeJsonAtomic(
      storage.resolveLocalAiPath(
        'human-teacher-developer',
        'flip-challenge-test-20-decoded-labeled',
        'state.json'
      ),
      {
        schemaVersion: 1,
        mode: 'developer-human-teacher',
        sampleName: 'flip-challenge-test-20-decoded-labeled',
        chunkSize: 5,
        totalAvailableTasks: 20,
        currentOffset: 5,
        annotatedTaskIds: [
          'demo:flip-challenge-test-20-decoded-labeled:1',
          'demo:flip-challenge-test-20-decoded-labeled:2',
          'demo:flip-challenge-test-20-decoded-labeled:3',
          'demo:flip-challenge-test-20-decoded-labeled:4',
          'demo:flip-challenge-test-20-decoded-labeled:5',
        ],
        pendingTrainingTaskIds: [
          'demo:flip-challenge-test-20-decoded-labeled:1',
          'demo:flip-challenge-test-20-decoded-labeled:2',
          'demo:flip-challenge-test-20-decoded-labeled:3',
          'demo:flip-challenge-test-20-decoded-labeled:4',
          'demo:flip-challenge-test-20-decoded-labeled:5',
        ],
        trainedTaskIds: [],
        chunks: [],
        comparison100: {
          status: 'not_loaded',
          history: [],
        },
      }
    )

    const session = await manager.loadHumanTeacherDeveloperSession({
      sampleName: 'flip-challenge-test-20-decoded-labeled',
    })

    expect(session).toMatchObject({
      sampleName: 'flip-challenge-test-20-decoded-labeled',
      offset: 5,
      workspace: expect.objectContaining({
        taskCount: 5,
      }),
      state: expect.objectContaining({
        totalAvailableTasks: 500,
        supportsLocalTraining: true,
        annotatedCount: 5,
        pendingTrainingCount: 5,
        remainingTaskCount: 495,
      }),
    })
    expect(session).not.toHaveProperty('statePath')
    expect(session).not.toHaveProperty('outputDir')
    expect(session.comparison100).not.toHaveProperty('lastResultPath')
    expect(session.comparison100).not.toHaveProperty('holdoutPath')
    expect(session.workspace.tasks[0].taskId).toBe(
      'demo:flip-challenge-test-20-decoded-labeled:6'
    )
  })

  it('skips fully annotated developer chunks when reopening the current teaching session', async () => {
    const manager = createLocalAiManager({logger: mockLogger(), storage})
    const completedChunkTaskIds = Array.from(
      {length: 5},
      (_, index) => `demo:flip-challenge-test-20-decoded-labeled:${index + 1}`
    )

    await storage.writeJsonAtomic(
      storage.resolveLocalAiPath(
        'human-teacher-developer',
        'flip-challenge-test-20-decoded-labeled',
        'state.json'
      ),
      {
        schemaVersion: 1,
        mode: 'developer-human-teacher',
        sampleName: 'flip-challenge-test-20-decoded-labeled',
        chunkSize: 5,
        totalAvailableTasks: 500,
        currentOffset: 0,
        annotatedTaskIds: completedChunkTaskIds,
        pendingTrainingTaskIds: completedChunkTaskIds,
        trainedTaskIds: [],
        chunks: [
          {
            offset: 0,
            taskIds: completedChunkTaskIds,
            rowCount: 5,
            committedAt: '2026-04-19T04:00:00.000Z',
            trainingStatus: 'pending',
          },
        ],
        comparison100: {
          status: 'not_loaded',
          history: [],
        },
      }
    )

    const session = await manager.loadHumanTeacherDeveloperSession({
      sampleName: 'flip-challenge-test-20-decoded-labeled',
    })

    expect(session.offset).toBe(5)
    expect(session.state.currentOffset).toBe(5)
    expect(session.workspace.tasks[0].taskId).toBe(
      'demo:flip-challenge-test-20-decoded-labeled:6'
    )
  })

  it('treats developer annotations with blank optional detail as complete', async () => {
    const manager = createLocalAiManager({logger: mockLogger(), storage})

    const session = await manager.loadHumanTeacherDeveloperSession({
      sampleName: 'flip-challenge-test-20-decoded-labeled',
      offset: 0,
    })
    const firstTask = session.workspace.tasks[0]

    await manager.saveHumanTeacherDeveloperDraft({
      sampleName: 'flip-challenge-test-20-decoded-labeled',
      offset: 0,
      taskId: firstTask.taskId,
      annotation: {
        ...createCompleteDeveloperAnnotation(
          firstTask.taskId,
          `plain reason for ${firstTask.taskId}`
        ),
        frame_captions: ['', '', '', ''],
        option_a_summary: '',
        option_b_summary: '',
      },
    })

    const reloadedSession = await manager.loadHumanTeacherDeveloperSession({
      sampleName: 'flip-challenge-test-20-decoded-labeled',
      offset: 0,
    })

    expect(reloadedSession.workspace.completedCount).toBe(1)
    expect(reloadedSession.workspace.tasks[0]).toMatchObject({
      taskId: firstTask.taskId,
      hasDraft: true,
      isComplete: true,
      annotationStatus: 'complete',
      missingRequiredFields: [],
    })
  })

  it('persists benchmark review notes on developer annotations', async () => {
    const manager = createLocalAiManager({logger: mockLogger(), storage})

    const session = await manager.loadHumanTeacherDeveloperSession({
      sampleName: 'flip-challenge-test-20-decoded-labeled',
      offset: 0,
    })
    const firstTask = session.workspace.tasks[0]

    await manager.saveHumanTeacherDeveloperDraft({
      sampleName: 'flip-challenge-test-20-decoded-labeled',
      offset: 0,
      taskId: firstTask.taskId,
      annotation: {
        ...createCompleteDeveloperAnnotation(
          firstTask.taskId,
          `benchmark review for ${firstTask.taskId}`
        ),
        benchmark_review_issue_type: 'missed_text',
        benchmark_review_failure_note:
          'The model ignored the visible order word in the panel.',
        benchmark_review_retraining_hint:
          'Prefer explicit text order cues when they contradict object repetition.',
        benchmark_review_include_for_training: true,
      },
    })

    const task = await manager.loadHumanTeacherDeveloperTask({
      sampleName: 'flip-challenge-test-20-decoded-labeled',
      taskId: firstTask.taskId,
    })

    expect(task.task.annotation).toMatchObject({
      benchmark_review_issue_type: 'missed_text',
      benchmark_review_failure_note:
        'The model ignored the visible order word in the panel.',
      benchmark_review_retraining_hint:
        'Prefer explicit text order cues when they contradict object repetition.',
      benchmark_review_include_for_training: true,
    })
  })

  it('exports a provider-neutral external training bundle from developer annotations', async () => {
    const manager = createLocalAiManager({logger: mockLogger(), storage})

    const session = await manager.loadHumanTeacherDeveloperSession({
      sampleName: 'flip-challenge-test-20-decoded-labeled',
    })

    for (const task of session.workspace.tasks) {
      await manager.saveHumanTeacherDeveloperDraft({
        sampleName: 'flip-challenge-test-20-decoded-labeled',
        offset: 0,
        taskId: task.taskId,
        annotation: createCompleteDeveloperAnnotation(
          task.taskId,
          `export ${task.taskId} for external training`
        ),
      })
    }

    await manager.finalizeHumanTeacherDeveloperChunk({
      sampleName: 'flip-challenge-test-20-decoded-labeled',
      offset: 0,
    })

    const exported = await manager.exportHumanTeacherDeveloperBundle({
      sampleName: 'flip-challenge-test-20-decoded-labeled',
      runtimeBackend: 'ollama-direct',
      model: 'llama3.1:8b',
      visionModel: 'qwen2.5vl:7b',
      developerHumanTeacherSystemPrompt:
        'Use human-teacher guidance without collapsing into one side.',
    })
    const manifest = await fs.readJson(exported.manifestPath)
    const readme = await fs.readFile(exported.readmePath, 'utf8')
    const normalizedRows = await readJsonl(exported.annotationsPath)

    expect(exported).toMatchObject({
      developer: true,
      sampleName: 'flip-challenge-test-20-decoded-labeled',
      annotatedCount: 5,
      pendingCount: 5,
      trainedCount: 0,
      recommendedTrainingModel: 'mlx-community/Qwen3.5-9B-MLX-4bit',
      recommendedBenchmarkFlips: 200,
    })
    expect(normalizedRows).toHaveLength(5)
    expect(manifest).toMatchObject({
      bundleType: 'idenaai-human-teacher-external-training',
      developerSession: expect.objectContaining({
        sampleName: 'flip-challenge-test-20-decoded-labeled',
      }),
      runtime: expect.objectContaining({
        runtimeBackend: 'ollama-direct',
        model: 'qwen3.5:9b',
        visionModel: 'qwen3.5:9b',
      }),
      training: expect.objectContaining({
        recommendedModel: 'mlx-community/Qwen3.5-9B-MLX-4bit',
      }),
      files: expect.objectContaining({
        annotations: expect.objectContaining({
          rowCount: 5,
          sha256: expect.any(String),
        }),
      }),
    })
    expect(readme).toContain('Simple path for normal users:')
    expect(readme).toContain(
      'Upload only this folder to the machine or provider you want to use.'
    )
  })

  it('stores developer flip-training chunks in groups of 5 and marks them trained after local training succeeds', async () => {
    const sidecar = {
      getHealth: jest.fn(),
      listModels: jest.fn(),
      chat: jest.fn(),
      captionFlip: jest.fn(),
      ocrImage: jest.fn(),
      trainEpoch: jest.fn(async ({input}) => {
        await fs.writeJson(input.comparisonPath, {
          totalFlips: 100,
          correct: 61,
          accuracy: 0.61,
          evaluatedAt: '2026-04-16T16:05:00.000Z',
        })

        return {
          ok: true,
          status: 'trained',
          acceptedRows: 5,
          adapterPath: '/tmp/adapter.safetensors',
          comparisonPath: '/tmp/comparison.json',
          holdoutPath: '/tmp/holdout',
        }
      }),
    }
    const manager = createLocalAiManager({
      logger: mockLogger(),
      storage,
      sidecar,
      systemTelemetryProvider: createReadySystemTelemetryProvider(),
    })

    const session = await manager.loadHumanTeacherDeveloperSession({
      sampleName: 'flip-challenge-test-20-decoded-labeled',
    })

    expect(session).toMatchObject({
      developer: true,
      demo: true,
      chunkSize: 5,
      offset: 0,
      workspace: expect.objectContaining({
        taskCount: 5,
      }),
    })

    for (const task of session.workspace.tasks) {
      await manager.saveHumanTeacherDeveloperDraft({
        sampleName: 'flip-challenge-test-20-decoded-labeled',
        offset: 0,
        taskId: task.taskId,
        annotation: createCompleteDeveloperAnnotation(
          task.taskId,
          `human reason for ${task.taskId}`
        ),
      })
    }

    const committed = await manager.finalizeHumanTeacherDeveloperChunk({
      sampleName: 'flip-challenge-test-20-decoded-labeled',
      offset: 0,
      trainNow: true,
      advance: true,
      trainingModelPath: 'mlx-community/Qwen2.5-VL-7B-Instruct-4bit',
      localTrainingProfile: 'balanced',
      localTrainingThermalMode: 'cool',
      localTrainingEpochs: 3,
      localTrainingBatchSize: 2,
      localTrainingLoraRank: 6,
    })

    expect(sidecar.trainEpoch).toHaveBeenCalledTimes(1)
    expect(sidecar.trainEpoch).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          developerHumanTeacher: true,
          sampleName: 'flip-challenge-test-20-decoded-labeled',
          trainingModelPath: 'mlx-community/Qwen3.5-9B-MLX-4bit',
          localTrainingProfile: 'balanced',
          localTrainingThermalMode: 'cool',
          localTrainingEpochs: 3,
          localTrainingBatchSize: 2,
          localTrainingLoraRank: 6,
          offset: 0,
          chunkSize: 5,
          normalizedAnnotationsPath: expect.stringContaining(
            'annotations.normalized.jsonl'
          ),
        }),
      })
    )
    expect(committed).toMatchObject({
      developer: true,
      taskCount: 5,
      nextOffset: 5,
      training: expect.objectContaining({
        ok: true,
        status: 'trained',
      }),
      state: expect.objectContaining({
        annotatedCount: 5,
        pendingTrainingCount: 0,
        trainedCount: 5,
        currentOffset: 5,
        comparison100: expect.objectContaining({
          status: 'evaluated',
          accuracy: 0.61,
          correct: 61,
          totalFlips: 100,
          bestAccuracy: 0.61,
          history: [
            expect.objectContaining({
              accuracy: 0.61,
              correct: 61,
              totalFlips: 100,
            }),
          ],
        }),
      }),
    })
    expect(committed.training).not.toHaveProperty('adapterPath')
    expect(committed.training).not.toHaveProperty('comparisonPath')
    expect(committed.training).not.toHaveProperty('holdoutPath')

    const reloadedSession = await manager.loadHumanTeacherDeveloperSession({
      sampleName: 'flip-challenge-test-20-decoded-labeled',
    })

    expect(reloadedSession.state).toMatchObject({
      comparison100: expect.objectContaining({
        status: 'evaluated',
        accuracy: 0.61,
        correct: 61,
        totalFlips: 100,
        bestAccuracy: 0.61,
        history: [
          expect.objectContaining({
            accuracy: 0.61,
            correct: 61,
            totalFlips: 100,
          }),
        ],
      }),
    })
    expect(reloadedSession.state.lastTraining?.result ?? null).toBeNull()
  })

  it('skips already annotated developer chunks when advancing to the next 5 flips', async () => {
    const manager = createLocalAiManager({logger: mockLogger(), storage})
    const alreadyAnnotatedNextChunkTaskIds = Array.from(
      {length: 5},
      (_, index) => `demo:flip-challenge-test-20-decoded-labeled:${index + 6}`
    )
    const annotatedRows = alreadyAnnotatedNextChunkTaskIds.map((taskId) => ({
      task_id: taskId,
      ...createCompleteDeveloperAnnotation(taskId, `existing ${taskId}`),
    }))

    await storage.writeJsonAtomic(
      storage.resolveLocalAiPath(
        'human-teacher-developer',
        'flip-challenge-test-20-decoded-labeled',
        'state.json'
      ),
      {
        schemaVersion: 1,
        mode: 'developer-human-teacher',
        sampleName: 'flip-challenge-test-20-decoded-labeled',
        chunkSize: 5,
        totalAvailableTasks: 500,
        currentOffset: 0,
        annotatedTaskIds: alreadyAnnotatedNextChunkTaskIds,
        pendingTrainingTaskIds: alreadyAnnotatedNextChunkTaskIds,
        trainedTaskIds: [],
        chunks: [
          {
            offset: 5,
            taskIds: alreadyAnnotatedNextChunkTaskIds,
            rowCount: 5,
            committedAt: '2026-04-19T04:10:00.000Z',
            trainingStatus: 'pending',
          },
        ],
        comparison100: {
          status: 'not_loaded',
          history: [],
        },
      }
    )
    await fs.writeFile(
      storage.resolveLocalAiPath(
        'human-teacher-developer',
        'flip-challenge-test-20-decoded-labeled',
        'annotations.annotated.jsonl'
      ),
      `${annotatedRows.map((row) => JSON.stringify(row)).join('\n')}\n`,
      'utf8'
    )
    await fs.writeFile(
      storage.resolveLocalAiPath(
        'human-teacher-developer',
        'flip-challenge-test-20-decoded-labeled',
        'annotations.pending.jsonl'
      ),
      `${annotatedRows.map((row) => JSON.stringify(row)).join('\n')}\n`,
      'utf8'
    )

    const session = await manager.loadHumanTeacherDeveloperSession({
      sampleName: 'flip-challenge-test-20-decoded-labeled',
      offset: 0,
    })

    for (const task of session.workspace.tasks) {
      await manager.saveHumanTeacherDeveloperDraft({
        sampleName: 'flip-challenge-test-20-decoded-labeled',
        offset: 0,
        taskId: task.taskId,
        annotation: createCompleteDeveloperAnnotation(
          task.taskId,
          `advance ${task.taskId}`
        ),
      })
    }

    const committed = await manager.finalizeHumanTeacherDeveloperChunk({
      sampleName: 'flip-challenge-test-20-decoded-labeled',
      offset: 0,
      advance: true,
    })

    expect(committed.nextOffset).toBe(10)
    expect(committed.state.currentOffset).toBe(10)
  })

  it('sanitizes developer local training knobs before forwarding them to the backend', async () => {
    const sidecar = {
      getHealth: jest.fn(),
      listModels: jest.fn(),
      chat: jest.fn(),
      captionFlip: jest.fn(),
      ocrImage: jest.fn(),
      trainEpoch: jest.fn(async ({input}) => {
        await fs.writeJson(input.comparisonPath, {
          totalFlips: 100,
          correct: 60,
          accuracy: 0.6,
          evaluatedAt: '2026-04-16T16:10:00.000Z',
        })

        return {
          ok: true,
          status: 'trained',
          acceptedRows: 5,
        }
      }),
    }
    const manager = createLocalAiManager({
      logger: mockLogger(),
      storage,
      sidecar,
      systemTelemetryProvider: createReadySystemTelemetryProvider(),
    })

    const session = await manager.loadHumanTeacherDeveloperSession({
      sampleName: 'flip-challenge-test-20-decoded-labeled',
    })

    for (const task of session.workspace.tasks) {
      await manager.saveHumanTeacherDeveloperDraft({
        sampleName: 'flip-challenge-test-20-decoded-labeled',
        offset: 0,
        taskId: task.taskId,
        annotation: createCompleteDeveloperAnnotation(
          task.taskId,
          `sanitize ${task.taskId}`
        ),
      })
    }

    await manager.finalizeHumanTeacherDeveloperChunk({
      sampleName: 'flip-challenge-test-20-decoded-labeled',
      offset: 0,
      trainNow: true,
      trainingModelPath: 'malicious/custom-model',
      localTrainingProfile: 'unknown-profile',
      localTrainingThermalMode: 'lava',
      localTrainingEpochs: 99,
      localTrainingBatchSize: 0,
      localTrainingLoraRank: 999,
    })

    expect(sidecar.trainEpoch).toHaveBeenCalledTimes(1)
    const forwarded = sidecar.trainEpoch.mock.calls[0][0].input

    expect(forwarded.trainingModelPath).toBe(
      'mlx-community/Qwen3.5-9B-MLX-4bit'
    )
    expect(forwarded.localTrainingProfile).toBe('strong')
    expect(forwarded.localTrainingThermalMode).toBe('balanced')
    expect(forwarded.localTrainingEpochs).toBe(6)
    expect(forwarded.localTrainingBatchSize).toBe(1)
    expect(forwarded.localTrainingLoraRank).toBe(16)
  })

  it('sanitizes direct developer trainEpoch payloads before they reach the sidecar', async () => {
    const sidecar = {
      getHealth: jest.fn(),
      listModels: jest.fn(),
      chat: jest.fn(),
      captionFlip: jest.fn(),
      ocrImage: jest.fn(),
      trainEpoch: jest.fn(async () => ({
        ok: true,
        status: 'trained',
      })),
    }
    const manager = createLocalAiManager({
      logger: mockLogger(),
      storage,
      sidecar,
      systemTelemetryProvider: createReadySystemTelemetryProvider(),
    })

    await manager.trainEpoch({
      developerHumanTeacher: true,
      trainingModelPath: 'malicious/custom-model',
      modelPath: 'malicious/custom-model',
      localTrainingProfile: 'unknown-profile',
      localTrainingThermalMode: 'lava',
      localTrainingEpochs: 99,
      localTrainingBatchSize: 0,
      localTrainingLoraRank: 999,
      evaluationFlips: 123,
    })

    expect(sidecar.trainEpoch).toHaveBeenCalledTimes(1)

    const forwarded = sidecar.trainEpoch.mock.calls[0][0]

    expect(forwarded.trainingModelPath).toBe(
      'mlx-community/Qwen3.5-9B-MLX-4bit'
    )
    expect(forwarded.modelPath).toBe('mlx-community/Qwen3.5-9B-MLX-4bit')
    expect(forwarded.localTrainingProfile).toBe('strong')
    expect(forwarded.localTrainingThermalMode).toBe('balanced')
    expect(forwarded.localTrainingEpochs).toBe(6)
    expect(forwarded.localTrainingBatchSize).toBe(1)
    expect(forwarded.localTrainingLoraRank).toBe(16)
    expect(forwarded.evaluationFlips).toBe(100)
  })

  it('blocks developer local training when telemetry reports a hard stop and no override is present', async () => {
    const sidecar = {
      getHealth: jest.fn(),
      listModels: jest.fn(),
      chat: jest.fn(),
      captionFlip: jest.fn(),
      ocrImage: jest.fn(),
      trainEpoch: jest.fn(async () => ({
        ok: true,
        status: 'trained',
      })),
    }
    const manager = createLocalAiManager({
      logger: mockLogger(),
      storage,
      sidecar,
      systemTelemetryProvider: async () => ({
        collectedAt: '2026-04-18T09:30:00.000Z',
        system: {
          thermal: {
            available: true,
            pressure: 'limited',
            cpuSpeedLimit: 72,
          },
          battery: {
            available: true,
            isCharging: true,
            percent: 100,
          },
        },
      }),
    })

    const result = await manager.trainEpoch({
      developerHumanTeacher: true,
    })

    expect(result).toMatchObject({
      ok: false,
      status: 'blocked_by_system_pressure',
      error: 'system_pressure',
      trainingReadiness: expect.objectContaining({
        status: 'blocked',
        requiresExplicitOverride: true,
      }),
    })
    expect(result.lastError).toMatch(/CPU speed|override/i)
    expect(sidecar.trainEpoch).not.toHaveBeenCalled()
  })

  it('blocks local training readiness when memory is nearly exhausted', () => {
    expect(
      getTelemetryTrainingReadiness({
        system: {
          memoryUsagePercent: 99,
          memoryFreeGiB: 0.4,
          battery: {
            available: true,
            isCharging: true,
            percent: 95,
          },
          thermal: {
            available: true,
            pressure: 'nominal',
          },
        },
      })
    ).toMatchObject({
      status: 'blocked',
      label: 'Blocked by memory pressure',
      requiresExplicitOverride: true,
      canStartWithoutOverride: false,
    })
  })

  it('parses plugged-in but discharging pmset battery output correctly', () => {
    expect(
      parsePmsetBatteryOutput(`Now drawing from 'AC Power'
 -InternalBattery-0\t95%; discharging; 12:45 remaining present: true`)
    ).toMatchObject({
      available: true,
      source: 'AC Power',
      percent: 95,
      state: 'discharging',
      isCharging: false,
      timeRemainingMinutes: 765,
    })
  })

  it('parses macOS IOAccelerator GPU utilization output', () => {
    expect(
      parseIoregGpuOutput(`
| |   "PerformanceStatistics" = {"Device Utilization %"=58,"Renderer Utilization %"=56,"Tiler Utilization %"=57}
| |   "PerformanceStatistics" = {"Device Utilization %"=62,"Renderer Utilization %"=60,"Tiler Utilization %"=59}
`)
    ).toMatchObject({
      available: true,
      deviceUtilizationPercent: 60,
      rendererUtilizationPercent: 58,
      tilerUtilizationPercent: 58,
    })
  })

  it('allows an explicit system-pressure override for developer chunk training', async () => {
    const sidecar = {
      getHealth: jest.fn(),
      listModels: jest.fn(),
      chat: jest.fn(),
      captionFlip: jest.fn(),
      ocrImage: jest.fn(),
      trainEpoch: jest.fn(async ({input}) => {
        await fs.writeJson(input.comparisonPath, {
          totalFlips: 100,
          correct: 58,
          accuracy: 0.58,
          evaluatedAt: '2026-04-18T10:15:00.000Z',
        })

        return {
          ok: true,
          status: 'trained',
          acceptedRows: 5,
        }
      }),
    }
    const manager = createLocalAiManager({
      logger: mockLogger(),
      storage,
      sidecar,
      systemTelemetryProvider: async () => ({
        collectedAt: '2026-04-18T10:00:00.000Z',
        system: {
          thermal: {
            available: true,
            pressure: 'limited',
            cpuSpeedLimit: 74,
          },
          battery: {
            available: true,
            isCharging: true,
            percent: 100,
          },
        },
      }),
    })

    const session = await manager.loadHumanTeacherDeveloperSession({
      sampleName: 'flip-challenge-test-20-decoded-labeled',
    })

    for (const task of session.workspace.tasks) {
      await manager.saveHumanTeacherDeveloperDraft({
        sampleName: 'flip-challenge-test-20-decoded-labeled',
        offset: 0,
        taskId: task.taskId,
        annotation: createCompleteDeveloperAnnotation(
          task.taskId,
          `override ${task.taskId}`
        ),
      })
    }

    const result = await manager.finalizeHumanTeacherDeveloperChunk({
      sampleName: 'flip-challenge-test-20-decoded-labeled',
      offset: 0,
      trainNow: true,
      allowSystemPressureOverride: true,
    })

    expect(result.training).toMatchObject({
      ok: true,
      status: 'trained',
    })
    expect(sidecar.trainEpoch).toHaveBeenCalledTimes(1)
    expect(sidecar.trainEpoch).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          developerHumanTeacher: true,
          allowSystemPressureOverride: true,
        }),
      })
    )
  })

  it('falls back to the local developer training runner when the sidecar does not implement training', async () => {
    const sidecar = {
      getHealth: jest.fn(),
      listModels: jest.fn(),
      chat: jest.fn(),
      captionFlip: jest.fn(),
      ocrImage: jest.fn(),
      trainEpoch: jest.fn(async () => ({
        ok: false,
        status: 'not_implemented',
        lastError:
          'Local AI training request is not implemented by this Local AI sidecar',
      })),
    }
    const developerTrainingRunner = {
      runEpoch: jest.fn(async ({input}) => {
        await fs.writeJson(input.comparisonPath, {
          accuracy: 0.63,
          correct: 63,
          totalFlips: 100,
          evaluatedAt: '2026-04-16T18:00:00.000Z',
        })

        return {
          ok: true,
          status: 'trained',
          trainingBackend: 'mlx_vlm_local',
          localTrainingThermalMode: 'balanced',
          acceptedRows: 5,
          accuracy: 0.63,
          correct: 63,
          totalFlips: 100,
          evaluatedAt: '2026-04-16T18:00:00.000Z',
        }
      }),
    }
    const manager = createLocalAiManager({
      logger: mockLogger(),
      storage,
      sidecar,
      developerTrainingRunner,
      systemTelemetryProvider: createReadySystemTelemetryProvider(),
    })

    const session = await manager.loadHumanTeacherDeveloperSession({
      sampleName: 'flip-challenge-test-20-decoded-labeled',
    })

    for (const task of session.workspace.tasks) {
      await manager.saveHumanTeacherDeveloperDraft({
        sampleName: 'flip-challenge-test-20-decoded-labeled',
        offset: 0,
        taskId: task.taskId,
        annotation: createCompleteDeveloperAnnotation(
          task.taskId,
          `fallback reason for ${task.taskId}`
        ),
      })
    }

    const committed = await manager.finalizeHumanTeacherDeveloperChunk({
      sampleName: 'flip-challenge-test-20-decoded-labeled',
      offset: 0,
      trainNow: true,
      advance: true,
      trainingModelPath: 'mlx-community/Qwen3.5-9B-MLX-4bit',
      localTrainingProfile: 'strong',
      localTrainingThermalMode: 'balanced',
      localTrainingEpochs: 4,
      localTrainingBatchSize: 1,
      localTrainingLoraRank: 12,
    })

    expect(sidecar.trainEpoch).toHaveBeenCalledTimes(1)
    expect(developerTrainingRunner.runEpoch).toHaveBeenCalledTimes(1)
    expect(developerTrainingRunner.runEpoch).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          developerHumanTeacher: true,
          sampleName: 'flip-challenge-test-20-decoded-labeled',
          trainingModelPath: 'mlx-community/Qwen3.5-9B-MLX-4bit',
          localTrainingProfile: 'strong',
          localTrainingThermalMode: 'balanced',
          localTrainingEpochs: 4,
          localTrainingBatchSize: 1,
          localTrainingLoraRank: 12,
          offset: 0,
          chunkSize: 5,
        }),
      })
    )
    expect(committed).toMatchObject({
      training: expect.objectContaining({
        ok: true,
        status: 'trained',
        trainingBackend: 'mlx_vlm_local',
      }),
      state: expect.objectContaining({
        pendingTrainingCount: 0,
        trainedCount: 5,
        activeLocalTrainingThermalMode: 'balanced',
        comparison100: expect.objectContaining({
          status: 'evaluated',
          accuracy: 0.63,
          correct: 63,
          totalFlips: 100,
          bestAccuracy: 0.63,
        }),
      }),
    })
  })

  it('persists the last developer training failure reason when local training does not complete', async () => {
    const sidecar = {
      getHealth: jest.fn(),
      listModels: jest.fn(),
      chat: jest.fn(),
      captionFlip: jest.fn(),
      ocrImage: jest.fn(),
      trainEpoch: jest.fn(async () => ({
        ok: false,
        status: 'failed',
        error: 'runtime_start_failed',
        lastError:
          'Training backend is unavailable in the current local runtime',
      })),
    }
    const manager = createLocalAiManager({
      logger: mockLogger(),
      storage,
      sidecar,
      systemTelemetryProvider: createReadySystemTelemetryProvider(),
    })

    const session = await manager.loadHumanTeacherDeveloperSession({
      sampleName: 'flip-challenge-test-20-decoded-labeled',
    })

    for (const task of session.workspace.tasks) {
      await manager.saveHumanTeacherDeveloperDraft({
        sampleName: 'flip-challenge-test-20-decoded-labeled',
        offset: 0,
        taskId: task.taskId,
        annotation: createCompleteDeveloperAnnotation(
          task.taskId,
          `human reason for ${task.taskId}`
        ),
      })
    }

    const committed = await manager.finalizeHumanTeacherDeveloperChunk({
      sampleName: 'flip-challenge-test-20-decoded-labeled',
      offset: 0,
      trainNow: true,
    })

    expect(committed).toMatchObject({
      training: expect.objectContaining({
        ok: false,
        status: 'failed',
      }),
      state: expect.objectContaining({
        annotatedCount: 5,
        pendingTrainingCount: 5,
        trainedCount: 0,
        lastTraining: expect.objectContaining({
          status: 'failed',
          failureReason:
            'Training backend is unavailable in the current local runtime',
        }),
      }),
    })

    const reloadedSession = await manager.loadHumanTeacherDeveloperSession({
      sampleName: 'flip-challenge-test-20-decoded-labeled',
    })

    expect(reloadedSession.state.lastTraining).toMatchObject({
      status: 'failed',
      failureReason:
        'Training backend is unavailable in the current local runtime',
    })
    expect(reloadedSession.state.lastTraining?.result ?? null).toBeNull()
  })

  it('runs the explicit 50-flip developer comparison and stores the updated success history', async () => {
    const sidecar = {
      getHealth: jest.fn(),
      listModels: jest.fn(),
      chat: jest.fn(),
      captionFlip: jest.fn(),
      ocrImage: jest.fn(),
      trainEpoch: jest.fn(async ({input}) => {
        await fs.writeJson(input.comparisonPath, {
          totalFlips: 50,
          correct: 33,
          accuracy: 0.66,
          evaluatedAt: '2026-04-16T17:10:00.000Z',
        })

        return {
          ok: true,
          status: 'evaluated',
          comparisonPath: '/tmp/comparison-50flips.json',
          holdoutPath: '/tmp/holdout-50',
        }
      }),
    }
    const manager = createLocalAiManager({
      logger: mockLogger(),
      storage,
      sidecar,
      systemTelemetryProvider: createReadySystemTelemetryProvider(),
    })

    await storage.writeJsonAtomic(
      storage.resolveLocalAiPath(
        'human-teacher-developer',
        'flip-challenge-test-20-decoded-labeled',
        'state.json'
      ),
      {
        schemaVersion: 1,
        mode: 'developer-human-teacher',
        sampleName: 'flip-challenge-test-20-decoded-labeled',
        chunkSize: 5,
        totalAvailableTasks: 20,
        currentOffset: 5,
        annotatedTaskIds: ['demo:flip-challenge-test-20-decoded-labeled:1'],
        pendingTrainingTaskIds: [],
        trainedTaskIds: ['demo:flip-challenge-test-20-decoded-labeled:1'],
        chunks: [],
        comparison100: {
          status: 'not_loaded',
          history: [],
        },
      }
    )

    const result = await manager.runHumanTeacherDeveloperComparison({
      sampleName: 'flip-challenge-test-20-decoded-labeled',
      evaluationFlips: 50,
    })

    expect(sidecar.trainEpoch).toHaveBeenCalledTimes(1)
    expect(sidecar.trainEpoch).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          developerHumanTeacher: true,
          sampleName: 'flip-challenge-test-20-decoded-labeled',
          comparisonOnly: true,
          compareOnly: true,
          evaluationFlips: 50,
          comparisonPath: expect.stringContaining('comparison-50flips.json'),
        }),
      })
    )
    expect(result).toMatchObject({
      developer: true,
      state: expect.objectContaining({
        comparison100: expect.objectContaining({
          status: 'evaluated',
          benchmarkFlips: 50,
          accuracy: 0.66,
          correct: 33,
          totalFlips: 50,
          bestAccuracy: 0.66,
          history: [
            expect.objectContaining({
              accuracy: 0.66,
              correct: 33,
              totalFlips: 50,
            }),
          ],
        }),
      }),
    })
    expect(result.comparison).not.toHaveProperty('comparisonPath')
    expect(result.comparison).not.toHaveProperty('holdoutPath')
  })

  it('marks a running developer local run as stopping and delegates the stop request to the training runner', async () => {
    const developerTrainingRunner = {
      runEpoch: jest.fn(),
      stopCurrentRun: jest.fn(async () => ({
        stopped: true,
        status: 'stopping',
        kind: 'training',
        sampleName: 'flip-challenge-test-20-decoded-labeled',
      })),
    }
    const manager = createLocalAiManager({
      logger: mockLogger(),
      storage,
      developerTrainingRunner,
    })
    const statePath = storage.resolveLocalAiPath(
      'human-teacher-developer',
      'flip-challenge-test-20-decoded-labeled',
      'state.json'
    )

    await storage.writeJsonAtomic(statePath, {
      schemaVersion: 1,
      mode: 'developer-human-teacher',
      sampleName: 'flip-challenge-test-20-decoded-labeled',
      chunkSize: 5,
      totalAvailableTasks: 500,
      currentOffset: 5,
      annotatedTaskIds: [
        'demo:flip-challenge-test-20-decoded-labeled:1',
        'demo:flip-challenge-test-20-decoded-labeled:2',
        'demo:flip-challenge-test-20-decoded-labeled:3',
        'demo:flip-challenge-test-20-decoded-labeled:4',
        'demo:flip-challenge-test-20-decoded-labeled:5',
      ],
      pendingTrainingTaskIds: [
        'demo:flip-challenge-test-20-decoded-labeled:1',
        'demo:flip-challenge-test-20-decoded-labeled:2',
        'demo:flip-challenge-test-20-decoded-labeled:3',
        'demo:flip-challenge-test-20-decoded-labeled:4',
        'demo:flip-challenge-test-20-decoded-labeled:5',
      ],
      trainedTaskIds: [],
      chunks: [],
      activeRun: {
        kind: 'training',
        status: 'running',
        stage: 'benchmark_baseline',
        stageIndex: 4,
        stageCount: 5,
        progressPercent: 71.1,
        message: 'Scoring unseen flips with the baseline model',
        sampleName: 'flip-challenge-test-20-decoded-labeled',
        chunkOffset: 0,
        chunkSize: 5,
        currentEpoch: 1,
        totalEpochs: 1,
        currentStep: 5,
        stepsPerEpoch: 5,
        totalSteps: 5,
        latestLoss: 0.238246,
        benchmarkPhase: 'baseline',
        benchmarkCurrent: 35,
        benchmarkTotal: 100,
        evaluationFlips: 100,
        currentFlipHash: 'flip-benchmark-hash',
        startedAt: '2026-04-19T02:32:44.760Z',
        updatedAt: '2026-04-19T02:44:01.749Z',
      },
      comparison100: {
        status: 'running',
        benchmarkFlips: 100,
        history: [],
      },
    })

    const result = await manager.stopHumanTeacherDeveloperRun({
      sampleName: 'flip-challenge-test-20-decoded-labeled',
    })

    expect(developerTrainingRunner.stopCurrentRun).toHaveBeenCalledWith({
      sampleName: 'flip-challenge-test-20-decoded-labeled',
      kind: 'training',
      stopMode: 'cancel_now',
    })
    expect(result).toMatchObject({
      developer: true,
      stopped: true,
      state: expect.objectContaining({
        activeRun: expect.objectContaining({
          status: 'stopping',
          stopMode: 'cancel_now',
        }),
      }),
    })
  })

  it('can stop a running developer local run after the current unit finishes', async () => {
    const developerTrainingRunner = {
      runEpoch: jest.fn(),
      stopCurrentRun: jest.fn(async () => ({
        stopped: true,
        status: 'stopping_after_unit',
        stopMode: 'after_unit',
      })),
    }
    const manager = createLocalAiManager({
      logger: mockLogger(),
      storage,
      developerTrainingRunner,
    })

    await storage.writeJsonAtomic(
      storage.resolveLocalAiPath(
        'human-teacher-developer',
        'flip-challenge-test-20-decoded-labeled',
        'state.json'
      ),
      {
        schemaVersion: 1,
        mode: 'developer-human-teacher',
        sampleName: 'flip-challenge-test-20-decoded-labeled',
        chunkSize: 5,
        totalAvailableTasks: 20,
        currentOffset: 5,
        annotatedTaskIds: [],
        pendingTrainingTaskIds: [],
        trainedTaskIds: [],
        chunks: [],
        activeRun: {
          kind: 'comparison',
          status: 'running',
          stage: 'benchmark_adapter',
          stageIndex: 5,
          stageCount: 5,
          progressPercent: 88.5,
          message: 'Scoring unseen flips with the trained adapter',
          sampleName: 'flip-challenge-test-20-decoded-labeled',
          evaluationFlips: 100,
          benchmarkCurrent: 59,
          benchmarkTotal: 100,
          benchmarkPhase: 'adapter',
          startedAt: '2026-04-19T02:32:44.760Z',
          updatedAt: '2026-04-19T02:44:01.749Z',
        },
        comparison100: {
          status: 'running',
          benchmarkFlips: 100,
          history: [],
        },
      }
    )

    const result = await manager.stopHumanTeacherDeveloperRun({
      sampleName: 'flip-challenge-test-20-decoded-labeled',
      stopMode: 'after_unit',
    })

    expect(developerTrainingRunner.stopCurrentRun).toHaveBeenCalledWith({
      sampleName: 'flip-challenge-test-20-decoded-labeled',
      kind: 'comparison',
      stopMode: 'after_unit',
    })
    expect(result).toMatchObject({
      developer: true,
      stopped: true,
      state: expect.objectContaining({
        activeRun: expect.objectContaining({
          status: 'stopping',
          stopMode: 'after_unit',
          message: 'Stopping after the current benchmark flip…',
        }),
      }),
    })
  })

  it('updates live developer run controls and reflects the new thermal modes in state', async () => {
    const developerTrainingRunner = {
      runEpoch: jest.fn(),
      stopCurrentRun: jest.fn(),
      updateCurrentRunControls: jest.fn(async () => ({
        updated: true,
        status: 'updated',
        trainingThermalMode: 'cool',
        benchmarkThermalMode: 'full_speed',
        trainingStepCooldownMs: 750,
        trainingEpochCooldownMs: 4000,
        benchmarkCooldownMs: 0,
      })),
    }
    const manager = createLocalAiManager({
      logger: mockLogger(),
      storage,
      developerTrainingRunner,
    })
    const statePath = storage.resolveLocalAiPath(
      'human-teacher-developer',
      'flip-challenge-test-20-decoded-labeled',
      'state.json'
    )

    await storage.writeJsonAtomic(statePath, {
      schemaVersion: 1,
      mode: 'developer-human-teacher',
      sampleName: 'flip-challenge-test-20-decoded-labeled',
      chunkSize: 5,
      totalAvailableTasks: 500,
      currentOffset: 5,
      annotatedTaskIds: [],
      pendingTrainingTaskIds: [],
      trainedTaskIds: [],
      chunks: [],
      activeRun: {
        kind: 'training',
        status: 'running',
        stage: 'train_adapter',
        stageIndex: 2,
        stageCount: 5,
        progressPercent: 33.3,
        message: 'Training the local adapter on this 5-flip pack',
        sampleName: 'flip-challenge-test-20-decoded-labeled',
        chunkOffset: 0,
        chunkSize: 5,
        trainingThermalMode: 'balanced',
        benchmarkThermalMode: 'balanced',
        startedAt: '2026-04-19T03:00:00.000Z',
        updatedAt: '2026-04-19T03:05:00.000Z',
      },
    })

    const result = await manager.updateHumanTeacherDeveloperRunControls({
      sampleName: 'flip-challenge-test-20-decoded-labeled',
      localTrainingThermalMode: 'cool',
      localBenchmarkThermalMode: 'full_speed',
    })

    expect(
      developerTrainingRunner.updateCurrentRunControls
    ).toHaveBeenCalledWith({
      localTrainingThermalMode: 'cool',
      localBenchmarkThermalMode: 'full_speed',
    })
    expect(result).toMatchObject({
      developer: true,
      updated: true,
      state: expect.objectContaining({
        activeRun: expect.objectContaining({
          trainingThermalMode: 'cool',
          benchmarkThermalMode: 'full_speed',
        }),
      }),
    })
  })

  it('rejects developer comparison runs before any chunk was trained into the local model', async () => {
    const manager = createLocalAiManager({logger: mockLogger(), storage})

    await storage.writeJsonAtomic(
      storage.resolveLocalAiPath(
        'human-teacher-developer',
        'flip-challenge-test-20-decoded-labeled',
        'state.json'
      ),
      {
        schemaVersion: 1,
        mode: 'developer-human-teacher',
        sampleName: 'flip-challenge-test-20-decoded-labeled',
        chunkSize: 5,
        totalAvailableTasks: 20,
        currentOffset: 5,
        annotatedTaskIds: [
          'demo:flip-challenge-test-20-decoded-labeled:1',
          'demo:flip-challenge-test-20-decoded-labeled:2',
          'demo:flip-challenge-test-20-decoded-labeled:3',
          'demo:flip-challenge-test-20-decoded-labeled:4',
          'demo:flip-challenge-test-20-decoded-labeled:5',
        ],
        pendingTrainingTaskIds: [
          'demo:flip-challenge-test-20-decoded-labeled:1',
          'demo:flip-challenge-test-20-decoded-labeled:2',
          'demo:flip-challenge-test-20-decoded-labeled:3',
          'demo:flip-challenge-test-20-decoded-labeled:4',
          'demo:flip-challenge-test-20-decoded-labeled:5',
        ],
        trainedTaskIds: [],
        chunks: [],
        comparison100: {
          status: 'not_loaded',
          history: [],
        },
      }
    )

    await expect(
      manager.runHumanTeacherDeveloperComparison({
        sampleName: 'flip-challenge-test-20-decoded-labeled',
        evaluationFlips: 100,
      })
    ).rejects.toThrow(
      'Train the saved 5-flip chunk first before running the 100-flip comparison'
    )
  })

  it('fails developer comparison runs that return no benchmark metrics', async () => {
    const sidecar = {
      getHealth: jest.fn(),
      listModels: jest.fn(),
      chat: jest.fn(),
      captionFlip: jest.fn(),
      ocrImage: jest.fn(),
      trainEpoch: jest.fn(async () => ({
        ok: true,
        status: 'trained',
        trainingBackend: 'local_stub',
      })),
    }
    const manager = createLocalAiManager({
      logger: mockLogger(),
      storage,
      sidecar,
      systemTelemetryProvider: createReadySystemTelemetryProvider(),
    })

    await storage.writeJsonAtomic(
      storage.resolveLocalAiPath(
        'human-teacher-developer',
        'flip-challenge-test-20-decoded-labeled',
        'state.json'
      ),
      {
        schemaVersion: 1,
        mode: 'developer-human-teacher',
        sampleName: 'flip-challenge-test-20-decoded-labeled',
        chunkSize: 5,
        totalAvailableTasks: 20,
        currentOffset: 5,
        annotatedTaskIds: ['demo:flip-challenge-test-20-decoded-labeled:1'],
        pendingTrainingTaskIds: [],
        trainedTaskIds: ['demo:flip-challenge-test-20-decoded-labeled:1'],
        chunks: [],
        comparison100: {
          status: 'not_loaded',
          history: [],
        },
      }
    )

    const result = await manager.runHumanTeacherDeveloperComparison({
      sampleName: 'flip-challenge-test-20-decoded-labeled',
      evaluationFlips: 100,
    })

    expect(result).toMatchObject({
      developer: true,
      comparison: expect.objectContaining({
        ok: false,
        status: 'failed',
        failureReason:
          'The local comparison finished without benchmark metrics.',
      }),
      state: expect.objectContaining({
        comparison100: expect.objectContaining({
          status: 'failed',
          benchmarkFlips: 100,
          accuracy: null,
          correct: null,
          totalFlips: null,
        }),
      }),
    })
  })

  it('loads developer benchmark example flips for the latest and previous run', async () => {
    const manager = createLocalAiManager({
      logger: mockLogger(),
      storage,
    })
    const sampleName = 'flip-challenge-test-20-decoded-labeled'
    const developerDir = storage.resolveLocalAiPath(
      'human-teacher-developer',
      sampleName
    )
    const currentComparisonPath = path.join(
      developerDir,
      'runtime-training',
      'comparison-100flips-current.json'
    )
    const previousComparisonPath = path.join(
      developerDir,
      'runtime-training',
      'comparison-100flips-previous.json'
    )
    const currentTrainedPath = path.join(
      developerDir,
      'runtime-training',
      'trained-eval-100-current.json'
    )
    const previousTrainedPath = path.join(
      developerDir,
      'runtime-training',
      'trained-eval-100-previous.json'
    )
    const currentBaselinePath = path.join(
      developerDir,
      'runtime-training',
      'baseline-eval-100-current.json'
    )
    const previousBaselinePath = path.join(
      developerDir,
      'runtime-training',
      'baseline-eval-100-previous.json'
    )

    await fs.ensureDir(path.join(developerDir, 'runtime-training'))

    await storage.writeJsonAtomic(
      storage.resolveLocalAiPath(
        'human-teacher-developer',
        sampleName,
        'state.json'
      ),
      {
        schemaVersion: 1,
        mode: 'developer-human-teacher',
        sampleName,
        chunkSize: 5,
        totalAvailableTasks: 20,
        currentOffset: 5,
        annotatedTaskIds: ['demo:flip-challenge-test-20-decoded-labeled:1'],
        pendingTrainingTaskIds: [],
        trainedTaskIds: ['demo:flip-challenge-test-20-decoded-labeled:1'],
        chunks: [],
        comparison100: {
          status: 'evaluated',
          benchmarkFlips: 100,
          lastEvaluatedAt: '2026-04-18T19:40:00.000Z',
          lastResultPath: currentComparisonPath,
          accuracy: 0.64,
          correct: 64,
          totalFlips: 100,
          history: [
            {
              status: 'evaluated',
              benchmarkFlips: 100,
              evaluatedAt: '2026-04-18T19:40:00.000Z',
              resultPath: currentComparisonPath,
              accuracy: 0.64,
              correct: 64,
              totalFlips: 100,
            },
            {
              status: 'evaluated',
              benchmarkFlips: 100,
              evaluatedAt: '2026-04-18T18:20:00.000Z',
              resultPath: previousComparisonPath,
              accuracy: 0.6,
              correct: 60,
              totalFlips: 100,
            },
          ],
        },
      }
    )

    await fs.writeJson(currentComparisonPath, {
      evaluatedAt: '2026-04-18T19:40:00.000Z',
      accuracy: 0.64,
      correct: 64,
      totalFlips: 100,
      deltaAccuracy: 0.04,
      baseline: {
        resultPath: currentBaselinePath,
      },
      trained: {
        resultPath: currentTrainedPath,
      },
    })
    await fs.writeJson(previousComparisonPath, {
      evaluatedAt: '2026-04-18T18:20:00.000Z',
      accuracy: 0.6,
      correct: 60,
      totalFlips: 100,
      baseline: {
        resultPath: previousBaselinePath,
      },
      trained: {
        resultPath: previousTrainedPath,
      },
    })
    await fs.writeJson(currentBaselinePath, {
      results: [
        {
          index: 1,
          sampleId: 'demo:flip-challenge-test-20-decoded-labeled:101',
          flipHash: 'flip-improved',
          expected: 'left',
          predicted: 'right',
          correct: false,
          rawResponse: 'RIGHT',
        },
        {
          index: 2,
          sampleId: 'demo:flip-challenge-test-20-decoded-labeled:102',
          flipHash: 'flip-regressed',
          expected: 'right',
          predicted: 'right',
          correct: true,
          rawResponse: 'RIGHT',
        },
      ],
    })
    await fs.writeJson(previousBaselinePath, {results: []})
    const maliciousParsedResponse = {
      answer: 'left',
      longText: 'x'.repeat(800),
      nested: {
        level2: {
          level3: {
            level4: 'too-deep',
          },
        },
      },
    }
    Object.defineProperty(maliciousParsedResponse, '__proto__', {
      value: {polluted: 'yes'},
      enumerable: true,
      configurable: true,
      writable: true,
    })
    maliciousParsedResponse.constructor = {bad: true}

    await fs.writeJson(currentTrainedPath, {
      results: [
        {
          index: 1,
          sampleId: 'demo:flip-challenge-test-20-decoded-labeled:101',
          flipHash: 'flip-improved',
          expected: 'left',
          predicted: 'left',
          correct: true,
          rawResponse: 'LEFT',
          parsedResponse: maliciousParsedResponse,
          candidateScores: {
            left: {avg_logprob: -0.12},
            right: {avg_logprob: -0.81},
            extra_01: {avg_logprob: -1.01},
            extra_02: {avg_logprob: -1.02},
            extra_03: {avg_logprob: -1.03},
            extra_04: {avg_logprob: -1.04},
            extra_05: {avg_logprob: -1.05},
            extra_06: {avg_logprob: -1.06},
            extra_07: {avg_logprob: -1.07},
            extra_08: {avg_logprob: -1.08},
            extra_09: {avg_logprob: -1.09},
            extra_10: {avg_logprob: -1.1},
            extra_11: {avg_logprob: -1.11},
            extra_12: {avg_logprob: -1.12},
            extra_13: {avg_logprob: -1.13},
            extra_14: {avg_logprob: -1.14},
            extra_15: {avg_logprob: -1.15},
            extra_16: {avg_logprob: -1.16},
            extra_17: {avg_logprob: -1.17},
            extra_18: {avg_logprob: -1.18},
            extra_19: {avg_logprob: -1.19},
            extra_20: {avg_logprob: -1.2},
            extra_21: {avg_logprob: -1.21},
            extra_22: {avg_logprob: -1.22},
            extra_23: {avg_logprob: -1.23},
            extra_24: {avg_logprob: -1.24},
            extra_25: {avg_logprob: -1.25},
          },
          candidateAnalyses: {
            left: {
              notes: Array.from(
                {length: 20},
                (_, index) => `note-${index + 1}`
              ),
            },
          },
        },
        {
          index: 2,
          sampleId: 'demo:flip-challenge-test-20-decoded-labeled:102',
          flipHash: 'flip-regressed',
          expected: 'right',
          predicted: 'left',
          correct: false,
        },
        {
          index: 3,
          sampleId: 'demo:flip-challenge-test-20-decoded-labeled:103',
          flipHash: 'flip-stable',
          expected: 'right',
          predicted: 'right',
          correct: true,
        },
      ],
    })
    await fs.writeJson(previousTrainedPath, {
      results: [
        {
          index: 1,
          sampleId: 'demo:flip-challenge-test-20-decoded-labeled:101',
          flipHash: 'flip-improved',
          expected: 'left',
          predicted: 'right',
          correct: false,
        },
        {
          index: 2,
          sampleId: 'demo:flip-challenge-test-20-decoded-labeled:102',
          flipHash: 'flip-regressed',
          expected: 'right',
          predicted: 'right',
          correct: true,
        },
        {
          index: 3,
          sampleId: 'demo:flip-challenge-test-20-decoded-labeled:103',
          flipHash: 'flip-stable',
          expected: 'right',
          predicted: 'right',
          correct: true,
        },
      ],
    })

    const result = await manager.loadHumanTeacherDeveloperComparisonExamples({
      sampleName,
      evaluationFlips: 100,
    })

    expect(result).toEqual(
      expect.objectContaining({
        developer: true,
        sampleName,
        benchmarkFlips: 100,
        hasDetailedResults: true,
        current: expect.objectContaining({
          accuracy: 0.64,
          correct: 64,
          totalFlips: 100,
        }),
        previous: expect.objectContaining({
          accuracy: 0.6,
          correct: 60,
          totalFlips: 100,
        }),
        examples: expect.arrayContaining([
          expect.objectContaining({
            flipHash: 'flip-improved',
            changeType: 'improved',
            reviewTarget: expect.objectContaining({
              taskId: 'demo:flip-challenge-test-20-decoded-labeled:101',
              offset: 100,
            }),
            current: expect.objectContaining({
              predicted: 'left',
              correct: true,
            }),
            baseline: expect.objectContaining({
              predicted: 'right',
              correct: false,
            }),
            currentDetails: expect.objectContaining({
              rawResponse: 'LEFT',
              parsedResponse: expect.objectContaining({
                answer: 'left',
                longText: 'x'.repeat(400),
                nested: expect.objectContaining({
                  level2: expect.objectContaining({
                    level3: '[truncated]',
                  }),
                }),
              }),
              candidateScores: expect.objectContaining({
                left: expect.objectContaining({
                  avg_logprob: -0.12,
                }),
                __truncated_keys__: 3,
              }),
              candidateAnalyses: expect.objectContaining({
                left: expect.objectContaining({
                  notes: expect.arrayContaining([
                    'note-1',
                    'note-12',
                    '… 8 more items',
                  ]),
                }),
              }),
            }),
            previous: expect.objectContaining({
              predicted: 'right',
              correct: false,
            }),
          }),
          expect.objectContaining({
            flipHash: 'flip-regressed',
            changeType: 'regressed',
            current: expect.objectContaining({
              predicted: 'left',
              correct: false,
            }),
            previous: expect.objectContaining({
              predicted: 'right',
              correct: true,
            }),
          }),
        ]),
      })
    )
    expect(result.current).not.toHaveProperty('resultPath')
    expect(result.previous).not.toHaveProperty('resultPath')
    expect(result.examples).toHaveLength(3)
    const improvedExample = result.examples.find(
      (example) => example.flipHash === 'flip-improved'
    )
    const firstParsed = improvedExample.currentDetails.parsedResponse
    expect(firstParsed).toEqual(
      expect.objectContaining({
        _constructor: expect.objectContaining({
          bad: true,
        }),
        ___proto__: expect.objectContaining({
          polluted: 'yes',
        }),
      })
    )
    expect(firstParsed.polluted).toBeUndefined()
    expect(Object.prototype.hasOwnProperty.call(firstParsed, '__proto__')).toBe(
      false
    )
  })

  it('recovers saved benchmark size from legacy comparison result paths', async () => {
    const manager = createLocalAiManager({
      logger: mockLogger(),
      storage,
    })
    const sampleName = 'flip-challenge-test-20-decoded-labeled'
    const developerDir = storage.resolveLocalAiPath(
      'human-teacher-developer',
      sampleName
    )
    const currentComparisonPath = path.join(
      developerDir,
      'comparison-100flips.json'
    )
    const currentBaselinePath = path.join(
      developerDir,
      'runtime-training',
      'baseline-eval-100.json'
    )
    const currentTrainedPath = path.join(
      developerDir,
      'runtime-training',
      'trained-eval-100.json'
    )

    await fs.ensureDir(path.dirname(currentBaselinePath))

    await storage.writeJsonAtomic(path.join(developerDir, 'state.json'), {
      schemaVersion: 1,
      mode: 'developer-human-teacher',
      sampleName,
      chunkSize: 5,
      totalAvailableTasks: 20,
      currentOffset: 5,
      annotatedTaskIds: ['demo:flip-challenge-test-20-decoded-labeled:1'],
      pendingTrainingTaskIds: [],
      trainedTaskIds: ['demo:flip-challenge-test-20-decoded-labeled:1'],
      chunks: [],
      comparison100: {
        status: 'evaluated',
        benchmarkFlips: 86,
        lastEvaluatedAt: '2026-04-19T03:26:12.987Z',
        lastResultPath: currentComparisonPath,
        accuracy: 0.313953,
        correct: 27,
        totalFlips: 86,
        history: [
          {
            status: 'evaluated',
            benchmarkFlips: 86,
            evaluatedAt: '2026-04-19T03:26:12.987Z',
            resultPath: currentComparisonPath,
            accuracy: 0.313953,
            correct: 27,
            totalFlips: 86,
          },
        ],
      },
    })

    await fs.writeJson(currentComparisonPath, {
      evaluatedAt: '2026-04-19T03:26:12.987Z',
      accuracy: 0.313953,
      correct: 27,
      totalFlips: 86,
      deltaAccuracy: -0.034884,
      baseline: {
        resultPath: currentBaselinePath,
      },
      trained: {
        resultPath: currentTrainedPath,
      },
    })
    await fs.writeJson(currentBaselinePath, {results: []})
    await fs.writeJson(currentTrainedPath, {
      results: [
        {
          index: 1,
          sampleId: 'demo:flip-challenge-test-20-decoded-labeled:101',
          flipHash: 'flip-recovered',
          expected: 'left',
          predicted: 'left',
          correct: true,
        },
      ],
    })

    const sessionState = await manager.loadHumanTeacherDeveloperSessionState({
      sampleName,
    })
    const examples = await manager.loadHumanTeacherDeveloperComparisonExamples({
      sampleName,
      evaluationFlips: 100,
    })

    expect(sessionState.state.comparison100).toEqual(
      expect.objectContaining({
        benchmarkFlips: 100,
        accuracy: 0.313953,
        totalFlips: 86,
        history: expect.arrayContaining([
          expect.objectContaining({
            benchmarkFlips: 100,
            totalFlips: 86,
          }),
        ]),
      })
    )
    expect(examples).toEqual(
      expect.objectContaining({
        benchmarkFlips: 100,
        current: expect.objectContaining({
          accuracy: 0.313953,
          totalFlips: 86,
        }),
        examples: expect.arrayContaining([
          expect.objectContaining({
            flipHash: 'flip-recovered',
          }),
        ]),
      })
    )
  })

  it('falls back to the local developer training runner for the explicit 200-flip comparison', async () => {
    const sidecar = {
      getHealth: jest.fn(),
      listModels: jest.fn(),
      chat: jest.fn(),
      captionFlip: jest.fn(),
      ocrImage: jest.fn(),
      trainEpoch: jest.fn(async () => ({
        ok: false,
        status: 'not_implemented',
        lastError:
          'Local AI training request is not implemented by this Local AI sidecar',
      })),
    }
    const developerTrainingRunner = {
      runEpoch: jest.fn(async () => ({
        ok: true,
        status: 'evaluated',
        trainingBackend: 'mlx_vlm_local',
        accuracy: 0.695,
        correct: 139,
        totalFlips: 200,
        evaluatedAt: '2026-04-16T18:15:00.000Z',
        comparisonPath: '/tmp/comparison-200flips.json',
        holdoutPath: '/tmp/holdout-200',
        adapterPath: '/tmp/adapter-200.safetensors',
      })),
    }
    const manager = createLocalAiManager({
      logger: mockLogger(),
      storage,
      sidecar,
      developerTrainingRunner,
      systemTelemetryProvider: createReadySystemTelemetryProvider(),
    })

    await storage.writeJsonAtomic(
      storage.resolveLocalAiPath(
        'human-teacher-developer',
        'flip-challenge-test-20-decoded-labeled',
        'state.json'
      ),
      {
        schemaVersion: 1,
        mode: 'developer-human-teacher',
        sampleName: 'flip-challenge-test-20-decoded-labeled',
        chunkSize: 5,
        totalAvailableTasks: 20,
        currentOffset: 5,
        annotatedTaskIds: ['demo:flip-challenge-test-20-decoded-labeled:1'],
        pendingTrainingTaskIds: [],
        trainedTaskIds: ['demo:flip-challenge-test-20-decoded-labeled:1'],
        chunks: [],
        comparison100: {
          status: 'not_loaded',
          history: [],
        },
      }
    )

    const result = await manager.runHumanTeacherDeveloperComparison({
      sampleName: 'flip-challenge-test-20-decoded-labeled',
      evaluationFlips: 200,
    })

    expect(sidecar.trainEpoch).toHaveBeenCalledTimes(1)
    expect(developerTrainingRunner.runEpoch).toHaveBeenCalledTimes(1)
    expect(developerTrainingRunner.runEpoch).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          developerHumanTeacher: true,
          sampleName: 'flip-challenge-test-20-decoded-labeled',
          comparisonOnly: true,
          compareOnly: true,
          evaluationFlips: 200,
        }),
      })
    )
    expect(result).toMatchObject({
      developer: true,
      state: expect.objectContaining({
        comparison100: expect.objectContaining({
          status: 'evaluated',
          benchmarkFlips: 200,
          accuracy: 0.695,
          correct: 139,
          totalFlips: 200,
          bestAccuracy: 0.695,
        }),
      }),
    })
    expect(result.comparison).not.toHaveProperty('comparisonPath')
    expect(result.comparison).not.toHaveProperty('holdoutPath')
    expect(result.comparison).not.toHaveProperty('adapterPath')
  })

  it('keeps the selected benchmark size on a failed explicit developer comparison', async () => {
    const sidecar = {
      getHealth: jest.fn(),
      listModels: jest.fn(),
      chat: jest.fn(),
      captionFlip: jest.fn(),
      ocrImage: jest.fn(),
      trainEpoch: jest.fn(async () => ({
        ok: false,
        status: 'not_implemented',
        lastError:
          'Local AI training request is not implemented by this Local AI sidecar',
      })),
    }
    const developerTrainingRunner = {
      runEpoch: jest.fn(async () => ({
        ok: false,
        status: 'failed',
        failureReason: 'simulated compare failure',
      })),
    }
    const manager = createLocalAiManager({
      logger: mockLogger(),
      storage,
      sidecar,
      developerTrainingRunner,
      systemTelemetryProvider: createReadySystemTelemetryProvider(),
    })

    await storage.writeJsonAtomic(
      storage.resolveLocalAiPath(
        'human-teacher-developer',
        'flip-challenge-test-20-decoded-labeled',
        'state.json'
      ),
      {
        schemaVersion: 1,
        mode: 'developer-human-teacher',
        sampleName: 'flip-challenge-test-20-decoded-labeled',
        chunkSize: 5,
        totalAvailableTasks: 20,
        currentOffset: 5,
        annotatedTaskIds: ['demo:flip-challenge-test-20-decoded-labeled:1'],
        pendingTrainingTaskIds: [],
        trainedTaskIds: ['demo:flip-challenge-test-20-decoded-labeled:1'],
        chunks: [],
        comparison100: {
          status: 'not_loaded',
          history: [],
        },
      }
    )

    const result = await manager.runHumanTeacherDeveloperComparison({
      sampleName: 'flip-challenge-test-20-decoded-labeled',
      evaluationFlips: 200,
    })

    expect(result).toMatchObject({
      developer: true,
      state: expect.objectContaining({
        comparison100: expect.objectContaining({
          status: 'failed',
          benchmarkFlips: 200,
          accuracy: null,
          correct: null,
          totalFlips: null,
        }),
      }),
    })
  })

  it('rejects starting the developer flip-training session during an active validation period', async () => {
    const manager = createLocalAiManager({logger: mockLogger(), storage})

    await expect(
      manager.loadHumanTeacherDeveloperSession({
        sampleName: 'flip-challenge-test-20-decoded-labeled',
        currentPeriod: 'ShortSession',
      })
    ).rejects.toThrow(
      'Developer human-teacher session start is blocked while a validation session is running'
    )
  })

  it('rejects opening developer flip-training tasks during an active validation period', async () => {
    const manager = createLocalAiManager({logger: mockLogger(), storage})
    const session = await manager.loadHumanTeacherDeveloperSession({
      sampleName: 'flip-challenge-test-20-decoded-labeled',
    })

    await expect(
      manager.loadHumanTeacherDeveloperTask({
        sampleName: 'flip-challenge-test-20-decoded-labeled',
        taskId: session.workspace.tasks[0].taskId,
        currentPeriod: 'LongSession',
      })
    ).rejects.toThrow(
      'Developer human-teacher task open is blocked while a validation session is running'
    )
  })

  it('rejects committing a developer chunk before all 5 flips are complete', async () => {
    const manager = createLocalAiManager({logger: mockLogger(), storage})

    const session = await manager.loadHumanTeacherDeveloperSession({
      sampleName: 'flip-challenge-test-20-decoded-labeled',
    })

    await manager.saveHumanTeacherDeveloperDraft({
      sampleName: 'flip-challenge-test-20-decoded-labeled',
      offset: 0,
      taskId: session.workspace.tasks[0].taskId,
      annotation: {
        annotator: 'developer-test',
        final_answer: 'left',
        why_answer: 'only one flip is done',
        report_required: false,
        confidence: 5,
      },
    })

    await expect(
      manager.finalizeHumanTeacherDeveloperChunk({
        sampleName: 'flip-challenge-test-20-decoded-labeled',
        offset: 0,
      })
    ).rejects.toThrow(
      'Complete all 5 developer training flips before committing this chunk'
    )
  })

  it('requires explicit approval before exporting human-teacher tasks', async () => {
    const payloadPath = storage.resolveLocalAiPath(
      'modern-payloads',
      'epoch-12',
      'flip-a.json'
    )
    const filePath = storage.resolveLocalAiPath(
      'human-teacher',
      'epoch-12-tasks.json'
    )

    await storage.writeJsonAtomic(payloadPath, {
      hex: '0x00',
      privateHex: '0x00',
    })

    await storage.writeJsonAtomic(filePath, {
      schemaVersion: 1,
      packageType: 'local-ai-human-teacher-tasks',
      epoch: 12,
      reviewStatus: 'draft',
      reviewedAt: null,
      annotationReady: false,
      eligibleCount: 1,
      excludedCount: 0,
      items: [
        {
          taskId: 'flip-a::human-teacher',
          sampleId: 'flip-a::human-teacher',
          flipHash: 'flip-a',
          epoch: 12,
          finalAnswer: 'left',
          payloadPath,
          words: {},
        },
      ],
      excluded: [],
    })

    const manager = createLocalAiManager({logger: mockLogger(), storage})

    await expect(
      manager.exportHumanTeacherTasks({
        epoch: 12,
        currentEpoch: 13,
      })
    ).rejects.toThrow(
      'Human teacher package must be approved before annotation tasks can be exported'
    )
  })

  it('imports completed human-teacher annotations from the exported workspace', async () => {
    const payloadPath = storage.resolveLocalAiPath(
      'modern-payloads',
      'epoch-12',
      'flip-a.json'
    )
    const filePath = storage.resolveLocalAiPath(
      'human-teacher',
      'epoch-12-tasks.json'
    )
    const publicPayload = encode([
      [Buffer.from('panel-1'), Buffer.from('panel-2')],
      [],
    ])
    const privatePayload = encode([
      [Buffer.from('panel-3'), Buffer.from('panel-4')],
      [
        [Buffer.alloc(0), Buffer.from([1]), Buffer.from([2]), Buffer.from([3])],
        [Buffer.from([3]), Buffer.from([2]), Buffer.from([1]), Buffer.alloc(0)],
      ],
    ])

    await storage.writeJsonAtomic(payloadPath, {
      hex: `0x${Buffer.from(publicPayload).toString('hex')}`,
      privateHex: `0x${Buffer.from(privatePayload).toString('hex')}`,
    })

    await storage.writeJsonAtomic(filePath, {
      schemaVersion: 1,
      packageType: 'local-ai-human-teacher-tasks',
      epoch: 12,
      reviewStatus: 'approved',
      reviewedAt: '2026-01-01T00:00:00.000Z',
      annotationReady: true,
      eligibleCount: 1,
      excludedCount: 0,
      items: [
        {
          taskId: 'flip-a::human-teacher',
          sampleId: 'flip-a::human-teacher',
          flipHash: 'flip-a',
          epoch: 12,
          finalAnswer: 'left',
          consensusStrength: 'Strong',
          payloadPath,
          words: {},
          annotationStatus: 'pending',
        },
      ],
      excluded: [],
    })

    const manager = createLocalAiManager({logger: mockLogger(), storage})
    const exportResult = await manager.exportHumanTeacherTasks({
      epoch: 12,
      currentEpoch: 13,
    })
    const filledPath = path.join(
      exportResult.outputDir,
      'annotations.filled.jsonl'
    )

    await fs.writeFile(
      filledPath,
      `${JSON.stringify({
        task_id: 'flip-a::human-teacher',
        annotator: 'tester',
        frame_captions: ['a', 'b', 'c', 'd'],
        option_a_summary: 'left story',
        option_b_summary: 'right story',
        panel_references: [
          {
            code: 'A',
            description: 'car',
            panel_index: 0,
            x: 0.25,
            y: 0.35,
          },
        ],
        text_required: false,
        sequence_markers_present: false,
        report_required: false,
        report_reason: '',
        final_answer: 'left',
        why_answer: 'left is coherent',
        confidence: 0.9,
        ai_annotation: {
          task_id: 'flip-a::human-teacher',
          final_answer: 'right',
          why_answer: 'the AI thought the right sequence was smoother',
          confidence: 2,
          rating: 'bad',
          text_required: false,
          ordered_panel_descriptions: [
            'person enters room',
            'person picks up object',
            'person uses object',
            'person leaves room',
            'object appears first',
            'person notices object later',
            '',
            '',
          ],
          ordered_panel_text: ['', '', 'GO', '', '', '', '', ''],
          option_a_story_analysis:
            'LEFT has a stable setup then action then exit.',
          option_b_story_analysis:
            'RIGHT starts with an unexplained object state.',
        },
        ai_annotation_feedback:
          'The AI missed that the left path preserves the same actor and object across all four panels.',
      })}\n`,
      'utf8'
    )

    const importResult = await manager.importHumanTeacherAnnotations({
      epoch: 12,
      currentEpoch: 13,
    })
    const taskPackage = await storage.readHumanTeacherPackage(filePath)
    const normalizedRows = (
      await fs.readFile(
        path.join(exportResult.outputDir, 'annotations.normalized.jsonl'),
        'utf8'
      )
    )
      .trim()
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => JSON.parse(line))

    expect(importResult).toMatchObject({
      epoch: 12,
      packagePath: filePath,
      import: expect.objectContaining({
        normalizedRows: 1,
        missingAnnotations: 0,
        invalidAnnotations: 0,
      }),
    })
    expect(normalizedRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ai_annotation: expect.objectContaining({
            task_id: 'flip-a::human-teacher',
            final_answer: 'right',
            rating: 'bad',
            text_required: false,
            ordered_panel_descriptions: expect.arrayContaining([
              'person enters room',
              'person picks up object',
            ]),
            ordered_panel_text: expect.arrayContaining(['GO']),
            option_b_story_analysis: expect.stringContaining(
              'unexplained object state'
            ),
          }),
          ai_annotation_feedback: expect.stringContaining(
            'left path preserves the same actor'
          ),
          panel_references: expect.arrayContaining([
            expect.objectContaining({
              code: 'A',
              description: 'car',
              panel_index: 0,
            }),
          ]),
        }),
      ])
    )
    expect(taskPackage).toMatchObject({
      importedAnnotations: expect.objectContaining({
        normalizedRows: 1,
        missingAnnotations: 0,
      }),
      items: [
        expect.objectContaining({
          taskId: 'flip-a::human-teacher',
          annotationStatus: 'annotated',
        }),
      ],
    })
    await expect(
      storage.exists(
        path.join(exportResult.outputDir, 'annotations.normalized.jsonl')
      )
    ).resolves.toBe(true)
  })

  it('imports human-teacher annotations when optional detail fields are left blank', async () => {
    const payloadPath = storage.resolveLocalAiPath(
      'modern-payloads',
      'epoch-12',
      'flip-a.json'
    )
    const filePath = storage.resolveLocalAiPath(
      'human-teacher',
      'epoch-12-tasks.json'
    )
    const publicPayload = encode([
      [Buffer.from('panel-1'), Buffer.from('panel-2')],
      [],
    ])
    const privatePayload = encode([
      [Buffer.from('panel-3'), Buffer.from('panel-4')],
      [
        [Buffer.alloc(0), Buffer.from([1]), Buffer.from([2]), Buffer.from([3])],
        [Buffer.from([3]), Buffer.from([2]), Buffer.from([1]), Buffer.alloc(0)],
      ],
    ])

    await storage.writeJsonAtomic(payloadPath, {
      hex: `0x${Buffer.from(publicPayload).toString('hex')}`,
      privateHex: `0x${Buffer.from(privatePayload).toString('hex')}`,
    })

    await storage.writeJsonAtomic(filePath, {
      schemaVersion: 1,
      packageType: 'local-ai-human-teacher-tasks',
      epoch: 12,
      reviewStatus: 'approved',
      reviewedAt: '2026-01-01T00:00:00.000Z',
      annotationReady: true,
      eligibleCount: 1,
      excludedCount: 0,
      items: [
        {
          taskId: 'flip-a::human-teacher',
          sampleId: 'flip-a::human-teacher',
          flipHash: 'flip-a',
          epoch: 12,
          finalAnswer: 'left',
          consensusStrength: 'Strong',
          payloadPath,
          words: {},
          annotationStatus: 'pending',
        },
      ],
      excluded: [],
    })

    const manager = createLocalAiManager({logger: mockLogger(), storage})
    const exportResult = await manager.exportHumanTeacherTasks({
      epoch: 12,
      currentEpoch: 13,
    })

    await fs.writeFile(
      path.join(exportResult.outputDir, 'annotations.filled.jsonl'),
      `${JSON.stringify({
        task_id: 'flip-a::human-teacher',
        sample_id: 'flip-a::human-teacher',
        flip_hash: 'flip-a',
        epoch: 12,
        annotator: 'tester',
        text_required: false,
        sequence_markers_present: false,
        report_required: false,
        report_reason: '',
        final_answer: 'left',
        why_answer: 'left keeps the same actor and chronology across panels.',
        confidence: 0.8,
      })}\n`,
      'utf8'
    )

    const importResult = await manager.importHumanTeacherAnnotations({
      epoch: 12,
      currentEpoch: 13,
    })
    const normalizedRows = (
      await fs.readFile(
        path.join(exportResult.outputDir, 'annotations.normalized.jsonl'),
        'utf8'
      )
    )
      .trim()
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => JSON.parse(line))

    expect(importResult).toMatchObject({
      import: expect.objectContaining({
        normalizedRows: 1,
        missingAnnotations: 0,
        invalidAnnotations: 0,
      }),
    })
    expect(normalizedRows).toEqual([
      expect.objectContaining({
        frame_captions: ['', '', '', ''],
        option_a_summary: '',
        option_b_summary: '',
        final_answer: 'left',
        why_answer: expect.stringContaining('chronology'),
      }),
    ])
  })

  it('rejects importing a tampered human-teacher task manifest', async () => {
    const payloadPath = storage.resolveLocalAiPath(
      'modern-payloads',
      'epoch-12',
      'flip-a.json'
    )
    const filePath = storage.resolveLocalAiPath(
      'human-teacher',
      'epoch-12-tasks.json'
    )
    const publicPayload = encode([
      [Buffer.from('panel-1'), Buffer.from('panel-2')],
      [],
    ])
    const privatePayload = encode([
      [Buffer.from('panel-3'), Buffer.from('panel-4')],
      [
        [Buffer.alloc(0), Buffer.from([1]), Buffer.from([2]), Buffer.from([3])],
        [Buffer.from([3]), Buffer.from([2]), Buffer.from([1]), Buffer.alloc(0)],
      ],
    ])

    await storage.writeJsonAtomic(payloadPath, {
      hex: `0x${Buffer.from(publicPayload).toString('hex')}`,
      privateHex: `0x${Buffer.from(privatePayload).toString('hex')}`,
    })

    await storage.writeJsonAtomic(filePath, {
      schemaVersion: 1,
      packageType: 'local-ai-human-teacher-tasks',
      epoch: 12,
      reviewStatus: 'approved',
      reviewedAt: '2026-01-01T00:00:00.000Z',
      annotationReady: true,
      eligibleCount: 1,
      excludedCount: 0,
      items: [
        {
          taskId: 'flip-a::human-teacher',
          sampleId: 'flip-a::human-teacher',
          flipHash: 'flip-a',
          epoch: 12,
          finalAnswer: 'left',
          consensusStrength: 'Strong',
          payloadPath,
          words: {},
          annotationStatus: 'pending',
        },
      ],
      excluded: [],
    })

    const manager = createLocalAiManager({logger: mockLogger(), storage})
    const exportResult = await manager.exportHumanTeacherTasks({
      epoch: 12,
      currentEpoch: 13,
    })

    await fs.writeFile(
      path.join(exportResult.outputDir, 'tasks.jsonl'),
      `${JSON.stringify({
        task_id: 'flip-a::human-teacher',
        sample_id: 'flip-a::human-teacher',
        flip_hash: 'flip-a',
        epoch: 12,
        final_answer: 'right',
        panels: [],
      })}\n`,
      'utf8'
    )

    await expect(
      manager.loadHumanTeacherAnnotationWorkspace({
        epoch: 12,
        currentEpoch: 13,
      })
    ).rejects.toThrow(
      'Human teacher task manifest was modified; export annotation tasks again'
    )

    await expect(
      manager.importHumanTeacherAnnotations({
        epoch: 12,
        currentEpoch: 13,
      })
    ).rejects.toThrow(
      'Human teacher task manifest was modified; export annotation tasks again'
    )
  })

  it('keeps duplicate or metadata-mismatched human-teacher rows out of the normalized import', async () => {
    const payloadPath = storage.resolveLocalAiPath(
      'modern-payloads',
      'epoch-12',
      'flip-a.json'
    )
    const filePath = storage.resolveLocalAiPath(
      'human-teacher',
      'epoch-12-tasks.json'
    )
    const publicPayload = encode([
      [Buffer.from('panel-1'), Buffer.from('panel-2')],
      [],
    ])
    const privatePayload = encode([
      [Buffer.from('panel-3'), Buffer.from('panel-4')],
      [
        [Buffer.alloc(0), Buffer.from([1]), Buffer.from([2]), Buffer.from([3])],
        [Buffer.from([3]), Buffer.from([2]), Buffer.from([1]), Buffer.alloc(0)],
      ],
    ])

    await storage.writeJsonAtomic(payloadPath, {
      hex: `0x${Buffer.from(publicPayload).toString('hex')}`,
      privateHex: `0x${Buffer.from(privatePayload).toString('hex')}`,
    })

    await storage.writeJsonAtomic(filePath, {
      schemaVersion: 1,
      packageType: 'local-ai-human-teacher-tasks',
      epoch: 12,
      reviewStatus: 'approved',
      reviewedAt: '2026-01-01T00:00:00.000Z',
      annotationReady: true,
      eligibleCount: 1,
      excludedCount: 0,
      items: [
        {
          taskId: 'flip-a::human-teacher',
          sampleId: 'flip-a::human-teacher',
          flipHash: 'flip-a',
          epoch: 12,
          finalAnswer: 'left',
          consensusStrength: 'Strong',
          payloadPath,
          words: {},
          annotationStatus: 'pending',
        },
      ],
      excluded: [],
    })

    const manager = createLocalAiManager({logger: mockLogger(), storage})
    const exportResult = await manager.exportHumanTeacherTasks({
      epoch: 12,
      currentEpoch: 13,
    })

    await fs.writeFile(
      path.join(exportResult.outputDir, 'annotations.filled.jsonl'),
      `${[
        JSON.stringify({
          task_id: 'flip-a::human-teacher',
          sample_id: 'flip-a::human-teacher',
          flip_hash: 'flip-wrong',
          epoch: 12,
          annotator: 'tester',
          frame_captions: ['a', 'b', 'c', 'd'],
          option_a_summary: 'left story',
          option_b_summary: 'right story',
          text_required: false,
          sequence_markers_present: false,
          report_required: false,
          final_answer: 'left',
          why_answer: 'left is coherent',
          confidence: 0.9,
        }),
        JSON.stringify({
          task_id: 'flip-a::human-teacher',
          sample_id: 'flip-a::human-teacher',
          flip_hash: 'flip-a',
          epoch: 12,
          annotator: 'tester',
          frame_captions: ['a', 'b', 'c', 'd'],
          option_a_summary: 'left story',
          option_b_summary: 'right story',
          text_required: false,
          sequence_markers_present: false,
          report_required: false,
          final_answer: 'left',
          why_answer: 'left is coherent',
          confidence: 0.9,
        }),
      ].join('\n')}\n`,
      'utf8'
    )

    const importResult = await manager.importHumanTeacherAnnotations({
      epoch: 12,
      currentEpoch: 13,
    })

    expect(importResult).toMatchObject({
      import: expect.objectContaining({
        normalizedRows: 0,
        invalidAnnotations: 0,
        duplicateAnnotations: 2,
        missingAnnotations: 1,
      }),
    })
    await expect(storage.readHumanTeacherPackage(filePath)).resolves.toEqual(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            taskId: 'flip-a::human-teacher',
            annotationStatus: 'pending',
          }),
        ],
      })
    )
  })

  it('rejects human-teacher import paths outside the managed workspace', async () => {
    const payloadPath = storage.resolveLocalAiPath(
      'modern-payloads',
      'epoch-12',
      'flip-a.json'
    )
    const filePath = storage.resolveLocalAiPath(
      'human-teacher',
      'epoch-12-tasks.json'
    )
    const publicPayload = encode([
      [Buffer.from('panel-1'), Buffer.from('panel-2')],
      [],
    ])
    const privatePayload = encode([
      [Buffer.from('panel-3'), Buffer.from('panel-4')],
      [
        [Buffer.alloc(0), Buffer.from([1]), Buffer.from([2]), Buffer.from([3])],
        [Buffer.from([3]), Buffer.from([2]), Buffer.from([1]), Buffer.alloc(0)],
      ],
    ])

    await storage.writeJsonAtomic(payloadPath, {
      hex: `0x${Buffer.from(publicPayload).toString('hex')}`,
      privateHex: `0x${Buffer.from(privatePayload).toString('hex')}`,
    })

    await storage.writeJsonAtomic(filePath, {
      schemaVersion: 1,
      packageType: 'local-ai-human-teacher-tasks',
      epoch: 12,
      reviewStatus: 'approved',
      reviewedAt: '2026-01-01T00:00:00.000Z',
      annotationReady: true,
      eligibleCount: 1,
      excludedCount: 0,
      items: [
        {
          taskId: 'flip-a::human-teacher',
          sampleId: 'flip-a::human-teacher',
          flipHash: 'flip-a',
          epoch: 12,
          finalAnswer: 'left',
          consensusStrength: 'Strong',
          payloadPath,
          words: {},
          annotationStatus: 'pending',
        },
      ],
      excluded: [],
    })

    const manager = createLocalAiManager({logger: mockLogger(), storage})
    const exportResult = await manager.exportHumanTeacherTasks({
      epoch: 12,
      currentEpoch: 13,
    })

    await fs.writeFile(
      path.join(exportResult.outputDir, 'annotations.filled.jsonl'),
      `${JSON.stringify({
        task_id: 'flip-a::human-teacher',
        annotator: 'tester',
        frame_captions: ['a', 'b', 'c', 'd'],
        option_a_summary: 'left story',
        option_b_summary: 'right story',
        final_answer: 'left',
        why_answer: 'left is coherent',
        confidence: 5,
      })}\n`,
      'utf8'
    )

    await expect(
      manager.importHumanTeacherAnnotations({
        epoch: 12,
        currentEpoch: 13,
        annotationsPath: '/tmp/not-allowed.jsonl',
      })
    ).rejects.toThrow('Invalid human-teacher workspace path')

    await expect(
      manager.importHumanTeacherAnnotations({
        epoch: 12,
        currentEpoch: 13,
        outputJsonlPath: '/tmp/not-allowed-normalized.jsonl',
      })
    ).rejects.toThrow('Invalid human-teacher workspace path')

    await expect(
      manager.importHumanTeacherAnnotations({
        epoch: 12,
        currentEpoch: 13,
        summaryPath: '/tmp/not-allowed-summary.json',
      })
    ).rejects.toThrow('Invalid human-teacher workspace path')
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
      getHealth: jest.fn(async () => ({
        ok: true,
        reachable: true,
        runtimeBackend: 'ollama-direct',
        runtimeType: 'ollama',
        lastError: null,
      })),
      listModels: jest.fn(async () => ({
        ok: true,
        models: ['qwen3.5:9b'],
        total: 1,
        lastError: null,
      })),
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

  it('starts the managed Ollama runtime when the configured backend is unavailable', async () => {
    const sidecar = {
      getHealth: jest
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 'error',
          reachable: false,
          runtime: 'ollama',
          runtimeBackend: 'ollama-direct',
          runtimeType: 'ollama',
          baseUrl: 'http://127.0.0.1:11434',
          endpoint: 'http://127.0.0.1:11434/api/version',
          lastError: 'connect ECONNREFUSED 127.0.0.1:11434',
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 'ok',
          reachable: true,
          runtime: 'ollama',
          runtimeBackend: 'ollama-direct',
          runtimeType: 'ollama',
          baseUrl: 'http://127.0.0.1:11434',
          endpoint: 'http://127.0.0.1:11434/api/version',
          data: {version: '0.7.0'},
          lastError: null,
        }),
      listModels: jest.fn(async () => ({
        ok: true,
        reachable: true,
        runtimeBackend: 'ollama-direct',
        runtimeType: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
        endpoint: 'http://127.0.0.1:11434/api/tags',
        models: ['llama3.1:8b'],
        total: 1,
        lastError: null,
      })),
      chat: jest.fn(),
      flipToText: jest.fn(),
      checkFlipSequence: jest.fn(),
      captionFlip: jest.fn(),
      ocrImage: jest.fn(),
      trainEpoch: jest.fn(),
    }
    const runtimeController = {
      start: jest.fn(async () => ({
        started: true,
        managed: true,
        pid: 4242,
      })),
      stop: jest.fn(async () => ({
        stopped: true,
        managed: true,
        pid: 4242,
      })),
    }
    const manager = createLocalAiManager({
      logger: mockLogger(),
      storage,
      sidecar,
      runtimeController,
    })

    await expect(
      manager.start({
        runtimeBackend: 'ollama-direct',
        runtimeType: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
      })
    ).resolves.toMatchObject({
      ok: true,
      runtimeBackend: 'ollama-direct',
      runtimeType: 'ollama',
      baseUrl: 'http://127.0.0.1:11434',
      sidecarReachable: true,
      sidecarModelCount: 1,
      runtimeManaged: true,
    })

    expect(runtimeController.start).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeBackend: 'ollama-direct',
        runtimeType: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
      })
    )
  })

  it('does not start the managed Ollama runtime when the configured endpoint is invalid', async () => {
    const sidecar = {
      getHealth: jest.fn(async () => ({
        ok: false,
        status: 'config_error',
        reachable: false,
        runtime: 'ollama',
        runtimeBackend: 'ollama-direct',
        runtimeType: 'ollama',
        baseUrl: 'http://0.0.0.0:11434',
        endpoint: null,
        error: 'loopback_only',
        lastError:
          'Local AI endpoint must stay on this machine (localhost, 127.0.0.1, or ::1).',
      })),
      listModels: jest.fn(),
      chat: jest.fn(),
      flipToText: jest.fn(),
      checkFlipSequence: jest.fn(),
      captionFlip: jest.fn(),
      ocrImage: jest.fn(),
      trainEpoch: jest.fn(),
    }
    const runtimeController = {
      start: jest.fn(async () => ({
        started: true,
        managed: true,
        pid: 4242,
      })),
      stop: jest.fn(async () => ({
        stopped: true,
        managed: true,
        pid: 4242,
      })),
    }
    const manager = createLocalAiManager({
      logger: mockLogger(),
      storage,
      sidecar,
      runtimeController,
    })

    await expect(
      manager.start({
        runtimeBackend: 'ollama-direct',
        runtimeType: 'ollama',
        baseUrl: 'http://0.0.0.0:11434',
      })
    ).resolves.toMatchObject({
      ok: false,
      status: 'config_error',
      error: 'loopback_only',
      lastError:
        'Local AI endpoint must stay on this machine (localhost, 127.0.0.1, or ::1).',
      running: false,
      runtimeManaged: false,
      sidecarReachable: false,
      sidecarModelCount: 0,
      baseUrl: 'http://0.0.0.0:11434',
    })

    expect(runtimeController.start).not.toHaveBeenCalled()
  })

  it('clears the running flag when the managed Ollama runtime fails to start', async () => {
    const sidecar = {
      getHealth: jest.fn(async () => ({
        ok: false,
        status: 'down',
        reachable: false,
        runtime: 'ollama',
        runtimeBackend: 'ollama-direct',
        runtimeType: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
        endpoint: 'http://127.0.0.1:11434',
        error: 'runtime_unavailable',
        lastError: 'Local AI runtime is not responding.',
      })),
      listModels: jest.fn(),
      chat: jest.fn(),
      flipToText: jest.fn(),
      checkFlipSequence: jest.fn(),
      captionFlip: jest.fn(),
      ocrImage: jest.fn(),
      trainEpoch: jest.fn(),
    }
    const runtimeController = {
      start: jest.fn(async () => {
        throw new Error('spawn failed')
      }),
      stop: jest.fn(async () => ({
        stopped: true,
        managed: true,
        pid: 4242,
      })),
    }
    const manager = createLocalAiManager({
      logger: mockLogger(),
      storage,
      sidecar,
      runtimeController,
    })

    await expect(
      manager.start({
        runtimeBackend: 'ollama-direct',
        runtimeType: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
      })
    ).resolves.toMatchObject({
      ok: false,
      status: 'error',
      error: 'runtime_start_failed',
      lastError: 'spawn failed',
      running: false,
      runtimeManaged: false,
      sidecarReachable: false,
      sidecarModelCount: 0,
      baseUrl: 'http://127.0.0.1:11434',
    })

    expect(runtimeController.start).toHaveBeenCalledTimes(1)
  })

  it('derives the legacy runtime type from runtimeBackend for Local AI flip text requests', async () => {
    const sidecar = {
      getHealth: jest.fn(async () => ({
        ok: true,
        reachable: true,
        runtimeBackend: 'ollama-direct',
        runtimeType: 'ollama',
        lastError: null,
      })),
      listModels: jest.fn(async () => ({
        ok: true,
        models: ['qwen3.5:9b'],
        total: 1,
        lastError: null,
      })),
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

  it('auto-starts the Ollama runtime before local chat when the runtime is down', async () => {
    const sidecar = {
      getHealth: jest
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          reachable: false,
          runtimeBackend: 'ollama-direct',
          runtimeType: 'ollama',
          lastError: 'connect ECONNREFUSED 127.0.0.1:11434',
        })
        .mockResolvedValueOnce({
          ok: false,
          reachable: false,
          runtimeBackend: 'ollama-direct',
          runtimeType: 'ollama',
          lastError: 'connect ECONNREFUSED 127.0.0.1:11434',
        })
        .mockResolvedValueOnce({
          ok: true,
          reachable: true,
          runtimeBackend: 'ollama-direct',
          runtimeType: 'ollama',
          lastError: null,
        }),
      listModels: jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          models: ['qwen3.5:9b'],
          total: 1,
          lastError: null,
        })
        .mockResolvedValueOnce({
          ok: true,
          models: ['qwen3.5:9b'],
          total: 1,
          lastError: null,
        }),
      chat: jest.fn(async () => ({
        ok: true,
        text: 'Local chat is alive.',
        lastError: null,
      })),
      flipToText: jest.fn(),
      checkFlipSequence: jest.fn(),
      captionFlip: jest.fn(),
      ocrImage: jest.fn(),
      trainEpoch: jest.fn(),
    }
    const runtimeController = {
      start: jest.fn(async () => ({
        started: true,
        managed: true,
        pid: 4242,
      })),
      stop: jest.fn(),
    }
    const manager = createLocalAiManager({
      logger: mockLogger(),
      storage,
      sidecar,
      runtimeController,
    })

    await expect(
      manager.chat({
        runtimeBackend: 'ollama-direct',
        model: 'qwen3.5:9b',
        prompt: 'hello',
      })
    ).resolves.toMatchObject({
      ok: true,
      text: 'Local chat is alive.',
      runtimeBackend: 'ollama-direct',
      runtimeType: 'ollama',
      sidecarReachable: true,
    })

    expect(runtimeController.start).toHaveBeenCalledTimes(1)
    expect(sidecar.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeBackend: 'ollama-direct',
        runtimeType: 'ollama',
        model: 'qwen3.5:9b',
      })
    )
  })

  it('auto-starts the Ollama runtime before model listing when the runtime is down', async () => {
    const sidecar = {
      getHealth: jest
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          reachable: false,
          runtimeBackend: 'ollama-direct',
          runtimeType: 'ollama',
          lastError: 'connect ECONNREFUSED 127.0.0.1:11434',
        })
        .mockResolvedValueOnce({
          ok: false,
          reachable: false,
          runtimeBackend: 'ollama-direct',
          runtimeType: 'ollama',
          lastError: 'connect ECONNREFUSED 127.0.0.1:11434',
        })
        .mockResolvedValueOnce({
          ok: true,
          reachable: true,
          runtimeBackend: 'ollama-direct',
          runtimeType: 'ollama',
          lastError: null,
        }),
      listModels: jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          models: ['qwen3.5:9b'],
          total: 1,
          lastError: null,
        })
        .mockResolvedValueOnce({
          ok: true,
          models: ['qwen3.5:9b'],
          total: 1,
          lastError: null,
        })
        .mockResolvedValueOnce({
          ok: true,
          models: ['qwen3.5:9b'],
          total: 1,
          lastError: null,
        }),
      chat: jest.fn(),
      flipToText: jest.fn(),
      checkFlipSequence: jest.fn(),
      captionFlip: jest.fn(),
      ocrImage: jest.fn(),
      trainEpoch: jest.fn(),
    }
    const runtimeController = {
      start: jest.fn(async () => ({
        started: true,
        managed: true,
        pid: 4242,
      })),
      stop: jest.fn(),
    }
    const manager = createLocalAiManager({
      logger: mockLogger(),
      storage,
      sidecar,
      runtimeController,
    })

    await expect(
      manager.listModels({
        runtimeBackend: 'ollama-direct',
      })
    ).resolves.toMatchObject({
      ok: true,
      models: ['qwen3.5:9b'],
      runtimeBackend: 'ollama-direct',
      runtimeType: 'ollama',
      sidecarReachable: true,
    })

    expect(runtimeController.start).toHaveBeenCalledTimes(1)
  })

  it('does not auto-start the Ollama runtime for passive model listing checks', async () => {
    const sidecar = {
      getHealth: jest.fn(async () => ({
        ok: false,
        reachable: false,
        runtimeBackend: 'ollama-direct',
        runtimeType: 'ollama',
        lastError: 'connect ECONNREFUSED 127.0.0.1:11434',
      })),
      listModels: jest.fn(),
      chat: jest.fn(),
      flipToText: jest.fn(),
      checkFlipSequence: jest.fn(),
      captionFlip: jest.fn(),
      ocrImage: jest.fn(),
      trainEpoch: jest.fn(),
    }
    const runtimeController = {
      start: jest.fn(async () => ({
        started: true,
        managed: true,
        pid: 4242,
      })),
      stop: jest.fn(),
    }
    const manager = createLocalAiManager({
      logger: mockLogger(),
      storage,
      sidecar,
      runtimeController,
    })

    await expect(
      manager.listModels({
        runtimeBackend: 'ollama-direct',
        allowRuntimeStart: false,
      })
    ).resolves.toMatchObject({
      ok: false,
      error: 'runtime_unavailable',
      lastError: 'connect ECONNREFUSED 127.0.0.1:11434',
      runtimeBackend: 'ollama-direct',
      runtimeType: 'ollama',
      sidecarReachable: false,
    })

    expect(runtimeController.start).not.toHaveBeenCalled()
    expect(sidecar.listModels).not.toHaveBeenCalled()
  })

  it('routes checkFlipSequence through the Local AI sidecar with runtime config', async () => {
    const sidecar = {
      getHealth: jest.fn(async () => ({
        ok: true,
        reachable: true,
        runtimeBackend: 'ollama-direct',
        runtimeType: 'ollama',
        lastError: null,
      })),
      listModels: jest.fn(async () => ({
        ok: true,
        models: ['qwen3.5:9b'],
        total: 1,
        lastError: null,
      })),
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
