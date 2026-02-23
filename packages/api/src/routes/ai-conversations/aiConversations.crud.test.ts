/**
 * Tests for AI Conversations CRUD routes (POST, GET list, GET single, DELETE).
 */
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../index.js';
import { createAuthHeader } from '../../test/auth.js';

const mockPool = {
  query: vi.fn()
};

vi.mock('../../lib/postgres.js', () => ({
  getPostgresPool: () => Promise.resolve(mockPool)
}));

let authHeader: string;

describe('AI Conversations Routes - CRUD', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    vi.stubEnv('JWT_SECRET', 'test-secret');
    authHeader = await createAuthHeader();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('POST /v1/ai/conversations', () => {
    it('creates a conversation', async () => {
      const now = new Date();

      // Mock getUserOrganizationId
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ organization_id: 'org-123' }] })
        // Mock insert
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'conv-123',
              user_id: 'test-user',
              organization_id: 'org-123',
              encrypted_title: 'encrypted-title',
              encrypted_session_key: 'encrypted-key',
              model_id: 'gpt-4',
              message_count: 0,
              created_at: now,
              updated_at: now
            }
          ]
        });

      const response = await request(app)
        .post('/v1/ai/conversations')
        .set('Authorization', authHeader)
        .send({
          encryptedTitle: 'encrypted-title',
          encryptedSessionKey: 'encrypted-key',
          modelId: 'gpt-4'
        });

      expect(response.status).toBe(201);
      expect(response.body.conversation).toBeDefined();
      expect(response.body.conversation.id).toBe('conv-123');
      expect(response.body.conversation.encryptedTitle).toBe('encrypted-title');
    });

    it('creates a conversation without modelId', async () => {
      const now = new Date();

      mockPool.query
        .mockResolvedValueOnce({ rows: [] }) // no org
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'conv-123',
              user_id: 'test-user',
              organization_id: null,
              encrypted_title: 'encrypted-title',
              encrypted_session_key: 'encrypted-key',
              model_id: null,
              message_count: 0,
              created_at: now,
              updated_at: now
            }
          ]
        });

      const response = await request(app)
        .post('/v1/ai/conversations')
        .set('Authorization', authHeader)
        .send({
          encryptedTitle: 'encrypted-title',
          encryptedSessionKey: 'encrypted-key'
        });

      expect(response.status).toBe(201);
      expect(response.body.conversation.modelId).toBeNull();
    });

    it('returns 400 if encryptedTitle is missing', async () => {
      const response = await request(app)
        .post('/v1/ai/conversations')
        .set('Authorization', authHeader)
        .send({
          encryptedSessionKey: 'encrypted-key'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe(
        'encryptedTitle and encryptedSessionKey are required'
      );
    });

    it('returns 400 if encryptedSessionKey is missing', async () => {
      const response = await request(app)
        .post('/v1/ai/conversations')
        .set('Authorization', authHeader)
        .send({
          encryptedTitle: 'encrypted-title'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe(
        'encryptedTitle and encryptedSessionKey are required'
      );
    });

    it('returns 400 if encryptedTitle is empty', async () => {
      const response = await request(app)
        .post('/v1/ai/conversations')
        .set('Authorization', authHeader)
        .send({
          encryptedTitle: '   ',
          encryptedSessionKey: 'encrypted-key'
        });

      expect(response.status).toBe(400);
    });

    it('returns 400 for non-object body', async () => {
      const response = await request(app)
        .post('/v1/ai/conversations')
        .set('Authorization', authHeader)
        .send('not-json');

      expect(response.status).toBe(400);
    });

    it('returns 500 if insert returns no rows', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});

      mockPool.query
        .mockResolvedValueOnce({ rows: [] }) // no org
        .mockResolvedValueOnce({ rows: [] }); // empty insert result

      const response = await request(app)
        .post('/v1/ai/conversations')
        .set('Authorization', authHeader)
        .send({
          encryptedTitle: 'encrypted-title',
          encryptedSessionKey: 'encrypted-key'
        });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to create conversation');
    });

    it('returns 500 on database error', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});

      mockPool.query.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app)
        .post('/v1/ai/conversations')
        .set('Authorization', authHeader)
        .send({
          encryptedTitle: 'encrypted-title',
          encryptedSessionKey: 'encrypted-key'
        });

      expect(response.status).toBe(500);
    });

    it('returns 401 without auth', async () => {
      const response = await request(app).post('/v1/ai/conversations').send({
        encryptedTitle: 'encrypted-title',
        encryptedSessionKey: 'encrypted-key'
      });

      expect(response.status).toBe(401);
    });
  });

  describe('GET /v1/ai/conversations', () => {
    it('lists conversations', async () => {
      const now = new Date();

      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'conv-1',
            user_id: 'test-user',
            organization_id: 'org-123',
            encrypted_title: 'title-1',
            encrypted_session_key: 'key-1',
            model_id: 'gpt-4',
            message_count: 5,
            created_at: now,
            updated_at: now
          },
          {
            id: 'conv-2',
            user_id: 'test-user',
            organization_id: 'org-123',
            encrypted_title: 'title-2',
            encrypted_session_key: 'key-2',
            model_id: null,
            message_count: 0,
            created_at: now,
            updated_at: now
          }
        ]
      });

      const response = await request(app)
        .get('/v1/ai/conversations')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body.conversations).toHaveLength(2);
      expect(response.body.hasMore).toBe(false);
    });

    it('lists conversations with cursor pagination', async () => {
      const now = new Date();
      const rows = Array(51)
        .fill(null)
        .map((_, i) => ({
          id: `conv-${i}`,
          user_id: 'test-user',
          organization_id: 'org-123',
          encrypted_title: `title-${i}`,
          encrypted_session_key: `key-${i}`,
          model_id: 'gpt-4',
          message_count: i,
          created_at: now,
          updated_at: now
        }));

      mockPool.query.mockResolvedValueOnce({ rows });

      const response = await request(app)
        .get('/v1/ai/conversations?limit=50')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body.conversations).toHaveLength(50);
      expect(response.body.hasMore).toBe(true);
      expect(response.body.cursor).toBeDefined();
    });

    it('lists conversations with cursor parameter', async () => {
      const now = new Date();

      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'conv-1',
            user_id: 'test-user',
            organization_id: 'org-123',
            encrypted_title: 'title-1',
            encrypted_session_key: 'key-1',
            model_id: 'gpt-4',
            message_count: 5,
            created_at: now,
            updated_at: now
          }
        ]
      });

      const response = await request(app)
        .get('/v1/ai/conversations?cursor=2024-01-01T00:00:00.000Z')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body.conversations).toHaveLength(1);
    });

    it('returns 500 on database error', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});

      mockPool.query.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app)
        .get('/v1/ai/conversations')
        .set('Authorization', authHeader);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to list conversations');
    });

    it('returns 401 without auth', async () => {
      const response = await request(app).get('/v1/ai/conversations');

      expect(response.status).toBe(401);
    });
  });

  describe('GET /v1/ai/conversations/:id', () => {
    it('gets a conversation with messages', async () => {
      const now = new Date();

      // Mock conversation query
      mockPool.query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'conv-123',
              user_id: 'test-user',
              organization_id: 'org-123',
              encrypted_title: 'title',
              encrypted_session_key: 'key',
              model_id: 'gpt-4',
              message_count: 2,
              created_at: now,
              updated_at: now
            }
          ]
        })
        // Mock messages query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'msg-1',
              conversation_id: 'conv-123',
              role: 'user',
              encrypted_content: 'content-1',
              model_id: null,
              sequence_number: 1,
              created_at: now
            },
            {
              id: 'msg-2',
              conversation_id: 'conv-123',
              role: 'assistant',
              encrypted_content: 'content-2',
              model_id: 'gpt-4',
              sequence_number: 2,
              created_at: now
            }
          ]
        });

      const response = await request(app)
        .get('/v1/ai/conversations/conv-123')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body.conversation.id).toBe('conv-123');
      expect(response.body.messages).toHaveLength(2);
    });

    it('returns 404 if not found', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .get('/v1/ai/conversations/nonexistent')
        .set('Authorization', authHeader);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Conversation not found');
    });

    it('returns 500 on database error', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});

      mockPool.query.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app)
        .get('/v1/ai/conversations/conv-123')
        .set('Authorization', authHeader);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get conversation');
    });

    it('returns 401 without auth', async () => {
      const response = await request(app).get('/v1/ai/conversations/conv-123');

      expect(response.status).toBe(401);
    });
  });

  describe('DELETE /v1/ai/conversations/:id', () => {
    it('soft deletes a conversation', async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 1 });

      const response = await request(app)
        .delete('/v1/ai/conversations/conv-123')
        .set('Authorization', authHeader);

      expect(response.status).toBe(204);
    });

    it('returns 404 if not found', async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 0 });

      const response = await request(app)
        .delete('/v1/ai/conversations/nonexistent')
        .set('Authorization', authHeader);

      expect(response.status).toBe(404);
    });

    it('returns 500 on database error', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});

      mockPool.query.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app)
        .delete('/v1/ai/conversations/conv-123')
        .set('Authorization', authHeader);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to delete conversation');
    });

    it('returns 401 without auth', async () => {
      const response = await request(app).delete(
        '/v1/ai/conversations/conv-123'
      );

      expect(response.status).toBe(401);
    });
  });
});
