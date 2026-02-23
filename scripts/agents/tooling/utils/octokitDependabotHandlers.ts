import type { RestEndpointMethodTypes } from '@octokit/rest';
import type { GitHubClientContext } from './githubClient.ts';

type UpdateAlertState = 'open' | 'dismissed';
type AlertSort = 'created' | 'updated' | 'epss_percentage';
type AlertDirection = 'asc' | 'desc';
type AlertScope = 'development' | 'runtime';
type AlertDismissedReason =
  | 'fix_started'
  | 'inaccurate'
  | 'no_bandwidth'
  | 'not_used'
  | 'tolerable_risk';

type DependabotAlert =
  RestEndpointMethodTypes['dependabot']['getAlert']['response']['data'];

export interface ListDependabotAlertsInput {
  state?: string;
  severity?: string;
  ecosystem?: string;
  packageName?: string;
  manifest?: string;
  scope?: string;
  sort?: string;
  direction?: string;
  perPage?: number;
}

export interface UpdateDependabotAlertInput {
  alertNumber: number;
  state: string;
  dismissedReason?: string;
  dismissedComment?: string;
}

function parseCsvInput(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseUpdateAlertState(
  value: string | undefined
): UpdateAlertState | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === 'open' || value === 'dismissed') {
    return value;
  }
  throw new Error('--state must be "open" or "dismissed"');
}

function parseCommaSeparatedAlertStates(
  value: string | undefined
): string | undefined {
  const candidate = parseCsvInput(value);
  if (candidate === undefined) {
    return undefined;
  }
  for (const token of candidate.split(',')) {
    const state = token.trim();
    if (
      state !== 'open' &&
      state !== 'dismissed' &&
      state !== 'fixed' &&
      state !== 'auto_dismissed'
    ) {
      throw new Error(
        '--state must be one of "open", "dismissed", "fixed", or "auto_dismissed" (comma-separated allowed)'
      );
    }
  }
  return candidate;
}

function parseAlertScope(value: string | undefined): AlertScope | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === 'development' || value === 'runtime') {
    return value;
  }
  throw new Error('--scope must be "development" or "runtime"');
}

function parseAlertSort(value: string | undefined): AlertSort | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    value === 'created' ||
    value === 'updated' ||
    value === 'epss_percentage'
  ) {
    return value;
  }
  throw new Error('--sort must be "created", "updated", or "epss_percentage"');
}

function parseAlertDirection(
  value: string | undefined
): AlertDirection | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === 'asc' || value === 'desc') {
    return value;
  }
  throw new Error('--direction must be "asc" or "desc"');
}

function parseDismissedReason(
  value: string | undefined
): AlertDismissedReason | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    value === 'fix_started' ||
    value === 'inaccurate' ||
    value === 'no_bandwidth' ||
    value === 'not_used' ||
    value === 'tolerable_risk'
  ) {
    return value;
  }
  throw new Error(
    '--dismissed-reason must be one of "fix_started", "inaccurate", "no_bandwidth", "not_used", "tolerable_risk"'
  );
}

function normalizeDependabotAlert(
  alert: DependabotAlert
): Record<string, unknown> {
  return {
    number: alert.number,
    state: alert.state,
    dependency: {
      ecosystem: alert.dependency?.package?.ecosystem ?? null,
      name: alert.dependency?.package?.name ?? null,
      manifest_path: alert.dependency?.manifest_path ?? null,
      scope: alert.dependency?.scope ?? null,
      relationship: alert.dependency?.relationship ?? null
    },
    advisory: {
      ghsa_id: alert.security_advisory?.ghsa_id ?? null,
      cve_id: alert.security_advisory?.cve_id ?? null,
      summary: alert.security_advisory?.summary ?? null,
      severity: alert.security_advisory?.severity ?? null
    },
    vulnerability: {
      severity: alert.security_vulnerability?.severity ?? null,
      vulnerable_version_range:
        alert.security_vulnerability?.vulnerable_version_range ?? null,
      first_patched_version:
        alert.security_vulnerability?.first_patched_version?.identifier ?? null
    },
    html_url: alert.html_url,
    created_at: alert.created_at,
    updated_at: alert.updated_at,
    dismissed_at: alert.dismissed_at,
    dismissed_reason: alert.dismissed_reason,
    dismissed_comment: alert.dismissed_comment,
    fixed_at: alert.fixed_at
  };
}

export async function listDependabotAlertsWithOctokit(
  context: GitHubClientContext,
  input: ListDependabotAlertsInput
): Promise<string> {
  const request: Parameters<
    typeof context.octokit.rest.dependabot.listAlertsForRepo
  >[0] = {
    owner: context.owner,
    repo: context.repo
  };
  const state = parseCommaSeparatedAlertStates(input.state);
  const severity = parseCsvInput(input.severity);
  const ecosystem = parseCsvInput(input.ecosystem);
  const packageName = parseCsvInput(input.packageName);
  const manifest = parseCsvInput(input.manifest);
  const scope = parseAlertScope(input.scope);
  const sort = parseAlertSort(input.sort);
  const direction = parseAlertDirection(input.direction);

  if (state !== undefined) {
    request.state = state;
  }
  if (severity !== undefined) {
    request.severity = severity;
  }
  if (ecosystem !== undefined) {
    request.ecosystem = ecosystem;
  }
  if (packageName !== undefined) {
    request.package = packageName;
  }
  if (manifest !== undefined) {
    request.manifest = manifest;
  }
  if (scope !== undefined) {
    request.scope = scope;
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
    await context.octokit.rest.dependabot.listAlertsForRepo(request);

  const alerts = response.data.map(normalizeDependabotAlert);

  return JSON.stringify(
    {
      total: alerts.length,
      alerts
    },
    null,
    2
  );
}

export async function getDependabotAlertWithOctokit(
  context: GitHubClientContext,
  alertNumber: number
): Promise<string> {
  const response = await context.octokit.rest.dependabot.getAlert({
    owner: context.owner,
    repo: context.repo,
    alert_number: alertNumber
  });

  return JSON.stringify(normalizeDependabotAlert(response.data), null, 2);
}

export async function updateDependabotAlertWithOctokit(
  context: GitHubClientContext,
  input: UpdateDependabotAlertInput
): Promise<string> {
  const state = parseUpdateAlertState(input.state);
  if (state === undefined) {
    throw new Error('updateDependabotAlert requires --state');
  }

  const dismissedReason = parseDismissedReason(input.dismissedReason);
  if (state === 'dismissed' && dismissedReason === undefined) {
    throw new Error(
      'updateDependabotAlert requires --dismissed-reason when --state dismissed'
    );
  }
  if (state === 'open' && input.dismissedReason !== undefined) {
    throw new Error(
      'updateDependabotAlert does not accept --dismissed-reason when --state open'
    );
  }
  if (state === 'open' && input.dismissedComment !== undefined) {
    throw new Error(
      'updateDependabotAlert does not accept --dismissed-comment when --state open'
    );
  }

  const request: Parameters<
    typeof context.octokit.rest.dependabot.updateAlert
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

  const response = await context.octokit.rest.dependabot.updateAlert(request);

  return JSON.stringify(normalizeDependabotAlert(response.data), null, 2);
}
