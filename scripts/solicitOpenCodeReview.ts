#!/usr/bin/env -S pnpm exec tsx
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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

  const repoRaw = tryRun('gh', ['repo', 'view', '--json', 'nameWithOwner']);
  const repo = repoRaw
    ? (JSON.parse(repoRaw) as { nameWithOwner: string }).nameWithOwner
    : '';
  if (repo.length === 0) {
    throw new Error(
      'Could not determine repository. Ensure gh is authenticated.'
    );
  }

  const prListRaw = tryRun('gh', [
    'pr',
    'list',
    '--head',
    branch,
    '--state',
    'open',
    '--json',
    'number',
    '-R',
    repo
  ]);
  const prNumber = prListRaw
    ? String(
        (JSON.parse(prListRaw) as Array<{ number: number }>)[0]?.number ?? ''
      )
    : '';
  if (prNumber.length === 0) {
    throw new Error(`No PR found for branch '${branch}'. Create a PR first.`);
  }

  const baseRefRaw = run('gh', [
    'pr',
    'view',
    prNumber,
    '--json',
    'baseRefName',
    '-R',
    repo
  ]);
  const baseRef = (JSON.parse(baseRefRaw) as { baseRefName: string })
    .baseRefName;

  ensureChanges(baseRef);
  const diff = run('git', ['diff', `${baseRef}...HEAD`]);

  let reviewInstructions = '';
  const reviewPath = path.join(rootDir, 'REVIEW.md');
  if (existsSync(reviewPath)) {
    reviewInstructions = readFileSync(reviewPath, 'utf8');
  }

  const prompt = `Review this PR diff. Be concise and actionable.

## Review Guidelines
${reviewInstructions}

## PR Context
Branch: ${branch}
PR: #${prNumber}
Base: ${baseRef}

## Diff
${diff}

## Instructions
- Flag security issues, type safety violations, and missing tests as high priority
- Use severity levels: Blocker, Major, Minor, Suggestion
- Be concise: one line per issue with file:line reference
- Output your review to stdout
`;

  const result = spawnSync('opencode', ['run'], {
    stdio: ['pipe', 'inherit', 'inherit'],
    input: prompt
  });
  process.exit(result.status || 0);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
}
