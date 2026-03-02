#!/usr/bin/env -S pnpm exec tsx
import 'dependency-cruiser';
import { spawnSync } from 'node:child_process';

const DEPCRUISE_ARGS_BASE = [
  'exec',
  'depcruise',
  '--config',
  '.dependency-cruiser.json'
];
const DEPCRUISE_JSON_ARGS = [
  ...DEPCRUISE_ARGS_BASE,
  '--output-type',
  'json',
  'packages'
];
const MODE = process.argv.find((arg) => arg.startsWith('--')) ?? '';

interface SpawnResult {
  status: number;
  stdout: string;
}

function runPnpmWithCapturedStdout(args: string[]): SpawnResult {
  const result = spawnSync('pnpm', args, {
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'inherit']
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? ''
  };
}

function runPnpmWithInheritedStdio(args: string[]): number {
  const result = spawnSync('pnpm', args, { stdio: 'inherit' });
  return result.status ?? 1;
}

function runSummary(summaryArgs: string[]): number {
  const depCruise = runPnpmWithCapturedStdout(DEPCRUISE_JSON_ARGS);
  if (depCruise.status !== 0) {
    if (depCruise.stdout.length > 0) {
      process.stdout.write(depCruise.stdout);
    }
    return depCruise.status;
  }

  const summary = spawnSync(
    'pnpm',
    [
      'exec',
      'tsx',
      'scripts/checks/dependencyCruiserSummary.ts',
      ...summaryArgs
    ],
    {
      encoding: 'utf8',
      input: depCruise.stdout,
      stdio: ['pipe', 'pipe', 'inherit']
    }
  );

  if ((summary.stdout ?? '').length > 0) {
    process.stdout.write(summary.stdout ?? '');
  }
  return summary.status ?? 1;
}

function main(): void {
  if (MODE === '--json') {
    process.exit(
      runPnpmWithInheritedStdio([
        ...DEPCRUISE_ARGS_BASE,
        '--output-type',
        'json',
        'packages'
      ])
    );
  }

  if (MODE === '--dot') {
    process.exit(
      runPnpmWithInheritedStdio([
        ...DEPCRUISE_ARGS_BASE,
        '--output-type',
        'dot',
        'packages'
      ])
    );
  }

  if (MODE === '--summary') {
    process.exit(runSummary([]));
  }

  if (MODE === '--summary-json') {
    process.exit(runSummary(['--json']));
  }

  if (MODE === '--exceptions') {
    process.exit(runSummary(['--exceptions-only']));
  }

  if (MODE === '--exceptions-json') {
    process.exit(runSummary(['--exceptions-only', '--json']));
  }

  process.exit(runPnpmWithInheritedStdio([...DEPCRUISE_ARGS_BASE, 'packages']));
}

main();
