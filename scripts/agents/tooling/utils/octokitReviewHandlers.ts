import type { GitHubClientContext } from './githubClient.ts';

const DEFAULT_GEMINI_QUOTA_MESSAGE =
  'You have reached your daily quota limit. Please wait up to 24 hours and I will start processing your requests again!';

function extractBodyValues(values: Array<{ body?: string | null }>): string[] {
  return values
    .map((value) => value.body?.trim() ?? '')
    .filter((value) => value.length > 0);
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
