import { execFileSync } from 'node:child_process';

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

class DefaultAuthProvider implements AuthProvider {
  getGitHubToken(): string {
    const envToken = readTokenFromEnv();
    if (envToken) return envToken;

    const ghToken = readTokenFromGh();
    if (ghToken) return ghToken;

    throw new Error(
      'Missing GitHub token. Set GITHUB_TOKEN/GH_TOKEN or authenticate gh (`gh auth login`).'
    );
  }
}

export function createDefaultAuthProvider(): AuthProvider {
  return new DefaultAuthProvider();
}
