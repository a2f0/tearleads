import type { RestEndpointMethodTypes } from '@octokit/rest';
import type { GitHubClientContext } from './githubClient.ts';

type CodeScanningAlert =
  RestEndpointMethodTypes['codeScanning']['getAlert']['response']['data'];
type CodeScanningAlertSummary =
  RestEndpointMethodTypes['codeScanning']['listAlertsForRepo']['response']['data'][number];

type CodeScanningUpdateState = 'open' | 'dismissed';
type CodeScanningListState = 'open' | 'dismissed' | 'fixed';
type CodeScanningDismissedReason =
  | 'false positive'
  | "won't fix"
  | 'used in tests';
type CodeScanningSort = 'created' | 'updated';
type CodeScanningDirection = 'asc' | 'desc';

export interface ListCodeScanningAlertsInput {
  state?: string;
  severity?: string;
  toolName?: string;
  ref?: string;
  sort?: string;
  direction?: string;
  perPage?: number;
}

export interface UpdateCodeScanningAlertInput {
  alertNumber: number;
  state: string;
  dismissedReason?: string;
  dismissedComment?: string;
}

function parseOptionalString(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseCodeScanningUpdateState(value: string): CodeScanningUpdateState {
  if (value === 'open' || value === 'dismissed') {
    return value;
  }
  throw new Error('--state must be "open" or "dismissed"');
}

function parseCodeScanningListState(
  value: string | undefined
): CodeScanningListState | undefined {
  const candidate = parseOptionalString(value);
  if (candidate === undefined) {
    return undefined;
  }
  if (
    candidate === 'open' ||
    candidate === 'dismissed' ||
    candidate === 'fixed'
  ) {
    return candidate;
  }
  throw new Error('--state must be one of "open", "dismissed", or "fixed"');
}

function parseCodeScanningSort(
  value: string | undefined
): CodeScanningSort | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === 'created' || value === 'updated') {
    return value;
  }
  throw new Error('--sort must be "created" or "updated"');
}

function parseCodeScanningDirection(
  value: string | undefined
): CodeScanningDirection | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === 'asc' || value === 'desc') {
    return value;
  }
  throw new Error('--direction must be "asc" or "desc"');
}

function normalizeCodeScanningDismissedReason(
  value: string | undefined
): CodeScanningDismissedReason | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === 'false_positive' || value === 'false positive') {
    return 'false positive';
  }
  if (value === 'wont_fix' || value === "won't fix") {
    return "won't fix";
  }
  if (value === 'used_in_tests' || value === 'used in tests') {
    return 'used in tests';
  }
  return undefined;
}

function normalizeCodeScanningAlert(
  alert: CodeScanningAlert | CodeScanningAlertSummary
): Record<string, unknown> {
  const effectiveState =
    alert.state ?? alert.most_recent_instance.state ?? null;
  const location = alert.most_recent_instance.location;
  const ruleSecuritySeverity =
    'security_severity_level' in alert.rule
      ? alert.rule.security_severity_level
      : null;
  const ruleDescription = alert.rule.description;
  const toolGuid = alert.tool.guid;
  const toolVersion = alert.tool.version;
  const analysisKey = alert.most_recent_instance.analysis_key;
  const category = alert.most_recent_instance.category;

  return {
    number: alert.number,
    state: effectiveState,
    raw_state: alert.state ?? null,
    rule: {
      id: alert.rule.id,
      severity: alert.rule.severity ?? null,
      security_severity_level: ruleSecuritySeverity,
      description: ruleDescription
    },
    tool: {
      name: alert.tool.name,
      guid: toolGuid,
      version: toolVersion
    },
    most_recent_instance: {
      ref: alert.most_recent_instance.ref,
      state: alert.most_recent_instance.state,
      analysis_key: analysisKey,
      category,
      location: {
        path: location?.path ?? null,
        start_line: location?.start_line ?? null,
        end_line: location?.end_line ?? null
      }
    },
    html_url: alert.html_url,
    created_at: alert.created_at,
    updated_at: alert.updated_at,
    dismissed_at: alert.dismissed_at ?? null,
    dismissed_by: alert.dismissed_by?.login ?? null,
    dismissed_reason: alert.dismissed_reason ?? null,
    dismissed_comment: alert.dismissed_comment ?? null,
    fixed_at: alert.fixed_at ?? null
  };
}

export async function listCodeScanningAlertsWithOctokit(
  context: GitHubClientContext,
  input: ListCodeScanningAlertsInput
): Promise<string> {
  const request: Parameters<
    typeof context.octokit.rest.codeScanning.listAlertsForRepo
  >[0] = {
    owner: context.owner,
    repo: context.repo
  };

  const state = parseCodeScanningListState(input.state);
  const severity = parseOptionalString(input.severity);
  const toolName = parseOptionalString(input.toolName);
  const ref = parseOptionalString(input.ref);
  const sort = parseCodeScanningSort(input.sort);
  const direction = parseCodeScanningDirection(input.direction);

  if (state !== undefined) {
    request.state = state;
  }
  if (severity !== undefined) {
    request.severity = severity;
  }
  if (toolName !== undefined) {
    request.tool_name = toolName;
  }
  if (ref !== undefined) {
    request.ref = ref;
  }
  if (sort !== undefined) {
    request.sort = sort;
  }
  if (direction !== undefined) {
    request.direction = direction;
  }
  if (input.perPage !== undefined) {
    request.per_page = input.perPage;
  }

  const response =
    await context.octokit.rest.codeScanning.listAlertsForRepo(request);
  const alerts = response.data.map(normalizeCodeScanningAlert);

  return JSON.stringify(
    {
      total: alerts.length,
      alerts
    },
    null,
    2
  );
}

export async function getCodeScanningAlertWithOctokit(
  context: GitHubClientContext,
  alertNumber: number
): Promise<string> {
  const response = await context.octokit.rest.codeScanning.getAlert({
    owner: context.owner,
    repo: context.repo,
    alert_number: alertNumber
  });
  return JSON.stringify(normalizeCodeScanningAlert(response.data), null, 2);
}

export async function updateCodeScanningAlertWithOctokit(
  context: GitHubClientContext,
  input: UpdateCodeScanningAlertInput
): Promise<string> {
  const state = parseCodeScanningUpdateState(input.state);
  const dismissedReason = normalizeCodeScanningDismissedReason(
    input.dismissedReason
  );

  const request: Parameters<
    typeof context.octokit.rest.codeScanning.updateAlert
  >[0] = {
    owner: context.owner,
    repo: context.repo,
    alert_number: input.alertNumber,
    state
  };

  if (dismissedReason !== undefined) {
    request.dismissed_reason = dismissedReason;
  }
  if (input.dismissedComment !== undefined) {
    request.dismissed_comment = input.dismissedComment;
  }

  const response = await context.octokit.rest.codeScanning.updateAlert(request);
  return JSON.stringify(normalizeCodeScanningAlert(response.data), null, 2);
}
