const os = require('os')
const path = require('path')
const fs = require('fs-extra')
const {encode} = require('rlp')

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
        final_answer: 'left',
        why_answer: 'left is coherent',
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
        final_answer: 'right',
        why_answer: 'testing the offline annotator path',
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
        }
      }),
    }
    const manager = createLocalAiManager({
      logger: mockLogger(),
      storage,
      sidecar,
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
        annotation: {
          annotator: 'developer-test',
          final_answer: 'left',
          why_answer: `human reason for ${task.taskId}`,
          report_required: false,
        },
      })
    }

    const committed = await manager.finalizeHumanTeacherDeveloperChunk({
      sampleName: 'flip-challenge-test-20-decoded-labeled',
      offset: 0,
      trainNow: true,
      advance: true,
    })

    expect(sidecar.trainEpoch).toHaveBeenCalledTimes(1)
    expect(sidecar.trainEpoch).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          developerHumanTeacher: true,
          sampleName: 'flip-challenge-test-20-decoded-labeled',
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
  })

  it('runs the explicit 100-flip developer comparison and stores the updated success history', async () => {
    const sidecar = {
      getHealth: jest.fn(),
      listModels: jest.fn(),
      chat: jest.fn(),
      captionFlip: jest.fn(),
      ocrImage: jest.fn(),
      trainEpoch: jest.fn(async ({input}) => {
        await fs.writeJson(input.comparisonPath, {
          totalFlips: 100,
          correct: 67,
          accuracy: 0.67,
          evaluatedAt: '2026-04-16T17:10:00.000Z',
        })

        return {
          ok: true,
          status: 'evaluated',
        }
      }),
    }
    const manager = createLocalAiManager({
      logger: mockLogger(),
      storage,
      sidecar,
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
    })

    expect(sidecar.trainEpoch).toHaveBeenCalledTimes(1)
    expect(sidecar.trainEpoch).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          developerHumanTeacher: true,
          sampleName: 'flip-challenge-test-20-decoded-labeled',
          comparisonOnly: true,
          compareOnly: true,
          evaluationFlips: 100,
          comparisonPath: expect.stringContaining('comparison-100flips.json'),
        }),
      })
    )
    expect(result).toMatchObject({
      developer: true,
      state: expect.objectContaining({
        comparison100: expect.objectContaining({
          status: 'evaluated',
          accuracy: 0.67,
          correct: 67,
          totalFlips: 100,
          bestAccuracy: 0.67,
          history: [
            expect.objectContaining({
              accuracy: 0.67,
              correct: 67,
              totalFlips: 100,
            }),
          ],
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
        text_required: false,
        sequence_markers_present: false,
        report_required: false,
        report_reason: '',
        final_answer: 'left',
        why_answer: 'left is coherent',
        confidence: 0.9,
      })}\n`,
      'utf8'
    )

    const importResult = await manager.importHumanTeacherAnnotations({
      epoch: 12,
      currentEpoch: 13,
    })
    const taskPackage = await storage.readHumanTeacherPackage(filePath)

    expect(importResult).toMatchObject({
      epoch: 12,
      packagePath: filePath,
      import: expect.objectContaining({
        normalizedRows: 1,
        missingAnnotations: 0,
        invalidAnnotations: 0,
      }),
    })
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
