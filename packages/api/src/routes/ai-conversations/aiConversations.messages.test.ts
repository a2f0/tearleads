/**
 * Tests for AI Conversations messages routes.
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

describe('AI Conversations Routes - Messages', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    vi.stubEnv('JWT_SECRET', 'test-secret');
    authHeader = await createAuthHeader();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('POST /v1/ai/conversations/:id/messages', () => {
    it('adds a message to a conversation', async () => {
      const now = new Date();

      mockPool.query
        // Check conversation exists
        .mockResolvedValueOnce({
          rows: [{ id: 'conv-123', message_count: 1 }]
        })
        // BEGIN
        .mockResolvedValueOnce({})
        // Insert message
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'msg-123',
              conversation_id: 'conv-123',
              role: 'user',
              encrypted_content: 'content',
              model_id: null,
              sequence_number: 2,
              created_at: now
            }
          ]
        })
        // Update conversation
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
        // COMMIT
        .mockResolvedValueOnce({});

      const response = await request(app)
        .post('/v1/ai/conversations/conv-123/messages')
        .set('Authorization', authHeader)
        .send({
          role: 'user',
          encryptedContent: 'content'
        });

      expect(response.status).toBe(201);
      expect(response.body.message.id).toBe('msg-123');
      expect(response.body.conversation.messageCount).toBe(2);
    });

    it('adds a message with modelId', async () => {
      const now = new Date();

      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ id: 'conv-123', message_count: 0 }]
        })
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'msg-123',
              conversation_id: 'conv-123',
              role: 'assistant',
              encrypted_content: 'content',
              model_id: 'gpt-4',
              sequence_number: 1,
              created_at: now
            }
          ]
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'conv-123',
              user_id: 'test-user',
              organization_id: 'org-123',
              encrypted_title: 'title',
              encrypted_session_key: 'key',
              model_id: 'gpt-4',
              message_count: 1,
              created_at: now,
              updated_at: now
            }
          ]
        })
        .mockResolvedValueOnce({}); // COMMIT

      const response = await request(app)
        .post('/v1/ai/conversations/conv-123/messages')
        .set('Authorization', authHeader)
        .send({
          role: 'assistant',
          encryptedContent: 'content',
          modelId: 'gpt-4'
        });

      expect(response.status).toBe(201);
      expect(response.body.message.modelId).toBe('gpt-4');
    });

    it('returns 400 if role is invalid', async () => {
      const response = await request(app)
        .post('/v1/ai/conversations/conv-123/messages')
        .set('Authorization', authHeader)
        .send({
          role: 'invalid',
          encryptedContent: 'content'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe(
        'role and encryptedContent are required'
      );
    });

    it('returns 400 if encryptedContent is empty', async () => {
      const response = await request(app)
        .post('/v1/ai/conversations/conv-123/messages')
        .set('Authorization', authHeader)
        .send({
          role: 'user',
          encryptedContent: '   '
        });

      expect(response.status).toBe(400);
    });

    it('returns 400 for non-object body', async () => {
      const response = await request(app)
        .post('/v1/ai/conversations/conv-123/messages')
        .set('Authorization', authHeader)
        .send('not-json');

      expect(response.status).toBe(400);
    });

    it('returns 404 if conversation not found', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .post('/v1/ai/conversations/nonexistent/messages')
        .set('Authorization', authHeader)
        .send({
          role: 'user',
          encryptedContent: 'content'
        });

      expect(response.status).toBe(404);
    });

    it('returns 500 and rolls back on database error', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});

      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ id: 'conv-123', message_count: 0 }]
        })
        .mockResolvedValueOnce({}) // BEGIN
        .mockRejectedValueOnce(new Error('DB error')) // Insert fails
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .post('/v1/ai/conversations/conv-123/messages')
        .set('Authorization', authHeader)
        .send({
          role: 'user',
          encryptedContent: 'content'
        });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to add message');
    });

    it('returns 401 without auth', async () => {
      const response = await request(app)
        .post('/v1/ai/conversations/conv-123/messages')
        .send({
          role: 'user',
          encryptedContent: 'content'
        });

      expect(response.status).toBe(401);
    });
  });
});
