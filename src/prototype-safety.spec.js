import { describe, it } from 'node:test'
import {
  deepStrictEqual,
  doesNotThrow,
  strictEqual,
  throws,
} from 'node:assert/strict'
import {
  basicTypes,
  buildDefinition,
  getChanges,
  mergeObjects,
  setValue,
  updateObject,
} from './index.js'
import { hasOwn } from './utils.js'

const definition = buildDefinition({ payload: 'obj', note: 'str' })
const forbiddenKeys = ['__proto__', 'constructor', 'prototype']
const setters = [
  ['setValue', setValue],
  ['definition.setValue', definition.setValue],
  [
    'definition.setValue without validation',
    (obj, path, value) => definition.setValue(obj, path, value, false),
  ],
  ['updateObject', (obj, path, value) => updateObject(obj, { [path]: value })],
  [
    'definition.update',
    (obj, path, value) => definition.update(obj, { [path]: value }),
  ],
  [
    'definition.update without validation',
    (obj, path, value) => definition.update(obj, { [path]: value }, false),
  ],
]

describe('reserved prototype keys', () => {
  for (const [name, set] of setters) {
    for (const key of forbiddenKeys) {
      it(`${name} rejects ${key} at every depth, including deletion paths`, () => {
        const before = { payload: { note: 'original' } }
        for (const path of [key, `payload.${key}`, `payload.${key}.note`]) {
          for (const value of ['data', null]) {
            throws(() => set(before, path, value), {
              message: 'Forbidden key: ' + key,
            })
          }
        }
        deepStrictEqual(before, { payload: { note: 'original' } })
        strictEqual(Object.prototype.note, undefined)
      })

      it(`${name} rejects nested ${key} values before cleaning the payload`, () => {
        for (const value of ['data', null, {}]) {
          const payload = { empty: null, nested: [{ [key]: value }] }
          throws(() => set({}, 'payload', payload), {
            message: 'Forbidden key: ' + key,
          })
          deepStrictEqual(payload, { empty: null, nested: [{ [key]: value }] })
        }
      })

      it(`${name} checks array metadata and objects inside metadata`, () => {
        for (const payload of [
          Object.defineProperty(['data'], key, {
            value: 'metadata',
            enumerable: true,
          }),
          Object.assign(['data'], { metadata: { [key]: 'nested' } }),
        ]) {
          throws(() => set({}, 'payload', payload), {
            message: 'Forbidden key: ' + key,
          })
        }
      })
    }
  }

  for (const key of forbiddenKeys) {
    it(`rejects array-form and coerced ${key} path segments`, () => {
      for (const set of [setValue, definition.setValue]) {
        for (const segment of [key, Object(key), { toString: () => key }]) {
          throws(() => set({}, ['payload', segment, 'note'], 'data'), {
            message: 'Forbidden key: ' + key,
          })
        }
      }
    })

    it(`rejects ${key} in source containers being copied`, () => {
      for (const source of [
        { [key]: 'data' },
        Object.defineProperty([], key, { value: 'data', enumerable: true }),
      ]) {
        throws(() => setValue(source, 'note', 'new'), {
          message: 'Forbidden key: ' + key,
        })
      }
      throws(() => setValue({ payload: { [key]: 'data' } }, 'note', 'new'), {
        message: 'Forbidden key: ' + key,
      })
    })

    it(`rejects ${key} in explicit and wildcard schema paths`, () => {
      for (const path of [
        key,
        `payload.${key}.note`,
        `payload.{}.${key}`,
        `payload.[].${key}`,
      ]) {
        throws(() => buildDefinition({ [path]: 'str' }), {
          message: 'Forbidden key: ' + key,
        })
      }
    })

    it(`rejects ${key} when validating nested data and opaque objects`, () => {
      const fields = buildDefinition({ 'payload.{}.note': 'str' })
      for (const validate of [fields.validate, definition.validate]) {
        throws(() => validate({ payload: { [key]: { note: 'data' } } }), {
          message: 'Forbidden key: ' + key,
        })
      }
      throws(() => definition.validate({ [key]: null }), {
        message: 'Forbidden key: ' + key,
      })
      const payload = Object.assign(['data'], { metadata: { [key]: 'data' } })
      throws(() => definition.validate({ payload }), {
        message: 'Forbidden key: ' + key,
      })
    })

    it(`rejects ${key} while diffing or merging changed data`, () => {
      const before = { payload: { [key]: 'old' } }
      const after = { payload: { [key]: 'new' } }
      for (const run of [getChanges, mergeObjects, definition.merge]) {
        throws(() => run(before, after), {
          message: 'Forbidden key: ' + key,
        })
      }
      throws(() => getChanges({ [key]: 'old' }, {}), {
        message: 'Forbidden key: ' + key,
      })
    })
  }

  it('allows similar names and reserved names as string values', () => {
    const data = {
      prototypeId: '__proto__',
      Constructor: 'constructor',
      __proto__suffix: 'prototype',
      hasOwnProperty: 'data',
      toString: 'literal',
    }
    const fields = buildDefinition(
      Object.fromEntries(Object.keys(data).map(key => [key, 'str']))
    )
    deepStrictEqual(fields.update({}, data), data)
    deepStrictEqual(updateObject({}, getChanges({}, data)), data)
    const nullPrototype = Object.assign(Object.create(null), { note: 'data' })
    deepStrictEqual(getChanges({}, nullPrototype), { note: 'data' })
  })

  it('replaces function branches without copying their properties', () => {
    function supplied() {}
    supplied.details = { previous: 'data' }
    const before = { payload: supplied }
    deepStrictEqual(setValue(before, 'payload.details.note', 'new'), {
      payload: { details: { note: 'new' } },
    })
    deepStrictEqual(supplied.details, { previous: 'data' })
    strictEqual(before.payload, supplied)
  })

  it('copies into fresh containers without invoking inherited setters', () => {
    let calls = 0
    Object.defineProperty(Object.prototype, 'sinksSetterProbe', {
      configurable: true,
      set() {
        calls++
      },
    })
    try {
      const before = JSON.parse('{"sinksSetterProbe":"own","items":["one"]}')
      Object.defineProperty(before.items, 'sinksSetterProbe', {
        value: 'array metadata',
        enumerable: true,
      })
      const result = setValue(before, 'items.[1]', 'two')
      strictEqual(calls, 0)
      strictEqual(hasOwn(result, 'sinksSetterProbe'), true)
      strictEqual(result.sinksSetterProbe, 'own')
      strictEqual(Object.getPrototypeOf(result), Object.prototype)
      strictEqual(Object.getPrototypeOf(result.items), Array.prototype)
      strictEqual(result.items.sinksSetterProbe, 'array metadata')
      deepStrictEqual(Array.from(result.items), ['one', 'two'])
    } finally {
      delete Object.prototype.sinksSetterProbe
    }
  })

  it('preserves own array metadata and holes through repeated copies', () => {
    const items = ['one', 'two', 'three']
    delete items[1]
    items.label = 'metadata'
    const first = setValue({ items }, 'items.[0]', 'changed')
    const second = setValue(first, 'items.[2]', 'last')
    strictEqual(Object.getPrototypeOf(second.items), Array.prototype)
    strictEqual(second.items.label, 'metadata')
    strictEqual(hasOwn(second.items, 1), false)
    strictEqual(second.items[2], 'last')
    strictEqual(items[0], 'one')
    strictEqual(items[2], 'three')
  })

  it('uses only explicitly supplied schema fields and type validators', () => {
    throws(
      () => buildDefinition({}).validate({ toString: 'data' }),
      /INVALID path/
    )
    throws(
      () => buildDefinition({ note: 'constructor' }).validate({ note: 'data' }),
      /INVALID type/
    )
    const validators = Object.create({ inherited: () => true })
    validators.str = basicTypes.str
    throws(
      () =>
        buildDefinition({ note: 'inherited' }, validators).validate({
          note: 'data',
        }),
      /INVALID type/
    )
    const custom = buildDefinition(
      { note: 'constructor' },
      { constructor: basicTypes.str }
    )
    doesNotThrow(() => custom.validate({ note: 'data' }))
  })

  it('ignores inherited fields in copying, diffing, cleanup, and validation', () => {
    const inherited = { empty: null, note: 'inherited' }
    const payload = Object.create({ inherited })
    payload.note = 'own'
    deepStrictEqual(setValue({ payload }, 'payload.note', 'changed'), {
      payload: { note: 'changed' },
    })
    deepStrictEqual(getChanges({}, { payload }), { 'payload.note': 'own' })
    doesNotThrow(() => definition.validate({ payload }))
    deepStrictEqual(inherited, { empty: null, note: 'inherited' })
    const edits = Object.create({ injected: 'inherited' })
    edits.note = 'own'
    deepStrictEqual(updateObject({}, edits), { note: 'own' })
  })

  it('deletes array entries using the built-in splice when splice is a data key', () => {
    const metadata = { splice: 'literal' }
    const items = Object.assign([null, 'first', 'second'], metadata)
    const cleaned = setValue({}, 'items', items)
    deepStrictEqual(cleaned.items, Object.assign(['first', 'second'], metadata))
    const deleted = setValue(cleaned, 'items.[0]', null)
    deepStrictEqual(deleted.items, Object.assign(['second'], metadata))
  })

  it('retains non-JSON values, existing validators, and array writes', () => {
    const callback = () => {}
    const date = Object.assign(new Date(0), { note: 'date' })
    const result = updateObject(
      {},
      {
        callback,
        missing: undefined,
        amount: NaN,
        infinite: Infinity,
        payload: { date },
      }
    )
    strictEqual(result.callback, callback)
    strictEqual(hasOwn(result, 'missing'), true)
    strictEqual(Number.isNaN(result.amount), true)
    strictEqual(result.infinite, Infinity)
    strictEqual(result.payload.date, date)
    strictEqual(basicTypes.func(callback), true)
    strictEqual(basicTypes.num(NaN), true)
    strictEqual(basicTypes.num(Infinity), true)
    deepStrictEqual(setValue({ items: ['one', 'two'] }, 'items.length', 1), {
      items: ['one'],
    })
    const sparse = setValue({}, 'items.[2]', 'value').items
    strictEqual(sparse.length, 3)
    strictEqual(hasOwn(sparse, 0), false)
    strictEqual(sparse[2], 'value')
  })

  it('preserves native deletion indexes for ordinary arrays', () => {
    for (const index of [
      0,
      1,
      -1,
      -10,
      1.9,
      99,
      NaN,
      Infinity,
      -Infinity,
      'missing',
    ]) {
      const items = ['zero', 'one', 'two']
      const expected = items.slice()
      expected.splice(index, 1)
      const result = setValue({ items }, ['items', index], null)
      deepStrictEqual(result.items, expected)
      deepStrictEqual(items, ['zero', 'one', 'two'])
    }
  })
})
