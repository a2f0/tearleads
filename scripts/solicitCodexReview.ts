#!/usr/bin/env -S pnpm exec tsx
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
process.chdir(rootDir);

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

function ensureChanges(baseRef: string): void {
  const result = spawnSync('git', ['diff', '--quiet', `${baseRef}...HEAD`], {
    stdio: 'ignore'
  });
  if (result.status === 0) {
    throw new Error(`No changes found between ${baseRef} and current branch.`);
  }
}

function main(): void {
  const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch === 'main') {
    throw new Error('Cannot review main branch. Checkout a PR branch first.');
  }

  const repo =
    tryRun('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']) ||
    '';
  if (repo.length === 0) {
    throw new Error('Could not determine repository. Ensure gh is authenticated.');
  }

  const prNumber =
    tryRun('gh', [
      'pr',
      'list',
      '--head',
      branch,
      '--state',
      'open',
      '--json',
      'number',
      '--jq',
      '.[0].number',
      '-R',
      repo
    ]) || '';
  if (prNumber.length === 0) {
    throw new Error(`No PR found for branch '${branch}'. Create a PR first.`);
  }

  const baseRef = run('gh', [
    'pr',
    'view',
    prNumber,
    '--json',
    'baseRefName',
    '-q',
    '.baseRefName',
    '-R',
    repo
  ]);

  ensureChanges(baseRef);

  const result = spawnSync(
    'codex',
    ['review', '--base', baseRef, '--title', `PR #${prNumber} (${branch})`],
    {
      stdio: 'inherit'
    }
  );

  process.exit(result.status || 0);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
}
