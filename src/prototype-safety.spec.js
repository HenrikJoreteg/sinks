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

describe('prototype-safe updates', () => {
  for (const [name, update] of [
    ['updateObject', updateObject],
    ['definition.update', definition.update],
    [
      'definition.update without validation',
      (obj, edits) => definition.update(obj, edits, false),
    ],
  ]) {
    it(`${name} keeps nested __proto__ keys as own data`, () => {
      const payload = JSON.parse(
        '{"__proto__":{"injected":"data"},"note":"own"}'
      )
      const first = update({}, { payload })
      const second = update(first, { 'payload.note': 'changed' })
      strictEqual(Object.getPrototypeOf(first.payload), Object.prototype)
      strictEqual(Object.getPrototypeOf(second.payload), Object.prototype)
      strictEqual(hasOwn(second.payload, '__proto__'), true)
      strictEqual(hasOwn(second.payload, 'injected'), false)
      deepStrictEqual(second.payload.__proto__, { injected: 'data' })
      strictEqual(Object.prototype.injected, undefined)
    })
  }

  it('keeps top-level __proto__ keys safe across subsequent updates', () => {
    const edits = JSON.parse('{"__proto__":{"injected":"data"}}')
    const first = updateObject({}, edits)
    const second = updateObject(first, { note: 'changed' })
    strictEqual(Object.getPrototypeOf(first), Object.prototype)
    strictEqual(Object.getPrototypeOf(second), Object.prototype)
    strictEqual(hasOwn(second, '__proto__'), true)
    strictEqual(hasOwn(second, 'injected'), false)
    deepStrictEqual(second.__proto__, { injected: 'data' })
    strictEqual(Object.prototype.injected, undefined)
  })

  for (const [name, set] of [
    ['setValue', setValue],
    ['definition.setValue', definition.setValue],
    [
      'definition.setValue without validation',
      (obj, path, value) => definition.setValue(obj, path, value, false),
    ],
  ]) {
    it(`${name} never follows inherited prototype or constructor branches`, () => {
      for (const [path, key] of [
        ['payload.__proto__.injected', '__proto__'],
        ['payload.constructor.prototype.injected', 'constructor'],
        [['payload', '__proto__', 'injected'], '__proto__'],
      ]) {
        const result = set({}, path, 'data')
        strictEqual(Object.getPrototypeOf(result.payload), Object.prototype)
        strictEqual(Object.prototype.injected, undefined)
        strictEqual(hasOwn(result.payload, key), true)
      }
    })
  }

  it('replaces a function branch without following its prototype', () => {
    function supplied() {}
    const before = { constructor: supplied }
    deepStrictEqual(
      setValue(before, 'constructor.prototype.injected', 'data'),
      {
        constructor: { prototype: { injected: 'data' } },
      }
    )
    strictEqual(hasOwn(supplied.prototype, 'injected'), false)
    strictEqual(before.constructor, supplied)
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
    Object.defineProperty(items, '__proto__', {
      value: 'literal',
      enumerable: true,
      configurable: true,
      writable: true,
    })
    items.label = 'metadata'
    const first = setValue({ items }, 'items.[0]', 'changed')
    const second = setValue(first, 'items.[2]', 'last')
    strictEqual(Object.getPrototypeOf(second.items), Array.prototype)
    strictEqual(second.items.__proto__, 'literal')
    strictEqual(second.items.label, 'metadata')
    strictEqual(hasOwn(second.items, 1), false)
    strictEqual(second.items[2], 'last')
    strictEqual(items[0], 'one')
    strictEqual(items[2], 'three')
  })

  it('round-trips literal prototype keys through diffs and merge conflicts', () => {
    const before = JSON.parse(
      '{"__proto__":{"note":"old"},"constructor":{"prototype":{"note":"old"}},"hasOwnProperty":"old"}'
    )
    const after = JSON.parse(
      '{"__proto__":{"note":"new"},"constructor":{"prototype":{"note":"new"}},"hasOwnProperty":"new"}'
    )
    const changes = getChanges(before, after)
    deepStrictEqual(updateObject(before, changes), after)
    const merged = mergeObjects(before, after)
    deepStrictEqual(merged.updated, before)
    deepStrictEqual(merged.conflicts, {
      '__proto__.note': ['old', 'new'],
      'constructor.prototype.note': ['old', 'new'],
      hasOwnProperty: ['old', 'new'],
    })
    strictEqual(Object.getPrototypeOf(changes), Object.prototype)
    strictEqual(Object.getPrototypeOf(merged.updated), Object.prototype)
    const nullPrototype = Object.assign(Object.create(null), { note: 'data' })
    deepStrictEqual(getChanges({}, nullPrototype), { note: 'data' })
  })

  it('defines scalar __proto__ changes and conflicts as own properties', () => {
    const before = JSON.parse('{"__proto__":"old"}')
    const after = JSON.parse('{"__proto__":"new"}')
    const changes = getChanges(before, after)
    deepStrictEqual(changes, after)
    deepStrictEqual(updateObject(before, changes), after)
    const conflicts = mergeObjects(before, after).conflicts
    strictEqual(hasOwn(conflicts, '__proto__'), true)
    deepStrictEqual(conflicts.__proto__, ['old', 'new'])
    strictEqual(Object.getPrototypeOf(conflicts), Object.prototype)
    deepStrictEqual(updateObject(after, getChanges(after, {})), {})
  })

  it('uses only explicitly supplied schema fields and type validators', () => {
    const fields = buildDefinition(
      JSON.parse('{"__proto__.note":"str","constructor.prototype.note":"str"}')
    )
    const data = JSON.parse(
      '{"__proto__":{"note":"one"},"constructor":{"prototype":{"note":"two"}}}'
    )
    doesNotThrow(() => fields.validate(data))
    deepStrictEqual(fields.update({}, getChanges({}, data)), data)
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
      { constructor: 'constructor' },
      { constructor: basicTypes.str }
    )
    doesNotThrow(() => custom.validate({ constructor: 'data' }))
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

  it('does not materialize inherited entries when splicing sparse arrays', () => {
    const inherited = { note: 'inherited', empty: null }
    const prototype = Object.create(Array.prototype)
    prototype[1] = inherited
    const makeItems = () => {
      const items = [null, null, 'own']
      delete items[1]
      Object.setPrototypeOf(items, prototype)
      return items
    }
    const cleaned = setValue({}, 'items', makeItems()).items
    strictEqual(cleaned.length, 2)
    strictEqual(hasOwn(cleaned, 0), false)
    strictEqual(cleaned[1], 'own')
    const deleted = setValue({ items: makeItems() }, 'items.[0]', null).items
    strictEqual(hasOwn(deleted, 0), false)
    strictEqual(deleted[1], 'own')
    deepStrictEqual(inherited, { note: 'inherited', empty: null })
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
