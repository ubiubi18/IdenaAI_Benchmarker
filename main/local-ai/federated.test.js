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

function createTestSignPayload(storage) {
  return async (payloadText) => `test-signature:${storage.sha256(payloadText)}`
}

function createTestVerifySignature(storage) {
  return async ({payload, signature}) =>
    signature === `test-signature:${storage.sha256(JSON.stringify(payload))}`
}

function createPlaceholderBundle(storage, overrides = {}) {
  const auditTrainingPackage = {
    reviewStatus: 'approved',
    reviewedAt: '2026-04-11T00:05:00.000Z',
    federatedReady: true,
    eligibleCount: 2,
    excludedCount: 1,
    packageSha256: storage.sha256('training-package-default'),
    manifestSha256: storage.sha256('epoch-7-manifest'),
  }
  const governance = {
    eligible: true,
    source: 'test-fixture',
    exclusionRule: 'reported_flips_without_reward_excluded_for_one_epoch',
    exclusionWindowEpochs: 1,
    excludedCurrentEpoch: false,
    cooldownEpochsRemaining: 0,
    excludedUntilEpoch: null,
    exclusionReason: null,
    lastPenaltyEpoch: null,
    lastPenaltyType: null,
    lastRewardedEpoch: null,
    lastSessionReportedFlipPenalty: false,
  }
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
    adapterFormat: 'peft_lora_v1',
    trainingConfigHash: storage.sha256('training-config-default'),
    metrics: {
      eligibleCount: 2,
      excludedCount: 1,
    },
    governance,
    audit: {
      policyVersion: 1,
      trainingPackage: auditTrainingPackage,
      redundancy: {
        minimumCompatibleBundles: 2,
        minimumDistinctIdentities: 2,
        corroborationPolicy:
          'epoch+delta_type+adapter_format+adapter_sha256+training_config_hash+eligible_flip_hashes',
        duplicateIdentityPolicy: 'reject_same_identity_same_epoch',
      },
      governance: {
        exclusionRule: governance.exclusionRule,
        exclusionWindowEpochs: governance.exclusionWindowEpochs,
        source: governance.source,
      },
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
  bundle,
  bundleId,
  storedPath,
  epoch = 7,
  identity = bundle && bundle.payload
    ? bundle.payload.identity
    : PLACEHOLDER_IDENTITY,
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

  async function writeTrainingCandidatePackage(epoch = 7, overrides = {}) {
    const packageFilePath = storage.resolveLocalAiPath(
      'training-candidates',
      `epoch-${epoch}-candidates.json`
    )

    await storage.writeJsonAtomic(packageFilePath, {
      schemaVersion: 1,
      packageType: 'local-ai-training-candidates',
      epoch,
      createdAt: '2026-04-11T00:00:00.000Z',
      reviewStatus: 'approved',
      reviewedAt: '2026-04-11T00:05:00.000Z',
      federatedReady: true,
      eligibleCount: 2,
      excludedCount: 1,
      items: [{flipHash: 'flip-a'}, {flipHash: 'flip-b'}],
      excluded: [{flipHash: 'flip-c', reasons: ['missing_consensus']}],
      ...overrides,
    })

    return packageFilePath
  }

  async function writeAdapterRegistration(
    epoch = 7,
    {
      fileName = `epoch-${epoch}-lora.safetensors`,
      buffer = Buffer.from(`adapter-bytes-epoch-${epoch}`),
      trainingConfigHash = `training-config-epoch-${epoch}`,
    } = {}
  ) {
    const adapterSourcePath = storage.resolveLocalAiPath('artifacts', fileName)

    await storage.writeBuffer(adapterSourcePath, buffer)
    await storage.writeJsonAtomic(
      storage.resolveLocalAiPath('adapters', `epoch-${epoch}.json`),
      {
        epoch,
        baseModelId: DEFAULT_BASE_MODEL_ID,
        baseModelHash: storage.sha256(DEFAULT_BASE_MODEL_ID),
        deltaType: 'lora_adapter',
        adapterFormat: 'peft_lora_v1',
        adapterSha256: storage.sha256(buffer),
        trainingConfigHash,
        adapterArtifact: {
          file: fileName,
          sourcePath: adapterSourcePath,
        },
      }
    )

    return {adapterSourcePath, adapterBuffer: buffer}
  }

  async function writeIncomingBundle(fileName, bundle) {
    const bundleFilePath = storage.resolveLocalAiPath('incoming', fileName)
    await storage.writeJsonAtomic(bundleFilePath, bundle)
    return bundleFilePath
  }

  async function buildConcreteBundle(
    epoch = 7,
    adapterOptions = {},
    {identity = PLACEHOLDER_IDENTITY, governance = null} = {}
  ) {
    await writeManifest(epoch)
    await writeTrainingCandidatePackage(epoch)
    await writeAdapterRegistration(epoch, adapterOptions)

    const useSignedIdentity = identity !== PLACEHOLDER_IDENTITY
    const federated = createLocalAiFederated({
      logger: mockLogger(),
      storage,
      getIdentity: () => identity,
      signPayload: useSignedIdentity
        ? createTestSignPayload(storage)
        : undefined,
      getGovernanceStatus: governance ? () => governance : undefined,
    })

    return federated.buildUpdateBundle(epoch)
  }

  it('fails clearly when the manifest is missing', async () => {
    const federated = createLocalAiFederated({
      logger: mockLogger(),
      storage,
      verifySignature: createTestVerifySignature(storage),
    })

    await expect(federated.buildUpdateBundle(5)).rejects.toThrow(
      'Local AI manifest for epoch 5 does not exist'
    )
  })

  it('requires an approved training package before building a federated bundle', async () => {
    await writeManifest(7)

    const federated = createLocalAiFederated({
      logger: mockLogger(),
      storage,
      verifySignature: createTestVerifySignature(storage),
    })

    await expect(federated.buildUpdateBundle(7)).rejects.toThrow(
      'Local AI training package for epoch 7 is unavailable'
    )
  })

  it('requires package approval before building a federated bundle', async () => {
    await writeManifest(7)
    await writeTrainingCandidatePackage(7, {reviewStatus: 'reviewed'})

    const federated = createLocalAiFederated({
      logger: mockLogger(),
      storage,
      verifySignature: createTestVerifySignature(storage),
    })

    await expect(federated.buildUpdateBundle(7)).rejects.toThrow(
      'Local AI training package for epoch 7 is not approved for federated export'
    )
  })

  it('requires a concrete adapter artifact before building a federated bundle', async () => {
    await writeManifest(7)
    await writeTrainingCandidatePackage(7)

    const federated = createLocalAiFederated({
      logger: mockLogger(),
      storage,
    })

    await expect(federated.buildUpdateBundle(7)).rejects.toThrow(
      'Concrete adapter artifact for epoch 7 is required before building a federated bundle'
    )
  })

  it('rejects bundle export when the approved package no longer matches the manifest', async () => {
    await writeManifest(7)
    await writeTrainingCandidatePackage(7, {
      eligibleCount: 1,
      items: [{flipHash: 'flip-a'}],
      excludedCount: 2,
      excluded: [
        {flipHash: 'flip-b', reasons: ['missing_consensus']},
        {flipHash: 'flip-c', reasons: ['missing_consensus']},
      ],
    })
    await writeAdapterRegistration(7, {
      fileName: 'epoch-7-out-of-sync.safetensors',
      buffer: Buffer.from('adapter-bytes-out-of-sync'),
      trainingConfigHash: 'training-config-out-of-sync',
    })

    const federated = createLocalAiFederated({
      logger: mockLogger(),
      storage,
    })

    await expect(federated.buildUpdateBundle(7)).rejects.toThrow(
      'Local AI manifest for epoch 7 is out of sync with approved training package'
    )
  })

  it('builds a concrete adapter bundle when a local adapter artifact manifest exists', async () => {
    await writeManifest(7)
    await writeTrainingCandidatePackage(7)
    const {adapterBuffer} = await writeAdapterRegistration(7)

    const federated = createLocalAiFederated({
      logger: mockLogger(),
      storage,
    })

    const summary = await federated.buildUpdateBundle(7)
    const bundle = await storage.readJson(summary.bundlePath)

    expect(summary).toMatchObject({
      epoch: 7,
      deltaType: 'lora_adapter',
      eligibleCount: 2,
      artifactPath: expect.any(String),
    })
    expect(bundle.payload).toMatchObject({
      deltaType: 'lora_adapter',
      adapterFormat: 'peft_lora_v1',
      adapterSha256: storage.sha256(adapterBuffer),
      trainingConfigHash: 'training-config-epoch-7',
      adapterArtifact: {
        file: path.basename(summary.artifactPath),
        sizeBytes: adapterBuffer.length,
      },
      governance: expect.objectContaining({
        eligible: true,
        source: 'unverified_local_default',
        excludedCurrentEpoch: false,
      }),
      audit: expect.objectContaining({
        policyVersion: 1,
        trainingPackage: expect.objectContaining({
          reviewStatus: 'approved',
          federatedReady: true,
        }),
        redundancy: expect.objectContaining({
          minimumDistinctIdentities: 2,
        }),
      }),
    })
    await expect(storage.readBuffer(summary.artifactPath)).resolves.toEqual(
      adapterBuffer
    )
  })

  it('blocks bundle export when the identity is on a governance cooldown', async () => {
    await writeManifest(7)
    await writeTrainingCandidatePackage(7)
    await writeAdapterRegistration(7, {
      fileName: 'epoch-7-governance-blocked.safetensors',
      buffer: Buffer.from('adapter-governance-blocked'),
      trainingConfigHash: 'training-config-governance-blocked',
    })

    const federated = createLocalAiFederated({
      logger: mockLogger(),
      storage,
      getIdentity: () => '0xgovernanceblocked',
      getGovernanceStatus: () => ({
        eligible: false,
        source: 'reward-audit-snapshot',
        exclusionRule: 'reported_flips_without_reward_excluded_for_one_epoch',
        exclusionWindowEpochs: 1,
        excludedCurrentEpoch: true,
        cooldownEpochsRemaining: 1,
        excludedUntilEpoch: 7,
        exclusionReason: 'reported_flips_without_reward',
        lastPenaltyEpoch: 6,
        lastPenaltyType: 'reported_flips_without_reward',
        lastRewardedEpoch: 5,
        lastSessionReportedFlipPenalty: true,
      }),
    })

    await expect(federated.buildUpdateBundle(7)).rejects.toThrow(
      'Identity 0xgovernanceblocked is not eligible for federated governance in epoch 7'
    )
  })

  it('imports a concrete adapter bundle and stores the adapter artifact locally', async () => {
    await writeManifest(7)
    await writeTrainingCandidatePackage(7)
    const {adapterBuffer} = await writeAdapterRegistration(7, {
      fileName: 'epoch-7-import.safetensors',
      buffer: Buffer.from('adapter-import-bytes'),
      trainingConfigHash: 'training-config-epoch-7-import',
    })

    const federated = createLocalAiFederated({
      logger: mockLogger(),
      storage,
    })
    const built = await federated.buildUpdateBundle(7)
    const imported = await federated.importUpdateBundle(built.bundlePath)
    const index = await storage.readJson(
      storage.resolveLocalAiPath('received', 'index.json')
    )

    expect(imported).toMatchObject({
      accepted: true,
      artifactPath: expect.any(String),
      storedPath: expect.any(String),
    })
    expect(index.bundles[0]).toEqual(
      expect.objectContaining({
        artifactStoredPath: imported.artifactPath,
      })
    )
    await expect(storage.readBuffer(imported.artifactPath)).resolves.toEqual(
      adapterBuffer
    )
  })

  it('rejects placeholder bundles without a concrete adapter payload', async () => {
    const built = createPlaceholderBundle(storage, {
      nonce: 'bundle-nonce-placeholder-import',
    })
    const bundlePath = await writeIncomingBundle(
      'placeholder-import.json',
      built
    )

    const federated = createLocalAiFederated({
      logger: mockLogger(),
      storage,
    })
    const imported = await federated.importUpdateBundle(bundlePath)
    const index = await storage.readJson(
      storage.resolveLocalAiPath('received', 'index.json'),
      {bundles: []}
    )

    expect(imported).toMatchObject({
      accepted: false,
      reason: 'concrete_adapter_required',
      identity: PLACEHOLDER_IDENTITY,
      epoch: 7,
      bundlePath,
      acceptedCount: 0,
      rejectedCount: 1,
    })
    expect(index.bundles).toHaveLength(0)
  })

  it('rejects duplicate nonces', async () => {
    const built = await buildConcreteBundle(
      7,
      {
        fileName: 'epoch-7-duplicate.safetensors',
        buffer: Buffer.from('adapter-bytes-duplicate'),
        trainingConfigHash: 'training-config-duplicate',
      },
      {identity: '0xduplicate'}
    )

    const federated = createLocalAiFederated({
      logger: mockLogger(),
      storage,
      verifySignature: createTestVerifySignature(storage),
    })

    await federated.importUpdateBundle(built.bundlePath)

    await expect(
      federated.importUpdateBundle(built.bundlePath)
    ).resolves.toMatchObject({
      accepted: false,
      reason: 'duplicate_nonce',
      identity: '0xduplicate',
      epoch: 7,
      acceptedCount: 0,
      rejectedCount: 1,
    })
  })

  it('rejects a second bundle from the same identity in the same epoch', async () => {
    const identity = '0xrepeatidentity'
    const firstBuilt = await buildConcreteBundle(
      7,
      {
        fileName: 'epoch-7-repeat-a.safetensors',
        buffer: Buffer.from('adapter-bytes-repeat-a'),
        trainingConfigHash: 'training-config-repeat-a',
      },
      {identity}
    )

    const federated = createLocalAiFederated({
      logger: mockLogger(),
      storage,
      verifySignature: createTestVerifySignature(storage),
    })
    await federated.importUpdateBundle(firstBuilt.bundlePath)

    await writeAdapterRegistration(7, {
      fileName: 'epoch-7-repeat-b.safetensors',
      buffer: Buffer.from('adapter-bytes-repeat-b'),
      trainingConfigHash: 'training-config-repeat-b',
    })

    const secondFederated = createLocalAiFederated({
      logger: mockLogger(),
      storage,
      getIdentity: () => identity,
      signPayload: createTestSignPayload(storage),
    })
    const secondBuilt = await secondFederated.buildUpdateBundle(7)

    await expect(
      federated.importUpdateBundle(secondBuilt.bundlePath)
    ).resolves.toMatchObject({
      accepted: false,
      reason: 'duplicate_identity_epoch',
      identity,
      epoch: 7,
      acceptedCount: 0,
      rejectedCount: 1,
    })
  })

  it('rejects concrete adapter bundles that omit the artifact file metadata', async () => {
    const bundle = createPlaceholderBundle(storage, {
      nonce: 'bundle-nonce-missing-artifact',
      deltaType: 'lora_adapter',
      adapterSha256: storage.sha256('missing-artifact-adapter'),
    })
    const bundlePath = await writeIncomingBundle(
      'missing-artifact.json',
      bundle
    )

    const federated = createLocalAiFederated({
      logger: mockLogger(),
      storage,
    })

    await expect(
      federated.importUpdateBundle(bundlePath)
    ).resolves.toMatchObject({
      accepted: false,
      reason: 'adapter_artifact_required',
      identity: PLACEHOLDER_IDENTITY,
      epoch: 7,
      acceptedCount: 0,
      rejectedCount: 1,
    })
  })

  it('rejects base-model mismatches', async () => {
    const bundleFilePath = storage.resolveLocalAiPath(
      'incoming',
      'mismatch.json'
    )
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

    await expect(
      federated.importUpdateBundle(bundleFilePath)
    ).resolves.toMatchObject({
      accepted: false,
      reason: 'base_model_mismatch',
      identity: PLACEHOLDER_IDENTITY,
      epoch: 7,
      acceptedCount: 0,
      rejectedCount: 1,
    })
  })

  it('rejects malformed bundles with schema_invalid', async () => {
    const bundleFilePath = storage.resolveLocalAiPath(
      'incoming',
      'invalid.json'
    )

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

    await expect(
      federated.importUpdateBundle(bundleFilePath)
    ).resolves.toMatchObject({
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

    await expect(
      federated.importUpdateBundle(bundleFilePath)
    ).resolves.toMatchObject({
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
    const {bundlePath} = await buildConcreteBundle(7, {
      fileName: 'epoch-7-import-failure.safetensors',
      buffer: Buffer.from('adapter-bytes-import-failure'),
      trainingConfigHash: 'training-config-import-failure',
    })

    const logger = mockLogger()
    const failingStorage = {
      ...storage,
      writeJsonAtomic: jest.fn(async (filePath, obj) => {
        if (
          String(filePath).endsWith(`${path.sep}received${path.sep}index.json`)
        ) {
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

    await expect(
      federated.importUpdateBundle(bundlePath)
    ).resolves.toMatchObject({
      accepted: false,
      reason: 'import_failed',
      identity: PLACEHOLDER_IDENTITY,
      epoch: 7,
      bundlePath,
      acceptedCount: 0,
      rejectedCount: 1,
    })
    expect(logger.error).toHaveBeenCalledWith(
      'Local AI update bundle import failed',
      expect.objectContaining({
        fileName: path.basename(bundlePath),
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

    await expect(
      federated.importUpdateBundle(bundleFilePath)
    ).resolves.toMatchObject({
      accepted: false,
      reason: 'signature_unverifiable',
      identity: '0x1234',
      epoch: 7,
      acceptedCount: 0,
      rejectedCount: 1,
    })
  })

  it('rejects bundles that contain raw image payloads', async () => {
    const bundleFilePath = storage.resolveLocalAiPath(
      'incoming',
      'raw-payload.json'
    )
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

    await expect(
      federated.importUpdateBundle(bundleFilePath)
    ).resolves.toMatchObject({
      accepted: false,
      reason: 'contains_raw_payload',
      identity: null,
      epoch: null,
      acceptedCount: 0,
      rejectedCount: 1,
    })
  })

  it('aggregates previously accepted pending-adapter bundles as an honest no-op result', async () => {
    const firstBundle = createPlaceholderBundle(storage, {
      identity: '0xaaaa',
      nonce: 'bundle-nonce-aggregate-a',
      deltaType: 'pending_adapter',
    })
    const secondBundle = createPlaceholderBundle(storage, {
      identity: '0xbbbb',
      nonce: 'bundle-nonce-aggregate-b',
      deltaType: 'pending_adapter',
    })

    const logger = mockLogger()
    const federated = createLocalAiFederated({
      logger,
      isDev: true,
      storage,
    })

    const firstBundleId = storage.sha256(JSON.stringify(firstBundle))
    const secondBundleId = storage.sha256(JSON.stringify(secondBundle))
    const firstStoredPath = storage.resolveLocalAiPath(
      'received',
      '7',
      `${firstBundleId}.json`
    )
    const secondStoredPath = storage.resolveLocalAiPath(
      'received',
      '7',
      `${secondBundleId}.json`
    )

    await storage.writeJsonAtomic(firstStoredPath, firstBundle)
    await storage.writeJsonAtomic(secondStoredPath, secondBundle)
    await storage.writeJsonAtomic(
      storage.resolveLocalAiPath('received', 'index.json'),
      {
        version: 1,
        bundles: [
          createReceivedEntry({
            bundle: firstBundle,
            bundleId: firstBundleId,
            storedPath: firstStoredPath,
          }),
          createReceivedEntry({
            bundle: secondBundle,
            bundleId: secondBundleId,
            storedPath: secondStoredPath,
          }),
        ],
      }
    )

    const summary = await federated.aggregateAcceptedBundles()
    const result = await storage.readJson(summary.outputPath)

    expect(summary).toMatchObject({
      aggregated: false,
      mode: 'adapter_contract_pending',
      compatibleCount: 2,
      distinctIdentityCount: 2,
      skippedCount: 0,
      acceptedCount: 2,
      rejectedCount: 0,
      baseModelId: DEFAULT_BASE_MODEL_ID,
    })
    expect(result).toMatchObject({
      aggregated: false,
      mode: 'adapter_contract_pending',
      baseModelId: DEFAULT_BASE_MODEL_ID,
      baseModelHash: storage.sha256(DEFAULT_BASE_MODEL_ID),
      minimumCompatibleBundles: 2,
      minimumDistinctIdentities: 2,
      compatibleCount: 2,
      distinctIdentityCount: 2,
      skippedCount: 0,
      acceptedCount: 2,
      rejectedCount: 0,
      bestCorroborationDistinctIdentityCount: 2,
      deltaAvailability: 'pending',
      reason: 'adapter_artifacts_pending',
    })
    expect(result.compatibleBundles).toHaveLength(2)
    expect(result.corroborationGroups).toEqual([
      expect.objectContaining({
        distinctIdentityCount: 2,
        bundleCount: 2,
        identities: ['0xaaaa', '0xbbbb'],
      }),
    ])
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
      distinctIdentityCount: 0,
      skippedCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      baseModelId: DEFAULT_BASE_MODEL_ID,
    })
    expect(result).toMatchObject({
      aggregated: false,
      mode: 'metadata_only_noop',
      compatibleCount: 0,
      distinctIdentityCount: 0,
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

  it('keeps aggregation honest for previously accepted unsupported delta payloads', async () => {
    const firstBundlePath = storage.resolveLocalAiPath(
      'incoming',
      'delta-a.json'
    )
    const secondBundlePath = storage.resolveLocalAiPath(
      'incoming',
      'delta-b.json'
    )
    const firstBundle = createPlaceholderBundle(storage, {
      identity: '0x1111',
      nonce: 'bundle-nonce-delta-a',
      deltaType: 'custom_adapter',
      adapterFormat: 'custom_format_v1',
      adapterSha256: 'adapter-sha-shared',
      trainingConfigHash: 'training-config-shared',
    })
    const secondBundle = createPlaceholderBundle(storage, {
      identity: '0x2222',
      nonce: 'bundle-nonce-delta-b',
      deltaType: 'custom_adapter',
      adapterFormat: 'custom_format_v1',
      adapterSha256: 'adapter-sha-shared',
      trainingConfigHash: 'training-config-shared',
    })

    firstBundle.signature.value = storage.sha256(
      JSON.stringify(firstBundle.payload)
    )
    secondBundle.signature.value = storage.sha256(
      JSON.stringify(secondBundle.payload)
    )

    await storage.writeJsonAtomic(firstBundlePath, firstBundle)
    await storage.writeJsonAtomic(secondBundlePath, secondBundle)

    const federated = createLocalAiFederated({
      logger: mockLogger(),
      storage,
    })

    const firstBundleId = storage.sha256(JSON.stringify(firstBundle))
    const secondBundleId = storage.sha256(JSON.stringify(secondBundle))
    const firstStoredPath = storage.resolveLocalAiPath(
      'received',
      '7',
      `${firstBundleId}.json`
    )
    const secondStoredPath = storage.resolveLocalAiPath(
      'received',
      '7',
      `${secondBundleId}.json`
    )

    await storage.writeJsonAtomic(firstStoredPath, firstBundle)
    await storage.writeJsonAtomic(secondStoredPath, secondBundle)
    await storage.writeJsonAtomic(
      storage.resolveLocalAiPath('received', 'index.json'),
      {
        version: 1,
        bundles: [
          createReceivedEntry({
            bundle: firstBundle,
            bundleId: firstBundleId,
            storedPath: firstStoredPath,
          }),
          createReceivedEntry({
            bundle: secondBundle,
            bundleId: secondBundleId,
            storedPath: secondStoredPath,
          }),
        ],
      }
    )

    const summary = await federated.aggregateAcceptedBundles()
    const result = await storage.readJson(summary.outputPath)

    expect(summary).toMatchObject({
      aggregated: false,
      mode: 'metadata_only_noop',
      compatibleCount: 2,
      distinctIdentityCount: 2,
      acceptedCount: 2,
      rejectedCount: 0,
      baseModelId: DEFAULT_BASE_MODEL_ID,
    })
    expect(result).toMatchObject({
      aggregated: false,
      mode: 'metadata_only_noop',
      compatibleCount: 2,
      distinctIdentityCount: 2,
      acceptedCount: 2,
      rejectedCount: 0,
      bestCorroborationDistinctIdentityCount: 2,
      deltaAvailability: 'unsupported',
      reason: 'unsupported_delta_payload',
    })
  })

  it('requires corroboration from different identities before trusting compatible bundles', async () => {
    const firstBundle = createPlaceholderBundle(storage, {
      identity: '0xsame-a',
      nonce: 'bundle-nonce-corroboration-a',
      deltaType: 'pending_adapter',
      adapterFormat: 'peft_lora_v1',
      trainingConfigHash: 'training-config-a',
    })
    const secondBundle = createPlaceholderBundle(storage, {
      identity: '0xsame-b',
      nonce: 'bundle-nonce-corroboration-b',
      deltaType: 'pending_adapter',
      adapterFormat: 'peft_lora_v1',
      trainingConfigHash: 'training-config-b',
    })

    const firstBundleId = storage.sha256(JSON.stringify(firstBundle))
    const secondBundleId = storage.sha256(JSON.stringify(secondBundle))
    const firstStoredPath = storage.resolveLocalAiPath(
      'received',
      '7',
      `${firstBundleId}.json`
    )
    const secondStoredPath = storage.resolveLocalAiPath(
      'received',
      '7',
      `${secondBundleId}.json`
    )

    await storage.writeJsonAtomic(firstStoredPath, firstBundle)
    await storage.writeJsonAtomic(secondStoredPath, secondBundle)
    await storage.writeJsonAtomic(
      storage.resolveLocalAiPath('received', 'index.json'),
      {
        version: 1,
        bundles: [
          createReceivedEntry({
            bundle: firstBundle,
            bundleId: firstBundleId,
            storedPath: firstStoredPath,
          }),
          createReceivedEntry({
            bundle: secondBundle,
            bundleId: secondBundleId,
            storedPath: secondStoredPath,
          }),
        ],
      }
    )

    const federated = createLocalAiFederated({
      logger: mockLogger(),
      storage,
    })
    const summary = await federated.aggregateAcceptedBundles()
    const result = await storage.readJson(summary.outputPath)

    expect(summary).toMatchObject({
      aggregated: false,
      mode: 'metadata_only_noop',
      compatibleCount: 2,
      distinctIdentityCount: 2,
      baseModelId: DEFAULT_BASE_MODEL_ID,
    })
    expect(result).toMatchObject({
      reason: 'insufficient_corroboration',
      bestCorroborationDistinctIdentityCount: 1,
    })
  })

  it('skips incompatible received bundles during aggregation', async () => {
    const compatibleBundle = createPlaceholderBundle(storage, {
      identity: '0xcompatible',
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
    await storage.writeJsonAtomic(
      storage.resolveLocalAiPath('received', 'index.json'),
      {
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
      }
    )

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
      distinctIdentityCount: 1,
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
