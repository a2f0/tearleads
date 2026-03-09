import { create } from '@bufbuild/protobuf';
import {
  AdminCreateGroupRequestSchema,
  AdminGetContextRequestSchema,
  AdminGetPostgresInfoRequestSchema,
  AdminGetRedisValueRequestSchema,
  AdminGetTablesRequestSchema,
  AdminListOrganizationsRequestSchema,
  AdminUpdateUserOrganizationIdsSchema,
  AdminUpdateUserRequestSchema
} from '@tearleads/shared/gen/tearleads/v2/admin_pb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getContextDirect: vi.fn(),
  addGroupMemberDirect: vi.fn(),
  createGroupDirect: vi.fn(),
  deleteGroupDirect: vi.fn(),
  removeGroupMemberDirect: vi.fn(),
  updateGroupDirect: vi.fn(),
  getGroupDirect: vi.fn(),
  getGroupMembersDirect: vi.fn(),
  listGroupsDirect: vi.fn(),
  createOrganizationDirect: vi.fn(),
  deleteOrganizationDirect: vi.fn(),
  getOrganizationDirect: vi.fn(),
  getOrganizationGroupsDirect: vi.fn(),
  getOrganizationUsersDirect: vi.fn(),
  listOrganizationsDirect: vi.fn(),
  updateOrganizationDirect: vi.fn(),
  getColumnsDirect: vi.fn(),
  getPostgresInfoDirect: vi.fn(),
  getRowsDirect: vi.fn(),
  getTablesDirect: vi.fn(),
  deleteRedisKeyDirect: vi.fn(),
  getRedisDbSizeDirect: vi.fn(),
  getRedisKeysDirect: vi.fn(),
  getRedisValueDirect: vi.fn(),
  getUserDirect: vi.fn(),
  listUsersDirect: vi.fn(),
  updateUserDirect: vi.fn()
}));

vi.mock('./adminDirectContext.js', () => ({
  getContextDirect: mocks.getContextDirect
}));

vi.mock('./adminDirectGroupMutations.js', () => ({
  addGroupMemberDirect: mocks.addGroupMemberDirect,
  createGroupDirect: mocks.createGroupDirect,
  deleteGroupDirect: mocks.deleteGroupDirect,
  removeGroupMemberDirect: mocks.removeGroupMemberDirect,
  updateGroupDirect: mocks.updateGroupDirect
}));

vi.mock('./adminDirectGroups.js', () => ({
  getGroupDirect: mocks.getGroupDirect,
  getGroupMembersDirect: mocks.getGroupMembersDirect,
  listGroupsDirect: mocks.listGroupsDirect
}));

vi.mock('./adminDirectOrganizations.js', () => ({
  createOrganizationDirect: mocks.createOrganizationDirect,
  deleteOrganizationDirect: mocks.deleteOrganizationDirect,
  getOrganizationDirect: mocks.getOrganizationDirect,
  getOrganizationGroupsDirect: mocks.getOrganizationGroupsDirect,
  getOrganizationUsersDirect: mocks.getOrganizationUsersDirect,
  listOrganizationsDirect: mocks.listOrganizationsDirect,
  updateOrganizationDirect: mocks.updateOrganizationDirect
}));

vi.mock('./adminDirectPostgres.js', () => ({
  getColumnsDirect: mocks.getColumnsDirect,
  getPostgresInfoDirect: mocks.getPostgresInfoDirect,
  getRowsDirect: mocks.getRowsDirect,
  getTablesDirect: mocks.getTablesDirect
}));

vi.mock('./adminDirectRedis.js', () => ({
  deleteRedisKeyDirect: mocks.deleteRedisKeyDirect,
  getRedisDbSizeDirect: mocks.getRedisDbSizeDirect,
  getRedisKeysDirect: mocks.getRedisKeysDirect,
  getRedisValueDirect: mocks.getRedisValueDirect
}));

vi.mock('./adminDirectUsers.js', () => ({
  getUserDirect: mocks.getUserDirect,
  listUsersDirect: mocks.listUsersDirect,
  updateUserDirect: mocks.updateUserDirect
}));

import { adminConnectServiceV2 } from './adminServiceV2.js';

const context = {
  requestHeader: new Headers()
};

describe('adminConnectServiceV2', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns typed context response directly', async () => {
    mocks.getContextDirect.mockResolvedValueOnce({
      isRootAdmin: true,
      organizations: [{ id: 'org-1', name: 'Org 1' }]
    });

    const response = await adminConnectServiceV2.getContext(
      create(AdminGetContextRequestSchema),
      context
    );

    expect(response.isRootAdmin).toBe(true);
    expect(response.organizations[0]?.id).toBe('org-1');
    expect(response.organizations[0]?.name).toBe('Org 1');
    expect(response.defaultOrganizationId).toBeUndefined();
  });

  it('returns typed postgres info response directly', async () => {
    mocks.getPostgresInfoDirect.mockResolvedValueOnce({
      info: {
        host: 'localhost',
        port: 5432,
        database: 'tearleads',
        user: 'tearleads'
      },
      serverVersion: 'PostgreSQL 16.2'
    });

    const response = await adminConnectServiceV2.getPostgresInfo(
      create(AdminGetPostgresInfoRequestSchema),
      context
    );

    expect(response.info?.host).toBe('localhost');
    expect(response.info?.port).toBe(5432);
    expect(response.serverVersion).toBe('PostgreSQL 16.2');
  });

  it('converts table numeric counters to bigint', async () => {
    mocks.getTablesDirect.mockResolvedValueOnce({
      tables: [
        {
          schema: 'public',
          name: 'users',
          rowCount: 12n,
          totalBytes: 34n,
          tableBytes: 20n,
          indexBytes: 14n
        }
      ]
    });

    const response = await adminConnectServiceV2.getTables(
      create(AdminGetTablesRequestSchema),
      context
    );

    expect(response.tables[0]?.rowCount).toBe(12n);
    expect(response.tables[0]?.totalBytes).toBe(34n);
    expect(response.tables[0]?.tableBytes).toBe(20n);
    expect(response.tables[0]?.indexBytes).toBe(14n);
  });

  it('returns typed redis string values directly', async () => {
    mocks.getRedisValueDirect.mockResolvedValueOnce({
      key: 'feature_flag',
      type: 'string',
      ttl: 7n,
      value: {
        value: {
          case: 'stringValue',
          value: 'enabled'
        }
      }
    });

    const response = await adminConnectServiceV2.getRedisValue(
      create(AdminGetRedisValueRequestSchema, { key: 'feature_flag' }),
      context
    );

    expect(response.key).toBe('feature_flag');
    expect(response.type).toBe('string');
    expect(response.ttl).toBe(7n);
    expect(response.value?.value.case).toBe('stringValue');
    if (response.value?.value.case === 'stringValue') {
      expect(response.value.value.value).toBe('enabled');
    }
  });

  it('returns typed organization responses directly', async () => {
    mocks.listOrganizationsDirect.mockResolvedValueOnce({
      organizations: [
        {
          id: 'org-1',
          name: 'Org One',
          createdAt: '2026-03-09T00:00:00.000Z',
          updatedAt: '2026-03-09T00:05:00.000Z'
        }
      ]
    });

    const response = await adminConnectServiceV2.listOrganizations(
      create(AdminListOrganizationsRequestSchema),
      context
    );

    expect(response.organizations).toMatchObject([
      {
        id: 'org-1',
        name: 'Org One',
        createdAt: '2026-03-09T00:00:00.000Z',
        updatedAt: '2026-03-09T00:05:00.000Z'
      }
    ]);
    expect(response.organizations[0]?.description).toBeUndefined();
  });

  it('forwards createGroup payload fields directly to group mutations', async () => {
    mocks.createGroupDirect.mockResolvedValueOnce({
      group: {
        id: 'group-1',
        organizationId: 'org-1',
        name: 'Engineering',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    });

    const response = await adminConnectServiceV2.createGroup(
      create(AdminCreateGroupRequestSchema, {
        organizationId: 'org-1',
        name: 'Engineering'
      }),
      context
    );

    expect(response.group?.id).toBe('group-1');
    expect(response.group?.organizationId).toBe('org-1');
    expect(response.group?.description).toBeUndefined();
    const firstCall = mocks.createGroupDirect.mock.calls[0];
    expect(firstCall).toBeDefined();
    const requestArg = firstCall?.[0];
    expect(requestArg).toBeDefined();
    expect(requestArg).toEqual({
      organizationId: 'org-1',
      name: 'Engineering'
    });
  });

  it('maps updateUser organization ids payload for direct handlers', async () => {
    mocks.updateUserDirect.mockResolvedValueOnce({
      json: JSON.stringify({
        user: {
          id: 'user-1',
          email: 'user@example.com',
          emailConfirmed: true,
          admin: false,
          organizationIds: ['org-1'],
          accounting: {
            totalPromptTokens: 0,
            totalCompletionTokens: 0,
            totalTokens: 0,
            requestCount: 0
          },
          disabled: true
        }
      })
    });

    await adminConnectServiceV2.updateUser(
      create(AdminUpdateUserRequestSchema, {
        id: 'user-1',
        organizationIds: create(AdminUpdateUserOrganizationIdsSchema, {
          organizationIds: ['org-1']
        }),
        disabled: true
      }),
      context
    );

    const firstCall = mocks.updateUserDirect.mock.calls[0];
    expect(firstCall).toBeDefined();
    const requestArg = firstCall?.[0];
    expect(requestArg).toEqual({
      id: 'user-1',
      organizationIds: ['org-1'],
      disabled: true
    });
  });
});
