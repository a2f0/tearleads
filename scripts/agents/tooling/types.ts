export type SafetyClass =
  | 'safe_read'
  | 'safe_write_local'
  | 'safe_write_remote';

export type ActionName =
  | 'getRepo'
  | 'refresh'
  | 'syncToolchainVersions'
  | 'setVscodeTitle'
  | 'solicitCodexReview'
  | 'solicitClaudeCodeReview'
  | 'addLabel'
  | 'approveSkippedChecks'
  | 'tagPrWithTuxedoInstance'
  | 'getPrInfo'
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
  | 'findDeferredWork'
  | 'runPreen'
  | 'issueTemplate'
  | 'createIssue'
  | 'generatePrSummary';

export interface GlobalOptions {
  apply?: boolean;
  check?: boolean;
  skipNode?: boolean;
  skipAndroid?: boolean;
  maxAndroidJump?: number;
  title?: string;
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
  state?: 'open' | 'merged';
  mode?: 'full' | 'single' | 'security' | 'audit';
  pollTimeout?: number;
  timeoutSeconds?: number;
  repoRoot?: string;
  dryRun?: boolean;
  json?: boolean;
  pr?: number;
  search?: string;
  sourcePr?: number;
  reviewThreadUrl?: string;
  force?: boolean;
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
