const low = require('lowdb')
const FileSync = require('lowdb/adapters/FileSync')
const {dbPath} = require('./setup')

const adapter = new FileSync(dbPath('flips.json'))
const db = low(adapter)

db.defaults({flips: []}).write()

const keyName = 'flips'

function getFlipsCollection() {
  return db.get(keyName)
}

function getFlips() {
  return getFlipsCollection().value()
}

function getFlip(id) {
  return getFlipsCollection().find({id}).value()
}

function saveFlips(flips) {
  db.set(keyName, Array.isArray(flips) ? flips : []).write()
}

function addDraft(draft) {
  getFlipsCollection().push(draft).write()
}

function updateDraft(draft) {
  const drafts = getFlips()
  const draftIdx = drafts.findIndex(({id}) => id === draft.id)

  if (draftIdx > -1) {
    const nextDrafts = [
      ...drafts.slice(0, draftIdx),
      {...drafts[draftIdx], ...draft},
      ...drafts.slice(draftIdx + 1),
    ]

    saveFlips(nextDrafts)
    return nextDrafts
  }

  return drafts
}

function deleteDraft(id) {
  const drafts = getFlips()

  saveFlips(
    drafts.map((flip) =>
      flip.id === id ? flip : {...flip, type: 'Removed', images: null}
    )
  )

  return id
}

function clear() {
  db.set(keyName, []).write()
}

module.exports = {
  db,
  getFlips,
  getFlip,
  saveFlips,
  addDraft,
  updateDraft,
  deleteDraft,
  clear,
}
