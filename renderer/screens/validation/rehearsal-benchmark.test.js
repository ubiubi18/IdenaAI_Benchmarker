/** @jest-environment jsdom */
import {persistState} from '../../shared/utils/persist'
import {
  buildRehearsalBenchmarkItems,
  buildRehearsalBenchmarkReviewStorageKey,
  computeRehearsalBenchmarkSummary,
  countReviewedRehearsalBenchmarkItems,
  getRehearsalBenchmarkAuditStatus,
  hasMissingRehearsalSeedMeta,
  loadRehearsalBenchmarkAnnotationDataset,
  loadRehearsalBenchmarkReview,
  mergeRehearsalSeedMetaIntoFlips,
  normalizeRehearsalSeedFlipMetaByHash,
  persistRehearsalBenchmarkAnnotationDataset,
  persistRehearsalBenchmarkReview,
} from './rehearsal-benchmark'

let validationResultsStoreState = {}

function createValidationResultsStore() {
  return {
    loadState() {
      return {...validationResultsStoreState}
    },
    loadValue(key) {
      return validationResultsStoreState[key] || null
    },
    persistItem(key, value) {
      if (value == null) {
        delete validationResultsStoreState[key]
      } else {
        validationResultsStoreState[key] = value
      }
    },
    persistState(state) {
      validationResultsStoreState = state ? {...state} : {}
    },
  }
}

describe('rehearsal benchmark helpers', () => {
  beforeEach(() => {
    validationResultsStoreState = {}
    window.idena = {
      storage: {
        validationResults: createValidationResultsStore(),
      },
    }
  })

  afterEach(() => {
    persistState('validationResults', null)
    delete window.idena
  })

  it('normalizes seed metadata by hash and removes invalid entries', () => {
    expect(
      normalizeRehearsalSeedFlipMetaByHash({
        _flip_bafyseed1: {
          expectedAnswer: 'LEFT',
          expectedStrength: 'Strong',
          consensusVotes: {Left: 7, Right: 2, Reported: 1},
          words: [{name: 'apple', desc: 'fruit'}],
          sourceStats: {epoch: 27, status: 'Qualified', longRespCount: 10},
        },
        '0x2': {expectedAnswer: 'unknown'},
        '': {expectedAnswer: 'right'},
      })
    ).toEqual({
      bafyseed1: {
        expectedAnswer: 'left',
        expectedStrength: 'Strong',
        consensusAnswer: 'left',
        consensusStrength: 'Strong',
        consensusVotes: {left: 7, right: 2, reported: 1, total: 10},
        words: [{name: 'apple', desc: 'fruit'}],
        sourceStats: {
          epoch: 27,
          author: null,
          status: 'Qualified',
          shortRespCount: null,
          longRespCount: 10,
          wrongWords: false,
          wrongWordsVotes: null,
          withPrivatePart: false,
          grade: null,
          gradeScore: null,
          createdAt: null,
          block: null,
          tx: null,
        },
        sourceDataset: null,
        sourceSplit: null,
      },
    })
  })

  it('merges rehearsal seed metadata into matching flips', () => {
    expect(
      mergeRehearsalSeedMetaIntoFlips(
        [{hash: '0x1'}, {hash: '0x2', expectedAnswer: 'right'}],
        {
          '0x1': {
            expectedAnswer: 'left',
            expectedStrength: 'Strong',
            consensusVotes: {Left: 7, Right: 2, Reported: 1},
            words: [{name: 'apple', desc: 'fruit'}],
            sourceStats: {epoch: 27, status: 'Qualified', longRespCount: 10},
          },
          '0x2': {expectedAnswer: 'right', expectedStrength: 'Weak', words: []},
        }
      )
    ).toEqual([
      {
        hash: '0x1',
        expectedAnswer: 'left',
        expectedStrength: 'Strong',
        consensusAnswer: 'left',
        consensusStrength: 'Strong',
        consensusVotes: {left: 7, right: 2, reported: 1, total: 10},
        words: [{name: 'apple', desc: 'fruit'}],
        sourceStats: {
          epoch: 27,
          author: null,
          status: 'Qualified',
          shortRespCount: null,
          longRespCount: 10,
          wrongWords: false,
          wrongWordsVotes: null,
          withPrivatePart: false,
          grade: null,
          gradeScore: null,
          createdAt: null,
          block: null,
          tx: null,
        },
        sourceDataset: null,
        sourceSplit: null,
      },
      {
        hash: '0x2',
        expectedAnswer: 'right',
        expectedStrength: 'Weak',
        consensusAnswer: 'right',
        consensusStrength: 'Weak',
        consensusVotes: null,
        words: [],
        sourceStats: null,
        sourceDataset: null,
        sourceSplit: null,
      },
    ])
  })

  it('detects flips that still miss rehearsal benchmark labels', () => {
    expect(
      hasMissingRehearsalSeedMeta([{hash: '0x1'}], {
        '0x1': {expectedAnswer: 'left'},
      })
    ).toBe(true)
  })

  it('detects flips that still miss rehearsal keyword words after hash normalization', () => {
    expect(
      hasMissingRehearsalSeedMeta(
        [{hash: 'bafyseed1', expectedAnswer: 'left', words: []}],
        {
          _flip_bafyseed1: {
            expectedAnswer: 'left',
            words: [
              {name: 'apple', desc: 'fruit'},
              {name: 'ghost', desc: 'spirit'},
            ],
          },
        }
      )
    ).toBe(true)
  })

  it('merges rehearsal seed words when metadata uses FLIP-Challenge hash prefixes', () => {
    expect(
      mergeRehearsalSeedMetaIntoFlips(
        [{hash: 'bafyseed1', expectedAnswer: 'left', words: []}],
        {
          _flip_bafyseed1: {
            expectedAnswer: 'left',
            words: [
              {name: 'apple', desc: 'fruit'},
              {name: 'ghost', desc: 'spirit'},
            ],
          },
        }
      )
    ).toEqual([
      expect.objectContaining({
        hash: 'bafyseed1',
        expectedAnswer: 'left',
        words: [
          {name: 'apple', desc: 'fruit'},
          {name: 'ghost', desc: 'spirit'},
        ],
      }),
    ])
  })

  it('merges rehearsal seed words even without benchmark answer labels', () => {
    expect(
      mergeRehearsalSeedMetaIntoFlips([{hash: '0x1', words: []}], {
        '0x1': {
          words: [
            {name: 'apple', desc: 'fruit'},
            {name: 'ghost', desc: 'spirit'},
          ],
        },
      })
    ).toEqual([
      expect.objectContaining({
        hash: '0x1',
        expectedAnswer: null,
        words: [
          {name: 'apple', desc: 'fruit'},
          {name: 'ghost', desc: 'spirit'},
        ],
      }),
    ])
  })

  it('does not keep requesting answer labels for words-only rehearsal metadata', () => {
    expect(
      hasMissingRehearsalSeedMeta(
        [
          {
            hash: '0x1',
            expectedAnswer: null,
            words: [
              {name: 'apple', desc: 'fruit'},
              {name: 'ghost', desc: 'spirit'},
            ],
          },
        ],
        {
          '0x1': {
            words: [
              {name: 'apple', desc: 'fruit'},
              {name: 'ghost', desc: 'spirit'},
            ],
          },
        }
      )
    ).toBe(false)
  })

  it('computes benchmark summary and session split', () => {
    const validationState = {
      context: {
        shortFlips: [
          {
            hash: '0xa',
            option: 1,
            expectedAnswer: 'left',
            words: [
              {name: 'apple', desc: 'fruit'},
              {name: 'ghost', desc: ''},
            ],
          },
          {hash: '0xb', option: 2, expectedAnswer: 'left'},
          {hash: '0xc', option: 1, expectedAnswer: 'right', extra: true},
        ],
        longFlips: [
          {
            hash: '0xd',
            option: 2,
            expectedAnswer: 'right',
            consensusVotes: {left: 1, right: 5, total: 6},
            sourceStats: {status: 'Qualified', longRespCount: 6},
            relevance: 2,
          },
          {hash: '0xe', expectedAnswer: 'left'},
        ],
      },
    }

    expect(buildRehearsalBenchmarkItems(validationState)).toHaveLength(4)

    expect(computeRehearsalBenchmarkSummary(validationState)).toMatchObject({
      available: true,
      total: 4,
      answered: 3,
      correct: 2,
      incorrect: 1,
      unanswered: 1,
      reported: 1,
      rawConsensusAvailable: true,
      keywordReady: {
        total: 1,
        coverage: 0.25,
      },
      sourceStatsReady: {
        total: 1,
        coverage: 0.25,
      },
      consensusBacked: {
        total: 1,
        correct: 1,
        coverage: 0.25,
      },
      sessions: {
        short: {
          total: 2,
          correct: 1,
          keywordReady: 1,
          sourceStatsReady: 0,
          consensusBacked: {total: 0, correct: 0},
        },
        long: {
          total: 2,
          correct: 1,
          keywordReady: 0,
          sourceStatsReady: 1,
          consensusBacked: {total: 1, correct: 1},
        },
      },
    })
  })

  it('persists and reloads rehearsal benchmark review notes', () => {
    const scope = {
      epoch: 42,
      address: '0xabc',
      nodeScope: 'external:http://127.0.0.1:22301',
      validationStart: 1710000000000,
    }
    const key = buildRehearsalBenchmarkReviewStorageKey(scope)

    persistRehearsalBenchmarkReview(scope, {
      annotationsByHash: {
        '0x1': {
          status: 'match',
          reportStatus: 'ok',
          note: 'Looks good',
        },
      },
    })

    expect(key).toContain('rehearsal-benchmark-review')
    expect(loadRehearsalBenchmarkReview(scope)).toMatchObject({
      auditStatus: '',
      annotationsByHash: {
        '0x1': {
          status: 'match',
          reportStatus: 'ok',
          note: 'Looks good',
        },
      },
    })
  })

  it('counts reviewed items from saved annotations', () => {
    expect(
      countReviewedRehearsalBenchmarkItems(
        {
          annotationsByHash: {
            '0x1': {status: 'match'},
            '0x2': {note: 'ambiguous'},
            '0x3': {},
          },
        },
        [{hash: '0x1'}, {hash: '0x2'}, {hash: '0x3'}]
      )
    ).toBe(2)
  })

  it('derives pending, skipped, in-progress, and completed audit states', () => {
    const items = [{hash: '0x1'}, {hash: '0x2'}]

    expect(getRehearsalBenchmarkAuditStatus({}, items)).toBe('pending')

    expect(
      getRehearsalBenchmarkAuditStatus({auditStatus: 'skipped'}, items)
    ).toBe('skipped')

    expect(
      getRehearsalBenchmarkAuditStatus(
        {
          annotationsByHash: {
            '0x1': {status: 'match'},
          },
        },
        items
      )
    ).toBe('in_progress')

    expect(
      getRehearsalBenchmarkAuditStatus(
        {
          annotationsByHash: {
            '0x1': {status: 'match'},
            '0x2': {reportStatus: 'ok'},
          },
        },
        items
      )
    ).toBe('completed')
  })

  it('stores reviewed rehearsal benchmark flips in a reusable annotation corpus', () => {
    persistRehearsalBenchmarkAnnotationDataset({
      scope: {
        epoch: 42,
        validationStart: 1710000000000,
      },
      items: [
        {
          hash: '0x1',
          expectedAnswer: 'left',
          expectedStrength: 'Strong',
          selectedAnswer: 'right',
          sessionType: 'short',
          reported: true,
        },
        {
          hash: '0x2',
          expectedAnswer: 'right',
          selectedAnswer: 'right',
          sessionType: 'long',
        },
      ],
      reviewState: {
        annotationsByHash: {
          '0x1': {
            status: 'mismatch',
            reportStatus: 'false_positive',
            note: 'The benchmark label is wrong here.',
          },
          '0x2': {},
        },
      },
    })

    expect(loadRehearsalBenchmarkAnnotationDataset()).toMatchObject({
      annotationsByHash: {
        '0x1': {
          hash: '0x1',
          epoch: 42,
          validationStart: 1710000000000,
          sessionType: 'short',
          expectedAnswer: 'left',
          expectedStrength: 'Strong',
          selectedAnswer: 'right',
          reported: true,
          status: 'mismatch',
          reportStatus: 'false_positive',
          note: 'The benchmark label is wrong here.',
        },
      },
    })
  })
})
