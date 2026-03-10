import { create } from '@bufbuild/protobuf';
import { Code } from '@connectrpc/connect';
import {
  AdminCreateGroupRequestSchema,
  AdminGetContextRequestSchema,
  AdminGetOrganizationRequestSchema,
  AdminGetRedisValueRequestSchema,
  AdminGetUserRequestSchema
} from '@tearleads/shared/gen/tearleads/v2/admin_pb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = {
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
};

vi.mock('./adminDirectContext.js', () => ({
  getContextDirect: (...args: unknown[]) => mocks.getContextDirect(...args)
}));

vi.mock('./adminDirectGroupMutations.js', () => ({
  addGroupMemberDirect: (...args: unknown[]) =>
    mocks.addGroupMemberDirect(...args),
  createGroupDirect: (...args: unknown[]) => mocks.createGroupDirect(...args),
  deleteGroupDirect: (...args: unknown[]) => mocks.deleteGroupDirect(...args),
  removeGroupMemberDirect: (...args: unknown[]) =>
    mocks.removeGroupMemberDirect(...args),
  updateGroupDirect: (...args: unknown[]) => mocks.updateGroupDirect(...args)
}));

vi.mock('./adminDirectGroups.js', () => ({
  getGroupDirect: (...args: unknown[]) => mocks.getGroupDirect(...args),
  getGroupMembersDirect: (...args: unknown[]) =>
    mocks.getGroupMembersDirect(...args),
  listGroupsDirect: (...args: unknown[]) => mocks.listGroupsDirect(...args)
}));

vi.mock('./adminDirectOrganizations.js', () => ({
  createOrganizationDirect: (...args: unknown[]) =>
    mocks.createOrganizationDirect(...args),
  deleteOrganizationDirect: (...args: unknown[]) =>
    mocks.deleteOrganizationDirect(...args),
  getOrganizationDirect: (...args: unknown[]) =>
    mocks.getOrganizationDirect(...args),
  getOrganizationGroupsDirect: (...args: unknown[]) =>
    mocks.getOrganizationGroupsDirect(...args),
  getOrganizationUsersDirect: (...args: unknown[]) =>
    mocks.getOrganizationUsersDirect(...args),
  listOrganizationsDirect: (...args: unknown[]) =>
    mocks.listOrganizationsDirect(...args),
  updateOrganizationDirect: (...args: unknown[]) =>
    mocks.updateOrganizationDirect(...args)
}));

vi.mock('./adminDirectPostgres.js', () => ({
  getColumnsDirect: (...args: unknown[]) => mocks.getColumnsDirect(...args),
  getPostgresInfoDirect: (...args: unknown[]) =>
    mocks.getPostgresInfoDirect(...args),
  getRowsDirect: (...args: unknown[]) => mocks.getRowsDirect(...args),
  getTablesDirect: (...args: unknown[]) => mocks.getTablesDirect(...args)
}));

vi.mock('./adminDirectRedis.js', () => ({
  deleteRedisKeyDirect: (...args: unknown[]) =>
    mocks.deleteRedisKeyDirect(...args),
  getRedisDbSizeDirect: (...args: unknown[]) =>
    mocks.getRedisDbSizeDirect(...args),
  getRedisKeysDirect: (...args: unknown[]) => mocks.getRedisKeysDirect(...args),
  getRedisValueDirect: (...args: unknown[]) =>
    mocks.getRedisValueDirect(...args)
}));

vi.mock('./adminDirectUsers.js', () => ({
  getUserDirect: (...args: unknown[]) => mocks.getUserDirect(...args),
  listUsersDirect: (...args: unknown[]) => mocks.listUsersDirect(...args),
  updateUserDirect: (...args: unknown[]) => mocks.updateUserDirect(...args)
}));

import { adminConnectServiceV2 } from './adminServiceV2.js';

const context = {
  requestHeader: new Headers()
};

describe('adminConnectServiceV2 error branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes through redis responses with no populated oneof case', async () => {
    mocks.getRedisValueDirect.mockResolvedValueOnce({
      key: 'zset-key',
      type: 'zset',
      ttl: -1n
    });

    const response = await adminConnectServiceV2.getRedisValue(
      create(AdminGetRedisValueRequestSchema, { key: 'counter' }),
      context
    );

    expect(response.key).toBe('zset-key');
    expect(response.type).toBe('zset');
    expect(response.ttl).toBe(-1n);
    expect(response.value?.value.case).toBeUndefined();
  });

  it('propagates redis handler errors without JSON decode wrapping', async () => {
    mocks.getRedisValueDirect.mockRejectedValueOnce({
      code: Code.Internal
    });

    await expect(
      adminConnectServiceV2.getRedisValue(
        create(AdminGetRedisValueRequestSchema, { key: 'broken' }),
        context
      )
    ).rejects.toMatchObject({ code: Code.Internal });
  });

  it('propagates organization handler errors without JSON decode wrapping', async () => {
    mocks.getOrganizationDirect.mockRejectedValueOnce({
      code: Code.Internal
    });

    await expect(
      adminConnectServiceV2.getOrganization(
        create(AdminGetOrganizationRequestSchema, { id: 'org-broken' }),
        context
      )
    ).rejects.toMatchObject({ code: Code.Internal });
  });

  it('propagates group mutation errors without JSON decode wrapping', async () => {
    mocks.createGroupDirect.mockRejectedValueOnce({
      code: Code.Internal
    });

    await expect(
      adminConnectServiceV2.createGroup(
        create(AdminCreateGroupRequestSchema, {
          organizationId: 'org-broken',
          name: 'Broken'
        }),
        context
      )
    ).rejects.toMatchObject({ code: Code.Internal });
  });

  it('propagates user handler errors without JSON decode wrapping', async () => {
    mocks.getUserDirect.mockRejectedValueOnce({
      code: Code.Internal
    });

    await expect(
      adminConnectServiceV2.getUser(
        create(AdminGetUserRequestSchema, { id: 'user-broken' }),
        context
      )
    ).rejects.toMatchObject({ code: Code.Internal });
  });

  it('propagates context handler errors without JSON decode wrapping', async () => {
    mocks.getContextDirect.mockRejectedValueOnce({
      code: Code.PermissionDenied
    });

    await expect(
      adminConnectServiceV2.getContext(
        create(AdminGetContextRequestSchema),
        context
      )
    ).rejects.toMatchObject({ code: Code.PermissionDenied });
  });
});
