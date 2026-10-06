import { describe, it } from 'node:test'
import { deepStrictEqual } from 'node:assert/strict'
import { buildDefinition, getChanges, setValue, updateObject } from './main.js'

const definition = buildDefinition({
  name: 'str',
  'profile.name': 'str',
  items: 'arr',
  'items.[]': 'str',
  groups: 'arr',
  'groups.[].values': 'arr',
  'groups.[].values.[]': 'str',
  entries: 'arr',
  'entries.[].value': 'str',
})

for (const [name, update] of [
  ['updateObject', updateObject],
  ['definition.update', definition.update],
]) {
  describe(`${name}: array deletions`, () => {
    it('round-trips a shorter array through getChanges without mutating the input', () => {
      const before = { items: ['weight', 'height', 'allergiesSummary'] }
      const after = { items: ['weight'] }
      const changes = getChanges(before, after)
      // These ascending tombstones used to leave the final entry undeleted.
      deepStrictEqual(changes, { 'items.[1]': null, 'items.[2]': null })
      deepStrictEqual(update(before, changes), after)
      deepStrictEqual(before, {
        items: ['weight', 'height', 'allergiesSummary'],
      })
      deepStrictEqual(changes, { 'items.[1]': null, 'items.[2]': null })
    })

    it('sorts deletion indexes numerically, including indexes above nine', () => {
      const before = {
        items: Array.from({ length: 12 }, (_, i) => `item-${i}`),
      }
      const after = { items: before.items.slice(0, 2) }
      deepStrictEqual(update(before, getChanges(before, after)), after)
    })

    it('deletes non-adjacent original indexes regardless of supplied order', () => {
      const before = { items: ['a', 'b', 'c', 'd'] }
      for (const changes of [
        { 'items.[1]': null, 'items.[3]': null },
        { 'items.[3]': null, 'items.[1]': null },
      ]) {
        deepStrictEqual(update(before, changes), { items: ['a', 'c'] })
      }
    })

    it('applies writes to original indexes before array deletions shift them', () => {
      const before = { items: ['a', 'b', 'c', 'd'] }
      deepStrictEqual(
        update(before, {
          'items.[1]': null,
          'items.[2]': 'C',
          'items.[3]': null,
        }),
        { items: ['a', 'C'] }
      )
    })

    it('round-trips deletions in nested arrays and their parent array', () => {
      const before = {
        groups: [
          { values: ['a', 'b', 'c'] },
          { values: ['d', 'e', 'f'] },
          { values: ['g', 'h', 'i'] },
        ],
      }
      const after = { groups: [{ values: ['a'] }] }
      deepStrictEqual(update(before, getChanges(before, after)), after)
    })

    it('handles nested deletions which clean up empty array entries', () => {
      const before = {
        entries: [{ value: 'a' }, { value: 'b' }, { value: 'c' }],
      }
      deepStrictEqual(
        update(before, {
          'entries.[1].value': null,
          'entries.[2].value': null,
        }),
        { entries: [{ value: 'a' }] }
      )
    })

    it('keeps original indexes when empty cleanup and null deletions are mixed', () => {
      const before = {
        entries: [{ value: 'a' }, { value: 'b' }, { value: 'c' }],
      }
      for (const emptyValue of [[], [null], [[], { unused: null }]]) {
        // Empty nested values remove their parent entry just like tombstones.
        for (const changes of [
          { 'entries.[1]': null, 'entries.[0].value': emptyValue },
          { 'entries.[0].value': emptyValue, 'entries.[1]': null },
        ]) {
          deepStrictEqual(update(before, changes), {
            entries: [{ value: 'c' }],
          })
        }
        deepStrictEqual(
          update(before, {
            'entries.[0]': null,
            'entries.[2].value': emptyValue,
          }),
          { entries: [{ value: 'b' }] }
        )
      }
      deepStrictEqual(before, {
        entries: [{ value: 'a' }, { value: 'b' }, { value: 'c' }],
      })
    })

    it('keeps ordinary object update ordering and no-op batches unchanged', () => {
      const before = { name: 'Before' }
      deepStrictEqual(update(before, null), before)
      deepStrictEqual(update(before, {}), before)
      // Object paths retain their existing sequential behavior.
      deepStrictEqual(
        update({}, { profile: null, 'profile.name': 'After' }, false),
        { profile: { name: 'After' } }
      )
    })
  })
}

it('keeps single-index setValue deletion behavior unchanged', () => {
  const before = { items: ['a', 'b', 'c'] }
  deepStrictEqual(setValue(before, 'items.[1]', null), { items: ['a', 'c'] })
  deepStrictEqual(before, { items: ['a', 'b', 'c'] })
})
