import { it } from 'node:test'
import { strictEqual } from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

it('supports prototype-safe data operations without Object.hasOwn', () => {
  const moduleUrl = pathToFileURL(resolve('src/index.js')).href
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `
    Object.hasOwn = undefined
    const { deepStrictEqual, strictEqual } = await import('node:assert/strict')
    const { buildDefinition, getChanges, mergeObjects, setValue, updateObject } =
      await import(${JSON.stringify(moduleUrl)})
    const before = JSON.parse('{"__proto__":{"note":"old"}}')
    const after = JSON.parse('{"__proto__":{"note":"new"}}')
    const definition = buildDefinition({ '__proto__.note': 'str' })
    definition.validate(after)
    deepStrictEqual(updateObject(before, getChanges(before, after)), after)
    deepStrictEqual(definition.update(before, { '__proto__.note': 'new' }), after)
    deepStrictEqual(setValue({}, '__proto__.note', 'new'), after)
    const merged = mergeObjects(before, after)
    deepStrictEqual(merged.conflicts, { '__proto__.note': ['old', 'new'] })
    strictEqual(Object.getPrototypeOf(merged.updated), Object.prototype)
    deepStrictEqual(setValue({}, 'items', [null, 'new']), { items: ['new'] })
    strictEqual(Object.prototype.note, undefined)
  `,
    ],
    { encoding: 'utf8' }
  )
  strictEqual(result.status, 0, result.stderr || result.stdout)
})
