import { execFileSync, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { runWithTimeout } from '../../../tooling/lib/cliShared.ts';
import type { ActionConfig, ActionName, GlobalOptions } from '../types.ts';
import { requireDefined } from './helpers.ts';
import {
  buildIssueTemplate,
  parseExistingIssueCandidate,
  parseFirstJsonObject
} from './issueHelpers.ts';
import {
  handleCheckGeminiQuota,
  handleCheckMainVersionBumpSetup,
  handleGeneratePrSummary,
  handleGetReviewThreads,
  handleTriggerGeminiReview
} from './inlineHandlers.ts';
import {
  handleCreateDeferredFixIssue,
  handleSanitizePrBody,
  handleUpdatePrBody,
  handleVerifyBranchPush
} from './prWorkflowHandlers.ts';

export function runInlineAction(
  action: ActionName,
  options: GlobalOptions,
  repo: string,
  timeoutMs: number
): string {
  const runGh = (args: string[]): string =>
    execFileSync('gh', args, {
      encoding: 'utf8',
      timeout: timeoutMs
    });

  switch (action) {
    case 'getRepo': {
      return repo;
    }

    case 'checkMainVersionBumpSetup': {
      return handleCheckMainVersionBumpSetup(options, repo, runGh);
    }

    case 'getPrInfo': {
      const fields =
        options.fields ??
        'number,state,mergeStateStatus,headRefName,baseRefName,url';
      const branch = execSync('git branch --show-current', {
        encoding: 'utf8'
      }).trim();
      return runGh(['pr', 'view', branch, '--json', fields, '-R', repo]);
    }

    case 'getReviewThreads': {
      return handleGetReviewThreads(options, repo, runGh);
    }

    case 'replyToComment': {
      return runGh([
        'api',
        '-X',
        'POST',
        `repos/${repo}/pulls/${options.number}/comments/${options.commentId}/replies`,
        '-f',
        `body=${options.body}`
      ]);
    }

    case 'replyToGemini': {
      const body = `@gemini-code-assist Fixed in commit ${options.commit}. Please confirm this addresses the issue.`;
      return runGh([
        'api',
        '-X',
        'POST',
        `repos/${repo}/pulls/${options.number}/comments/${options.commentId}/replies`,
        '-f',
        `body=${body}`
      ]);
    }

    case 'resolveThread': {
      const mutation = `
        mutation($threadId: ID!) {
          resolveReviewThread(input: {threadId: $threadId}) {
            thread { isResolved }
          }
        }
      `;
      return runGh([
        'api',
        'graphql',
        '-f',
        `query=${mutation}`,
        '-f',
        `threadId=${options.threadId}`
      ]);
    }

    case 'getCiStatus': {
      if (options.runId) {
        return runGh([
          'run',
          'view',
          options.runId,
          '--json',
          'status,conclusion,jobs',
          '--jq',
          '{status, conclusion, jobs: [.jobs[] | {name, status, conclusion}]}',
          '-R',
          repo
        ]);
      }
      const runIdOutput = runGh([
        'run',
        'list',
        '--commit',
        requireDefined(options.commit, '--commit'),
        '--limit',
        '1',
        '--json',
        'databaseId',
        '--jq',
        '.[0].databaseId',
        '-R',
        repo
      ]).trim();

      if (!runIdOutput || runIdOutput === 'null') {
        throw new Error('No workflow run found for commit');
      }

      return runGh([
        'run',
        'view',
        runIdOutput,
        '--json',
        'status,conclusion,jobs,databaseId',
        '--jq',
        '{run_id: .databaseId, status, conclusion, jobs: [.jobs[] | {name, status, conclusion}]}',
        '-R',
        repo
      ]);
    }

    case 'cancelWorkflow': {
      const runId = requireDefined(options.runId, '--run-id');
      runGh(['run', 'cancel', runId, '-R', repo]);
      return JSON.stringify({ status: 'cancelled', run_id: runId });
    }

    case 'rerunWorkflow': {
      const runId = requireDefined(options.runId, '--run-id');
      runGh(['run', 'rerun', runId, '-R', repo]);
      return JSON.stringify({
        status: 'rerun_triggered',
        run_id: runId
      });
    }

    case 'downloadArtifact': {
      const runId = requireDefined(options.runId, '--run-id');
      const artifact = requireDefined(options.artifact, '--artifact');
      const dest = requireDefined(options.dest, '--dest');
      runGh(['run', 'download', runId, '-n', artifact, '-D', dest, '-R', repo]);
      return JSON.stringify({
        status: 'downloaded',
        run_id: runId,
        artifact,
        dest
      });
    }

    case 'enableAutoMerge': {
      runGh([
        'pr',
        'merge',
        String(options.number),
        '--auto',
        '--merge',
        '-R',
        repo
      ]);
      return JSON.stringify({
        status: 'auto_merge_enabled',
        pr: options.number
      });
    }

    case 'findPrForBranch': {
      const state = options.state ?? 'open';
      return runGh([
        'pr',
        'list',
        '--head',
        requireDefined(options.branch, '--branch'),
        '--state',
        state,
        '--json',
        'number,title,state,url',
        '-R',
        repo,
        '--jq',
        '.[0] // {"error": "No PR found"}'
      ]);
    }

    case 'listHighPriorityPrs': {
      const prsOutput = runGh([
        'pr',
        'list',
        '--label',
        'high-priority',
        '--state',
        'open',
        '--search',
        '-is:draft',
        '--json',
        'number',
        '-R',
        repo,
        '--jq',
        '.[].number'
      ]).trim();

      if (!prsOutput) return '[]';

      const prNumbers = prsOutput.split('\n').filter(Boolean);
      const results: string[] = [];

      for (const prNum of prNumbers) {
        const prData = runGh([
          'pr',
          'view',
          prNum,
          '--json',
          'number,title,mergeStateStatus',
          '-R',
          repo
        ]).trim();
        results.push(prData);
      }

      return `[${results.join(',')}]`;
    }

    case 'triggerGeminiReview': {
      return handleTriggerGeminiReview(options, repo, runGh);
    }

    case 'checkGeminiQuota': {
      return handleCheckGeminiQuota(options, repo, runGh);
    }

    case 'generatePrSummary': {
      return handleGeneratePrSummary(options, repo, runGh);
    }

    case 'verifyBranchPush': {
      return handleVerifyBranchPush(options);
    }

    case 'sanitizePrBody': {
      return handleSanitizePrBody(options, repo, runGh);
    }

    case 'createDeferredFixIssue': {
      return handleCreateDeferredFixIssue(options, repo, runGh);
    }

    case 'updatePrBody': {
      return handleUpdatePrBody(options, repo, runGh);
    }

    case 'findDeferredWork': {
      return runGh([
        'api',
        `repos/${repo}/pulls/${options.number}/comments`,
        '--paginate',
        '--jq',
        '.[] | select(.body | test("defer|follow[- ]?up|future PR|later|TODO|FIXME"; "i")) | {id: .id, path: .path, line: .line, body: .body, html_url: .html_url}'
      ]);
    }

    case 'listDeferredFixIssues': {
      return runGh([
        'issue',
        'list',
        '--label',
        'deferred-fix',
        '--state',
        options.state ?? 'open',
        '--limit',
        String(options.limit ?? 30),
        '--json',
        'number,title,url,state',
        '-R',
        repo
      ]);
    }

    case 'getIssue': {
      return runGh([
        'issue',
        'view',
        String(options.number),
        '--json',
        'number,title,body,url,state,labels',
        '-R',
        repo
      ]);
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

      if (!options.force) {
        const defaultQuery =
          templateType === 'deferred-fix' && options.sourcePr !== undefined
            ? `is:open label:deferred-fix "PR #${options.sourcePr}"`
            : `is:open in:title "${title}"`;
        const existingIssue = parseExistingIssueCandidate(
          parseFirstJsonObject(
            runGh([
              'issue',
              'list',
              '--state',
              'open',
              '--search',
              options.search ?? defaultQuery,
              '--json',
              'number,title,url',
              '-R',
              repo,
              '--jq',
              '.[0] // null'
            ])
          )
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
      const args = [
        'issue',
        'create',
        '--title',
        title,
        '--body',
        body,
        '-R',
        repo
      ];
      const labels = new Set<string>();
      if (templateType === 'deferred-fix') {
        labels.add('deferred-fix');
      }
      if (options.label) {
        labels.add(options.label);
      }
      for (const label of labels) {
        args.push('--label', label);
      }

      const issueUrl = runGh(args).trim();
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
