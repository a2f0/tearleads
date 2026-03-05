import type { GroupsListResponse } from '@tearleads/shared';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toSafeNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

export function mapGroupsListResponse(
  responseBody: unknown
): GroupsListResponse {
  const response = isRecord(responseBody) ? responseBody : {};
  const groups = Array.isArray(response['groups']) ? response['groups'] : [];

  return {
    groups: groups
      .filter((group): group is Record<string, unknown> => isRecord(group))
      .map((group) => ({
        id: typeof group['id'] === 'string' ? group['id'] : '',
        organizationId:
          typeof group['organizationId'] === 'string'
            ? group['organizationId']
            : '',
        name: typeof group['name'] === 'string' ? group['name'] : '',
        description:
          typeof group['description'] === 'string'
            ? group['description']
            : null,
        createdAt:
          typeof group['createdAt'] === 'string' ? group['createdAt'] : '',
        updatedAt:
          typeof group['updatedAt'] === 'string' ? group['updatedAt'] : '',
        memberCount: toSafeNumber(group['memberCount'])
      }))
  };
}
