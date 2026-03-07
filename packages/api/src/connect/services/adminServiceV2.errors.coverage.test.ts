import { create } from '@bufbuild/protobuf';
import { Code } from '@connectrpc/connect';
import {
  AdminGetContextRequestSchema,
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

  it('drops unsupported redis value payloads instead of mapping them', async () => {
    mocks.getRedisValueDirect.mockResolvedValueOnce({
      json: JSON.stringify({
        key: 1,
        type: false,
        ttl: null,
        value: [1]
      })
    });

    const response = await adminConnectServiceV2.getRedisValue(
      create(AdminGetRedisValueRequestSchema, { key: 'counter' }),
      context
    );

    expect(response.key).toBe('');
    expect(response.type).toBe('');
    expect(response.value?.value.case).toBeUndefined();
  });

  it('throws internal error when redis response JSON is invalid', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    mocks.getRedisValueDirect.mockResolvedValueOnce({ json: '{' });

    await expect(
      adminConnectServiceV2.getRedisValue(
        create(AdminGetRedisValueRequestSchema, { key: 'broken' }),
        context
      )
    ).rejects.toMatchObject({ code: Code.Internal });

    consoleError.mockRestore();
  });

  it('throws internal error when redis response JSON is not an object', async () => {
    mocks.getRedisValueDirect.mockResolvedValueOnce({ json: '42' });

    await expect(
      adminConnectServiceV2.getRedisValue(
        create(AdminGetRedisValueRequestSchema, { key: 'broken' }),
        context
      )
    ).rejects.toMatchObject({ code: Code.Internal });
  });

  it('throws internal error when decoded JSON is invalid for protobuf', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    mocks.getContextDirect.mockResolvedValueOnce({ json: '{' });

    await expect(
      adminConnectServiceV2.getContext(
        create(AdminGetContextRequestSchema),
        context
      )
    ).rejects.toMatchObject({ code: Code.Internal });

    consoleError.mockRestore();
  });
});
