import { create } from '@bufbuild/protobuf';
import { Code } from '@connectrpc/connect';
import {
  AdminCreateGroupRequestSchema,
  AdminGetContextRequestSchema,
  AdminGetOrganizationRequestSchema,
  AdminGetRedisValueRequestSchema
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
