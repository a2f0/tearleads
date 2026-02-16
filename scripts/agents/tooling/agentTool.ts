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
  parsePositiveInt
} from '../../tooling/lib/cliShared.ts';
import { runInlineAction, runDelegatedAction } from './utils/actions.ts';
import { getRepo, isShaLike, requireDefined } from './utils/helpers.ts';
import {
  ActionName,
  ActionConfig,
  GlobalOptions,
  JsonOutput
} from './types.ts';

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
  },
  runPreen: {
    safetyClass: 'safe_write_local',
    retrySafe: false,
    isInline: false,
    scriptPath: (repo) => path.join(repo, 'scripts', 'preen', 'runPreen.sh')
  },
  issueTemplate: {
    safetyClass: 'safe_read',
    retrySafe: true,
    isInline: true
  }
};

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
    case 'runPreen':
      cmd
        .option('--mode <mode>', 'Preen mode', (v) => {
          const allowed = ['full', 'single', 'security', 'audit'];
          if (!allowed.includes(v)) {
            throw new InvalidArgumentError(
              `--mode must be one of ${allowed.join(', ')}`
            );
          }
          return v as GlobalOptions['mode'];
        })
        .option('--dry-run', 'Validate steps without mutating the workspace');
      break;
    case 'issueTemplate':
      cmd.requiredOption('--type <type>', 'Template type', (v) => {
        const allowed = ['user-requested', 'deferred-fix'];
        if (!allowed.includes(v)) {
          throw new InvalidArgumentError(
            `--type must be one of ${allowed.join(', ')}`
          );
        }
        return v as GlobalOptions['type'];
      });
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
          config,
          repoRoot,
          timeoutMs,
          AGENTS_DIR
        );
        output = result.stdout + result.stderr;
        exitCode = result.exitCode;
      }

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
