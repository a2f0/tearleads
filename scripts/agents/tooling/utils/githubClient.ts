import { Octokit } from '@octokit/rest';
import {
  type AuthProvider,
  createDefaultAuthProvider
} from './authProvider.ts';

interface RepoCoordinates {
  owner: string;
  repo: string;
}

function parseRepoCoordinates(repoName: string): RepoCoordinates {
  const [owner, repo] = repoName.split('/');
  if (!owner || !repo) {
    throw new Error(`Invalid repo format: ${repoName}. Expected "owner/repo".`);
  }
  return { owner, repo };
}

export interface GitHubClientContext {
  octokit: Octokit;
  owner: string;
  repo: string;
}

export function createGitHubClientContext(
  repoName: string,
  authProvider: AuthProvider = createDefaultAuthProvider()
): GitHubClientContext {
  const { owner, repo } = parseRepoCoordinates(repoName);
  const token = authProvider.getGitHubToken();
  const baseUrl = process.env['AGENT_TOOL_GITHUB_API_URL']?.trim();

  const octokit = new Octokit({
    auth: token,
    ...(baseUrl ? { baseUrl } : {})
  });

  return { octokit, owner, repo };
}
