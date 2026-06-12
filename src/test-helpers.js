import { test as nodeTest } from 'node:test'
import assert from 'node:assert/strict'

const createAssertions = () => ({
  deepEqual: assert.deepEqual,
  doesNotThrow: assert.doesNotThrow,
  equal: assert.equal,
  fail: assert.fail,
  ok: assert.ok,
  throws: assert.throws,
  end: () => {},
  test: (name, fn) => fn(createAssertions()),
})

export const test = (name, fn) => nodeTest(name, () => fn(createAssertions()))

test.skip = (name, fn) => nodeTest.skip(name, () => fn(createAssertions()))
