#!/usr/bin/env -S pnpm exec tsx
/**
 * Script Tool CLI - TypeScript wrapper for utility scripts in scripts/
 */
import { Command, InvalidArgumentError, program } from 'commander';
import {
  extractKeyLines,
  getRepoRoot,
  parsePositiveInt
} from './lib/cliShared.ts';
import { ACTION_CONFIG } from './scriptTool/actionConfig.ts';
import { runGenerateDocs } from './scriptTool/docs.ts';
import { runPreflight } from './scriptTool/preflight.ts';
import { buildScriptInvocation, runScript } from './scriptTool/runtime.ts';
import type {
  ActionName,
  GlobalOptions,
  JsonOutput
} from './scriptTool/types.ts';
import { quoteArg } from './scriptTool/utils.ts';

function createActionCommand(actionName: ActionName): Command {
  const cmd = new Command(actionName);
  const config = ACTION_CONFIG[actionName];

  // Common options for all actions
  cmd
    .option(
      '--timeout-seconds <n>',
      `Timeout in seconds (default: ${config.defaultTimeoutSeconds})`,
      (v) => parsePositiveInt(v, '--timeout-seconds')
    )
    .option(
      '--repo-root <path>',
      'Execute from this repo root instead of auto-detecting'
    )
    .option(
      '--dry-run',
      'Validate and report without executing the target script'
    )
    .option('--json', 'Emit structured JSON summary');

  // Action-specific options
  switch (actionName) {
    case 'ciImpact':
    case 'runImpactedQuality':
      cmd
        .requiredOption('--base <sha>', 'Base commit for diff')
        .requiredOption('--head <sha>', 'Head commit for diff');
      break;

    case 'runImpactedTests':
      cmd
        .requiredOption('--base <sha>', 'Base commit for diff')
        .requiredOption('--head <sha>', 'Head commit for diff')
        .option('--scripts-only', 'Run only impacted ciImpact script tests');
      break;

    case 'checkBinaryFiles':
      cmd
        .option('--staged', 'Check staged files')
        .option('--from-upstream', 'Check files changed from upstream')
        .hook('preAction', (thisCommand) => {
          const opts = thisCommand.opts();
          if (!opts.staged && !opts.fromUpstream) {
            console.error(
              'error: checkBinaryFiles requires --staged or --from-upstream'
            );
            process.exit(1);
          }
        });
      break;

    case 'runAndroid':
    case 'runIpad':
    case 'runElectron':
    case 'copyTestFilesAndroid':
    case 'toggleAndroidKeyboard':
    case 'setupPostgresDev':
    case 'verifyCleanIosBuild':
    case 'muteIosSimulatorAudio':
    case 'verifyFileGuardrails':
    case 'analyzeBundle':
      // No additional options
      break;

    case 'runIos':
      cmd.option('--device <name>', 'Simulator device name');
      break;

    case 'copyTestFilesIos':
      cmd.option('--bundle-id <id>', 'Bundle ID to target in booted simulator');
      break;

    case 'runMaestroAndroidTests':
      cmd
        .option('--headless', 'Run emulator without visible UI')
        .option('--flow <path>', 'Single Maestro flow path')
        .option('--record-video', 'Enable Maestro video recording')
        .option('--video-seconds <n>', 'Video duration in seconds', (v) =>
          parsePositiveInt(v, '--video-seconds')
        );
      break;

    case 'runMaestroIosTests':
      cmd
        .option('--headless', 'Run simulator without visible UI')
        .option('--flow <path>', 'Single Maestro flow path')
        .option('--record-video', 'Enable Maestro video recording');
      break;

    case 'setupSerenaMcp':
      cmd.option(
        '--script-dry-run',
        'Pass through --dry-run to setupSerenaMcp.sh'
      );
      break;

    case 'setupTuxedoRepos':
      cmd
        .option('--base-dir <path>', 'TUXEDO_BASE_DIR override')
        .option(
          '--workspace-count <n>',
          'TUXEDO_WORKSPACE_COUNT override',
          (v) => parsePositiveInt(v, '--workspace-count')
        );
      break;

    case 'syncCliAuth':
      cmd
        .requiredOption('--host <user@host>', 'Remote host destination')
        .requiredOption('--confirm', 'Required to allow credential sync');
      break;

    case 'updateEverything':
      cmd
        .requiredOption('--mode <full|quick>', 'Execution profile', (v) => {
          if (v === 'full' || v === 'quick') return v;
          throw new InvalidArgumentError('--mode must be "full" or "quick"');
        })
        .option('--confirm', 'Required for non-dry-run execution')
        .hook('preAction', (thisCommand) => {
          const opts = thisCommand.opts() as GlobalOptions;
          if (!opts.dryRun && !opts.confirm) {
            console.error(
              'error: updateEverything requires --confirm unless --dry-run is set'
            );
            process.exit(1);
          }
        });
      break;

    case 'tuxedo':
      cmd
        .requiredOption(
          '--mode <default|no-pr-dashboards|no-screen>',
          'Launch mode',
          (v) => {
            if (
              v === 'default' ||
              v === 'no-pr-dashboards' ||
              v === 'no-screen'
            )
              return v;
            throw new InvalidArgumentError(
              '--mode must be default, no-pr-dashboards, or no-screen'
            );
          }
        )
        .option('--base-dir <path>', 'TUXEDO_BASE_DIR override')
        .option('--workspace-count <n>', 'TUXEDO_WORKSPACES override', (v) =>
          parsePositiveInt(v, '--workspace-count')
        );
      break;

    case 'tuxedoKill':
      cmd
        .requiredOption('--scope <all>', 'Kill scope', (v) => {
          if (v === 'all') return v;
          throw new InvalidArgumentError(
            '--scope currently supports only "all"'
          );
        })
        .requiredOption('--confirm', 'Required to allow tuxedo termination');
      break;

    case 'runAllTests':
      cmd.option('--headed', 'Run tests with visible browser');
      break;

    case 'runElectronTests':
    case 'runPlaywrightTests':
      cmd
        .option('--headed', 'Run tests with visible browser')
        .option('--filter <pattern>', 'Test filter pattern')
        .option('--file <path>', 'Specific test file');
      break;
  }

  cmd.action((opts: GlobalOptions) => {
    const startMs = Date.now();
    let exitCode = 0;
    let output = '';

    try {
      const repoRoot = getRepoRoot(opts.repoRoot);
      const timeoutMs =
        (opts.timeoutSeconds ?? config.defaultTimeoutSeconds) * 1000;
      const scriptPath = config.scriptPath(repoRoot);
      const invocation = buildScriptInvocation(actionName, opts);
      const envEntries = Object.entries(invocation.env);
      const renderedArgs = invocation.args
        .map((arg) => quoteArg(arg))
        .join(' ');
      const renderedCommand =
        renderedArgs.length > 0 ? `${scriptPath} ${renderedArgs}` : scriptPath;
      const renderedEnv =
        envEntries.length > 0
          ? envEntries
              .map(([key, value]) => `${key}=${quoteArg(String(value))}`)
              .join(' ')
          : '(none)';

      if (opts.dryRun) {
        output = [
          `dry-run: would run ${renderedCommand}`,
          `repo-root: ${repoRoot}`,
          `env: ${renderedEnv}`,
          'preflight: skipped in dry-run mode'
        ].join('\n');
      } else {
        const preflightLines = runPreflight(actionName, opts, repoRoot);
        const result = runScript(actionName, opts, repoRoot, timeoutMs);
        const combinedOutput = result.stdout + result.stderr;
        output = [...preflightLines, combinedOutput]
          .filter((line) => line.trim().length > 0)
          .join('\n');
        exitCode = result.exitCode;
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
program
  .name('scriptTool.ts')
  .description(
    'Script Tool CLI for running utility scripts with safe tool-calling interface'
  )
  .version('1.0.0');

// Register all action commands
for (const actionName of Object.keys(ACTION_CONFIG) as ActionName[]) {
  program.addCommand(createActionCommand(actionName));
}

// Add generateDocs command
program
  .command('generateDocs')
  .description('Generate README.md from action configurations')
  .option('--repo-root <path>', 'Repository root path')
  .option('--dry-run', 'Print generated content without writing')
  .option('--json', 'Emit structured JSON summary')
  .action((opts: { repoRoot?: string; dryRun?: boolean; json?: boolean }) => {
    const startMs = Date.now();
    let exitCode = 0;
    let output = '';
    let changed = false;

    try {
      const repoRoot = getRepoRoot(opts.repoRoot);
      const result = runGenerateDocs(repoRoot, opts.dryRun ?? false);
      output = result.output;
      changed = result.changed;
    } catch (err) {
      output = err instanceof Error ? err.message : String(err);
      exitCode = 1;
    }

    const durationMs = Date.now() - startMs;

    if (opts.json) {
      console.log(
        JSON.stringify(
          {
            status: exitCode === 0 ? 'success' : 'failure',
            exit_code: exitCode,
            duration_ms: durationMs,
            action: 'generateDocs',
            changed,
            dry_run: opts.dryRun ?? false
          },
          null,
          2
        )
      );
    } else {
      console.log(output);
    }

    if (exitCode !== 0) {
      process.exit(exitCode);
    }
  });

program.parse();
