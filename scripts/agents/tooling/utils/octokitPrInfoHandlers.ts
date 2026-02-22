import { execSync } from 'node:child_process';
import type { RestEndpointMethodTypes } from '@octokit/rest';
import type { GitHubClientContext } from './githubClient.ts';
import { sleepMs } from './helpers.ts';

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

function normalizePrData(pull: PullItem): Record<string, unknown> {
  return {
    number: pull.number,
    title: pull.title,
    body: pull.body ?? '',
    state: toPrState(pull),
    mergeStateStatus: toMergeStateStatus(pull.mergeable_state),
    mergeable: pull.mergeable,
    headRefName: pull.head.ref,
    baseRefName: pull.base.ref,
    url: pull.html_url,
    author: {
      login: pull.user?.login ?? ''
    },
    labels: pull.labels.map((label) => ({
      id: label.id,
      name: label.name,
      color: label.color,
      description: label.description ?? ''
    }))
  };
}

function selectFields(
  payload: Record<string, unknown>,
  fields: string | undefined,
  defaultFields: string
): Record<string, unknown> {
  const selected = (fields ?? defaultFields)
    .split(',')
    .map((field) => field.trim())
    .filter((field) => field.length > 0);
  const output: Record<string, unknown> = {};
  for (const field of selected) {
    if (Object.hasOwn(payload, field)) {
      output[field] = payload[field];
    }
  }
  return output;
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

async function listReviewThreadsPage(
  context: GitHubClientContext,
  prNumber: number,
  after: string | null
): Promise<{
  pageInfo: {
    hasNextPage: boolean;
    endCursor: string | null;
  };
  nodes: Array<{
    id: string;
    isResolved: boolean;
    path: string | null;
    line: number | null;
    comments: {
      pageInfo: { hasNextPage: boolean };
      nodes: Array<{
        id: string;
        fullDatabaseId: string | null;
        author: { login: string | null } | null;
        body: string;
      }>;
    };
  }>;
}> {
  const result = await context.octokit.graphql<{
    repository: {
      pullRequest: {
        reviewThreads: {
          pageInfo: {
            hasNextPage: boolean;
            endCursor: string | null;
          };
          nodes: Array<{
            id: string;
            isResolved: boolean;
            path: string | null;
            line: number | null;
            comments: {
              pageInfo: { hasNextPage: boolean };
              nodes: Array<{
                id: string;
                fullDatabaseId: string | null;
                author: { login: string | null } | null;
                body: string;
              }>;
            };
          }>;
        };
      } | null;
    };
  }>(
    `
      query($owner: String!, $repo: String!, $pr: Int!, $after: String) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $pr) {
            reviewThreads(first: 100, after: $after) {
              pageInfo {
                hasNextPage
                endCursor
              }
              nodes {
                id
                isResolved
                path
                line
                comments(first: 100) {
                  pageInfo {
                    hasNextPage
                  }
                  nodes {
                    id
                    fullDatabaseId
                    author { login }
                    body
                  }
                }
              }
            }
          }
        }
      }
    `,
    {
      owner: context.owner,
      repo: context.repo,
      pr: prNumber,
      after
    }
  );

  const threads = result.repository.pullRequest?.reviewThreads;
  if (!threads) {
    throw new Error(`Pull request not found: ${prNumber}`);
  }
  return threads;
}

async function getLatestGeminiReviewTimestamp(
  context: GitHubClientContext,
  prNumber: number
): Promise<string> {
  let latest = '';
  for await (const page of context.octokit.paginate.iterator(
    context.octokit.rest.pulls.listReviews,
    {
      owner: context.owner,
      repo: context.repo,
      pull_number: prNumber,
      per_page: 100
    }
  )) {
    for (const review of page.data) {
      if (review.user?.login !== 'gemini-code-assist') {
        continue;
      }
      const submitted = review.submitted_at ?? '';
      if (submitted > latest) {
        latest = submitted;
      }
    }
  }
  return latest;
}

export async function getPrInfoWithOctokit(
  context: GitHubClientContext,
  fields: string | undefined
): Promise<string> {
  const branch = resolveBranchName(undefined);
  const pull = await findPullByBranch(context, branch);
  if (!pull) {
    throw new Error(`No PR found for branch: ${branch}`);
  }

  const payload = normalizePrData(pull);
  const requestedFields = (fields ?? '')
    .split(',')
    .map((value) => value.trim());

  if (requestedFields.includes('files')) {
    const files: Array<{ path: string }> = [];
    for await (const page of context.octokit.paginate.iterator(
      context.octokit.rest.pulls.listFiles,
      {
        owner: context.owner,
        repo: context.repo,
        pull_number: pull.number,
        per_page: 100
      }
    )) {
      for (const file of page.data) {
        files.push({ path: file.filename });
      }
    }
    payload['files'] = files;
  }

  if (requestedFields.includes('comments')) {
    const comments: Array<{
      id: number;
      url: string;
      body: string;
      author: { login: string };
    }> = [];
    for await (const page of context.octokit.paginate.iterator(
      context.octokit.rest.issues.listComments,
      {
        owner: context.owner,
        repo: context.repo,
        issue_number: pull.number,
        per_page: 100
      }
    )) {
      for (const comment of page.data) {
        comments.push({
          id: comment.id,
          url: comment.html_url,
          body: comment.body ?? '',
          author: { login: comment.user?.login ?? '' }
        });
      }
    }
    payload['comments'] = comments;
  }

  return JSON.stringify(
    selectFields(
      payload,
      fields,
      'number,state,mergeStateStatus,headRefName,baseRefName,url'
    ),
    null,
    2
  );
}

export async function getReviewThreadsWithOctokit(
  context: GitHubClientContext,
  prNumber: number,
  unresolvedOnly: boolean
): Promise<string> {
  const threads: Array<{
    id: string;
    isResolved: boolean;
    path: string | null;
    line: number | null;
    comments: Array<{
      id: string;
      databaseId: string;
      author: { login: string | null } | null;
      body: string;
    }>;
  }> = [];
  let after: string | null = null;

  while (true) {
    const page = await listReviewThreadsPage(context, prNumber, after);
    for (const thread of page.nodes) {
      if (thread.comments.pageInfo.hasNextPage) {
        throw new Error(
          `getReviewThreads found threads with >100 comments; unsupported pagination for thread IDs: ${thread.id}`
        );
      }
      if (unresolvedOnly && thread.isResolved) {
        continue;
      }
      threads.push({
        id: thread.id,
        isResolved: thread.isResolved,
        path: thread.path,
        line: thread.line,
        comments: thread.comments.nodes.flatMap((comment) => {
          if (!comment.fullDatabaseId) {
            return [];
          }
          return [
            {
              id: comment.id,
              // GitHub deprecated GraphQL databaseId in favor of fullDatabaseId.
              // Keep the output key stable for existing automation consumers.
              databaseId: comment.fullDatabaseId,
              author: comment.author,
              body: comment.body
            }
          ];
        })
      });
    }
    if (!page.pageInfo.hasNextPage) {
      break;
    }
    if (!page.pageInfo.endCursor) {
      throw new Error(
        'getReviewThreads pagination indicated next page but missing endCursor'
      );
    }
    after = page.pageInfo.endCursor;
  }

  return JSON.stringify(threads, null, 2);
}

export async function triggerGeminiReviewWithOctokit(
  context: GitHubClientContext,
  prNumber: number,
  pollTimeoutSeconds: number
): Promise<string> {
  const pollIntervalMilliseconds = 15_000;
  const latestBefore = await getLatestGeminiReviewTimestamp(context, prNumber);

  await context.octokit.rest.issues.createComment({
    owner: context.owner,
    repo: context.repo,
    issue_number: prNumber,
    body: '/gemini review'
  });

  const deadline = Date.now() + pollTimeoutSeconds * 1000;
  while (Date.now() < deadline) {
    const latestAfter = await getLatestGeminiReviewTimestamp(context, prNumber);
    if (latestAfter && (!latestBefore || latestAfter > latestBefore)) {
      return JSON.stringify({
        status: 'review_received',
        pr: prNumber,
        submitted_at: latestAfter
      });
    }
    sleepMs(pollIntervalMilliseconds);
  }

  return JSON.stringify({
    status: 'review_requested',
    pr: prNumber,
    timed_out: true,
    poll_timeout_seconds: pollTimeoutSeconds
  });
}
