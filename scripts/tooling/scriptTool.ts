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

type SafetyClass = 'safe_read' | 'safe_write_local' | 'safe_write_remote';

type ActionName =
  | 'analyzeBundle'
  | 'checkBinaryFiles'
  | 'ciImpact'
  | 'copyTestFilesAndroid'
  | 'copyTestFilesIos'
  | 'runImpactedQuality'
  | 'runImpactedTests'
  | 'runAllTests'
  | 'runAndroid'
  | 'runElectron'
  | 'runElectronTests'
  | 'runIos'
  | 'runIpad'
  | 'runMaestroAndroidTests'
  | 'runMaestroIosTests'
  | 'runPlaywrightTests'
  | 'setupPostgresDev'
  | 'setupSerenaMcp'
  | 'setupTuxedoRepos'
  | 'syncCliAuth'
  | 'toggleAndroidKeyboard'
  | 'tuxedo'
  | 'tuxedoKill'
  | 'updateEverything'
  | 'verifyCleanIosBuild'
  | 'verifyFileGuardrails';

interface GlobalOptions {
  base?: string;
  baseDir?: string;
  bundleId?: string;
  confirm?: boolean;
  device?: string;
  flow?: string;
  head?: string;
  headless?: boolean;
  staged?: boolean;
  fromUpstream?: boolean;
  headed?: boolean;
  filter?: string;
  file?: string;
  host?: string;
  mode?: 'full' | 'quick' | 'default' | 'no-pr-dashboards' | 'no-screen';
  recordVideo?: boolean;
  scope?: 'all';
  scriptDryRun?: boolean;
  timeoutSeconds?: number;
  repoRoot?: string;
  dryRun?: boolean;
  videoSeconds?: number;
  workspaceCount?: number;
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
  category: 'analysis' | 'quality' | 'testing' | 'environment' | 'device' | 'operations';
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
  copyTestFilesAndroid: {
    safetyClass: 'safe_write_local',
    retrySafe: true,
    defaultTimeoutSeconds: 300,
    scriptPath: (repo) => path.join(repo, 'scripts', 'copyTestFilesAndroid.sh'),
    scriptType: 'shell',
    description: 'Copy .test_files payload into Android emulator storage',
    category: 'device',
  },
  copyTestFilesIos: {
    safetyClass: 'safe_write_local',
    retrySafe: true,
    defaultTimeoutSeconds: 300,
    scriptPath: (repo) => path.join(repo, 'scripts', 'copyTestFilesIos.sh'),
    scriptType: 'shell',
    description: 'Copy .test_files payload into iOS simulator app container',
    category: 'device',
    options: [{ name: '--bundle-id <id>', description: 'Bundle ID (default: com.tearleads.app)' }],
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
  verifyFileGuardrails: {
    safetyClass: 'safe_read',
    retrySafe: true,
    defaultTimeoutSeconds: 300,
    scriptPath: (repo) => path.join(repo, 'scripts', 'verifyFileGuardrails.sh'),
    scriptType: 'shell',
    description: 'Verify file guardrail configuration',
    category: 'analysis',
  },
  runAndroid: {
    safetyClass: 'safe_write_local',
    retrySafe: false,
    defaultTimeoutSeconds: 5400,
    scriptPath: (repo) => path.join(repo, 'scripts', 'runAndroid.sh'),
    scriptType: 'shell',
    description: 'Build/sync and run Android app on emulator',
    category: 'device',
  },
  runIos: {
    safetyClass: 'safe_write_local',
    retrySafe: false,
    defaultTimeoutSeconds: 5400,
    scriptPath: (repo) => path.join(repo, 'scripts', 'runIos.sh'),
    scriptType: 'shell',
    description: 'Build/sync and run iOS app on simulator',
    category: 'device',
    options: [{ name: '--device <name>', description: 'Simulator device name' }],
  },
  runIpad: {
    safetyClass: 'safe_write_local',
    retrySafe: false,
    defaultTimeoutSeconds: 5400,
    scriptPath: (repo) => path.join(repo, 'scripts', 'runIpad.sh'),
    scriptType: 'shell',
    description: 'Build/sync and run iOS app on iPad simulator',
    category: 'device',
  },
  runElectron: {
    safetyClass: 'safe_write_local',
    retrySafe: false,
    defaultTimeoutSeconds: 3600,
    scriptPath: (repo) => path.join(repo, 'scripts', 'runElectron.sh'),
    scriptType: 'shell',
    description: 'Start Electron development runtime',
    category: 'device',
  },
  runMaestroAndroidTests: {
    safetyClass: 'safe_write_local',
    retrySafe: false,
    defaultTimeoutSeconds: 3600,
    scriptPath: (repo) => path.join(repo, 'scripts', 'runMaestroAndroidTests.sh'),
    scriptType: 'shell',
    description: 'Run Maestro Android flows via Fastlane',
    category: 'testing',
    options: [
      { name: '--headless', description: 'Run emulator without UI' },
      { name: '--flow <path>', description: 'Flow file path to execute' },
      { name: '--record-video', description: 'Enable Maestro video recording' },
      { name: '--video-seconds <n>', description: 'Video duration in seconds' },
    ],
  },
  runMaestroIosTests: {
    safetyClass: 'safe_write_local',
    retrySafe: false,
    defaultTimeoutSeconds: 3600,
    scriptPath: (repo) => path.join(repo, 'scripts', 'runMaestroIosTests.sh'),
    scriptType: 'shell',
    description: 'Run Maestro iOS flows via Fastlane',
    category: 'testing',
    options: [
      { name: '--headless', description: 'Run simulator headless' },
      { name: '--flow <path>', description: 'Flow file path to execute' },
      { name: '--record-video', description: 'Enable Maestro video recording' },
    ],
  },
  setupPostgresDev: {
    safetyClass: 'safe_write_local',
    retrySafe: true,
    defaultTimeoutSeconds: 1200,
    scriptPath: (repo) => path.join(repo, 'scripts', 'setupPostgresDev.sh'),
    scriptType: 'shell',
    description: 'Install/start Homebrew PostgreSQL and provision dev DB',
    category: 'environment',
  },
  setupSerenaMcp: {
    safetyClass: 'safe_write_local',
    retrySafe: true,
    defaultTimeoutSeconds: 600,
    scriptPath: (repo) => path.join(repo, 'scripts', 'setupSerenaMcp.sh'),
    scriptType: 'shell',
    description: 'Configure Serena MCP server for Codex and Claude',
    category: 'environment',
    options: [{ name: '--script-dry-run', description: 'Pass through --dry-run to setupSerenaMcp.sh' }],
  },
  setupTuxedoRepos: {
    safetyClass: 'safe_write_local',
    retrySafe: true,
    defaultTimeoutSeconds: 1800,
    scriptPath: (repo) => path.join(repo, 'scripts', 'setupTuxedoRepos.sh'),
    scriptType: 'shell',
    description: 'Clone/fetch local tuxedo workspace repositories',
    category: 'environment',
    options: [
      { name: '--base-dir <path>', description: 'Set TUXEDO_BASE_DIR for this run' },
      { name: '--workspace-count <n>', description: 'Set TUXEDO_WORKSPACE_COUNT for this run' },
    ],
  },
  syncCliAuth: {
    safetyClass: 'safe_write_remote',
    retrySafe: false,
    defaultTimeoutSeconds: 600,
    scriptPath: (repo) => path.join(repo, 'scripts', 'syncCliAuth.sh'),
    scriptType: 'shell',
    description: 'Sync local Claude/Codex auth credentials to remote host',
    category: 'operations',
    options: [
      { name: '--host <user@host>', description: 'Remote host destination', required: true },
      { name: '--confirm', description: 'Explicitly allow credential sync', required: true },
    ],
  },
  toggleAndroidKeyboard: {
    safetyClass: 'safe_write_local',
    retrySafe: true,
    defaultTimeoutSeconds: 120,
    scriptPath: (repo) => path.join(repo, 'scripts', 'toggleAndroidKeyboard.sh'),
    scriptType: 'shell',
    description: 'Toggle Android emulator software keyboard visibility',
    category: 'device',
  },
  tuxedo: {
    safetyClass: 'safe_write_local',
    retrySafe: false,
    defaultTimeoutSeconds: 1200,
    scriptPath: (repo) => path.join(repo, 'scripts', 'tuxedo.sh'),
    scriptType: 'shell',
    description: 'Launch tuxedo tmux workspace manager with explicit mode',
    category: 'operations',
    options: [
      {
        name: '--mode <default|no-pr-dashboards|no-screen>',
        description: 'Tuxedo launch mode',
        required: true,
      },
      { name: '--base-dir <path>', description: 'Set TUXEDO_BASE_DIR for this run' },
      { name: '--workspace-count <n>', description: 'Set TUXEDO_WORKSPACES for this run' },
    ],
  },
  tuxedoKill: {
    safetyClass: 'safe_write_local',
    retrySafe: true,
    defaultTimeoutSeconds: 300,
    scriptPath: (repo) => path.join(repo, 'scripts', 'tuxedoKill.sh'),
    scriptType: 'shell',
    description: 'Terminate tuxedo resources (scope flag required)',
    category: 'operations',
    options: [
      { name: '--scope <all>', description: 'Kill scope (currently only all)', required: true },
      { name: '--confirm', description: 'Explicitly allow tuxedo termination', required: true },
    ],
  },
  updateEverything: {
    safetyClass: 'safe_write_local',
    retrySafe: false,
    defaultTimeoutSeconds: 7200,
    scriptPath: (repo) => path.join(repo, 'scripts', 'updateEverything.sh'),
    scriptType: 'shell',
    description: 'Run repository-wide dependency and validation refresh',
    category: 'environment',
    options: [
      { name: '--mode <full|quick>', description: 'Execution profile', required: true },
      { name: '--confirm', description: 'Required when executing without --dry-run' },
    ],
  },
  verifyCleanIosBuild: {
    safetyClass: 'safe_write_local',
    retrySafe: true,
    defaultTimeoutSeconds: 1800,
    scriptPath: (repo) => path.join(repo, 'scripts', 'verifyCleanIosBuild.sh'),
    scriptType: 'shell',
    description: 'Clean iOS build artifacts and verify workspace cleanliness',
    category: 'device',
  },
  muteIosSimulatorAudio: {
    safetyClass: 'safe_write_local',
    retrySafe: true,
    defaultTimeoutSeconds: 120,
    scriptPath: (repo) => path.join(repo, 'scripts', 'muteIosSimulatorAudio.sh'),
    scriptType: 'shell',
    description: 'Mute iOS simulator audio output',
    category: 'device',
  },
};

// Actions used directly by preen/merge automation skills. The remaining actions
// are intentionally kept for manual operator workflows.
const SKILL_INVOKED_ACTIONS: readonly ActionName[] = ['ciImpact', 'runImpactedQuality', 'runImpactedTests'];

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
  cwd?: string,
  env?: NodeJS.ProcessEnv
): { stdout: string; stderr: string; exitCode: number } {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: timeoutMs,
    cwd,
    env: env ? { ...process.env, ...env } : undefined,
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

function quoteArg(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function escapeMarkdownTableCell(value: string): string {
  return value.replaceAll('|', '\\|');
}

function commandExists(command: string, cwd?: string): boolean {
  const check = runWithTimeout('sh', ['-lc', `command -v ${command} >/dev/null 2>&1`], 15_000, cwd);
  return check.exitCode === 0;
}

function ensureCommand(action: ActionName, command: string, cwd?: string): void {
  if (!commandExists(command, cwd)) {
    throw new Error(`${action} preflight failed: required command not found: ${command}`);
  }
}

function ensureMacOs(action: ActionName): void {
  if (process.platform !== 'darwin') {
    throw new Error(`${action} preflight failed: macOS is required`);
  }
}

function hasBootedAndroidEmulator(repoRoot: string): boolean {
  const result = runWithTimeout('adb', ['devices'], 15_000, repoRoot);
  if (result.exitCode !== 0) return false;

  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .some((line) => line.startsWith('emulator-') && line.endsWith('\tdevice'));
}

function hasBootedIosSimulator(repoRoot: string): boolean {
  const result = runWithTimeout('xcrun', ['simctl', 'list', 'devices'], 15_000, repoRoot);
  if (result.exitCode !== 0) return false;
  return result.stdout.includes('(Booted)');
}

function runPreflight(action: ActionName, opts: GlobalOptions, repoRoot: string): string[] {
  const checks: string[] = [];
  const addCheck = (message: string): void => {
    checks.push(`preflight: ${message}`);
  };

  switch (action) {
    case 'runAndroid':
      ensureCommand(action, 'adb', repoRoot);
      ensureCommand(action, 'emulator', repoRoot);
      ensureCommand(action, 'pnpm', repoRoot);
      addCheck('adb, emulator, and pnpm are available');
      break;

    case 'runIos':
    case 'runIpad':
      ensureMacOs(action);
      ensureCommand(action, 'xcrun', repoRoot);
      ensureCommand(action, 'pnpm', repoRoot);
      addCheck('macOS, xcrun, and pnpm are available');
      break;

    case 'runElectron':
      ensureCommand(action, 'pnpm', repoRoot);
      addCheck('pnpm is available');
      break;

    case 'runMaestroAndroidTests':
      ensureCommand(action, 'adb', repoRoot);
      ensureCommand(action, 'emulator', repoRoot);
      ensureCommand(action, 'pnpm', repoRoot);
      ensureCommand(action, 'bundle', repoRoot);
      addCheck('adb, emulator, pnpm, and bundle are available');
      break;

    case 'runMaestroIosTests':
      ensureMacOs(action);
      ensureCommand(action, 'xcrun', repoRoot);
      ensureCommand(action, 'pnpm', repoRoot);
      ensureCommand(action, 'bundle', repoRoot);
      addCheck('macOS, xcrun, pnpm, and bundle are available');
      break;

    case 'verifyCleanIosBuild':
    case 'muteIosSimulatorAudio':
      ensureMacOs(action);
      ensureCommand(action, 'xcrun', repoRoot);
      addCheck('macOS and xcrun are available');
      break;

    case 'copyTestFilesIos':
      ensureMacOs(action);
      ensureCommand(action, 'xcrun', repoRoot);
      if (!hasBootedIosSimulator(repoRoot)) {
        throw new Error(`${action} preflight failed: no booted iOS simulator detected`);
      }
      addCheck('booted iOS simulator detected');
      break;

    case 'toggleAndroidKeyboard':
    case 'copyTestFilesAndroid':
      ensureCommand(action, 'adb', repoRoot);
      if (!hasBootedAndroidEmulator(repoRoot)) {
        throw new Error(`${action} preflight failed: no booted Android emulator detected`);
      }
      addCheck('booted Android emulator detected');
      break;

    case 'setupPostgresDev':
      ensureMacOs(action);
      ensureCommand(action, 'brew', repoRoot);
      addCheck('macOS and Homebrew are available');
      break;

    case 'setupSerenaMcp':
      ensureCommand(action, 'codex', repoRoot);
      ensureCommand(action, 'claude', repoRoot);
      ensureCommand(action, 'git', repoRoot);
      if (!commandExists('uvx', repoRoot) && !commandExists('pyenv', repoRoot)) {
        throw new Error(`${action} preflight failed: uvx or pyenv must be installed`);
      }
      addCheck('codex/claude/git and uvx-or-pyenv are available');
      break;

    case 'setupTuxedoRepos':
      ensureCommand(action, 'git', repoRoot);
      addCheck('git is available');
      break;

    case 'updateEverything':
      ensureCommand(action, 'git', repoRoot);
      ensureCommand(action, 'pnpm', repoRoot);
      ensureCommand(action, 'jq', repoRoot);
      if (opts.mode === 'full') {
        ensureCommand(action, 'bundle', repoRoot);
      }
      addCheck('git/pnpm/jq preflight passed');
      break;

    case 'syncCliAuth':
      ensureMacOs(action);
      ensureCommand(action, 'ssh', repoRoot);
      ensureCommand(action, 'scp', repoRoot);
      ensureCommand(action, 'security', repoRoot);
      addCheck('macOS keychain + ssh/scp are available');
      break;

    case 'tuxedo':
      ensureCommand(action, 'tmux', repoRoot);
      addCheck('tmux is available');
      break;

    case 'tuxedoKill':
      addCheck('explicit kill scope and confirmation provided');
      break;

    case 'analyzeBundle':
    case 'checkBinaryFiles':
    case 'ciImpact':
    case 'runImpactedQuality':
    case 'runImpactedTests':
    case 'runAllTests':
    case 'runElectronTests':
    case 'runPlaywrightTests':
    case 'verifyFileGuardrails':
      // Existing wrappers with bounded behavior; no additional preflight.
      break;
  }

  return checks;
}

// ============================================================================
// Script Execution
// ============================================================================

interface ScriptArgs {
  base?: string;
  baseDir?: string;
  bundleId?: string;
  device?: string;
  flow?: string;
  head?: string;
  headless?: boolean;
  staged?: boolean;
  fromUpstream?: boolean;
  headed?: boolean;
  filter?: string;
  file?: string;
  host?: string;
  mode?: 'full' | 'quick' | 'default' | 'no-pr-dashboards' | 'no-screen';
  recordVideo?: boolean;
  scriptDryRun?: boolean;
  videoSeconds?: number;
  workspaceCount?: number;
}

interface ScriptInvocation {
  args: string[];
  env: NodeJS.ProcessEnv;
}

function buildScriptInvocation(action: ActionName, options: ScriptArgs): ScriptInvocation {
  const args: string[] = [];
  const env: NodeJS.ProcessEnv = {};

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

    case 'runIos':
      if (options.device) args.push(options.device);
      break;

    case 'copyTestFilesIos':
      if (options.bundleId) args.push(options.bundleId);
      break;

    case 'runMaestroAndroidTests':
      if (options.headless) args.push('--headless');
      if (options.recordVideo) args.push('--record-video');
      if (options.videoSeconds !== undefined) args.push('--video-seconds', String(options.videoSeconds));
      if (options.flow) args.push(options.flow);
      break;

    case 'runMaestroIosTests':
      if (options.headless) args.push('--headless');
      if (options.recordVideo) args.push('--record-video');
      if (options.flow) args.push(options.flow);
      break;

    case 'setupSerenaMcp':
      if (options.scriptDryRun) args.push('--dry-run');
      break;

    case 'setupTuxedoRepos':
      if (options.baseDir) env.TUXEDO_BASE_DIR = options.baseDir;
      // setupTuxedoRepos.sh reads TUXEDO_WORKSPACE_COUNT.
      if (options.workspaceCount !== undefined) env.TUXEDO_WORKSPACE_COUNT = String(options.workspaceCount);
      break;

    case 'updateEverything':
      if (options.mode === 'quick') {
        env.SKIP_MAESTRO = '1';
        env.SKIP_POD_CLEAN = '1';
        env.SKIP_RUBY = '1';
        env.SKIP_TESTS = '1';
        env.SKIP_BUILD = '1';
        env.SKIP_LINT = '1';
      }
      break;

    case 'syncCliAuth':
      if (options.host) args.push(options.host);
      break;

    case 'tuxedo':
      if (options.baseDir) env.TUXEDO_BASE_DIR = options.baseDir;
      // tuxedo/tuxedo.sh reads TUXEDO_WORKSPACES.
      if (options.workspaceCount !== undefined) env.TUXEDO_WORKSPACES = String(options.workspaceCount);
      if (options.mode === 'no-pr-dashboards') {
        env.TUXEDO_ENABLE_PR_DASHBOARDS = '0';
      } else if (options.mode === 'no-screen') {
        env.TUXEDO_FORCE_NO_SCREEN = '1';
      }
      break;

    case 'analyzeBundle':
    case 'verifyFileGuardrails':
    case 'copyTestFilesAndroid':
    case 'runAndroid':
    case 'runIpad':
    case 'runElectron':
    case 'setupPostgresDev':
    case 'toggleAndroidKeyboard':
    case 'tuxedoKill':
    case 'verifyCleanIosBuild':
    case 'muteIosSimulatorAudio':
      // No action-specific args/env.
      break;

    case 'runElectronTests':
    case 'runPlaywrightTests':
      if (options.headed) args.push('--headed');
      if (options.filter) args.push('-g', options.filter);
      if (options.file) args.push(options.file);
      break;
  }

  return { args, env };
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

  const invocation = buildScriptInvocation(action, options);

  if (config.scriptType === 'typescript') {
    // Run TypeScript files through pnpm exec tsx
    return runWithTimeout(
      'pnpm',
      ['exec', 'tsx', scriptPath, ...invocation.args],
      timeoutMs,
      repoRoot,
      invocation.env
    );
  }

  // Run shell scripts directly
  return runWithTimeout(scriptPath, invocation.args, timeoutMs, repoRoot, invocation.env);
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
      cmd.option('--script-dry-run', 'Pass through --dry-run to setupSerenaMcp.sh');
      break;

    case 'setupTuxedoRepos':
      cmd
        .option('--base-dir <path>', 'TUXEDO_BASE_DIR override')
        .option('--workspace-count <n>', 'TUXEDO_WORKSPACE_COUNT override', (v) =>
          parsePositiveInt(v, '--workspace-count')
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
            console.error('error: updateEverything requires --confirm unless --dry-run is set');
            process.exit(1);
          }
        });
      break;

    case 'tuxedo':
      cmd
        .requiredOption('--mode <default|no-pr-dashboards|no-screen>', 'Launch mode', (v) => {
          if (v === 'default' || v === 'no-pr-dashboards' || v === 'no-screen') return v;
          throw new InvalidArgumentError('--mode must be default, no-pr-dashboards, or no-screen');
        })
        .option('--base-dir <path>', 'TUXEDO_BASE_DIR override')
        .option('--workspace-count <n>', 'TUXEDO_WORKSPACES override', (v) =>
          parsePositiveInt(v, '--workspace-count')
        );
      break;

    case 'tuxedoKill':
      cmd
        .requiredOption('--scope <all>', 'Kill scope', (v) => {
          if (v === 'all') return v;
          throw new InvalidArgumentError('--scope currently supports only "all"');
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
      const timeoutMs = (opts.timeoutSeconds ?? config.defaultTimeoutSeconds) * 1000;
      const scriptPath = config.scriptPath(repoRoot);
      const invocation = buildScriptInvocation(actionName, opts);
      const envEntries = Object.entries(invocation.env);
      const renderedArgs = invocation.args.map((arg) => quoteArg(arg)).join(' ');
      const renderedCommand = renderedArgs.length > 0 ? `${scriptPath} ${renderedArgs}` : scriptPath;
      const renderedEnv =
        envEntries.length > 0
          ? envEntries.map(([key, value]) => `${key}=${quoteArg(String(value))}`).join(' ')
          : '(none)';

      if (opts.dryRun) {
        output = [
          `dry-run: would run ${renderedCommand}`,
          `repo-root: ${repoRoot}`,
          `env: ${renderedEnv}`,
          'preflight: skipped in dry-run mode',
        ].join('\n');
      } else {
        const preflightLines = runPreflight(actionName, opts, repoRoot);
        const result = runScript(actionName, opts, repoRoot, timeoutMs);
        const combinedOutput = result.stdout + result.stderr;
        output = [...preflightLines, combinedOutput].filter((line) => line.trim().length > 0).join('\n');
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
    device: [],
    environment: [],
    operations: [],
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
    device: 'Device',
    environment: 'Environment',
    operations: 'Operations',
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

  // Skill coverage section
  const manualOnlyActions = (Object.keys(ACTION_CONFIG) as ActionName[]).filter(
    (actionName) => !SKILL_INVOKED_ACTIONS.includes(actionName)
  );
  lines.push('## Skill Coverage');
  lines.push('');
  lines.push('Automation skills currently invoke a focused subset of wrappers:');
  lines.push('');
  lines.push(`- Skill-invoked: ${SKILL_INVOKED_ACTIONS.map((action) => `\`${action}\``).join(', ')}`);
  lines.push(`- Manual-only: ${manualOnlyActions.map((action) => `\`${action}\``).join(', ')}`);
  lines.push('');

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
      lines.push(
        `| \`${escapeMarkdownTableCell(opt.name)}\` | ${escapeMarkdownTableCell(opt.description)} | ${opt.required ? 'Yes' : 'No'} |`
      );
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
  lines.push('- `safe_read`: read-only checks and analysis (no local/remote mutations)');
  lines.push('- `safe_write_local`: mutates local workspace/device state only');
  lines.push('- `safe_write_remote`: may mutate remote systems/accounts and requires explicit confirmation');
  lines.push('');
  lines.push('| Class | Actions |');
  lines.push('| ----- | ------- |');

  const safetyGroups: Record<SafetyClass, ActionName[]> = {
    safe_read: [],
    safe_write_local: [],
    safe_write_remote: [],
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
  lines.push('# Run iOS launch wrapper with explicit simulator');
  lines.push('./scripts/tooling/scriptTool.ts runIos --device "iPhone 16 Pro" --dry-run --json');
  lines.push('');
  lines.push('# Preview update-everything quick mode');
  lines.push('./scripts/tooling/scriptTool.ts updateEverything --mode quick --dry-run --json');
  lines.push('');
  lines.push('# Sync CLI auth (requires explicit confirmation)');
  lines.push('./scripts/tooling/scriptTool.ts syncCliAuth --host ubuntu@tuxedo.example.com --confirm');
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
