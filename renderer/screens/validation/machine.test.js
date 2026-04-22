import {interpret} from 'xstate'
import {createValidationMachine} from './machine'

jest.mock('../../shared/api/validation', () => ({
  fetchFlipHashes: jest.fn(() => new Promise(() => {})),
  submitShortAnswers: jest.fn(() => Promise.resolve('0xtx')),
  submitLongAnswers: jest.fn(() => Promise.resolve('0xtx')),
}))

jest.mock('../../shared/api/dna', () => ({
  fetchFlip: jest.fn(() => Promise.resolve({})),
}))

jest.mock('../flips/utils', () => ({
  fetchConfirmedKeywordTranslations: jest.fn(() => Promise.resolve([])),
}))

jest.mock('../../shared/utils/utils', () => ({
  loadKeyword: jest.fn(() => ''),
}))

describe('validation machine', () => {
  it('waits for the real long-session start after short answers submit', async () => {
    const machine = createValidationMachine({
      epoch: 1,
      validationStart: Date.now() + 60 * 1000,
      shortSessionDuration: 120,
      longSessionDuration: 300,
      validationSessionId: '',
      locale: 'en',
    })

    const service = interpret(machine).start()

    service.send('SUBMIT')

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timed out waiting for submitted state'))
      }, 1000)

      service.onTransition((state) => {
        if (
          state.matches(
            'shortSession.solve.answer.submitShortSession.submitted'
          )
        ) {
          clearTimeout(timeout)
          resolve()
        }
      })
    })

    expect(
      service.state.matches(
        'shortSession.solve.answer.submitShortSession.submitted'
      )
    ).toBe(true)
    expect(service.state.matches('longSession')).toBe(false)

    service.stop()
  })

  it('can enter long session immediately once the live period switches after short submit', async () => {
    const machine = createValidationMachine({
      epoch: 1,
      validationStart: Date.now() + 60 * 1000,
      shortSessionDuration: 120,
      longSessionDuration: 300,
      validationSessionId: '',
      locale: 'en',
    })

    const service = interpret(machine).start()

    service.send('SUBMIT')

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timed out waiting for submitted state'))
      }, 1000)

      service.onTransition((state) => {
        if (
          state.matches(
            'shortSession.solve.answer.submitShortSession.submitted'
          )
        ) {
          clearTimeout(timeout)
          resolve()
        }
      })
    })

    service.send('START_LONG_SESSION')

    expect(service.state.matches('longSession')).toBe(true)

    service.stop()
  })

  it('submits short answers directly without a second confirmation event', async () => {
    const originalRevokeObjectUrl = URL.revokeObjectURL
    URL.revokeObjectURL = jest.fn()

    try {
      const machine = createValidationMachine({
        epoch: 1,
        validationStart: Date.now() + 60 * 1000,
        shortSessionDuration: 120,
        longSessionDuration: 300,
        validationSessionId: '',
        locale: 'en',
        initialShortFlips: [
          {
            hash: '0xshort',
            decoded: true,
            option: 1,
            images: ['blob:short-1'],
          },
        ],
      })

      const service = interpret(machine).start()

      service.send('SUBMIT')

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Timed out waiting for submitted state'))
        }, 1000)

        service.onTransition((state) => {
          if (
            state.matches(
              'shortSession.solve.answer.submitShortSession.submitted'
            )
          ) {
            clearTimeout(timeout)
            resolve()
          }
        })
      })

      expect(
        service.state.matches(
          'shortSession.solve.answer.submitShortSession.submitted'
        )
      ).toBe(true)

      service.stop()
    } finally {
      URL.revokeObjectURL = originalRevokeObjectUrl
    }
  })

  it('merges rehearsal benchmark metadata into matching flips', () => {
    const machine = createValidationMachine({
      epoch: 1,
      validationStart: Date.now(),
      shortSessionDuration: 120,
      longSessionDuration: 300,
      validationSessionId: '',
      locale: 'en',
      initialShortFlips: [{hash: '0xshort'}],
      initialLongFlips: [{hash: '0xlong'}],
    })

    const service = interpret(machine).start()

    service.send({
      type: 'MERGE_REHEARSAL_BENCHMARK_META',
      metaByHash: {
        '0xshort': {expectedAnswer: 'left', expectedStrength: 'Strong'},
        '0xlong': {expectedAnswer: 'right', expectedStrength: 'Weak'},
      },
    })

    expect(service.state.context.shortFlips[0]).toMatchObject({
      hash: '0xshort',
      expectedAnswer: 'left',
      expectedStrength: 'Strong',
    })
    expect(service.state.context.longFlips[0]).toMatchObject({
      hash: '0xlong',
      expectedAnswer: 'right',
      expectedStrength: 'Weak',
    })

    service.stop()
  })
})
