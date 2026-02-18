import { execFileSync, execSync } from 'node:child_process';

export function isShaLike(value: string): boolean {
  if (!/^[0-9a-fA-F]+$/.test(value)) return false;
  return value.length >= 7 && value.length <= 40;
}

export function requireDefined<T>(value: T | undefined, name: string): T {
  if (value === undefined) {
    throw new Error(`Missing required option: ${name}`);
  }
  return value;
}

export function getRepo(): string {
  try {
    const remoteUrl = execSync('git remote get-url origin', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();

    const sshMatch = remoteUrl.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/);
    if (sshMatch?.[1]) {
      return sshMatch[1];
    }
  } catch {
    // Fall through to gh fallback for environments without an origin remote.
  }

  try {
    return execFileSync(
      'gh',
      ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      }
    ).trim();
  } catch {
    throw new Error('Could not determine repository. Is gh CLI authenticated?');
  }
}

export function sleepMs(milliseconds: number): void {
  const waitBuffer = new SharedArrayBuffer(4);
  const waitArray = new Int32Array(waitBuffer);
  Atomics.wait(waitArray, 0, 0, milliseconds);
}

export function getGitContext(): string {
  const branch = execSync('git branch --show-current', {
    encoding: 'utf8'
  }).trim();
  const headSha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();

  return JSON.stringify(
    {
      branch,
      head_sha: headSha
    },
    null,
    2
  );
}
