/* eslint-env node */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const marker = '<!-- sinks-benchmark-report -->'
const shaPattern = /^[a-f0-9]{40}$/
const workflowPath = '.github/workflows/benchmarks.yaml'
const positiveInteger = value => Number.isSafeInteger(value) && value > 0
const validTime = value => Number.isFinite(value) && value > 0 && value <= 60000

const validateMetadata = (metadata, run, repository) => {
  if (
    metadata.schemaVersion !== 1 ||
    metadata.repository !== repository ||
    !positiveInteger(metadata.pullRequest) ||
    metadata.runId !== run.id ||
    metadata.runAttempt !== run.run_attempt ||
    metadata.headSha !== run.head_sha ||
    !shaPattern.test(metadata.headSha) ||
    !shaPattern.test(metadata.baseSha) ||
    typeof metadata.headRepository !== 'string'
  )
    throw Error('Invalid benchmark context')
  const reference = (run.pull_requests || []).find(
    pull => pull.number === metadata.pullRequest
  )
  if (reference?.base?.sha && reference.base.sha !== metadata.baseSha)
    throw Error('Invalid benchmark base commit')
}

export const validateBenchmarkResults = report => {
  if (
    !report ||
    !Array.isArray(report.results) ||
    report.results.length < 1 ||
    report.results.length > 100 ||
    !Number.isInteger(report.samples) ||
    report.samples < 3 ||
    report.samples > 101 ||
    !/^v\d+\.\d+\.\d+$/.test(report.environment?.node) ||
    !/^[a-z0-9]{1,20}$/.test(report.environment?.platform) ||
    !/^[a-z0-9]{1,20}$/.test(report.environment?.arch)
  )
    throw Error('Invalid benchmark results')
  const seen = new Set()
  return report.results.map(row => {
    if (
      !Number.isSafeInteger(row.size) ||
      row.size < 2 ||
      row.size > 1000000 ||
      typeof row.workload !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9 ._()-]{0,99}$/.test(row.workload) ||
      !validTime(row.baselineMs) ||
      !validTime(row.candidateMs) ||
      !Number.isFinite(row.candidateMs / row.baselineMs) ||
      seen.has(row.size + '/' + row.workload)
    )
      throw Error('Invalid benchmark row')
    seen.add(row.size + '/' + row.workload)
    // Ignore supplied ratios, Markdown, URLs, and module paths from the artifact.
    return {
      size: row.size,
      workload: row.workload,
      baselineMs: row.baselineMs,
      candidateMs: row.candidateMs,
      ratio: row.candidateMs / row.baselineMs,
    }
  })
}

const milliseconds = value => value.toFixed(Math.abs(value) >= 1 ? 2 : 5)
const table = rows =>
  [
    '| Workload | Size | Base ms | PR ms | Change ms | PR/base |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    ...rows.map(row => {
      const delta = row.candidateMs - row.baselineMs
      return `| ${row.workload} | ${row.size} | ${milliseconds(
        row.baselineMs
      )} | ${milliseconds(row.candidateMs)} | ${
        delta >= 0 ? '+' : ''
      }${milliseconds(delta)} | ${row.ratio.toFixed(2)}× |`
    }),
  ].join('\n')

export const formatBenchmarkReport = ({
  report,
  metadata,
  conclusion,
  runUrl,
  repository,
}) => {
  const intro = [
    marker,
    `<!-- sinks-benchmark-run:${metadata.runId}:${metadata.runAttempt} -->`,
    '### Benchmark comparison',
    '',
    `Base [\`${metadata.baseSha.slice(
      0,
      7
    )}\`](https://github.com/${repository}/commit/${
      metadata.baseSha
    }) → PR [\`${metadata.headSha.slice(
      0,
      7
    )}\`](https://github.com/${repository}/commit/${metadata.headSha}).`,
  ]
  if (conclusion !== 'success')
    return [
      ...intro,
      '',
      'The benchmark job failed; no timing comparison is available.',
      'Check the workflow logs for installation, correctness, or execution errors.',
      '',
      `[Workflow logs](${runUrl})`,
    ].join('\n')
  const rows = validateBenchmarkResults(report)
  const largest = [...rows]
    .sort(
      (first, second) =>
        Math.abs(second.candidateMs - second.baselineMs) -
        Math.abs(first.candidateMs - first.baselineMs)
    )
    .slice(0, 5)
  return [
    ...intro,
    '',
    `Node ${report.environment.node}, ${report.environment.platform}/${report.environment.arch}; median of ${report.samples} samples. Both versions ran on the same runner.`,
    '',
    'Largest changes by absolute time:',
    '',
    table(largest),
    '',
    '<details>',
    '<summary>All benchmark results</summary>',
    '',
    table(rows),
    '',
    '</details>',
    '',
    '**Advisory:** ratios below 1 are faster. Hosted-runner timings vary; timing changes do not fail the benchmark job. Incorrect results and execution errors do.',
    '',
    `[Full JSON artifact and workflow logs](${runUrl})`,
  ].join('\n')
}

export const downloadBenchmarkReport = async ({ github, owner, repo, run }) => {
  const artifacts = await github.paginate(
    github.rest.actions.listWorkflowRunArtifacts,
    {
      owner,
      repo,
      run_id: run.id,
      per_page: 100,
    }
  )
  const matches = artifacts.filter(
    artifact =>
      artifact.name === `sinks-benchmark-${run.run_attempt}` &&
      !artifact.expired
  )
  if (matches.length !== 1 || matches[0].size_in_bytes > 1024 * 1024)
    throw Error('Missing or oversized benchmark artifact')
  const download = await github.rest.actions.downloadArtifact({
    owner,
    repo,
    artifact_id: matches[0].id,
    archive_format: 'zip',
  })
  const archive = Buffer.from(download.data)
  if (archive.length > 1024 * 1024) throw Error('Oversized benchmark archive')
  const directory = mkdtempSync(join(tmpdir(), 'sinks-benchmark-report-'))
  try {
    const path = join(directory, 'report.zip')
    writeFileSync(path, archive)
    // Read only the two named files to stdout. Never extract or execute files
    // from PR artifacts, including scripts, symlinks, or traversal paths.
    const read = name =>
      JSON.parse(
        execFileSync('unzip', ['-p', path, name], {
          encoding: 'utf8',
          maxBuffer: 1024 * 1024,
          timeout: 10000,
        })
      )
    return {
      metadata: read('context.json'),
      report: run.conclusion === 'success' ? read('results.json') : null,
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

export const postBenchmarkReport = async ({
  github,
  context,
  core,
  readReport = downloadBenchmarkReport,
}) => {
  const { owner, repo } = context.repo
  const repository = owner + '/' + repo
  const eventRun = context.payload.workflow_run
  const { data: run } = await github.rest.actions.getWorkflowRun({
    owner,
    repo,
    run_id: eventRun.id,
  })
  if (
    run.event !== 'pull_request' ||
    run.path !== workflowPath ||
    run.status !== 'completed' ||
    run.conclusion === 'cancelled' ||
    run.run_attempt !== eventRun.run_attempt
  ) {
    core.info('Skipping an unrelated, incomplete, cancelled, or superseded run')
    return
  }
  const { metadata, report } = await readReport({ github, owner, repo, run })
  validateMetadata(metadata, run, repository)
  let associated = (run.pull_requests || []).some(
    pull => pull.number === metadata.pullRequest
  )
  if (!associated) {
    // Fork workflow runs may have an empty pull_requests array.
    const pulls = await github.paginate(
      github.rest.repos.listPullRequestsAssociatedWithCommit,
      {
        owner,
        repo,
        commit_sha: run.head_sha,
        per_page: 100,
      }
    )
    associated = pulls.some(
      pull =>
        pull.number === metadata.pullRequest &&
        pull.base.repo.full_name === repository
    )
  }
  if (!associated)
    throw Error(
      'Benchmark artifact does not identify a PR associated with this run'
    )
  const getPull = async () =>
    (
      await github.rest.pulls.get({
        owner,
        repo,
        pull_number: metadata.pullRequest,
      })
    ).data
  const isCurrent = pull =>
    pull.state === 'open' &&
    pull.head.sha === run.head_sha &&
    pull.base.repo.full_name === repository &&
    pull.head.repo?.full_name === metadata.headRepository
  if (!isCurrent(await getPull())) {
    core.info('Skipping results for a closed PR or an outdated head')
    return
  }
  const comments = await github.paginate(github.rest.issues.listComments, {
    owner,
    repo,
    issue_number: metadata.pullRequest,
    per_page: 100,
  })
  const existing = comments.find(
    comment =>
      comment.user?.login === 'github-actions[bot]' &&
      comment.body?.startsWith(marker)
  )
  const previous = existing?.body.match(
    /<!-- sinks-benchmark-run:(\d+):(\d+) -->/
  )
  if (
    previous &&
    (Number(previous[1]) > run.id ||
      (Number(previous[1]) === run.id && Number(previous[2]) > run.run_attempt))
  ) {
    core.info('Skipping a result older than the existing comment')
    return
  }
  const body = formatBenchmarkReport({
    report,
    metadata,
    conclusion: run.conclusion,
    repository,
    runUrl: `https://github.com/${repository}/actions/runs/${run.id}`,
  })
  // Recheck after fetching artifacts/comments to reduce stale-update races.
  if (!isCurrent(await getPull())) {
    core.info('The PR changed while preparing the report')
    return
  }
  if (existing)
    await github.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existing.id,
      body,
    })
  else
    await github.rest.issues.createComment({
      owner,
      repo,
      issue_number: metadata.pullRequest,
      body,
    })
}
