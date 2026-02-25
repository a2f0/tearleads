import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../index.js';
import { createAuthHeader } from '../../test/auth.js';

const mocks = vi.hoisted(() => ({
  postgresQuery: vi.fn(),
  postgresConnect: vi.fn(),
  postgresClientQuery: vi.fn(),
  postgresClientRelease: vi.fn(),
  deleteVfsBlobByStorageKey: vi.fn()
}));

const sessionStore = new Map<string, string>();

vi.mock('@tearleads/shared/redis', () => ({
  getRedisClient: vi.fn(() =>
    Promise.resolve({
      get: (key: string) => {
        if (key.startsWith('session:')) {
          return Promise.resolve(sessionStore.get(key) ?? null);
        }
        return Promise.resolve(null);
      },
      set: (key: string, value: string) => {
        sessionStore.set(key, value);
        return Promise.resolve('OK');
      },
      expire: () => Promise.resolve(1),
      ttl: () => Promise.resolve(3600),
      sAdd: () => Promise.resolve(1),
      sRem: () => Promise.resolve(1),
      sMembers: () => Promise.resolve([])
    })
  )
}));

vi.mock('../../lib/postgres.js', () => ({
  getPostgresPool: vi.fn(() =>
    Promise.resolve({
      query: mocks.postgresQuery,
      connect: mocks.postgresConnect
    })
  )
}));

vi.mock('../../lib/vfsBlobStore.js', () => ({
  deleteVfsBlobByStorageKey: mocks.deleteVfsBlobByStorageKey
}));

describe('VFS email routes', () => {
  let authHeader: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    sessionStore.clear();
    vi.stubEnv('JWT_SECRET', 'test-secret');

    mocks.postgresClientRelease.mockImplementation(() => {});
    mocks.postgresConnect.mockResolvedValue({
      query: mocks.postgresClientQuery,
      release: mocks.postgresClientRelease
    });

    authHeader = await createAuthHeader();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('lists emails from Postgres', async () => {
    mocks.postgresQuery
      .mockResolvedValueOnce({ rows: [{ total: '1' }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'vfs-email-1',
            encrypted_from: 'enc-from',
            encrypted_to: ['enc-to'],
            encrypted_subject: 'enc-subject',
            received_at: '2026-02-23T00:00:00.000Z',
            ciphertext_size: 77
          }
        ]
      });

    const response = await request(app)
      .get('/v1/vfs/emails')
      .set('Authorization', authHeader);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      emails: [
        {
          id: 'vfs-email-1',
          from: 'enc-from',
          to: ['enc-to'],
          subject: 'enc-subject',
          receivedAt: '2026-02-23T00:00:00.000Z',
          size: 77
        }
      ],
      total: 1,
      offset: 0,
      limit: 50
    });
  });

  it('gets email by id from Postgres', async () => {
    mocks.postgresQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'vfs-email-1',
          encrypted_from: 'enc-from',
          encrypted_to: ['enc-to'],
          encrypted_subject: 'enc-subject',
          received_at: '2026-02-23T00:00:00.000Z',
          ciphertext_size: 88,
          encrypted_body_path: 'smtp/inbound/msg-1.bin'
        }
      ]
    });

    const response = await request(app)
      .get('/v1/vfs/emails/vfs-email-1')
      .set('Authorization', authHeader);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      id: 'vfs-email-1',
      from: 'enc-from',
      to: ['enc-to'],
      subject: 'enc-subject',
      receivedAt: '2026-02-23T00:00:00.000Z',
      size: 88,
      rawData: '',
      encryptedBodyPath: 'smtp/inbound/msg-1.bin'
    });
  });

  it('deletes email and cleans orphaned message/blob', async () => {
    mocks.postgresClientQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ storage_key: 'smtp/inbound/msg-1.bin' }]
      })
      .mockResolvedValueOnce({ rows: [{ id: 'vfs-email-1' }] }) // DELETE vfs_registry
      .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // remaining email items
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    const response = await request(app)
      .delete('/v1/vfs/emails/vfs-email-1')
      .set('Authorization', authHeader);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
    expect(mocks.deleteVfsBlobByStorageKey).toHaveBeenCalledWith({
      storageKey: 'smtp/inbound/msg-1.bin'
    });
    expect(mocks.postgresClientRelease).toHaveBeenCalled();
  });

  it('deletes email but keeps shared message when recipients remain', async () => {
    mocks.postgresClientQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ storage_key: 'smtp/inbound/msg-1.bin' }]
      })
      .mockResolvedValueOnce({ rows: [{ id: 'vfs-email-1' }] }) // DELETE vfs_registry
      .mockResolvedValueOnce({ rows: [{ count: '1' }] }) // remaining email items
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    const response = await request(app)
      .delete('/v1/vfs/emails/vfs-email-1')
      .set('Authorization', authHeader);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
    expect(mocks.deleteVfsBlobByStorageKey).not.toHaveBeenCalled();
  });
});
