import path from 'node:path';
import type { ActionConfig, ActionName } from './scriptToolTypes.ts';

export const ACTION_CONFIG: Record<ActionName, ActionConfig> = {
  analyzeBundle: {
    safetyClass: 'safe_write_local',
    retrySafe: true,
    defaultTimeoutSeconds: 600,
    scriptPath: (repo) => path.join(repo, 'scripts', 'analyzeBundle.sh'),
    scriptType: 'shell',
    description: 'Build and open bundle analysis report',
    category: 'analysis'
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
      {
        name: '--from-upstream',
        description: 'Check files changed from upstream'
      }
    ]
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
      {
        name: '--base <sha>',
        description: 'Base commit for diff',
        required: true
      },
      {
        name: '--head <sha>',
        description: 'Head commit for diff',
        required: true
      }
    ]
  },
  copyTestFilesAndroid: {
    safetyClass: 'safe_write_local',
    retrySafe: true,
    defaultTimeoutSeconds: 300,
    scriptPath: (repo) => path.join(repo, 'scripts', 'copyTestFilesAndroid.sh'),
    scriptType: 'shell',
    description: 'Copy .test_files payload into Android emulator storage',
    category: 'device'
  },
  copyTestFilesIos: {
    safetyClass: 'safe_write_local',
    retrySafe: true,
    defaultTimeoutSeconds: 300,
    scriptPath: (repo) => path.join(repo, 'scripts', 'copyTestFilesIos.sh'),
    scriptType: 'shell',
    description: 'Copy .test_files payload into iOS simulator app container',
    category: 'device',
    options: [
      {
        name: '--bundle-id <id>',
        description: 'Bundle ID (default: com.tearleads.app)'
      }
    ]
  },
  runImpactedQuality: {
    safetyClass: 'safe_write_local',
    retrySafe: false,
    defaultTimeoutSeconds: 300,
    scriptPath: (repo) =>
      path.join(repo, 'scripts', 'ciImpact', 'runImpactedQuality.ts'),
    scriptType: 'typescript',
    description: 'Run quality checks on impacted files only',
    category: 'quality',
    options: [
      {
        name: '--base <sha>',
        description: 'Base commit for diff',
        required: true
      },
      {
        name: '--head <sha>',
        description: 'Head commit for diff',
        required: true
      }
    ]
  },
  runImpactedTests: {
    safetyClass: 'safe_write_local',
    retrySafe: false,
    defaultTimeoutSeconds: 300,
    scriptPath: (repo) =>
      path.join(repo, 'scripts', 'ciImpact', 'runImpactedTests.ts'),
    scriptType: 'typescript',
    description: 'Run impacted ciImpact script tests and coverage tests',
    category: 'testing',
    options: [
      {
        name: '--base <sha>',
        description: 'Base commit for diff',
        required: true
      },
      {
        name: '--head <sha>',
        description: 'Head commit for diff',
        required: true
      },
      {
        name: '--scripts-only',
        description: 'Run only impacted ciImpact script tests'
      }
    ]
  },
  runAllTests: {
    safetyClass: 'safe_write_local',
    retrySafe: false,
    defaultTimeoutSeconds: 3600,
    scriptPath: (repo) => path.join(repo, 'scripts', 'runAllTests.sh'),
    scriptType: 'shell',
    description: 'Run full test suite (lint, build, unit, e2e)',
    category: 'testing',
    options: [
      { name: '--headed', description: 'Run tests with visible browser' }
    ]
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
      { name: '--file <path>', description: 'Specific test file' }
    ]
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
      { name: '--file <path>', description: 'Specific test file' }
    ]
  },
  verifyFileGuardrails: {
    safetyClass: 'safe_read',
    retrySafe: true,
    defaultTimeoutSeconds: 300,
    scriptPath: (repo) => path.join(repo, 'scripts', 'verifyFileGuardrails.sh'),
    scriptType: 'shell',
    description: 'Verify file guardrail configuration',
    category: 'analysis'
  },
  runAndroid: {
    safetyClass: 'safe_write_local',
    retrySafe: false,
    defaultTimeoutSeconds: 5400,
    scriptPath: (repo) => path.join(repo, 'scripts', 'runAndroid.sh'),
    scriptType: 'shell',
    description: 'Build/sync and run Android app on emulator',
    category: 'device'
  },
  runIos: {
    safetyClass: 'safe_write_local',
    retrySafe: false,
    defaultTimeoutSeconds: 5400,
    scriptPath: (repo) => path.join(repo, 'scripts', 'runIos.sh'),
    scriptType: 'shell',
    description: 'Build/sync and run iOS app on simulator',
    category: 'device',
    options: [{ name: '--device <name>', description: 'Simulator device name' }]
  },
  runIpad: {
    safetyClass: 'safe_write_local',
    retrySafe: false,
    defaultTimeoutSeconds: 5400,
    scriptPath: (repo) => path.join(repo, 'scripts', 'runIpad.sh'),
    scriptType: 'shell',
    description: 'Build/sync and run iOS app on iPad simulator',
    category: 'device'
  },
  runElectron: {
    safetyClass: 'safe_write_local',
    retrySafe: false,
    defaultTimeoutSeconds: 3600,
    scriptPath: (repo) => path.join(repo, 'scripts', 'runElectron.sh'),
    scriptType: 'shell',
    description: 'Start Electron development runtime',
    category: 'device'
  },
  runMaestroAndroidTests: {
    safetyClass: 'safe_write_local',
    retrySafe: false,
    defaultTimeoutSeconds: 3600,
    scriptPath: (repo) =>
      path.join(repo, 'scripts', 'runMaestroAndroidTests.sh'),
    scriptType: 'shell',
    description: 'Run Maestro Android flows via Fastlane',
    category: 'testing',
    options: [
      { name: '--headless', description: 'Run emulator without UI' },
      { name: '--flow <path>', description: 'Flow file path to execute' },
      { name: '--record-video', description: 'Enable Maestro video recording' },
      { name: '--video-seconds <n>', description: 'Video duration in seconds' }
    ]
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
      { name: '--record-video', description: 'Enable Maestro video recording' }
    ]
  },
  setupPostgresDev: {
    safetyClass: 'safe_write_local',
    retrySafe: true,
    defaultTimeoutSeconds: 1200,
    scriptPath: (repo) => path.join(repo, 'scripts', 'setupPostgresDev.sh'),
    scriptType: 'shell',
    description: 'Install/start Homebrew PostgreSQL and provision dev DB',
    category: 'environment'
  },
  setupSerenaMcp: {
    safetyClass: 'safe_write_local',
    retrySafe: true,
    defaultTimeoutSeconds: 600,
    scriptPath: (repo) => path.join(repo, 'scripts', 'setupSerenaMcp.sh'),
    scriptType: 'shell',
    description: 'Configure Serena MCP server for Codex and Claude',
    category: 'environment',
    options: [
      {
        name: '--script-dry-run',
        description: 'Pass through --dry-run to setupSerenaMcp.sh'
      }
    ]
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
      {
        name: '--base-dir <path>',
        description: 'Set TUXEDO_BASE_DIR for this run'
      },
      {
        name: '--workspace-count <n>',
        description: 'Set TUXEDO_WORKSPACE_COUNT for this run'
      }
    ]
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
      {
        name: '--host <user@host>',
        description: 'Remote host destination',
        required: true
      },
      {
        name: '--confirm',
        description: 'Explicitly allow credential sync',
        required: true
      }
    ]
  },
  toggleAndroidKeyboard: {
    safetyClass: 'safe_write_local',
    retrySafe: true,
    defaultTimeoutSeconds: 120,
    scriptPath: (repo) =>
      path.join(repo, 'scripts', 'toggleAndroidKeyboard.sh'),
    scriptType: 'shell',
    description: 'Toggle Android emulator software keyboard visibility',
    category: 'device'
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
        required: true
      },
      {
        name: '--base-dir <path>',
        description: 'Set TUXEDO_BASE_DIR for this run'
      },
      {
        name: '--workspace-count <n>',
        description: 'Set TUXEDO_WORKSPACES for this run'
      }
    ]
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
      {
        name: '--scope <all>',
        description: 'Kill scope (currently only all)',
        required: true
      },
      {
        name: '--confirm',
        description: 'Explicitly allow tuxedo termination',
        required: true
      }
    ]
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
      {
        name: '--mode <full|quick>',
        description: 'Execution profile',
        required: true
      },
      {
        name: '--confirm',
        description: 'Required when executing without --dry-run'
      }
    ]
  },
  verifyCleanIosBuild: {
    safetyClass: 'safe_write_local',
    retrySafe: true,
    defaultTimeoutSeconds: 1800,
    scriptPath: (repo) => path.join(repo, 'scripts', 'verifyCleanIosBuild.sh'),
    scriptType: 'shell',
    description: 'Clean iOS build artifacts and verify workspace cleanliness',
    category: 'device'
  },
  muteIosSimulatorAudio: {
    safetyClass: 'safe_write_local',
    retrySafe: true,
    defaultTimeoutSeconds: 120,
    scriptPath: (repo) =>
      path.join(repo, 'scripts', 'muteIosSimulatorAudio.sh'),
    scriptType: 'shell',
    description: 'Mute iOS simulator audio output',
    category: 'device'
  }
};

// Actions used directly by preen/merge automation skills. The remaining actions
// are intentionally kept for manual operator workflows.
export const SKILL_INVOKED_ACTIONS: readonly ActionName[] = [
  'ciImpact',
  'runImpactedQuality',
  'runImpactedTests'
];
