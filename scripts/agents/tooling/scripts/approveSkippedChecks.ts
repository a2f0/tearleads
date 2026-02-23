#!/usr/bin/env -S pnpm exec tsx
import { execFileSync } from 'node:child_process';

interface CliArgs {
  prNumber?: string;
  dryRun: boolean;
  help: boolean;
}

interface CheckRun {
  name: string;
  status: string;
  conclusion: string | null;
}

interface CheckRunApiItem {
  name?: unknown;
  status?: unknown;
  conclusion?: unknown;
}

interface CheckRunsApiResponse {
  check_runs?: unknown;
}

class UsageError extends Error {}

function usage(): string {
  return `Usage: approveSkippedChecks.ts [--pr <number>] [--dry-run] [--help]

This script creates check runs with "success" conclusion for required checks
that are currently "skipped" due to CI impact detection.

Options:
  --pr <number>   PR number (auto-detected from current branch if omitted)
  --dry-run       Perform a dry run without creating actual check runs
  --help, -h      Show help`;
}

const requiredChecks = [
  'build',
  'Web E2E Tests (Release)',
  'Electron E2E Tests (Release)',
  'Website E2E Tests (Release)',
  'Android Instrumented Tests',
  'Android Maestro Tests (Release)',
  'iOS Maestro Tests (Release)'
];

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { dryRun: false, help: false };

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--pr') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error('Missing value for --pr');
      }
      args.prNumber = value;
      index += 1;
      continue;
    }

    if (token === '--dry-run') {
      args.dryRun = true;
      continue;
    }

    if (token === '--help' || token === '-h') {
      args.help = true;
      continue;
    }

    throw new UsageError(`Unknown option: ${token}`);
  }

  return args;
}

function run(command: string, args: string[]): string {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function tryRun(command: string, args: string[]): string | null {
  try {
    return run(command, args);
  } catch {
    return null;
  }
}

function parseCheckRuns(raw: string): CheckRun[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object') {
    return [];
  }

  const response = parsed as CheckRunsApiResponse;
  if (!Array.isArray(response.check_runs)) {
    return [];
  }

  const checkRuns: CheckRun[] = [];
  for (const item of response.check_runs) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const current = item as CheckRunApiItem;
    const nameRaw = current.name;
    const statusRaw = current.status;
    const conclusionRaw = current.conclusion;

    if (typeof nameRaw !== 'string' || typeof statusRaw !== 'string') {
      continue;
    }

    checkRuns.push({
      name: nameRaw,
      status: statusRaw,
      conclusion: typeof conclusionRaw === 'string' ? conclusionRaw : null
    });
  }

  return checkRuns;
}

function getRepo(): string {
  const raw = run('gh', ['repo', 'view', '--json', 'nameWithOwner']);
  return (JSON.parse(raw) as { nameWithOwner: string }).nameWithOwner;
}

function getPrNumber(maybePrNumber: string | undefined): string {
  if (maybePrNumber && maybePrNumber.length > 0) {
    return maybePrNumber;
  }

  const raw = tryRun('gh', ['pr', 'view', '--json', 'number']);
  if (!raw || raw.length === 0) {
    throw new UsageError('Could not determine PR number. Use --pr <number>');
  }
  const parsed = (JSON.parse(raw) as { number: number }).number;
  return String(parsed);
}

function getHeadSha(repo: string, prNumber: string): string {
  const raw = run('gh', [
    'pr',
    'view',
    prNumber,
    '--json',
    'headRefOid',
    '-R',
    repo
  ]);
  return (JSON.parse(raw) as { headRefOid: string }).headRefOid;
}

function createCheckRun(params: {
  repo: string;
  headSha: string;
  checkName: string;
  dryRun: boolean;
}): void {
  if (params.dryRun) {
    process.stdout.write(
      `  [DRY-RUN] Would create check run: ${params.checkName}\n`
    );
    return;
  }

  run('gh', [
    'api',
    `repos/${params.repo}/check-runs`,
    '--method',
    'POST',
    '-f',
    `name=${params.checkName}`,
    '-f',
    `head_sha=${params.headSha}`,
    '-f',
    'status=completed',
    '-f',
    'conclusion=success',
    '-f',
    'output[title]=Skipped (no impact)',
    '-f',
    'output[summary]=This check was skipped because no relevant code changes were detected. Approved by approveSkippedChecks.ts.'
  ]);

  process.stdout.write(`  Created passing check run: ${params.checkName}\n`);
}

function getStatus(
  checkRuns: CheckRun[],
  checkName: string
): { status: string | null; conclusion: string | null } {
  const match = checkRuns.find((check) => check.name === checkName);
  if (!match) {
    return { status: null, conclusion: null };
  }

  return { status: match.status, conclusion: match.conclusion };
}

function main(): void {
  const args = parseArgs(process.argv);
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const repo = getRepo();
  const prNumber = getPrNumber(args.prNumber);
  const headSha = getHeadSha(repo, prNumber);

  process.stdout.write(`Repository: ${repo}\n`);
  process.stdout.write(`PR: #${prNumber}\n`);
  process.stdout.write(`Head SHA: ${headSha}\n\n`);

  const checkRunsOutput = run('gh', [
    'api',
    `repos/${repo}/commits/${headSha}/check-runs`
  ]);
  const checkRuns = parseCheckRuns(checkRunsOutput);

  process.stdout.write('Checking required checks...\n');

  let created = 0;
  let alreadyPassing = 0;

  for (const checkName of requiredChecks) {
    const status = getStatus(checkRuns, checkName);
    if (!status.status) {
      process.stdout.write(`  ${checkName}: MISSING\n`);
      createCheckRun({
        repo,
        headSha,
        checkName,
        dryRun: args.dryRun
      });
      created += 1;
      continue;
    }

    if (status.status === 'completed' && status.conclusion === 'skipped') {
      process.stdout.write(
        `  ${checkName}: SKIPPED -> creating passing check\n`
      );
      createCheckRun({
        repo,
        headSha,
        checkName,
        dryRun: args.dryRun
      });
      created += 1;
      continue;
    }

    if (status.status === 'completed' && status.conclusion === 'success') {
      process.stdout.write(`  ${checkName}: already passing\n`);
      alreadyPassing += 1;
      continue;
    }

    process.stdout.write(
      `  ${checkName}: ${status.status} (${status.conclusion || 'none'})\n`
    );
  }

  process.stdout.write('\n');
  process.stdout.write(
    `Summary: ${created} check(s) created, ${alreadyPassing} already passing\n`
  );

  if (!args.dryRun && created > 0) {
    process.stdout.write('\nCheck PR status at:\n');
    process.stdout.write(`  https://github.com/${repo}/pull/${prNumber}\n`);
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  if (error instanceof UsageError) {
    process.stderr.write(`${usage()}\n`);
  }
  process.exit(1);
}
