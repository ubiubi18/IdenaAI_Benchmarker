const fs = require('fs')
const os = require('os')
const path = require('path')
const low = require('lowdb')
const FileSync = require('lowdb/adapters/FileSync')
const {
  loadPersistenceValueFromDb,
  persistPersistenceItemToDb,
} = require('./persistence-store')

function createTempDb() {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'idena-renderer-data-bridge-')
  )
  const file = path.join(tempDir, 'db.json')
  const db = low(new FileSync(file))
  db.setState({})

  return {db, cleanup: () => fs.rmSync(tempDir, {recursive: true, force: true})}
}

describe('renderer data bridge persistence helpers', () => {
  it('persists exact keys without lowdb path splitting', () => {
    const {db, cleanup} = createTempDb()

    try {
      const key =
        '1:0xabc:external:http://127.0.0.1:22301:1776930018000:validation-ai-cost-ledger'
      const value = {
        entries: [
          {action: 'long-session solve', tokenUsage: {totalTokens: 42}},
        ],
      }

      persistPersistenceItemToDb(db, key, value)

      expect(loadPersistenceValueFromDb(db, key)).toEqual(value)
      expect(db.getState()[key]).toEqual(value)
    } finally {
      cleanup()
    }
  })

  it('reads legacy values written with lowdb path semantics', () => {
    const {db, cleanup} = createTempDb()

    try {
      const key =
        '1:0xabc:external:http://127.0.0.1:22301:1776930018000:validation-ai-cost-ledger'
      const value = {
        entries: [
          {action: 'long-session solve', tokenUsage: {totalTokens: 99}},
        ],
      }

      db.set(key, value).write()

      expect(loadPersistenceValueFromDb(db, key)).toEqual(value)
    } finally {
      cleanup()
    }
  })
})
