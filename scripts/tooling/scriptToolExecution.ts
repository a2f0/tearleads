import { existsSync } from 'node:fs';
import { runWithTimeout } from './lib/cliShared.ts';
import { ACTION_CONFIG } from './scriptToolConfig.ts';
import type {
  ActionName,
  GlobalOptions,
  ScriptArgs,
  ScriptInvocation
} from './scriptToolTypes.ts';

export function quoteArg(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function commandExists(command: string, cwd?: string): boolean {
  const check = runWithTimeout(
    'sh',
    ['-lc', `command -v ${command} >/dev/null 2>&1`],
    15_000,
    cwd
  );
  return check.exitCode === 0;
}

function ensureCommand(
  action: ActionName,
  command: string,
  cwd?: string
): void {
  if (!commandExists(command, cwd)) {
    throw new Error(
      `${action} preflight failed: required command not found: ${command}`
    );
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
  const result = runWithTimeout(
    'xcrun',
    ['simctl', 'list', 'devices'],
    15_000,
    repoRoot
  );
  if (result.exitCode !== 0) return false;
  return result.stdout.includes('(Booted)');
}

export function runPreflight(
  action: ActionName,
  opts: GlobalOptions,
  repoRoot: string
): string[] {
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
        throw new Error(
          `${action} preflight failed: no booted iOS simulator detected`
        );
      }
      addCheck('booted iOS simulator detected');
      break;

    case 'toggleAndroidKeyboard':
    case 'copyTestFilesAndroid':
      ensureCommand(action, 'adb', repoRoot);
      if (!hasBootedAndroidEmulator(repoRoot)) {
        throw new Error(
          `${action} preflight failed: no booted Android emulator detected`
        );
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
      if (
        !commandExists('uvx', repoRoot) &&
        !commandExists('pyenv', repoRoot)
      ) {
        throw new Error(
          `${action} preflight failed: uvx or pyenv must be installed`
        );
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

export function buildScriptInvocation(
  action: ActionName,
  options: ScriptArgs
): ScriptInvocation {
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
      if (options.base) args.push('--base', options.base);
      if (options.head) args.push('--head', options.head);
      break;

    case 'runImpactedTests':
      if (options.base) args.push('--base', options.base);
      if (options.head) args.push('--head', options.head);
      if (options.scriptsOnly) args.push('--scripts-only');
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
      if (options.videoSeconds !== undefined)
        args.push('--video-seconds', String(options.videoSeconds));
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
      if (options.workspaceCount !== undefined)
        env.TUXEDO_WORKSPACE_COUNT = String(options.workspaceCount);
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
      if (options.workspaceCount !== undefined)
        env.TUXEDO_WORKSPACES = String(options.workspaceCount);
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

export function runScript(
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
  return runWithTimeout(
    scriptPath,
    invocation.args,
    timeoutMs,
    repoRoot,
    invocation.env
  );
}
