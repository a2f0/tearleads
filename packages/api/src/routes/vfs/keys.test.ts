import './testSupport.js';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../index.js';
import { createAuthHeader } from '../../test/auth.js';
import { mockConsoleError } from '../../test/consoleMocks.js';
import {
  mockQuery,
  setupVfsTestEnv,
  teardownVfsTestEnv
} from './testSupport.js';

describe('VFS routes (keys)', () => {
  beforeEach(() => {
    setupVfsTestEnv();
  });

  afterEach(() => {
    teardownVfsTestEnv();
  });

  describe('GET /vfs/keys/me', () => {
    it('returns 401 when not authenticated', async () => {
      const response = await request(app).get('/v1/vfs/keys/me');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Unauthorized' });
    });

    it('returns 404 when user has no VFS keys', async () => {
      const authHeader = await createAuthHeader();
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .get('/v1/vfs/keys/me')
        .set('Authorization', authHeader);

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'VFS keys not set up' });
    });

    it('returns 200 with public keys when user has VFS keys', async () => {
      const authHeader = await createAuthHeader();
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            public_encryption_key: 'enc-key-123',
            public_signing_key: 'sign-key-456',
            encrypted_private_keys: 'encrypted-blob',
            argon2_salt: 'argon2-salt'
          }
        ]
      });

      const response = await request(app)
        .get('/v1/vfs/keys/me')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        publicEncryptionKey: 'enc-key-123',
        publicSigningKey: 'sign-key-456',
        encryptedPrivateKeys: 'encrypted-blob',
        argon2Salt: 'argon2-salt'
      });
    });

    it('returns 500 on database error', async () => {
      const restoreConsole = mockConsoleError();
      const authHeader = await createAuthHeader();
      mockQuery.mockRejectedValueOnce(new Error('Database error'));

      const response = await request(app)
        .get('/v1/vfs/keys/me')
        .set('Authorization', authHeader);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to get VFS keys' });
      restoreConsole();
    });
  });

  describe('POST /vfs/keys', () => {
    const validPayload = {
      publicEncryptionKey: 'enc-key',
      publicSigningKey: 'sign-key',
      encryptedPrivateKeys: 'encrypted-blob',
      argon2Salt: 'salt-value'
    };

    it('returns 401 when not authenticated', async () => {
      const response = await request(app)
        .post('/v1/vfs/keys')
        .send(validPayload);

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Unauthorized' });
    });

    it('returns 400 when payload is invalid', async () => {
      const authHeader = await createAuthHeader();

      const response = await request(app)
        .post('/v1/vfs/keys')
        .set('Authorization', authHeader)
        .send({ publicEncryptionKey: 'only-one-key' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('required');
    });

    it('returns 400 when payload has empty strings', async () => {
      const authHeader = await createAuthHeader();

      const response = await request(app)
        .post('/v1/vfs/keys')
        .set('Authorization', authHeader)
        .send({
          publicEncryptionKey: '   ',
          publicSigningKey: 'sign-key',
          encryptedPrivateKeys: 'blob',
          argon2Salt: 'salt'
        });

      expect(response.status).toBe(400);
    });

    it('returns 409 when keys already exist', async () => {
      const authHeader = await createAuthHeader();
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] }); // existing keys

      const response = await request(app)
        .post('/v1/vfs/keys')
        .set('Authorization', authHeader)
        .send(validPayload);

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: 'VFS keys already exist for this user'
      });
    });

    it('returns 201 when keys are created successfully', async () => {
      const authHeader = await createAuthHeader();
      mockQuery.mockResolvedValueOnce({ rows: [] }); // no existing keys
      mockQuery.mockResolvedValueOnce({ rows: [] }); // insert

      const response = await request(app)
        .post('/v1/vfs/keys')
        .set('Authorization', authHeader)
        .send(validPayload);

      expect(response.status).toBe(201);
      expect(response.body).toEqual({ created: true });
    });

    it('returns 500 on database error', async () => {
      const restoreConsole = mockConsoleError();
      const authHeader = await createAuthHeader();
      mockQuery.mockRejectedValueOnce(new Error('Database error'));

      const response = await request(app)
        .post('/v1/vfs/keys')
        .set('Authorization', authHeader)
        .send(validPayload);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to set up VFS keys' });
      restoreConsole();
    });
  });
});
