const os = require('os')
const path = require('path')
const fs = require('fs-extra')

const {
  buildValidationDevnetPlan,
  buildValidationDevnetNodeConfig,
  buildValidationDevnetSeedFlipSubmitArgs,
  buildValidationDevnetSeedFlipMetaByHash,
  countReadyValidationHashItems,
  getValidationDevnetPrimaryPeerTarget,
  getValidationDevnetPublishedFlipCount,
  loadValidationDevnetSeedFlips,
  loadValidationDevnetSeedPayload,
  serializeValidationDevnetConfig,
  summarizeValidationDevnetNode,
  shouldSuppressValidationDevnetLogLine,
  getValidationHashQueryCapabilities,
  canConnectValidationDevnetStatus,
  shouldConnectValidationDevnetStatus,
  VALIDATION_DEVNET_PHASE,
} = require('./idena-devnet')
const sampleSeedPayload = require('../samples/flips/flip-challenge-test-5-decoded-labeled.json')

describe('validation devnet helpers', () => {
  it('builds a nine-node private rehearsal plan by default', () => {
    const plan = buildValidationDevnetPlan({
      baseDir: '/tmp/idena-validation-devnet',
      now: () => new Date('2026-04-21T12:00:00.000Z').getTime(),
      networkId: 44001,
    })

    expect(plan.networkId).toBe(44001)
    expect(plan.nodes).toHaveLength(9)
    expect(plan.primaryNodeName).toBe('node-2')
    expect(plan.godAddress).toBe(plan.nodes[0].address)
    expect(new Set(plan.nodes.map(({rpcPort}) => rpcPort)).size).toBe(9)
    expect(plan.firstCeremonyUnix).toBe(1776773280)
    expect(plan.initialEpoch).toBe(1)
    expect(plan.requiredFlipsPerIdentity).toBe(3)
    expect(plan.alloc[plan.nodes[0].address]).toMatchObject({
      Balance: '1000000000000000000000',
      Stake: '25000000000000000000',
      State: 3,
      RequiredFlips: 3,
    })
    expect(plan.alloc[plan.nodes[1].address]).toMatchObject({
      RequiredFlips: 3,
    })
    expect(
      Object.values(plan.alloc).reduce(
        (total, allocation) => total + allocation.RequiredFlips,
        0
      )
    ).toBe(27)
    expect(plan.nodes[0].configFile).toBe(
      path.join('/tmp/idena-validation-devnet', 'node-1', 'config.json')
    )
  })

  it('builds isolated node config with shared genesis and bootnodes', () => {
    const plan = buildValidationDevnetPlan({
      baseDir: '/tmp/idena-validation-devnet',
      nodeCount: 5,
      now: () => new Date('2026-04-21T12:00:00.000Z').getTime(),
      networkId: 55002,
      firstCeremonyUnix: 1768737900,
      seedFlipCount: 5,
    })

    const node = plan.nodes[1]
    const config = buildValidationDevnetNodeConfig({
      plan,
      node,
      bootNodes: ['/ip4/127.0.0.1/tcp/22500/ipfs/QmBootstrap'],
    })

    expect(config.Network).toBe(55002)
    expect(config.RPC).toEqual({
      HTTPHost: 'localhost',
      HTTPPort: node.rpcPort,
    })
    expect(config.GenesisConf).toMatchObject({
      GodAddress: plan.godAddress,
      FirstCeremonyTime: 1768737900,
      InitialEpoch: 1,
    })
    expect(config.GenesisConf.Alloc[plan.nodes[0].address]).toMatchObject({
      State: 3,
      RequiredFlips: 3,
    })
    expect(config.IpfsConf).toMatchObject({
      BootNodes: ['/ip4/127.0.0.1/tcp/22500/ipfs/QmBootstrap'],
      IpfsPort: node.ipfsPort,
      SwarmListenHost: '127.0.0.1',
      StaticPort: true,
      SwarmKey: plan.swarmKey,
    })
    expect(config.Validation.FlipLotteryDuration).toBe(300000000000)
    expect(config.Validation.ShortSessionDuration).toBe(120000000000)
    expect(config.Validation.LongSessionDuration).toBe(900000000000)
    expect(config.Consensus.Automine).toBe(false)
  })

  it('serializes genesis big-int balances as raw JSON numbers', () => {
    const plan = buildValidationDevnetPlan({
      baseDir: '/tmp/idena-validation-devnet',
      nodeCount: 5,
      now: () => new Date('2026-04-21T12:00:00.000Z').getTime(),
      networkId: 55002,
      firstCeremonyUnix: 1768737900,
      seedFlipCount: 5,
    })

    const node = plan.nodes[1]
    const config = buildValidationDevnetNodeConfig({
      plan,
      node,
      bootNodes: ['/ip4/127.0.0.1/tcp/22500/ipfs/QmBootstrap'],
    })

    const serialized = serializeValidationDevnetConfig(config)

    expect(serialized).toContain('"Balance": 1000000000000000000000')
    expect(serialized).toContain('"Stake": 25000000000000000000')
    expect(serialized).not.toContain('"Balance": "1000000000000000000000"')
    expect(serialized).not.toContain('"Stake": "25000000000000000000"')
  })

  it('omits api keys from routine node status snapshots', () => {
    const summary = summarizeValidationDevnetNode({
      name: 'node-1',
      role: 'bootstrap',
      address: '0xabc',
      rpcPort: 22300,
      tcpPort: 22400,
      ipfsPort: 22500,
      apiKey: 'validation-devnet-secret',
      process: {pid: 1234},
      rpcReady: true,
      peerCount: 2,
      syncing: false,
      online: true,
      identityState: 'Verified',
      currentPeriod: 'FlipLottery',
      nextValidation: '2026-04-21T12:03:00.000Z',
    })

    expect(summary).toEqual({
      name: 'node-1',
      role: 'bootstrap',
      address: '0xabc',
      rpcPort: 22300,
      tcpPort: 22400,
      ipfsPort: 22500,
      pid: 1234,
      rpcReady: true,
      peerCount: 2,
      syncing: false,
      online: true,
      identityState: 'Verified',
      currentPeriod: 'FlipLottery',
      nextValidation: '2026-04-21T12:03:00.000Z',
    })
    expect(summary.apiKey).toBeUndefined()
  })

  it('targets a denser primary peer count for rehearsal readiness', () => {
    expect(getValidationDevnetPrimaryPeerTarget(1)).toBe(1)
    expect(getValidationDevnetPrimaryPeerTarget(2)).toBe(1)
    expect(getValidationDevnetPrimaryPeerTarget(3)).toBe(2)
    expect(getValidationDevnetPrimaryPeerTarget(9)).toBe(3)
  })

  it('falls back to madeFlips when identity flip arrays are unavailable', () => {
    expect(
      getValidationDevnetPublishedFlipCount({
        flips: null,
        madeFlips: 3,
      })
    ).toBe(3)

    expect(
      getValidationDevnetPublishedFlipCount({
        flips: ['a', 'b'],
        madeFlips: 99,
      })
    ).toBe(2)
  })

  it('counts only truly ready validation hashes as ready now', () => {
    expect(
      countReadyValidationHashItems([
        {hash: 'bafkrei-ready', ready: true, available: true},
        {hash: 'bafkrei-assigned-only', ready: false, available: true},
        {hash: 'bafkrei-unavailable', ready: false, available: false},
      ])
    ).toBe(1)
  })

  it('does not query long-session hashes before long session starts', () => {
    expect(getValidationHashQueryCapabilities('FlipLottery')).toEqual({
      short: true,
      long: false,
    })
    expect(getValidationHashQueryCapabilities('ShortSession')).toEqual({
      short: true,
      long: false,
    })
    expect(getValidationHashQueryCapabilities('LongSession')).toEqual({
      short: false,
      long: true,
    })
    expect(getValidationHashQueryCapabilities('None')).toEqual({
      short: false,
      long: false,
    })
  })

  it('suppresses high-volume short and long hash rpc noise in the app log stream', () => {
    expect(
      shouldSuppressValidationDevnetLogLine(
        '\u001b[32mINFO \u001b[0m[04-21|23:29:25.878] short hashes request'
      )
    ).toBe(true)
    expect(
      shouldSuppressValidationDevnetLogLine(
        '\u001b[32mINFO \u001b[0m[04-21|23:29:25.879] long hashes response'
      )
    ).toBe(true)
    expect(
      shouldSuppressValidationDevnetLogLine(
        '[node-2] INFO [04-21|23:29:30.000] published flip'
      )
    ).toBe(false)
  })

  it('marks the rehearsal RPC connectable once the primary node is fully running', () => {
    expect(
      canConnectValidationDevnetStatus({
        stage: VALIDATION_DEVNET_PHASE.WAITING_FOR_PEERS,
        primaryRpcUrl: 'http://127.0.0.1:22301',
        primaryValidationAssigned: true,
      })
    ).toBe(false)
    expect(
      canConnectValidationDevnetStatus({
        stage: VALIDATION_DEVNET_PHASE.SEEDING_FLIPS,
        primaryRpcUrl: 'http://127.0.0.1:22301',
        primaryValidationAssigned: true,
      })
    ).toBe(false)
    expect(
      canConnectValidationDevnetStatus({
        stage: VALIDATION_DEVNET_PHASE.RUNNING,
        primaryRpcUrl: 'http://127.0.0.1:22301',
        primaryValidationAssigned: false,
      })
    ).toBe(true)
    expect(
      canConnectValidationDevnetStatus({
        stage: VALIDATION_DEVNET_PHASE.RUNNING,
        primaryRpcUrl: 'http://127.0.0.1:22301',
        primaryValidationAssigned: true,
      })
    ).toBe(true)
    expect(
      canConnectValidationDevnetStatus({
        stage: VALIDATION_DEVNET_PHASE.STARTING_VALIDATORS,
        primaryRpcUrl: 'http://127.0.0.1:22301',
        primaryValidationAssigned: true,
      })
    ).toBe(false)
    expect(
      canConnectValidationDevnetStatus({
        stage: VALIDATION_DEVNET_PHASE.RUNNING,
        primaryRpcUrl: 'http://127.0.0.1:22301',
      })
    ).toBe(true)
    expect(
      canConnectValidationDevnetStatus({
        stage: VALIDATION_DEVNET_PHASE.WAITING_FOR_PEERS,
      })
    ).toBe(false)
  })

  it('can delay app connection until the last countdown window', () => {
    const connectableStatus = {
      stage: VALIDATION_DEVNET_PHASE.RUNNING,
      primaryRpcUrl: 'http://127.0.0.1:22301',
      primaryValidationAssigned: true,
      countdownSeconds: 35,
    }

    expect(
      shouldConnectValidationDevnetStatus(connectableStatus, {
        connectCountdownSeconds: 20,
      })
    ).toBe(false)
    expect(
      shouldConnectValidationDevnetStatus(
        {...connectableStatus, countdownSeconds: 20},
        {
          connectCountdownSeconds: 20,
        }
      )
    ).toBe(true)
    expect(shouldConnectValidationDevnetStatus(connectableStatus)).toBe(true)
  })

  it('builds flip_submit payloads from bundled FLIP-Challenge seed flips', () => {
    const firstFlip = sampleSeedPayload.flips[0]
    const submitArgs = buildValidationDevnetSeedFlipSubmitArgs(firstFlip, 7)

    expect(submitArgs).toEqual({
      publicHex: expect.stringMatching(/^0x[0-9a-f]+$/),
      privateHex: expect.stringMatching(/^0x[0-9a-f]+$/),
      pairId: 7,
    })
    expect(submitArgs.publicHex.length).toBeGreaterThan(10)
    expect(submitArgs.privateHex.length).toBeGreaterThan(10)
  })

  it('builds rehearsal seed benchmark metadata by hash', () => {
    expect(
      buildValidationDevnetSeedFlipMetaByHash([
        {
          hash: '0xflip-1',
          expectedAnswer: 'LEFT',
          expectedStrength: 'Strong',
          consensusVotes: {Left: 9, Right: 1, Reported: 0},
          words: [
            {name: 'apple', desc: 'fruit'},
            {name: 'ghost', desc: 'spirit'},
          ],
          sourceStats: {
            epoch: 27,
            status: 'Qualified',
            shortRespCount: 1,
            longRespCount: 10,
            wrongWordsVotes: 2,
          },
          sourceDataset: 'aplesner-eth/FLIP-Challenge',
          sourceSplit: 'test',
        },
        {
          hash: '0xflip-2',
          expectedAnswer: 'unknown',
        },
      ])
    ).toEqual({
      '0xflip-1': {
        expectedAnswer: 'left',
        expectedStrength: 'Strong',
        consensusAnswer: 'left',
        consensusStrength: 'Strong',
        consensusVotes: {left: 9, right: 1, reported: 0, total: 10},
        words: [
          {name: 'apple', desc: 'fruit'},
          {name: 'ghost', desc: 'spirit'},
        ],
        sourceStats: {
          epoch: 27,
          author: null,
          status: 'Qualified',
          shortRespCount: 1,
          longRespCount: 10,
          wrongWords: false,
          wrongWordsVotes: 2,
          withPrivatePart: false,
          grade: null,
          gradeScore: null,
          createdAt: null,
          block: null,
          tx: null,
        },
        sourceDataset: 'aplesner-eth/FLIP-Challenge',
        sourceSplit: 'test',
      },
    })
  })

  it('loads enough FLIP-Challenge seed flips to satisfy the planned rehearsal distribution', async () => {
    const seedSet = await loadValidationDevnetSeedFlips({seedFlipCount: 27})

    expect(seedSet.source).toBeTruthy()
    expect(seedSet.flips).toHaveLength(27)
    expect(
      seedSet.flips.filter((flip) => Number(flip?.consensusVotes?.total) > 0)
        .length
    ).toBeGreaterThanOrEqual(9)
    expect(
      seedSet.flips.filter(
        (flip) => Array.isArray(flip?.words) && flip.words.length >= 2
      ).length
    ).toBeGreaterThan(0)
  })

  it('normalizes FLIP-Challenge hash prefixes in seed metadata maps', () => {
    expect(
      buildValidationDevnetSeedFlipMetaByHash([
        {
          hash: '_flip_bafyseed1',
          expectedAnswer: 'left',
          words: [
            {name: 'apple', desc: 'fruit'},
            {name: 'ghost', desc: 'spirit'},
          ],
        },
      ])
    ).toEqual({
      bafyseed1: expect.objectContaining({
        expectedAnswer: 'left',
        words: [
          {name: 'apple', desc: 'fruit'},
          {name: 'ghost', desc: 'spirit'},
        ],
      }),
    })
  })

  it('keeps rehearsal metadata under source and submitted flip hashes', () => {
    const sourceFlip = {
      hash: '_flip_bafyseed1',
      expectedAnswer: 'right',
      consensusVotes: {Left: 1, Right: 9, Reported: 0},
      words: [
        {name: 'apple', desc: 'fruit'},
        {name: 'ghost', desc: 'spirit'},
      ],
    }
    const submittedFlip = {
      ...sourceFlip,
      hash: '0xsubmittedhash',
      sourceHash: sourceFlip.hash,
    }
    const metaByHash = buildValidationDevnetSeedFlipMetaByHash([
      sourceFlip,
      submittedFlip,
    ])

    expect(metaByHash.bafyseed1).toEqual(
      expect.objectContaining({
        expectedAnswer: 'right',
        words: [
          {name: 'apple', desc: 'fruit'},
          {name: 'ghost', desc: 'spirit'},
        ],
      })
    )
    expect(metaByHash['0xsubmittedhash']).toEqual(metaByHash.bafyseed1)
  })

  it('keeps rehearsal keyword metadata when consensus labels are unavailable', () => {
    expect(
      buildValidationDevnetSeedFlipMetaByHash([
        {
          hash: '0xkeywords-only',
          words: [
            {name: 'office', desc: 'workplace'},
            {name: 'shoe', desc: 'footwear'},
          ],
        },
      ])
    ).toEqual({
      '0xkeywords-only': expect.objectContaining({
        expectedAnswer: null,
        words: [
          {name: 'office', desc: 'workplace'},
          {name: 'shoe', desc: 'footwear'},
        ],
      }),
    })
  })

  it('skips rehearsal seed flips that were already annotated in prior review runs', async () => {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'idena-devnet-seed-review-')
    )
    const validationResultsPath = path.join(tempDir, 'validationResults.json')
    const reviewedFlipHash = sampleSeedPayload.flips[0].hash

    try {
      await fs.writeJson(validationResultsPath, {
        'rehearsal-benchmark-annotations': {
          version: 1,
          annotationsByHash: {
            [reviewedFlipHash]: {
              status: 'match',
              note: 'already reviewed',
            },
          },
        },
      })

      const seedSet = await loadValidationDevnetSeedFlips({
        seedFile: path.join(
          __dirname,
          '..',
          'samples',
          'flips',
          'flip-challenge-test-5-decoded-labeled.json'
        ),
        seedFlipCount: 4,
        validationResultsPath,
      })

      expect(seedSet.flips).toHaveLength(4)
      expect(seedSet.flips.map(({hash}) => hash)).not.toContain(
        reviewedFlipHash
      )
    } finally {
      await fs.remove(tempDir)
    }
  })

  it('loads chunked seed manifests and merges their flip parts', async () => {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'idena-devnet-seed-manifest-')
    )
    const manifestPath = path.join(tempDir, 'seed-manifest.json')
    const partOnePath = path.join(tempDir, 'seed-manifest.part-1.json')
    const partTwoPath = path.join(tempDir, 'seed-manifest.part-2.json')

    try {
      const manifestFlips = sampleSeedPayload.flips
        .slice(0, 4)
        .map((flip, index) => ({
          ...flip,
          hash: `chunked-seed-${index + 1}`,
        }))

      await fs.writeJson(partOnePath, {
        source: sampleSeedPayload.source,
        split: sampleSeedPayload.split,
        count: 2,
        flips: manifestFlips.slice(0, 2),
      })
      await fs.writeJson(partTwoPath, {
        source: sampleSeedPayload.source,
        split: sampleSeedPayload.split,
        count: 2,
        flips: manifestFlips.slice(2, 4),
      })
      await fs.writeJson(manifestPath, {
        source: sampleSeedPayload.source,
        split: sampleSeedPayload.split,
        count: 4,
        parts: [
          {file: path.basename(partOnePath), count: 2},
          {file: path.basename(partTwoPath), count: 2},
        ],
      })

      const payload = await loadValidationDevnetSeedPayload(manifestPath)

      expect(payload.flips).toHaveLength(4)
      expect(payload.flips.map(({hash}) => hash)).toEqual(
        expect.arrayContaining(manifestFlips.map(({hash}) => hash))
      )
    } finally {
      await fs.remove(tempDir)
    }
  })
})
