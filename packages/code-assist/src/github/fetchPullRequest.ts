import type { Octokit } from "@octokit/rest";

export interface PullRequestFile {
  readonly filename: string;
  readonly status: string;
  readonly patch: string | null;
}

interface PullRequestContext {
  readonly headSha: string;
  readonly title: string;
  readonly files: readonly PullRequestFile[];
}

export async function fetchPullRequest(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<PullRequestContext> {
  const { data: pull } = await octokit.pulls.get({
    owner,
    repo,
    pull_number: pullNumber,
  });
  const files = await octokit.paginate(octokit.pulls.listFiles, {
    owner,
    repo,
    pull_number: pullNumber,
    per_page: 100,
  });
  return {
    headSha: pull.head.sha,
    title: pull.title,
    files: files.map((file) => ({
      filename: file.filename,
      status: file.status,
      patch: file.patch ?? null,
    })),
  };
}
