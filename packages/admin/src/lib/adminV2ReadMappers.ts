import type {
  Group,
  GroupDetailResponse,
  GroupMembersResponse,
  OrganizationGroupsResponse,
  OrganizationResponse,
  OrganizationsListResponse,
  OrganizationUsersResponse
} from '@tearleads/shared';
import { isRecord, toSafeNumber } from './adminV2ValueUtils';

function mapGroup(group: unknown): Group {
  const groupRecord = isRecord(group) ? group : {};
  return {
    id: typeof groupRecord['id'] === 'string' ? groupRecord['id'] : '',
    organizationId:
      typeof groupRecord['organizationId'] === 'string'
        ? groupRecord['organizationId']
        : '',
    name: typeof groupRecord['name'] === 'string' ? groupRecord['name'] : '',
    description:
      typeof groupRecord['description'] === 'string'
        ? groupRecord['description']
        : null,
    createdAt:
      typeof groupRecord['createdAt'] === 'string'
        ? groupRecord['createdAt']
        : '',
    updatedAt:
      typeof groupRecord['updatedAt'] === 'string'
        ? groupRecord['updatedAt']
        : ''
  };
}

export function mapGroupResponse(responseBody: unknown): { group: Group } {
  const response = isRecord(responseBody) ? responseBody : {};
  return {
    group: mapGroup(response['group'])
  };
}

export function mapGroupDetailResponse(
  responseBody: unknown
): GroupDetailResponse {
  const response = isRecord(responseBody) ? responseBody : {};
  const members = Array.isArray(response['members']) ? response['members'] : [];

  return {
    group: mapGroup(response['group']),
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

export function mapOrganizationUsersResponse(
  responseBody: unknown
): OrganizationUsersResponse {
  const response = isRecord(responseBody) ? responseBody : {};
  const users = Array.isArray(response['users']) ? response['users'] : [];

  return {
    users: users
      .filter((user) => isRecord(user))
      .map((user) => ({
        id: typeof user['id'] === 'string' ? user['id'] : '',
        email: typeof user['email'] === 'string' ? user['email'] : '',
        joinedAt: typeof user['joinedAt'] === 'string' ? user['joinedAt'] : ''
      }))
  };
}
