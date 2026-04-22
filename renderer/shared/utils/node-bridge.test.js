import {getNodeBridge} from './node-bridge'

describe('node bridge', () => {
  const originalIdena = global.window?.idena

  afterEach(() => {
    if (typeof originalIdena === 'undefined') {
      delete global.window.idena
    } else {
      global.window.idena = originalIdena
    }

    jest.restoreAllMocks()
  })

  it('coalesces repeated rehearsal status polls into a single ipc call', () => {
    const getValidationDevnetStatus = jest.fn()
    let now = 1000

    global.window.idena = {
      node: {
        getValidationDevnetStatus,
      },
    }

    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now)
    const bridge = getNodeBridge()

    bridge.getValidationDevnetStatus()
    expect(getValidationDevnetStatus).toHaveBeenCalledTimes(1)

    now = 1200
    bridge.getValidationDevnetStatus()
    expect(getValidationDevnetStatus).toHaveBeenCalledTimes(1)

    now = 2100
    bridge.getValidationDevnetStatus()

    expect(getValidationDevnetStatus).toHaveBeenCalledTimes(2)
    expect(nowSpy).toHaveBeenCalled()
  })
})
