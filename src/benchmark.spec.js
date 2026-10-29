import { it } from 'node:test'
import { match, strictEqual } from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const args = [
  'scripts/benchmark.js',
  '--sizes',
  '10',
  '--samples',
  '3',
  '--sample-ms',
  '1',
  '--filter',
  'array index replacement',
  '--json',
]

it('benchmarks a local version and emits numeric comparison results', () => {
  const result = spawnSync(
    process.execPath,
    [...args, '--baseline', './src/index.js'],
    { encoding: 'utf8' }
  )
  strictEqual(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  strictEqual(report.results.length, 1)
  strictEqual(report.results[0].size, 10)
  strictEqual(report.results[0].candidateMs > 0, true)
  strictEqual(report.results[0].baselineMs > 0, true)
  strictEqual(Number.isFinite(report.results[0].ratio), true)
})

it('rejects an implementation that returns incorrect results after warmup', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sinks benchmark-'))
  const entry = join(directory, 'wrong.mjs')
  const source = pathToFileURL(resolve('src/index.js')).href
  writeFileSync(
    entry,
    `export * from ${JSON.stringify(
      source
    )}\nimport { setValue as real } from ${JSON.stringify(
      source
    )}\nlet calls = 0\nexport const setValue = (...args) => ++calls === 1 ? real(...args) : ({ wrong: true })\n`
  )
  try {
    const result = spawnSync(process.execPath, [...args, '--baseline', entry], {
      encoding: 'utf8',
    })
    strictEqual(result.status, 1)
    match(result.stderr, /array index replacement: incorrect result/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
