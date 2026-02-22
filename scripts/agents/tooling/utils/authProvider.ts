import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface AuthProvider {
  getGitHubToken(): string;
}

function readTokenFromEnv(): string | null {
  const envToken =
    process.env['GITHUB_TOKEN']?.trim() ?? process.env['GH_TOKEN']?.trim();
  if (!envToken) return null;
  return envToken;
}

function readTokenFromGh(): string | null {
  try {
    const host = process.env['GITHUB_HOST']?.trim();
    const args = ['auth', 'token'];
    if (host) {
      args.push('--hostname', host);
    }
    const token = execFileSync('gh', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();

    if (!token) return null;
    return token;
  } catch {
    return null;
  }
}

function readTokenFromGhConfig(): string | null {
  const host = process.env['GITHUB_HOST']?.trim() ?? 'github.com';
  const ghConfigDir = process.env['GH_CONFIG_DIR']?.trim();
  const hostsPath = ghConfigDir
    ? join(ghConfigDir, 'hosts.yml')
    : join(
        process.env['XDG_CONFIG_HOME']?.trim() || join(homedir(), '.config'),
        'gh',
        'hosts.yml'
      );

  if (!existsSync(hostsPath)) return null;

  try {
    const content = readFileSync(hostsPath, 'utf8');
    const lines = content.split(/\r?\n/);
    let inTargetHost = false;

    for (const line of lines) {
      const hostMatch = line.match(/^("?[^":\s]+"?):\s*(?:#.*)?$/);
      if (hostMatch?.[1]) {
        const hostName = hostMatch[1].replace(/^"(.*)"$/, '$1');
        inTargetHost = hostName === host;
        continue;
      }

      if (!inTargetHost) {
        continue;
      }

      const tokenMatch = line.match(
        /^\s+oauth_token:\s*(".*?"|'.*?'|[^#\s]+)/
      );
      if (!tokenMatch?.[1]) {
        continue;
      }

      const rawToken = tokenMatch[1].trim();
      const unquotedToken = rawToken
        .replace(/^"(.*)"$/, '$1')
        .replace(/^'(.*)'$/, '$1');
      if (unquotedToken.length === 0) {
        return null;
      }
      return unquotedToken;
    }

    return null;
  } catch {
    return null;
  }
}

class DefaultAuthProvider implements AuthProvider {
  getGitHubToken(): string {
    const envToken = readTokenFromEnv();
    if (envToken) return envToken;

    const ghToken = readTokenFromGh();
    if (ghToken) return ghToken;

    const configToken = readTokenFromGhConfig();
    if (configToken) return configToken;

    throw new Error(
      'Missing GitHub token. Set GITHUB_TOKEN/GH_TOKEN or authenticate gh (`gh auth login`).'
    );
  }
}

export function createDefaultAuthProvider(): AuthProvider {
  return new DefaultAuthProvider();
}
