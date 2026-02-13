#!/usr/bin/env -S pnpm exec tsx
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

interface CliArgs {
  repo?: string;
  sampleSize?: number;
  lookbackHours?: number;
  output?: string;
  failOnMissing: boolean;
}

interface RequiredWorkflowsOutput {
  requiredWorkflows: string[];
}

interface WorkflowRun {
  name: string;
  status: string;
  conclusion: string | null;
  createdAt: string;
}

interface PullRequestSummary {
  number: number;
  title: string;
  url: string;
  headSha: string;
  mergedAt: string;
  changedFiles: string[];
}

interface CheckedPullRequest {
  number: number;
  title: string;
  url: string;
  headSha: string;
  mergedAt: string;
  changedFilesCount: number;
  requiredWorkflows: string[];
  observedWorkflows: string[];
  missingWorkflows: string[];
  workflowStates: Record<string, string>;
}

interface ValidationOutput {
  generatedAt: string;
  repo: string;
  sampleSize: number;
  lookbackHours: number;
  checkedPullRequests: CheckedPullRequest[];
  potentialFalseNegatives: CheckedPullRequest[];
  notes: string[];
}

const DEFAULT_SAMPLE_SIZE = 20;
const DEFAULT_LOOKBACK_HOURS = 24;

function parsePositiveInt(rawValue: string, key: string): number {
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${key}: ${rawValue}`);
  }
  return parsed;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { failOnMissing: false };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      continue;
    }

    if (token === '--fail-on-missing') {
      args.failOnMissing = true;
      continue;
    }

    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }

    if (key === 'repo') {
      args.repo = next;
    } else if (key === 'sample-size') {
      args.sampleSize = parsePositiveInt(next, 'sample-size');
    } else if (key === 'lookback-hours') {
      args.lookbackHours = parsePositiveInt(next, 'lookback-hours');
    } else if (key === 'output') {
      args.output = next;
    } else {
      throw new Error(`Unknown argument: --${key}`);
    }

    i += 1;
  }

  return args;
}

function runCommand(command: string, args: string[]): string {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function parsePullRequestSummaries(rawJson: string): PullRequestSummary[] {
  const results: PullRequestSummary[] = [];
  const lines = rawJson
    .split('\n')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  for (const line of lines) {
    let entry: unknown = null;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }

    const numberRaw = Reflect.get(entry, 'number');
    const titleRaw = Reflect.get(entry, 'title');
    const urlRaw = Reflect.get(entry, 'url');
    const mergedAtRaw = Reflect.get(entry, 'merged_at');
    const headShaRaw = Reflect.get(entry, 'head_sha');

    if (
      typeof numberRaw !== 'number' ||
      typeof titleRaw !== 'string' ||
      typeof urlRaw !== 'string' ||
      typeof mergedAtRaw !== 'string' ||
      typeof headShaRaw !== 'string'
    ) {
      continue;
    }

    results.push({
      number: numberRaw,
      title: titleRaw,
      url: urlRaw,
      headSha: headShaRaw,
      mergedAt: mergedAtRaw,
      changedFiles: []
    });
  }

  return results;
}

function getChangedFilesForPullRequest(repo: string, pullNumber: number): string[] {
  const out = runCommand('gh', [
    'api',
    '--paginate',
    '--jq',
    '.[].filename',
    `/repos/${repo}/pulls/${pullNumber}/files?per_page=100`
  ]);

  if (out.length === 0) {
    return [];
  }

  return out
    .split('\n')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function getRecentMergedPullRequests(repo: string, sampleSize: number, cutoffMs: number): PullRequestSummary[] {
  const out = runCommand('gh', [
    'api',
    '--jq',
    '.[] | {number: .number, title: .title, url: .html_url, merged_at: .merged_at, head_sha: .head.sha} | @json',
    `/repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100`
  ]);
  const candidates = parsePullRequestSummaries(out);

  const selected: PullRequestSummary[] = [];
  for (const candidate of candidates) {
    const mergedAtMs = Date.parse(candidate.mergedAt);
    if (Number.isNaN(mergedAtMs) || mergedAtMs < cutoffMs) {
      continue;
    }

    candidate.changedFiles = getChangedFilesForPullRequest(repo, candidate.number);
    selected.push(candidate);
    if (selected.length >= sampleSize) {
      break;
    }
  }

  return selected;
}

function parseRequiredWorkflows(rawJson: string): RequiredWorkflowsOutput {
  const parsed = JSON.parse(rawJson);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('requiredWorkflows output must be a JSON object');
  }

  const workflowsRaw = Reflect.get(parsed, 'requiredWorkflows');
  if (!Array.isArray(workflowsRaw) || !workflowsRaw.every((entry) => typeof entry === 'string')) {
    throw new Error('requiredWorkflows output.requiredWorkflows must be a string[]');
  }

  return {
    requiredWorkflows: workflowsRaw
  };
}

function getRequiredWorkflows(files: string[]): string[] {
  const fileArg = files.join(',');
  const out = runCommand('pnpm', ['exec', 'tsx', 'scripts/ciImpact/requiredWorkflows.ts', '--files', fileArg]);
  return parseRequiredWorkflows(out).requiredWorkflows;
}

function parseWorkflowRuns(rawJson: string): WorkflowRun[] {
  const parsed = JSON.parse(rawJson);
  if (typeof parsed !== 'object' || parsed === null) {
    return [];
  }

  const runsRaw = Reflect.get(parsed, 'workflow_runs');
  if (!Array.isArray(runsRaw)) {
    return [];
  }

  const runs: WorkflowRun[] = [];
  for (const runEntry of runsRaw) {
    if (typeof runEntry !== 'object' || runEntry === null) {
      continue;
    }

    const nameRaw = Reflect.get(runEntry, 'name');
    const statusRaw = Reflect.get(runEntry, 'status');
    const conclusionRaw = Reflect.get(runEntry, 'conclusion');
    const createdAtRaw = Reflect.get(runEntry, 'created_at');

    if (typeof nameRaw !== 'string' || typeof statusRaw !== 'string' || typeof createdAtRaw !== 'string') {
      continue;
    }

    let conclusion: string | null = null;
    if (typeof conclusionRaw === 'string') {
      conclusion = conclusionRaw;
    }

    runs.push({
      name: nameRaw,
      status: statusRaw,
      conclusion,
      createdAt: createdAtRaw
    });
  }

  return runs;
}

function getObservedWorkflowStates(repo: string, headSha: string): Map<string, WorkflowRun> {
  const out = runCommand('gh', ['api', `/repos/${repo}/actions/runs?head_sha=${headSha}&per_page=100`]);
  const runs = parseWorkflowRuns(out);

  const latestByName = new Map<string, WorkflowRun>();
  for (const run of runs) {
    const existing = latestByName.get(run.name);
    if (existing === undefined) {
      latestByName.set(run.name, run);
      continue;
    }

    const existingTs = Date.parse(existing.createdAt);
    const currentTs = Date.parse(run.createdAt);
    if (!Number.isNaN(currentTs) && (Number.isNaN(existingTs) || currentTs > existingTs)) {
      latestByName.set(run.name, run);
    }
  }

  return latestByName;
}

function main(): void {
  const args = parseArgs(process.argv);
  const repo = args.repo || process.env.GITHUB_REPOSITORY;
  if (repo === undefined || repo.length === 0) {
    throw new Error('Missing repo. Pass --repo owner/name or set GITHUB_REPOSITORY.');
  }

  const sampleSize = args.sampleSize || DEFAULT_SAMPLE_SIZE;
  const lookbackHours = args.lookbackHours || DEFAULT_LOOKBACK_HOURS;
  const cutoffMs = Date.now() - lookbackHours * 60 * 60 * 1000;

  const notes: string[] = [];
  const pullRequests = getRecentMergedPullRequests(repo, sampleSize, cutoffMs);
  if (pullRequests.length === 0) {
    notes.push('No merged pull requests found in lookback window.');
  }

  const checkedPullRequests: CheckedPullRequest[] = [];
  for (const pullRequest of pullRequests) {
    if (pullRequest.changedFiles.length === 0) {
      notes.push(`PR #${pullRequest.number} had no changed files listed by API; skipped.`);
      continue;
    }

    const requiredWorkflows = getRequiredWorkflows(pullRequest.changedFiles);
    const observedMap = getObservedWorkflowStates(repo, pullRequest.headSha);
    const observedWorkflows = [...observedMap.keys()].sort((a, b) => a.localeCompare(b));
    const missingWorkflows = requiredWorkflows
      .filter((workflowName) => !observedMap.has(workflowName))
      .sort((a, b) => a.localeCompare(b));

    const workflowStates: Record<string, string> = {};
    for (const [workflowName, state] of observedMap.entries()) {
      workflowStates[workflowName] = `${state.status}/${state.conclusion ?? 'null'}`;
    }

    checkedPullRequests.push({
      number: pullRequest.number,
      title: pullRequest.title,
      url: pullRequest.url,
      headSha: pullRequest.headSha,
      mergedAt: pullRequest.mergedAt,
      changedFilesCount: pullRequest.changedFiles.length,
      requiredWorkflows,
      observedWorkflows,
      missingWorkflows,
      workflowStates
    });
  }

  const potentialFalseNegatives = checkedPullRequests.filter((pr) => pr.missingWorkflows.length > 0);

  const output: ValidationOutput = {
    generatedAt: new Date().toISOString(),
    repo,
    sampleSize,
    lookbackHours,
    checkedPullRequests,
    potentialFalseNegatives,
    notes
  };

  if (args.output !== undefined) {
    fs.writeFileSync(args.output, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  }

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);

  if (args.failOnMissing && potentialFalseNegatives.length > 0) {
    process.exit(1);
  }
}

main();
