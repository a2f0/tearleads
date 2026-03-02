export type SafetyClass =
  | 'safe_read'
  | 'safe_write_local'
  | 'safe_write_remote';

export type ActionName =
  | 'getRepo'
  | 'checkMainVersionBumpSetup'
  | 'refresh'
  | 'syncToolchainVersions'
  | 'setVscodeTitle'
  | 'solicitCodexReview'
  | 'solicitClaudeCodeReview'
  | 'addLabel'
  | 'approveSkippedChecks'
  | 'tagPrWithTuxedoInstance'
  | 'tagPrWithReviewer'
  | 'getGitContext'
  | 'getDefaultBranch'
  | 'getPrInfo'
  | 'getPrChecks'
  | 'getRequiredChecksStatus'
  | 'getReviewThreads'
  | 'replyToComment'
  | 'replyToGemini'
  | 'resolveThread'
  | 'getCiStatus'
  | 'cancelWorkflow'
  | 'rerunWorkflow'
  | 'downloadArtifact'
  | 'enableAutoMerge'
  | 'findPrForBranch'
  | 'listHighPriorityPrs'
  | 'triggerGeminiReview'
  | 'checkGeminiQuota'
  | 'findDeferredWork'
  | 'listDeferredFixIssues'
  | 'getIssue'
  | 'listDependabotAlerts'
  | 'getDependabotAlert'
  | 'updateDependabotAlert'
  | 'listCodeScanningAlerts'
  | 'getCodeScanningAlert'
  | 'updateCodeScanningAlert'
  | 'listSecretScanningAlerts'
  | 'getSecretScanningAlert'
  | 'updateSecretScanningAlert'
  | 'runPreen'
  | 'runTerraformStackScript'
  | 'runAnsibleBootstrap'
  | 'issueTemplate'
  | 'createIssue'
  | 'createPr'
  | 'generatePrSummary'
  | 'verifyBranchPush'
  | 'sanitizePrBody'
  | 'createDeferredFixIssue'
  | 'updatePrBody';

export interface GlobalOptions {
  keyFile?: string;
  apply?: boolean;
  check?: boolean;
  skipNode?: boolean;
  skipAndroid?: boolean;
  maxAndroidJump?: number;
  title?: string;
  base?: string;
  head?: string;
  type?: 'pr' | 'issue' | 'user-requested' | 'deferred-fix';
  number?: number;
  label?: string;
  fields?: string;
  unresolvedOnly?: boolean;
  commentId?: string;
  body?: string;
  threadId?: string;
  commit?: string;
  runId?: string;
  artifact?: string;
  dest?: string;
  branch?: string;
  state?: string;
  mode?: 'aggressive' | 'full' | 'single' | 'security' | 'audit';
  passive?: boolean;
  pollTimeout?: number;
  timeoutSeconds?: number;
  repoRoot?: string;
  dryRun?: boolean;
  draft?: boolean;
  json?: boolean;
  pr?: number;
  reviewer?: string;
  search?: string;
  sourcePr?: number;
  scope?: 'development' | 'runtime';
  reviewThreadUrl?: string;
  force?: boolean;
  deferredItemsJson?: string;
  prUrl?: string;
  bodyFile?: string;
  quotaMessage?: string;
  limit?: number;
  alertNumber?: number;
  severity?: string;
  ecosystem?: string;
  package?: string;
  manifest?: string;
  sort?: string;
  direction?: 'asc' | 'desc';
  perPage?: number;
  dismissedReason?: string;
  dismissedComment?: string;
  toolName?: string;
  ref?: string;
  secretType?: string;
  resolution?: string;
  resolutionComment?: string;
  stack?: string;
  script?: string;
  target?: string;
  yes?: boolean;
}

export interface ActionConfig {
  safetyClass: SafetyClass;
  retrySafe: boolean;
  isInline: boolean;
  scriptPath?: (repoRoot: string, agentsDir: string) => string;
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
  'window.title'?: string;
}
