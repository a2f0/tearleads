import { execFileSync, spawnSync } from 'node:child_process';
import { InvalidArgumentError } from 'commander';

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

export function parsePositiveInt(value: string, name: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!isPositiveInt(parsed)) {
    throw new InvalidArgumentError(`${name} must be a positive integer`);
  }
  return parsed;
}

export function getRepoRoot(providedRoot?: string): string {
  if (providedRoot) return providedRoot;

  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    throw new Error('Could not detect git repository root. Use --repo-root.');
  }
}

export function runWithTimeout(
  command: string,
  args: string[],
  timeoutMs: number,
  cwd?: string,
  env?: NodeJS.ProcessEnv
): CommandResult {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: timeoutMs,
    cwd,
    env: env ? { ...process.env, ...env } : undefined,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exitCode: result.status ?? 1
  };
}

export function extractKeyLines(output: string, count = 5): string[] {
  return output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .slice(-count);
}
