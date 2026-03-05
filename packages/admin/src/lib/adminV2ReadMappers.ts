import type {
  AdminUsersResponse,
  GroupDetailResponse,
  OrganizationsListResponse
} from '@tearleads/shared';
import { isRecord, toSafeNumber } from './adminV2ValueUtils';

export function mapGroupDetailResponse(responseBody: unknown): GroupDetailResponse {
  const response = isRecord(responseBody) ? responseBody : {};
  const group = isRecord(response['group']) ? response['group'] : {};
  const members = Array.isArray(response['members']) ? response['members'] : [];

  return {
    group: {
      id: typeof group['id'] === 'string' ? group['id'] : '',
      organizationId:
        typeof group['organizationId'] === 'string'
          ? group['organizationId']
          : '',
      name: typeof group['name'] === 'string' ? group['name'] : '',
      description:
        typeof group['description'] === 'string' ? group['description'] : null,
      createdAt: typeof group['createdAt'] === 'string' ? group['createdAt'] : '',
      updatedAt: typeof group['updatedAt'] === 'string' ? group['updatedAt'] : ''
    },
    members: members
      .filter((member) => isRecord(member))
      .map((member) => ({
        userId: typeof member['userId'] === 'string' ? member['userId'] : '',
        email: typeof member['email'] === 'string' ? member['email'] : '',
        joinedAt:
          typeof member['joinedAt'] === 'string' ? member['joinedAt'] : ''
      }))
  };
}

export function mapOrganizationsListResponse(
  responseBody: unknown
): OrganizationsListResponse {
  const response = isRecord(responseBody) ? responseBody : {};
  const organizations = Array.isArray(response['organizations'])
    ? response['organizations']
    : [];

  return {
    organizations: organizations
      .filter((organization) => isRecord(organization))
      .map((organization) => ({
        id: typeof organization['id'] === 'string' ? organization['id'] : '',
        name:
          typeof organization['name'] === 'string' ? organization['name'] : '',
        description:
          typeof organization['description'] === 'string'
            ? organization['description']
            : null,
        createdAt:
          typeof organization['createdAt'] === 'string'
            ? organization['createdAt']
            : '',
        updatedAt:
          typeof organization['updatedAt'] === 'string'
            ? organization['updatedAt']
            : ''
      }))
  };
}

export function mapUsersListResponse(responseBody: unknown): AdminUsersResponse {
  const response = isRecord(responseBody) ? responseBody : {};
  const users = Array.isArray(response['users']) ? response['users'] : [];

  return {
    users: users
      .filter((user) => isRecord(user))
      .map((user) => {
        const accounting = isRecord(user['accounting']) ? user['accounting'] : {};
        const organizationIds = Array.isArray(user['organizationIds'])
          ? user['organizationIds'].filter(
              (organizationId): organizationId is string =>
                typeof organizationId === 'string'
            )
          : [];

        return {
          id: typeof user['id'] === 'string' ? user['id'] : '',
          email: typeof user['email'] === 'string' ? user['email'] : '',
          emailConfirmed: Boolean(user['emailConfirmed']),
          admin: Boolean(user['admin']),
          organizationIds,
          createdAt:
            typeof user['createdAt'] === 'string' ? user['createdAt'] : null,
          lastActiveAt:
            typeof user['lastActiveAt'] === 'string' ? user['lastActiveAt'] : null,
          accounting: {
            totalPromptTokens: toSafeNumber(accounting['totalPromptTokens']),
            totalCompletionTokens: toSafeNumber(
              accounting['totalCompletionTokens']
            ),
            totalTokens: toSafeNumber(accounting['totalTokens']),
            requestCount: toSafeNumber(accounting['requestCount']),
            lastUsedAt:
              typeof accounting['lastUsedAt'] === 'string'
                ? accounting['lastUsedAt']
                : null
          },
          disabled: Boolean(user['disabled']),
          disabledAt:
            typeof user['disabledAt'] === 'string' ? user['disabledAt'] : null,
          disabledBy:
            typeof user['disabledBy'] === 'string' ? user['disabledBy'] : null,
          markedForDeletionAt:
            typeof user['markedForDeletionAt'] === 'string'
              ? user['markedForDeletionAt']
              : null,
          markedForDeletionBy:
            typeof user['markedForDeletionBy'] === 'string'
              ? user['markedForDeletionBy']
              : null
        };
      })
  };
}
