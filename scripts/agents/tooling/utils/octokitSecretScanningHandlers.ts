import type { RestEndpointMethodTypes } from '@octokit/rest';
import type { GitHubClientContext } from './githubClient.ts';

type SecretScanningAlert =
  RestEndpointMethodTypes['secretScanning']['getAlert']['response']['data'];

type SecretScanningState = 'open' | 'resolved';
type SecretScanningResolution =
  | 'false_positive'
  | 'wont_fix'
  | 'revoked'
  | 'used_in_tests';
type SecretScanningSort = 'created' | 'updated';
type SecretScanningDirection = 'asc' | 'desc';

export interface ListSecretScanningAlertsInput {
  state?: string;
  secretType?: string;
  resolution?: string;
  sort?: string;
  direction?: string;
  perPage?: number;
}

export interface UpdateSecretScanningAlertInput {
  alertNumber: number;
  state: string;
  resolution?: string;
  resolutionComment?: string;
}

function parseOptionalString(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseSecretScanningState(
  value: string | undefined
): SecretScanningState | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === 'open' || value === 'resolved') {
    return value;
  }
  throw new Error('--state must be "open" or "resolved"');
}

function parseSecretScanningSort(
  value: string | undefined
): SecretScanningSort | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === 'created' || value === 'updated') {
    return value;
  }
  throw new Error('--sort must be "created" or "updated"');
}

function parseSecretScanningDirection(
  value: string | undefined
): SecretScanningDirection | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === 'asc' || value === 'desc') {
    return value;
  }
  throw new Error('--direction must be "asc" or "desc"');
}

function parseSecretScanningResolution(
  value: string | undefined
): SecretScanningResolution | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    value === 'false_positive' ||
    value === 'wont_fix' ||
    value === 'revoked' ||
    value === 'used_in_tests'
  ) {
    return value;
  }
  throw new Error(
    '--resolution must be one of "false_positive", "wont_fix", "revoked", or "used_in_tests"'
  );
}

function normalizeSecretScanningAlert(
  alert: SecretScanningAlert
): Record<string, unknown> {
  return {
    number: alert.number,
    state: alert.state,
    secret_type: alert.secret_type,
    secret_type_display_name: alert.secret_type_display_name ?? null,
    resolution: alert.resolution ?? null,
    resolution_comment: alert.resolution_comment ?? null,
    resolved_at: alert.resolved_at ?? null,
    resolved_by: alert.resolved_by?.login ?? null,
    html_url: alert.html_url,
    created_at: alert.created_at,
    updated_at: alert.updated_at,
    push_protection_bypassed: alert.push_protection_bypassed ?? null,
    push_protection_bypassed_by:
      alert.push_protection_bypassed_by?.login ?? null
  };
}

export async function listSecretScanningAlertsWithOctokit(
  context: GitHubClientContext,
  input: ListSecretScanningAlertsInput
): Promise<string> {
  const request: Parameters<
    typeof context.octokit.rest.secretScanning.listAlertsForRepo
  >[0] = {
    owner: context.owner,
    repo: context.repo
  };

  const state = parseSecretScanningState(input.state);
  const secretType = parseOptionalString(input.secretType);
  const resolution = parseSecretScanningResolution(input.resolution);
  const sort = parseSecretScanningSort(input.sort);
  const direction = parseSecretScanningDirection(input.direction);

  if (state !== undefined) {
    request.state = state;
  }
  if (secretType !== undefined) {
    request.secret_type = secretType;
  }
  if (resolution !== undefined) {
    request.resolution = resolution;
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
    await context.octokit.rest.secretScanning.listAlertsForRepo(request);
  const alerts = response.data.map(normalizeSecretScanningAlert);

  return JSON.stringify(
    {
      total: alerts.length,
      alerts
    },
    null,
    2
  );
}

export async function getSecretScanningAlertWithOctokit(
  context: GitHubClientContext,
  alertNumber: number
): Promise<string> {
  const response = await context.octokit.rest.secretScanning.getAlert({
    owner: context.owner,
    repo: context.repo,
    alert_number: alertNumber
  });
  return JSON.stringify(normalizeSecretScanningAlert(response.data), null, 2);
}

export async function updateSecretScanningAlertWithOctokit(
  context: GitHubClientContext,
  input: UpdateSecretScanningAlertInput
): Promise<string> {
  const state = parseSecretScanningState(input.state);
  if (state === undefined) {
    throw new Error('updateSecretScanningAlert requires --state');
  }

  const resolution = parseSecretScanningResolution(input.resolution);

  const request: Parameters<
    typeof context.octokit.rest.secretScanning.updateAlert
  >[0] = {
    owner: context.owner,
    repo: context.repo,
    alert_number: input.alertNumber,
    state
  };

  if (resolution !== undefined) {
    request.resolution = resolution;
  }
  if (input.resolutionComment !== undefined) {
    request.resolution_comment = input.resolutionComment;
  }

  const response =
    await context.octokit.rest.secretScanning.updateAlert(request);
  return JSON.stringify(normalizeSecretScanningAlert(response.data), null, 2);
}
