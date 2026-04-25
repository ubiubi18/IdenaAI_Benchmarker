const {ProtoTransaction} = require('../models/proto/models_pb')
const {
  decodeRawTransaction,
  dnaBytesToFloatString,
  hexToUint8Array,
  toHexString,
} = require('./idena-transaction')

describe('idena transaction helpers', () => {
  it('formats DNA integer bytes without floating point precision loss', () => {
    expect(dnaBytesToFloatString(hexToUint8Array('0x0de0b6b3a7640000'))).toBe(
      '1'
    )
    expect(dnaBytesToFloatString(hexToUint8Array('0x016345785d8a0000'))).toBe(
      '0.1'
    )
  })

  it('decodes raw protobuf transaction fields used by dna://rawTx', () => {
    const data = new ProtoTransaction.Data()
    data.setNonce(7)
    data.setEpoch(42)
    data.setType(0)
    data.setTo(hexToUint8Array('0x1111111111111111111111111111111111111111'))
    data.setAmount(hexToUint8Array('0x0de0b6b3a7640000'))
    data.setMaxfee(hexToUint8Array('0x038d7ea4c68000'))
    data.setTips(hexToUint8Array('0x00'))
    data.setPayload(hexToUint8Array('0x1234'))

    const tx = new ProtoTransaction()
    tx.setData(data)

    expect(
      decodeRawTransaction(toHexString(tx.serializeBinary(), true))
    ).toEqual({
      type: 0,
      to: '0x1111111111111111111111111111111111111111',
      amount: '1',
      maxFee: '0.001',
      tips: '0',
      nonce: 7,
      epoch: 42,
      payload: '0x1234',
    })
  })
})
