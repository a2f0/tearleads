import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../index.js';
import { createAuthHeader } from '../../test/auth.js';

const mockQuery = vi.fn();
const mockGetPostgresPool = vi.fn();
const mockGetLatestLastActiveByUserIds = vi.fn();

vi.mock('../../lib/postgres.js', () => ({
  getPostgresPool: () => mockGetPostgresPool()
}));

const mockDeleteAllSessionsForUser = vi.fn();

vi.mock('../../lib/sessions.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/sessions.js')>();
  return {
    ...actual,
    getLatestLastActiveByUserIds: (userIds: string[]) =>
      mockGetLatestLastActiveByUserIds(userIds),
    deleteAllSessionsForUser: (userId: string) =>
      mockDeleteAllSessionsForUser(userId)
  };
});

describe('admin users routes', () => {
  let authHeader: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockQuery.mockReset();
    mockGetLatestLastActiveByUserIds.mockResolvedValue({});
    mockDeleteAllSessionsForUser.mockResolvedValue(0);
    vi.stubEnv('JWT_SECRET', 'test-secret');
    mockGetPostgresPool.mockResolvedValue({ query: mockQuery });
    authHeader = await createAuthHeader({
      id: 'user-1',
      email: 'user@example.com',
      admin: true
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('GET /v1/admin/users returns users', async () => {
    mockGetLatestLastActiveByUserIds.mockResolvedValue({
      'user-1': '2024-01-05T00:00:00.000Z',
      'user-2': null
    });
    mockGetPostgresPool.mockResolvedValue({
      query: mockQuery
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'user-1',
              email: 'alpha@example.com',
              email_confirmed: true,
              admin: false,
              disabled: false,
              disabled_at: null,
              disabled_by: null,
              marked_for_deletion_at: null,
              marked_for_deletion_by: null,
              organization_ids: [],
              created_at: new Date('2024-01-01T00:00:00.000Z')
            },
            {
              id: 'user-2',
              email: 'beta@example.com',
              email_confirmed: false,
              admin: true,
              disabled: false,
              disabled_at: null,
              disabled_by: null,
              marked_for_deletion_at: null,
              marked_for_deletion_by: null,
              organization_ids: ['org-1'],
              created_at: '2024-02-01T00:00:00.000Z'
            }
          ]
        })
        .mockResolvedValueOnce({
          rows: [
            {
              user_id: 'user-1',
              total_prompt_tokens: '120',
              total_completion_tokens: '80',
              total_tokens: '200',
              request_count: '3',
              last_used_at: new Date('2024-01-04T00:00:00.000Z')
            }
          ]
        })
    });

    const response = await request(app)
      .get('/v1/admin/users')
      .set('Authorization', authHeader);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      users: [
        {
          id: 'user-1',
          email: 'alpha@example.com',
          emailConfirmed: true,
          admin: false,
          disabled: false,
          disabledAt: null,
          disabledBy: null,
          markedForDeletionAt: null,
          markedForDeletionBy: null,
          organizationIds: [],
          createdAt: '2024-01-01T00:00:00.000Z',
          lastActiveAt: '2024-01-05T00:00:00.000Z',
          accounting: {
            totalPromptTokens: 120,
            totalCompletionTokens: 80,
            totalTokens: 200,
            requestCount: 3,
            lastUsedAt: '2024-01-04T00:00:00.000Z'
          }
        },
        {
          id: 'user-2',
          email: 'beta@example.com',
          emailConfirmed: false,
          admin: true,
          disabled: false,
          disabledAt: null,
          disabledBy: null,
          markedForDeletionAt: null,
          markedForDeletionBy: null,
          organizationIds: ['org-1'],
          createdAt: '2024-02-01T00:00:00.000Z',
          lastActiveAt: null,
          accounting: {
            totalPromptTokens: 0,
            totalCompletionTokens: 0,
            totalTokens: 0,
            requestCount: 0,
            lastUsedAt: null
          }
        }
      ]
    });
  });

  it('GET /v1/admin/users returns empty users list', async () => {
    mockGetPostgresPool.mockResolvedValue({
      query: mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
    });

    const response = await request(app)
      .get('/v1/admin/users')
      .set('Authorization', authHeader);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ users: [] });
  });

  it('GET /v1/admin/users returns 500 on error', async () => {
    mockGetPostgresPool.mockResolvedValue({
      query: mockQuery.mockRejectedValueOnce(new Error('query failed'))
    });
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const response = await request(app)
      .get('/v1/admin/users')
      .set('Authorization', authHeader);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'query failed' });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('GET /v1/admin/users/:id returns a single user', async () => {
    mockGetPostgresPool.mockResolvedValue({
      query: mockQuery
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'user-1',
              email: 'alpha@example.com',
              email_confirmed: true,
              admin: false,
              disabled: false,
              disabled_at: null,
              disabled_by: null,
              marked_for_deletion_at: null,
              marked_for_deletion_by: null,
              organization_ids: ['org-1', 'org-2']
            }
          ]
        })
        .mockResolvedValueOnce({
          rows: [
            {
              user_id: 'user-1',
              total_prompt_tokens: '30',
              total_completion_tokens: '70',
              total_tokens: '100',
              request_count: '1',
              last_used_at: new Date('2024-02-02T00:00:00.000Z')
            }
          ]
        })
    });

    const response = await request(app)
      .get('/v1/admin/users/user-1')
      .set('Authorization', authHeader);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      user: {
        id: 'user-1',
        email: 'alpha@example.com',
        emailConfirmed: true,
        admin: false,
        disabled: false,
        disabledAt: null,
        disabledBy: null,
        markedForDeletionAt: null,
        markedForDeletionBy: null,
        organizationIds: ['org-1', 'org-2'],
        createdAt: null,
        lastActiveAt: null,
        accounting: {
          totalPromptTokens: 30,
          totalCompletionTokens: 70,
          totalTokens: 100,
          requestCount: 1,
          lastUsedAt: '2024-02-02T00:00:00.000Z'
        }
      }
    });
  });

  it('GET /v1/admin/users/:id returns 404 when user not found', async () => {
    mockGetPostgresPool.mockResolvedValue({
      query: mockQuery.mockResolvedValue({ rows: [] })
    });

    const response = await request(app)
      .get('/v1/admin/users/nonexistent')
      .set('Authorization', authHeader);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'User not found' });
  });

  it('GET /v1/admin/users/:id returns 500 on error', async () => {
    mockGetPostgresPool.mockResolvedValue({
      query: mockQuery.mockRejectedValueOnce(new Error('query failed'))
    });
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const response = await request(app)
      .get('/v1/admin/users/user-1')
      .set('Authorization', authHeader);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'query failed' });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('PATCH /v1/admin/users/:id updates a user', async () => {
    mockGetPostgresPool.mockResolvedValue({ query: mockQuery });
    mockQuery.mockImplementation((query: string) => {
      const trimmedQuery = query.trimStart();
      if (query === 'BEGIN' || query === 'COMMIT') {
        return Promise.resolve({ rows: [] });
      }
      if (trimmedQuery.startsWith('UPDATE users')) {
        return Promise.resolve({
          rows: [
            {
              id: 'user-1',
              email: 'updated@example.com',
              email_confirmed: true,
              admin: true,
              disabled: false,
              disabled_at: null,
              disabled_by: null,
              marked_for_deletion_at: null,
              marked_for_deletion_by: null
            }
          ]
        });
      }
      if (query.startsWith('SELECT organization_id FROM user_organizations')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const response = await request(app)
      .patch('/v1/admin/users/user-1')
      .set('Authorization', authHeader)
      .send({ email: 'updated@example.com', admin: true });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      user: {
        id: 'user-1',
        email: 'updated@example.com',
        emailConfirmed: true,
        admin: true,
        disabled: false,
        disabledAt: null,
        disabledBy: null,
        markedForDeletionAt: null,
        markedForDeletionBy: null,
        organizationIds: [],
        createdAt: null,
        lastActiveAt: null,
        accounting: {
          totalPromptTokens: 0,
          totalCompletionTokens: 0,
          totalTokens: 0,
          requestCount: 0,
          lastUsedAt: null
        }
      }
    });
    expect(mockQuery).toHaveBeenCalled();
  });

  it('PATCH /v1/admin/users/:id returns 400 for invalid payload', async () => {
    const response = await request(app)
      .patch('/v1/admin/users/user-1')
      .set('Authorization', authHeader)
      .send({ emailConfirmed: 'yes' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Invalid user update payload' });
  });

  it('PATCH /v1/admin/users/:id returns 400 for non-string email', async () => {
    const response = await request(app)
      .patch('/v1/admin/users/user-1')
      .set('Authorization', authHeader)
      .send({ email: 123 });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Invalid user update payload' });
  });

  it('PATCH /v1/admin/users/:id returns 400 for empty email', async () => {
    const response = await request(app)
      .patch('/v1/admin/users/user-1')
      .set('Authorization', authHeader)
      .send({ email: '   ' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Invalid user update payload' });
  });

  it('PATCH /v1/admin/users/:id returns 400 for non-boolean admin', async () => {
    const response = await request(app)
      .patch('/v1/admin/users/user-1')
      .set('Authorization', authHeader)
      .send({ admin: 'yes' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Invalid user update payload' });
  });

  it('PATCH /v1/admin/users/:id returns 400 for empty update object', async () => {
    const response = await request(app)
      .patch('/v1/admin/users/user-1')
      .set('Authorization', authHeader)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Invalid user update payload' });
  });

  it('PATCH /v1/admin/users/:id returns 404 when user is missing', async () => {
    mockGetPostgresPool.mockResolvedValue({ query: mockQuery });
    mockQuery.mockImplementation((query: string) => {
      const trimmedQuery = query.trimStart();
      if (query === 'BEGIN' || query === 'ROLLBACK') {
        return Promise.resolve({ rows: [] });
      }
      if (trimmedQuery.startsWith('UPDATE users')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const response = await request(app)
      .patch('/v1/admin/users/user-1')
      .set('Authorization', authHeader)
      .send({ admin: true });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'User not found' });
  });

  it('returns 403 when session is not admin', async () => {
    const nonAdminHeader = await createAuthHeader({
      id: 'user-2',
      email: 'user@example.com',
      admin: false
    });

    const response = await request(app)
      .get('/v1/admin/users')
      .set('Authorization', nonAdminHeader);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'Forbidden' });
  });

  it('PATCH /v1/admin/users/:id updates emailConfirmed field', async () => {
    mockGetPostgresPool.mockResolvedValue({ query: mockQuery });
    mockQuery.mockImplementation((query: string) => {
      const trimmedQuery = query.trimStart();
      if (query === 'BEGIN' || query === 'COMMIT') {
        return Promise.resolve({ rows: [] });
      }
      if (trimmedQuery.startsWith('UPDATE users')) {
        return Promise.resolve({
          rows: [
            {
              id: 'user-1',
              email: 'user@example.com',
              email_confirmed: true,
              admin: false,
              disabled: false,
              disabled_at: null,
              disabled_by: null,
              marked_for_deletion_at: null,
              marked_for_deletion_by: null
            }
          ]
        });
      }
      if (query.startsWith('SELECT organization_id FROM user_organizations')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const response = await request(app)
      .patch('/v1/admin/users/user-1')
      .set('Authorization', authHeader)
      .send({ emailConfirmed: true });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      user: {
        id: 'user-1',
        email: 'user@example.com',
        emailConfirmed: true,
        admin: false,
        disabled: false,
        disabledAt: null,
        disabledBy: null,
        markedForDeletionAt: null,
        markedForDeletionBy: null,
        organizationIds: [],
        createdAt: null,
        lastActiveAt: null,
        accounting: {
          totalPromptTokens: 0,
          totalCompletionTokens: 0,
          totalTokens: 0,
          requestCount: 0,
          lastUsedAt: null
        }
      }
    });
  });

  it('PATCH /v1/admin/users/:id updates organization IDs', async () => {
    mockGetPostgresPool.mockResolvedValue({ query: mockQuery });
    mockQuery.mockImplementation((query: string) => {
      if (query === 'BEGIN' || query === 'COMMIT') {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('SELECT id, email, email_confirmed, admin')) {
        return Promise.resolve({
          rows: [
            {
              id: 'user-1',
              email: 'user@example.com',
              email_confirmed: true,
              admin: false,
              disabled: false,
              disabled_at: null,
              disabled_by: null,
              marked_for_deletion_at: null,
              marked_for_deletion_by: null
            }
          ]
        });
      }
      if (query.startsWith('SELECT personal_organization_id FROM users')) {
        return Promise.resolve({
          rows: [{ personal_organization_id: 'org-personal-1' }]
        });
      }
      if (query.startsWith('SELECT id FROM organizations')) {
        return Promise.resolve({
          rows: [{ id: 'org-1' }, { id: 'org-2' }, { id: 'org-personal-1' }]
        });
      }
      if (query.startsWith('DELETE FROM user_organizations')) {
        return Promise.resolve({ rows: [] });
      }
      if (query.startsWith('INSERT INTO user_organizations')) {
        return Promise.resolve({ rows: [] });
      }
      if (query.startsWith('SELECT organization_id FROM user_organizations')) {
        return Promise.resolve({
          rows: [
            { organization_id: 'org-1' },
            { organization_id: 'org-2' },
            { organization_id: 'org-personal-1' }
          ]
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const response = await request(app)
      .patch('/v1/admin/users/user-1')
      .set('Authorization', authHeader)
      .send({ organizationIds: ['org-1', 'org-2'] });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      user: {
        id: 'user-1',
        email: 'user@example.com',
        emailConfirmed: true,
        admin: false,
        disabled: false,
        disabledAt: null,
        disabledBy: null,
        markedForDeletionAt: null,
        markedForDeletionBy: null,
        organizationIds: ['org-1', 'org-2', 'org-personal-1'],
        createdAt: null,
        lastActiveAt: null,
        accounting: {
          totalPromptTokens: 0,
          totalCompletionTokens: 0,
          totalTokens: 0,
          requestCount: 0,
          lastUsedAt: null
        }
      }
    });
  });

  it('PATCH /v1/admin/users/:id clears organization IDs', async () => {
    mockGetPostgresPool.mockResolvedValue({ query: mockQuery });
    mockQuery.mockImplementation((query: string) => {
      if (query === 'BEGIN' || query === 'COMMIT') {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('SELECT id, email, email_confirmed, admin')) {
        return Promise.resolve({
          rows: [
            {
              id: 'user-1',
              email: 'user@example.com',
              email_confirmed: true,
              admin: false,
              disabled: false,
              disabled_at: null,
              disabled_by: null,
              marked_for_deletion_at: null,
              marked_for_deletion_by: null
            }
          ]
        });
      }
      if (query.startsWith('SELECT personal_organization_id FROM users')) {
        return Promise.resolve({
          rows: [{ personal_organization_id: 'org-personal-1' }]
        });
      }
      if (query.startsWith('SELECT id FROM organizations')) {
        return Promise.resolve({ rows: [{ id: 'org-personal-1' }] });
      }
      if (query.startsWith('DELETE FROM user_organizations')) {
        return Promise.resolve({ rows: [] });
      }
      if (query.startsWith('INSERT INTO user_organizations')) {
        return Promise.resolve({ rows: [] });
      }
      if (query.startsWith('SELECT organization_id FROM user_organizations')) {
        return Promise.resolve({
          rows: [{ organization_id: 'org-personal-1' }]
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const response = await request(app)
      .patch('/v1/admin/users/user-1')
      .set('Authorization', authHeader)
      .send({ organizationIds: [] });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      user: {
        id: 'user-1',
        email: 'user@example.com',
        emailConfirmed: true,
        admin: false,
        disabled: false,
        disabledAt: null,
        disabledBy: null,
        markedForDeletionAt: null,
        markedForDeletionBy: null,
        organizationIds: ['org-personal-1'],
        createdAt: null,
        lastActiveAt: null,
        accounting: {
          totalPromptTokens: 0,
          totalCompletionTokens: 0,
          totalTokens: 0,
          requestCount: 0,
          lastUsedAt: null
        }
      }
    });
  });

  it('PATCH /v1/admin/users/:id returns 404 when organization is missing', async () => {
    mockGetPostgresPool.mockResolvedValue({ query: mockQuery });
    mockQuery.mockImplementation((query: string) => {
      if (query === 'BEGIN' || query === 'ROLLBACK') {
        return Promise.resolve({ rows: [] });
      }
      if (query.includes('SELECT id, email, email_confirmed, admin')) {
        return Promise.resolve({
          rows: [
            {
              id: 'user-1',
              email: 'user@example.com',
              email_confirmed: true,
              admin: false,
              disabled: false,
              disabled_at: null,
              disabled_by: null,
              marked_for_deletion_at: null,
              marked_for_deletion_by: null
            }
          ]
        });
      }
      if (query.startsWith('SELECT personal_organization_id FROM users')) {
        return Promise.resolve({
          rows: [{ personal_organization_id: 'org-personal-1' }]
        });
      }
      if (query.startsWith('SELECT id FROM organizations')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const response = await request(app)
      .patch('/v1/admin/users/user-1')
      .set('Authorization', authHeader)
      .send({ organizationIds: ['missing-org'] });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'Organization not found' });
  });

  it('PATCH /v1/admin/users/:id returns 400 for invalid organizationIds', async () => {
    const response = await request(app)
      .patch('/v1/admin/users/user-1')
      .set('Authorization', authHeader)
      .send({ organizationIds: [123] });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Invalid user update payload' });
  });

  it('PATCH /v1/admin/users/:id returns 400 for non-array organizationIds', async () => {
    const response = await request(app)
      .patch('/v1/admin/users/user-1')
      .set('Authorization', authHeader)
      .send({ organizationIds: 'org-1' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Invalid user update payload' });
  });

  it('PATCH /v1/admin/users/:id returns 500 on database error', async () => {
    mockGetPostgresPool.mockResolvedValue({ query: mockQuery });
    mockQuery.mockImplementation((query: string) => {
      const trimmedQuery = query.trimStart();
      if (query === 'BEGIN') {
        return Promise.resolve({ rows: [] });
      }
      if (trimmedQuery.startsWith('UPDATE users')) {
        return Promise.reject(new Error('database error'));
      }
      if (query === 'ROLLBACK') {
        return Promise.reject(new Error('rollback failed'));
      }
      return Promise.resolve({ rows: [] });
    });
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const response = await request(app)
      .patch('/v1/admin/users/user-1')
      .set('Authorization', authHeader)
      .send({ admin: true });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'database error' });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  // COMPLIANCE_SENTINEL: TL-ACCT-002 | policy=compliance/SOC2/policies/account-management-policy.md | procedure=compliance/SOC2/procedures/account-management-procedure.md | control=account-disable-attribution
  it('PATCH /v1/admin/users/:id disables a user and deletes sessions', async () => {
    mockGetPostgresPool.mockResolvedValue({ query: mockQuery });
    mockQuery.mockImplementation((query: string) => {
      const trimmedQuery = query.trimStart();
      if (query === 'BEGIN' || query === 'COMMIT') {
        return Promise.resolve({ rows: [] });
      }
      if (trimmedQuery.startsWith('UPDATE users')) {
        return Promise.resolve({
          rows: [
            {
              id: 'user-2',
              email: 'user@example.com',
              email_confirmed: true,
              admin: false,
              disabled: true,
              disabled_at: new Date('2024-01-15T00:00:00.000Z'),
              disabled_by: 'user-1',
              marked_for_deletion_at: null,
              marked_for_deletion_by: null
            }
          ]
        });
      }
      if (query.startsWith('SELECT organization_id FROM user_organizations')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });
    mockDeleteAllSessionsForUser.mockResolvedValue(3);

    const response = await request(app)
      .patch('/v1/admin/users/user-2')
      .set('Authorization', authHeader)
      .send({ disabled: true });

    expect(response.status).toBe(200);
    expect(response.body.user.disabled).toBe(true);
    expect(response.body.user.disabledAt).toBe('2024-01-15T00:00:00.000Z');
    expect(response.body.user.disabledBy).toBe('user-1');
    expect(mockDeleteAllSessionsForUser).toHaveBeenCalledWith('user-2');
  });

  it('PATCH /v1/admin/users/:id re-enables a user', async () => {
    mockGetPostgresPool.mockResolvedValue({ query: mockQuery });
    mockQuery.mockImplementation((query: string) => {
      const trimmedQuery = query.trimStart();
      if (query === 'BEGIN' || query === 'COMMIT') {
        return Promise.resolve({ rows: [] });
      }
      if (trimmedQuery.startsWith('UPDATE users')) {
        return Promise.resolve({
          rows: [
            {
              id: 'user-2',
              email: 'user@example.com',
              email_confirmed: true,
              admin: false,
              disabled: false,
              disabled_at: null,
              disabled_by: null,
              marked_for_deletion_at: null,
              marked_for_deletion_by: null
            }
          ]
        });
      }
      if (query.startsWith('SELECT organization_id FROM user_organizations')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const response = await request(app)
      .patch('/v1/admin/users/user-2')
      .set('Authorization', authHeader)
      .send({ disabled: false });

    expect(response.status).toBe(200);
    expect(response.body.user.disabled).toBe(false);
    expect(response.body.user.disabledAt).toBeNull();
    expect(response.body.user.disabledBy).toBeNull();
    expect(mockDeleteAllSessionsForUser).not.toHaveBeenCalled();
  });

  // COMPLIANCE_SENTINEL: TL-ACCT-003 | policy=compliance/SOC2/policies/account-management-policy.md | procedure=compliance/SOC2/procedures/account-management-procedure.md | control=deletion-marking-attribution
  it('PATCH /v1/admin/users/:id marks user for deletion', async () => {
    mockGetPostgresPool.mockResolvedValue({ query: mockQuery });
    mockQuery.mockImplementation((query: string) => {
      const trimmedQuery = query.trimStart();
      if (query === 'BEGIN' || query === 'COMMIT') {
        return Promise.resolve({ rows: [] });
      }
      if (trimmedQuery.startsWith('UPDATE users')) {
        return Promise.resolve({
          rows: [
            {
              id: 'user-2',
              email: 'user@example.com',
              email_confirmed: true,
              admin: false,
              disabled: false,
              disabled_at: null,
              disabled_by: null,
              marked_for_deletion_at: new Date('2024-01-15T00:00:00.000Z'),
              marked_for_deletion_by: 'user-1'
            }
          ]
        });
      }
      if (query.startsWith('SELECT organization_id FROM user_organizations')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const response = await request(app)
      .patch('/v1/admin/users/user-2')
      .set('Authorization', authHeader)
      .send({ markedForDeletion: true });

    expect(response.status).toBe(200);
    expect(response.body.user.markedForDeletionAt).toBe(
      '2024-01-15T00:00:00.000Z'
    );
    expect(response.body.user.markedForDeletionBy).toBe('user-1');
  });

  it('PATCH /v1/admin/users/:id unmarks user for deletion', async () => {
    mockGetPostgresPool.mockResolvedValue({ query: mockQuery });
    mockQuery.mockImplementation((query: string) => {
      const trimmedQuery = query.trimStart();
      if (query === 'BEGIN' || query === 'COMMIT') {
        return Promise.resolve({ rows: [] });
      }
      if (trimmedQuery.startsWith('UPDATE users')) {
        return Promise.resolve({
          rows: [
            {
              id: 'user-2',
              email: 'user@example.com',
              email_confirmed: true,
              admin: false,
              disabled: false,
              disabled_at: null,
              disabled_by: null,
              marked_for_deletion_at: null,
              marked_for_deletion_by: null
            }
          ]
        });
      }
      if (query.startsWith('SELECT organization_id FROM user_organizations')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const response = await request(app)
      .patch('/v1/admin/users/user-2')
      .set('Authorization', authHeader)
      .send({ markedForDeletion: false });

    expect(response.status).toBe(200);
    expect(response.body.user.markedForDeletionAt).toBeNull();
    expect(response.body.user.markedForDeletionBy).toBeNull();
  });

  it('PATCH /v1/admin/users/:id returns 400 for non-boolean disabled', async () => {
    const response = await request(app)
      .patch('/v1/admin/users/user-1')
      .set('Authorization', authHeader)
      .send({ disabled: 'yes' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Invalid user update payload' });
  });

  it('PATCH /v1/admin/users/:id returns 400 for non-boolean markedForDeletion', async () => {
    const response = await request(app)
      .patch('/v1/admin/users/user-1')
      .set('Authorization', authHeader)
      .send({ markedForDeletion: 'yes' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Invalid user update payload' });
  });
});
