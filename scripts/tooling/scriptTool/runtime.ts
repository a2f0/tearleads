import { existsSync } from 'node:fs';
import { runWithTimeout } from '../lib/cliShared.ts';
import { ACTION_CONFIG } from './actionConfig.ts';
import type {
  ActionName,
  GlobalOptions,
  ScriptArgs,
  ScriptInvocation
} from './types.ts';

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
      // tuxedo/setupTuxedoRepos.sh reads TUXEDO_WORKSPACE_COUNT.
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
