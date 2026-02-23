/**
 * Tests for AI Conversations PATCH routes.
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

describe('AI Conversations Routes - PATCH', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    vi.stubEnv('JWT_SECRET', 'test-secret');
    authHeader = await createAuthHeader();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('PATCH /v1/ai/conversations/:id', () => {
    it('updates a conversation title', async () => {
      const now = new Date();

      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'conv-123',
            user_id: 'test-user',
            organization_id: 'org-123',
            encrypted_title: 'new-title',
            encrypted_session_key: 'key',
            model_id: 'gpt-4',
            message_count: 0,
            created_at: now,
            updated_at: now
          }
        ]
      });

      const response = await request(app)
        .patch('/v1/ai/conversations/conv-123')
        .set('Authorization', authHeader)
        .send({
          encryptedTitle: 'new-title'
        });

      expect(response.status).toBe(200);
      expect(response.body.conversation.encryptedTitle).toBe('new-title');
    });

    it('updates modelId', async () => {
      const now = new Date();

      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'conv-123',
            user_id: 'test-user',
            organization_id: 'org-123',
            encrypted_title: 'title',
            encrypted_session_key: 'key',
            model_id: 'gpt-4-turbo',
            message_count: 0,
            created_at: now,
            updated_at: now
          }
        ]
      });

      const response = await request(app)
        .patch('/v1/ai/conversations/conv-123')
        .set('Authorization', authHeader)
        .send({
          modelId: 'gpt-4-turbo'
        });

      expect(response.status).toBe(200);
      expect(response.body.conversation.modelId).toBe('gpt-4-turbo');
    });

    it('updates both title and modelId', async () => {
      const now = new Date();

      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'conv-123',
            user_id: 'test-user',
            organization_id: 'org-123',
            encrypted_title: 'new-title',
            encrypted_session_key: 'key',
            model_id: 'gpt-4-turbo',
            message_count: 0,
            created_at: now,
            updated_at: now
          }
        ]
      });

      const response = await request(app)
        .patch('/v1/ai/conversations/conv-123')
        .set('Authorization', authHeader)
        .send({
          encryptedTitle: 'new-title',
          modelId: 'gpt-4-turbo'
        });

      expect(response.status).toBe(200);
      expect(response.body.conversation.encryptedTitle).toBe('new-title');
      expect(response.body.conversation.modelId).toBe('gpt-4-turbo');
    });

    it('returns 400 if no updates provided', async () => {
      const response = await request(app)
        .patch('/v1/ai/conversations/conv-123')
        .set('Authorization', authHeader)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe(
        'At least encryptedTitle or modelId is required'
      );
    });

    it('returns 400 for non-object body', async () => {
      const response = await request(app)
        .patch('/v1/ai/conversations/conv-123')
        .set('Authorization', authHeader)
        .send('not-json');

      expect(response.status).toBe(400);
    });

    it('returns 404 if not found', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .patch('/v1/ai/conversations/nonexistent')
        .set('Authorization', authHeader)
        .send({
          encryptedTitle: 'new-title'
        });

      expect(response.status).toBe(404);
    });

    it('returns 500 on database error', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});

      mockPool.query.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app)
        .patch('/v1/ai/conversations/conv-123')
        .set('Authorization', authHeader)
        .send({
          encryptedTitle: 'new-title'
        });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to update conversation');
    });

    it('returns 401 without auth', async () => {
      const response = await request(app)
        .patch('/v1/ai/conversations/conv-123')
        .send({
          encryptedTitle: 'new-title'
        });

      expect(response.status).toBe(401);
    });
  });
});
