import { create } from '@bufbuild/protobuf';
import {
  type AdminUser,
  AdminUserSchema
} from '@tearleads/shared/gen/tearleads/v2/admin_pb';

const user1 = {
  id: 'user-1',
  email: 'admin@example.com',
  emailConfirmed: true,
  admin: true,
  organizationIds: ['org-1'],
  createdAt: '2024-01-01T12:00:00.000Z',
  lastActiveAt: '2024-01-10T18:30:00.000Z',
  disabled: false,
  accounting: {
    totalPromptTokens: 120n,
    totalCompletionTokens: 80n,
    totalTokens: 200n,
    requestCount: 3n,
    lastUsedAt: '2024-01-09T12:00:00.000Z'
  }
};

const user2 = {
  id: 'user-2',
  email: 'regular@example.com',
  emailConfirmed: false,
  admin: false,
  organizationIds: [],
  createdAt: '2024-02-14T08:15:00.000Z',
  disabled: false,
  accounting: {
    totalPromptTokens: 0n,
    totalCompletionTokens: 0n,
    totalTokens: 0n,
    requestCount: 0n
  }
};

type UserShape = typeof user1;
type UserResponse = { user: AdminUser };

type AccountingOverrides = Partial<UserShape['accounting']>;

type UserOverrides = Omit<Partial<UserShape>, 'accounting'> & {
  accounting?: AccountingOverrides;
};

const buildUser = (
  baseUser: UserShape,
  overrides: UserOverrides = {}
): AdminUser =>
  create(AdminUserSchema, {
    ...baseUser,
    ...overrides,
    accounting: {
      ...baseUser.accounting,
      ...overrides.accounting
    }
  });

const buildUserResponse = (
  baseUser: UserShape,
  overrides: UserOverrides = {}
): UserResponse => ({
  user: buildUser(baseUser, overrides)
});

const user1Response = { user: buildUser(user1) };
const user2Response = { user: buildUser(user2) };

export { buildUserResponse, user1, user1Response, user2, user2Response };
