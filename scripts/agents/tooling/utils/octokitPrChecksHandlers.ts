import type { GitHubClientContext } from './githubClient.ts';

interface CheckSummary {
  name: string;
  type: 'check_run' | 'status_context';
  status: string;
  conclusion: string | null;
  details_url: string;
}

async function listCheckRunsForSha(
  context: GitHubClientContext,
  sha: string
): Promise<CheckSummary[]> {
  const checks: CheckSummary[] = [];
  let page = 1;
  while (true) {
    const response = await context.octokit.rest.checks.listForRef({
      owner: context.owner,
      repo: context.repo,
      ref: sha,
      per_page: 100,
      page
    });
    for (const run of response.data.check_runs) {
      checks.push({
        name: run.name,
        type: 'check_run',
        status: run.status ?? 'unknown',
        conclusion: run.conclusion,
        details_url: run.details_url ?? ''
      });
    }
    if (response.data.check_runs.length < 100) {
      break;
    }
    page += 1;
  }
  return checks;
}

async function listStatusContextsForSha(
  context: GitHubClientContext,
  sha: string
): Promise<CheckSummary[]> {
  const response = await context.octokit.rest.repos.getCombinedStatusForRef({
    owner: context.owner,
    repo: context.repo,
    ref: sha
  });
  return response.data.statuses.map((status) => ({
    name: status.context,
    type: 'status_context',
    status: status.state,
    conclusion: status.state === 'success' ? 'success' : status.state,
    details_url: status.target_url ?? ''
  }));
}

export async function getPrChecksWithOctokit(
  context: GitHubClientContext,
  prNumber: number
): Promise<string> {
  const pull = await context.octokit.rest.pulls.get({
    owner: context.owner,
    repo: context.repo,
    pull_number: prNumber
  });
  const sha = pull.data.head.sha;
  const checkRuns = await listCheckRunsForSha(context, sha);
  const statusContexts = await listStatusContextsForSha(context, sha);

  return JSON.stringify(
    {
      pr: prNumber,
      sha,
      total: checkRuns.length + statusContexts.length,
      checks: [...checkRuns, ...statusContexts]
    },
    null,
    2
  );
}

export async function getRequiredChecksStatusWithOctokit(
  context: GitHubClientContext,
  prNumber: number
): Promise<string> {
  const pull = await context.octokit.rest.pulls.get({
    owner: context.owner,
    repo: context.repo,
    pull_number: prNumber
  });
  const sha = pull.data.head.sha;
  const baseRef = pull.data.base.ref;
  const checkRuns = await listCheckRunsForSha(context, sha);
  const statusContexts = await listStatusContextsForSha(context, sha);

  let requiredContexts: string[] = [];
  let requiredSource = 'branch_protection';
  try {
    const protection = await context.octokit.rest.repos.getBranchProtection({
      owner: context.owner,
      repo: context.repo,
      branch: baseRef
    });
    requiredContexts = protection.data.required_status_checks?.contexts ?? [];
  } catch (error: unknown) {
    if (
      typeof error === 'object' &&
      error !== null &&
      Reflect.get(error, 'status') === 404
    ) {
      requiredSource = 'unavailable';
    } else {
      throw error;
    }
  }

  const latestByName = new Map<string, CheckSummary>();
  for (const check of [...checkRuns, ...statusContexts]) {
    if (!latestByName.has(check.name)) {
      latestByName.set(check.name, check);
    }
  }

  const required = requiredContexts.map((contextName) => {
    const matched = latestByName.get(contextName);
    return {
      name: contextName,
      status: matched?.status ?? 'missing',
      conclusion: matched?.conclusion ?? null,
      satisfied: matched?.conclusion === 'success'
    };
  });

  const allPassed =
    required.length === 0 || required.every((check) => check.satisfied);

  return JSON.stringify(
    {
      pr: prNumber,
      base_ref: baseRef,
      sha,
      required_source: requiredSource,
      required_check_count: required.length,
      all_passed: allPassed,
      required_checks: required
    },
    null,
    2
  );
}
