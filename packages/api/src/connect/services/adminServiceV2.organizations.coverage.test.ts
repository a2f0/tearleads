import { create } from '@bufbuild/protobuf';
import {
  AdminCreateOrganizationRequestSchema,
  AdminDeleteOrganizationRequestSchema,
  AdminGetOrganizationRequestSchema,
  AdminGetOrgGroupsRequestSchema,
  AdminGetOrgUsersRequestSchema,
  AdminListOrganizationsRequestSchema,
  AdminUpdateOrganizationRequestSchema
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

describe('adminConnectServiceV2 organization coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards organization handlers and applies organization defaults', async () => {
    mocks.listOrganizationsDirect.mockResolvedValue({ organizations: [] });
    mocks.getOrganizationDirect.mockResolvedValue({});
    mocks.getOrganizationUsersDirect.mockResolvedValue({ users: [] });
    mocks.getOrganizationGroupsDirect.mockResolvedValue({ groups: [] });
    mocks.deleteOrganizationDirect.mockResolvedValue({ deleted: false });

    await adminConnectServiceV2.listOrganizations(
      create(AdminListOrganizationsRequestSchema),
      context
    );
    await adminConnectServiceV2.listOrganizations(
      create(AdminListOrganizationsRequestSchema, { organizationId: 'org-1' }),
      context
    );
    await adminConnectServiceV2.getOrganization(
      create(AdminGetOrganizationRequestSchema, { id: 'org-1' }),
      context
    );
    await adminConnectServiceV2.getOrgUsers(
      create(AdminGetOrgUsersRequestSchema, { id: 'org-1' }),
      context
    );
    await adminConnectServiceV2.getOrgGroups(
      create(AdminGetOrgGroupsRequestSchema, { id: 'org-1' }),
      context
    );
    await adminConnectServiceV2.deleteOrganization(
      create(AdminDeleteOrganizationRequestSchema, { id: 'org-1' }),
      context
    );

    expect(mocks.listOrganizationsDirect).toHaveBeenNthCalledWith(
      1,
      { organizationId: '' },
      context
    );
    expect(mocks.listOrganizationsDirect).toHaveBeenNthCalledWith(
      2,
      { organizationId: 'org-1' },
      context
    );
    expect(mocks.getOrganizationUsersDirect).toHaveBeenCalledWith(
      { id: 'org-1' },
      context
    );
    expect(mocks.getOrganizationGroupsDirect).toHaveBeenCalledWith(
      { id: 'org-1' },
      context
    );
  });

  it('maps organization mutation payloads', async () => {
    mocks.createOrganizationDirect.mockResolvedValue({});
    mocks.updateOrganizationDirect.mockResolvedValue({});

    await adminConnectServiceV2.createOrganization(
      create(AdminCreateOrganizationRequestSchema, {
        name: 'Org 2',
        description: 'Org description'
      }),
      context
    );
    await adminConnectServiceV2.updateOrganization(
      create(AdminUpdateOrganizationRequestSchema, {
        id: 'org-2',
        name: 'Org 2 Updated',
        description: 'Updated org'
      }),
      context
    );
    await adminConnectServiceV2.updateOrganization(
      create(AdminUpdateOrganizationRequestSchema, { id: 'org-3' }),
      context
    );

    expect(mocks.createOrganizationDirect.mock.calls[0]?.[0]).toEqual({
      name: 'Org 2',
      description: 'Org description'
    });
    expect(mocks.updateOrganizationDirect.mock.calls[0]?.[0]).toEqual({
      id: 'org-2',
      name: 'Org 2 Updated',
      description: 'Updated org'
    });
    expect(mocks.updateOrganizationDirect.mock.calls[1]?.[0]).toEqual({
      id: 'org-3'
    });
  });
});
