import { existsSync } from 'node:fs';
import path from 'node:path';
import { runWithTimeout } from '../../../tooling/lib/cliShared.ts';
import type { ActionConfig, ActionName, GlobalOptions } from '../types.ts';
import { createGitHubClientContext } from './githubClient.ts';
import { requireDefined } from './helpers.ts';
import {
  buildIssueTemplate
} from './issueHelpers.ts';
import {
  createIssueWithOctokit,
  findExistingIssueWithOctokit,
  getIssueWithOctokit,
  listDeferredFixIssuesWithOctokit
} from './octokitIssueHandlers.ts';
import {
  checkGeminiQuotaWithOctokit,
  findDeferredWorkWithOctokit,
  replyToReviewCommentWithOctokit,
  resolveThreadWithOctokit
} from './octokitReviewHandlers.ts';
import {
  createDeferredFixIssueWithOctokit,
  sanitizePrBodyWithOctokit,
  updatePrBodyWithOctokit
} from './octokitPrBodyHandlers.ts';
import {
  enableAutoMergeWithOctokit,
  findPrForBranchWithOctokit,
  generatePrSummaryWithOctokit,
  listHighPriorityPrsWithOctokit
} from './octokitPrOpsHandlers.ts';
import {
  getPrInfoWithOctokit,
  getReviewThreadsWithOctokit,
  triggerGeminiReviewWithOctokit
} from './octokitPrInfoHandlers.ts';
import { checkMainVersionBumpSetupWithOctokit } from './octokitRepoHandlers.ts';
import {
  cancelWorkflowWithOctokit,
  downloadArtifactWithOctokit,
  getCiStatusWithOctokit,
  rerunWorkflowWithOctokit
} from './octokitWorkflowHandlers.ts';
import {
  handleVerifyBranchPush
} from './prWorkflowHandlers.ts';

export async function runInlineAction(
  action: ActionName,
  options: GlobalOptions,
  repo: string,
  timeoutMs: number
): Promise<string> {
  void timeoutMs;

  switch (action) {
    case 'getRepo': {
      return repo;
    }

    case 'checkMainVersionBumpSetup': {
      const context = createGitHubClientContext(repo);
      return checkMainVersionBumpSetupWithOctokit(context, options);
    }

    case 'getPrInfo': {
      const context = createGitHubClientContext(repo);
      return getPrInfoWithOctokit(context, options.fields);
    }

    case 'getReviewThreads': {
      if (options.number === undefined) {
        throw new Error('getReviewThreads requires --number');
      }
      const context = createGitHubClientContext(repo);
      return getReviewThreadsWithOctokit(
        context,
        options.number,
        options.unresolvedOnly ?? false
      );
    }

    case 'replyToComment': {
      if (options.number === undefined) {
        throw new Error('replyToComment requires --number');
      }
      const commentId = Number(options.commentId);
      if (!Number.isInteger(commentId) || commentId < 1) {
        throw new Error('replyToComment requires numeric --comment-id');
      }
      const context = createGitHubClientContext(repo);
      return replyToReviewCommentWithOctokit(
        context,
        options.number,
        commentId,
        requireDefined(options.body, '--body')
      );
    }

    case 'replyToGemini': {
      if (options.number === undefined) {
        throw new Error('replyToGemini requires --number');
      }
      const commentId = Number(options.commentId);
      if (!Number.isInteger(commentId) || commentId < 1) {
        throw new Error('replyToGemini requires numeric --comment-id');
      }
      const body = `@gemini-code-assist Fixed in commit ${options.commit}. Please confirm this addresses the issue.`;
      const context = createGitHubClientContext(repo);
      return replyToReviewCommentWithOctokit(
        context,
        options.number,
        commentId,
        body
      );
    }

    case 'resolveThread': {
      const context = createGitHubClientContext(repo);
      return resolveThreadWithOctokit(
        context,
        requireDefined(options.threadId, '--thread-id')
      );
    }

    case 'getCiStatus': {
      const context = createGitHubClientContext(repo);
      return getCiStatusWithOctokit(context, options.runId, options.commit);
    }

    case 'cancelWorkflow': {
      const runId = requireDefined(options.runId, '--run-id');
      const context = createGitHubClientContext(repo);
      return cancelWorkflowWithOctokit(context, runId);
    }

    case 'rerunWorkflow': {
      const runId = requireDefined(options.runId, '--run-id');
      const context = createGitHubClientContext(repo);
      return rerunWorkflowWithOctokit(context, runId);
    }

    case 'downloadArtifact': {
      const runId = requireDefined(options.runId, '--run-id');
      const artifact = requireDefined(options.artifact, '--artifact');
      const dest = requireDefined(options.dest, '--dest');
      const context = createGitHubClientContext(repo);
      return downloadArtifactWithOctokit(context, runId, artifact, dest);
    }

    case 'enableAutoMerge': {
      const number = requireDefined(options.number, '--number');
      const context = createGitHubClientContext(repo);
      return enableAutoMergeWithOctokit(context, number);
    }

    case 'findPrForBranch': {
      const state = options.state ?? 'open';
      const context = createGitHubClientContext(repo);
      return findPrForBranchWithOctokit(
        context,
        requireDefined(options.branch, '--branch'),
        state
      );
    }

    case 'listHighPriorityPrs': {
      const context = createGitHubClientContext(repo);
      return listHighPriorityPrsWithOctokit(context);
    }

    case 'triggerGeminiReview': {
      if (options.number === undefined) {
        throw new Error('triggerGeminiReview requires --number');
      }
      const context = createGitHubClientContext(repo);
      return triggerGeminiReviewWithOctokit(
        context,
        options.number,
        options.pollTimeout ?? 300
      );
    }

    case 'checkGeminiQuota': {
      if (options.number === undefined) {
        throw new Error('checkGeminiQuota requires --number');
      }
      const context = createGitHubClientContext(repo);
      return checkGeminiQuotaWithOctokit(
        context,
        options.number,
        options.quotaMessage
      );
    }

    case 'generatePrSummary': {
      const context = createGitHubClientContext(repo);
      return generatePrSummaryWithOctokit(context, options);
    }

    case 'verifyBranchPush': {
      return handleVerifyBranchPush(options);
    }

    case 'sanitizePrBody': {
      if (options.number === undefined) {
        throw new Error('sanitizePrBody requires --number');
      }
      const context = createGitHubClientContext(repo);
      return sanitizePrBodyWithOctokit(context, options.number);
    }

    case 'createDeferredFixIssue': {
      const context = createGitHubClientContext(repo);
      return createDeferredFixIssueWithOctokit(context, options);
    }

    case 'updatePrBody': {
      const context = createGitHubClientContext(repo);
      return updatePrBodyWithOctokit(context, options);
    }

    case 'findDeferredWork': {
      if (options.number === undefined) {
        throw new Error('findDeferredWork requires --number');
      }
      const context = createGitHubClientContext(repo);
      return findDeferredWorkWithOctokit(context, options.number);
    }

    case 'listDeferredFixIssues': {
      const context = createGitHubClientContext(repo);
      return listDeferredFixIssuesWithOctokit(
        context,
        options.state,
        options.limit
      );
    }

    case 'getIssue': {
      if (options.number === undefined) {
        throw new Error('getIssue requires --number');
      }
      const context = createGitHubClientContext(repo);
      return getIssueWithOctokit(context, options.number);
    }

    case 'issueTemplate': {
      const templateType = requireDefined(options.type, '--type');
      if (templateType === 'user-requested') {
        return buildIssueTemplate(templateType, options);
      }
      if (templateType === 'deferred-fix') {
        return buildIssueTemplate(templateType, options);
      }
      throw new Error(`Unknown issue template type: ${templateType}`);
    }

    case 'createIssue': {
      const templateType = requireDefined(options.type, '--type');
      if (
        templateType !== 'user-requested' &&
        templateType !== 'deferred-fix'
      ) {
        throw new Error(`Unknown issue template type: ${templateType}`);
      }

      const title = requireDefined(options.title, '--title');
      const context = createGitHubClientContext(repo);

      if (!options.force) {
        const defaultQuery =
          templateType === 'deferred-fix' && options.sourcePr !== undefined
            ? `is:open label:deferred-fix "PR #${options.sourcePr}"`
            : `is:open in:title "${title}"`;
        const existingIssue = await findExistingIssueWithOctokit(
          context,
          options.search ?? defaultQuery
        );

        if (existingIssue) {
          return JSON.stringify(
            {
              status: 'existing',
              issue: existingIssue,
              dedupe_query: options.search ?? defaultQuery
            },
            null,
            2
          );
        }
      }

      const body = buildIssueTemplate(templateType, options);
      const labels = new Set<string>();
      if (templateType === 'deferred-fix') {
        labels.add('deferred-fix');
      }
      if (options.label) {
        labels.add(options.label);
      }
      const issueUrl = await createIssueWithOctokit(context, {
        title,
        body,
        labels: [...labels]
      });
      return JSON.stringify(
        {
          status: 'created',
          issue_url: issueUrl,
          template_type: templateType
        },
        null,
        2
      );
    }

    default:
      throw new Error(`Unknown inline action: ${action}`);
  }
}

export function runDelegatedAction(
  action: ActionName,
  options: GlobalOptions,
  config: ActionConfig,
  repoRoot: string,
  timeoutMs: number,
  agentsDir: string
): { stdout: string; stderr: string; exitCode: number } {
  if (!config.scriptPath) {
    throw new Error(`No script path for action: ${action}`);
  }

  const scriptPath = config.scriptPath(repoRoot, agentsDir);

  if (!existsSync(scriptPath)) {
    throw new Error(`Script not found: ${scriptPath}`);
  }

  const args: string[] = [];

  if (action === 'setVscodeTitle' && options.title) {
    args.push('--title', options.title);
  } else if (action === 'syncToolchainVersions') {
    if (options.apply) {
      args.push('--apply');
    } else {
      args.push('--check');
    }
    if (options.skipNode) {
      args.push('--skip-node');
    }
    if (options.skipAndroid) {
      args.push('--skip-android');
    }
    if (options.maxAndroidJump !== undefined) {
      args.push('--max-android-jump', String(options.maxAndroidJump));
    }
  } else if (action === 'addLabel') {
    args.push('--type', requireDefined(options.type, '--type'));
    args.push('--number', String(options.number));
    args.push('--label', requireDefined(options.label, '--label'));
  } else if (action === 'tagPrWithTuxedoInstance' && options.pr) {
    args.push('--pr', String(options.pr));
  } else if (action === 'runPreen') {
    if (options.mode) {
      args.push('--mode', options.mode);
    }
    if (options.dryRun) {
      args.push('--dry-run');
    }
  }

  if (scriptPath.endsWith('.ts')) {
    const scriptsRepoRoot = path.dirname(path.dirname(agentsDir));
    const tsxBin = path.join(scriptsRepoRoot, 'node_modules', '.bin', 'tsx');
    if (existsSync(tsxBin)) {
      return runWithTimeout(tsxBin, [scriptPath, ...args], timeoutMs, repoRoot);
    }
    return runWithTimeout(
      'pnpm',
      ['--dir', scriptsRepoRoot, 'exec', 'tsx', scriptPath, ...args],
      timeoutMs,
      repoRoot
    );
  }

  return runWithTimeout(scriptPath, args, timeoutMs, repoRoot);
}
