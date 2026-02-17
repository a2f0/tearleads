#!/usr/bin/env -S pnpm exec tsx
import { execFileSync } from 'node:child_process';

type TargetType = 'pr' | 'issue';

interface CliArgs {
  type?: string;
  number?: string;
  label?: string;
  help: boolean;
}

interface LabelEntry {
  name?: string;
}

class UsageError extends Error {}

function usage(): string {
  return `Usage: addLabel.ts --type pr|issue --number <n> --label <name>

Options:
  --type <pr|issue>   Target type (required)
  --number <n>        PR or issue number (required)
  --label <name>      Label to add (required)
  -h, --help          Show help`;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { help: false };

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') {
      args.help = true;
      continue;
    }
    if (token === '--type') {
      const value = argv[index + 1];
      if (!value) throw new UsageError('Error: --type requires a value.');
      args.type = value;
      index += 1;
      continue;
    }
    if (token === '--number') {
      const value = argv[index + 1];
      if (!value) throw new UsageError('Error: --number requires a value.');
      args.number = value;
      index += 1;
      continue;
    }
    if (token === '--label') {
      const value = argv[index + 1];
      if (!value) throw new UsageError('Error: --label requires a value.');
      args.label = value;
      index += 1;
      continue;
    }
    throw new UsageError(`Error: Unknown option '${token}'.`);
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
    const value = (entry as LabelEntry).name;
    if (typeof value === 'string') {
      names.push(value);
    }
  }
  return names;
}

function validateType(value: string | undefined): TargetType {
  if (value === 'pr' || value === 'issue') {
    return value;
  }
  throw new Error("Error: --type must be 'pr' or 'issue'.");
}

function validateNumber(value: string | undefined): string {
  if (!value) {
    throw new UsageError('Error: --number is required.');
  }
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error('Error: --number must be a positive integer.');
  }
  return value;
}

function validateLabel(value: string | undefined): string {
  if (!value) {
    throw new Error('Error: --label is required.');
  }
  return value;
}

function main(): void {
  const args = parseArgs(process.argv);
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  if (!args.type) {
    throw new UsageError('Error: --type is required.');
  }

  const type = validateType(args.type);
  const number = validateNumber(args.number);
  const label = validateLabel(args.label);

  const repo = run('gh', [
    'repo',
    'view',
    '--json',
    'nameWithOwner',
    '-q',
    '.nameWithOwner'
  ]);
  const currentLabelsRaw = tryRun('gh', [
    type,
    'view',
    number,
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

  if (currentLabels.includes(label)) {
    process.stdout.write(
      `Label '${label}' already present on ${type} #${number}.\n`
    );
    return;
  }

  run('gh', [type, 'edit', number, '--add-label', label, '-R', repo]);
  const verifyRaw = run('gh', [
    type,
    'view',
    number,
    '--json',
    'labels',
    '--jq',
    '.labels',
    '-R',
    repo
  ]);
  const verifyLabels = parseLabelNames(verifyRaw);
  if (!verifyLabels.includes(label)) {
    throw new Error(
      `Error: Failed to add label '${label}' to ${type} #${number}.`
    );
  }

  process.stdout.write(`Added label '${label}' to ${type} #${number}.\n`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  if (error instanceof UsageError) {
    process.stderr.write(`${usage()}\n`);
  }
  process.exit(1);
}
