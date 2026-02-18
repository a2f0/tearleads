import type { AdminUsersResponse } from '@tearleads/shared';

const initialAdminUsers: AdminUsersResponse['users'] = [
  {
    id: 'user-1',
    email: 'admin@example.com',
    emailConfirmed: true,
    admin: true,
    disabled: false,
    disabledAt: null,
    disabledBy: null,
    markedForDeletionAt: null,
    markedForDeletionBy: null,
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
  },
  {
    id: 'user-2',
    email: 'user@example.com',
    emailConfirmed: false,
    admin: false,
    disabled: false,
    disabledAt: null,
    disabledBy: null,
    markedForDeletionAt: null,
    markedForDeletionBy: null,
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
  }
];

let adminUsers: AdminUsersResponse['users'] =
  structuredClone(initialAdminUsers);

export const resetMockApiState = (): void => {
  adminUsers = structuredClone(initialAdminUsers);
};

export const getAdminUsers = (): AdminUsersResponse['users'] => adminUsers;

export const setAdminUsers = (nextUsers: AdminUsersResponse['users']): void => {
  adminUsers = nextUsers;
};
