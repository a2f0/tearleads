import type {
  AdminUserResponse,
  AdminUsersResponse,
  GroupDetailResponse,
  GroupMembersResponse,
  OrganizationGroupsResponse,
  OrganizationResponse,
  OrganizationsListResponse
} from '@tearleads/shared';
import { isRecord, toSafeNumber } from './adminV2ValueUtils';

export function mapGroupDetailResponse(
  responseBody: unknown
): GroupDetailResponse {
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
      createdAt:
        typeof group['createdAt'] === 'string' ? group['createdAt'] : '',
      updatedAt:
        typeof group['updatedAt'] === 'string' ? group['updatedAt'] : ''
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

export function mapGroupMembersResponse(
  responseBody: unknown
): GroupMembersResponse {
  const response = isRecord(responseBody) ? responseBody : {};
  const members = Array.isArray(response['members']) ? response['members'] : [];

  return {
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

export function mapOrganizationResponse(
  responseBody: unknown
): OrganizationResponse {
  const response = isRecord(responseBody) ? responseBody : {};
  const organization = isRecord(response['organization'])
    ? response['organization']
    : {};

  return {
    organization: {
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
    }
  };
}

export function mapOrganizationGroupsResponse(
  responseBody: unknown
): OrganizationGroupsResponse {
  const response = isRecord(responseBody) ? responseBody : {};
  const groups = Array.isArray(response['groups']) ? response['groups'] : [];

  return {
    groups: groups
      .filter((group) => isRecord(group))
      .map((group) => ({
        id: typeof group['id'] === 'string' ? group['id'] : '',
        name: typeof group['name'] === 'string' ? group['name'] : '',
        description:
          typeof group['description'] === 'string'
            ? group['description']
            : null,
        memberCount: toSafeNumber(group['memberCount'])
      }))
  };
}

function mapAdminUser(user: unknown): AdminUserResponse['user'] {
  const userRecord = isRecord(user) ? user : {};
  const accounting = isRecord(userRecord['accounting'])
    ? userRecord['accounting']
    : {};
  const organizationIds = Array.isArray(userRecord['organizationIds'])
    ? userRecord['organizationIds'].filter(
        (organizationId): organizationId is string =>
          typeof organizationId === 'string'
      )
    : [];

  return {
    id: typeof userRecord['id'] === 'string' ? userRecord['id'] : '',
    email: typeof userRecord['email'] === 'string' ? userRecord['email'] : '',
    emailConfirmed: Boolean(userRecord['emailConfirmed']),
    admin: Boolean(userRecord['admin']),
    organizationIds,
    createdAt:
      typeof userRecord['createdAt'] === 'string'
        ? userRecord['createdAt']
        : null,
    lastActiveAt:
      typeof userRecord['lastActiveAt'] === 'string'
        ? userRecord['lastActiveAt']
        : null,
    accounting: {
      totalPromptTokens: toSafeNumber(accounting['totalPromptTokens']),
      totalCompletionTokens: toSafeNumber(accounting['totalCompletionTokens']),
      totalTokens: toSafeNumber(accounting['totalTokens']),
      requestCount: toSafeNumber(accounting['requestCount']),
      lastUsedAt:
        typeof accounting['lastUsedAt'] === 'string'
          ? accounting['lastUsedAt']
          : null
    },
    disabled: Boolean(userRecord['disabled']),
    disabledAt:
      typeof userRecord['disabledAt'] === 'string'
        ? userRecord['disabledAt']
        : null,
    disabledBy:
      typeof userRecord['disabledBy'] === 'string'
        ? userRecord['disabledBy']
        : null,
    markedForDeletionAt:
      typeof userRecord['markedForDeletionAt'] === 'string'
        ? userRecord['markedForDeletionAt']
        : null,
    markedForDeletionBy:
      typeof userRecord['markedForDeletionBy'] === 'string'
        ? userRecord['markedForDeletionBy']
        : null
  };
}

export function mapUsersListResponse(
  responseBody: unknown
): AdminUsersResponse {
  const response = isRecord(responseBody) ? responseBody : {};
  const users = Array.isArray(response['users']) ? response['users'] : [];

  return {
    users: users.map((user) => mapAdminUser(user))
  };
}

export function mapUserResponse(responseBody: unknown): AdminUserResponse {
  const response = isRecord(responseBody) ? responseBody : {};
  return {
    user: mapAdminUser(response['user'])
  };
}
