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
  const configDir =
    process.env['XDG_CONFIG_HOME']?.trim() ?? join(homedir(), '.config');
  const hostsPath = join(configDir, 'gh', 'hosts.yml');

  if (!existsSync(hostsPath)) return null;

  try {
    const content = readFileSync(hostsPath, 'utf8');
    const escapedHost = host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const hostPattern = new RegExp(`^${escapedHost}:`, 'm');
    if (!hostPattern.test(content)) return null;

    const hostStart = content.search(hostPattern);
    const afterHost = content.slice(hostStart);
    const nextHostMatch = afterHost.match(/\n\S/);
    const section = nextHostMatch
      ? afterHost.slice(0, nextHostMatch.index)
      : afterHost;
    const match = section.match(/^\s+oauth_token:\s*(.+)$/m);
    if (!match?.[1]) return null;

    return match[1].trim();
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
