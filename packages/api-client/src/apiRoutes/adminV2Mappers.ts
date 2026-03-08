import type {
  AdminAccessContextResponse,
  AdminUserResponse,
  AdminUsersResponse,
  Group,
  GroupDetailResponse,
  GroupMembersResponse,
  GroupsListResponse,
  OrganizationGroupsResponse,
  OrganizationResponse,
  OrganizationsListResponse,
  OrganizationUsersResponse,
  PostgresAdminInfoResponse,
  PostgresColumnsResponse,
  PostgresRowsResponse,
  PostgresTablesResponse,
  RedisKeysResponse,
  RedisKeyValueResponse
} from '@tearleads/shared';
import type {
  AdminCreateGroupResponse,
  AdminCreateOrganizationResponse,
  AdminGetColumnsResponse,
  AdminGetContextResponse,
  AdminGetGroupMembersResponse,
  AdminGetGroupResponse,
  AdminGetOrganizationResponse,
  AdminGetOrgGroupsResponse,
  AdminGetOrgUsersResponse,
  AdminGetPostgresInfoResponse,
  AdminGetRedisDbSizeResponse,
  AdminGetRedisKeysResponse,
  AdminGetRedisValueResponse,
  AdminGetRowsResponse,
  AdminGetTablesResponse,
  AdminGetUserResponse,
  AdminListGroupsResponse,
  AdminListOrganizationsResponse,
  AdminListUsersResponse,
  AdminUpdateGroupResponse,
  AdminUpdateOrganizationResponse,
  AdminUpdateUserResponse
} from '@tearleads/shared/gen/tearleads/v2/admin_pb';

const MIN_SAFE_BIGINT = BigInt(Number.MIN_SAFE_INTEGER);
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

function toSafeNumber(value: bigint, fieldName: string): number {
  if (value > MAX_SAFE_BIGINT || value < MIN_SAFE_BIGINT) {
    throw new Error(`${fieldName} exceeded Number safe integer range`);
  }
  return Number(value);
}

export function mapPostgresInfoResponse(
  response: AdminGetPostgresInfoResponse
): PostgresAdminInfoResponse {
  return {
    info: {
      host: response.info?.host ?? null,
      port: response.info?.port ?? null,
      database: response.info?.database ?? null,
      user: response.info?.user ?? null
    },
    serverVersion: response.serverVersion ?? null
  };
}

export function mapGroupDetailResponse(
  response: AdminGetGroupResponse
): GroupDetailResponse {
  const group = response.group;
  return {
    group: {
      id: group?.id ?? '',
      organizationId: group?.organizationId ?? '',
      name: group?.name ?? '',
      description: group?.description ?? null,
      createdAt: group?.createdAt ?? '',
      updatedAt: group?.updatedAt ?? ''
    },
    members: response.members.map((member) => ({
      userId: member.userId,
      email: member.email,
      joinedAt: member.joinedAt
    }))
  };
}

function mapGroup(group: AdminGetGroupResponse['group']): Group {
  return {
    id: group?.id ?? '',
    organizationId: group?.organizationId ?? '',
    name: group?.name ?? '',
    description: group?.description ?? null,
    createdAt: group?.createdAt ?? '',
    updatedAt: group?.updatedAt ?? ''
  };
}

export function mapCreateGroupResponse(response: AdminCreateGroupResponse): {
  group: Group;
} {
  return {
    group: mapGroup(response.group)
  };
}

export function mapUpdateGroupResponse(response: AdminUpdateGroupResponse): {
  group: Group;
} {
  return {
    group: mapGroup(response.group)
  };
}

export function mapGroupsListResponse(
  response: AdminListGroupsResponse
): GroupsListResponse {
  return {
    groups: response.groups.map((group) => ({
      id: group.id,
      organizationId: group.organizationId,
      name: group.name,
      description: group.description ?? null,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
      memberCount: group.memberCount
    }))
  };
}

export function mapGroupMembersResponse(
  response: AdminGetGroupMembersResponse
): GroupMembersResponse {
  return {
    members: response.members.map((member) => ({
      userId: member.userId,
      email: member.email,
      joinedAt: member.joinedAt
    }))
  };
}

export function mapOrganizationsResponse(
  response: AdminListOrganizationsResponse
): OrganizationsListResponse {
  return {
    organizations: response.organizations.map((organization) => ({
      id: organization.id,
      name: organization.name,
      description: organization.description ?? null,
      createdAt: organization.createdAt,
      updatedAt: organization.updatedAt
    }))
  };
}

export function mapOrganizationResponse(
  response:
    | AdminCreateOrganizationResponse
    | AdminGetOrganizationResponse
    | AdminUpdateOrganizationResponse
): OrganizationResponse {
  return {
    organization: {
      id: response.organization?.id ?? '',
      name: response.organization?.name ?? '',
      description: response.organization?.description ?? null,
      createdAt: response.organization?.createdAt ?? '',
      updatedAt: response.organization?.updatedAt ?? ''
    }
  };
}

export function mapOrganizationGroupsResponse(
  response: AdminGetOrgGroupsResponse
): OrganizationGroupsResponse {
  return {
    groups: response.groups.map((group) => ({
      id: group.id,
      name: group.name,
      description: group.description ?? null,
      memberCount: group.memberCount
    }))
  };
}

export function mapOrganizationUsersResponse(
  response: AdminGetOrgUsersResponse
): OrganizationUsersResponse {
  return {
    users: response.users.map((user) => ({
      id: user.id,
      email: user.email,
      joinedAt: user.joinedAt
    }))
  };
}

function mapAdminUser(
  user: AdminListUsersResponse['users'][number] | undefined
) {
  const accounting = user?.accounting;
  return {
    id: user?.id ?? '',
    email: user?.email ?? '',
    emailConfirmed: user?.emailConfirmed ?? false,
    admin: user?.admin ?? false,
    organizationIds: user?.organizationIds ?? [],
    createdAt: user?.createdAt ?? null,
    lastActiveAt: user?.lastActiveAt ?? null,
    accounting: {
      totalPromptTokens: toSafeNumber(
        accounting?.totalPromptTokens ?? 0n,
        'totalPromptTokens'
      ),
      totalCompletionTokens: toSafeNumber(
        accounting?.totalCompletionTokens ?? 0n,
        'totalCompletionTokens'
      ),
      totalTokens: toSafeNumber(accounting?.totalTokens ?? 0n, 'totalTokens'),
      requestCount: toSafeNumber(
        accounting?.requestCount ?? 0n,
        'requestCount'
      ),
      lastUsedAt: accounting?.lastUsedAt ?? null
    },
    disabled: user?.disabled ?? false,
    disabledAt: user?.disabledAt ?? null,
    disabledBy: user?.disabledBy ?? null,
    markedForDeletionAt: user?.markedForDeletionAt ?? null,
    markedForDeletionBy: user?.markedForDeletionBy ?? null
  };
}

export function mapUsersResponse(
  response: AdminListUsersResponse
): AdminUsersResponse {
  return {
    users: response.users.map((user) => mapAdminUser(user))
  };
}

export function mapUserResponse(
  response: AdminGetUserResponse | AdminUpdateUserResponse
): AdminUserResponse {
  return {
    user: mapAdminUser(response.user)
  };
}

export function mapContextResponse(
  response: AdminGetContextResponse
): AdminAccessContextResponse {
  return {
    isRootAdmin: response.isRootAdmin,
    organizations: response.organizations.map((organization) => ({
      id: organization.id,
      name: organization.name
    })),
    defaultOrganizationId: response.defaultOrganizationId ?? null
  };
}

export function mapPostgresTablesResponse(
  response: AdminGetTablesResponse
): PostgresTablesResponse {
  return {
    tables: response.tables.map((table) => ({
      schema: table.schema,
      name: table.name,
      rowCount: toSafeNumber(table.rowCount, 'rowCount'),
      totalBytes: toSafeNumber(table.totalBytes, 'totalBytes'),
      tableBytes: toSafeNumber(table.tableBytes, 'tableBytes'),
      indexBytes: toSafeNumber(table.indexBytes, 'indexBytes')
    }))
  };
}

export function mapPostgresColumnsResponse(
  response: AdminGetColumnsResponse
): PostgresColumnsResponse {
  return {
    columns: response.columns.map((column) => ({
      name: column.name,
      type: column.type,
      nullable: column.nullable,
      defaultValue: column.defaultValue ?? null,
      ordinalPosition: column.ordinalPosition
    }))
  };
}

export function mapPostgresRowsResponse(
  response: AdminGetRowsResponse
): PostgresRowsResponse {
  return {
    rows: response.rows.map((row) => ({ ...row })),
    totalCount: toSafeNumber(response.totalCount, 'totalCount'),
    limit: response.limit,
    offset: response.offset
  };
}

export function mapRedisKeysResponse(
  response: AdminGetRedisKeysResponse
): RedisKeysResponse {
  return {
    keys: response.keys.map((keyRecord) => ({
      key: keyRecord.key,
      type: keyRecord.type,
      ttl: toSafeNumber(keyRecord.ttl, 'ttl')
    })),
    cursor: response.cursor,
    hasMore: response.hasMore
  };
}

function mapRedisValue(
  response: AdminGetRedisValueResponse
): RedisKeyValueResponse['value'] {
  const redisValue = response.value?.value;
  if (!redisValue) {
    return null;
  }

  switch (redisValue.case) {
    case 'stringValue':
      return redisValue.value;
    case 'listValue':
      return redisValue.value.values;
    case 'mapValue':
      return redisValue.value.entries;
    case undefined:
      return null;
    default: {
      const unexpectedRedisValueCase: never = redisValue;
      throw new Error(
        `Unhandled redis value variant: ${unexpectedRedisValueCase}`
      );
    }
  }
}

export function mapRedisValueResponse(
  response: AdminGetRedisValueResponse
): RedisKeyValueResponse {
  return {
    key: response.key,
    type: response.type,
    ttl: toSafeNumber(response.ttl, 'ttl'),
    value: mapRedisValue(response)
  };
}

export function mapRedisDbSizeResponse(response: AdminGetRedisDbSizeResponse): {
  count: number;
} {
  return {
    count: toSafeNumber(response.count, 'count')
  };
}
