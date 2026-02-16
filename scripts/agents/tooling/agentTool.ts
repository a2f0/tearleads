#!/usr/bin/env -S pnpm exec tsx
/**
 * Agent tooling CLI - TypeScript wrapper for agent scripts and GitHub API actions.
 *
 * Usage: tsx scripts/agents/tooling/agentTool.ts <action> [options]
 *
 * Actions are documented in --help output and README.md.
 */
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Command, InvalidArgumentError, Option, program } from 'commander';
import {
  extractKeyLines,
  getRepoRoot,
  parsePositiveInt,
  runWithTimeout
} from '../../tooling/lib/cliShared.ts';

// ============================================================================
// Types
// ============================================================================

type SafetyClass = 'safe_read' | 'safe_write_local' | 'safe_write_remote';

type ActionName =
  | 'refresh'
  | 'syncToolchainVersions'
  | 'setVscodeTitle'
  | 'solicitCodexReview'
  | 'solicitClaudeCodeReview'
  | 'addLabel'
  | 'approveSkippedChecks'
  | 'tagPrWithTuxedoInstance'
  | 'getPrInfo'
  | 'getReviewThreads'
  | 'replyToComment'
  | 'replyToGemini'
  | 'resolveThread'
  | 'getCiStatus'
  | 'cancelWorkflow'
  | 'rerunWorkflow'
  | 'downloadArtifact'
  | 'enableAutoMerge'
  | 'findPrForBranch'
  | 'listHighPriorityPrs'
  | 'triggerGeminiReview'
  | 'findDeferredWork';

interface GlobalOptions {
  apply?: boolean;
  check?: boolean;
  skipNode?: boolean;
  skipAndroid?: boolean;
  maxAndroidJump?: number;
  title?: string;
  type?: 'pr' | 'issue';
  number?: number;
  label?: string;
  fields?: string;
  unresolvedOnly?: boolean;
  commentId?: string;
  body?: string;
  threadId?: string;
  commit?: string;
  runId?: string;
  artifact?: string;
  dest?: string;
  branch?: string;
  state?: 'open' | 'merged';
  pollTimeout?: number;
  timeoutSeconds?: number;
  repoRoot?: string;
  dryRun?: boolean;
  json?: boolean;
  pr?: number;
}

interface ActionConfig {
  safetyClass: SafetyClass;
  retrySafe: boolean;
  isInline: boolean;
  scriptPath?: (repoRoot: string, agentsDir: string) => string;
}

interface JsonOutput {
  status: 'success' | 'failure';
  exit_code: number;
  duration_ms: number;
  action: string;
  repo_root: string;
  safety_class: SafetyClass;
  retry_safe: boolean;
  dry_run: boolean;
  key_lines: string[];
  'window.title'?: string;
}

// ============================================================================
// Constants
// ============================================================================

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const AGENTS_DIR = path.dirname(SCRIPT_DIR);

const ACTION_CONFIG: Record<ActionName, ActionConfig> = {
  refresh: {
    safetyClass: 'safe_write_local',
    retrySafe: false,
    isInline: false,
    scriptPath: (_repo, agents) => path.join(agents, 'refresh.sh')
  },
  // Manual-only wrapper used for explicit toolchain maintenance runs.
  syncToolchainVersions: {
    safetyClass: 'safe_write_local',
    retrySafe: true,
    isInline: false,
    scriptPath: (repo) => path.join(repo, 'scripts', 'syncToolchainVersions.sh')
  },
  setVscodeTitle: {
    safetyClass: 'safe_write_local',
    retrySafe: true,
    isInline: false,
    scriptPath: (_repo, agents) => path.join(agents, 'setVscodeTitle.sh')
  },
  solicitCodexReview: {
    safetyClass: 'safe_read',
    retrySafe: true,
    isInline: false,
    scriptPath: (repo) => path.join(repo, 'scripts', 'solicitCodexReview.sh')
  },
  solicitClaudeCodeReview: {
    safetyClass: 'safe_read',
    retrySafe: true,
    isInline: false,
    scriptPath: (repo) =>
      path.join(repo, 'scripts', 'solicitClaudeCodeReview.sh')
  },
  addLabel: {
    safetyClass: 'safe_write_remote',
    retrySafe: true,
    isInline: false,
    scriptPath: (_repo, agents) => path.join(agents, 'addLabel.sh')
  },
  // Manual-only wrapper used when checks are intentionally skipped by CI routing.
  approveSkippedChecks: {
    safetyClass: 'safe_write_remote',
    retrySafe: true,
    isInline: false,
    scriptPath: (repo) => path.join(repo, 'scripts', 'approveSkippedChecks.sh')
  },
  tagPrWithTuxedoInstance: {
    safetyClass: 'safe_write_remote',
    retrySafe: true,
    isInline: false,
    scriptPath: (_repo, agents) =>
      path.join(agents, 'tagPrWithTuxedoInstance.sh')
  },
  getPrInfo: { safetyClass: 'safe_read', retrySafe: true, isInline: true },
  getReviewThreads: {
    safetyClass: 'safe_read',
    retrySafe: true,
    isInline: true
  },
  replyToComment: {
    safetyClass: 'safe_write_remote',
    retrySafe: true,
    isInline: true
  },
  replyToGemini: {
    safetyClass: 'safe_write_remote',
    retrySafe: true,
    isInline: true
  },
  resolveThread: {
    safetyClass: 'safe_write_remote',
    retrySafe: true,
    isInline: true
  },
  getCiStatus: { safetyClass: 'safe_read', retrySafe: true, isInline: true },
  cancelWorkflow: {
    safetyClass: 'safe_write_remote',
    retrySafe: true,
    isInline: true
  },
  rerunWorkflow: {
    safetyClass: 'safe_write_remote',
    retrySafe: true,
    isInline: true
  },
  downloadArtifact: {
    safetyClass: 'safe_write_local',
    retrySafe: true,
    isInline: true
  },
  enableAutoMerge: {
    safetyClass: 'safe_write_remote',
    retrySafe: true,
    isInline: true
  },
  findPrForBranch: {
    safetyClass: 'safe_read',
    retrySafe: true,
    isInline: true
  },
  listHighPriorityPrs: {
    safetyClass: 'safe_read',
    retrySafe: true,
    isInline: true
  },
  triggerGeminiReview: {
    safetyClass: 'safe_write_remote',
    retrySafe: true,
    isInline: true
  },
  findDeferredWork: {
    safetyClass: 'safe_read',
    retrySafe: true,
    isInline: true
  }
};

// ============================================================================
// Validation
// ============================================================================

function isShaLike(value: string): boolean {
  if (!/^[0-9a-fA-F]+$/.test(value)) return false;
  return value.length >= 7 && value.length <= 40;
}

function requireDefined<T>(value: T | undefined, name: string): T {
  if (value === undefined) {
    throw new Error(`Missing required option: ${name}`);
  }
  return value;
}
// ============================================================================
// Helpers
// ============================================================================

function getRepo(): string {
  try {
    return execFileSync(
      'gh',
      ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      }
    ).trim();
  } catch {
    throw new Error('Could not determine repository. Is gh CLI authenticated?');
  }
}

function sleepMs(milliseconds: number): void {
  const waitBuffer = new SharedArrayBuffer(4);
  const waitArray = new Int32Array(waitBuffer);
  Atomics.wait(waitArray, 0, 0, milliseconds);
}

// ============================================================================
// Inline GitHub API Actions
// ============================================================================

function runInlineAction(
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
    case 'getPrInfo': {
      const fields =
        options.fields ??
        'number,state,mergeStateStatus,headRefName,baseRefName,url';
      // When using -R, gh pr view needs an explicit branch/PR reference
      const branch = execSync('git branch --show-current', {
        encoding: 'utf8'
      }).trim();
      return runGh(['pr', 'view', branch, '--json', fields, '-R', repo]);
    }

    case 'getReviewThreads': {
      if (options.number === undefined) {
        throw new Error('getReviewThreads requires --number');
      }
      const [owner, repoName] = repo.split('/');
      if (!owner || !repoName) {
        throw new Error(`Invalid repository format: ${repo}`);
      }
      const filter = options.unresolvedOnly
        ? 'map(select(.isResolved == false))'
        : '.';
      const query = `
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
                      databaseId
                      author { login }
                      body
                    }
                  }
                }
              }
            }
          }
        }
      `;
      const threadJsonChunks: string[] = [];
      let afterCursor: string | undefined;

      while (true) {
        const queryArgs = [
          'api',
          'graphql',
          '-f',
          `query=${query}`,
          '-f',
          `owner=${owner}`,
          '-f',
          `repo=${repoName}`,
          '-F',
          `pr=${options.number}`
        ];
        if (afterCursor) {
          queryArgs.push('-F', `after=${afterCursor}`);
        }

        const pageHasNext = runGh([
          ...queryArgs,
          '--jq',
          '.data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage'
        ]).trim();
        const pageEndCursor = runGh([
          ...queryArgs,
          '--jq',
          '.data.repository.pullRequest.reviewThreads.pageInfo.endCursor // ""'
        ]).trim();

        const threadIdsWithExtraComments = runGh([
          ...queryArgs,
          '--jq',
          '.data.repository.pullRequest.reviewThreads.nodes[] | select(.comments.pageInfo.hasNextPage == true) | .id'
        ]).trim();
        if (threadIdsWithExtraComments) {
          throw new Error(
            `getReviewThreads found threads with >100 comments; unsupported pagination for thread IDs: ${threadIdsWithExtraComments}`
          );
        }

        const pageThreads = runGh([
          ...queryArgs,
          '--jq',
          `.data.repository.pullRequest.reviewThreads.nodes | ${filter}`
        ]).trim();
        if (pageThreads.startsWith('[') && pageThreads.endsWith(']')) {
          const innerJson = pageThreads.slice(1, -1).trim();
          if (innerJson.length > 0) {
            threadJsonChunks.push(innerJson);
          }
        } else {
          throw new Error('Unexpected getReviewThreads response shape');
        }

        if (pageHasNext !== 'true') {
          break;
        }
        if (!pageEndCursor) {
          throw new Error(
            'getReviewThreads pagination indicated next page but missing endCursor'
          );
        }
        afterCursor = pageEndCursor;
      }

      return `[${threadJsonChunks.join(',')}]`;
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
      // Find run from commit
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
      const pollTimeoutSeconds = options.pollTimeout ?? 300;
      const pollIntervalMilliseconds = 15_000;
      const prNumber = String(options.number);
      const latestGeminiReviewQuery = [
        'pr',
        'view',
        prNumber,
        '--json',
        'reviews',
        '-R',
        repo,
        '--jq',
        '[.reviews[] | select(.author.login == "gemini-code-assist") | .submittedAt] | max // ""'
      ];

      const latestReviewBeforeRequest = runGh(latestGeminiReviewQuery).trim();

      runGh([
        'pr',
        'comment',
        prNumber,
        '-R',
        repo,
        '--body',
        '/gemini review'
      ]);

      const deadline = Date.now() + pollTimeoutSeconds * 1000;
      while (Date.now() < deadline) {
        const latestReviewAfterRequest = runGh(latestGeminiReviewQuery).trim();
        if (
          latestReviewAfterRequest &&
          (!latestReviewBeforeRequest ||
            latestReviewAfterRequest > latestReviewBeforeRequest)
        ) {
          return JSON.stringify({
            status: 'review_received',
            pr: options.number,
            submitted_at: latestReviewAfterRequest
          });
        }
        sleepMs(pollIntervalMilliseconds);
      }

      return JSON.stringify({
        status: 'review_requested',
        pr: options.number,
        timed_out: true,
        poll_timeout_seconds: pollTimeoutSeconds
      });
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

    default:
      throw new Error(`Unknown inline action: ${action}`);
  }
}

// ============================================================================
// Delegated Script Actions
// ============================================================================

function runDelegatedAction(
  action: ActionName,
  options: GlobalOptions,
  repoRoot: string,
  timeoutMs: number
): { stdout: string; stderr: string; exitCode: number } {
  const config = ACTION_CONFIG[action];
  if (!config.scriptPath) {
    throw new Error(`No script path for action: ${action}`);
  }

  const scriptPath = config.scriptPath(repoRoot, AGENTS_DIR);

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
  }

  return runWithTimeout(scriptPath, args, timeoutMs, repoRoot);
}

// ============================================================================
// Main Execution
// ============================================================================

function createActionCommand(actionName: ActionName): Command {
  const cmd = new Command(actionName);
  const config = ACTION_CONFIG[actionName];

  // Common options for all actions
  cmd
    .option('--timeout-seconds <n>', 'Timeout in seconds', (v) =>
      parsePositiveInt(v, '--timeout-seconds')
    )
    .option('--repo-root <path>', 'Execute from this repo root')
    .option('--dry-run', 'Validate and report without executing')
    .option('--json', 'Emit structured JSON summary');

  // Action-specific options
  switch (actionName) {
    case 'syncToolchainVersions':
      cmd
        .option('--apply', 'Write updates to files')
        .option('--check', 'Check only (default)')
        .option('--skip-node', 'Skip Electron -> Node alignment')
        .option('--skip-android', 'Skip Android SDK alignment')
        .option(
          '--max-android-jump <n>',
          'Max Android API bump in one run',
          (v) => parsePositiveInt(v, '--max-android-jump')
        )
        .hook('preAction', (thisCommand) => {
          const opts = thisCommand.opts();
          if (opts.apply && opts.check) {
            console.error('error: choose at most one of --apply or --check');
            process.exit(1);
          }
        });
      break;
    case 'setVscodeTitle':
      cmd.option('--title <value>', 'Title to set');
      break;
    case 'addLabel':
      cmd
        .requiredOption('--type <pr|issue>', 'Target type', (v) => {
          if (v !== 'pr' && v !== 'issue')
            throw new InvalidArgumentError('--type must be "pr" or "issue"');
          return v as 'pr' | 'issue';
        })
        .requiredOption('--number <n>', 'PR or issue number', (v) =>
          parsePositiveInt(v, '--number')
        )
        .requiredOption('--label <name>', 'Label name');
      break;
    case 'tagPrWithTuxedoInstance':
      cmd.option('--pr <n>', 'PR number (auto-detected if omitted)', (v) =>
        parsePositiveInt(v, '--pr')
      );
      break;
    case 'getPrInfo':
      cmd.option('--fields <list>', 'Comma-separated fields');
      break;
    case 'getReviewThreads':
      cmd
        .requiredOption('--number <n>', 'PR number', (v) =>
          parsePositiveInt(v, '--number')
        )
        .option('--unresolved-only', 'Only return unresolved threads');
      break;
    case 'replyToComment':
      cmd
        .requiredOption('--number <n>', 'PR number', (v) =>
          parsePositiveInt(v, '--number')
        )
        .requiredOption('--comment-id <id>', 'Comment database ID')
        .requiredOption('--body <text>', 'Comment body');
      break;
    case 'replyToGemini':
      cmd
        .requiredOption('--number <n>', 'PR number', (v) =>
          parsePositiveInt(v, '--number')
        )
        .requiredOption('--comment-id <id>', 'Comment database ID')
        .requiredOption('--commit <sha>', 'Commit SHA', (v) => {
          if (!isShaLike(v))
            throw new InvalidArgumentError(
              '--commit must be a 7-40 character hexadecimal SHA'
            );
          return v;
        });
      break;
    case 'resolveThread':
      cmd.requiredOption('--thread-id <id>', 'Thread node ID');
      break;
    case 'getCiStatus':
      cmd
        .option('--commit <sha>', 'Commit SHA')
        .option('--run-id <id>', 'Workflow run ID')
        .hook('preAction', (thisCommand) => {
          const opts = thisCommand.opts();
          if (!opts.commit && !opts.runId) {
            console.error('error: getCiStatus requires --commit or --run-id');
            process.exit(1);
          }
        });
      break;
    case 'cancelWorkflow':
    case 'rerunWorkflow':
      cmd.requiredOption('--run-id <id>', 'Workflow run ID');
      break;
    case 'downloadArtifact':
      cmd
        .requiredOption('--run-id <id>', 'Workflow run ID')
        .requiredOption('--artifact <name>', 'Artifact name')
        .requiredOption('--dest <path>', 'Destination path');
      break;
    case 'enableAutoMerge':
      cmd.requiredOption('--number <n>', 'PR number', (v) =>
        parsePositiveInt(v, '--number')
      );
      break;
    case 'triggerGeminiReview':
      cmd
        .requiredOption('--number <n>', 'PR number', (v) =>
          parsePositiveInt(v, '--number')
        )
        .option('--poll-timeout <secs>', 'Polling timeout in seconds', (v) =>
          parsePositiveInt(v, '--poll-timeout')
        );
      break;
    case 'findDeferredWork':
      cmd.requiredOption('--number <n>', 'PR number', (v) =>
        parsePositiveInt(v, '--number')
      );
      break;
    case 'findPrForBranch':
      cmd
        .requiredOption('--branch <name>', 'Branch name')
        .addOption(
          new Option('--state <state>', 'PR state filter')
            .choices(['open', 'merged'])
            .default('open')
        );
      break;
  }

  cmd.action(async (opts: GlobalOptions) => {
    const startMs = Date.now();
    let exitCode = 0;
    let output = '';
    let windowTitle: string | undefined;

    try {
      const repoRoot = getRepoRoot(opts.repoRoot);
      const timeoutMs =
        (opts.timeoutSeconds ?? (actionName === 'refresh' ? 3600 : 300)) * 1000;

      if (opts.dryRun) {
        if (config.isInline) {
          output = `dry-run: would run inline action ${actionName}`;
        } else {
          if (!config.scriptPath) {
            throw new Error(`No script path for action: ${actionName}`);
          }
          const scriptPath = config.scriptPath(repoRoot, AGENTS_DIR);
          output = `dry-run: would run ${scriptPath} from ${repoRoot}`;
        }
      } else if (config.isInline) {
        const repo = getRepo();
        output = runInlineAction(actionName, opts, repo, timeoutMs);
      } else {
        const result = runDelegatedAction(
          actionName,
          opts,
          repoRoot,
          timeoutMs
        );
        output = result.stdout + result.stderr;
        exitCode = result.exitCode;
      }

      // Extract window.title for setVscodeTitle action from settings file
      if (actionName === 'setVscodeTitle' && !opts.dryRun && exitCode === 0) {
        const settingsPath = path.join(repoRoot, '.vscode', 'settings.json');
        if (existsSync(settingsPath)) {
          try {
            const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
            windowTitle = settings['window.title'];
          } catch {
            // Ignore parse errors
          }
        }
      }
    } catch (err) {
      output = err instanceof Error ? err.message : String(err);
      exitCode = 1;
    }

    const durationMs = Date.now() - startMs;
    const status = exitCode === 0 ? 'success' : 'failure';

    if (opts.json) {
      const jsonOutput: JsonOutput = {
        status,
        exit_code: exitCode,
        duration_ms: durationMs,
        action: actionName,
        repo_root: getRepoRoot(opts.repoRoot),
        safety_class: config.safetyClass,
        retry_safe: config.retrySafe,
        dry_run: opts.dryRun ?? false,
        key_lines: extractKeyLines(output)
      };

      if (windowTitle !== undefined) {
        jsonOutput['window.title'] = windowTitle;
      }

      console.log(JSON.stringify(jsonOutput, null, 2));
    } else {
      process.stdout.write(output);
      if (output && !output.endsWith('\n')) {
        process.stdout.write('\n');
      }
    }

    if (exitCode !== 0) {
      process.exit(exitCode);
    }
  });

  return cmd;
}

// ============================================================================
// CLI Setup
// ============================================================================

program
  .name('agentTool.ts')
  .description(
    'Agent tooling CLI for environment setup, GitHub API actions, and script execution'
  )
  .version('1.0.0');

// Register all action commands
for (const actionName of Object.keys(ACTION_CONFIG) as ActionName[]) {
  program.addCommand(createActionCommand(actionName));
}

program.parse();
