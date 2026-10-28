import { describe, it } from 'node:test'
import { deepStrictEqual, strictEqual } from 'node:assert/strict'
import {
  buildDefinition,
  getChanges,
  mergeObjects,
  updateObject,
} from './index.js'

const definition = buildDefinition({
  items: 'obj',
  groups: 'obj',
  entries: 'obj',
})

for (const [name, update] of [
  ['updateObject', updateObject],
  ['definition.update', definition.update],
  [
    'definition.update without schema validation',
    (before, changes) => definition.update(before, changes, false),
  ],
]) {
  describe(`${name}: array diff normalization`, () => {
    it('sets a cleaned whole array when new entries include tombstones', () => {
      for (const empty of [null, {}, [], { value: null }, [null]]) {
        const after = { items: [empty, 'new'] }
        const changes = getChanges({}, after)
        deepStrictEqual(changes, { items: ['new'] })
        deepStrictEqual(update({}, changes), { items: ['new'] })
        deepStrictEqual(after, { items: [empty, 'new'] })
        deepStrictEqual(changes, { items: ['new'] })
      }
    })

    it('cleans replacement data without modifying the supplied array or objects', () => {
      const kept = Object.freeze({ value: 'keep', removed: null })
      const after = { items: Object.freeze([null, kept, kept]) }
      const changes = getChanges({}, after)
      deepStrictEqual(changes, {
        items: [{ value: 'keep' }, { value: 'keep' }],
      })
      // Shared references remain valid in the copied, cleaned replacement.
      strictEqual(changes.items[0], changes.items[1])
      deepStrictEqual(update({}, changes), {
        items: [{ value: 'keep' }, { value: 'keep' }],
      })
      deepStrictEqual(after, {
        items: [
          null,
          { value: 'keep', removed: null },
          { value: 'keep', removed: null },
        ],
      })
    })

    it('normalizes nested new arrays and recursively empty entries', () => {
      const after = {
        groups: [
          {
            entries: [
              null,
              { removed: [] },
              { value: 'keep', unused: null, nested: [null, 'nested'] },
            ],
          },
        ],
      }
      const changes = getChanges({}, after)
      deepStrictEqual(changes, {
        'groups.[0].entries': [{ value: 'keep', nested: ['nested'] }],
      })
      deepStrictEqual(update({}, changes), {
        groups: [{ entries: [{ value: 'keep', nested: ['nested'] }] }],
      })
      deepStrictEqual(after.groups[0].entries[0], null)
      deepStrictEqual(after.groups[0].entries[1], { removed: [] })
    })

    it('keeps indexed updates when the original array exists but is empty', () => {
      const before = { items: [] }
      const changes = getChanges(before, { items: [null, {}, 'new'] })
      deepStrictEqual(changes, { 'items.[0]': 'new' })
      deepStrictEqual(update(before, changes), { items: ['new'] })
      deepStrictEqual(before, { items: [] })
    })

    it('compacts only appended entries while keeping original deletion indexes', () => {
      const before = { items: ['old'] }
      const after = { items: [null, null, {}, 'new', [], 'last'] }
      const changes = getChanges(before, after)
      deepStrictEqual(changes, {
        'items.[0]': null,
        'items.[1]': 'new',
        'items.[2]': 'last',
      })
      // Appends occur before deleting index 0, so writes use original indexes.
      deepStrictEqual(update(before, changes), { items: ['new', 'last'] })
      deepStrictEqual(before, { items: ['old'] })
      deepStrictEqual(after, { items: [null, null, {}, 'new', [], 'last'] })
    })

    it('removes existing scalar entries replaced by null or empty containers', () => {
      for (const empty of [null, {}, [], { value: null }, [null]]) {
        const before = { items: ['old'] }
        const changes = getChanges(before, { items: [empty, 'new'] })
        deepStrictEqual(changes, { 'items.[0]': null, 'items.[1]': 'new' })
        deepStrictEqual(update(before, changes), { items: ['new'] })
      }
    })

    it('preserves granular edits to existing objects and appends', () => {
      const before = { entries: [{ value: 'old' }] }
      const changes = getChanges(before, {
        entries: [{ value: 'changed' }, null, { value: 'new' }],
      })
      deepStrictEqual(changes, {
        'entries.[0].value': 'changed',
        'entries.[1].value': 'new',
      })
      deepStrictEqual(update(before, changes), {
        entries: [{ value: 'changed' }, { value: 'new' }],
      })
    })

    it('keeps ordinary array diffs granular', () => {
      const before = { items: ['first', 'old'] }
      const after = { items: ['first', 'changed', 'new'] }
      const changes = getChanges(before, after)
      deepStrictEqual(changes, {
        'items.[1]': 'changed',
        'items.[2]': 'new',
      })
      deepStrictEqual(update(before, changes), after)
    })

    it('honors ignored keys and additive diff options', () => {
      const after = { items: [null, 'new'] }
      deepStrictEqual(getChanges({}, after, { ignoredKeys: ['items'] }), null)
      const changes = getChanges({}, after, { includeDeletions: false })
      deepStrictEqual(changes, { items: ['new'] })
      deepStrictEqual(update({}, changes), { items: ['new'] })
      deepStrictEqual(
        getChanges(
          { items: ['keep', 'old'] },
          { items: ['keep'] },
          { includeDeletions: false }
        ),
        null
      )
    })
  })
}

it('treats arrays containing only tombstones as missing data', () => {
  deepStrictEqual(
    getChanges({}, { items: [null, {}, [], { value: null }] }),
    null
  )
  deepStrictEqual(getChanges({ items: null }, { items: [null, {}] }), null)
  deepStrictEqual(getChanges({ items: [null, {}] }, { items: null }), null)
})

it('merges normalized new arrays using additive diffs', () => {
  const after = { items: [null, 'new'] }
  deepStrictEqual(mergeObjects({}, after), { updated: { items: ['new'] } })
  deepStrictEqual(definition.merge({}, after), { updated: { items: ['new'] } })
  deepStrictEqual(after, { items: [null, 'new'] })
})
