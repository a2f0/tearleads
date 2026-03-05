import type { AdminAccessContextResponse } from '@tearleads/shared';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function mapContextResponse(
  responseBody: unknown
): AdminAccessContextResponse {
  const response = isRecord(responseBody) ? responseBody : {};
  const organizations = Array.isArray(response['organizations'])
    ? response['organizations']
    : [];

  return {
    isRootAdmin: Boolean(response['isRootAdmin']),
    organizations: organizations
      .filter((organization) => isRecord(organization))
      .map((organization) => ({
        id:
          typeof organization['id'] === 'string' ? organization['id'] : '',
        name:
          typeof organization['name'] === 'string' ? organization['name'] : ''
      })),
    defaultOrganizationId:
      typeof response['defaultOrganizationId'] === 'string' &&
      response['defaultOrganizationId'].trim().length > 0
        ? response['defaultOrganizationId']
        : null
  };
}
