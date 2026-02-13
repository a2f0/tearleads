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
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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

interface ActionOption {
  name: string;
  description: string;
  required?: boolean;
}

interface ActionConfig {
  safetyClass: SafetyClass;
  retrySafe: boolean;
  defaultTimeoutSeconds: number;
  scriptPath: (repoRoot: string) => string;
  scriptType: 'shell' | 'typescript';
  /** Short description for documentation */
  description: string;
  /** Category for grouping in documentation */
  category: 'analysis' | 'quality' | 'testing';
  /** Action-specific options */
  options?: ActionOption[];
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
    description: 'Build and open bundle analysis report',
    category: 'analysis',
  },
  checkBinaryFiles: {
    safetyClass: 'safe_read',
    retrySafe: true,
    defaultTimeoutSeconds: 300,
    scriptPath: (repo) => path.join(repo, 'scripts', 'checkBinaryFiles.sh'),
    scriptType: 'shell',
    description: 'Check for binary files (guardrail validation)',
    category: 'analysis',
    options: [
      { name: '--staged', description: 'Check staged files' },
      { name: '--from-upstream', description: 'Check files changed from upstream' },
    ],
  },
  ciImpact: {
    safetyClass: 'safe_read',
    retrySafe: true,
    defaultTimeoutSeconds: 300,
    scriptPath: (repo) => path.join(repo, 'scripts', 'ciImpact', 'ciImpact.ts'),
    scriptType: 'typescript',
    description: 'Analyze CI impact for changed files (JSON output)',
    category: 'analysis',
    options: [
      { name: '--base <sha>', description: 'Base commit for diff', required: true },
      { name: '--head <sha>', description: 'Head commit for diff', required: true },
    ],
  },
  runImpactedQuality: {
    safetyClass: 'safe_write_local',
    retrySafe: false,
    defaultTimeoutSeconds: 300,
    scriptPath: (repo) => path.join(repo, 'scripts', 'ciImpact', 'runImpactedQuality.ts'),
    scriptType: 'typescript',
    description: 'Run quality checks on impacted files only',
    category: 'quality',
    options: [
      { name: '--base <sha>', description: 'Base commit for diff', required: true },
      { name: '--head <sha>', description: 'Head commit for diff', required: true },
    ],
  },
  runImpactedTests: {
    safetyClass: 'safe_write_local',
    retrySafe: false,
    defaultTimeoutSeconds: 300,
    scriptPath: (repo) => path.join(repo, 'scripts', 'ciImpact', 'runImpactedTests.ts'),
    scriptType: 'typescript',
    description: 'Run tests on impacted packages only',
    category: 'testing',
    options: [
      { name: '--base <sha>', description: 'Base commit for diff', required: true },
      { name: '--head <sha>', description: 'Head commit for diff', required: true },
    ],
  },
  runAllTests: {
    safetyClass: 'safe_write_local',
    retrySafe: false,
    defaultTimeoutSeconds: 3600,
    scriptPath: (repo) => path.join(repo, 'scripts', 'runAllTests.sh'),
    scriptType: 'shell',
    description: 'Run full test suite (lint, build, unit, e2e)',
    category: 'testing',
    options: [{ name: '--headed', description: 'Run tests with visible browser' }],
  },
  runElectronTests: {
    safetyClass: 'safe_write_local',
    retrySafe: false,
    defaultTimeoutSeconds: 1800,
    scriptPath: (repo) => path.join(repo, 'scripts', 'runElectronTests.sh'),
    scriptType: 'shell',
    description: 'Run Electron E2E tests',
    category: 'testing',
    options: [
      { name: '--headed', description: 'Run tests with visible browser' },
      { name: '--filter <pattern>', description: 'Test filter pattern' },
      { name: '--file <path>', description: 'Specific test file' },
    ],
  },
  runPlaywrightTests: {
    safetyClass: 'safe_write_local',
    retrySafe: false,
    defaultTimeoutSeconds: 1800,
    scriptPath: (repo) => path.join(repo, 'scripts', 'runPlaywrightTests.sh'),
    scriptType: 'shell',
    description: 'Run Playwright E2E tests',
    category: 'testing',
    options: [
      { name: '--headed', description: 'Run tests with visible browser' },
      { name: '--filter <pattern>', description: 'Test filter pattern' },
      { name: '--file <path>', description: 'Specific test file' },
    ],
  },
  verifyBinaryGuardrails: {
    safetyClass: 'safe_read',
    retrySafe: true,
    defaultTimeoutSeconds: 300,
    scriptPath: (repo) => path.join(repo, 'scripts', 'verifyBinaryGuardrails.sh'),
    scriptType: 'shell',
    description: 'Verify binary guardrail configuration',
    category: 'analysis',
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
// Documentation Generation
// ============================================================================

function formatTimeout(seconds: number): string {
  if (seconds >= 3600) return `${seconds / 3600} hour${seconds > 3600 ? 's' : ''}`;
  if (seconds >= 60) return `${seconds / 60} minutes`;
  return `${seconds} seconds`;
}

function generateReadme(): string {
  const lines: string[] = [];

  lines.push('# Script Tool Wrappers');
  lines.push('');
  lines.push('> **Auto-generated from `scriptTool.ts`** - Do not edit manually.');
  lines.push('> Run `./scripts/tooling/scriptTool.ts generateDocs` to regenerate.');
  lines.push('');
  lines.push('`scriptTool.ts` is a TypeScript wrapper around utility scripts in `scripts/` for safer tool-calling.');
  lines.push('');

  // Usage section
  lines.push('## Usage');
  lines.push('');
  lines.push('```sh');
  lines.push('./scripts/tooling/scriptTool.ts <action> [options]');
  lines.push('```');
  lines.push('');

  // Group actions by category
  const categories: Record<string, ActionName[]> = {
    analysis: [],
    quality: [],
    testing: [],
  };

  for (const [name, config] of Object.entries(ACTION_CONFIG) as [ActionName, ActionConfig][]) {
    categories[config.category].push(name);
  }

  // Actions section
  lines.push('## Actions');
  lines.push('');

  const categoryTitles: Record<string, string> = {
    analysis: 'Analysis',
    quality: 'Quality',
    testing: 'Testing',
  };

  for (const [category, actions] of Object.entries(categories)) {
    if (actions.length === 0) continue;

    lines.push(`### ${categoryTitles[category]}`);
    lines.push('');

    for (const actionName of actions) {
      const config = ACTION_CONFIG[actionName];
      lines.push(`- \`${actionName}\` - ${config.description}`);
    }
    lines.push('');
  }

  // Common options section
  lines.push('## Common Options');
  lines.push('');
  lines.push('All actions support these options:');
  lines.push('');
  lines.push('| Option | Description |');
  lines.push('| ------ | ----------- |');
  lines.push('| `--timeout-seconds <n>` | Override default timeout |');
  lines.push('| `--repo-root <path>` | Execute from specific git root |');
  lines.push('| `--dry-run` | Validate without executing |');
  lines.push('| `--json` | Emit structured JSON summary |');
  lines.push('');

  // Action-specific options
  lines.push('## Action-Specific Options');
  lines.push('');

  for (const [actionName, config] of Object.entries(ACTION_CONFIG) as [ActionName, ActionConfig][]) {
    if (!config.options || config.options.length === 0) continue;

    lines.push(`### ${actionName}`);
    lines.push('');
    lines.push('| Option | Description | Required |');
    lines.push('| ------ | ----------- | -------- |');

    for (const opt of config.options) {
      lines.push(`| \`${opt.name}\` | ${opt.description} | ${opt.required ? 'Yes' : 'No'} |`);
    }
    lines.push('');
  }

  // Default timeouts section
  lines.push('## Default Timeouts');
  lines.push('');
  lines.push('| Action | Timeout |');
  lines.push('| ------ | ------- |');

  for (const [actionName, config] of Object.entries(ACTION_CONFIG) as [ActionName, ActionConfig][]) {
    lines.push(`| \`${actionName}\` | ${formatTimeout(config.defaultTimeoutSeconds)} |`);
  }
  lines.push('');

  // Safety classes section
  lines.push('## Safety Classes');
  lines.push('');
  lines.push('| Class | Actions |');
  lines.push('| ----- | ------- |');

  const safetyGroups: Record<SafetyClass, ActionName[]> = {
    safe_read: [],
    safe_write_local: [],
  };

  for (const [name, config] of Object.entries(ACTION_CONFIG) as [ActionName, ActionConfig][]) {
    safetyGroups[config.safetyClass].push(name);
  }

  for (const [safetyClass, actions] of Object.entries(safetyGroups)) {
    if (actions.length > 0) {
      lines.push(`| \`${safetyClass}\` | ${actions.map((a) => `\`${a}\``).join(', ')} |`);
    }
  }
  lines.push('');

  // Examples section
  lines.push('## Examples');
  lines.push('');
  lines.push('```sh');
  lines.push('# Analyze CI impact between commits');
  lines.push('./scripts/tooling/scriptTool.ts ciImpact --base origin/main --head HEAD --json');
  lines.push('');
  lines.push('# Run impacted quality checks');
  lines.push('./scripts/tooling/scriptTool.ts runImpactedQuality --base origin/main --head HEAD');
  lines.push('');
  lines.push('# Run impacted tests only');
  lines.push('./scripts/tooling/scriptTool.ts runImpactedTests --base origin/main --head HEAD');
  lines.push('');
  lines.push('# Check for binary files in staged changes');
  lines.push('./scripts/tooling/scriptTool.ts checkBinaryFiles --staged --json');
  lines.push('');
  lines.push('# Run Playwright tests with filter');
  lines.push('./scripts/tooling/scriptTool.ts runPlaywrightTests --filter "login" --headed');
  lines.push('');
  lines.push('# Dry-run to validate command');
  lines.push('./scripts/tooling/scriptTool.ts runAllTests --dry-run --json');
  lines.push('```');
  lines.push('');

  // JSON output format section
  lines.push('## JSON Output Format');
  lines.push('');
  lines.push('When `--json` is specified, output includes:');
  lines.push('');
  lines.push('```json');
  lines.push('{');
  lines.push('  "status": "success",');
  lines.push('  "exit_code": 0,');
  lines.push('  "duration_ms": 1234,');
  lines.push('  "action": "ciImpact",');
  lines.push('  "repo_root": "/path/to/repo",');
  lines.push('  "safety_class": "safe_read",');
  lines.push('  "retry_safe": true,');
  lines.push('  "dry_run": false,');
  lines.push('  "key_lines": ["last", "few", "lines", "of", "output"]');
  lines.push('}');
  lines.push('```');
  lines.push('');

  return lines.join('\n');
}

function runGenerateDocs(repoRoot: string, dryRun: boolean): { output: string; changed: boolean } {
  const readmePath = path.join(repoRoot, 'scripts', 'tooling', 'README.md');
  const newContent = generateReadme();

  if (dryRun) {
    return { output: newContent, changed: false };
  }

  let existingContent = '';
  if (existsSync(readmePath)) {
    existingContent = readFileSync(readmePath, 'utf8');
  }

  const changed = existingContent !== newContent;

  if (changed) {
    writeFileSync(readmePath, newContent, 'utf8');
  }

  return {
    output: changed ? `Updated ${readmePath}` : `No changes needed for ${readmePath}`,
    changed,
  };
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
            dry_run: opts.dryRun ?? false,
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
