import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../index.js';
import { createAuthHeader } from '../../test/auth.js';

const mockQuery = vi.fn();
const mockGetPostgresPool = vi.fn();
const mockDeleteAllSessionsForUser = vi.fn();

vi.mock('../../lib/postgres.js', () => ({
  getPostgresPool: () => mockGetPostgresPool()
}));

vi.mock('../../lib/sessions.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/sessions.js')>();
  return {
    ...actual,
    getLatestLastActiveByUserIds: vi.fn().mockResolvedValue({}),
    deleteAllSessionsForUser: (userId: string) =>
      mockDeleteAllSessionsForUser(userId)
  };
});

describe('admin users routes - PATCH organizations and status', () => {
  let authHeader: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockQuery.mockReset();
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

  describe('PATCH /v1/admin/users/:id - organization updates', () => {
    it('updates organization IDs', async () => {
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
        if (
          query.startsWith('SELECT organization_id FROM user_organizations')
        ) {
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

    it('clears organization IDs', async () => {
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
        if (
          query.startsWith('SELECT organization_id FROM user_organizations')
        ) {
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

    it('returns 404 when organization is missing', async () => {
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
  });

  describe('PATCH /v1/admin/users/:id - disable/enable', () => {
    // COMPLIANCE_SENTINEL: TL-ACCT-002 | policy=compliance/SOC2/policies/01-account-management-policy.md | procedure=compliance/SOC2/procedures/01-account-management-procedure.md | control=account-disable-attribution
    it('disables a user and deletes sessions', async () => {
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
        if (
          query.startsWith('SELECT organization_id FROM user_organizations')
        ) {
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

    it('re-enables a user', async () => {
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
        if (
          query.startsWith('SELECT organization_id FROM user_organizations')
        ) {
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
  });

  describe('PATCH /v1/admin/users/:id - deletion marking', () => {
    // COMPLIANCE_SENTINEL: TL-ACCT-003 | policy=compliance/SOC2/policies/01-account-management-policy.md | procedure=compliance/SOC2/procedures/01-account-management-procedure.md | control=deletion-marking-attribution
    it('marks user for deletion', async () => {
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
        if (
          query.startsWith('SELECT organization_id FROM user_organizations')
        ) {
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

    it('unmarks user for deletion', async () => {
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
        if (
          query.startsWith('SELECT organization_id FROM user_organizations')
        ) {
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
  });
});
