import test from 'tape'
import { removeNullAndEmpty } from './deep-set'
import { buildDefinition, getChanges, updateObject } from './main'
import { simpleObjectDeepEqual } from './utils'

test('basic deep set value works', t => {
  const built = buildDefinition({
    'items.[]': 'arr',
    'items.[].something.{}.else.[].crazy': 'str',
  })
  t.deepEqual(
    built.setValue({}, 'items.[0].something.hi.else.[0].crazy', 'hi'),
    {
      items: [{ something: { hi: { else: [{ crazy: 'hi' }] } } }],
    }
  )
  t.throws(() => {
    built.setValue({}, 'items.[0].something.hi.else.[0].crazys', 'hi')
  })
  // validation is optional
  t.doesNotThrow(() => {
    built.setValue({}, 'items.[0].something.hi.else.[0].crazys', 'hi', false)
  })
  // throws if setting object to invalid path
  t.throws(() => {
    built.setValue({}, 'silliness', [{ ok: 'you' }])
  })
  // does not throw if setting objects as long as
  // child values are valid
  t.doesNotThrow(() => {
    built.setValue({}, 'items', [
      {
        something: {
          foo: {
            else: [{ crazy: 'yeah' }],
          },
        },
      },
    ])
  })
  // does not throw if setting empty objects because validation happens at the end
  // and empty objects are removed
  t.deepEqual(built.setValue({}, 'ridiculous', []), {})

  // does throw if setting objects with invalid children
  t.throws(() => {
    built.setValue({}, 'items', [
      {
        something: {
          foo: {
            else: [{ crazy: 5 }],
          },
        },
      },
    ])
  })
  t.end()
})

test('update with simple objects does merge by default', t => {
  const definition = {
    'stuff.{}.id': 'str',
    'stuff.{}.name': 'str',
    'stuff.{}.value': 'positiveInt',
  }
  const built = buildDefinition(definition)
  const res = built.update({}, { 'stuff.d_0': { id: 'd_0', name: 'Joe' } })

  t.deepEqual(res, {
    stuff: {
      d_0: {
        id: 'd_0',
        name: 'Joe',
      },
    },
  })

  // now set partial object
  const res2 = built.update(res, { 'stuff.d_0': { value: 45 } })
  t.deepEqual(res2, {
    stuff: {
      d_0: {
        id: 'd_0',
        name: 'Joe',
        value: 45,
      },
    },
  })

  t.end()
})

test('handles removing objects from array by index', t => {
  const definition = {
    stuff: 'arr',
    'stuff.[].id': 'str',
  }
  const built = buildDefinition(definition)
  const res = built.update(
    {},
    { stuff: [{ id: 'one' }, { id: 'two' }, { id: 'three' }] }
  )
  t.deepEqual(res, { stuff: [{ id: 'one' }, { id: 'two' }, { id: 'three' }] })

  // now remove by index
  const res2 = built.setValue(res, 'stuff.1', null)
  t.deepEqual(res2, { stuff: [{ id: 'one' }, { id: 'three' }] })

  const res3 = built.setValue(res2, 'stuff.1', null)
  t.deepEqual(res3, { stuff: [{ id: 'one' }] })

  const res4 = built.setValue(res3, 'stuff.0', null)
  t.deepEqual(res4, {})

  t.end()
})

test('handles removing objects if all keys deleted', t => {
  const definition = {
    'stuff.{}.id': 'str',
  }
  const built = buildDefinition(definition)
  const res = built.update(
    {
      stuff: {
        foo: {
          id: 'one',
        },
      },
    },
    { 'stuff.foo': null }
  )
  t.deepEqual(res, {})

  const built2 = buildDefinition({ stuff: 'str' })
  const res2 = built2.update(
    {},
    {
      stuff: 'hi',
    }
  )
  t.deepEqual(res2, { stuff: 'hi' })

  const res3 = built2.update(
    {},
    {
      stuff: null,
    }
  )
  t.deepEqual(res3, {})

  t.end()
})

test('object sync works', t => {
  const definition = {
    thing: 'str',
    'items.[].name': 'str',
    'items.[].value': 'positiveInt',
  }

  const entries = [
    {
      definition,
      before: { thing: 'ok', items: [{ name: 'hi', value: 45 }] },
      after: { thing: 'ok' },
      expectedDiff: { items: null },
    },
    {
      definition,
      before: { thing: 'ok' },
      after: { thing: 'ok', items: [{ name: 'hi', value: 45 }] },
      expectedDiff: { 'items.[0].name': 'hi', 'items.[0].value': 45 },
    },
    {
      definition,
      before: { items: [{ name: 'hi' }] },
      after: {},
      expectedDiff: { items: null },
    },
    {
      definition: {
        'big.[].hairy.{}.audacious': 'bool',
        'big.[].hairy.{}.items.[].other': 'str',
      },
      before: {
        big: [],
      },
      after: {
        big: [
          {
            hairy: {
              anything: {
                audacious: true,
                items: [{ other: 'something' }],
              },
            },
          },
        ],
      },
      expectedDiff: {
        'big.[0].hairy.anything.audacious': true,
        'big.[0].hairy.anything.items.[0].other': 'something',
      },
    },
    {
      definition: {
        'crazy.{}.{}.{}.{}.{}.stuff': 'bool',
        'crazy.{}.{}.{}.{}.items.[].thing': 'str',
      },
      before: {
        crazy: {
          foo: {
            foo: {
              foo: {
                foo: {
                  foo: {
                    stuff: true,
                  },
                },
              },
            },
          },
        },
      },
      after: {
        crazy: {
          foo: {
            foo: {
              foo: {
                foo: {
                  foo: {
                    stuff: false,
                  },
                  items: [
                    {
                      thing: 'yep',
                    },
                  ],
                },
              },
            },
          },
        },
      },
      expectedDiff: {
        'crazy.foo.foo.foo.foo.foo.stuff': false,
        'crazy.foo.foo.foo.foo.items.[0].thing': 'yep',
      },
    },
    {
      definition: {
        name: 'str',
      },
      before: {
        name: 'henrik',
      },
      after: {
        name: 'henrik',
      },
      expectedDiff: null,
    },
    {
      definition: {
        'items.[].name': 'str',
        'items.[].value': 'positiveInt',
      },
      before: {},
      after: {
        items: [
          { name: 'something', value: 12 },
          { name: 'somethingElse', value: 32 },
        ],
      },
      expectedDiff: {
        'items.[0].name': 'something',
        'items.[0].value': 12,
        'items.[1].name': 'somethingElse',
        'items.[1].value': 32,
      },
    },
    {
      definition: {
        'items.[].name': 'str',
        'items.[].value': 'positiveInt',
      },
      before: { items: [{ name: 'hi' }] },
      after: {
        items: [
          { name: 'something', value: 12 },
          { name: 'somethingElse', value: 32 },
        ],
      },
      expectedDiff: {
        'items.[0].name': 'something',
        'items.[0].value': 12,
        'items.[1].name': 'somethingElse',
        'items.[1].value': 32,
      },
    },
    {
      definition: {
        'items.[].name': 'str',
        'items.[].value': 'positiveInt',
      },
      before: { items: [{ name: 'hi' }] },
      after: {},
      expectedDiff: { items: null },
    },
    {
      definition: {
        'objWithIntKeys.{}.name': 'str',
        'objWithIntKeys.{}.other': 'str',
      },
      before: {
        objWithIntKeys: {
          3: {
            name: 'first',
            other: 'prop',
          },
        },
      },
      after: {
        objWithIntKeys: {
          2: {
            name: 'second',
          },
        },
      },
      expectedDiff: {
        'objWithIntKeys.3': null,
        'objWithIntKeys.2.name': 'second',
      },
    },
    {
      definition: {
        'objWithIntKeys.{}.nested.{}.something': 'str',
        'objWithIntKeys.{}.other': 'str',
      },
      before: {
        objWithIntKeys: {
          2: {
            other: 'thing',
            nested: {
              8: {
                something: 'also nested',
              },
            },
          },
        },
      },
      after: {
        objWithIntKeys: {
          3: {
            nested: {
              0: {
                something: 'hello',
              },
            },
            other: 'prop',
          },
        },
      },
      expectedDiff: {
        'objWithIntKeys.2': null,
        'objWithIntKeys.3.nested.0.something': 'hello',
        'objWithIntKeys.3.other': 'prop',
      },
    },
  ]

  entries.forEach(({ definition, before, after, expectedDiff }) => {
    const builtDefinition = buildDefinition(definition)
    const diff = getChanges(before, after)
    t.deepEqual(diff, expectedDiff)
    const updated = builtDefinition.update(before, diff)
    t.deepEqual(updated, after)
  })

  t.end()
})

test('updating with empty nested values removes them', t => {
  const obj1 = {
    name: 'Henrik',
  }

  t.deepEqual(
    updateObject(obj1, {
      other: {
        nested: {
          hi: [],
        },
      },
    }),
    obj1,
    'Setting deeply nested set of set of objects / arrays the whole chain of empty stuff is removed'
  )

  t.deepEqual(
    updateObject(obj1, {
      other: {
        ok: 'you',
        nested: {
          hi: [],
        },
      },
    }),
    { name: 'Henrik', other: { ok: 'you' } },
    'Setting deeply nested with partial real values works'
  )

  t.end()
})

test('merge works', t => {
  const entries = [
    {
      description: 'handles discovering deeply nested conflicts',
      definition: {
        'big.[].hairy.{}.audacious': 'bool',
      },
      obj1: {
        big: [
          {
            hairy: {
              thing: {
                audacious: true,
              },
            },
          },
          {
            hairy: {
              thing: {
                audacious: false,
              },
            },
          },
        ],
      },
      obj2: {
        big: [
          {
            hairy: {
              thing: {
                audacious: true,
              },
            },
          },
          {
            hairy: {
              thing: {
                audacious: true,
              },
            },
          },
        ],
      },
      expectedOutcome: {
        updated: {
          big: [
            {
              hairy: {
                thing: {
                  audacious: true,
                },
              },
            },
            {
              hairy: {
                thing: {
                  audacious: false,
                },
              },
            },
          ],
        },
        conflicts: {
          'big.[1].hairy.thing.audacious': [false, true],
        },
      },
    },
    {
      description: 'both have new fields, no conflicts',
      definition: {
        name: 'str',
        age: 'positiveInt',
        other: 'str',
      },
      obj1: {
        name: 'henrik',
      },
      obj2: {
        age: 37,
      },
      expectedOutcome: {
        updated: {
          name: 'henrik',
          age: 37,
        },
      },
    },
    {
      description: 'both have new fields and a conflict',
      definition: {
        name: 'str',
        age: 'positiveInt',
        other: 'str',
      },
      obj1: {
        name: 'henrik',
        other: 'same',
      },
      obj2: {
        age: 37,
        other: 'different',
      },
      expectedOutcome: {
        updated: {
          name: 'henrik',
          age: 37,
          other: 'same',
        },
        conflicts: {
          other: ['same', 'different'],
        },
      },
    },
    {
      description: 'throws when broken final product',
      definition: {
        name: 'str',
        age: 'positiveInt',
        other: 'str',
      },
      obj1: {
        name: 'henrik',
        other: 'same',
      },
      obj2: {
        age: 37,
        other: 'different',
        blah: 'not known path',
      },
      throws: 'INVALID path: blah',
    },
    {
      description: 'handles fields that are missing in second object',
      definition: {
        something: 'obj',
        'something.{}.nested': 'str',
      },
      obj2: {
        something: {
          foo: {
            nested: 'hi',
          },
        },
      },
      obj1: undefined,
      expectedOutcome: {
        updated: {
          something: {
            foo: {
              nested: 'hi',
            },
          },
        },
      },
    },
    {
      description: 'handles fields that are missing in first object',
      definition: {
        something: 'obj',
        'something.{}.nested': 'str',
      },
      obj2: {},
      obj1: {
        something: {
          foo: {
            nested: 'hi',
          },
        },
      },
      expectedOutcome: {
        updated: {
          something: {
            foo: {
              nested: 'hi',
            },
          },
        },
      },
    },
  ]

  entries.forEach(
    ({ description, throws, definition, obj1, obj2, expectedOutcome }) => {
      const builtDefinition = buildDefinition(definition)
      if (throws) {
        t.throws(
          () => {
            builtDefinition.merge(obj1, obj2)
          },
          {
            message: throws,
          },
          description
        )
      } else {
        const outcome = builtDefinition.merge(obj1, obj2)
        t.deepEqual(outcome, expectedOutcome, description)
        // also use our simple object deep equal to make sure it gets the same result
        t.equal(simpleObjectDeepEqual(outcome, expectedOutcome), true)
      }
    }
  )

  t.end()
})

test('handles numbers as object keys', t => {
  const res = updateObject({}, { 'something.1.else': 'hi' })
  t.deepEqual(
    res,
    { something: { 1: { else: 'hi' } } },
    'assumes object by default'
  )

  // can specifically set as array if need be
  const res2 = updateObject({}, { 'something.[1].else': 'hi' })
  const sparseArr = []
  sparseArr[1] = { else: 'hi' }
  t.deepEqual(res2, { something: sparseArr })

  t.end()
})

test('can handle setting objects without exploding', t => {
  const obj = { something: 'cool' }

  const definition = buildDefinition({
    things: 'obj',
  })

  const res = definition.update({}, { things: obj }, true)
  t.deepEqual(res, { things: { something: 'cool' } })

  t.end()
})

test('getChanges with ignoredKeys', t => {
  t.deepEqual(
    getChanges(
      {},
      { something: 'hi', somethingElse: 'bye' },
      { ignoredKeys: ['something'] }
    ),
    { somethingElse: 'bye' }
  )

  t.deepEqual(
    getChanges(
      {},
      {
        something: 'hi',
        somethingElse: {
          something: 'will still be here',
          this: 'will be here',
        },
        doNotInclude: 'me',
      },
      { ignoredKeys: ['something', 'doNotInclude'] }
    ),
    {
      'somethingElse.something': 'will still be here',
      'somethingElse.this': 'will be here',
    },
    'only ignores key on top level object'
  )
  t.end()
})

test('getChanges with includeDeletion option', t => {
  t.deepEqual(
    getChanges(
      { ok: 'hi' },
      { something: 'hi', somethingElse: 'bye' },
      { includeDeletions: false }
    ),
    { something: 'hi', somethingElse: 'bye' }
  )

  t.deepEqual(
    getChanges(
      { ok: 'hi' },
      { something: 'hi', somethingElse: 'bye', ok: null },
      { includeDeletions: true }
    ),
    { something: 'hi', somethingElse: 'bye', ok: null }
  )

  t.end()
})

test('can handle functions as values', t => {
  const definition = buildDefinition({
    things: 'func',
  })

  const func = () => {}

  const res = definition.update({}, { things: func }, true)
  t.deepEqual(res, { things: func })

  t.end()
})

test('setting deeply nested value should not fail if lower level objects not defined', t => {
  const definition = buildDefinition({
    other: 'str',
    'systemsReview.{}': 'str',
    'systemsReview.{}.id': 'str',
    'systemsReview.{}.entries': 'arr',
    'systemsReview.{}.entries.[].editing': 'bool',
    'systemsReview.{}.entries.[].details.[]': 'arr',
    'systemsReview.{}.entries.[].details.[].name': 'str',
  })

  const res = definition.update(
    { other: 'thing' },
    {
      'systemsReview.cns.entries.[0]': {
        details: [{ name: 'hi' }],
        editing: true,
      },
    }
  )

  t.deepEqual(res, {
    other: 'thing',
    systemsReview: {
      cns: {
        entries: [
          {
            details: [{ name: 'hi' }],
            editing: true,
          },
        ],
      },
    },
  })

  const expected = { other: 'thing' }

  t.deepEqual(
    definition.update(res, { 'systemsReview.cns.entries': null }, true),
    expected,
    'should remove all keys'
  )

  t.deepEqual(
    definition.update(
      res,
      {
        'systemsReview.cns.entries.[0]': null,
      },
      true
    ),
    expected,
    'should remove all keys'
  )

  t.deepEqual(
    definition.update(res, { 'systemsReview.cns.entries': null }, true),
    expected,
    'should remove all keys'
  )

  t.deepEqual(
    definition.update(
      res,
      {
        'systemsReview.cns.entries.[0]': {
          details: [{ name: null }],
          editing: null,
        },
      },
      true
    ),
    expected,
    'should remove all keys'
  )

  t.end()
})

test('remove empty', t => {
  t.deepEqual(
    removeNullAndEmpty({
      hello: null,
      hi: [{ there: [{ ok: null }] }],
    }),
    {}
  )

  t.deepEqual(
    removeNullAndEmpty({
      hello: {},
      hi: [{ there: [{ ok: [] }] }],
    }),
    {}
  )

  t.deepEqual(
    removeNullAndEmpty({
      items: [
        {
          something: {
            hi: {
              else: [
                {
                  crazy: 'hi',
                },
              ],
            },
            there: null,
          },
          ok: [{ things: [{ item: [{ silly: null }] }] }],
        },
      ],
    }),
    {
      items: [
        {
          something: {
            hi: {
              else: [
                {
                  crazy: 'hi',
                },
              ],
            },
          },
        },
      ],
    }
  )
  t.end()
})

test('validate function behavior', t => {
  const confirmError = (def, update, expectedMessage) => {
    try {
      def.update({}, update)
      t.fail('should have thrown')
    } catch (e) {
      t.equal(e.message, expectedMessage)
    }
  }
  const confirmOk = (def, update) => {
    t.doesNotThrow(() => {
      def.update({}, update)
    })
  }

  t.test('function handles single type validations', t => {
    const def = buildDefinition({
      'items.{}.name': 'str',
    })

    confirmError(
      def,
      {
        'items.0.name': 5,
      },
      'INVALID items.0.name: 5'
    )

    confirmError(
      def,
      {
        name: 'hi',
      },
      'INVALID path: name'
    )

    confirmError(
      def,
      {
        'the.name.of': 'hi',
      },
      'INVALID path: the.name.of'
    )
    confirmError(
      def,
      {
        'items.0.name': () => {},
      },
      'INVALID items.0.name: () => {}'
    )
    confirmOk(def, {
      'items.0.name': 'hi',
    })

    t.end()
  })

  t.test('function handles array of types correctly', t => {
    const def = buildDefinition({
      'items.{}.name': ['str', 'bool'],
    })

    confirmError(
      def,
      {
        'items.0.name': 5,
      },
      'INVALID items.0.name: 5'
    )

    confirmError(
      def,
      {
        name: 'hi',
      },
      'INVALID path: name'
    )

    confirmError(
      def,
      {
        'the.name.of': 'hi',
      },
      'INVALID path: the.name.of'
    )
    confirmError(
      def,
      {
        'items.0.name': () => {},
      },
      'INVALID items.0.name: () => {}'
    )
    confirmOk(def, {
      'items.0.name': 'hi',
    })
    confirmOk(def, {
      'items.0.name': true,
    })
    confirmOk(def, {
      'items.0.name': false,
    })

    t.end()
  })

  t.test('function handles array of types correctly', t => {
    const def = buildDefinition({
      'items.{}.name': 'blah',
    })
    confirmError(
      def,
      {
        'items.0.name': 5,
      },
      'INVALID type: blah'
    )
    t.end()
  })

  t.test("confirm partial match is doesn't cause issues", t => {
    const def = buildDefinition({
      'items.{}.name': 'str',
      'itemsmore.{}.name': 'bool',
    })
    confirmError(
      def,
      {
        'items.0.name': true,
      },
      'INVALID items.0.name: true'
    )
    t.end()
  })
})

test.skip('validation performance test (using large local file not checked in)', t => {
  // eslint-disable-next-line no-undef
  const { large, definition } = require('../large')
  const time = Date.now()
  const amountToTest = 1000
  const target = 16
  for (let i = 0; i < amountToTest; i++) {
    definition.validate(large)
  }
  const diff = Date.now() - time
  const avg = diff / amountToTest
  // eslint-disable-next-line no-console
  console.log('diff', diff, 'avg', avg)

  t.ok(
    avg < target,
    true,
    `took less than ${target}ms to do ${amountToTest} times`
  )

  // make sure it errors as expected
  t.throws(
    () => {
      const copy = JSON.parse(JSON.stringify(large))
      copy.blah = 'thing'
      definition.validate(copy)
    },
    err => {
      return err.message === 'INVALID path: blah'
    },
    'throws correct errors'
  )

  t.doesNotThrow(() => {
    const copy = JSON.parse(JSON.stringify(large))
    copy.vitalRecords.rec_thing = { vitals: { hr: { value: 'thing' } } }
    definition.validate(copy)
  })

  t.throws(
    () => {
      const copy = JSON.parse(JSON.stringify(large))
      copy.vitalRecords.rec_thing = { vitals: { hr: { value: true } } }
      definition.validate(copy)
    },
    err => {
      return (
        err.message === 'INVALID vitalRecords.rec_thing.vitals.hr.value: true'
      )
    },
    'throws correct error for nested value with multiple types'
  )

  t.end()
})
