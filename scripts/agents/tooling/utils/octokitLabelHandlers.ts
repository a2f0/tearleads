import { execSync } from 'node:child_process';
import path from 'node:path';
import type { GlobalOptions } from '../types.ts';
import type { GitHubClientContext } from './githubClient.ts';
import { requireDefined, resolveCurrentBranchName } from './helpers.ts';

function getLabelNames(labels: Array<{ name?: string | undefined }>): string[] {
  return labels
    .map((l) => l.name)
    .filter((n): n is string => typeof n === 'string');
}

export async function addLabelWithOctokit(
  context: GitHubClientContext,
  options: GlobalOptions
): Promise<string> {
  const type = requireDefined(options.type, '--type') as 'pr' | 'issue';
  const number = requireDefined(options.number, '--number');
  const label = requireDefined(options.label, '--label');

  if (type !== 'pr' && type !== 'issue') {
    throw new Error("--type must be 'pr' or 'issue'");
  }

  const current = await context.octokit.rest.issues.get({
    owner: context.owner,
    repo: context.repo,
    issue_number: number
  });

  const currentLabels = getLabelNames(
    current.data.labels as Array<{ name?: string }>
  );

  if (currentLabels.includes(label)) {
    return JSON.stringify(
      {
        status: 'already_present',
        type,
        number,
        label,
        message: `Label '${label}' already present on ${type} #${number}.`
      },
      null,
      2
    );
  }

  await context.octokit.rest.issues.addLabels({
    owner: context.owner,
    repo: context.repo,
    issue_number: number,
    labels: [label]
  });

  const verify = await context.octokit.rest.issues.get({
    owner: context.owner,
    repo: context.repo,
    issue_number: number
  });

  const verifyLabels = getLabelNames(
    verify.data.labels as Array<{ name?: string }>
  );

  if (!verifyLabels.includes(label)) {
    throw new Error(`Failed to add label '${label}' to ${type} #${number}.`);
  }

  return JSON.stringify(
    {
      status: 'added',
      type,
      number,
      label,
      message: `Added label '${label}' to ${type} #${number}.`
    },
    null,
    2
  );
}

function getRepoRoot(): string {
  return execSync('git rev-parse --show-toplevel', {
    encoding: 'utf8'
  }).trim();
}

function getInstanceName(): string {
  return path.basename(getRepoRoot());
}

async function findPrNumberForCurrentBranch(
  context: GitHubClientContext
): Promise<number> {
  const branch = resolveCurrentBranchName();

  const response = await context.octokit.rest.pulls.list({
    owner: context.owner,
    repo: context.repo,
    state: 'open',
    head: `${context.owner}:${branch}`,
    per_page: 1
  });

  const first = response.data[0];
  if (!first) {
    throw new Error('No PR found for current branch. Use --pr to specify.');
  }
  return first.number;
}

export async function tagPrWithTuxedoInstanceWithOctokit(
  context: GitHubClientContext,
  options: GlobalOptions
): Promise<string> {
  const prNumber = options.pr ?? (await findPrNumberForCurrentBranch(context));
  const instanceName = getInstanceName();
  const newLabel = `tuxedo:${instanceName}`;

  const current = await context.octokit.rest.issues.get({
    owner: context.owner,
    repo: context.repo,
    issue_number: prNumber
  });

  const currentLabels = getLabelNames(
    current.data.labels as Array<{ name?: string }>
  );
  const oldTuxedoLabels = currentLabels.filter((l) => l.startsWith('tuxedo:'));

  if (oldTuxedoLabels.length === 1 && oldTuxedoLabels[0] === newLabel) {
    return JSON.stringify(
      {
        status: 'already_tagged',
        pr: prNumber,
        label: newLabel,
        message: `Label '${newLabel}' is already the only tuxedo label on PR #${prNumber}.`
      },
      null,
      2
    );
  }

  for (const oldLabel of oldTuxedoLabels) {
    try {
      await context.octokit.rest.issues.removeLabel({
        owner: context.owner,
        repo: context.repo,
        issue_number: prNumber,
        name: oldLabel
      });
    } catch {
      // Label may already be removed
    }
  }

  try {
    await context.octokit.rest.issues.getLabel({
      owner: context.owner,
      repo: context.repo,
      name: newLabel
    });
  } catch {
    await context.octokit.rest.issues.createLabel({
      owner: context.owner,
      repo: context.repo,
      name: newLabel,
      description: `Tuxedo instance: ${instanceName}`,
      color: '1D76DB'
    });
  }

  await context.octokit.rest.issues.addLabels({
    owner: context.owner,
    repo: context.repo,
    issue_number: prNumber,
    labels: [newLabel]
  });

  const verify = await context.octokit.rest.issues.get({
    owner: context.owner,
    repo: context.repo,
    issue_number: prNumber
  });

  const verifyLabels = getLabelNames(
    verify.data.labels as Array<{ name?: string }>
  );

  if (!verifyLabels.includes(newLabel)) {
    throw new Error(`Failed to add label '${newLabel}' to PR #${prNumber}.`);
  }

  return JSON.stringify(
    {
      status: 'tagged',
      pr: prNumber,
      label: newLabel,
      removed: oldTuxedoLabels.filter((l) => l !== newLabel),
      message: `Tagged PR #${prNumber} with '${newLabel}'.`
    },
    null,
    2
  );
}
