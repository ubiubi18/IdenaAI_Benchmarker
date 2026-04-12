const os = require('os')
const path = require('path')
const fs = require('fs-extra')

const {createLocalAiStorage} = require('./storage')
const {
  DEFAULT_BASE_MODEL_ID,
  PLACEHOLDER_IDENTITY,
  PLACEHOLDER_SIGNATURE_REASON,
  createLocalAiFederated,
} = require('./federated')

function mockLogger() {
  return {
    debug: jest.fn(),
    error: jest.fn(),
  }
}

function createPlaceholderBundle(storage, overrides = {}) {
  const payload = {
    epoch: 7,
    identity: PLACEHOLDER_IDENTITY,
    baseModelId: DEFAULT_BASE_MODEL_ID,
    baseModelHash: storage.sha256(DEFAULT_BASE_MODEL_ID),
    nonce: 'bundle-nonce-7',
    eligibleFlipHashes: ['flip-a', 'flip-b'],
    manifest: {
      file: 'epoch-7-manifest.json',
      sha256: storage.sha256('epoch-7-manifest'),
    },
    deltaType: 'none',
    metrics: {
      eligibleCount: 2,
      excludedCount: 1,
    },
    generatedAt: '2026-04-11T00:00:00.000Z',
    ...overrides,
  }

  return {
    version: 1,
    bundleType: 'local-ai-update',
    payload,
    signature: {
      value: storage.sha256(JSON.stringify(payload)),
      type: 'placeholder_sha256',
      signed: false,
      reason: PLACEHOLDER_SIGNATURE_REASON,
    },
  }
}

function createReceivedEntry({
  storage,
  bundle,
  bundleId,
  storedPath,
  epoch = 7,
  identity = PLACEHOLDER_IDENTITY,
}) {
  return {
    bundleId,
    nonce: bundle.payload.nonce,
    storedPath,
    importedAt: '2026-04-11T00:00:00.000Z',
    identity,
    epoch,
    baseModelId: bundle.payload.baseModelId,
    baseModelHash: bundle.payload.baseModelHash,
    signatureType: bundle.signature.type,
    signed: bundle.signature.signed,
  }
}

describe('local-ai federated bundle helper', () => {
  let tempDir
  let storage

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'idena-local-ai-bundle-'))
    storage = createLocalAiStorage({
      baseDir: path.join(tempDir, 'local-ai'),
    })
  })

  afterEach(async () => {
    await fs.remove(tempDir)
  })

  async function writeManifest(epoch = 7) {
    const manifestFilePath = storage.resolveLocalAiPath(
      'manifests',
      `epoch-${epoch}-manifest.json`
    )

    await storage.writeJsonAtomic(manifestFilePath, {
      epoch,
      baseModelId: DEFAULT_BASE_MODEL_ID,
      eligibleFlipHashes: ['flip-a', 'flip-b'],
      excluded: [{flipHash: 'flip-c', reasons: ['missing_consensus']}],
      generatedAt: '2026-04-11T00:00:00.000Z',
    })

    return manifestFilePath
  }

  it('fails clearly when the manifest is missing', async () => {
    const federated = createLocalAiFederated({
      logger: mockLogger(),
      storage,
    })

    await expect(federated.buildUpdateBundle(5)).rejects.toThrow(
      'Local AI manifest for epoch 5 does not exist'
    )
  })

  it('builds a metadata-only bundle with an honest placeholder signature', async () => {
    await writeManifest(7)

    const federated = createLocalAiFederated({
      logger: mockLogger(),
      storage,
    })

    const summary = await federated.buildUpdateBundle(7)
    const bundle = await storage.readJson(summary.bundlePath)

    expect(summary).toMatchObject({
      epoch: 7,
      identity: PLACEHOLDER_IDENTITY,
      signed: false,
      deltaType: 'none',
      eligibleCount: 2,
    })
    expect(bundle.payload).toMatchObject({
      epoch: 7,
      identity: PLACEHOLDER_IDENTITY,
      baseModelId: DEFAULT_BASE_MODEL_ID,
      baseModelHash: storage.sha256(DEFAULT_BASE_MODEL_ID),
      eligibleFlipHashes: ['flip-a', 'flip-b'],
      deltaType: 'none',
      metrics: {
        eligibleCount: 2,
        excludedCount: 1,
      },
    })
    expect(bundle.payload.nonce).toMatch(/^[a-f0-9]{32}$/)
    expect(bundle.signature).toMatchObject({
      type: 'placeholder_sha256',
      signed: false,
      reason: PLACEHOLDER_SIGNATURE_REASON,
    })
    expect(JSON.stringify(bundle)).not.toContain('"images"')
  })

  it('imports a valid placeholder bundle and stores a replay index entry', async () => {
    await writeManifest(7)

    const federated = createLocalAiFederated({
      logger: mockLogger(),
      storage,
    })
    const built = await federated.buildUpdateBundle(7)
    const imported = await federated.importUpdateBundle(built.bundlePath)
    const index = await storage.readJson(storage.resolveLocalAiPath('received', 'index.json'))
    const storedBundle = await storage.readJson(imported.storedPath)

    expect(imported).toMatchObject({
      accepted: true,
      reason: null,
      identity: PLACEHOLDER_IDENTITY,
      epoch: 7,
      bundlePath: built.bundlePath,
      acceptedCount: 1,
      rejectedCount: 0,
      signed: false,
      signatureType: 'placeholder_sha256',
    })
    expect(index.bundles).toHaveLength(1)
    expect(index.bundles[0]).toMatchObject({
      epoch: 7,
      identity: PLACEHOLDER_IDENTITY,
      nonce: storedBundle.payload.nonce,
      signatureType: 'placeholder_sha256',
      signed: false,
    })
    expect(JSON.stringify(storedBundle)).not.toContain('"images"')
  })

  it('rejects duplicate nonces', async () => {
    await writeManifest(7)

    const federated = createLocalAiFederated({
      logger: mockLogger(),
      storage,
    })
    const built = await federated.buildUpdateBundle(7)

    await federated.importUpdateBundle(built.bundlePath)

    await expect(federated.importUpdateBundle(built.bundlePath)).resolves.toMatchObject({
      accepted: false,
      reason: 'duplicate_nonce',
      identity: PLACEHOLDER_IDENTITY,
      epoch: 7,
      acceptedCount: 0,
      rejectedCount: 1,
    })
  })

  it('rejects base-model mismatches', async () => {
    const bundleFilePath = storage.resolveLocalAiPath('incoming', 'mismatch.json')
    const bundle = createPlaceholderBundle(storage, {
      baseModelId: 'local-ai:other:mvp-placeholder-v1',
      baseModelHash: storage.sha256('local-ai:other:mvp-placeholder-v1'),
      nonce: 'bundle-nonce-mismatch',
    })

    bundle.signature.value = storage.sha256(JSON.stringify(bundle.payload))

    await storage.writeJsonAtomic(bundleFilePath, bundle)

    const federated = createLocalAiFederated({
      logger: mockLogger(),
      storage,
    })

    await expect(federated.importUpdateBundle(bundleFilePath)).resolves.toMatchObject({
      accepted: false,
      reason: 'base_model_mismatch',
      identity: PLACEHOLDER_IDENTITY,
      epoch: 7,
      acceptedCount: 0,
      rejectedCount: 1,
    })
  })

  it('rejects malformed bundles with schema_invalid', async () => {
    const bundleFilePath = storage.resolveLocalAiPath('incoming', 'invalid.json')

    await storage.writeJsonAtomic(bundleFilePath, {
      version: 1,
      bundleType: 'local-ai-update',
      payload: {
        epoch: 7,
      },
    })

    const federated = createLocalAiFederated({
      logger: mockLogger(),
      storage,
    })

    await expect(federated.importUpdateBundle(bundleFilePath)).resolves.toMatchObject({
      accepted: false,
      reason: 'schema_invalid',
      identity: null,
      epoch: null,
      acceptedCount: 0,
      rejectedCount: 1,
    })
  })

  it('fails safely when a bundle cannot be parsed from disk', async () => {
    const logger = mockLogger()
    const bundleFilePath = storage.resolveLocalAiPath('incoming', 'broken.json')

    await fs.ensureDir(path.dirname(bundleFilePath))
    await fs.writeFile(bundleFilePath, '{"version": 1,', 'utf8')

    const federated = createLocalAiFederated({
      logger,
      isDev: true,
      storage,
    })

    await expect(federated.importUpdateBundle(bundleFilePath)).resolves.toMatchObject({
      accepted: false,
      reason: 'schema_invalid',
      bundlePath: bundleFilePath,
      acceptedCount: 0,
      rejectedCount: 1,
    })
    expect(logger.error).toHaveBeenCalledWith(
      'Unable to load Local AI update bundle',
      expect.objectContaining({
        fileName: 'broken.json',
      })
    )
  })

  it('fails safely when accepted bundle storage update throws unexpectedly', async () => {
    await writeManifest(7)

    const logger = mockLogger()
    const failingStorage = {
      ...storage,
      writeJsonAtomic: jest.fn(async (filePath, obj) => {
        if (String(filePath).endsWith(`${path.sep}received${path.sep}index.json`)) {
          throw new Error('disk full')
        }

        return storage.writeJsonAtomic(filePath, obj)
      }),
    }
    const federated = createLocalAiFederated({
      logger,
      isDev: true,
      storage: failingStorage,
    })
    const built = await federated.buildUpdateBundle(7)

    await expect(federated.importUpdateBundle(built.bundlePath)).resolves.toMatchObject({
      accepted: false,
      reason: 'import_failed',
      identity: PLACEHOLDER_IDENTITY,
      epoch: 7,
      bundlePath: built.bundlePath,
      acceptedCount: 0,
      rejectedCount: 1,
    })
    expect(logger.error).toHaveBeenCalledWith(
      'Local AI update bundle import failed',
      expect.objectContaining({
        fileName: path.basename(built.bundlePath),
      })
    )
  })

  it('treats real-signature bundles as unverifiable until a verifier exists', async () => {
    const bundleFilePath = storage.resolveLocalAiPath(
      'incoming',
      'unverifiable-signature.json'
    )
    const bundle = createPlaceholderBundle(storage, {
      identity: '0x1234',
      nonce: 'bundle-nonce-real-signature',
    })

    bundle.signature = {
      value: 'signed-by-renderer-but-not-verifiable-here',
      type: 'idena_rpc_signature',
      signed: true,
      reason: null,
    }

    await storage.writeJsonAtomic(bundleFilePath, bundle)

    const federated = createLocalAiFederated({
      logger: mockLogger(),
      storage,
    })

    await expect(federated.importUpdateBundle(bundleFilePath)).resolves.toMatchObject({
      accepted: false,
      reason: 'signature_unverifiable',
      identity: '0x1234',
      epoch: 7,
      acceptedCount: 0,
      rejectedCount: 1,
    })
  })

  it('rejects bundles that contain raw image payloads', async () => {
    const bundleFilePath = storage.resolveLocalAiPath('incoming', 'raw-payload.json')
    const bundle = createPlaceholderBundle(storage, {
      nonce: 'bundle-nonce-raw',
      images: ['data:image/png;base64,AAA='],
    })

    bundle.signature.value = storage.sha256(JSON.stringify(bundle.payload))

    await storage.writeJsonAtomic(bundleFilePath, bundle)

    const federated = createLocalAiFederated({
      logger: mockLogger(),
      storage,
    })

    await expect(federated.importUpdateBundle(bundleFilePath)).resolves.toMatchObject({
      accepted: false,
      reason: 'contains_raw_payload',
      identity: null,
      epoch: null,
      acceptedCount: 0,
      rejectedCount: 1,
    })
  })

  it('aggregates accepted metadata-only bundles as an honest no-op result', async () => {
    await writeManifest(7)

    const logger = mockLogger()
    const federated = createLocalAiFederated({
      logger,
      isDev: true,
      storage,
    })

    const firstBundle = await federated.buildUpdateBundle(7)
    await federated.importUpdateBundle(firstBundle.bundlePath)

    const secondBundle = await federated.buildUpdateBundle(7)
    await federated.importUpdateBundle(secondBundle.bundlePath)

    const summary = await federated.aggregateAcceptedBundles()
    const result = await storage.readJson(summary.outputPath)

    expect(summary).toMatchObject({
      aggregated: false,
      mode: 'metadata_only_noop',
      compatibleCount: 2,
      skippedCount: 0,
      acceptedCount: 2,
      rejectedCount: 0,
      baseModelId: DEFAULT_BASE_MODEL_ID,
    })
    expect(result).toMatchObject({
      aggregated: false,
      mode: 'metadata_only_noop',
      baseModelId: DEFAULT_BASE_MODEL_ID,
      baseModelHash: storage.sha256(DEFAULT_BASE_MODEL_ID),
      minimumCompatibleBundles: 2,
      compatibleCount: 2,
      skippedCount: 0,
      acceptedCount: 2,
      rejectedCount: 0,
      deltaAvailability: 'none',
      reason: 'no_real_model_deltas',
    })
    expect(result.compatibleBundles).toHaveLength(2)
    expect(JSON.stringify(result)).not.toContain('"images"')
    expect(logger.debug).toHaveBeenCalledWith(
      'Local AI accepted bundle observed',
      expect.objectContaining({
        index: 0,
        epoch: 7,
        bundleId: expect.any(String),
        fileName: expect.stringMatching(/\.json$/),
      })
    )
    expect(logger.debug).toHaveBeenCalledWith(
      'Local AI accepted bundle observed',
      expect.objectContaining({
        index: 1,
        epoch: 7,
        bundleId: expect.any(String),
        fileName: expect.stringMatching(/\.json$/),
      })
    )
  })

  it('does not crash when the accepted bundle index is empty', async () => {
    const logger = mockLogger()
    const federated = createLocalAiFederated({
      logger,
      isDev: true,
      storage,
    })

    const summary = await federated.aggregateAcceptedBundles()
    const result = await storage.readJson(summary.outputPath)

    expect(summary).toMatchObject({
      aggregated: false,
      mode: 'metadata_only_noop',
      compatibleCount: 0,
      skippedCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      baseModelId: DEFAULT_BASE_MODEL_ID,
    })
    expect(result).toMatchObject({
      aggregated: false,
      mode: 'metadata_only_noop',
      compatibleCount: 0,
      skippedCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      reason: 'insufficient_compatible_bundles',
    })
    expect(
      logger.debug.mock.calls.filter(
        ([message]) => message === 'Local AI accepted bundle observed'
      )
    ).toHaveLength(0)
  })

  it('keeps aggregation honest when bundles advertise unsupported delta payloads', async () => {
    const firstBundlePath = storage.resolveLocalAiPath(
      'incoming',
      'delta-a.json'
    )
    const secondBundlePath = storage.resolveLocalAiPath(
      'incoming',
      'delta-b.json'
    )
    const firstBundle = createPlaceholderBundle(storage, {
      nonce: 'bundle-nonce-delta-a',
      deltaType: 'pending_adapter',
    })
    const secondBundle = createPlaceholderBundle(storage, {
      nonce: 'bundle-nonce-delta-b',
      deltaType: 'pending_adapter',
    })

    firstBundle.signature.value = storage.sha256(JSON.stringify(firstBundle.payload))
    secondBundle.signature.value = storage.sha256(
      JSON.stringify(secondBundle.payload)
    )

    await storage.writeJsonAtomic(firstBundlePath, firstBundle)
    await storage.writeJsonAtomic(secondBundlePath, secondBundle)

    const federated = createLocalAiFederated({
      logger: mockLogger(),
      storage,
    })

    await federated.importUpdateBundle(firstBundlePath)
    await federated.importUpdateBundle(secondBundlePath)

    const summary = await federated.aggregateAcceptedBundles()
    const result = await storage.readJson(summary.outputPath)

    expect(summary).toMatchObject({
      aggregated: false,
      mode: 'metadata_only_noop',
      compatibleCount: 2,
      acceptedCount: 2,
      rejectedCount: 0,
      baseModelId: DEFAULT_BASE_MODEL_ID,
    })
    expect(result).toMatchObject({
      aggregated: false,
      mode: 'metadata_only_noop',
      compatibleCount: 2,
      acceptedCount: 2,
      rejectedCount: 0,
      deltaAvailability: 'unsupported',
      reason: 'unsupported_delta_payload',
    })
  })

  it('skips incompatible received bundles during aggregation', async () => {
    const compatibleBundle = createPlaceholderBundle(storage, {
      nonce: 'bundle-nonce-compatible',
    })
    const compatibleId = storage.sha256(JSON.stringify(compatibleBundle))
    const compatiblePath = storage.resolveLocalAiPath(
      'received',
      '7',
      `${compatibleId}.json`
    )
    const mismatchBundle = createPlaceholderBundle(storage, {
      baseModelId: 'local-ai:other:mvp-placeholder-v1',
      baseModelHash: storage.sha256('local-ai:other:mvp-placeholder-v1'),
      nonce: 'bundle-nonce-mismatch',
    })
    mismatchBundle.signature.value = storage.sha256(
      JSON.stringify(mismatchBundle.payload)
    )
    const mismatchId = storage.sha256(JSON.stringify(mismatchBundle))
    const mismatchPath = storage.resolveLocalAiPath(
      'received',
      '7',
      `${mismatchId}.json`
    )

    await storage.writeJsonAtomic(compatiblePath, compatibleBundle)
    await storage.writeJsonAtomic(mismatchPath, mismatchBundle)
    await storage.writeJsonAtomic(storage.resolveLocalAiPath('received', 'index.json'), {
      version: 1,
      bundles: [
        createReceivedEntry({
          storage,
          bundle: compatibleBundle,
          bundleId: compatibleId,
          storedPath: compatiblePath,
        }),
        createReceivedEntry({
          storage,
          bundle: mismatchBundle,
          bundleId: mismatchId,
          storedPath: mismatchPath,
        }),
      ],
    })

    const federated = createLocalAiFederated({
      logger: mockLogger(),
      storage,
    })
    const summary = await federated.aggregateAcceptedBundles()
    const result = await storage.readJson(summary.outputPath)

    expect(summary).toMatchObject({
      aggregated: false,
      mode: 'metadata_only_noop',
      compatibleCount: 1,
      skippedCount: 1,
      acceptedCount: 1,
      rejectedCount: 1,
      baseModelId: DEFAULT_BASE_MODEL_ID,
    })
    expect(result.reason).toBe('insufficient_compatible_bundles')
    expect(result).toMatchObject({
      acceptedCount: 1,
      rejectedCount: 1,
    })
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          bundleId: mismatchId,
          reason: 'base_model_mismatch',
        }),
      ])
    )
  })
})
