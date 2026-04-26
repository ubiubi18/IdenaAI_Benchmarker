const crypto = require('crypto')
const {privateKeyToAddress} = require('./idena-crypto')

describe('idena crypto helpers', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('derives Idena-compatible addresses from secp256k1 private keys', () => {
    expect(
      privateKeyToAddress(
        '0x0000000000000000000000000000000000000000000000000000000000000001'
      )
    ).toBe('0x7e5f4552091a69125d5dfcb7b8c2659029395bdf')
  })

  it('falls back when Electron cannot create secp256k1 named curves', () => {
    jest.spyOn(crypto, 'createECDH').mockImplementation(() => {
      throw new Error('Failed to create key using named curve')
    })

    expect(
      privateKeyToAddress(
        '0x0000000000000000000000000000000000000000000000000000000000000001'
      )
    ).toBe('0x7e5f4552091a69125d5dfcb7b8c2659029395bdf')
  })

  it('returns the zero address for missing keys', () => {
    expect(privateKeyToAddress(null)).toBe(
      '0x0000000000000000000000000000000000000000'
    )
  })
})
