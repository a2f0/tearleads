export type SafetyClass =
  | 'safe_read'
  | 'safe_write_local'
  | 'safe_write_remote';

export type ActionName =
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
  | 'verifyFileGuardrails'
  | 'muteIosSimulatorAudio';

export interface GlobalOptions {
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
  scriptsOnly?: boolean;
  scriptDryRun?: boolean;
  timeoutSeconds?: number;
  repoRoot?: string;
  dryRun?: boolean;
  videoSeconds?: number;
  workspaceCount?: number;
  json?: boolean;
}

export interface ActionOption {
  name: string;
  description: string;
  required?: boolean;
}

export interface ActionConfig {
  safetyClass: SafetyClass;
  retrySafe: boolean;
  defaultTimeoutSeconds: number;
  scriptPath: (repoRoot: string) => string;
  scriptType: 'shell' | 'typescript';
  description: string;
  category:
    | 'analysis'
    | 'quality'
    | 'testing'
    | 'environment'
    | 'device'
    | 'operations';
  options?: ActionOption[];
}

export interface JsonOutput {
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

export interface ScriptArgs {
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
  scriptsOnly?: boolean;
  scriptDryRun?: boolean;
  videoSeconds?: number;
  workspaceCount?: number;
}

export interface ScriptInvocation {
  args: string[];
  env: NodeJS.ProcessEnv;
}
