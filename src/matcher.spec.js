import { it } from 'node:test'
import { doesNotThrow, throws } from 'node:assert/strict'
import { buildDefinition } from './index.js'

it('preserves prefix and wildcard precedence when schemas overlap', () => {
  for (const entries of [
    [
      ['records.{}.note', 'str'],
      ['records.special.{}', 'num'],
      ['records.[].note', 'bool'],
    ],
    [
      ['records.special.{}', 'num'],
      ['records.{}.note', 'str'],
      ['records.[].note', 'bool'],
    ],
  ]) {
    const definition = buildDefinition(Object.fromEntries(entries))
    const note = entries[0][1] === 'str' ? 'text' : 42
    doesNotThrow(() => definition.validate({ records: { special: { note } } }))
    throws(
      () => definition.validate({ records: { special: { note: true } } }),
      /INVALID records.special.note/
    )
    // Both {} and [] match this segment; the first wildcard still wins.
    doesNotThrow(() => definition.validate({ records: [{ note: 'text' }] }))
    throws(
      () => definition.validate({ records: [{ note: true }] }),
      /INVALID records.0.note/
    )
  }
})

it('keeps exact paths ahead of compiled wildcards and reads their current type', () => {
  const schema = {
    'records.{}.note': 'str',
    'records.special.note': 'bool',
  }
  const definition = buildDefinition(schema)
  doesNotThrow(() =>
    definition.validate({ records: { special: { note: true } } })
  )
  throws(
    () => definition.validate({ records: { special: { note: 'text' } } }),
    /INVALID records.special.note/
  )
  schema['records.special.note'] = 'num'
  doesNotThrow(() =>
    definition.validate({ records: { special: { note: 42 } } })
  )
})

it('selects candidates by prefix and depth across repeated validations', () => {
  const definition = buildDefinition({
    'records.{}.note': 'str',
    'recordsmore.{}.note': 'bool',
    'records.{}.metrics.value': 'num',
  })
  for (const id of ['first', 'second']) {
    doesNotThrow(() =>
      definition.validate({
        records: { [id]: { note: 'text', metrics: { value: 42 } } },
        recordsmore: { [id]: { note: true } },
      })
    )
  }
  throws(
    () => definition.validate({ recordsmore: { first: { note: 'text' } } }),
    /INVALID recordsmore.first.note/
  )
  throws(
    () =>
      definition.validate({ records: { first: { extra: { note: 'text' } } } }),
    /INVALID path: records.first.extra.note/
  )
})
