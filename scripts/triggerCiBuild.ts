#!/usr/bin/env -S pnpm exec tsx
import { execFileSync, spawnSync } from 'node:child_process';

interface CliArgs {
  branch?: string;
  wait: boolean;
}

interface WorkflowRunSummary {
  name: string;
  status: string;
  conclusion: string | null;
}

const WORKFLOWS = [
  { file: 'build.yml', checkName: 'build' },
  { file: 'web-e2e.yml', checkName: 'Web E2E Tests (Release)' },
  { file: 'electron-e2e.yml', checkName: 'Electron E2E Tests (Release)' },
  { file: 'website-e2e.yml', checkName: 'Website E2E Tests (Release)' },
  { file: 'android.yml', checkName: 'Android Instrumented Tests' },
  {
    file: 'android-maestro-release.yml',
    checkName: 'Android Maestro Tests (Release)'
  },
  { file: 'ios-maestro-release.yml', checkName: 'iOS Maestro Tests (Release)' }
] as const;

const STARTUP_WAIT_MS = 30_000;
const POLL_INTERVAL_MS = 30_000;
const MAX_WAIT_MS = 3_600_000;

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { wait: false };

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--branch') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error('Missing value for --branch');
      }
      args.branch = value;
      index += 1;
      continue;
    }

    if (token === '--wait') {
      args.wait = true;
      continue;
    }

    throw new Error(`Unknown option: ${token}`);
  }

  return args;
}

function run(command: string, args: string[]): string {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function tryRunOutput(command: string, args: string[]): string | null {
  try {
    return run(command, args);
  } catch {
    return null;
  }
}

function tryRun(command: string, args: string[]): void {
  spawnSync(command, args, {
    stdio: ['ignore', 'ignore', 'ignore']
  });
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function parseRunList(raw: string): WorkflowRunSummary[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    return [];
  }

  const runs: WorkflowRunSummary[] = [];
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }

    const nameRaw = Reflect.get(item, 'name');
    const statusRaw = Reflect.get(item, 'status');
    const conclusionRaw = Reflect.get(item, 'conclusion');

    if (typeof nameRaw !== 'string' || typeof statusRaw !== 'string') {
      continue;
    }

    runs.push({
      name: nameRaw,
      status: statusRaw,
      conclusion: typeof conclusionRaw === 'string' ? conclusionRaw : null
    });
  }

  return runs;
}

function findCheckStatus(
  runs: WorkflowRunSummary[],
  checkName: string
): { status: string | null; conclusion: string | null } {
  const matched = runs.find((run) => run.name === checkName);
  if (!matched) {
    return { status: null, conclusion: null };
  }
  return { status: matched.status, conclusion: matched.conclusion };
}

async function waitForCompletion(repo: string, headSha: string): Promise<void> {
  process.stdout.write('\nWaiting for workflows to complete...\n');
  await sleep(STARTUP_WAIT_MS);

  const startedAt = Date.now();
  while (Date.now() - startedAt < MAX_WAIT_MS) {
    const runsOutput = run('gh', [
      'run',
      'list',
      '--commit',
      headSha,
      '--json',
      'name,status,conclusion',
      '-R',
      repo
    ]);
    const runs = parseRunList(runsOutput);

    let pending = 0;
    let failed = 0;

    for (const workflow of WORKFLOWS) {
      const { status, conclusion } = findCheckStatus(runs, workflow.checkName);
      if (status === 'completed') {
        if (conclusion !== 'success' && conclusion !== 'skipped') {
          process.stdout.write(
            `  FAILED: ${workflow.checkName} (${conclusion ?? 'unknown'})\n`
          );
          failed += 1;
        }
      } else if (status) {
        pending += 1;
      }
    }

    if (failed > 0) {
      throw new Error('Some workflows failed.');
    }

    if (pending === 0) {
      process.stdout.write('All workflows completed.\n');
      return;
    }

    const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
    process.stdout.write(
      `  ${pending} workflow(s) still running... (${elapsedSeconds}s elapsed)\n`
    );
    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error('Timeout waiting for workflows.');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const branch = args.branch ?? run('git', ['branch', '--show-current']);
  const repo = run('gh', [
    'repo',
    'view',
    '--json',
    'nameWithOwner',
    '-q',
    '.nameWithOwner'
  ]);
  const headSha = run('git', ['rev-parse', 'HEAD']);

  process.stdout.write(
    `Triggering CI workflows for branch: ${branch} (commit: ${headSha.slice(0, 8)})\n`
  );
  process.stdout.write(`Repository: ${repo}\n`);
  process.stdout.write('\nTriggering workflows...\n');

  for (const workflow of WORKFLOWS) {
    process.stdout.write(`  - ${workflow.file}\n`);
    tryRun('gh', [
      'workflow',
      'run',
      workflow.file,
      '--ref',
      branch,
      '-R',
      repo
    ]);
  }

  if (args.wait) {
    await waitForCompletion(repo, headSha);
  }

  const prNumber = tryRunOutput('gh', [
    'pr',
    'view',
    '--json',
    'number',
    '-q',
    '.number',
    '-R',
    repo
  ]);

  process.stdout.write('\nDone. Check PR status at:\n');
  process.stdout.write(
    `  https://github.com/${repo}/pull/${prNumber ?? '<pr-number>'}\n`
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
