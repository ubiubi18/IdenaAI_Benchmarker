const {toIpcCloneable} = require('./ipc-cloneable')

describe('ipc cloneable utility', () => {
  it('keeps plain JSON-like values intact', () => {
    expect(
      toIpcCloneable({
        ok: true,
        count: 2,
        list: ['a', 'b'],
        nested: {value: 'x'},
      })
    ).toEqual({
      ok: true,
      count: 2,
      list: ['a', 'b'],
      nested: {value: 'x'},
    })
  })

  it('drops unsupported object instances from plain payloads', () => {
    class CustomPayload {
      constructor() {
        this.value = 'ignored'
      }
    }

    expect(
      toIpcCloneable({
        supported: 'ok',
        unsupported: new CustomPayload(),
      })
    ).toEqual({
      supported: 'ok',
    })
  })

  it('normalizes errors and circular references safely', () => {
    const error = new Error('boom')
    const payload = {
      error,
      list: [],
    }

    payload.list.push(payload)

    expect(toIpcCloneable(payload)).toEqual({
      error: {
        name: 'Error',
        message: 'boom',
        stack: expect.any(String),
      },
      list: [null],
    })
  })
})
