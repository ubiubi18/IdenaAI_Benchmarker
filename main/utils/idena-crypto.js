/* global BigInt */
const crypto = require('crypto')
const {keccak_256: keccak256} = require('js-sha3')

const SECP256K1_P = BigInt(
  '0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f'
)
const SECP256K1_N = BigInt(
  '0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141'
)
const SECP256K1_G = {
  x: BigInt(
    '0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
  ),
  y: BigInt(
    '0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8'
  ),
}

function stripHexPrefix(value) {
  return typeof value === 'string' && value.startsWith('0x')
    ? value.slice(2)
    : value
}

function hexToBuffer(value) {
  const hex = stripHexPrefix(value)
  if (!hex || typeof hex !== 'string') return Buffer.alloc(0)
  return Buffer.from(hex, 'hex')
}

function toHexString(bytes, withPrefix = true) {
  const hex = Buffer.from(bytes || []).toString('hex')
  return `${withPrefix ? '0x' : ''}${hex}`
}

function mod(value, modulo = SECP256K1_P) {
  const result = value % modulo
  return result >= 0n ? result : result + modulo
}

function invert(value, modulo = SECP256K1_P) {
  let low = mod(value, modulo)
  let high = modulo
  let lm = 1n
  let hm = 0n

  while (low > 1n) {
    const ratio = high / low
    const nm = hm - lm * ratio
    const next = high - low * ratio

    hm = lm
    high = low
    lm = nm
    low = next
  }

  return mod(lm, modulo)
}

function pointDouble(point) {
  if (!point || point.y === 0n) return null

  const slope = mod(3n * point.x * point.x * invert(2n * point.y))
  const x = mod(slope * slope - 2n * point.x)
  const y = mod(slope * (point.x - x) - point.y)

  return {x, y}
}

function pointAdd(left, right) {
  if (!left) return right
  if (!right) return left

  if (left.x === right.x) {
    return mod(left.y + right.y) === 0n ? null : pointDouble(left)
  }

  const slope = mod((right.y - left.y) * invert(right.x - left.x))
  const x = mod(slope * slope - left.x - right.x)
  const y = mod(slope * (left.x - x) - left.y)

  return {x, y}
}

function multiplyPoint(scalar, point = SECP256K1_G) {
  let nextScalar = scalar
  let addend = point
  let result = null

  while (nextScalar > 0n) {
    if (nextScalar % 2n === 1n) {
      result = pointAdd(result, addend)
    }
    addend = pointDouble(addend)
    nextScalar /= 2n
  }

  return result
}

function privateKeyToScalar(privateKey) {
  if (privateKey.length !== 32) {
    throw new Error('Invalid secp256k1 private key length')
  }

  const scalar = BigInt(`0x${privateKey.toString('hex')}`)

  if (scalar <= 0n || scalar >= SECP256K1_N) {
    throw new Error('Invalid secp256k1 private key')
  }

  return scalar
}

function privateKeyToPublicKey(privateKey) {
  try {
    const ecdh = crypto.createECDH('secp256k1')
    ecdh.setPrivateKey(privateKey)

    return ecdh.getPublicKey(null, 'uncompressed')
  } catch (error) {
    if (
      !String(error?.message || '').includes(
        'Failed to create key using named curve'
      )
    ) {
      throw error
    }
  }

  const point = multiplyPoint(privateKeyToScalar(privateKey))

  if (!point) {
    throw new Error('Failed to derive secp256k1 public key')
  }

  return Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(point.x.toString(16).padStart(64, '0'), 'hex'),
    Buffer.from(point.y.toString(16).padStart(64, '0'), 'hex'),
  ])
}

function privateKeyToAddress(key, withPrefix = true) {
  if (!key) return '0x0000000000000000000000000000000000000000'

  const privateKey = hexToBuffer(key)
  const publicKey = privateKeyToPublicKey(privateKey)
  const publicKeyHash = Buffer.from(
    keccak256.arrayBuffer(publicKey.slice(1))
  ).slice(12)

  return toHexString(publicKeyHash, withPrefix)
}

module.exports = {
  privateKeyToAddress,
  toHexString,
}
