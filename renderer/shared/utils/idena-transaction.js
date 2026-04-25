/* global BigInt */
import {ProtoTransaction} from '../models/proto/models_pb'

const DNA_BASE = BigInt('1000000000000000000')

function stripHexPrefix(value) {
  return typeof value === 'string' && value.startsWith('0x')
    ? value.slice(2)
    : value
}

export function hexToUint8Array(value) {
  const hex = stripHexPrefix(value)
  if (!hex || typeof hex !== 'string') return new Uint8Array()

  const bytes = new Uint8Array(hex.length / 2)
  for (let idx = 0; idx < hex.length; idx += 2) {
    bytes[idx / 2] = Number.parseInt(hex.slice(idx, idx + 2), 16)
  }
  return bytes
}

export function toHexString(bytes, withPrefix = true) {
  const hex = Array.from(bytes || [])
    .map((byte) => `0${Number(byte).toString(16)}`.slice(-2))
    .join('')
  return `${withPrefix ? '0x' : ''}${hex}`
}

function bytesToBigInt(bytes) {
  return BigInt(toHexString(bytes, true))
}

export function dnaBytesToFloatString(bytes) {
  const value = bytes && bytes.length ? bytesToBigInt(bytes) : 0n
  const whole = value / DNA_BASE
  const fraction = value % DNA_BASE

  if (fraction === 0n) return whole.toString()

  return `${whole}.${fraction.toString().padStart(18, '0').replace(/0+$/u, '')}`
}

export function decodeRawTransaction(rawTx) {
  const tx = ProtoTransaction.deserializeBinary(hexToUint8Array(rawTx))
  const data = tx.getData()

  if (!data) {
    return {type: 0, amount: null, to: null, maxFee: null}
  }

  return {
    type: data.getType(),
    to: data.getTo_asU8().length ? toHexString(data.getTo_asU8(), true) : null,
    amount: dnaBytesToFloatString(data.getAmount_asU8()),
    maxFee: dnaBytesToFloatString(data.getMaxfee_asU8()),
    tips: dnaBytesToFloatString(data.getTips_asU8()),
    nonce: data.getNonce(),
    epoch: data.getEpoch(),
    payload: toHexString(data.getPayload_asU8(), true),
  }
}
