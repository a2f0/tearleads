import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import path from 'node:path';

export const resolveRealPath = (targetPath: string): string | null => {
  try {
    return realpathSync(targetPath);
  } catch {
    return null;
  }
};

export const resolveRepoRoot = (): string => {
  try {
    const output = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();

    if (output.length > 0) {
      const resolved = resolveRealPath(output);
      if (resolved) {
        return resolved;
      }
    }
  } catch {
    // Fall back to cwd when git isn't available.
  }

  return realpathSync(process.cwd());
};

export const getProcessCwd = (pid: number): string | null => {
  try {
    const output = execFileSync(
      'lsof',
      ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      }
    );
    const line = output
      .split('\n')
      .map((value) => value.trim())
      .find((value) => value.startsWith('n'));
    return line ? line.slice(1) : null;
  } catch {
    return null;
  }
};

const parsePids = (output: string): number[] =>
  output
    .trim()
    .split('\n')
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => !Number.isNaN(value));

export const getPidsOnPort = ({
  port,
  listenOnly = false
}: {
  port: number;
  listenOnly?: boolean;
}): number[] => {
  try {
    const args = ['-i', `:${port}`, '-t'];
    if (listenOnly) {
      args.push('-sTCP:LISTEN');
    }
    const output = execFileSync('lsof', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return parsePids(output);
  } catch {
    return [];
  }
};

export const isCwdWithinRepo = ({
  cwd,
  repoRoot
}: {
  cwd: string | null;
  repoRoot: string;
}): boolean => {
  if (!cwd) {
    return false;
  }

  const resolved = resolveRealPath(cwd);
  return Boolean(
    resolved &&
      (resolved === repoRoot || resolved.startsWith(`${repoRoot}${path.sep}`))
  );
};

export const isPidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export const killPid = (pid: number, signal: NodeJS.Signals): void => {
  try {
    process.kill(pid, signal);
  } catch {
    // Ignore errors for already-dead processes or permission issues.
  }
};

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
