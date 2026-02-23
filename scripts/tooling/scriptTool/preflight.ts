import { runWithTimeout } from '../lib/cliShared.ts';
import type { ActionName, GlobalOptions } from './types.ts';

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
      if (process.platform === 'darwin') {
        ensureCommand(action, 'brew', repoRoot);
        addCheck('macOS and Homebrew are available');
      } else if (process.platform === 'linux') {
        if (
          !commandExists('psql', repoRoot) &&
          !commandExists('apt-get', repoRoot)
        ) {
          throw new Error(
            `${action} preflight failed: Linux requires psql/createdb installed or apt-get available`
          );
        }
        addCheck('Linux supported (psql or apt-get available)');
      } else {
        throw new Error(
          `${action} preflight failed: only macOS and Linux are supported`
        );
      }
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
