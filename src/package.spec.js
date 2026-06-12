import { test } from './test-helpers.js'
import {
  basicTypes,
  buildDefinition,
  getChanges,
  simpleObjectDeepEqual,
  updateObject,
} from 'sinks'

test('package exports the public ESM API', t => {
  t.equal(typeof buildDefinition, 'function')
  t.equal(typeof getChanges, 'function')
  t.equal(typeof updateObject, 'function')
  t.equal(typeof simpleObjectDeepEqual, 'function')
  t.equal(typeof basicTypes.str, 'function')

  const definition = buildDefinition({ name: 'str' })

  t.deepEqual(getChanges({ name: 'old' }, { name: 'new' }), { name: 'new' })
  t.deepEqual(updateObject({}, { name: 'new' }), { name: 'new' })
  t.deepEqual(definition.update({}, { name: 'new' }), { name: 'new' })
  t.equal(simpleObjectDeepEqual({ name: 'new' }, { name: 'new' }), true)

  t.end()
})
