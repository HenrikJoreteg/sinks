import { describe, it } from 'node:test'
import {
  deepStrictEqual,
  match,
  rejects,
  strictEqual,
  throws,
} from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  downloadBenchmarkReport,
  formatBenchmarkReport,
  postBenchmarkReport,
  validateBenchmarkResults,
} from '../scripts/benchmark-report.js'

const headSha = '1'.repeat(40)
const baseSha = '2'.repeat(40)
const repository = 'owner/library'
const zipToolsAvailable = ['zip', 'unzip'].every(
  command => spawnSync(command, ['-v']).status === 0
)
const makeReport = () => ({
  environment: { node: 'v22.22.3', platform: 'linux', arch: 'x64' },
  samples: 9,
  results: [
    {
      size: 1000,
      workload: 'array index replacement',
      baselineMs: 1,
      candidateMs: 1.5,
      ratio: 999,
    },
  ],
})

const harness = () => {
  const run = {
    id: 123,
    run_attempt: 1,
    event: 'pull_request',
    path: '.github/workflows/benchmarks.yaml',
    status: 'completed',
    conclusion: 'success',
    head_sha: headSha,
    pull_requests: [{ number: 8 }],
  }
  const metadata = {
    schemaVersion: 1,
    repository,
    pullRequest: 8,
    headRepository: 'contributor/library',
    headSha,
    baseSha,
    runId: 123,
    runAttempt: 1,
  }
  const pull = {
    number: 8,
    state: 'open',
    head: { sha: headSha, repo: { full_name: 'contributor/library' } },
    base: { repo: { full_name: repository } },
  }
  const report = makeReport()
  const writes = []
  const comments = []
  const associated = [pull]
  let reads = 0
  let pullReads = 0
  let associationLookups = 0
  let nextPull = null
  const rest = {
    actions: { getWorkflowRun: async () => ({ data: run }) },
    repos: { listPullRequestsAssociatedWithCommit: () => {} },
    pulls: {
      get: async () => ({
        data: pullReads++ > 0 && nextPull ? nextPull : pull,
      }),
    },
    issues: {
      listComments: () => {},
      createComment: async args => writes.push({ method: 'create', ...args }),
      updateComment: async args => writes.push({ method: 'update', ...args }),
    },
  }
  const github = {
    rest,
    paginate: async method => {
      if (method === rest.issues.listComments) return comments
      if (method === rest.repos.listPullRequestsAssociatedWithCommit) {
        associationLookups++
        return associated
      }
      throw Error('Unexpected pagination call')
    },
  }
  return {
    run,
    metadata,
    report,
    pull,
    writes,
    comments,
    associated,
    setNextPull: value => {
      nextPull = value
    },
    counts: () => ({ reads, associationLookups }),
    post: () =>
      postBenchmarkReport({
        github,
        context: {
          repo: { owner: 'owner', repo: 'library' },
          payload: { workflow_run: { id: 123, run_attempt: 1 } },
        },
        core: { info() {} },
        readReport: async () => {
          reads++
          return { metadata, report }
        },
      }),
  }
}

describe('benchmark PR reports', () => {
  it('creates a report with absolute times, commits, and recomputed ratios', async () => {
    const test = harness()
    await test.post()
    strictEqual(test.writes.length, 1)
    strictEqual(test.writes[0].method, 'create')
    strictEqual(test.writes[0].issue_number, 8)
    match(test.writes[0].body, /1\.00 \| 1\.50 \| \+0\.50+ \| 1\.50×/)
    match(test.writes[0].body, /1111111/)
    match(test.writes[0].body, /2222222/)
    match(test.writes[0].body, /Advisory/)
    match(test.writes[0].body, /<details>/)
  })

  it('updates the existing Actions comment instead of adding another', async () => {
    const test = harness()
    test.comments.push({
      id: 50,
      user: { login: 'github-actions[bot]' },
      body:
        '<!-- sinks-benchmark-report -->\n<!-- sinks-benchmark-run:100:1 -->',
    })
    await test.post()
    strictEqual(test.writes[0].method, 'update')
    strictEqual(test.writes[0].comment_id, 50)
  })

  it('does not overwrite a human comment with a copied marker', async () => {
    const test = harness()
    test.comments.push({
      id: 50,
      user: { login: 'contributor' },
      body: '<!-- sinks-benchmark-report -->',
    })
    await test.post()
    strictEqual(test.writes[0].method, 'create')
  })

  it('resolves fork PRs when the workflow association list is empty', async () => {
    const test = harness()
    test.run.pull_requests = []
    await test.post()
    strictEqual(test.counts().associationLookups, 1)
    strictEqual(test.writes.length, 1)
  })

  it('rejects attempts to redirect the artifact to an unrelated PR', async () => {
    const test = harness()
    test.metadata.pullRequest = 999
    await rejects(test.post, /not identify a PR associated/)
    strictEqual(test.writes.length, 0)
  })

  it('rejects mismatched run, repository, attempt, and head metadata', async () => {
    for (const [key, value] of [
      ['runId', 999],
      ['repository', 'other/library'],
      ['runAttempt', 2],
      ['headSha', baseSha],
    ]) {
      const test = harness()
      test.metadata[key] = value
      await rejects(test.post, /Invalid benchmark context/)
      strictEqual(test.writes.length, 0)
    }
  })

  it('binds the baseline to the workflow run when GitHub supplies its base reference', async () => {
    const test = harness()
    test.run.pull_requests[0].base = { sha: '3'.repeat(40) }
    await rejects(test.post, /Invalid benchmark base commit/)
    strictEqual(test.writes.length, 0)
  })

  it('skips obsolete heads and closed pull requests', async () => {
    for (const change of [
      pull => {
        pull.head.sha = baseSha
      },
      pull => {
        pull.state = 'closed'
      },
    ]) {
      const test = harness()
      change(test.pull)
      await test.post()
      strictEqual(test.writes.length, 0)
    }
  })

  it('rechecks the head immediately before writing', async () => {
    const test = harness()
    test.setNextPull({
      ...test.pull,
      head: { ...test.pull.head, sha: baseSha },
    })
    await test.post()
    strictEqual(test.writes.length, 0)
  })

  it('skips cancelled, superseded, and unrelated workflow runs before reading artifacts', async () => {
    for (const change of [
      run => {
        run.conclusion = 'cancelled'
      },
      run => {
        run.run_attempt = 2
      },
      run => {
        run.path = '.github/workflows/other.yaml'
      },
      run => {
        run.event = 'push'
      },
    ]) {
      const test = harness()
      change(test.run)
      await test.post()
      strictEqual(test.counts().reads, 0)
      strictEqual(test.writes.length, 0)
    }
  })

  it('does not replace a report from a newer run or attempt', async () => {
    for (const previous of ['124:1', '123:2']) {
      const test = harness()
      test.comments.push({
        id: 50,
        user: { login: 'github-actions[bot]' },
        body: `<!-- sinks-benchmark-report -->\n<!-- sinks-benchmark-run:${previous} -->`,
      })
      await test.post()
      strictEqual(test.writes.length, 0)
    }
  })

  it('reports benchmark failures without rendering partial timing results', async () => {
    const test = harness()
    test.run.conclusion = 'failure'
    test.report.results[0].workload = '@everyone malicious text'
    await test.post()
    match(test.writes[0].body, /benchmark job failed/)
    strictEqual(test.writes[0].body.includes('malicious'), false)
  })

  it('allows large timing regressions without making them a failing gate', async () => {
    const test = harness()
    test.report.results[0].candidateMs = 100
    await test.post()
    match(test.writes[0].body, /100\.00×/)
  })

  it('rejects mentions, Markdown injection, non-finite times, duplicates, and oversized reports', () => {
    for (const change of [
      report => {
        report.results[0].workload = '@everyone | <script>'
      },
      report => {
        report.results[0].candidateMs = Infinity
      },
      report => {
        report.results[0].baselineMs = 0
      },
      report => {
        report.results.push(report.results[0])
      },
      report => {
        report.results = Array(101).fill(report.results[0])
      },
      report => {
        report.environment.node = 'v22 @everyone'
      },
    ]) {
      const report = makeReport()
      change(report)
      throws(() => validateBenchmarkResults(report), /Invalid benchmark/)
    }
  })

  it('puts the largest absolute changes in the summary', () => {
    const report = makeReport()
    report.results.push({
      size: 5000,
      workload: 'replay 100 scalar updates',
      baselineMs: 50,
      candidateMs: 10,
    })
    const metadata = harness().metadata
    const body = formatBenchmarkReport({
      report,
      metadata,
      repository,
      conclusion: 'success',
      runUrl: 'https://github.com/owner/library/actions/runs/123',
    })
    strictEqual(
      body.indexOf('| replay 100 scalar updates') <
        body.indexOf('| array index replacement'),
      true
    )
  })
})

it(
  'reads only JSON from a bounded artifact without executing included files',
  { skip: !zipToolsAvailable && 'ZIP integration requires zip/unzip' },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), 'sinks-report-test-'))
    try {
      const metadata = harness().metadata
      const report = makeReport()
      const executed = join(directory, 'executed')
      writeFileSync(join(directory, 'context.json'), JSON.stringify(metadata))
      writeFileSync(join(directory, 'results.json'), JSON.stringify(report))
      writeFileSync(
        join(directory, 'untrusted.cjs'),
        `require('fs').writeFileSync(${JSON.stringify(executed)}, 'bad')`
      )
      execFileSync(
        'zip',
        ['-q', 'report.zip', 'context.json', 'results.json', 'untrusted.cjs'],
        { cwd: directory }
      )
      const archive = readFileSync(join(directory, 'report.zip'))
      let downloads = 0
      const artifact = {
        name: 'sinks-benchmark-1',
        id: 1,
        size_in_bytes: archive.length,
        expired: false,
      }
      const github = {
        paginate: async () => [artifact],
        rest: {
          actions: {
            listWorkflowRunArtifacts() {},
            downloadArtifact: async () => {
              downloads++
              return { data: archive }
            },
          },
        },
      }
      const result = await downloadBenchmarkReport({
        github,
        owner: 'owner',
        repo: 'library',
        run: harness().run,
      })
      deepStrictEqual(result, { metadata, report })
      strictEqual(existsSync(executed), false)
      artifact.size_in_bytes = 1024 * 1024 + 1
      await rejects(
        () =>
          downloadBenchmarkReport({
            github,
            owner: 'owner',
            repo: 'library',
            run: harness().run,
          }),
        /oversized benchmark artifact/
      )
      strictEqual(downloads, 1)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }
)
