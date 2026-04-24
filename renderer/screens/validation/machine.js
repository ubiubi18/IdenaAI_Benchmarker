import {assign, createMachine} from 'xstate'
import {decode} from 'rlp'
import {choose, log, send} from 'xstate/lib/actions'
import dayjs from 'dayjs'
import {
  fetchFlipHashes,
  submitShortAnswers,
  submitLongAnswers,
} from '../../shared/api/validation'
import {FlipGrade, RelevanceType, SessionType} from '../../shared/types'
import {fetchFlip} from '../../shared/api/dna'
import apiClient from '../../shared/api/api-client'
import {
  filterRegularFlips,
  filterReadyFlips,
  filterSolvableFlips,
  flipExtraFlip,
  readyNotFetchedFlip,
  availableExtraFlip,
  failedFlip,
  hasEnoughAnswers,
  pendingDecodeHashes,
  exponentialBackoff,
  shouldTranslate,
  shouldPollLongFlips,
  readyFlip,
  availableReportsNumber,
  getShortSessionLongSessionTransitionDelayMs,
  SHORT_SESSION_AUTO_SUBMIT_BUFFER_SECONDS,
  LONG_SESSION_AUTO_SUBMIT_BUFFER_SECONDS,
} from './utils'
import {forEachAsync, wait} from '../../shared/utils/fn'
import {fetchConfirmedKeywordTranslations} from '../flips/utils'
import {loadKeyword} from '../../shared/utils/utils'
import {mergeRehearsalSeedMetaIntoFlips} from './rehearsal-benchmark'

export const SHORT_SESSION_MIN_AI_SOLVE_WINDOW_SECONDS = 45

export function getShortSessionFinalizeDelaySeconds({
  shortSessionDuration,
  configuredSeconds = 90,
} = {}) {
  const requestedSeconds = Number(configuredSeconds)
  const normalizedRequestedSeconds = Number.isFinite(requestedSeconds)
    ? requestedSeconds
    : 90
  const durationSeconds = Number(shortSessionDuration)

  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return normalizedRequestedSeconds
  }

  const latestSafeFinalizeSeconds =
    durationSeconds -
    SHORT_SESSION_AUTO_SUBMIT_BUFFER_SECONDS -
    SHORT_SESSION_MIN_AI_SOLVE_WINDOW_SECONDS

  return Math.max(
    5,
    Math.min(normalizedRequestedSeconds, latestSafeFinalizeSeconds)
  )
}

export const createValidationMachine = ({
  epoch,
  validationStart,
  shortSessionDuration,
  longSessionDuration,
  validationSessionId = '',
  initialValidationPeriod = SessionType.Short,
  locale,
  onDecodedFlip,
  initialShortFlips = [],
  initialLongFlips = [],
}) =>
  createMachine(
    {
      predictableActionArguments: true,
      id: 'validation',
      initial:
        String(initialValidationPeriod || '')
          .trim()
          .toLowerCase() === SessionType.Long
          ? 'longSession'
          : 'shortSession',
      context: {
        shortFlips: initialShortFlips,
        longFlips: initialLongFlips,
        currentIndex: 0,
        bestFlipHashes: {},
        epoch,
        validationSessionId,
        validationStart,
        shortSessionDuration,
        longSessionDuration,
        errorMessage: null,
        retries: 0,
        locale,
        translations: {},
        reports: new Set(),
        submitLongAnswersHash: null,
        shortSessionSubmittedAt: null,
      },
      on: {
        SET_VALIDATION_SESSION_ID: {
          actions: assign({
            validationSessionId: (_, {sessionId}) => String(sessionId || ''),
          }),
        },
        MERGE_REHEARSAL_BENCHMARK_META: {
          actions: assign({
            shortFlips: ({shortFlips}, {metaByHash}) =>
              mergeRehearsalSeedMetaIntoFlips(shortFlips, metaByHash),
            longFlips: ({longFlips}, {metaByHash}) =>
              mergeRehearsalSeedMetaIntoFlips(longFlips, metaByHash),
          }),
        },
      },
      states: {
        shortSession: {
          entry: log('VALIDATION STARTED!'),
          type: 'parallel',
          states: {
            fetch: {
              entry: log('Start fetching short flips'),
              initial: 'prepare',
              states: {
                prepare: {
                  always: [
                    {target: 'done', cond: 'didFetchShortFlips'},
                    {target: 'polling'},
                  ],
                },
                polling: {
                  type: 'parallel',
                  states: {
                    fetchHashes: {
                      initial: 'fetching',
                      states: {
                        fetching: {
                          entry: log('Fetching short hashes'),
                          invoke: {
                            src: 'fetchShortHashes',
                            onDone: {
                              target: 'check',
                              actions: [
                                assign({
                                  shortFlips: ({shortFlips}, {data}) =>
                                    shortFlips.length
                                      ? mergeFlipsByHash(
                                          shortFlips,
                                          data.filter(({hash}) =>
                                            shortFlips.find(
                                              (f) =>
                                                f.hash === hash && !f.flipped
                                            )
                                          )
                                        )
                                      : mergeFlipsByHash(data, shortFlips),
                                }),
                                log(),
                              ],
                            },
                            onError: {
                              target: 'check',
                              actions: log(),
                            },
                          },
                        },
                        check: {
                          after: {
                            5000: [
                              {
                                target: '#validation.shortSession.fetch.done',
                                cond: 'didFetchShortFlips',
                              },
                              {target: 'fetching'},
                            ],
                          },
                        },
                      },
                    },
                    fetchFlips: {
                      initial: 'fetching',
                      states: {
                        fetching: {
                          invoke: {
                            src: 'fetchShortFlips',
                            onDone: {
                              target: 'check',
                              actions: [
                                assign({
                                  retries: ({retries}) => retries + 1,
                                }),
                              ],
                            },
                          },
                          on: {
                            FLIP: {
                              actions: [
                                assign({
                                  shortFlips: ({shortFlips, retries}, {flip}) =>
                                    mergeFlipsByHash(shortFlips, [
                                      {
                                        ...flip,
                                        retries,
                                        relevance: RelevanceType.Abstained,
                                      },
                                    ]),
                                }),
                                log(),
                              ],
                            },
                          },
                        },
                        check: {
                          entry: log(),
                          after: {
                            1000: [
                              {
                                target: '#validation.shortSession.fetch.done',
                                cond: 'didFetchShortFlips',
                              },
                              {target: 'fetching'},
                            ],
                          },
                        },
                      },
                    },
                  },
                },
                extraFlips: {
                  entry: log('bump extra flips'),
                  invoke: {
                    src:
                      ({shortFlips}) =>
                      (cb) => {
                        const extraFlips = shortFlips.filter(availableExtraFlip)
                        const replacingFlips = shortFlips.filter(failedFlip)
                        cb({
                          type: 'EXTRA_FLIPS_PULLED',
                          flips:
                            extraFlips.length >= replacingFlips.length
                              ? replacingFlips
                                  .map(flipExtraFlip)
                                  .concat(
                                    extraFlips
                                      .slice(0, replacingFlips.length)
                                      .map(flipExtraFlip)
                                  )
                              : replacingFlips
                                  .slice(0, extraFlips.length)
                                  .map(flipExtraFlip)
                                  .concat(extraFlips.map(flipExtraFlip)),
                        })
                      },
                  },
                  on: {
                    EXTRA_FLIPS_PULLED: {
                      target: 'polling',
                      actions: [
                        assign({
                          shortFlips: ({shortFlips}, {flips}) =>
                            mergeFlipsByHash(shortFlips, flips),
                        }),
                        log(),
                      ],
                    },
                  },
                },
                done: {type: 'final', entry: log('Fetching short flips done')},
              },
              on: {
                REFETCH_FLIPS: {
                  target: '#validation.shortSession.fetch.polling.fetchFlips',
                  actions: [
                    assign({
                      shortFlips: ({shortFlips}) =>
                        shortFlips.map((flip) => ({
                          ...flip,
                          fetched: false,
                          decoded: false,
                        })),
                    }),
                    log('Re-fetching flips after re-entering short session'),
                  ],
                },
              },
              after: {
                BUMP_EXTRA_FLIPS: {
                  target: '.extraFlips',
                  cond: ({shortFlips}) =>
                    shortFlips.some(failedFlip) &&
                    shortFlips.some(availableExtraFlip),
                },
                FINALIZE_FLIPS: {
                  target: '.done',
                  actions: [
                    assign({
                      shortFlips: ({shortFlips}) =>
                        mergeFlipsByHash(
                          shortFlips,
                          shortFlips.filter(failedFlip).map((flip) => ({
                            ...flip,
                            failed: true,
                          }))
                        ),
                    }),
                    log(),
                  ],
                },
              },
            },
            solve: {
              type: 'parallel',
              states: {
                nav: {
                  initial: 'firstFlip',
                  states: {
                    firstFlip: {},
                    normal: {},
                    lastFlip: {},
                  },
                  on: {
                    PREV: [
                      {
                        target: undefined,
                        cond: ({shortFlips}) =>
                          filterRegularFlips(shortFlips).length === 0,
                      },
                      {
                        target: '.normal',
                        cond: ({currentIndex}) => currentIndex > 1,
                        actions: [
                          assign({
                            currentIndex: ({currentIndex}) => currentIndex - 1,
                          }),
                          log(),
                        ],
                      },
                      {
                        target: '.firstFlip',
                        cond: ({currentIndex}) => currentIndex === 1,
                        actions: [
                          assign({
                            currentIndex: ({currentIndex}) => currentIndex - 1,
                          }),
                          log(),
                        ],
                      },
                    ],
                    NEXT: [
                      {
                        target: undefined,
                        cond: ({shortFlips}) =>
                          filterRegularFlips(shortFlips).length === 0,
                      },
                      {
                        target: '.lastFlip',
                        cond: ({currentIndex, shortFlips}) =>
                          currentIndex ===
                          filterRegularFlips(shortFlips).length - 2,
                        actions: [
                          assign({
                            currentIndex: ({currentIndex}) => currentIndex + 1,
                          }),
                          log(),
                        ],
                      },
                      {
                        target: '.normal',
                        cond: ({currentIndex, shortFlips}) =>
                          currentIndex <
                          filterRegularFlips(shortFlips).length - 2,
                        actions: [
                          assign({
                            currentIndex: ({currentIndex}) => currentIndex + 1,
                          }),
                          log(),
                        ],
                      },
                    ],
                    PICK: [
                      {
                        target: '.firstFlip',
                        cond: (_, {index}) => index === 0,
                        actions: [
                          assign({
                            currentIndex: (_, {index}) => index,
                          }),
                          log(),
                        ],
                      },
                      {
                        target: '.lastFlip',
                        cond: ({shortFlips}, {index}) =>
                          index === filterRegularFlips(shortFlips).length - 1,
                        actions: [
                          assign({
                            currentIndex: (_, {index}) => index,
                          }),
                          log(),
                        ],
                      },
                      {
                        target: '.normal',
                        actions: [
                          assign({
                            currentIndex: (_, {index}) => index,
                          }),
                          log(),
                        ],
                      },
                    ],
                  },
                },
                answer: {
                  initial: 'normal',
                  states: {
                    normal: {
                      on: {
                        ANSWER: {
                          actions: [
                            assign({
                              shortFlips: ({shortFlips}, {hash, option}) =>
                                mergeFlipsByHash(shortFlips, [{hash, option}]),
                            }),
                            log(),
                          ],
                        },
                        APPLY_AI_ANSWERS: {
                          actions: [
                            assign({
                              shortFlips: ({shortFlips}, {answers = []}) => {
                                const byHash = answers.reduce(
                                  (map, answer) =>
                                    map.set(answer.hash, answer.option),
                                  new Map()
                                )
                                return shortFlips.map((flip) =>
                                  byHash.has(flip.hash)
                                    ? {
                                        ...flip,
                                        option: byHash.get(flip.hash),
                                      }
                                    : flip
                                )
                              },
                            }),
                            log(),
                          ],
                        },
                        SUBMIT: {
                          target: 'submitShortSession.submitting',
                        },
                      },
                      after: {
                        SHORT_SESSION_AUTO_SUBMIT: [
                          {
                            target: 'submitShortSession.submitting',
                            cond: ({shortFlips}) =>
                              hasEnoughAnswers(shortFlips),
                          },
                          {
                            target: '#validation.validationFailed',
                          },
                        ],
                      },
                    },
                    submitShortSession: {
                      states: {
                        submitting: {
                          invoke: {
                            // eslint-disable-next-line no-shadow
                            src: ({shortFlips, epoch, validationSessionId}) =>
                              submitShortAnswers(
                                shortFlips.map(
                                  ({option: answer = 0, hash}) => ({
                                    answer,
                                    hash,
                                  })
                                ),
                                0,
                                epoch,
                                validationSessionId
                              ),
                            onDone: {
                              target: 'submitted',
                              actions: [
                                assign({
                                  shortSessionSubmittedAt: () => Date.now(),
                                }),
                                log(),
                              ],
                            },
                            onError: [
                              {
                                target: 'submitted',
                                cond: (_, {data}) =>
                                  data === 'tx with same hash already exists',
                                actions: assign({
                                  shortSessionSubmittedAt: () => Date.now(),
                                }),
                              },
                              {
                                target: 'fail',
                                actions: [
                                  assign({
                                    errorMessage: (_, {data}) => data,
                                  }),
                                  log(
                                    (context, event) => ({context, event}),
                                    'Short session submit failed'
                                  ),
                                ],
                              },
                            ],
                          },
                        },
                        submitted: {
                          entry: log(
                            'Short session submitted, waiting for long session'
                          ),
                          on: {
                            START_LONG_SESSION: '#validation.longSession',
                          },
                          after: {
                            WAIT_FOR_LONG_SESSION: '#validation.longSession',
                          },
                        },
                        fail: {
                          on: {
                            RETRY_SUBMIT: {
                              target: 'submitting',
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          exit: ['cleanupShortFlips'],
        },
        longSession: {
          entry: [
            assign({
              currentIndex: 0,
              retries: 0,
            }),
            log('Entering long session'),
          ],
          type: 'parallel',
          states: {
            fetch: {
              type: 'parallel',
              states: {
                flips: {
                  initial: 'fetchHashes',
                  entry: log('Start fetching long flips'),
                  states: {
                    fetchHashes: {
                      entry: log('Fetching long hashes'),
                      invoke: {
                        src: 'fetchLongHashes',
                        onDone: {
                          target: 'fetchFlips',
                          actions: [
                            assign({
                              longFlips: ({longFlips}, {data}) =>
                                mergeFlipsByHash(
                                  ...(longFlips.length
                                    ? [longFlips, data]
                                    : [data, longFlips])
                                ),
                            }),
                            log(),
                          ],
                        },
                        onError: {
                          target: 'fetchFlips',
                          actions: log(),
                        },
                      },
                    },
                    fetchFlips: {
                      invoke: {
                        src: 'fetchLongFlips',
                        onDone: [
                          {
                            target: 'enqueueNextFetch',
                            actions: [
                              assign({
                                retries: ({retries}) => retries + 1,
                              }),
                            ],
                            // eslint-disable-next-line no-shadow
                            cond: ({
                              longFlips,
                              validationStart: currentValidationStart,
                              longSessionDuration: currentLongSessionDuration,
                            }) =>
                              shouldPollLongFlips(longFlips, {
                                validationStart: currentValidationStart,
                                shortSessionDuration,
                                longSessionDuration: currentLongSessionDuration,
                              }),
                          },
                          {
                            target: 'detectMissing',
                          },
                        ],
                      },
                    },
                    enqueueNextFetch: {
                      after: {
                        5000: 'fetchHashes',
                      },
                    },
                    detectMissing: {
                      always: [
                        {target: 'fetchMissing', cond: 'hasMissingFlips'},
                        {
                          target: 'done',
                        },
                      ],
                    },
                    fetchMissing: {
                      initial: 'polling',
                      entry: assign({
                        retries: 0,
                      }),
                      states: {
                        polling: {
                          entry: log(
                            ({longFlips}) => pendingDecodeHashes(longFlips),
                            'fetching missing hashes'
                          ),
                          invoke: {
                            src:
                              ({longFlips, epoch: epochNumber}) =>
                              (cb) =>
                                fetchFlips(
                                  pendingDecodeHashes(longFlips),
                                  cb,
                                  0,
                                  {
                                    epoch: epochNumber,
                                    sessionType: SessionType.Long,
                                    onDecodedFlip,
                                  }
                                ),
                            onDone: 'check',
                          },
                        },
                        check: {
                          always: [
                            {target: 'enqueue', cond: 'hasMissingFlips'},
                            {
                              target:
                                '#validation.longSession.fetch.flips.done',
                            },
                          ],
                        },
                        enqueue: {
                          // somehow `after` doesn't work here thus custom delay
                          invoke: {
                            src: ({retries}) =>
                              wait(exponentialBackoff(retries) * 1000),
                            onDone: {
                              target: 'polling',
                              actions: assign({
                                retries: ({retries}) => retries + 1,
                              }),
                            },
                          },
                        },
                      },
                    },
                    done: {
                      type: 'final',
                      entry: log(),
                    },
                  },
                  on: {
                    FLIP: {
                      actions: [
                        assign({
                          longFlips: ({longFlips, retries}, {flip}) =>
                            mergeFlipsByHash(longFlips, [
                              {
                                ...flip,
                                retries,
                                relevance: RelevanceType.Abstained,
                              },
                            ]),
                        }),
                        log(),
                      ],
                    },
                    REFETCH_FLIPS: {
                      target: '.fetchFlips',
                      actions: [
                        assign({
                          longFlips: ({longFlips}) =>
                            longFlips.map((flip) => ({
                              ...flip,
                              fetched: false,
                              decoded: false,
                            })),
                        }),
                        log('Re-fetch long flips after rebooting the app'),
                      ],
                    },
                    FAVORITE: {
                      actions: [
                        assign({
                          bestFlipHashes: ({bestFlipHashes}, {hash}) => {
                            if (bestFlipHashes[hash]) {
                              delete bestFlipHashes[hash]
                            } else {
                              bestFlipHashes[hash] = true
                            }
                            return bestFlipHashes
                          },
                        }),
                        log(
                          ({currentIndex}) =>
                            `Mark ${currentIndex} flip as favorite`
                        ),
                      ],
                    },
                  },
                  after: {
                    FINALIZE_LONG_FLIPS: {
                      target: '.done',
                      actions: [
                        assign({
                          longFlips: ({longFlips}) =>
                            mergeFlipsByHash(
                              longFlips,
                              longFlips
                                .filter(({ready}) => !ready)
                                .map((flip) => ({
                                  ...flip,
                                  failed: true,
                                }))
                            ),
                        }),
                        log(),
                      ],
                    },
                    FINALIZE_ALL_LONG_FLIPS: {
                      target: '.done',
                      actions: [
                        assign({
                          longFlips: ({longFlips}) =>
                            mergeFlipsByHash(
                              longFlips,
                              longFlips.map((flip) => ({
                                ...flip,
                                failed: true,
                              }))
                            ),
                        }),
                        log(),
                      ],
                    },
                  },
                },
                keywords: {
                  initial: 'fetching',
                  states: {
                    fetching: {
                      invoke: {
                        src: ({longFlips}) =>
                          Promise.all(
                            filterReadyFlips(longFlips).map(({hash}) =>
                              fetchWords(hash)
                                .then(async ({result}) => ({
                                  hash,
                                  words: await Promise.all(
                                    result?.words.map(async (id) => ({
                                      id,
                                      ...(await loadKeyword(id)),
                                    })) ?? []
                                  ),
                                }))
                                .catch(() => ({hash}))
                            )
                          ),
                        onDone: {
                          target:
                            '#validation.longSession.fetch.keywords.success',
                          actions: assign({
                            longFlips: ({longFlips}, {data}) =>
                              mergeFlipsByHash(longFlips, data),
                          }),
                        },
                      },
                    },
                    success: {
                      after: {
                        10000: [
                          {
                            target: 'fetching',
                            cond: ({longFlips}) =>
                              longFlips.length === 0 ||
                              filterReadyFlips(longFlips).some(
                                ({words}) => !words || !words.length
                              ),
                          },
                          {
                            target: 'done',
                          },
                        ],
                      },
                    },
                    done: {
                      type: 'final',
                    },
                  },
                },
              },
            },
            solve: {
              type: 'parallel',
              states: {
                nav: {
                  initial: 'firstFlip',
                  states: {
                    // eslint-disable-next-line no-use-before-define
                    firstFlip: stepStates,
                    // eslint-disable-next-line no-use-before-define
                    normal: stepStates,
                    // eslint-disable-next-line no-use-before-define
                    lastFlip: stepStates,
                  },
                  on: {
                    PREV: [
                      {
                        target: undefined,
                        cond: ({longFlips}) => longFlips.length === 0,
                      },
                      {
                        target: '.normal',
                        cond: ({currentIndex}) => currentIndex > 1,
                        actions: [
                          assign({
                            currentIndex: ({currentIndex}) => currentIndex - 1,
                          }),
                          log(),
                        ],
                      },
                      {
                        target: '.firstFlip',
                        cond: ({currentIndex}) => currentIndex === 1,
                        actions: [
                          assign({
                            currentIndex: ({currentIndex}) => currentIndex - 1,
                          }),
                          log(),
                        ],
                      },
                    ],
                    NEXT: [
                      {
                        target: undefined,
                        cond: ({longFlips}) => longFlips.length === 0,
                      },
                      {
                        target: '.lastFlip',
                        cond: ({longFlips, currentIndex}) =>
                          currentIndex ===
                          longFlips.filter(readyFlip).length - 2,
                        actions: [
                          assign({
                            currentIndex: ({currentIndex}) => currentIndex + 1,
                          }),
                          log(),
                        ],
                      },
                      {
                        target: '.normal',
                        cond: ({longFlips, currentIndex}) =>
                          currentIndex < longFlips.length - 2,
                        actions: [
                          assign({
                            currentIndex: ({currentIndex}) => currentIndex + 1,
                          }),
                          log(),
                        ],
                      },
                    ],
                    PICK: [
                      {
                        target: '.firstFlip',
                        cond: (_, {index}) => index === 0,
                        actions: [
                          assign({
                            currentIndex: (_, {index}) => index,
                          }),
                          log(),
                        ],
                      },
                      {
                        target: '.lastFlip',
                        cond: ({longFlips}, {index}) =>
                          index === longFlips.filter(readyFlip).length - 1,
                        actions: [
                          assign({
                            currentIndex: (_, {index}) => index,
                          }),
                          log(),
                        ],
                      },
                      {
                        target: '.normal',
                        actions: [
                          assign({
                            currentIndex: (_, {index}) => index,
                          }),
                          log(),
                        ],
                      },
                    ],
                  },
                },
                answer: {
                  initial: 'welcomeQualification',
                  states: {
                    welcomeQualification: {
                      on: {
                        START_LONG_SESSION: 'flips',
                      },
                    },
                    flips: {
                      on: {
                        ANSWER: {
                          actions: [
                            assign({
                              longFlips: ({longFlips}, {hash, option}) =>
                                mergeFlipsByHash(longFlips, [{hash, option}]),
                            }),
                            log(),
                          ],
                        },
                        SUBMIT_NOW: {
                          target: 'submitLongSession',
                          actions: log(),
                        },
                        FINISH_FLIPS: {
                          target: 'finishFlips',
                          actions: log(),
                        },
                      },
                    },
                    finishFlips: {
                      on: {
                        START_KEYWORDS_QUALIFICATION: {
                          target: 'keywords',
                          actions: log(),
                        },
                      },
                    },
                    keywords: {
                      invoke: {src: () => (cb) => cb({type: 'PICK', index: 0})},
                      on: {
                        ANSWER: {
                          actions: [
                            assign({
                              longFlips: ({longFlips}, {hash, option}) =>
                                mergeFlipsByHash(longFlips, [{hash, option}]),
                            }),
                            log(),
                          ],
                        },
                        APPROVE_WORDS: {
                          actions: ['approveFlip'],
                        },
                        REPORT_WORDS: {
                          actions: ['reportFlip'],
                        },
                        SUBMIT: 'submitLongSession',
                        SUBMIT_NOW: 'submitLongSession',
                        PICK_INDEX: {
                          actions: [
                            send((_, {index}) => ({
                              type: 'PICK',
                              index,
                            })),
                          ],
                        },
                      },
                    },
                    review: {
                      on: {
                        SUBMIT_NOW: 'submitLongSession',
                        CHECK_FLIPS: {
                          target: 'keywords',
                          actions: [
                            send((_, {index}) => ({
                              type: 'PICK_INDEX',
                              index,
                            })),
                          ],
                        },
                        CHECK_REPORTS: 'keywords',
                        SUBMIT: 'submitLongSession',
                        CANCEL: {
                          target: 'keywords',
                          actions: [
                            send(({currentIndex}) => ({
                              type: 'PICK_INDEX',
                              index: currentIndex,
                            })),
                          ],
                        },
                      },
                    },
                    submitLongSession: {
                      initial: 'submitting',
                      entry: log(),
                      states: {
                        submitting: {
                          invoke: {
                            // eslint-disable-next-line no-shadow
                            src: ({longFlips, bestFlipHashes, epoch}) =>
                              submitLongAnswers(
                                longFlips.map(
                                  ({option: answer = 0, relevance, hash}) => ({
                                    answer,
                                    grade:
                                      // eslint-disable-next-line no-nested-ternary
                                      relevance === RelevanceType.Relevant
                                        ? bestFlipHashes[hash]
                                          ? FlipGrade.GradeA
                                          : FlipGrade.GradeD
                                        : relevance === RelevanceType.Irrelevant
                                        ? FlipGrade.Reported
                                        : FlipGrade.None,
                                    hash,
                                  })
                                ),
                                0,
                                epoch
                              ),
                            onDone: {
                              actions: [
                                assign({
                                  submitLongAnswersHash: (_, {data}) => data,
                                }),
                              ],
                              target: '#validation.validationSucceeded',
                            },
                            onError: [
                              {
                                target: '#validation.validationSucceeded',
                                cond: (_, {data}) =>
                                  data === 'tx with same hash already exists',
                              },
                              {
                                target: 'fail',
                                actions: [
                                  assign({
                                    errorMessage: (_, {data}) => data,
                                  }),
                                  log(
                                    (context, event) => ({context, event}),
                                    'Long session submit failed'
                                  ),
                                ],
                              },
                            ],
                          },
                        },
                        fail: {
                          on: {
                            RETRY_SUBMIT: {
                              target: 'submitting',
                            },
                          },
                        },
                      },
                    },
                  },
                  after: {
                    LONG_SESSION_CHECK: [
                      {
                        target: '#validation.validationFailed',
                        cond: ({longFlips}) => {
                          const solvableFlips = filterSolvableFlips(longFlips)
                          const answers = solvableFlips.filter(
                            ({option}) => option
                          )
                          return (
                            !solvableFlips.length ||
                            (solvableFlips.length &&
                              answers.length < solvableFlips.length / 2)
                          )
                        },
                      },
                    ],
                  },
                },
              },
            },
          },
          exit: ['cleanupLongFlips'],
        },
        validationFailed: {
          type: 'final',
          entry: log(
            (context, event) => ({context, event}),
            'VALIDATION FAILED'
          ),
        },
        validationSucceeded: {
          type: 'final',
          entry: ['onValidationSucceeded', log('VALIDATION SUCCEEDED')],
        },
      },
    },
    {
      services: {
        fetchShortHashes: () => fetchFlipHashes(SessionType.Short),
        fetchShortFlips:
          ({shortFlips, epoch: epochNumber}) =>
          (cb) =>
            fetchFlips(
              shortFlips.filter(readyNotFetchedFlip).map(({hash}) => hash),
              cb,
              0,
              {
                epoch: epochNumber,
                sessionType: SessionType.Short,
                onDecodedFlip,
              }
            ),
        fetchLongHashes: () => fetchFlipHashes(SessionType.Long),
        fetchLongFlips:
          ({longFlips, epoch: epochNumber}) =>
          (cb) =>
            fetchFlips(
              longFlips.filter(readyNotFetchedFlip).map(({hash}) => hash),
              cb,
              1000,
              {
                epoch: epochNumber,
                sessionType: SessionType.Long,
                onDecodedFlip,
              }
            ),
        // eslint-disable-next-line no-shadow
        fetchTranslations: ({longFlips, currentIndex, locale}) =>
          fetchConfirmedKeywordTranslations(
            longFlips[currentIndex].words.map(({id}) => id),
            locale
          ),
      },
      delays: {
        // eslint-disable-next-line no-shadow
        BUMP_EXTRA_FLIPS: ({validationStart}) =>
          Math.max(
            adjustDurationInSeconds(
              validationStart,
              global.env?.BUMP_EXTRA_FLIPS ?? 35
            ),
            5
          ) * 1000,
        // eslint-disable-next-line no-shadow
        FINALIZE_FLIPS: ({validationStart, shortSessionDuration}) =>
          Math.max(
            adjustDurationInSeconds(
              validationStart,
              getShortSessionFinalizeDelaySeconds({
                shortSessionDuration,
                configuredSeconds: global.env?.FINALIZE_FLIPS,
              })
            ),
            5
          ) * 1000,
        SHORT_SESSION_AUTO_SUBMIT: ({
          validationStart: nextValidationStart,
          shortSessionDuration: nextShortSessionDuration,
        }) =>
          adjustDurationInSeconds(
            nextValidationStart,
            nextShortSessionDuration - SHORT_SESSION_AUTO_SUBMIT_BUFFER_SECONDS
          ) * 1000,
        WAIT_FOR_LONG_SESSION: ({
          validationStart: nextValidationStart,
          shortSessionDuration: nextShortSessionDuration,
          shortSessionSubmittedAt,
        }) =>
          getShortSessionLongSessionTransitionDelayMs({
            validationStart: nextValidationStart,
            shortSessionDuration: nextShortSessionDuration,
            shortSessionSubmittedAt,
          }),
        LONG_SESSION_CHECK: ({
          validationStart: nextValidationStart,
          longSessionDuration: nextLongSessionDuration,
        }) =>
          adjustDurationInSeconds(
            nextValidationStart,
            shortSessionDuration -
              LONG_SESSION_AUTO_SUBMIT_BUFFER_SECONDS +
              nextLongSessionDuration
          ) * 1000,
        // eslint-disable-next-line no-shadow
        FINALIZE_LONG_FLIPS: ({
          validationStart: currentValidationStart,
          shortSessionDuration: currentShortSessionDuration,
          longSessionDuration: nextLongSessionDuration,
        }) =>
          Math.max(
            adjustDurationInSeconds(
              currentValidationStart,
              currentShortSessionDuration +
                Math.min(
                  nextLongSessionDuration ||
                    global.env?.FINALIZE_LONG_FLIPS ||
                    15 * 60,
                  global.env?.FINALIZE_LONG_FLIPS || 15 * 60
                )
            ),
            5
          ) * 1000,
        // eslint-disable-next-line no-shadow
        FINALIZE_ALL_LONG_FLIPS: ({validationStart, shortSessionDuration}) =>
          Math.max(
            adjustDurationInSeconds(
              validationStart,
              shortSessionDuration +
                (global.env?.FINALIZE_ALL_LONG_FLIPS || 25 * 60)
            ),
            5
          ) * 1000,
      },
      actions: {
        approveFlip: assign({
          bestFlipHashes: ({longFlips, bestFlipHashes}, {hash}) => {
            const flip = longFlips.find((x) => x.hash === hash)
            if (
              flip.relevance === RelevanceType.Relevant &&
              bestFlipHashes[hash]
            ) {
              delete bestFlipHashes[hash]
            }
            return bestFlipHashes
          },
          longFlips: ({longFlips}, {hash}) => {
            const flip = longFlips.find((x) => x.hash === hash)
            return mergeFlipsByHash(longFlips, [
              {
                hash,
                relevance:
                  flip.relevance === RelevanceType.Relevant
                    ? RelevanceType.Abstained
                    : RelevanceType.Relevant,
              },
            ])
          },
          reports: ({reports}, {hash}) => {
            reports.delete(hash)
            return reports
          },
        }),
        reportFlip: choose([
          {
            cond: ({longFlips, reports}) =>
              reports.size < availableReportsNumber(longFlips),
            actions: [
              assign({
                bestFlipHashes: ({bestFlipHashes}, {hash}) => {
                  if (bestFlipHashes[hash]) {
                    delete bestFlipHashes[hash]
                  }
                  return bestFlipHashes
                },
                longFlips: ({longFlips}, {hash}) => {
                  const flip = longFlips.find((x) => x.hash === hash)
                  return mergeFlipsByHash(longFlips, [
                    {
                      hash,
                      relevance:
                        flip.relevance === RelevanceType.Irrelevant
                          ? RelevanceType.Abstained
                          : RelevanceType.Irrelevant,
                    },
                  ])
                },
                reports: ({reports}, {hash}) => {
                  if (reports.has(hash)) {
                    reports.delete(hash)
                  } else {
                    reports.add(hash)
                  }
                  return reports
                },
              }),
            ],
          },
          {
            cond: ({longFlips, reports}, {hash}) =>
              reports.size >= availableReportsNumber(longFlips) &&
              reports.has(hash),
            actions: [
              assign({
                longFlips: ({longFlips}, {hash}) =>
                  mergeFlipsByHash(longFlips, [
                    {hash, relevance: RelevanceType.Abstained},
                  ]),
                reports: ({reports}, {hash}) => {
                  reports.delete(hash)
                  return reports
                },
              }),
              log(),
            ],
          },
          {
            cond: ({longFlips, reports}, {hash}) =>
              reports.size >= availableReportsNumber(longFlips) &&
              !reports.has(hash),
            actions: [
              'onExceededReports',
              assign({
                bestFlipHashes: ({bestFlipHashes}, {hash}) => {
                  if (bestFlipHashes[hash]) {
                    delete bestFlipHashes[hash]
                  }
                  return bestFlipHashes
                },
                longFlips: ({longFlips}, {hash}) =>
                  mergeFlipsByHash(longFlips, [
                    {hash, relevance: RelevanceType.Abstained},
                  ]),
              }),
              log(),
            ],
          },
        ]),
        cleanupShortFlips: ({shortFlips}) => {
          filterSolvableFlips(shortFlips).forEach(({images}) => {
            if (Array.isArray(images)) {
              images.forEach(URL.revokeObjectURL)
            }
          })
        },
        cleanupLongFlips: ({longFlips}) => {
          filterSolvableFlips(longFlips).forEach(({images}) => {
            if (Array.isArray(images)) {
              images.forEach(URL.revokeObjectURL)
            }
          })
        },
        applyTranslations: assign({
          translations: ({translations, longFlips, currentIndex}, {data}) =>
            data.reduce((acc, curr, wordIdx) => {
              const currentFlip = longFlips[currentIndex]
              if (currentFlip && currentFlip.words) {
                const {words} = currentFlip
                const word = words[wordIdx]
                return word
                  ? {
                      ...acc,
                      [word.id]: curr,
                    }
                  : acc
              }
              return translations
            }, translations),
        }),
      },
      guards: {
        didFetchShortFlips: ({shortFlips}) => {
          const regularFlips = filterRegularFlips(shortFlips)
          return (
            regularFlips.some((x) => x) &&
            regularFlips.every(
              ({ready, fetched, decoded}) => ready && fetched && decoded
            )
          )
        },
        hasMissingFlips: ({longFlips}) =>
          pendingDecodeHashes(longFlips).length > 0,
        shouldTranslate: ({translations, longFlips, currentIndex}) =>
          shouldTranslate(translations, longFlips[currentIndex]),
      },
    }
  )

function fetchFlips(
  hashes,
  cb,
  delay = 0,
  {epoch, sessionType, onDecodedFlip} = {}
) {
  const nextHashes = Array.isArray(hashes) ? hashes.filter(Boolean) : []

  if (nextHashes.length === 0) {
    return Promise.resolve()
  }

  global.logger.debug(`Calling flip_get rpc for hashes`, nextHashes)
  return forEachAsync(nextHashes, (hash) =>
    fetchFlip(hash)
      .then(({result, error}) => {
        global.logger.debug(`Get flip_get response`, hash)
        const flip = decodeFlip({...result}, ({images, orders}) => {
          if (typeof onDecodedFlip === 'function') {
            onDecodedFlip({
              flipHash: hash,
              epoch,
              sessionType,
              images,
              orders,
            })
          }
        })
        cb({
          type: 'FLIP',
          flip: {
            ...flip,
            hash,
            fetched: !!result && !error,
            missing: !!error,
          },
        })
      })
      .then(() => (delay > 0 ? wait(delay) : Promise.resolve()))
      .catch(() => {
        global.logger.debug(`Catch flip_get reject`, hash)
        cb({
          type: 'FLIP',
          flip: {
            hash,
            fetched: false,
          },
        })
      })
  )
}

function decodeFlip({hash, hex, publicHex, privateHex}, onDecoded) {
  try {
    let images
    let orders

    if (privateHex && privateHex !== '0x') {
      ;[images] = decode(publicHex || hex)
      let privateImages
      ;[privateImages, orders] = decode(privateHex)
      images = images.concat(privateImages)
    } else {
      ;[images, orders] = decode(hex)
    }

    if (typeof onDecoded === 'function') {
      try {
        onDecoded({images, orders})
      } catch {
        // Capture is optional and must never affect validation rendering.
      }
    }

    return {
      hash,
      decoded: true,
      images: images.map((buffer) =>
        URL.createObjectURL(new Blob([buffer], {type: 'image/png'}))
      ),
      orders: orders.map((order) => order.map(([idx = 0]) => idx)),
      hex: '',
    }
  } catch {
    return {
      hash,
      decoded: false,
    }
  }
}

const stepStates = {
  initial: 'unknown',
  states: {
    unknown: {
      always: [
        {
          target: 'fetching',
          cond: 'shouldTranslate',
        },
        {target: 'idle'},
      ],
    },
    idle: {},
    fetching: {
      invoke: {
        src: 'fetchTranslations',
        onDone: {
          target: 'idle',
          actions: ['applyTranslations', log()],
        },
        onError: {
          actions: [log()],
        },
      },
    },
  },
}

function hasKeywordWords(words) {
  return Array.isArray(words) && words.length > 0
}

function mergeFlipsByHash(flips, anotherFlips) {
  const nextFlips = Array.isArray(flips) ? flips : []
  const nextAnotherFlips = Array.isArray(anotherFlips) ? anotherFlips : []

  return nextFlips.map((flip) => {
    const anotherFlip = nextAnotherFlips.find(({hash}) => hash === flip.hash)

    if (anotherFlip) {
      const relevance =
        anotherFlip?.relevance ?? (flip?.relevance || RelevanceType.Abstained)

      const mergedFlip = {
        ...flip,
        ...anotherFlip,
        relevance,
      }

      if (
        Object.prototype.hasOwnProperty.call(anotherFlip, 'words') &&
        !hasKeywordWords(anotherFlip.words) &&
        hasKeywordWords(flip.words)
      ) {
        mergedFlip.words = flip.words
      }

      return mergedFlip
    }

    return flip
  })
}

async function fetchWords(hash) {
  return (
    await apiClient().post('/', {
      method: 'flip_words',
      params: [hash],
      id: 1,
    })
  ).data
}

export function adjustDurationInSeconds(validationStart, duration) {
  return dayjs(validationStart).add(duration, 's').diff(dayjs(), 's')
}
