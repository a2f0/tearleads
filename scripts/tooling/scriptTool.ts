#!/usr/bin/env -S pnpm exec tsx
/**
 * Script Tool CLI - TypeScript wrapper for utility scripts in scripts/
 *
 * Provides a safe tool-calling interface with timeouts, validation,
 * and structured JSON output.
 *
 * Usage: tsx scripts/tooling/scriptTool.ts <action> [options]
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { program, Command, InvalidArgumentError } from 'commander';

// ============================================================================
// Types
// ============================================================================

type SafetyClass = 'safe_read' | 'safe_write_local';

type ActionName =
  | 'analyzeBundle'
  | 'checkBinaryFiles'
  | 'ciImpact'
  | 'runImpactedQuality'
  | 'runImpactedTests'
  | 'runAllTests'
  | 'runElectronTests'
  | 'runPlaywrightTests'
  | 'verifyBinaryGuardrails';

interface GlobalOptions {
  base?: string;
  head?: string;
  staged?: boolean;
  fromUpstream?: boolean;
  headed?: boolean;
  filter?: string;
  file?: string;
  timeoutSeconds?: number;
  repoRoot?: string;
  dryRun?: boolean;
  json?: boolean;
}

interface ActionConfig {
  safetyClass: SafetyClass;
  retrySafe: boolean;
  defaultTimeoutSeconds: number;
  scriptPath: (repoRoot: string) => string;
  scriptType: 'shell' | 'typescript';
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
}

// ============================================================================
// Constants
// ============================================================================

const ACTION_CONFIG: Record<ActionName, ActionConfig> = {
  analyzeBundle: {
    safetyClass: 'safe_write_local',
    retrySafe: true,
    defaultTimeoutSeconds: 600,
    scriptPath: (repo) => path.join(repo, 'scripts', 'analyzeBundle.sh'),
    scriptType: 'shell',
  },
  checkBinaryFiles: {
    safetyClass: 'safe_read',
    retrySafe: true,
    defaultTimeoutSeconds: 300,
    scriptPath: (repo) => path.join(repo, 'scripts', 'checkBinaryFiles.sh'),
    scriptType: 'shell',
  },
  ciImpact: {
    safetyClass: 'safe_read',
    retrySafe: true,
    defaultTimeoutSeconds: 300,
    scriptPath: (repo) => path.join(repo, 'scripts', 'ciImpact', 'ciImpact.ts'),
    scriptType: 'typescript',
  },
  runImpactedQuality: {
    safetyClass: 'safe_write_local',
    retrySafe: false,
    defaultTimeoutSeconds: 300,
    scriptPath: (repo) => path.join(repo, 'scripts', 'ciImpact', 'runImpactedQuality.ts'),
    scriptType: 'typescript',
  },
  runImpactedTests: {
    safetyClass: 'safe_write_local',
    retrySafe: false,
    defaultTimeoutSeconds: 300,
    scriptPath: (repo) => path.join(repo, 'scripts', 'ciImpact', 'runImpactedTests.ts'),
    scriptType: 'typescript',
  },
  runAllTests: {
    safetyClass: 'safe_write_local',
    retrySafe: false,
    defaultTimeoutSeconds: 3600,
    scriptPath: (repo) => path.join(repo, 'scripts', 'runAllTests.sh'),
    scriptType: 'shell',
  },
  runElectronTests: {
    safetyClass: 'safe_write_local',
    retrySafe: false,
    defaultTimeoutSeconds: 1800,
    scriptPath: (repo) => path.join(repo, 'scripts', 'runElectronTests.sh'),
    scriptType: 'shell',
  },
  runPlaywrightTests: {
    safetyClass: 'safe_write_local',
    retrySafe: false,
    defaultTimeoutSeconds: 1800,
    scriptPath: (repo) => path.join(repo, 'scripts', 'runPlaywrightTests.sh'),
    scriptType: 'shell',
  },
  verifyBinaryGuardrails: {
    safetyClass: 'safe_read',
    retrySafe: true,
    defaultTimeoutSeconds: 300,
    scriptPath: (repo) => path.join(repo, 'scripts', 'verifyBinaryGuardrails.sh'),
    scriptType: 'shell',
  },
};

// ============================================================================
// Validation
// ============================================================================

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
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
// Script Execution
// ============================================================================

interface ScriptArgs {
  base?: string;
  head?: string;
  staged?: boolean;
  fromUpstream?: boolean;
  headed?: boolean;
  filter?: string;
  file?: string;
}

function buildScriptArgs(action: ActionName, options: ScriptArgs): string[] {
  const args: string[] = [];

  switch (action) {
    case 'checkBinaryFiles':
      if (options.staged) {
        args.push('--staged');
      } else if (options.fromUpstream) {
        args.push('--from-upstream');
      }
      break;

    case 'ciImpact':
    case 'runImpactedQuality':
    case 'runImpactedTests':
      if (options.base) args.push('--base', options.base);
      if (options.head) args.push('--head', options.head);
      break;

    case 'runAllTests':
      if (options.headed) args.push('--headed');
      break;

    case 'runElectronTests':
    case 'runPlaywrightTests':
      if (options.headed) args.push('--headed');
      if (options.filter) args.push('-g', options.filter);
      if (options.file) args.push(options.file);
      break;

    case 'analyzeBundle':
    case 'verifyBinaryGuardrails':
      // No additional arguments
      break;
  }

  return args;
}

function runScript(
  action: ActionName,
  options: GlobalOptions,
  repoRoot: string,
  timeoutMs: number
): { stdout: string; stderr: string; exitCode: number } {
  const config = ACTION_CONFIG[action];
  const scriptPath = config.scriptPath(repoRoot);

  if (!existsSync(scriptPath)) {
    throw new Error(`Script not found: ${scriptPath}`);
  }

  const scriptArgs = buildScriptArgs(action, options);

  if (config.scriptType === 'typescript') {
    // Run TypeScript files through pnpm exec tsx
    return runWithTimeout('pnpm', ['exec', 'tsx', scriptPath, ...scriptArgs], timeoutMs, repoRoot);
  }

  // Run shell scripts directly
  return runWithTimeout(scriptPath, scriptArgs, timeoutMs, repoRoot);
}

// ============================================================================
// Main Execution
// ============================================================================

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
    .option('--repo-root <path>', 'Execute from this repo root instead of auto-detecting')
    .option('--dry-run', 'Validate and report without executing the target script')
    .option('--json', 'Emit structured JSON summary');

  // Action-specific options
  switch (actionName) {
    case 'ciImpact':
    case 'runImpactedQuality':
    case 'runImpactedTests':
      cmd
        .requiredOption('--base <sha>', 'Base commit for diff')
        .requiredOption('--head <sha>', 'Head commit for diff');
      break;

    case 'checkBinaryFiles':
      cmd
        .option('--staged', 'Check staged files')
        .option('--from-upstream', 'Check files changed from upstream')
        .hook('preAction', (thisCommand) => {
          const opts = thisCommand.opts();
          if (!opts.staged && !opts.fromUpstream) {
            console.error('error: checkBinaryFiles requires --staged or --from-upstream');
            process.exit(1);
          }
        });
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

    case 'analyzeBundle':
    case 'verifyBinaryGuardrails':
      // No additional options
      break;
  }

  cmd.action((opts: GlobalOptions) => {
    const startMs = Date.now();
    let exitCode = 0;
    let output = '';

    try {
      const repoRoot = getRepoRoot(opts.repoRoot);
      const timeoutMs = (opts.timeoutSeconds ?? config.defaultTimeoutSeconds) * 1000;

      if (opts.dryRun) {
        const scriptPath = config.scriptPath(repoRoot);
        output = `dry-run: would run ${scriptPath} for action ${actionName} from ${repoRoot}`;
      } else {
        const result = runScript(actionName, opts, repoRoot, timeoutMs);
        output = result.stdout + result.stderr;
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
        key_lines: extractKeyLines(output),
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

// ============================================================================
// CLI Setup
// ============================================================================

program
  .name('scriptTool.ts')
  .description('Script Tool CLI for running utility scripts with safe tool-calling interface')
  .version('1.0.0');

// Register all action commands
for (const actionName of Object.keys(ACTION_CONFIG) as ActionName[]) {
  program.addCommand(createActionCommand(actionName));
}

program.parse();
