import { it } from 'node:test'
import { strictEqual } from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

it('supports data operations when Object.hasOwn is unavailable before import', () => {
  const moduleUrl = pathToFileURL(resolve('src/index.js')).href
  // Use a separate runtime so the test does not change globals in other tests.
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `
    Object.hasOwn = undefined
    const { deepStrictEqual, throws } = await import('node:assert/strict')
    const { buildDefinition, getChanges, mergeObjects, setValue, updateObject } =
      await import(${JSON.stringify(moduleUrl)})

    const before = Object.assign(Object.create(null), {
      hasOwnProperty: 'before',
      constructor: { prototype: { note: 'old' } },
    })
    const after = {
      hasOwnProperty: 'after',
      constructor: { prototype: { note: 'new' } },
    }
    const changes = {
      hasOwnProperty: 'after',
      'constructor.prototype.note': 'new',
    }
    deepStrictEqual(getChanges(before, after), changes)
    deepStrictEqual(updateObject(before, changes), after)
    deepStrictEqual(setValue({}, 'toString.note', 'own'), {
      toString: { note: 'own' },
    })
    deepStrictEqual(setValue({}, 'items', [null, 'new']), { items: ['new'] })
    deepStrictEqual(getChanges({}, { items: [null, 'new'] }), { items: ['new'] })

    const definition = buildDefinition({
      hasOwnProperty: ['str', 'bool'],
      'constructor.prototype.note': 'str',
      items: 'arr',
      'items.[]': 'str',
    })
    definition.validate(after)
    deepStrictEqual(definition.update(before, changes), after)
    deepStrictEqual(definition.setValue({}, ['items', 0], 'new'), {
      items: ['new'],
    })
    const expectedMerge = {
      updated: before,
      conflicts: {
        hasOwnProperty: ['before', 'after'],
        'constructor.prototype.note': ['old', 'new'],
      },
    }
    deepStrictEqual(mergeObjects(before, after), expectedMerge)
    deepStrictEqual(definition.merge(before, after), expectedMerge)
    throws(() => setValue({}, '__proto__.value', 'unsafe'), /INVALID/)
    throws(() => definition.validate(Object.create({ inherited: true })), /INVALID/)
  `,
    ],
    { encoding: 'utf8' }
  )
  strictEqual(result.status, 0, result.stderr || result.stdout)
})
