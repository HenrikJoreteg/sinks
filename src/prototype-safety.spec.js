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
  'items.[].constructor': 'str',
  'items.[].prototype': 'str',
  'records.{}.name': 'str',
  'constructor.prototype.injected': 'str',
  payload: 'obj',
})

const unsafeObjects = [
  '{"__proto__":{"injected":"forged"}}',
  '{"__proto__.injected":"forged"}',
  '{"constructor.prototype.__proto__.injected":"forged"}',
  '{"records":{"constructor":{"__proto__":{"injected":"forged"}}}}',
  '{"items":[{"name":"ok","__proto__":{"injected":"forged"}}]}',
  '{"payload":{"prototype":{"__proto__":{"injected":"forged"}}}}',
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

    it('rejects reserved source keys when copying existing data', () => {
      for (const json of unsafeObjects) {
        throws(() => update(JSON.parse(json), { note: 'changed' }), /INVALID/)
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

    it('round-trips constructor and prototype fields through generated paths', () => {
      const before = {
        records: {
          constructor: { name: 'before' },
          prototype: { name: 'before' },
        },
        payload: { constructor: 'before', prototype: { name: 'before' } },
      }
      const after = {
        records: {
          constructor: { name: 'after' },
          prototype: { name: 'after' },
        },
        payload: { constructor: 'after', prototype: { name: 'after' } },
        items: [{ name: 'one', constructor: 'literal', prototype: 'literal' }],
      }
      // Sync must accept the same keys in nested data and generated dotted paths.
      doesNotThrow(() => definition.validate(before))
      doesNotThrow(() => definition.validate(after))
      deepStrictEqual(update({}, after), after)
      deepStrictEqual(update(before, getChanges(before, after)), after)
      deepStrictEqual(before.records.constructor, { name: 'before' })
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
      'constructor.prototype.__proto__.injected',
      ['__proto__', 'injected'],
      ['records', 'constructor', '__proto__', 'name'],
      ['records', 'prototype', '__proto__', 'name'],
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

  it(`${name} edits literal constructor and prototype IDs without following inheritance`, () => {
    for (const key of ['constructor', 'prototype']) {
      for (const path of [`records.${key}.name`, ['records', key, 'name']]) {
        deepStrictEqual(set({}, path, 'data'), {
          records: { [key]: { name: 'data' } },
        })
      }
    }
    // An absent own constructor starts a data branch instead of resolving Object.
    deepStrictEqual(set({}, 'constructor.prototype.injected', 'data'), {
      constructor: { prototype: { injected: 'data' } },
    })
    equal(Object.hasOwn(Object.prototype, 'injected'), false)
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
  it(`${name} guards keys used to generate and apply changes`, () => {
    for (const json of unsafeObjects) {
      const unsafe = JSON.parse(json)
      throws(() => merge({}, unsafe), /INVALID/)
    }
    const inherited = Object.create({ injected: 'forged' })
    throws(() => merge({}, inherited), /INVALID object prototype/)
    throws(() => merge(inherited, {}), /INVALID object prototype/)
  })

  it(`${name} preserves literal fields and reports their conflicts`, () => {
    const first = {
      records: { constructor: { name: 'first' } },
      payload: { constructor: { prototype: { name: 'first' } } },
    }
    const second = {
      records: { constructor: { name: 'second' }, prototype: { name: 'new' } },
      payload: { constructor: { prototype: { name: 'second' } } },
    }
    deepStrictEqual(merge(first, second), {
      updated: {
        ...first,
        records: { constructor: { name: 'first' }, prototype: { name: 'new' } },
      },
      conflicts: {
        'records.constructor.name': ['first', 'second'],
        'payload.constructor.prototype.name': ['first', 'second'],
      },
    })
    equal(Object.hasOwn(Object.prototype, 'name'), false)
  })
}

it('getChanges rejects reserved keys before generating reusable update paths', () => {
  for (const json of unsafeObjects) {
    const unsafe = JSON.parse(json)
    throws(() => getChanges({}, unsafe), /INVALID/)
  }
})

it('rejects functions as both data values and update batches', () => {
  const func = () => {}
  const functions = buildDefinition(
    { callback: 'anything' },
    {
      anything: () => true,
    }
  )
  throws(() => functions.update({}, { callback: func }), /JSON-compatible/)
  func['__proto__.injected'] = 'forged'
  throws(() => updateObject({}, func), /INVALID/)
  throws(() => functions.update({}, { callback: func }, false), /INVALID/)
})

it('rejects function branches without visiting or mutating their prototypes', () => {
  function supplied() {}
  supplied.extra = { name: 'function metadata' }
  const before = { constructor: supplied }
  for (const constructor of [supplied, Object, Array, Function]) {
    throws(
      () => setValue({ constructor }, 'constructor.prototype.injected', 'data'),
      /JSON-compatible/
    )
    equal(Object.hasOwn(constructor.prototype, 'injected'), false)
  }
  // Replacing or removing a legacy function does not follow its properties.
  deepStrictEqual(getChanges(before, {}), { constructor: null })
  deepStrictEqual(setValue(before, 'constructor', {}), {})
  deepStrictEqual(supplied.extra, { name: 'function metadata' })
  equal(before.constructor, supplied)
})

it('supports explicit schema fields and type names called constructor and prototype', () => {
  const fields = buildDefinition(
    { constructor: 'constructor', prototype: 'prototype' },
    { constructor: basicTypes.str, prototype: basicTypes.str }
  )
  deepStrictEqual(fields.update({}, { constructor: 'one', prototype: 'two' }), {
    constructor: 'one',
    prototype: 'two',
  })
  // An inherited Object constructor must never be mistaken for a type validator.
  throws(
    () => buildDefinition({ note: 'constructor' }).validate({ note: 'x' }),
    /INVALID type/
  )
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
  for (const path of ['__proto__.name', 'records.constructor.__proto__.name']) {
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

it('rejects sparse arrays before cleanup can copy or mutate inherited entries', () => {
  const inherited = { name: 'inherited', untouched: null }
  Object.defineProperty(Array.prototype, '100', {
    value: inherited,
    writable: true,
    enumerable: true,
    configurable: true,
  })
  try {
    const items = Array.from({ length: 102 }, () => ({ name: 'own' }))
    delete items[100]
    // Reject before splice could materialize index 100 as an own entry.
    throws(() => setValue({}, 'items', items), /INVALID array/)
    // Existing arrays are also checked before the setter's explicit splice.
    throws(() => setValue({ items }, 'items.[99]', null), /INVALID array/)
    equal(Object.hasOwn(items, 100), false)
    deepStrictEqual(items[99], { name: 'own' })
    deepStrictEqual(inherited, { name: 'inherited', untouched: null })
    deepStrictEqual(items[101], { name: 'own' })
  } finally {
    delete Array.prototype[100]
  }
})

it('checks existing merge leaves before copying their keys', () => {
  const payload = JSON.parse('{"__proto__":{"injected":"forged"}}')
  throws(
    () => definition.update({ payload }, { payload: { name: 'new' } }, false),
    /INVALID/
  )
  equal(Object.hasOwn(Object.prototype, 'injected'), false)
  deepStrictEqual(Object.getPrototypeOf(payload), Object.prototype)
})

it('rejects source accessors without executing them', () => {
  let calls = 0
  const before = Object.defineProperty({}, 'payload', {
    enumerable: true,
    get: () => {
      calls++
      return { note: 'forged' }
    },
  })
  throws(() => setValue(before, 'note', 'new'), /accessor/)
  throws(() => getChanges(before, { payload: {} }), /accessor/)
  throws(() => definition.update(before, null), /accessor/)
  equal(calls, 0)
})
