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
    const { deepStrictEqual, strictEqual, throws } = await import('node:assert/strict')
    const { buildDefinition, getChanges, mergeObjects, setValue, updateObject } =
      await import(${JSON.stringify(moduleUrl)})
    const before = { payload: { note: 'old' } }
    const after = { payload: { note: 'new' } }
    const definition = buildDefinition({ 'payload.note': 'str' })
    definition.validate(after)
    deepStrictEqual(updateObject(before, getChanges(before, after)), after)
    deepStrictEqual(definition.update(before, { 'payload.note': 'new' }), after)
    deepStrictEqual(setValue({}, 'payload.note', 'new'), after)
    const merged = mergeObjects(before, after)
    deepStrictEqual(merged.conflicts, { 'payload.note': ['old', 'new'] })
    strictEqual(Object.getPrototypeOf(merged.updated), Object.prototype)
    deepStrictEqual(setValue({}, 'items', [null, 'new']), { items: ['new'] })
    throws(() => setValue({}, '__proto__.note', 'new'), /Forbidden key/)
    throws(() => updateObject({}, { payload: JSON.parse('{"__proto__":{"note":"new"}}') }), /Forbidden key/)
    strictEqual(Object.prototype.note, undefined)
  `,
    ],
    { encoding: 'utf8' }
  )
  strictEqual(result.status, 0, result.stderr || result.stdout)
})
