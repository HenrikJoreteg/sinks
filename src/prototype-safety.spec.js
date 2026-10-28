import { describe, it } from 'node:test'
import {
  deepStrictEqual,
  doesNotThrow,
  equal,
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

const definition = buildDefinition({
  note: 'str',
  injected: 'str',
  items: 'arr',
  'items.[].name': 'str',
  'records.{}.name': 'str',
  payload: 'obj',
})

const unsafeObjects = [
  '{"__proto__":{"injected":"forged"}}',
  '{"__proto__.injected":"forged"}',
  '{"constructor.prototype.injected":"forged"}',
  '{"records.prototype.name":"forged"}',
  '{"records":{"constructor":{"name":"forged"}}}',
  '{"items":[{"name":"ok","__proto__":{"injected":"forged"}}]}',
  '{"payload":{"prototype":{"injected":"forged"}}}',
  '{"\\u005f_proto__":{"injected":"forged"}}',
]

for (const [name, update] of [
  ['updateObject', updateObject],
  ['definition.update', definition.update],
  [
    'definition.update without validation',
    (obj, edits) => definition.update(obj, edits, false),
  ],
]) {
  describe(`${name}: prototype safety`, () => {
    it('rejects reserved segments in paths and nested values before any edit', () => {
      for (const json of unsafeObjects) {
        // Network JSON can contain an own __proto__ key unlike object literals.
        const edits = { note: 'changed', ...JSON.parse(json) }
        const before = { note: 'original', records: { empty: [] } }
        throws(() => update(before, edits), /INVALID reserved path segment/)
        deepStrictEqual(before, {
          note: 'original',
          records: { empty: [] },
        })
        equal({}.injected, undefined)
      }
    })

    it('rejects unsafe source data even when the update is a no-op', () => {
      for (const json of unsafeObjects) {
        throws(() => update(JSON.parse(json), {}), /INVALID/)
      }
    })

    it('rejects inherited data in source objects and update payloads', () => {
      const inherited = Object.create({ injected: 'forged' })
      inherited.note = 'own value'
      throws(() => update({}, inherited), /INVALID object prototype/)
      throws(
        () => update(inherited, { note: 'changed' }),
        /INVALID object prototype/
      )
      // A nested inherited value must not bypass the top-level check.
      throws(
        () => update({}, { payload: inherited }),
        /INVALID object prototype/
      )
      const inheritedArray = [{ name: 'one' }]
      Object.setPrototypeOf(inheritedArray, Object.create(Array.prototype))
      throws(
        () => update({}, { items: inheritedArray }),
        /INVALID object prototype/
      )
    })

    it('preserves ordinary edits, null-prototype inputs, and array deletions', () => {
      const edits = Object.assign(Object.create(null), {
        'records.id.name': 'one',
        items: [{ name: 'first' }, { name: 'second' }],
      })
      const first = update(Object.create(null), edits)
      const second = update(first, { 'items.[0]': null })
      deepStrictEqual(second, {
        records: { id: { name: 'one' } },
        items: [{ name: 'second' }],
      })
      deepStrictEqual(first.items, [{ name: 'first' }, { name: 'second' }])
    })
  })
}

for (const [name, set] of [
  ['setValue', setValue],
  ['definition.setValue', definition.setValue],
  [
    'definition.setValue without validation',
    (obj, path, value) => definition.setValue(obj, path, value, false),
  ],
]) {
  it(`${name} guards string and array paths and recursively checks values`, () => {
    for (const path of [
      '__proto__.injected',
      'constructor.prototype.injected',
      'records.prototype.name',
      ['__proto__', 'injected'],
      ['records', 'constructor', 'name'],
      ['records', 'prototype', 'name'],
    ]) {
      throws(() => set({}, path, 'forged'), /INVALID reserved path segment/)
    }
    for (const json of unsafeObjects) {
      throws(() => set({}, 'payload', JSON.parse(json)), /INVALID/)
      throws(() => set(JSON.parse(json), 'note', 'changed'), /INVALID/)
    }
    // Numeric array segments retain the public setter's existing behavior.
    deepStrictEqual(set({}, ['items', 0, 'name'], 'first'), {
      items: [{ name: 'first' }],
    })
  })
}

for (const [name, merge] of [
  ['mergeObjects', mergeObjects],
  ['definition.merge', definition.merge],
  [
    'definition.merge without validation',
    (one, two) => definition.merge(one, two, false),
  ],
]) {
  it(`${name} rejects unsafe data on either side, including identical inputs`, () => {
    for (const json of unsafeObjects) {
      const unsafe = JSON.parse(json)
      throws(() => merge({}, unsafe), /INVALID/)
      throws(() => merge(unsafe, {}), /INVALID/)
      throws(() => merge(unsafe, unsafe), /INVALID/)
    }
    const inherited = Object.create({ injected: 'forged' })
    throws(() => merge({}, inherited), /INVALID object prototype/)
    throws(() => merge(inherited, {}), /INVALID object prototype/)
  })
}

it('getChanges rejects unsafe inputs before generating reusable update paths', () => {
  for (const json of unsafeObjects) {
    const unsafe = JSON.parse(json)
    throws(() => getChanges({}, unsafe), /INVALID/)
    throws(() => getChanges(unsafe, {}), /INVALID/)
  }
})

it('retains function values while checking their own enumerable data', () => {
  const func = () => {}
  const functions = buildDefinition({ callback: 'func' })
  deepStrictEqual(functions.update({}, { callback: func }), { callback: func })
  // Functions can also carry update keys; they must not bypass batch preflight.
  func['__proto__.injected'] = 'forged'
  throws(() => updateObject({}, func), /INVALID/)
  throws(() => functions.update({}, { callback: func }, false), /INVALID/)
})

it('allows substrings of reserved names and object fields named pop', () => {
  const data = {
    constructorName: 'ordinary',
    prototypeId: 'ordinary',
    __proto__label: 'ordinary',
    payload: { pop: 'ordinary', name: 'before' },
  }
  deepStrictEqual(updateObject({}, data), data)
  deepStrictEqual(setValue(data, 'payload.name', 'after'), {
    ...data,
    payload: { pop: 'ordinary', name: 'after' },
  })
})

it('validation rejects reserved keys even inside opaque object fields', () => {
  for (const json of unsafeObjects) {
    throws(() => definition.validate(JSON.parse(json)), /INVALID/)
  }
  for (const path of [
    'constructor',
    'records.prototype.name',
    '__proto__.name',
  ]) {
    throws(() => buildDefinition({ [path]: 'str' }), /INVALID/)
  }
  throws(
    () => buildDefinition(Object.create({ note: 'str' })),
    /INVALID object prototype/
  )
})

it('only recognizes own schema entries and own type validators', () => {
  // Object.prototype methods are not implicitly declared schema paths.
  throws(
    () => buildDefinition({}).validate({ toString: 'data' }),
    /INVALID path/
  )
  const validators = Object.create({ inherited: () => true })
  validators.str = basicTypes.str
  const single = buildDefinition({ note: 'inherited' }, validators)
  const union = buildDefinition({ note: ['inherited', 'str'] }, validators)
  throws(() => single.validate({ note: 42 }), /INVALID type/)
  throws(() => union.validate({ note: 42 }), /INVALID/)
  doesNotThrow(() => union.validate({ note: 'valid' }))
})

it('diffs and merges ordinary keys that shadow Object.prototype methods', () => {
  const before = Object.assign(Object.create(null), {
    hasOwnProperty: 'before',
    toString: 'before',
  })
  const after = { hasOwnProperty: 'after', toString: 'after' }
  deepStrictEqual(getChanges(before, after), after)
  deepStrictEqual(updateObject(before, after), after)
  deepStrictEqual(mergeObjects(before, after), {
    updated: before,
    conflicts: {
      hasOwnProperty: ['before', 'after'],
      toString: ['before', 'after'],
    },
  })
  // Traversal must start a fresh branch instead of copying inherited methods.
  deepStrictEqual(setValue({}, 'toString.name', 'own'), {
    toString: { name: 'own' },
  })
})

it('ignores inherited enumerable properties throughout transformations', () => {
  // Simulate ambient pollution; always restore the shared prototype afterward.
  Object.defineProperty(Object.prototype, 'sinksInheritedProbe', {
    value: 'forged',
    enumerable: true,
    configurable: true,
  })
  try {
    const before = { note: 'before' }
    const after = { note: 'after' }
    deepStrictEqual(getChanges(before, after), after)
    deepStrictEqual(updateObject(before, after), after)
    deepStrictEqual(setValue(before, 'note', 'after'), after)
    deepStrictEqual(mergeObjects(before, after), {
      updated: before,
      conflicts: { note: ['before', 'after'] },
    })
    doesNotThrow(() => definition.validate(after))
    deepStrictEqual(definition.update(before, after), after)
    deepStrictEqual(definition.setValue(before, 'note', 'after'), after)
    equal(Object.hasOwn(after, 'sinksInheritedProbe'), false)
  } finally {
    delete Object.prototype.sinksInheritedProbe
  }
})

it('does not clean inherited entries in sparse arrays', () => {
  const inherited = { name: 'inherited', untouched: null }
  Object.defineProperty(Array.prototype, '100', {
    value: inherited,
    writable: true,
    enumerable: true,
    configurable: true,
  })
  try {
    const items = []
    items[101] = { name: 'own' }
    // Cleanup must skip holes rather than mutate the inherited entry.
    const updated = setValue({}, 'items', items)
    equal(Object.hasOwn(updated.items, 100), false)
    deepStrictEqual(inherited, { name: 'inherited', untouched: null })
    deepStrictEqual(updated.items[101], { name: 'own' })
  } finally {
    delete Array.prototype[100]
  }
})
