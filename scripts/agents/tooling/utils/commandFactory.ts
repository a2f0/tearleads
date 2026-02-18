import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Command, InvalidArgumentError, Option } from 'commander';
import {
  extractKeyLines,
  getRepoRoot,
  parsePositiveInt
} from '../../../tooling/lib/cliShared.ts';
import type { ActionName, GlobalOptions, JsonOutput } from '../types.ts';
import { ACTION_CONFIG, AGENTS_DIR_PATH } from './actionConfig.ts';
import { runDelegatedAction, runInlineAction } from './actions.ts';
import { getRepo, isShaLike } from './helpers.ts';
import { applyInfraCommandOptions } from './infraCommandOptions.ts';
import { applyIssueCommandOptions } from './issueCommandOptions.ts';
import { applyPrWorkflowCommandOptions } from './prWorkflowCommandOptions.ts';

export { ACTION_NAMES } from './actionConfig.ts';

export function createActionCommand(actionName: ActionName): Command {
  const config = ACTION_CONFIG[actionName];
  const cmd = new Command(actionName);

  cmd
    .option('--timeout-seconds <n>', 'Timeout in seconds', (v) =>
      parsePositiveInt(v, '--timeout-seconds')
    )
    .option('--repo-root <path>', 'Execute from this repo root')
    .option('--dry-run', 'Validate and report without executing')
    .option('--json', 'Emit structured JSON summary');

  if (
    applyInfraCommandOptions(actionName, cmd) ||
    applyPrWorkflowCommandOptions(actionName, cmd) ||
    applyIssueCommandOptions(actionName, cmd)
  ) {
    // Action-specific options were applied in helper.
  } else {
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
      case 'checkMainVersionBumpSetup':
        cmd.option(
          '--key-file <path>',
          'Path to merge-signing app private key PEM file'
        );
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
      case 'getPrChecks':
      case 'getRequiredChecksStatus':
        cmd.requiredOption('--number <n>', 'PR number', (v) =>
          parsePositiveInt(v, '--number')
        );
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
        cmd.option('--mode <mode>', 'Preen mode', (v) => {
          const allowed = ['full', 'single', 'security', 'audit'];
          if (!allowed.includes(v)) {
            throw new InvalidArgumentError(
              `--mode must be one of ${allowed.join(', ')}`
            );
          }
          return v as GlobalOptions['mode'];
        });
        break;
      case 'generatePrSummary':
        cmd
          .option('--number <n>', 'PR number (used if provided)', (v) =>
            parsePositiveInt(v, '--number')
          )
          .option(
            '--branch <name>',
            'Branch name (defaults to current branch)'
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
      case 'createPr':
        cmd
          .requiredOption('--title <text>', 'PR title')
          .requiredOption('--base <name>', 'Base branch')
          .requiredOption('--head <name>', 'Head branch')
          .option('--body <text>', 'PR body content')
          .option('--body-file <path>', 'Read PR body content from file')
          .option('--draft', 'Create a draft PR')
          .hook('preAction', (thisCommand) => {
            const opts = thisCommand.opts();
            if (opts.body && opts.bodyFile) {
              throw new InvalidArgumentError(
                'createPr accepts either --body or --body-file'
              );
            }
          });
        break;
    }
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

      if (opts.dryRun && actionName !== 'runPreen') {
        if (config.isInline) {
          output = `dry-run: would run inline action ${actionName}`;
        } else {
          if (!config.scriptPath) {
            throw new Error(`No script path for action: ${actionName}`);
          }
          const scriptPath = config.scriptPath(repoRoot, AGENTS_DIR_PATH);
          output = `dry-run: would run ${scriptPath} from ${repoRoot}`;
        }
      } else if (config.isInline) {
        const repo =
          actionName === 'runTerraformStackScript' ||
          actionName === 'runAnsibleBootstrap'
            ? ''
            : getRepo();
        output = await runInlineAction(
          actionName,
          opts,
          repo,
          timeoutMs,
          repoRoot
        );
      } else {
        const result = runDelegatedAction(
          actionName,
          opts,
          config,
          repoRoot,
          timeoutMs,
          AGENTS_DIR_PATH
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
