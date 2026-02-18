import type { RestEndpointMethodTypes } from '@octokit/rest';
import type { GitHubClientContext } from './githubClient.ts';

type IssueState = 'open' | 'closed' | 'all';
type ListForRepoItem =
  RestEndpointMethodTypes['issues']['listForRepo']['response']['data'][number];

function resolveIssueState(
  state: 'open' | 'merged' | 'closed' | 'all' | undefined
): IssueState {
  if (state === 'closed' || state === 'all') {
    return state;
  }
  return 'open';
}

function resolveIssueLimit(limit: number | undefined): number {
  if (limit === undefined) return 30;
  if (limit < 1) return 1;
  return limit;
}

function isPullRequestItem(item: ListForRepoItem): boolean {
  return Object.hasOwn(item, 'pull_request');
}

type OctokitIssue =
  RestEndpointMethodTypes['issues']['get']['response']['data'];
type OctokitIssueLabel = OctokitIssue['labels'][number];

function isIssueLabelObject(
  label: OctokitIssueLabel
): label is Exclude<OctokitIssueLabel, string> {
  return typeof label !== 'string';
}

export async function listDeferredFixIssuesWithOctokit(
  context: GitHubClientContext,
  state: 'open' | 'merged' | 'closed' | 'all' | undefined,
  limit: number | undefined
): Promise<string> {
  const targetState = resolveIssueState(state);
  const targetLimit = resolveIssueLimit(limit);
  const collected: RestEndpointMethodTypes['issues']['listForRepo']['response']['data'] =
    [];
  let page = 1;

  while (collected.length < targetLimit) {
    const remaining = targetLimit - collected.length;
    const response = await context.octokit.rest.issues.listForRepo({
      owner: context.owner,
      repo: context.repo,
      labels: 'deferred-fix',
      state: targetState,
      per_page: 100,
      page
    });

    if (response.data.length === 0) break;
    const issuesOnly = response.data.filter((item) => !isPullRequestItem(item));
    collected.push(...issuesOnly);
    if (response.data.length < 100 || remaining <= 0) break;
    page += 1;
  }

  const payload = collected.slice(0, targetLimit).map((issue) => ({
    number: issue.number,
    title: issue.title,
    url: issue.html_url,
    state: issue.state
  }));

  return JSON.stringify(payload, null, 2);
}

export async function getIssueWithOctokit(
  context: GitHubClientContext,
  number: number
): Promise<string> {
  const response = await context.octokit.rest.issues.get({
    owner: context.owner,
    repo: context.repo,
    issue_number: number
  });

  const issue = response.data;
  const labels = issue.labels.filter(isIssueLabelObject).map((label) => ({
    id: label.id,
    name: label.name ?? '',
    description: label.description ?? '',
    color: label.color ?? ''
  }));

  return JSON.stringify(
    {
      number: issue.number,
      title: issue.title,
      body: issue.body ?? '',
      url: issue.html_url,
      state: issue.state,
      labels
    },
    null,
    2
  );
}
