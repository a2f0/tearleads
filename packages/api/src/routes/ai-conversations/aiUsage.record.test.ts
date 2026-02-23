/**
 * Tests for AI Usage record routes (POST).
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

describe('AI Usage Routes - Record', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    vi.stubEnv('JWT_SECRET', 'test-secret');
    authHeader = await createAuthHeader();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('POST /v1/ai/usage', () => {
    it('records usage', async () => {
      const now = new Date();

      mockPool.query
        // getUserOrganizationId
        .mockResolvedValueOnce({ rows: [{ organization_id: 'org-123' }] })
        // Insert usage
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'usage-123',
              conversation_id: 'conv-123',
              message_id: 'msg-123',
              user_id: 'test-user',
              organization_id: 'org-123',
              model_id: 'gpt-4',
              prompt_tokens: 100,
              completion_tokens: 50,
              total_tokens: 150,
              openrouter_request_id: 'req-123',
              created_at: now
            }
          ]
        });

      const response = await request(app)
        .post('/v1/ai/usage')
        .set('Authorization', authHeader)
        .send({
          conversationId: 'conv-123',
          messageId: 'msg-123',
          modelId: 'gpt-4',
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
          openrouterRequestId: 'req-123'
        });

      expect(response.status).toBe(201);
      expect(response.body.usage.id).toBe('usage-123');
      expect(response.body.usage.totalTokens).toBe(150);
    });

    it('records usage without optional fields', async () => {
      const now = new Date();

      mockPool.query
        .mockResolvedValueOnce({ rows: [] }) // no org
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'usage-123',
              conversation_id: null,
              message_id: null,
              user_id: 'test-user',
              organization_id: null,
              model_id: 'gpt-4',
              prompt_tokens: 100,
              completion_tokens: 50,
              total_tokens: 150,
              openrouter_request_id: null,
              created_at: now
            }
          ]
        });

      const response = await request(app)
        .post('/v1/ai/usage')
        .set('Authorization', authHeader)
        .send({
          modelId: 'gpt-4',
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150
        });

      expect(response.status).toBe(201);
      expect(response.body.usage.conversationId).toBeNull();
    });

    it('returns 400 if required fields missing', async () => {
      const response = await request(app)
        .post('/v1/ai/usage')
        .set('Authorization', authHeader)
        .send({
          modelId: 'gpt-4'
          // missing token counts
        });

      expect(response.status).toBe(400);
    });

    it('returns 400 if modelId is empty', async () => {
      const response = await request(app)
        .post('/v1/ai/usage')
        .set('Authorization', authHeader)
        .send({
          modelId: '   ',
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150
        });

      expect(response.status).toBe(400);
    });

    it('returns 400 for non-object body', async () => {
      const response = await request(app)
        .post('/v1/ai/usage')
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
        .post('/v1/ai/usage')
        .set('Authorization', authHeader)
        .send({
          modelId: 'gpt-4',
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150
        });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to record usage');
    });

    it('returns 500 on database error', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});

      mockPool.query.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app)
        .post('/v1/ai/usage')
        .set('Authorization', authHeader)
        .send({
          modelId: 'gpt-4',
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150
        });

      expect(response.status).toBe(500);
    });

    it('returns 401 without auth', async () => {
      const response = await request(app).post('/v1/ai/usage').send({
        modelId: 'gpt-4',
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150
      });

      expect(response.status).toBe(401);
    });
  });
});
