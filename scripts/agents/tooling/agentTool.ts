#!/usr/bin/env -S pnpm exec tsx
/**
 * Agent tooling CLI - TypeScript wrapper for agent scripts and GitHub API actions.
 *
 * Usage: tsx scripts/agents/tooling/agentTool.ts <action> [options]
 *
 * Actions are documented in --help output and README.md.
 */
import { execFileSync, execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { program, Command, Option, InvalidArgumentError } from 'commander';

// ============================================================================
// Types
// ============================================================================

type SafetyClass = 'safe_read' | 'safe_write_local' | 'safe_write_remote';

type ActionName =
  | 'refresh'
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
    scriptPath: (_repo, agents) => path.join(agents, 'refresh.sh'),
  },
  setVscodeTitle: {
    safetyClass: 'safe_write_local',
    retrySafe: true,
    isInline: false,
    scriptPath: (_repo, agents) => path.join(agents, 'setVscodeTitle.sh'),
  },
  solicitCodexReview: {
    safetyClass: 'safe_read',
    retrySafe: true,
    isInline: false,
    scriptPath: (repo) => path.join(repo, 'scripts', 'solicitCodexReview.sh'),
  },
  solicitClaudeCodeReview: {
    safetyClass: 'safe_read',
    retrySafe: true,
    isInline: false,
    scriptPath: (repo) => path.join(repo, 'scripts', 'solicitClaudeCodeReview.sh'),
  },
  addLabel: {
    safetyClass: 'safe_write_remote',
    retrySafe: true,
    isInline: false,
    scriptPath: (_repo, agents) => path.join(agents, 'addLabel.sh'),
  },
  approveSkippedChecks: {
    safetyClass: 'safe_write_remote',
    retrySafe: true,
    isInline: false,
    scriptPath: (repo) => path.join(repo, 'scripts', 'approveSkippedChecks.sh'),
  },
  tagPrWithTuxedoInstance: {
    safetyClass: 'safe_write_remote',
    retrySafe: true,
    isInline: false,
    scriptPath: (_repo, agents) => path.join(agents, 'tagPrWithTuxedoInstance.sh'),
  },
  getPrInfo: { safetyClass: 'safe_read', retrySafe: true, isInline: true },
  getReviewThreads: { safetyClass: 'safe_read', retrySafe: true, isInline: true },
  replyToComment: { safetyClass: 'safe_write_remote', retrySafe: true, isInline: true },
  replyToGemini: { safetyClass: 'safe_write_remote', retrySafe: true, isInline: true },
  resolveThread: { safetyClass: 'safe_write_remote', retrySafe: true, isInline: true },
  getCiStatus: { safetyClass: 'safe_read', retrySafe: true, isInline: true },
  cancelWorkflow: { safetyClass: 'safe_write_remote', retrySafe: true, isInline: true },
  rerunWorkflow: { safetyClass: 'safe_write_remote', retrySafe: true, isInline: true },
  downloadArtifact: { safetyClass: 'safe_write_local', retrySafe: true, isInline: true },
  enableAutoMerge: { safetyClass: 'safe_write_remote', retrySafe: true, isInline: true },
  findPrForBranch: { safetyClass: 'safe_read', retrySafe: true, isInline: true },
  listHighPriorityPrs: { safetyClass: 'safe_read', retrySafe: true, isInline: true },
  triggerGeminiReview: { safetyClass: 'safe_write_remote', retrySafe: true, isInline: true },
  findDeferredWork: { safetyClass: 'safe_read', retrySafe: true, isInline: true },
};

// ============================================================================
// Validation
// ============================================================================

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isShaLike(value: string): boolean {
  if (!/^[0-9a-fA-F]+$/.test(value)) return false;
  return value.length >= 7 && value.length <= 40;
}

function parsePositiveInt(value: string, name: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!isPositiveInt(parsed)) {
    throw new InvalidArgumentError(`${name} must be a positive integer`);
  }
  return parsed;
}

// ============================================================================
// Helpers
// ============================================================================

function getRepoRoot(providedRoot?: string): string {
  if (providedRoot) return providedRoot;

  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    throw new Error('Could not detect git repository root. Use --repo-root.');
  }
}

function getRepo(): string {
  try {
    return execFileSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    throw new Error('Could not determine repository. Is gh CLI authenticated?');
  }
}

function runWithTimeout(
  command: string,
  args: string[],
  timeoutMs: number,
  cwd?: string
): { stdout: string; stderr: string; exitCode: number } {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: timeoutMs,
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exitCode: result.status ?? (result.signal ? 1 : 0),
  };
}

function extractKeyLines(output: string, count = 5): string[] {
  return output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .slice(-count);
}

// ============================================================================
// Inline GitHub API Actions
// ============================================================================

function runInlineAction(action: ActionName, options: GlobalOptions, repo: string): string {
  switch (action) {
    case 'getPrInfo': {
      const fields = options.fields ?? 'number,state,mergeStateStatus,headRefName,baseRefName,url';
      return execFileSync('gh', ['pr', 'view', '--json', fields, '-R', repo], {
        encoding: 'utf8',
      });
    }

    case 'getReviewThreads': {
      const [owner, repoName] = repo.split('/');
      const filter = options.unresolvedOnly ? 'select(.isResolved == false)' : '.';
      const query = `
        query($owner: String!, $repo: String!, $pr: Int!) {
          repository(owner: $owner, name: $repo) {
            pullRequest(number: $pr) {
              reviewThreads(first: 100) {
                nodes {
                  id
                  isResolved
                  path
                  line
                  comments(first: 20) {
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
      return execFileSync(
        'gh',
        [
          'api',
          'graphql',
          '-f',
          `query=${query}`,
          '-f',
          `owner=${owner}`,
          '-f',
          `repo=${repoName}`,
          '-F',
          `pr=${options.number}`,
          '--jq',
          `.data.repository.pullRequest.reviewThreads.nodes[] | ${filter}`,
        ],
        { encoding: 'utf8' }
      );
    }

    case 'replyToComment': {
      return execFileSync(
        'gh',
        [
          'api',
          '-X',
          'POST',
          `repos/${repo}/pulls/${options.number}/comments/${options.commentId}/replies`,
          '-f',
          `body=${options.body}`,
        ],
        { encoding: 'utf8' }
      );
    }

    case 'replyToGemini': {
      const body = `@gemini-code-assist Fixed in commit ${options.commit}. Please confirm this addresses the issue.`;
      return execFileSync(
        'gh',
        [
          'api',
          '-X',
          'POST',
          `repos/${repo}/pulls/${options.number}/comments/${options.commentId}/replies`,
          '-f',
          `body=${body}`,
        ],
        { encoding: 'utf8' }
      );
    }

    case 'resolveThread': {
      const mutation = `
        mutation($threadId: ID!) {
          resolveReviewThread(input: {threadId: $threadId}) {
            thread { isResolved }
          }
        }
      `;
      return execFileSync(
        'gh',
        ['api', 'graphql', '-f', `query=${mutation}`, '-f', `threadId=${options.threadId}`],
        { encoding: 'utf8' }
      );
    }

    case 'getCiStatus': {
      if (options.runId) {
        return execFileSync(
          'gh',
          [
            'run',
            'view',
            options.runId,
            '--json',
            'status,conclusion,jobs',
            '--jq',
            '{status, conclusion, jobs: [.jobs[] | {name, status, conclusion}]}',
            '-R',
            repo,
          ],
          { encoding: 'utf8' }
        );
      }
      // Find run from commit
      const runIdOutput = execFileSync(
        'gh',
        [
          'run',
          'list',
          '--commit',
          options.commit!,
          '--limit',
          '1',
          '--json',
          'databaseId',
          '--jq',
          '.[0].databaseId',
          '-R',
          repo,
        ],
        { encoding: 'utf8' }
      ).trim();

      if (!runIdOutput || runIdOutput === 'null') {
        return JSON.stringify({ error: 'No workflow run found for commit' });
      }

      return execFileSync(
        'gh',
        [
          'run',
          'view',
          runIdOutput,
          '--json',
          'status,conclusion,jobs,databaseId',
          '--jq',
          '{run_id: .databaseId, status, conclusion, jobs: [.jobs[] | {name, status, conclusion}]}',
          '-R',
          repo,
        ],
        { encoding: 'utf8' }
      );
    }

    case 'cancelWorkflow': {
      execFileSync('gh', ['run', 'cancel', options.runId!, '-R', repo], { encoding: 'utf8' });
      return JSON.stringify({ status: 'cancelled', run_id: options.runId });
    }

    case 'rerunWorkflow': {
      execFileSync('gh', ['run', 'rerun', options.runId!, '-R', repo], { encoding: 'utf8' });
      return JSON.stringify({ status: 'rerun_triggered', run_id: options.runId });
    }

    case 'downloadArtifact': {
      execFileSync(
        'gh',
        ['run', 'download', options.runId!, '-n', options.artifact!, '-D', options.dest!, '-R', repo],
        { encoding: 'utf8' }
      );
      return JSON.stringify({
        status: 'downloaded',
        run_id: options.runId,
        artifact: options.artifact,
        dest: options.dest,
      });
    }

    case 'enableAutoMerge': {
      execFileSync('gh', ['pr', 'merge', String(options.number), '--auto', '--merge', '-R', repo], {
        encoding: 'utf8',
      });
      return JSON.stringify({ status: 'auto_merge_enabled', pr: options.number });
    }

    case 'findPrForBranch': {
      const state = options.state ?? 'open';
      return execFileSync(
        'gh',
        [
          'pr',
          'list',
          '--head',
          options.branch!,
          '--state',
          state,
          '--json',
          'number,title,state,url',
          '-R',
          repo,
          '--jq',
          '.[0] // {"error": "No PR found"}',
        ],
        { encoding: 'utf8' }
      );
    }

    case 'listHighPriorityPrs': {
      const prsOutput = execFileSync(
        'gh',
        [
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
          '.[].number',
        ],
        { encoding: 'utf8' }
      ).trim();

      if (!prsOutput) return '[]';

      const prNumbers = prsOutput.split('\n').filter(Boolean);
      const results: string[] = [];

      for (const prNum of prNumbers) {
        const prData = execFileSync(
          'gh',
          ['pr', 'view', prNum, '--json', 'number,title,mergeStateStatus', '-R', repo],
          { encoding: 'utf8' }
        ).trim();
        results.push(prData);
      }

      return `[${results.join(',')}]`;
    }

    case 'triggerGeminiReview': {
      execFileSync('gh', ['pr', 'comment', String(options.number), '-R', repo, '--body', '/gemini review'], {
        encoding: 'utf8',
      });
      return JSON.stringify({ status: 'review_requested', pr: options.number });
    }

    case 'findDeferredWork': {
      return execFileSync(
        'gh',
        [
          'api',
          `repos/${repo}/pulls/${options.number}/comments`,
          '--paginate',
          '--jq',
          '.[] | select(.body | test("defer|follow[- ]?up|future PR|later|TODO|FIXME"; "i")) | {id: .id, path: .path, line: .line, body: .body, html_url: .html_url}',
        ],
        { encoding: 'utf8' }
      );
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
  } else if (action === 'addLabel') {
    args.push('--type', options.type!);
    args.push('--number', String(options.number));
    args.push('--label', options.label!);
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
    .option('--timeout-seconds <n>', 'Timeout in seconds', (v) => parsePositiveInt(v, '--timeout-seconds'))
    .option('--repo-root <path>', 'Execute from this repo root')
    .option('--dry-run', 'Validate and report without executing')
    .option('--json', 'Emit structured JSON summary');

  // Action-specific options
  switch (actionName) {
    case 'setVscodeTitle':
      cmd.option('--title <value>', 'Title to set');
      break;
    case 'addLabel':
      cmd
        .requiredOption('--type <pr|issue>', 'Target type', (v) => {
          if (v !== 'pr' && v !== 'issue') throw new InvalidArgumentError('--type must be "pr" or "issue"');
          return v as 'pr' | 'issue';
        })
        .requiredOption('--number <n>', 'PR or issue number', (v) => parsePositiveInt(v, '--number'))
        .requiredOption('--label <name>', 'Label name');
      break;
    case 'tagPrWithTuxedoInstance':
      cmd.option('--pr <n>', 'PR number (auto-detected if omitted)', (v) => parsePositiveInt(v, '--pr'));
      break;
    case 'getPrInfo':
      cmd.option('--fields <list>', 'Comma-separated fields');
      break;
    case 'getReviewThreads':
      cmd
        .requiredOption('--number <n>', 'PR number', (v) => parsePositiveInt(v, '--number'))
        .option('--unresolved-only', 'Only return unresolved threads');
      break;
    case 'replyToComment':
      cmd
        .requiredOption('--number <n>', 'PR number', (v) => parsePositiveInt(v, '--number'))
        .requiredOption('--comment-id <id>', 'Comment database ID')
        .requiredOption('--body <text>', 'Comment body');
      break;
    case 'replyToGemini':
      cmd
        .requiredOption('--number <n>', 'PR number', (v) => parsePositiveInt(v, '--number'))
        .requiredOption('--comment-id <id>', 'Comment database ID')
        .requiredOption('--commit <sha>', 'Commit SHA', (v) => {
          if (!isShaLike(v)) throw new InvalidArgumentError('--commit must be a 7-40 character hexadecimal SHA');
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
    case 'triggerGeminiReview':
    case 'findDeferredWork':
      cmd.requiredOption('--number <n>', 'PR number', (v) => parsePositiveInt(v, '--number'));
      break;
    case 'findPrForBranch':
      cmd
        .requiredOption('--branch <name>', 'Branch name')
        .addOption(
          new Option('--state <state>', 'PR state filter').choices(['open', 'merged']).default('open')
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
      const timeoutMs = (opts.timeoutSeconds ?? (actionName === 'refresh' ? 3600 : 300)) * 1000;

      if (opts.dryRun) {
        if (config.isInline) {
          output = `dry-run: would run inline action ${actionName}`;
        } else {
          const scriptPath = config.scriptPath!(repoRoot, AGENTS_DIR);
          output = `dry-run: would run ${scriptPath} from ${repoRoot}`;
        }
      } else if (config.isInline) {
        const repo = getRepo();
        output = runInlineAction(actionName, opts, repo);
      } else {
        const result = runDelegatedAction(actionName, opts, repoRoot, timeoutMs);
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
        key_lines: extractKeyLines(output),
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
  .description('Agent tooling CLI for environment setup, GitHub API actions, and script execution')
  .version('1.0.0');

// Register all action commands
for (const actionName of Object.keys(ACTION_CONFIG) as ActionName[]) {
  program.addCommand(createActionCommand(actionName));
}

program.parse();
