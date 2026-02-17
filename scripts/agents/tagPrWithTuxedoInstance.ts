#!/usr/bin/env -S pnpm exec tsx
import { execFileSync } from 'node:child_process';
import path from 'node:path';

interface CliArgs {
  prNumber?: string;
  help: boolean;
}

interface Label {
  name?: string;
}

function usage(): string {
  return `Usage: tagPrWithTuxedoInstance.ts [--pr <number>]

Tags the PR with the current tuxedo instance (workspace folder name).
Removes any existing tuxedo:* labels before adding the new one.

Options:
  --pr <number>   PR number (auto-detected from current branch if omitted)
  -h, --help      Show help`;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { help: false };

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') {
      args.help = true;
      continue;
    }
    if (token === '--pr') {
      const value = argv[index + 1];
      if (value === undefined || value.length === 0) {
        throw new Error('Error: --pr requires a value.');
      }
      args.prNumber = value;
      index += 1;
      continue;
    }
    throw new Error(`Error: Unknown option '${token}'.`);
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

function parseLabelNames(raw: string): string[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    return [];
  }

  const names: string[] = [];
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const label = entry as Label;
    if (typeof label.name === 'string') {
      names.push(label.name);
    }
  }
  return names;
}

function getRepoRoot(): string {
  const root = tryRun('git', ['rev-parse', '--show-toplevel']);
  if (!root) {
    throw new Error('Error: Not in a git repository.');
  }
  return root;
}

function getRepoName(): string {
  const repo = tryRun('gh', [
    'repo',
    'view',
    '--json',
    'nameWithOwner',
    '-q',
    '.nameWithOwner'
  ]);
  if (!repo) {
    throw new Error('Error: Could not determine repository.');
  }
  return repo;
}

function resolvePrNumber(explicitPr: string | undefined): string {
  if (explicitPr && explicitPr.length > 0) {
    return explicitPr;
  }

  const detected = tryRun('gh', [
    'pr',
    'view',
    '--json',
    'number',
    '--jq',
    '.number'
  ]);
  if (!detected) {
    throw new Error(
      'Error: No PR found for current branch. Use --pr to specify.'
    );
  }
  return detected;
}

function ensureValidPrNumber(prNumber: string): void {
  if (!/^[1-9]\d*$/.test(prNumber)) {
    throw new Error(`Error: Invalid PR number '${prNumber}'.`);
  }
}

function main(): void {
  const args = parseArgs(process.argv);
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const repoRoot = getRepoRoot();
  const instanceName = path.basename(repoRoot);
  const repo = getRepoName();
  const prNumber = resolvePrNumber(args.prNumber);
  ensureValidPrNumber(prNumber);

  const newLabel = `tuxedo:${instanceName}`;

  const currentLabelsRaw = tryRun('gh', [
    'pr',
    'view',
    prNumber,
    '--json',
    'labels',
    '--jq',
    '.labels',
    '-R',
    repo
  ]);
  const currentLabels = currentLabelsRaw
    ? parseLabelNames(currentLabelsRaw)
    : [];
  const oldTuxedoLabels = currentLabels.filter((label) =>
    label.startsWith('tuxedo:')
  );

  if (oldTuxedoLabels.length === 1 && oldTuxedoLabels[0] === newLabel) {
    process.stdout.write(
      `Label '${newLabel}' is already the only tuxedo label on PR #${prNumber}.\n`
    );
    return;
  }

  for (const oldLabel of oldTuxedoLabels) {
    tryRun('gh', [
      'pr',
      'edit',
      prNumber,
      '--remove-label',
      oldLabel,
      '-R',
      repo
    ]);
    process.stdout.write(`Removed label '${oldLabel}' from PR #${prNumber}.\n`);
  }

  const repoLabelsRaw = tryRun('gh', [
    'label',
    'list',
    '--json',
    'name',
    '--jq',
    '.',
    '-R',
    repo
  ]);
  const repoLabels = repoLabelsRaw ? parseLabelNames(repoLabelsRaw) : [];

  if (!repoLabels.includes(newLabel)) {
    tryRun('gh', [
      'label',
      'create',
      newLabel,
      '--description',
      `Tuxedo instance: ${instanceName}`,
      '--color',
      '1D76DB',
      '-R',
      repo
    ]);
    process.stdout.write(`Created label '${newLabel}'.\n`);
  }

  run('gh', ['pr', 'edit', prNumber, '--add-label', newLabel, '-R', repo]);
  const verifyRaw = run('gh', [
    'pr',
    'view',
    prNumber,
    '--json',
    'labels',
    '--jq',
    '.labels',
    '-R',
    repo
  ]);
  const verifyLabels = parseLabelNames(verifyRaw);

  if (!verifyLabels.includes(newLabel)) {
    throw new Error(
      `Error: Failed to add label '${newLabel}' to PR #${prNumber}.`
    );
  }

  process.stdout.write(`Tagged PR #${prNumber} with '${newLabel}'.\n`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  if (message.startsWith('Error: Unknown option')) {
    process.stderr.write(`${usage()}\n`);
  }
  process.exit(1);
}
