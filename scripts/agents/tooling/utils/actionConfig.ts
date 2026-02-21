import path from 'node:path';
import type { ActionConfig, ActionName } from '../types.ts';

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const AGENTS_DIR = path.dirname(path.dirname(SCRIPT_DIR));

export const ACTION_CONFIG: Record<ActionName, ActionConfig> = {
  getRepo: {
    safetyClass: 'safe_read',
    retrySafe: true,
    isInline: true
  },
  getGitContext: {
    safetyClass: 'safe_read',
    retrySafe: true,
    isInline: true
  },
  getDefaultBranch: {
    safetyClass: 'safe_read',
    retrySafe: true,
    isInline: true
  },
  checkMainVersionBumpSetup: {
    safetyClass: 'safe_read',
    retrySafe: true,
    isInline: true
  },
  refresh: {
    safetyClass: 'safe_write_local',
    retrySafe: false,
    isInline: false,
    scriptPath: (_repo, agents) => path.join(agents, 'refresh.sh')
  },
  syncToolchainVersions: {
    safetyClass: 'safe_write_local',
    retrySafe: true,
    isInline: false,
    scriptPath: (repo) => path.join(repo, 'scripts', 'syncToolchainVersions.sh')
  },
  setVscodeTitle: {
    safetyClass: 'safe_write_local',
    retrySafe: true,
    isInline: false,
    scriptPath: (_repo, agents) => path.join(agents, 'setVscodeTitle.ts')
  },
  solicitCodexReview: {
    safetyClass: 'safe_read',
    retrySafe: true,
    isInline: false,
    scriptPath: (repo) => path.join(repo, 'scripts', 'solicitCodexReview.ts')
  },
  solicitClaudeCodeReview: {
    safetyClass: 'safe_read',
    retrySafe: true,
    isInline: false,
    scriptPath: (repo) =>
      path.join(repo, 'scripts', 'solicitClaudeCodeReview.ts')
  },
  addLabel: {
    safetyClass: 'safe_write_remote',
    retrySafe: true,
    isInline: true
  },
  approveSkippedChecks: {
    safetyClass: 'safe_write_remote',
    retrySafe: true,
    isInline: false,
    scriptPath: (repo) => path.join(repo, 'scripts', 'approveSkippedChecks.ts')
  },
  tagPrWithTuxedoInstance: {
    safetyClass: 'safe_write_remote',
    retrySafe: true,
    isInline: true
  },
  getPrInfo: { safetyClass: 'safe_read', retrySafe: true, isInline: true },
  getPrChecks: { safetyClass: 'safe_read', retrySafe: true, isInline: true },
  getRequiredChecksStatus: {
    safetyClass: 'safe_read',
    retrySafe: true,
    isInline: true
  },
  getReviewThreads: {
    safetyClass: 'safe_read',
    retrySafe: true,
    isInline: true
  },
  replyToComment: {
    safetyClass: 'safe_write_remote',
    retrySafe: true,
    isInline: true
  },
  replyToGemini: {
    safetyClass: 'safe_write_remote',
    retrySafe: true,
    isInline: true
  },
  resolveThread: {
    safetyClass: 'safe_write_remote',
    retrySafe: true,
    isInline: true
  },
  getCiStatus: { safetyClass: 'safe_read', retrySafe: true, isInline: true },
  cancelWorkflow: {
    safetyClass: 'safe_write_remote',
    retrySafe: true,
    isInline: true
  },
  rerunWorkflow: {
    safetyClass: 'safe_write_remote',
    retrySafe: true,
    isInline: true
  },
  downloadArtifact: {
    safetyClass: 'safe_write_local',
    retrySafe: true,
    isInline: true
  },
  enableAutoMerge: {
    safetyClass: 'safe_write_remote',
    retrySafe: true,
    isInline: true
  },
  findPrForBranch: {
    safetyClass: 'safe_read',
    retrySafe: true,
    isInline: true
  },
  listHighPriorityPrs: {
    safetyClass: 'safe_read',
    retrySafe: true,
    isInline: true
  },
  triggerGeminiReview: {
    safetyClass: 'safe_write_remote',
    retrySafe: true,
    isInline: true
  },
  checkGeminiQuota: {
    safetyClass: 'safe_read',
    retrySafe: true,
    isInline: true
  },
  findDeferredWork: {
    safetyClass: 'safe_read',
    retrySafe: true,
    isInline: true
  },
  listDeferredFixIssues: {
    safetyClass: 'safe_read',
    retrySafe: true,
    isInline: true
  },
  getIssue: {
    safetyClass: 'safe_read',
    retrySafe: true,
    isInline: true
  },
  runPreen: {
    safetyClass: 'safe_write_local',
    retrySafe: false,
    isInline: false,
    scriptPath: (repo) => path.join(repo, 'scripts', 'preen', 'runPreen.sh')
  },
  runTerraformStackScript: {
    safetyClass: 'safe_write_remote',
    retrySafe: false,
    isInline: true
  },
  runAnsibleBootstrap: {
    safetyClass: 'safe_write_remote',
    retrySafe: false,
    isInline: true
  },
  issueTemplate: {
    safetyClass: 'safe_read',
    retrySafe: true,
    isInline: true
  },
  createIssue: {
    safetyClass: 'safe_write_remote',
    retrySafe: true,
    isInline: true
  },
  createPr: {
    safetyClass: 'safe_write_remote',
    retrySafe: true,
    isInline: true
  },
  generatePrSummary: {
    safetyClass: 'safe_read',
    retrySafe: true,
    isInline: true
  },
  verifyBranchPush: {
    safetyClass: 'safe_read',
    retrySafe: true,
    isInline: true
  },
  sanitizePrBody: {
    safetyClass: 'safe_write_remote',
    retrySafe: true,
    isInline: true
  },
  createDeferredFixIssue: {
    safetyClass: 'safe_write_remote',
    retrySafe: true,
    isInline: true
  },
  updatePrBody: {
    safetyClass: 'safe_write_remote',
    retrySafe: true,
    isInline: true
  }
};

export const ACTION_NAMES = Object.keys(ACTION_CONFIG) as ActionName[];
export const AGENTS_DIR_PATH = AGENTS_DIR;
