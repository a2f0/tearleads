const user1 = {
  id: 'user-1',
  email: 'admin@example.com',
  emailConfirmed: true,
  admin: true,
  organizationIds: ['org-1'],
  createdAt: '2024-01-01T12:00:00.000Z',
  lastActiveAt: '2024-01-10T18:30:00.000Z',
  accounting: {
    totalPromptTokens: 120,
    totalCompletionTokens: 80,
    totalTokens: 200,
    requestCount: 3,
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
  lastActiveAt: null,
  accounting: {
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalTokens: 0,
    requestCount: 0,
    lastUsedAt: null
  }
};

type UserShape = typeof user1;
type UserResponse = { user: UserShape };

type AccountingOverrides = Partial<UserShape['accounting']>;

type UserOverrides = Omit<Partial<UserShape>, 'accounting'> & {
  accounting?: AccountingOverrides;
};

const buildUserResponse = (
  baseUser: UserShape,
  overrides: UserOverrides = {}
): UserResponse => ({
  user: {
    ...baseUser,
    ...overrides,
    accounting: {
      ...baseUser.accounting,
      ...overrides.accounting
    }
  }
});

const user1Response = buildUserResponse(user1);
const user2Response = buildUserResponse(user2);

export { buildUserResponse, user1, user1Response, user2, user2Response };
