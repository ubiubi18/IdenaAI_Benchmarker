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
        '0x1': {
          expectedAnswer: 'LEFT',
          expectedStrength: 'Strong',
          words: [{name: 'apple', desc: 'fruit'}],
        },
        '0x2': {expectedAnswer: 'unknown'},
        '': {expectedAnswer: 'right'},
      })
    ).toEqual({
      '0x1': {
        expectedAnswer: 'left',
        expectedStrength: 'Strong',
        words: [{name: 'apple', desc: 'fruit'}],
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
            words: [{name: 'apple', desc: 'fruit'}],
          },
          '0x2': {expectedAnswer: 'right', expectedStrength: 'Weak', words: []},
        }
      )
    ).toEqual([
      {
        hash: '0x1',
        expectedAnswer: 'left',
        expectedStrength: 'Strong',
        words: [{name: 'apple', desc: 'fruit'}],
      },
      {
        hash: '0x2',
        expectedAnswer: 'right',
        expectedStrength: 'Weak',
        words: [],
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

  it('computes benchmark summary and session split', () => {
    const validationState = {
      context: {
        shortFlips: [
          {hash: '0xa', option: 1, expectedAnswer: 'left'},
          {hash: '0xb', option: 2, expectedAnswer: 'left'},
          {hash: '0xc', option: 1, expectedAnswer: 'right', extra: true},
        ],
        longFlips: [
          {
            hash: '0xd',
            option: 2,
            expectedAnswer: 'right',
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
      sessions: {
        short: {total: 2, correct: 1},
        long: {total: 2, correct: 1},
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
