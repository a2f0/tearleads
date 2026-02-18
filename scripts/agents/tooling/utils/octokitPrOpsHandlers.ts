import { execSync } from 'node:child_process';
import type { RestEndpointMethodTypes } from '@octokit/rest';
import type { GlobalOptions } from '../types.ts';
import type { GitHubClientContext } from './githubClient.ts';

type PullItem = RestEndpointMethodTypes['pulls']['get']['response']['data'];

function resolveBranchName(branch: string | undefined): string {
  if (branch) return branch;
  return execSync('git branch --show-current', { encoding: 'utf8' }).trim();
}

function toMergeStateStatus(value: string | null | undefined): string {
  if (!value) return 'UNKNOWN';
  return value.toUpperCase();
}

function toPrState(pull: PullItem): string {
  if (pull.merged_at) return 'MERGED';
  return pull.state.toUpperCase();
}

async function findPullByBranch(
  context: GitHubClientContext,
  branch: string
): Promise<PullItem | null> {
  const response = await context.octokit.rest.pulls.list({
    owner: context.owner,
    repo: context.repo,
    state: 'all',
    head: `${context.owner}:${branch}`,
    per_page: 30
  });
  const [first] = response.data;
  if (!first) return null;
  const full = await context.octokit.rest.pulls.get({
    owner: context.owner,
    repo: context.repo,
    pull_number: first.number
  });
  return full.data;
}

export async function enableAutoMergeWithOctokit(
  context: GitHubClientContext,
  prNumber: number
): Promise<string> {
  const pull = await context.octokit.rest.pulls.get({
    owner: context.owner,
    repo: context.repo,
    pull_number: prNumber
  });

  await context.octokit.graphql(
    `
      mutation($pullRequestId: ID!) {
        enablePullRequestAutoMerge(input: {pullRequestId: $pullRequestId, mergeMethod: MERGE}) {
          pullRequest {
            number
          }
        }
      }
    `,
    {
      pullRequestId: pull.data.node_id
    }
  );

  return JSON.stringify({
    status: 'auto_merge_enabled',
    pr: prNumber
  });
}

export async function findPrForBranchWithOctokit(
  context: GitHubClientContext,
  branch: string,
  state: 'open' | 'merged' | 'closed' | 'all'
): Promise<string> {
  const response = await context.octokit.rest.pulls.list({
    owner: context.owner,
    repo: context.repo,
    head: `${context.owner}:${branch}`,
    state: state === 'merged' ? 'closed' : state,
    per_page: 30
  });

  const match = response.data.find((pull) => {
    if (state === 'merged') {
      return pull.merged_at !== null;
    }
    if (state === 'closed') {
      return pull.merged_at === null;
    }
    return true;
  });

  if (!match) {
    return JSON.stringify({ error: 'No PR found' });
  }

  return JSON.stringify(
    {
      number: match.number,
      title: match.title,
      state: match.merged_at ? 'MERGED' : match.state.toUpperCase(),
      url: match.html_url
    },
    null,
    2
  );
}

export async function listHighPriorityPrsWithOctokit(
  context: GitHubClientContext
): Promise<string> {
  const search = await context.octokit.rest.search.issuesAndPullRequests({
    q: `repo:${context.owner}/${context.repo} is:pr is:open label:"high-priority" draft:false`,
    per_page: 100
  });

  const results: Array<{
    number: number;
    title: string;
    mergeStateStatus: string;
  }> = [];

  for (const item of search.data.items) {
    if (!Object.hasOwn(item, 'pull_request')) {
      continue;
    }
    const pull = await context.octokit.rest.pulls.get({
      owner: context.owner,
      repo: context.repo,
      pull_number: item.number
    });
    results.push({
      number: pull.data.number,
      title: pull.data.title,
      mergeStateStatus: toMergeStateStatus(pull.data.mergeable_state)
    });
  }

  return JSON.stringify(results, null, 2);
}

export async function generatePrSummaryWithOctokit(
  context: GitHubClientContext,
  options: GlobalOptions
): Promise<string> {
  const branchName = resolveBranchName(options.branch);
  let prNumber = options.number;

  if (prNumber === undefined) {
    const pull = await findPullByBranch(context, branchName);
    if (!pull) {
      throw new Error(
        `generatePrSummary could not find a PR for branch ${branchName}`
      );
    }
    prNumber = pull.number;
  }

  const pull = await context.octokit.rest.pulls.get({
    owner: context.owner,
    repo: context.repo,
    pull_number: prNumber
  });

  const files: Array<{ path: string }> = [];
  for await (const page of context.octokit.paginate.iterator(
    context.octokit.rest.pulls.listFiles,
    {
      owner: context.owner,
      repo: context.repo,
      pull_number: prNumber,
      per_page: 100
    }
  )) {
    for (const file of page.data) {
      files.push({ path: file.filename });
    }
  }

  const summaryLines: string[] = [
    `PR #${pull.data.number}: ${pull.data.title ?? '<no title>'}`,
    `State: ${toPrState(pull.data)} (${toMergeStateStatus(pull.data.mergeable_state)})`,
    `Base: ${pull.data.base.ref ?? 'unknown'} ← Head: ${pull.data.head.ref ?? 'unknown'}`,
    `Author: ${pull.data.user?.login ?? 'unknown'}`,
    `URL: ${pull.data.html_url ?? 'unknown'}`,
    ''
  ];

  const trimmedBody = pull.data.body?.trim();
  if (trimmedBody) {
    summaryLines.push('Description:');
    summaryLines.push(...trimmedBody.split('\n').slice(0, 3));
  } else {
    summaryLines.push('Description: (none)');
  }

  summaryLines.push('', `Files changed (${files.length}):`);
  if (files.length === 0) {
    summaryLines.push('- (none)');
  } else {
    files.slice(0, 5).forEach((file) => {
      summaryLines.push(`- ${file.path}`);
    });
    if (files.length > 5) {
      summaryLines.push(`- ...and ${files.length - 5} more files`);
    }
  }

  return summaryLines.join('\n');
}
