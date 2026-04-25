const crypto = require('crypto')
const {keccak_256: keccak256} = require('js-sha3')

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

function privateKeyToAddress(key, withPrefix = true) {
  if (!key) return '0x0000000000000000000000000000000000000000'

  const privateKey = hexToBuffer(key)
  const ecdh = crypto.createECDH('secp256k1')
  ecdh.setPrivateKey(privateKey)

  const publicKey = ecdh.getPublicKey(null, 'uncompressed')
  const publicKeyHash = Buffer.from(
    keccak256.arrayBuffer(publicKey.slice(1))
  ).slice(12)

  return toHexString(publicKeyHash, withPrefix)
}

module.exports = {
  privateKeyToAddress,
  toHexString,
}
