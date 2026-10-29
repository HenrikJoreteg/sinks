import { test } from './test-helpers.js'
import { injectBrackets, simpleObjectDeepEqual } from './utils.js'

it('requires matching keys to be own and enumerable when comparing objects', () => {
  const hidden = Object.defineProperty({ other: 1 }, 'note', { value: 1 })
  const inherited = Object.assign(Object.create({ note: 1 }), { other: 1 })
  for (const other of [hidden, inherited, { other: 1 }]) {
    deepStrictEqual(simpleObjectDeepEqual({ note: 1 }, other), false)
    deepStrictEqual(simpleObjectDeepEqual(other, { note: 1 }), false)
  }
})

it('compares literal keys without calling input-owned enumeration methods', () => {
  const before = JSON.parse(
    '{"__proto__":"literal","propertyIsEnumerable":"data","hasOwnProperty":"data"}'
  )
  const after = JSON.parse(JSON.stringify(before))
  deepStrictEqual(simpleObjectDeepEqual(before, after), true)
  after.__proto__ = 'changed'
  deepStrictEqual(simpleObjectDeepEqual(before, after), false)
})

it('ignores only the requested top-level keys during deep comparison', () => {
  const before = { skip: 'before', nested: { skip: 'same' } }
  const after = { nested: { skip: 'same' } }
  deepStrictEqual(simpleObjectDeepEqual(before, after, ['skip']), true)
  after.nested.skip = 'changed'
  deepStrictEqual(simpleObjectDeepEqual(before, after, ['skip']), false)
})

test('injectBrackets', t => {
  // we will never do this, but we don't want this function
  // to care if the thing it is wrapping is a number or not
  t.equal(injectBrackets('foo'), '[foo]')
  t.equal(injectBrackets('234'), '[234]')
  t.equal(injectBrackets('5.23'), '[5].23')
  t.equal(injectBrackets('5.23.asdf.asdf'), '[5].23.asdf.asdf')
  t.equal(injectBrackets(''), '')
  t.end()
})

test('simpleObjectDeepEqual', t => {
  t.equal(
    simpleObjectDeepEqual(
      {
        e: '5',
        a: {
          c: [
            2,
            3,
            {
              something: 'ok',
              d: 4,
            },
          ],
          b: 1,
        },
      },
      {
        a: {
          b: 1,
          c: [
            2,
            3,
            {
              d: 4,
              something: 'ok',
            },
          ],
        },
        e: '5',
      }
    ),
    true,
    'nesting is fine, nested order of keys is ignored'
  )
  t.equal(
    simpleObjectDeepEqual(
      {
        a: '5',
      },
      {
        a: 5,
      }
    ),
    false,
    'not equal because of type (we are doing === equal)'
  )
  t.equal(
    simpleObjectDeepEqual(
      {
        a: 5,
        b: 6,
      },
      {
        b: 6,
        a: 5,
      }
    ),
    true,
    'order ignored'
  )
  t.equal(
    simpleObjectDeepEqual(
      {
        arr: ['a', 'b', 'c'],
      },
      {
        arr: ['a', 'b', 'c'],
      }
    ),
    true,
    'arrays are fine'
  )
  t.equal(
    simpleObjectDeepEqual(
      {
        arr: ['a', 'b', 'c'],
      },
      {
        arr: ['b', 'a', 'c'],
      }
    ),
    false,
    'array order matters'
  )
  t.equal(
    simpleObjectDeepEqual(
      {
        missing: 'one',
        arr: ['a', 'b', 'c'],
      },
      {
        arr: ['b', 'a', 'c'],
      }
    ),
    false,
    'missing keys in second'
  )
  t.equal(
    simpleObjectDeepEqual(
      {
        arr: ['a', 'b', 'c'],
      },
      {
        missing: 'one',
        arr: ['a', 'b', 'c'],
      }
    ),
    false,
    'missing keys in first'
  )
  t.equal(
    simpleObjectDeepEqual(
      {
        arr: ['a', 'b', 'c'],
      },
      {
        missing: 'one',
        arr: ['a', 'b', 'c'],
      },
      ['missing']
    ),
    true,
    'is equal if we ignore key missing in first'
  )
  t.equal(
    simpleObjectDeepEqual(
      {
        missing: 'one',
        arr: ['a', 'b', 'c'],
      },
      {
        arr: ['a', 'b', 'c'],
      },
      ['missing']
    ),
    true,
    'is equal if we ignore key missing in first'
  )
  t.equal(
    simpleObjectDeepEqual(
      {
        missing: 'one',
        hi: 'there',
      },
      {
        missing: { missing: 'boom' },
        hi: 'there',
      },
      ['missing']
    ),
    true,
    'handles nested missing keys'
  )
  t.equal(
    simpleObjectDeepEqual(
      {
        other: {
          hi: 'there',
          missing: 'key',
        },
        hi: 'there',
      },
      {
        other: {
          hi: 'there',
        },
        hi: 'there',
      },
      ['missing']
    ),
    false,
    'only ignores missing top-level key'
  )
  t.equal(
    simpleObjectDeepEqual(
      {
        arr: ['a', 'b'],
      },
      {
        arr: ['b', 'a', 'c'],
      }
    ),
    false,
    'array length matters'
  )
  t.equal(
    simpleObjectDeepEqual(
      {
        arr: ['a', 'b'],
      },
      {
        arr: { 0: 'b', 1: 'b' },
      }
    ),
    false,
    'handles keys that are integers'
  )

  t.end()
})
import { it } from 'node:test'
import { deepStrictEqual } from 'node:assert/strict'
