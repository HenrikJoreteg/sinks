/* eslint-env node */
/* global structuredClone */
import { deepStrictEqual } from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import * as workingTree from '../src/index.js'

const help = `Usage: npm run benchmark -- [options]

  --baseline MODULE   Compare against an installed package or local entry file
  --candidate MODULE  Candidate module (default: this checkout)
  --sizes 1000,5000   Fixture sizes, each at least 2
  --samples 7         Samples per operation, at least 3
  --sample-ms 15      Target duration per sample in milliseconds
  --filter TEXT       Run only workloads whose names contain TEXT
  --json              Print machine-readable results
  --help              Show this help

Examples:
  npm run benchmark -- --baseline ../sinks-main/src/index.js
  npm run benchmark -- --baseline sinks-baseline --filter array

Times are median milliseconds per operation; lower ratios are faster.
Fixture creation, module loading, and correctness checks are not timed.
`

const loadApi = async specifier => {
  const target =
    specifier.startsWith('.') ||
    isAbsolute(specifier) ||
    existsSync(resolve(specifier))
      ? pathToFileURL(resolve(specifier)).href
      : specifier
  const namespace = await import(target)
  // Older published builds may expose their API as a CommonJS default export.
  const api =
    namespace.default && namespace.default.buildDefinition
      ? namespace.default
      : namespace
  for (const name of [
    'buildDefinition',
    'updateObject',
    'setValue',
    'getChanges',
    'mergeObjects',
  ]) {
    if (typeof api[name] !== 'function')
      throw Error(`${specifier}: missing ${name} export`)
  }
  return api
}

const makeWorkloads = (api, size) => {
  const records = Object.fromEntries(
    Array.from({ length: size }, (_, index) => [
      'id' + index,
      {
        note: 'value',
        count: index,
        metrics: { value: 70, time: 1700000000000 + index },
      },
    ])
  )
  const state = { note: 'before', records }
  const middle = Math.floor(size / 2)
  const changed = {
    ...state,
    records: {
      ...records,
      ['id' + middle]: { ...records['id' + middle], note: 'after' },
    },
  }
  const equal = structuredClone(state)
  const flat = Object.fromEntries(
    Array.from({ length: size }, (_, index) => ['key' + index, 'before'])
  )
  const flatChanged = Object.fromEntries(
    Array.from({ length: size }, (_, index) => ['key' + index, 'after'])
  )
  const items = Array.from({ length: size }, (_, index) => 'item' + index)
  const arrayState = { items }
  const ten = Object.fromEntries(
    Array.from({ length: 10 }, (_, index) => ['note' + index, 'value'])
  )
  const definition = api.buildDefinition({
    note: 'str',
    'records.{}.note': 'str',
    'records.{}.count': 'num',
    'records.{}.metrics.value': 'num',
    'records.{}.metrics.time': 'num',
  })
  const updates = Array.from({ length: 100 }, (_, index) => ({
    note: 'text' + index,
  }))
  const tiny = { note: 'before', group: { note: 'old' } }
  const workloads = [
    [
      'tiny scalar update',
      () => api.updateObject(tiny, { 'group.note': 'after' }),
      { ...tiny, group: { note: 'after' } },
    ],
    [
      'unrelated scalar update',
      () => api.updateObject(state, { note: 'after' }),
      { ...state, note: 'after' },
    ],
    [
      'nested dictionary update',
      () =>
        api.updateObject(state, { ['records.id' + middle + '.note']: 'after' }),
      changed,
    ],
    [
      '10-field update batch',
      () => api.updateObject(state, ten),
      { ...state, ...ten },
    ],
    [
      'array index replacement',
      () => api.setValue(arrayState, ['items', middle], 'after'),
      {
        items: items.map((value, index) =>
          index === middle ? 'after' : value
        ),
      },
    ],
    ...[
      ['front', 0],
      ['middle', middle],
      ['end', size - 1],
    ].map(([name, index]) => [
      'array delete ' + name,
      () => api.setValue(arrayState, ['items', index], null),
      { items: items.filter((value, position) => position !== index) },
    ]),
    [
      '20 successive array replacements',
      () => {
        let updated = arrayState
        for (let index = 0; index < 20; index++)
          updated = api.setValue(updated, ['items', middle], 'text' + index)
        return updated
      },
      {
        items: items.map((value, index) =>
          index === middle ? 'text19' : value
        ),
      },
    ],
    [
      'diff shared branches',
      () => api.getChanges(state, { ...state, note: 'after' }),
      { note: 'after' },
    ],
    [
      'diff one nested change',
      () => api.getChanges(state, changed),
      { ['records.id' + middle + '.note']: 'after' },
    ],
    ['diff equal cloned tree', () => api.getChanges(state, equal), null],
    [
      'diff all flat fields',
      () => api.getChanges(flat, flatChanged),
      flatChanged,
    ],
    [
      'merge conflicting fields',
      () => api.mergeObjects(flat, flatChanged),
      {
        updated: flat,
        conflicts: Object.fromEntries(
          Object.keys(flat).map(key => [key, ['before', 'after']])
        ),
      },
    ],
    ['explicit schema validation', () => definition.validate(state), undefined],
    [
      'schema-checked update',
      () => definition.update(state, { note: 'after' }),
      { ...state, note: 'after' },
    ],
    [
      'replay 100 scalar updates',
      () => {
        let updated = state
        for (const update of updates)
          updated = definition.update(updated, update, false)
        return updated
      },
      { ...state, note: 'text99' },
    ],
  ]
  return workloads.map(([name, run, expected]) => ({ name, run, expected }))
}

const time = (run, iterations) => {
  let result
  const start = performance.now()
  for (let index = 0; index < iterations; index++) result = run()
  return { ms: (performance.now() - start) / iterations, result }
}

const median = values => {
  const sorted = [...values].sort((first, second) => first - second)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
}

const main = async () => {
  const { values } = parseArgs({
    options: {
      baseline: { type: 'string' },
      candidate: { type: 'string' },
      sizes: { type: 'string', default: '1000,5000' },
      samples: { type: 'string', default: '7' },
      'sample-ms': { type: 'string', default: '15' },
      filter: { type: 'string', default: '' },
      json: { type: 'boolean' },
      help: { type: 'boolean' },
    },
  })
  if (values.help) {
    console.log(help)
    return
  }
  const sizes = values.sizes.split(',').map(Number)
  const samples = Number(values.samples)
  const sampleMs = Number(values['sample-ms'])
  if (sizes.some(size => !Number.isInteger(size) || size < 2))
    throw Error('--sizes must contain integers of at least 2')
  if (!Number.isInteger(samples) || samples < 3)
    throw Error('--samples must be an integer of at least 3')
  if (!Number.isFinite(sampleMs) || sampleMs <= 0)
    throw Error('--sample-ms must be positive')
  const candidate = values.candidate
    ? await loadApi(values.candidate)
    : workingTree
  const apis = values.baseline
    ? [await loadApi(values.baseline), candidate]
    : [candidate]
  const results = []
  if (!values.json && values.baseline)
    console.log(
      'Baseline -> candidate, median ms/op (lower ratios are faster):'
    )
  for (const size of sizes) {
    // Separate fixtures prevent one version from warming or mutating the other's data.
    const workloads = apis.map(api => makeWorkloads(api, size))
    for (let index = 0; index < workloads[0].length; index++) {
      const runs = workloads.map(list => list[index])
      const name = runs[0].name
      if (!name.toLowerCase().includes(values.filter.toLowerCase())) continue
      for (const workload of runs)
        deepStrictEqual(
          workload.run(),
          workload.expected,
          name + ': incorrect result'
        )
      // Warm both implementations before calibrating a common iteration count.
      for (let warmup = 0; warmup < 10; warmup++)
        for (const workload of runs) workload.run()
      const estimate = Math.max(
        0.001,
        ...runs.map(workload => time(workload.run, 3).ms)
      )
      const iterations = Math.min(
        20000,
        Math.max(1, Math.ceil(sampleMs / estimate))
      )
      const timings = runs.map(() => [])
      for (let sample = 0; sample < samples; sample++) {
        const order = runs.map((run, position) => position)
        // Alternate which implementation goes first to reduce ordering bias.
        if (sample % 2) order.reverse()
        for (const position of order)
          timings[position].push(time(runs[position].run, iterations).ms)
      }
      const medians = timings.map(median)
      const row = {
        size,
        workload: name,
        iterations,
        candidateMs: medians[medians.length - 1],
      }
      if (values.baseline) {
        row.baselineMs = medians[0]
        row.ratio = row.candidateMs / row.baselineMs
      }
      results.push(row)
      if (!values.json)
        console.log(
          `${size} / ${name}: ${
            values.baseline ? row.baselineMs.toFixed(4) + ' -> ' : ''
          }${row.candidateMs.toFixed(4)} ms${
            values.baseline ? ` (${row.ratio.toFixed(2)}x)` : ''
          }`
        )
    }
  }
  if (!results.length) throw Error('No workloads match --filter')
  const report = {
    environment: {
      node: process.version,
      v8: process.versions.v8,
      platform: process.platform,
      arch: process.arch,
    },
    candidate: values.candidate || 'working tree',
    baseline: values.baseline || null,
    samples,
    sampleMs,
    results,
  }
  if (values.json) console.log(JSON.stringify(report, null, 2))
  else
    console.log(
      `Node ${process.version}; ${samples} samples; median ms/op. Lower ratios are faster. Timings include GC and may vary between runs.`
    )
}

main().catch(error => {
  console.error(error.message)
  process.exitCode = 1
})
