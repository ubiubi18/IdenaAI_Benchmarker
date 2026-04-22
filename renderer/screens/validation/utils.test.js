/** @jest-environment jsdom */
import {byId, merge, mergeById} from '../../shared/utils/utils'
import {
  createValidationMachine,
  getShortSessionFinalizeDelaySeconds,
  SHORT_SESSION_MIN_AI_SOLVE_WINDOW_SECONDS,
} from './machine'
import {
  __resetValidationSessionStateForTests,
  buildValidationIdentityScope,
  buildValidationSessionNodeScope,
  buildValidationSessionScopeKey,
  buildValidationStateScope,
  hasEnoughAnswers,
  exponentialBackoff,
  shouldTranslate,
  computeValidationCeremonyReadiness,
  getCurrentValidationSessionId,
  loadValidationState,
  loadValidationStateForPeriod,
  loadValidationStateByIdentityScope,
  pendingDecodeHashes,
  persistValidationState,
  rememberValidationSessionId,
  shouldDiscardPersistedValidationStateForIncompleteFetch,
  shouldDiscardPersistedValidationStateForPeriod,
  VALIDATION_NODE_STABILITY_GRACE_MS,
  canValidate,
  isValidationCeremonyPeriod,
  shouldPrepareValidationSession,
  shouldStartValidation,
  getValidationSessionPhaseDeadlineAt,
  getValidationSessionPhaseRemainingMs,
  getValidationAutoReportDelayMs,
  getShortSessionLongSessionTransitionAt,
  getShortSessionLongSessionTransitionDelayMs,
  isRenderableValidationFlip,
  hasRenderableValidationFlips,
  SHORT_SESSION_AUTO_SUBMIT_BUFFER_SECONDS,
  LONG_SESSION_AUTO_SUBMIT_BUFFER_SECONDS,
  AUTO_REPORT_REVIEW_RUNTIME_BUFFER_MS,
  SHORT_SESSION_RESULT_TELEMETRY_HOLD_MS,
  resetValidationSessionState,
} from './utils'
import {EpochPeriod, IdentityStatus} from '../../shared/types'

let validationSessionStoreState = {}

function createValidationSessionStore() {
  return {
    loadState() {
      return {...validationSessionStoreState}
    },
    loadValue(key) {
      return validationSessionStoreState[key] || null
    },
    persistItem(key, value) {
      if (value == null) {
        delete validationSessionStoreState[key]
      } else {
        validationSessionStoreState[key] = value
      }
    },
    persistState(state) {
      validationSessionStoreState = state ? {...state} : {}
    },
  }
}

function createPersistableValidationState({context = {}} = {}) {
  const {initialState} = createValidationMachine({
    epoch: context.epoch ?? 0,
    validationStart: Date.UTC(2026, 3, 21, 6, 35, 22),
    shortSessionDuration: 120,
    longSessionDuration: 300,
    validationSessionId: '',
    locale: 'en',
  })

  return {
    ...initialState,
    context: {
      ...initialState.context,
      ...context,
    },
    toJSON() {
      return {
        ...initialState.toJSON(),
        context: {
          ...initialState.context,
          ...context,
        },
      }
    },
  }
}

describe('hasEnoughAnswers', () => {
  it('falsy when no answers', () => {
    expect(hasEnoughAnswers([])).toBeFalsy()
  })
  it('falsy when answers are sort of undefineds', () => {
    expect(
      hasEnoughAnswers([
        {decoded: true, option: null},
        {decoded: true, option: undefined},
        {decoded: true},
      ])
    ).toBeFalsy()
  })
  it('truthy when all answered', () => {
    expect(
      hasEnoughAnswers([
        {decoded: true, option: 1},
        {decoded: true, option: 2},
        {decoded: true, option: 3},
      ])
    ).toBeTruthy()
  })
  it('falsy when there are not enough answers', () => {
    expect(
      hasEnoughAnswers([
        {decoded: true, option: 1},
        {decoded: true},
        {decoded: true},
      ])
    ).toBeFalsy()
  })
  it('truthy when there are enough answers', () => {
    expect(
      hasEnoughAnswers([
        {decoded: true, option: 1},
        {decoded: true, option: 1},
        {decoded: true},
      ])
    ).toBeTruthy()
  })
  it('truthy when there are enough answers filtering unsolvables', () => {
    expect(
      hasEnoughAnswers([
        {decoded: true, option: 1},
        {decoded: false, option: 1},
        {decoded: false},
      ])
    ).toBeTruthy()
  })
  it('falsy when there are not enough answers filtering unsolvables', () => {
    expect(
      hasEnoughAnswers([
        {decoded: true, option: 1},
        {decoded: true},
        {decoded: false},
      ])
    ).toBeFalsy()
  })
  it('truthy when exactly 60% answered', () => {
    expect(
      hasEnoughAnswers([
        {decoded: true, option: 1},
        {decoded: true, option: 1},
        {decoded: true, option: 1},
        {decoded: true},
        {decoded: true},
      ])
    ).toBeTruthy()
  })
  it('falsy when only extra flips are ready', () => {
    expect(
      hasEnoughAnswers([
        {decoded: false},
        {decoded: false},
        {decoded: false},
        {decoded: true, extra: true},
        {decoded: true, extra: true},
      ])
    ).toBeFalsy()
  })
  it('truthy when there are enough answers filtering extras', () => {
    expect(
      hasEnoughAnswers([
        {decoded: true, option: 1},
        {decoded: false},
        {decoded: false},
        {decoded: true, extra: true},
        {decoded: true, extra: true},
      ])
    ).toBeTruthy()
  })
  it('falsy when there are not enough answers filtering extras', () => {
    expect(
      hasEnoughAnswers([
        {decoded: true, option: 1},
        {decoded: true},
        {decoded: true},
        {decoded: true, extra: true},
        {decoded: true, extra: true},
      ])
    ).toBeFalsy()
  })
})

describe('exponentialBackoff', () => {
  it('works!', () => {
    ;[0, 1, 2, 3].forEach((n) => {
      expect(exponentialBackoff(n)).toBeLessThan(2 ** n + 1)
      expect(exponentialBackoff(n)).toBeGreaterThan(2 ** n)
    })
    expect(exponentialBackoff(10)).toBe(32)
  })
})

describe('pendingDecodeHashes', () => {
  it('retries ready flips that are still missing', () => {
    expect(
      pendingDecodeHashes([
        {hash: '0x1', ready: true, missing: true, decoded: false},
        {hash: '0x2', ready: true, missing: false, decoded: true},
      ])
    ).toEqual(['0x1'])
  })

  it('retries ready flips that were fetched but are still undecoded', () => {
    expect(
      pendingDecodeHashes([
        {hash: '0x1', ready: true, missing: false, decoded: false},
        {hash: '0x2', ready: true, missing: false, decoded: true},
        {hash: '0x3', ready: false, missing: false, decoded: false},
        {hash: '0x4', ready: true, missing: true, decoded: false, failed: true},
      ])
    ).toEqual(['0x1'])
  })
})

describe('isRenderableValidationFlip', () => {
  it('accepts decoded flips with images and orders', () => {
    expect(
      isRenderableValidationFlip({
        decoded: true,
        failed: false,
        images: ['blob:left', 'blob:right'],
        orders: [
          [0, 1, 2, 3],
          [0, 1, 2, 3],
        ],
      })
    ).toBe(true)
  })

  it('rejects loading and failed placeholder flips', () => {
    expect(
      isRenderableValidationFlip({
        decoded: false,
        images: ['blob:left'],
        orders: [[0, 1, 2, 3]],
      })
    ).toBe(false)

    expect(
      isRenderableValidationFlip({
        decoded: true,
        failed: true,
        images: ['blob:left'],
        orders: [[0, 1, 2, 3]],
      })
    ).toBe(false)
  })

  it('detects whether a session contains at least one renderable flip', () => {
    expect(
      hasRenderableValidationFlips([
        {
          decoded: false,
          images: ['blob:left'],
          orders: [[0, 1, 2, 3]],
        },
        {
          decoded: true,
          failed: false,
          images: ['blob:left', 'blob:right'],
          orders: [
            [0, 1, 2, 3],
            [0, 1, 2, 3],
          ],
        },
      ])
    ).toBe(true)

    expect(
      hasRenderableValidationFlips([
        {
          decoded: false,
          images: ['blob:left'],
          orders: [[0, 1, 2, 3]],
        },
      ])
    ).toBe(false)
  })
})

describe('resetValidationSessionState', () => {
  beforeEach(() => {
    __resetValidationSessionStateForTests()
    sessionStorage.clear()
  })

  it('clears persisted validation state and live session storage', () => {
    rememberValidationSessionId(
      buildValidationStateScope({
        epoch: 1,
        address: '0xabc',
        nodeScope: 'external:http://127.0.0.1:22301',
        validationStart: 1760000000000,
      }),
      'validation-1-demo'
    )
    persistValidationState(
      createPersistableValidationState({
        epoch: 1,
        validationSessionId: 'validation-1-demo',
      }),
      buildValidationStateScope({
        epoch: 1,
        address: '0xabc',
        nodeScope: 'external:http://127.0.0.1:22301',
        validationStart: 1760000000000,
      })
    )

    resetValidationSessionState()

    expect(getCurrentValidationSessionId()).toBe('')
    expect(loadValidationState()).toBeUndefined()
  })
})

describe('validation ceremony timing helpers', () => {
  const validationStart = Date.UTC(2026, 3, 21, 10, 0, 0)

  it('computes the short-session safe submit deadline', () => {
    expect(
      getValidationSessionPhaseDeadlineAt({
        validationStart,
        shortSessionDuration: 120,
        longSessionDuration: 300,
        sessionType: 'short',
      })
    ).toBe(
      validationStart + (120 - SHORT_SESSION_AUTO_SUBMIT_BUFFER_SECONDS) * 1000
    )
  })

  it('computes the long-session safe submit deadline', () => {
    expect(
      getValidationSessionPhaseDeadlineAt({
        validationStart,
        shortSessionDuration: 120,
        longSessionDuration: 300,
        sessionType: 'long',
      })
    ).toBe(
      validationStart +
        (120 + 300 - LONG_SESSION_AUTO_SUBMIT_BUFFER_SECONDS) * 1000
    )
  })

  it('reports remaining time against the current phase deadline', () => {
    expect(
      getValidationSessionPhaseRemainingMs({
        validationStart,
        shortSessionDuration: 120,
        longSessionDuration: 300,
        sessionType: 'short',
        now: validationStart + 45 * 1000,
      })
    ).toBe(65 * 1000)
  })

  it('caps auto-report delay against the remaining long-session window', () => {
    expect(
      getValidationAutoReportDelayMs({
        validationStart,
        shortSessionDuration: 120,
        longSessionDuration: 300,
        requestedDelayMinutes: 10,
        now: validationStart + (120 + 300 - 40) * 1000,
      })
    ).toBe(5 * 1000)
  })

  it('forces immediate auto-report when the remaining window is exhausted', () => {
    expect(
      getValidationAutoReportDelayMs({
        validationStart,
        shortSessionDuration: 120,
        longSessionDuration: 300,
        requestedDelayMinutes: 2,
        now:
          validationStart +
          (120 +
            300 -
            LONG_SESSION_AUTO_SUBMIT_BUFFER_SECONDS -
            AUTO_REPORT_REVIEW_RUNTIME_BUFFER_MS / 1000 +
            1) *
            1000,
      })
    ).toBe(0)
  })

  it('pulls short-session flip finalization earlier to preserve AI solve time', () => {
    expect(
      getShortSessionFinalizeDelaySeconds({
        shortSessionDuration: 120,
        configuredSeconds: 90,
      })
    ).toBe(120 - 10 - SHORT_SESSION_MIN_AI_SOLVE_WINDOW_SECONDS)
  })

  it('keeps a lower explicit finalize override when it is already earlier', () => {
    expect(
      getShortSessionFinalizeDelaySeconds({
        shortSessionDuration: 120,
        configuredSeconds: 50,
      })
    ).toBe(50)
  })
})

describe('shouldTranslate', () => {
  it('should not translate if both words have been translated already', () => {
    expect(
      shouldTranslate(
        {
          1: [{id: 10001, name: 't10001'}],
          2: [{id: 10001, name: 't10001'}],
        },
        {
          words: [
            {id: 1, name: '1'},
            {id: 2, name: '2'},
          ],
        }
      )
    ).toBeFalsy()
  })

  it('should not translate if words are nullish', () => {
    ;[{words: {}}, {words: []}, {words: null}, {words: undefined}].forEach(
      (flip) => expect(shouldTranslate(null, flip)).toBeFalsy()
    )
  })

  it('should translate if some word has missing translation, or both', () => {
    const flip = {
      words: [
        {id: 1, name: '1'},
        {id: 2, name: '2'},
      ],
    }
    expect(
      shouldTranslate(
        {
          1: [{id: 10001, name: 't10001'}],
        },
        flip
      )
    ).toBeTruthy()

    expect(shouldTranslate({}, flip)).toBeTruthy()

    expect(shouldTranslate({1: null}, flip)).toBeTruthy()

    expect(
      shouldTranslate(
        {
          1: null,
          2: undefined,
        },
        flip
      )
    ).toBeTruthy()
  })
})

describe('merge', () => {
  it('should merge multilple arrays consider predicate given', () => {
    const a = [
      {id: 1, name: 'a', foo: 'bar'},
      {id: 2, name: 'b'},
      {id: 3, name: 'c'},
    ]
    const b = [
      {id: 1, name: 'aa'},
      {id: 2, name: 'bb'},
      {id: 3, name: 'cc'},
    ]
    const c = [
      {id: 1, name: 'aaa'},
      {id: 2, name: 'bbb', foobar: 'foobar'},
      {id: 3, name: 'ccc'},
    ]
    const d = [
      {id: 1, name: 'aaaa', bar: 'foo'},
      {id: 2, name: 'bbbb'},
      {id: 3, name: 'cccc'},
    ]

    const merged = merge(byId)(a, b, c, d)

    expect(merged).toStrictEqual([
      {id: 1, name: 'aaaa', foo: 'bar', bar: 'foo'},
      {id: 2, name: 'bbbb', foobar: 'foobar'},
      {id: 3, name: 'cccc'},
    ])

    expect(
      merge(
        (x) =>
          ({hash}) =>
            hash === x.hash
      )(
        [{hash: 'a', foo: 'foo'}, {hash: 'b'}, {hash: 'c'}],
        [{hash: 'a', bar: 'bar'}, {hash: 'b'}, {hash: 'c'}],
        [{hash: 'a', foobar: 'foobar'}, {hash: 'b'}, {hash: 'c'}]
      )
    ).toStrictEqual([
      {hash: 'a', foo: 'foo', bar: 'bar', foobar: 'foobar'},
      {hash: 'b'},
      {hash: 'c'},
    ])
  })

  test('should handle empty array', () => {
    expect(
      mergeById(
        [],
        [
          {id: 1, name: 'a', foo: 'foo'},
          {id: 2, name: 'b'},
          {id: 3, name: 'c'},
        ],
        [
          {id: 1, name: 'a', bar: 'bar'},
          {id: 2, name: 'b'},
          {id: 3, name: 'c'},
        ]
      )
    ).toStrictEqual([
      {id: 1, name: 'a', foo: 'foo', bar: 'bar'},
      {id: 2, name: 'b'},
      {id: 3, name: 'c'},
    ])

    expect(
      mergeById(
        [
          {id: 1, name: 'a', foo: 'foo'},
          {id: 2, name: 'b'},
          {id: 3, name: 'c'},
        ],
        [],
        [
          {id: 1, name: 'a', bar: 'bar'},
          {id: 2, name: 'b'},
          {id: 3, name: 'c'},
        ]
      )
    ).toStrictEqual([
      {id: 1, name: 'a', foo: 'foo', bar: 'bar'},
      {id: 2, name: 'b'},
      {id: 3, name: 'c'},
    ])
  })
})

describe('computeValidationCeremonyReadiness', () => {
  const readyIdentity = {
    address: '0xabc',
    nonce: 7,
    mempoolNonce: 7,
  }

  it('blocks real validation auto-start in dev mode', () => {
    expect(
      computeValidationCeremonyReadiness({
        isDev: true,
        isValidationRunning: true,
        identity: readyIdentity,
      })
    ).toMatchObject({ready: false, reason: 'dev-mode-blocked'})
  })

  it('requires peers before reporting readiness', () => {
    expect(
      computeValidationCeremonyReadiness({
        identity: readyIdentity,
        stableSince: Date.now() - VALIDATION_NODE_STABILITY_GRACE_MS,
      })
    ).toMatchObject({ready: false, reason: 'no-peers'})
  })

  it('requires a stability grace period after sync', () => {
    expect(
      computeValidationCeremonyReadiness({
        peersCount: 2,
        identity: readyIdentity,
        stableSince: Date.now(),
        now: Date.now(),
      })
    ).toMatchObject({ready: false, reason: 'stabilizing'})
  })

  it('requires fresh account nonce state', () => {
    expect(
      computeValidationCeremonyReadiness({
        peersCount: 2,
        identity: {
          ...readyIdentity,
          nonce: 9,
          mempoolNonce: 8,
        },
        stableSince: Date.now() - VALIDATION_NODE_STABILITY_GRACE_MS - 1000,
        now: Date.now(),
      })
    ).toMatchObject({ready: false, reason: 'nonce-stale'})
  })

  it('reports ready once peers, stability window, and account state are healthy', () => {
    expect(
      computeValidationCeremonyReadiness({
        peersCount: 3,
        identity: readyIdentity,
        stableSince: Date.now() - VALIDATION_NODE_STABILITY_GRACE_MS - 1000,
        now: Date.now(),
      })
    ).toMatchObject({ready: true, reason: 'ready'})
  })
})

describe('validation session id persistence', () => {
  beforeEach(() => {
    validationSessionStoreState = {}
    window.idena = {
      storage: {
        validationSession: createValidationSessionStore(),
      },
    }
    window.sessionStorage.clear()
    __resetValidationSessionStateForTests()
  })

  afterEach(() => {
    delete window.idena
  })

  it('persists the same session id across renderer reloads for one epoch/node scope', () => {
    const scope = {
      epoch: 196,
      address: '0xabc',
      nodeScope: buildValidationSessionNodeScope({
        runInternalNode: true,
        internalPort: 9119,
      }),
    }

    const firstSessionId = rememberValidationSessionId(scope, 'session-1')

    __resetValidationSessionStateForTests({clearStorage: false})

    const secondSessionId = getCurrentValidationSessionId(scope)

    expect(secondSessionId).toBe(firstSessionId)
  })

  it('restores the same session id after a full app restart from durable validation storage', () => {
    const scope = {
      epoch: 196,
      address: '0xabc',
      nodeScope: buildValidationSessionNodeScope({
        runInternalNode: true,
        internalPort: 9119,
      }),
    }

    const firstSessionId = rememberValidationSessionId(scope, 'session-2')

    __resetValidationSessionStateForTests({clearStorage: false})
    window.sessionStorage.clear()

    const secondSessionId = getCurrentValidationSessionId(scope)

    expect(secondSessionId).toBe(firstSessionId)
  })

  it('keeps session ids isolated by epoch and node scope', () => {
    const internalScope = {
      epoch: 196,
      address: '0xabc',
      nodeScope: buildValidationSessionNodeScope({
        runInternalNode: true,
        internalPort: 9119,
      }),
    }

    const firstSessionId = rememberValidationSessionId(
      internalScope,
      'internal-session'
    )

    rememberValidationSessionId(
      {
        ...internalScope,
        epoch: 197,
      },
      'next-epoch-session'
    )

    rememberValidationSessionId(
      {
        ...internalScope,
        nodeScope: buildValidationSessionNodeScope({
          useExternalNode: true,
          url: 'http://127.0.0.1:9119',
        }),
      },
      'external-session'
    )

    const nextEpochSessionId = getCurrentValidationSessionId({
      ...internalScope,
      epoch: 197,
    })
    const externalSessionId = getCurrentValidationSessionId({
      ...internalScope,
      nodeScope: buildValidationSessionNodeScope({
        useExternalNode: true,
        url: 'http://127.0.0.1:9119',
      }),
    })

    expect(nextEpochSessionId).not.toBe(firstSessionId)
    expect(externalSessionId).not.toBe(firstSessionId)
  })

  it('keeps session ids isolated across fresh rehearsal runs on the same rpc endpoint', () => {
    const rehearsalNodeScope = buildValidationSessionNodeScope({
      useExternalNode: true,
      url: 'http://127.0.0.1:22301',
    })
    const firstRunScope = {
      epoch: 196,
      address: '0xabc',
      nodeScope: rehearsalNodeScope,
      validationStart: Date.UTC(2026, 3, 21, 15, 20, 0),
    }
    const secondRunScope = {
      ...firstRunScope,
      validationStart: Date.UTC(2026, 3, 21, 15, 28, 0),
    }

    const firstSessionId = rememberValidationSessionId(
      firstRunScope,
      'rehearsal-session-1'
    )
    const secondSessionId = getCurrentValidationSessionId(secondRunScope)

    expect(firstSessionId).toBe('rehearsal-session-1')
    expect(secondSessionId).toBe('')
  })

  it('clears a stale live validation session when the rehearsal identity scope changes', () => {
    const rehearsalNodeScope = buildValidationSessionNodeScope({
      useExternalNode: true,
      url: 'http://127.0.0.1:22301',
    })
    const previousRunScope = {
      epoch: 1,
      address: '0xb85a4ee48df845078ea3029350cb09ace7723bad',
      nodeScope: rehearsalNodeScope,
      validationStart: Date.UTC(2026, 3, 21, 19, 3, 5),
    }
    const currentRunScope = {
      epoch: 1,
      address: '0x2f8d9d30d163aec7a0a71f6e1a484dfd8d33f991',
      nodeScope: rehearsalNodeScope,
      validationStart: Date.UTC(2026, 3, 21, 19, 3, 5),
    }

    rememberValidationSessionId(previousRunScope, 'stale-session')

    expect(getCurrentValidationSessionId(currentRunScope)).toBe('')
    expect(window.idena.storage.validationSession.loadState()).toEqual({})
  })

  it('does not invent a renderer-owned session id before the node prepares one', () => {
    const scope = {
      epoch: 196,
      address: '0xabc',
      nodeScope: buildValidationSessionNodeScope({
        runInternalNode: true,
        internalPort: 9119,
      }),
    }

    expect(getCurrentValidationSessionId(scope)).toBe('')
  })

  it('builds a deterministic scope key from epoch, address, and node scope', () => {
    expect(
      buildValidationSessionScopeKey({
        epoch: 196,
        address: '0xAbC',
        nodeScope: 'internal:9119',
      })
    ).toBe('196:0xabc:internal:9119')
  })

  it('includes validationStart in the scope key when provided', () => {
    expect(
      buildValidationSessionScopeKey({
        epoch: 196,
        address: '0xAbC',
        nodeScope: 'external:http://127.0.0.1:22301',
        validationStart: Date.UTC(2026, 3, 21, 15, 20, 0),
      })
    ).toBe(
      `196:0xabc:external:http://127.0.0.1:22301:${Date.UTC(
        2026,
        3,
        21,
        15,
        20,
        0
      )}`
    )
  })
})

describe('canValidate', () => {
  it('accepts rehearsal identities that expose madeFlips but null flips arrays', () => {
    expect(
      canValidate({
        state: IdentityStatus.Verified,
        requiredFlips: 3,
        availableFlips: 4,
        flips: null,
        flipsWithPair: null,
        madeFlips: 3,
      })
    ).toBe(true)
  })

  it('accepts rehearsal identities even if normal invite activation is incomplete', () => {
    expect(
      canValidate(
        {
          state: IdentityStatus.Invite,
          requiredFlips: 0,
          flips: [],
        },
        {isRehearsalNodeSession: true}
      )
    ).toBe(true)
  })
})

describe('scoped validation state persistence', () => {
  beforeEach(() => {
    validationSessionStoreState = {}
    window.idena = {
      storage: {
        validationSession: createValidationSessionStore(),
      },
    }
    window.sessionStorage.clear()
    __resetValidationSessionStateForTests()
  })

  afterEach(() => {
    delete window.idena
  })

  it('restores a persisted validation snapshot only when the scope matches', () => {
    const scope = buildValidationStateScope({
      epoch: 0,
      address: '0xabc',
      nodeScope: 'external:http://127.0.0.1:22301',
      validationStart: Date.UTC(2026, 3, 21, 6, 35, 22),
    })

    persistValidationState(
      createPersistableValidationState({
        context: {
          epoch: 0,
          reports: new Set(['0xflip']),
        },
      }),
      scope
    )

    const restoredState = loadValidationState(scope)

    expect(restoredState?.context?.epoch).toBe(0)
    expect(restoredState?.context?.reports instanceof Set).toBe(true)
    expect(Array.from(restoredState?.context?.reports || [])).toEqual([
      '0xflip',
    ])
    expect(restoredState?.children).toEqual({})
  })

  it('persists only the minimal serializable validation snapshot fields', () => {
    const scope = buildValidationStateScope({
      epoch: 0,
      address: '0xabc',
      nodeScope: 'external:http://127.0.0.1:22301',
      validationStart: Date.UTC(2026, 3, 21, 6, 35, 22),
    })

    persistValidationState(
      {
        ...createPersistableValidationState({
          context: {
            epoch: 0,
            reports: new Set(['0xflip']),
          },
        }),
        toJSON() {
          return {
            value: {shortSession: {fetch: 'done'}},
            context: {
              epoch: 0,
              reports: ['0xflip'],
            },
            event: {type: 'RESTORE'},
            _event: {name: 'RESTORE'},
            _sessionid: 'x:1',
            done: false,
            changed: true,
            historyValue: {current: 'shortSession'},
            activities: {
              noisy: {
                activity: {
                  onDone: [{type: 'xstate.assign'}],
                },
              },
            },
            children: {
              noisy: {},
            },
            tags: ['debug'],
          }
        },
      },
      scope
    )

    expect(validationSessionStoreState.validationStateSnapshot).toEqual({
      value: {shortSession: {fetch: 'done'}},
      event: {type: 'RESTORE'},
      _event: {
        name: 'RESTORE',
        data: {type: 'RESTORE'},
        $$type: 'scxml',
        type: 'external',
      },
      context: {
        epoch: 0,
        shortFlips: [],
        longFlips: [],
        reports: ['0xflip'],
      },
      done: false,
      historyValue: {current: 'shortSession'},
    })
  })

  it('normalizes legacy persisted snapshots that are missing xstate event metadata', () => {
    const scope = buildValidationStateScope({
      epoch: 0,
      address: '0xabc',
      nodeScope: 'external:http://127.0.0.1:22301',
      validationStart: Date.UTC(2026, 3, 21, 6, 35, 22),
    })

    validationSessionStoreState = {
      validationStateMeta: scope,
      validationStateSnapshot: {
        value: 'shortSession',
        context: {
          epoch: 0,
          reports: ['0xflip'],
        },
        done: false,
      },
    }

    const restoredState = loadValidationState(scope)

    expect(restoredState?.event).toEqual({type: 'RESTORE'})
    expect(restoredState?._event).toEqual({
      name: 'RESTORE',
      data: {type: 'RESTORE'},
      $$type: 'scxml',
      type: 'external',
    })
    expect(Array.from(restoredState?.context?.reports || [])).toEqual([
      '0xflip',
    ])
  })

  it('drops a stale validation snapshot when a different node/session scope is active', () => {
    const scope = buildValidationStateScope({
      epoch: 0,
      address: '0xabc',
      nodeScope: 'external:http://127.0.0.1:22301',
      validationStart: Date.UTC(2026, 3, 21, 6, 35, 22),
    })

    rememberValidationSessionId(
      {
        epoch: 0,
        address: '0xabc',
        nodeScope: 'external:http://127.0.0.1:22301',
      },
      'session-keep'
    )

    persistValidationState(
      createPersistableValidationState({
        context: {
          epoch: 0,
          reports: new Set(),
        },
      }),
      scope
    )

    const restoredState = loadValidationState(
      buildValidationStateScope({
        epoch: 0,
        address: '0xabc',
        nodeScope: 'external:http://127.0.0.1:22301',
        validationStart: Date.UTC(2026, 3, 21, 7, 35, 22),
      })
    )

    expect(restoredState).toBeUndefined()
    expect(validationSessionStoreState.validationStateSnapshot).toBeUndefined()
    expect(
      getCurrentValidationSessionId({
        epoch: 0,
        address: '0xabc',
        nodeScope: 'external:http://127.0.0.1:22301',
      })
    ).toBe('session-keep')
  })

  it('restores validation state by node/address scope without requiring the same epoch metadata', () => {
    persistValidationState(
      createPersistableValidationState({
        context: {
          epoch: 0,
          reports: new Set(['0xflip']),
        },
      }),
      buildValidationStateScope({
        epoch: 0,
        address: '0xabc',
        nodeScope: 'external:http://127.0.0.1:22301',
        validationStart: Date.UTC(2026, 3, 21, 6, 35, 22),
      })
    )

    const restoredState = loadValidationStateByIdentityScope(
      buildValidationIdentityScope({
        address: '0xabc',
        nodeScope: 'external:http://127.0.0.1:22301',
      })
    )

    expect(restoredState?.context?.epoch).toBe(0)
    expect(Array.from(restoredState?.context?.reports || [])).toEqual([
      '0xflip',
    ])
    expect(restoredState?.children).toEqual({})
  })

  it('drops persisted short-session state when the node already returned in long session', () => {
    const scope = buildValidationStateScope({
      epoch: 0,
      address: '0xabc',
      nodeScope: 'external:http://127.0.0.1:22301',
      validationStart: Date.UTC(2026, 3, 21, 6, 35, 22),
    })

    persistValidationState(
      createPersistableValidationState({
        context: {
          epoch: 0,
          reports: new Set(['0xflip']),
        },
      }),
      scope
    )

    expect(
      shouldDiscardPersistedValidationStateForPeriod(
        EpochPeriod.LongSession,
        loadValidationState(scope)
      )
    ).toBe(true)

    const restoredState = loadValidationStateForPeriod(
      EpochPeriod.LongSession,
      scope
    )

    expect(restoredState).toBeNull()
    expect(validationSessionStoreState.validationStateSnapshot).toBeUndefined()
  })

  it('sanitizes persisted blob-backed validation images so they refetch after restore', () => {
    const scope = buildValidationStateScope({
      epoch: 0,
      address: '0xabc',
      nodeScope: 'external:http://127.0.0.1:22301',
      validationStart: Date.UTC(2026, 3, 21, 6, 35, 22),
    })

    persistValidationState(
      createPersistableValidationState({
        context: {
          epoch: 0,
          shortFlips: [
            {
              hash: '0xshort',
              ready: true,
              fetched: true,
              decoded: true,
              failed: false,
              images: ['blob:left', 'blob:right'],
              orders: [
                [0, 1, 2, 3],
                [0, 1, 2, 3],
              ],
            },
          ],
        },
      }),
      scope
    )

    const restoredState = loadValidationState(scope)

    expect(restoredState.context.shortFlips[0]).toMatchObject({
      hash: '0xshort',
      ready: true,
      fetched: false,
      decoded: false,
      failed: false,
      images: [],
      orders: [],
    })
  })

  it('keeps persisted submitted short-session state during the telemetry hold after long-session starts', () => {
    const validationStart = Date.now() - 130 * 1000
    const scope = buildValidationStateScope({
      epoch: 0,
      address: '0xabc',
      nodeScope: 'external:http://127.0.0.1:22301',
      validationStart,
    })
    const persistedState = createPersistableValidationState({
      context: {
        epoch: 0,
        validationStart,
        shortFlips: [{hash: '0xshort'}],
        shortSessionDuration: 120,
        shortSessionSubmittedAt: Date.now() - 2000,
        reports: new Set(['0xflip']),
      },
    })

    persistValidationState(
      {
        ...persistedState,
        value: {
          shortSession: {
            fetch: 'done',
            solve: {
              nav: 'firstFlip',
              answer: {
                submitShortSession: 'submitted',
              },
            },
          },
        },
        toJSON() {
          return {
            ...persistedState.toJSON(),
            value: {
              shortSession: {
                fetch: 'done',
                solve: {
                  nav: 'firstFlip',
                  answer: {
                    submitShortSession: 'submitted',
                  },
                },
              },
            },
          }
        },
      },
      scope
    )

    expect(
      shouldDiscardPersistedValidationStateForPeriod(
        EpochPeriod.LongSession,
        loadValidationState(scope)
      )
    ).toBe(false)

    const restoredState = loadValidationStateForPeriod(
      EpochPeriod.LongSession,
      scope
    )

    expect(
      restoredState.matches(
        'shortSession.solve.answer.submitShortSession.submitted'
      )
    ).toBe(true)
  })

  it('drops persisted long-session state when the node is still in short session', () => {
    const scope = buildValidationStateScope({
      epoch: 0,
      address: '0xabc',
      nodeScope: 'external:http://127.0.0.1:22301',
      validationStart: Date.UTC(2026, 3, 21, 6, 35, 22),
    })

    const persistedState = createPersistableValidationState({
      context: {
        epoch: 0,
        longFlips: [{hash: '0xlong'}],
        reports: new Set(['0xflip']),
      },
    })

    persistValidationState(
      {
        ...persistedState,
        value: {
          longSession: {
            fetch: {
              hashes: 'success',
              flips: {
                done: true,
              },
              done: true,
            },
            solve: {
              nav: 'firstFlip',
              answer: 'flips',
            },
          },
        },
        toJSON() {
          return {
            ...persistedState.toJSON(),
            value: {
              longSession: {
                fetch: {
                  hashes: 'success',
                  flips: {
                    done: true,
                  },
                  done: true,
                },
                solve: {
                  nav: 'firstFlip',
                  answer: 'flips',
                },
              },
            },
          }
        },
      },
      scope
    )

    expect(
      shouldDiscardPersistedValidationStateForPeriod(
        EpochPeriod.ShortSession,
        loadValidationState(scope)
      )
    ).toBe(true)

    const restoredState = loadValidationStateForPeriod(
      EpochPeriod.ShortSession,
      scope
    )

    expect(restoredState).toBeNull()
    expect(validationSessionStoreState.validationStateSnapshot).toBeUndefined()
  })

  it('drops persisted validation state outside the active ceremony phases', () => {
    const scope = buildValidationStateScope({
      epoch: 0,
      address: '0xabc',
      nodeScope: 'external:http://127.0.0.1:22301',
      validationStart: Date.UTC(2026, 3, 21, 6, 35, 22),
    })

    persistValidationState(
      createPersistableValidationState({
        context: {
          epoch: 0,
          shortFlips: [{hash: '0xshort'}],
        },
      }),
      scope
    )

    expect(
      shouldDiscardPersistedValidationStateForPeriod(
        EpochPeriod.FlipLottery,
        loadValidationState(scope)
      )
    ).toBe(true)

    const restoredState = loadValidationStateForPeriod(
      EpochPeriod.FlipLottery,
      scope
    )

    expect(restoredState).toBeNull()
    expect(validationSessionStoreState.validationStateSnapshot).toBeUndefined()
  })

  it('drops persisted in-flight short-session fetch state when no hashes were ever loaded', () => {
    const scope = buildValidationStateScope({
      epoch: 0,
      address: '0xabc',
      nodeScope: 'external:http://127.0.0.1:22301',
      validationStart: Date.UTC(2026, 3, 21, 6, 35, 22),
    })

    const persistedState = createPersistableValidationState({
      context: {
        epoch: 0,
        shortFlips: [],
        reports: new Set(),
      },
    })

    persistValidationState(
      {
        ...persistedState,
        value: {
          shortSession: {
            fetch: {
              polling: {
                fetchHashes: 'fetching',
                fetchFlips: 'check',
              },
            },
            solve: {
              nav: 'firstFlip',
              answer: 'normal',
            },
          },
        },
        toJSON() {
          return {
            ...persistedState.toJSON(),
            value: {
              shortSession: {
                fetch: {
                  polling: {
                    fetchHashes: 'fetching',
                    fetchFlips: 'check',
                  },
                },
                solve: {
                  nav: 'firstFlip',
                  answer: 'normal',
                },
              },
            },
          }
        },
      },
      scope
    )

    const restoredState = loadValidationStateForPeriod(
      EpochPeriod.ShortSession,
      scope
    )

    expect(restoredState).toBeNull()
    expect(validationSessionStoreState.validationStateSnapshot).toBeUndefined()
  })
})

describe('shouldDiscardPersistedValidationStateForIncompleteFetch', () => {
  it('keeps non-fetch states intact', () => {
    expect(
      shouldDiscardPersistedValidationStateForIncompleteFetch({
        matches: () => false,
        context: {},
      })
    ).toBe(false)
  })
})

describe('shouldPrepareValidationSession', () => {
  const candidateIdentity = {state: 'Verified', requiredFlips: 0, flips: []}

  it('prepares validation sessions during flip lottery and validation periods', () => {
    expect(
      shouldPrepareValidationSession(
        {currentPeriod: EpochPeriod.FlipLottery},
        candidateIdentity
      )
    ).toBe(true)
    expect(
      shouldPrepareValidationSession(
        {currentPeriod: EpochPeriod.ShortSession},
        candidateIdentity
      )
    ).toBe(true)
    expect(
      shouldPrepareValidationSession(
        {currentPeriod: EpochPeriod.LongSession},
        candidateIdentity
      )
    ).toBe(true)
  })

  it('does not prepare sessions outside ceremony periods', () => {
    expect(
      shouldPrepareValidationSession(
        {currentPeriod: EpochPeriod.AfterLongSession},
        candidateIdentity
      )
    ).toBe(false)
  })

  it('prepares rehearsal sessions even for invite-only rehearsal identities', () => {
    expect(
      shouldPrepareValidationSession(
        {currentPeriod: EpochPeriod.FlipLottery},
        {
          state: IdentityStatus.Invite,
          requiredFlips: 0,
          flips: [],
        },
        {isRehearsalNodeSession: true}
      )
    ).toBe(true)
  })
})

describe('shouldStartValidation', () => {
  it('starts rehearsal validation during ceremony even for invite-only rehearsal identities', () => {
    expect(
      shouldStartValidation(
        {epoch: 42, currentPeriod: EpochPeriod.ShortSession},
        {
          state: IdentityStatus.Invite,
          requiredFlips: 0,
          flips: [],
        },
        null,
        {isRehearsalNodeSession: true}
      )
    ).toBe(true)
  })
})

describe('isValidationCeremonyPeriod', () => {
  it('accepts only short and long validation phases', () => {
    expect(isValidationCeremonyPeriod(EpochPeriod.ShortSession)).toBe(true)
    expect(isValidationCeremonyPeriod(EpochPeriod.LongSession)).toBe(true)
    expect(isValidationCeremonyPeriod(EpochPeriod.FlipLottery)).toBe(false)
    expect(isValidationCeremonyPeriod(EpochPeriod.AfterLongSession)).toBe(false)
    expect(isValidationCeremonyPeriod(EpochPeriod.None)).toBe(false)
  })
})

describe('createValidationMachine initial period', () => {
  it('can start directly in long session when opened after short session', () => {
    global.env = {
      ...(global.env || {}),
      FINALIZE_LONG_FLIPS: 4 * 60,
    }

    const machine = createValidationMachine({
      epoch: 1,
      validationStart: Date.UTC(2026, 3, 21, 6, 35, 22),
      shortSessionDuration: 120,
      longSessionDuration: 300,
      validationSessionId: '',
      locale: 'en',
      initialValidationPeriod: 'long',
    })

    expect(machine.initialState.matches('longSession')).toBe(true)
  })
})

describe('short-session long-session transition hold', () => {
  it('waits until both the long-session boundary and the telemetry hold are satisfied', () => {
    const validationStart = Date.now() - 125 * 1000
    const submittedAt = Date.now() - 2000

    const transitionAt = getShortSessionLongSessionTransitionAt({
      validationStart,
      shortSessionDuration: 120,
      shortSessionSubmittedAt: submittedAt,
    })

    expect(transitionAt).toBe(
      submittedAt + SHORT_SESSION_RESULT_TELEMETRY_HOLD_MS
    )
    expect(
      getShortSessionLongSessionTransitionDelayMs({
        validationStart,
        shortSessionDuration: 120,
        shortSessionSubmittedAt: submittedAt,
      })
    ).toBeGreaterThan(0)
  })

  it('switches immediately once the hold already elapsed after the long-session boundary', () => {
    const validationStart = Date.now() - 130 * 1000
    const submittedAt = Date.now() - 10 * 1000

    expect(
      getShortSessionLongSessionTransitionDelayMs({
        validationStart,
        shortSessionDuration: 120,
        shortSessionSubmittedAt: submittedAt,
      })
    ).toBe(0)
  })
})
