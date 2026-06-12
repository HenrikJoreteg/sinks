import { test } from './test-helpers.js'
import { basicTypes } from './basic-types.js'

test('basicTypes exposes expected validators', t => {
  t.equal(basicTypes.str('hi'), true)
  t.equal(basicTypes.str(5), false)

  t.equal(basicTypes.bool(false), true)
  t.equal(basicTypes.bool('false'), false)

  t.equal(basicTypes.num(5), true)
  t.equal(basicTypes.num('5'), false)

  t.equal(basicTypes.int(5), true)
  t.equal(basicTypes.int(5.5), false)

  t.equal(basicTypes.positiveInt(0), true)
  t.equal(basicTypes.positiveInt(-1), false)
  t.equal(basicTypes.positiveInt(1.5), false)

  t.equal(basicTypes.timestamp(1), true)
  t.equal(basicTypes.timestamp(0), false)
  t.equal(basicTypes.timestamp(7258147200000), false)

  t.equal(basicTypes.arr([]), true)
  t.equal(basicTypes.arr({}), false)

  t.equal(basicTypes.obj({}), true)
  t.equal(basicTypes.obj([]), true)
  t.equal(basicTypes.obj('hi'), false)

  const fn = () => {}
  t.equal(basicTypes.func(fn), true)
  t.equal(basicTypes.func({}), false)

  const isPrimaryColor = basicTypes.matches(['red', 'blue'])
  t.equal(isPrimaryColor('red'), true)
  t.equal(isPrimaryColor('green'), false)

  t.end()
})
