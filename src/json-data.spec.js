/* global BigInt */
import { describe, it } from 'node:test'
import {
  deepStrictEqual,
  doesNotThrow,
  strictEqual,
  throws,
} from 'node:assert/strict'
import {
  buildDefinition,
  getChanges,
  mergeObjects,
  setValue,
  updateObject,
} from './index.js'

const definition = buildDefinition({ payload: 'obj', note: 'str' })

const invalidValues = [
  ['undefined', () => undefined],
  ['function', () => () => {}],
  ['symbol', () => Symbol('value')],
  ['BigInt', () => BigInt(1)],
  ['NaN', () => NaN],
  ['infinity', () => Infinity],
  ['negative infinity', () => -Infinity],
  ['Date', () => new Date(0)],
  ['Map', () => new Map()],
  ['Set', () => new Set()],
  ['RegExp', () => /value/],
  ['typed array', () => new Uint8Array([1])],
  ['class instance', () => new (class Data {})()],
  ['sparse array', () => new Array(2)],
  ['named array property', () => Object.assign(['value'], { note: 'lost' })],
  [
    'sparse array with a named property',
    () => Object.assign(new Array(1), { note: 'lost' }),
  ],
  ['symbol key', () => ({ [Symbol('lost')]: 'value' })],
  [
    'accessor',
    () => ({
      get note() {
        return 'value'
      },
    }),
  ],
  [
    'custom serialization',
    () => Object.defineProperty({}, 'toJSON', { value: () => 'different' }),
  ],
  [
    'object cycle',
    () => {
      const value = {}
      value.self = value
      return value
    },
  ],
  [
    'array cycle',
    () => {
      const value = []
      value.push(value)
      return value
    },
  ],
]

describe('JSON-compatible data', () => {
  for (const [name, makeValue] of invalidValues) {
    it(`rejects ${name} in incoming edits and explicit validation`, () => {
      const value = makeValue()
      const data = { payload: value }

      // Incoming edits are always checked, even with schema validation off.
      const operations = [
        () => setValue({}, 'payload', value),
        () => definition.setValue({}, 'payload', value),
        () => definition.setValue({}, 'payload', value, false),
        () => updateObject({}, data),
        () => definition.update({}, data),
        () => definition.update({}, data, false),
        () => definition.validate(data),
        () => buildDefinition({ note: value }),
      ]
      for (const operation of operations) throws(operation, /INVALID/)
    })
  }

  it('preserves JSON values, null-prototype objects, and shared references', () => {
    const shared = { text: 'value', count: 1.5, enabled: false }
    const payload = Object.assign(Object.create(null), {
      first: shared,
      second: shared,
      items: [shared, 'text', true, 0],
    })
    const updated = definition.update({}, { payload })
    doesNotThrow(() => definition.validate(updated))
    strictEqual(updated.payload.first, updated.payload.second)
    deepStrictEqual(JSON.parse(JSON.stringify(updated)), {
      payload: {
        first: shared,
        second: shared,
        items: [shared, 'text', true, 0],
      },
    })
    deepStrictEqual(getChanges(updated, updated), null)
  })

  it('keeps missing object arguments and no-op update batches convenient', () => {
    deepStrictEqual(setValue(undefined, 'note', 'value'), { note: 'value' })
    deepStrictEqual(updateObject(undefined, { note: 'value' }), {
      note: 'value',
    })
    deepStrictEqual(definition.update(undefined, { note: 'value' }), {
      note: 'value',
    })
    deepStrictEqual(updateObject(), {})
    deepStrictEqual(definition.update(), {})
    deepStrictEqual(getChanges(undefined, { note: 'value' }), { note: 'value' })
    deepStrictEqual(getChanges({ note: 'value' }, undefined), { note: null })
    deepStrictEqual(getChanges(), null)
    deepStrictEqual(mergeObjects(), { updated: {} })
    deepStrictEqual(definition.merge(undefined, { note: 'value' }), {
      updated: { note: 'value' },
    })
    doesNotThrow(() => definition.validate())
    const before = { note: 'value' }
    strictEqual(updateObject(before, undefined), before)
    strictEqual(definition.update(before, null), before)
    // Undefined as an actual field value is still invalid.
    throws(() => setValue(before, 'note', undefined), /JSON-compatible/)
  })

  it('keeps null tombstones and empty-container cleanup', () => {
    deepStrictEqual(updateObject({ note: 'before' }, { note: null }), {})
    deepStrictEqual(setValue({}, 'payload', [null, {}, [], { note: 'keep' }]), {
      payload: [{ note: 'keep' }],
    })
  })

  it('checks the full incoming batch before applying any edit', () => {
    const before = { payload: { empty: [] } }
    throws(
      () =>
        updateObject(before, { note: 'changed', payload: { bad: undefined } }),
      /JSON-compatible/
    )
    deepStrictEqual(before, { payload: { empty: [] } })
  })

  it('uses explicit validation to check loaded state, including untouched branches', () => {
    const before = { payload: { legacy: () => {} } }
    throws(() => definition.validate(before), /JSON-compatible/)
    // No-op operations are not a substitute for validating loaded state.
    strictEqual(updateObject(before, {}), before)
    strictEqual(definition.update(before, null, false), before)
    strictEqual(mergeObjects(before, before).updated, before)
    strictEqual(getChanges(before, before), null)
    strictEqual(getChanges({}, before, { ignoredKeys: ['payload'] }), null)
  })

  it('cleans frozen source and incoming data without changing either input', () => {
    const shared = Object.freeze({ note: 'keep', empty: Object.freeze([]) })
    const before = Object.freeze({
      payload: Object.freeze({ first: shared, second: shared }),
    })
    const items = Object.freeze([null, Object.freeze({}), shared])
    const edits = Object.freeze({ 'payload.items': items, note: 'changed' })
    const result = updateObject(before, edits)
    deepStrictEqual(result, {
      payload: {
        first: { note: 'keep' },
        second: { note: 'keep' },
        items: [{ note: 'keep' }],
      },
      note: 'changed',
    })
    strictEqual(result.payload.first, result.payload.second)
    strictEqual(result.payload.first, result.payload.items[0])
    strictEqual(before.payload.first, shared)
    deepStrictEqual(shared.empty, [])
    strictEqual(items.length, 3)
    strictEqual(items[0], null)
  })

  it('preserves unchanged branches while cleaning multiple updates', () => {
    const keep = Object.freeze({ note: 'same' })
    const before = Object.freeze({ payload: Object.freeze({ keep }) })
    const result = updateObject(before, {
      'payload.first': { empty: [], note: 'one' },
      'payload.second': { empty: {}, note: 'two' },
    })
    strictEqual(result.payload.keep, keep)
    deepStrictEqual(result.payload.first, { note: 'one' })
    deepStrictEqual(result.payload.second, { note: 'two' })
    deepStrictEqual(before, { payload: { keep } })
  })

  it('rejects accessors without invoking their code', () => {
    let calls = 0
    const payload = Object.defineProperty({}, 'note', {
      enumerable: true,
      get: () => {
        calls++
        return 'value'
      },
    })
    throws(() => definition.update({}, { payload }), /INVALID JSON data/)
    strictEqual(calls, 0)
  })

  it('requires string or data-array paths without calling input-owned methods', () => {
    let calls = 0
    const path = {
      split: () => {
        calls++
        return ['note']
      },
    }
    throws(() => setValue({}, path, 'value'), /INVALID path/)
    strictEqual(calls, 0)

    const arrayPath = ['payload', 'note']
    Object.defineProperty(arrayPath, 'map', { value: () => ['__proto__'] })
    deepStrictEqual(setValue({}, arrayPath, 'value'), {
      payload: { note: 'value' },
    })
  })

  it('reports the field path when JSON data is invalid', () => {
    throws(
      () => definition.update({}, { 'payload.amount': Infinity }, false),
      /INVALID payload\.amount: non-finite number/
    )
    throws(
      () => definition.validate({ payload: { note: undefined } }),
      /INVALID payload\.note: undefined/
    )
  })

  it('keeps validator functions as configuration while rejecting function data', () => {
    const positive = buildDefinition(
      { value: 'positive' },
      {
        positive: value => typeof value === 'number' && value > 0,
      }
    )
    deepStrictEqual(positive.update({}, { value: 2 }), { value: 2 })
    throws(() => positive.update({}, { value: -1 }), /INVALID value/)

    const permissive = buildDefinition(
      { value: 'anything' },
      { anything: () => true }
    )
    throws(() => permissive.update({}, { value: () => {} }), /JSON-compatible/)
  })

  it('allows replacement and append array paths without creating holes', () => {
    const before = { payload: ['first'] }
    deepStrictEqual(setValue(before, 'payload.[0]', 'changed'), {
      payload: ['changed'],
    })
    deepStrictEqual(setValue(before, ['payload', 1], 'second'), {
      payload: ['first', 'second'],
    })
    deepStrictEqual(setValue({}, 'payload.[0].note', 'value'), {
      payload: [{ note: 'value' }],
    })
    deepStrictEqual(
      setValue({ payload: { old: 'object' } }, 'payload.[0]', 'new'),
      {
        payload: ['new'],
      }
    )
    const after = { payload: ['changed', 'second'] }
    deepStrictEqual(updateObject(before, getChanges(before, after)), after)
    for (const path of [
      'payload.[2]',
      'payload.[2].note',
      'payload.name',
      'payload.length',
      'payload.[0]suffix',
      ['payload', -1],
      ['payload', 0.5],
      ['payload', NaN],
      ['payload', Infinity],
    ]) {
      throws(() => setValue(before, path, 'value'), /INVALID/)
    }
    deepStrictEqual(before, { payload: ['first'] })
  })
})
