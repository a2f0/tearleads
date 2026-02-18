import type { GitHubClientContext } from './githubClient.ts';

const DEFAULT_GEMINI_QUOTA_MESSAGE =
  'You have reached your daily quota limit. Please wait up to 24 hours and I will start processing your requests again!';

function extractBodyValues(values: Array<{ body?: string | null }>): string[] {
  return values
    .map((value) => value.body?.trim() ?? '')
    .filter((value) => value.length > 0);
}

const DEFERRED_WORK_PATTERN =
  /defer|follow[- ]?up|future PR|later|TODO|FIXME/i;

interface DeferredWorkItem {
  id: number;
  path: string;
  line: number | null;
  body: string;
  html_url: string;
}

export async function replyToReviewCommentWithOctokit(
  context: GitHubClientContext,
  prNumber: number,
  commentId: number,
  body: string
): Promise<string> {
  const response = await context.octokit.rest.pulls.createReplyForReviewComment({
    owner: context.owner,
    repo: context.repo,
    pull_number: prNumber,
    comment_id: commentId,
    body
  });

  return JSON.stringify(
    {
      id: response.data.id,
      url: response.data.html_url,
      body: response.data.body ?? ''
    },
    null,
    2
  );
}

export async function resolveThreadWithOctokit(
  context: GitHubClientContext,
  threadId: string
): Promise<string> {
  const result = await context.octokit.graphql(
    `
      mutation($threadId: ID!) {
        resolveReviewThread(input: {threadId: $threadId}) {
          thread { isResolved }
        }
      }
    `,
    {
      threadId
    }
  );

  return JSON.stringify(result, null, 2);
}

export async function findDeferredWorkWithOctokit(
  context: GitHubClientContext,
  prNumber: number
): Promise<string> {
  const matches: DeferredWorkItem[] = [];

  for await (const page of context.octokit.paginate.iterator(
    context.octokit.rest.pulls.listReviewComments,
    {
      owner: context.owner,
      repo: context.repo,
      pull_number: prNumber,
      per_page: 100
    }
  )) {
    for (const comment of page.data) {
      const body = comment.body?.trim() ?? '';
      if (!DEFERRED_WORK_PATTERN.test(body)) {
        continue;
      }
      matches.push({
        id: comment.id,
        path: comment.path,
        line: comment.line ?? null,
        body,
        html_url: comment.html_url
      });
    }
  }

  return JSON.stringify(matches, null, 2);
}

export async function checkGeminiQuotaWithOctokit(
  context: GitHubClientContext,
  prNumber: number,
  quotaMessage: string | undefined
): Promise<string> {
  const targetMessage = quotaMessage ?? DEFAULT_GEMINI_QUOTA_MESSAGE;
  let matchCount = 0;

  const hasQuotaMessage = (messages: string[]): boolean =>
    messages.some((body) => body.includes(targetMessage));

  for await (const page of context.octokit.paginate.iterator(
    context.octokit.rest.pulls.listReviews,
    {
      owner: context.owner,
      repo: context.repo,
      pull_number: prNumber,
      per_page: 100
    }
  )) {
    if (hasQuotaMessage(extractBodyValues(page.data))) {
      matchCount = 1;
      break;
    }
  }

  if (matchCount === 0) {
    for await (const page of context.octokit.paginate.iterator(
      context.octokit.rest.pulls.listReviewComments,
      {
        owner: context.owner,
        repo: context.repo,
        pull_number: prNumber,
        per_page: 100
      }
    )) {
      if (hasQuotaMessage(extractBodyValues(page.data))) {
        matchCount = 1;
        break;
      }
    }
  }

  if (matchCount === 0) {
    for await (const page of context.octokit.paginate.iterator(
      context.octokit.rest.issues.listComments,
      {
        owner: context.owner,
        repo: context.repo,
        issue_number: prNumber,
        per_page: 100
      }
    )) {
      if (hasQuotaMessage(extractBodyValues(page.data))) {
        matchCount = 1;
        break;
      }
    }
  }

  return JSON.stringify(
    {
      status: 'success',
      pr: prNumber,
      quota_exhausted: matchCount > 0,
      match_count: matchCount
    },
    null,
    2
  );
}
