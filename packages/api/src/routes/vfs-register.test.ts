import './vfs-test-support.js';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../index.js';
import { createAuthHeader } from '../test/auth.js';
import { mockConsoleError } from '../test/consoleMocks.js';
import {
  mockQuery,
  setupVfsTestEnv,
  teardownVfsTestEnv
} from './vfs-test-support.js';

describe('VFS routes (register)', () => {
  beforeEach(() => {
    setupVfsTestEnv();
  });

  afterEach(() => {
    teardownVfsTestEnv();
  });

  describe('POST /vfs/register', () => {
    const validPayload = {
      id: 'file-uuid-123',
      objectType: 'file',
      encryptedSessionKey: 'encrypted-key-blob'
    };

    it('returns 401 when not authenticated', async () => {
      const response = await request(app)
        .post('/v1/vfs/register')
        .send(validPayload);

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Unauthorized' });
    });

    it('returns 400 when payload is invalid', async () => {
      const authHeader = await createAuthHeader();

      const response = await request(app)
        .post('/v1/vfs/register')
        .set('Authorization', authHeader)
        .send({ id: 'file-id' }); // missing objectType and encryptedSessionKey

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('required');
    });

    it('returns 400 when objectType is invalid', async () => {
      const authHeader = await createAuthHeader();

      const response = await request(app)
        .post('/v1/vfs/register')
        .set('Authorization', authHeader)
        .send({
          id: 'file-id',
          objectType: 'invalid-type',
          encryptedSessionKey: 'blob'
        });

      expect(response.status).toBe(400);
    });

    it('returns 409 when item already registered', async () => {
      const authHeader = await createAuthHeader();
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] }); // existing item

      const response = await request(app)
        .post('/v1/vfs/register')
        .set('Authorization', authHeader)
        .send(validPayload);

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: 'Item already registered in VFS'
      });
    });

    it('returns 201 when item is registered successfully', async () => {
      const authHeader = await createAuthHeader();
      const createdAt = new Date('2024-01-15T12:00:00Z');
      mockQuery.mockResolvedValueOnce({ rows: [] }); // no existing item
      mockQuery.mockResolvedValueOnce({ rows: [{ created_at: createdAt }] }); // insert

      const response = await request(app)
        .post('/v1/vfs/register')
        .set('Authorization', authHeader)
        .send(validPayload);

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        id: 'file-uuid-123',
        createdAt: '2024-01-15T12:00:00.000Z'
      });
    });

    it('accepts all valid object types', async () => {
      const objectTypes = ['file', 'blob', 'folder', 'contact', 'note', 'photo'];
      const createdAt = new Date();

      for (const objectType of objectTypes) {
        const authHeader = await createAuthHeader();
        mockQuery.mockResolvedValueOnce({ rows: [] }); // no existing item
        mockQuery.mockResolvedValueOnce({ rows: [{ created_at: createdAt }] }); // insert

        const response = await request(app)
          .post('/v1/vfs/register')
          .set('Authorization', authHeader)
          .send({
            id: `item-${objectType}`,
            objectType,
            encryptedSessionKey: 'blob'
          });

        expect(response.status).toBe(201);
      }
    });

    it('returns 500 on database error', async () => {
      const restoreConsole = mockConsoleError();
      const authHeader = await createAuthHeader();
      mockQuery.mockRejectedValueOnce(new Error('Database error'));

      const response = await request(app)
        .post('/v1/vfs/register')
        .set('Authorization', authHeader)
        .send(validPayload);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to register VFS item' });
      restoreConsole();
    });
  });
});
