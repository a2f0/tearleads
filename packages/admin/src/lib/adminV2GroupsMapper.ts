import type { GroupsListResponse } from '@tearleads/shared';
import { isRecord, toSafeNumber } from './adminV2ValueUtils';

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
