/**
 * Tests for AI Usage query routes (GET list, GET summary).
 */
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../index.js';
import { createAuthHeader } from '../../test/auth.js';

const mockPool = {
  query: vi.fn()
};

vi.mock('../../lib/postgres.js', () => ({
  getPostgresPool: () => Promise.resolve(mockPool),
  getPool: () => Promise.resolve(mockPool)
}));

let authHeader: string;

describe('AI Usage Routes - Query', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    vi.stubEnv('JWT_SECRET', 'test-secret');
    authHeader = await createAuthHeader();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('GET /v1/ai/usage', () => {
    it('lists usage', async () => {
      const now = new Date();

      mockPool.query
        // List usage
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'usage-1',
              conversation_id: 'conv-123',
              message_id: 'msg-1',
              user_id: 'test-user',
              organization_id: 'org-123',
              model_id: 'gpt-4',
              prompt_tokens: 100,
              completion_tokens: 50,
              total_tokens: 150,
              openrouter_request_id: 'req-1',
              created_at: now
            }
          ]
        })
        // Summary
        .mockResolvedValueOnce({
          rows: [
            {
              total_prompt_tokens: '100',
              total_completion_tokens: '50',
              total_tokens: '150',
              request_count: '1',
              period_start: now,
              period_end: now
            }
          ]
        });

      const response = await request(app)
        .get('/v1/ai/usage')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body.usage).toHaveLength(1);
      expect(response.body.summary.totalTokens).toBe(150);
    });

    it('lists usage with date filters', async () => {
      const now = new Date();

      mockPool.query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'usage-1',
              conversation_id: 'conv-123',
              message_id: 'msg-1',
              user_id: 'test-user',
              organization_id: 'org-123',
              model_id: 'gpt-4',
              prompt_tokens: 100,
              completion_tokens: 50,
              total_tokens: 150,
              openrouter_request_id: 'req-1',
              created_at: now
            }
          ]
        })
        .mockResolvedValueOnce({
          rows: [
            {
              total_prompt_tokens: '100',
              total_completion_tokens: '50',
              total_tokens: '150',
              request_count: '1',
              period_start: now,
              period_end: now
            }
          ]
        });

      const response = await request(app)
        .get('/v1/ai/usage?startDate=2024-01-01&endDate=2024-12-31')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
    });

    it('lists usage with cursor and startDate only', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({
        rows: [
          {
            total_prompt_tokens: '0',
            total_completion_tokens: '0',
            total_tokens: '0',
            request_count: '0',
            period_start: null,
            period_end: null
          }
        ]
      });

      const response = await request(app)
        .get(
          '/v1/ai/usage?startDate=2024-01-01&cursor=2024-06-01T00:00:00.000Z'
        )
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
    });

    it('lists usage with endDate only', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({
        rows: [
          {
            total_prompt_tokens: '0',
            total_completion_tokens: '0',
            total_tokens: '0',
            request_count: '0',
            period_start: null,
            period_end: null
          }
        ]
      });

      const response = await request(app)
        .get('/v1/ai/usage?endDate=2024-12-31')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
    });

    it('lists usage with pagination', async () => {
      const now = new Date();
      const rows = Array(51)
        .fill(null)
        .map((_, i) => ({
          id: `usage-${i}`,
          conversation_id: 'conv-123',
          message_id: `msg-${i}`,
          user_id: 'test-user',
          organization_id: 'org-123',
          model_id: 'gpt-4',
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
          openrouter_request_id: `req-${i}`,
          created_at: now
        }));

      mockPool.query.mockResolvedValueOnce({ rows }).mockResolvedValueOnce({
        rows: [
          {
            total_prompt_tokens: '5000',
            total_completion_tokens: '2500',
            total_tokens: '7500',
            request_count: '50',
            period_start: now,
            period_end: now
          }
        ]
      });

      const response = await request(app)
        .get('/v1/ai/usage?limit=50')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body.usage).toHaveLength(50);
      expect(response.body.hasMore).toBe(true);
      expect(response.body.cursor).toBeDefined();
    });

    it('returns 500 on database error', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});

      mockPool.query.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app)
        .get('/v1/ai/usage')
        .set('Authorization', authHeader);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get usage');
    });

    it('returns 401 without auth', async () => {
      const response = await request(app).get('/v1/ai/usage');

      expect(response.status).toBe(401);
    });
  });

  describe('GET /v1/ai/usage/summary', () => {
    it('returns usage summary', async () => {
      const now = new Date();

      mockPool.query
        // Overall summary
        .mockResolvedValueOnce({
          rows: [
            {
              total_prompt_tokens: '500',
              total_completion_tokens: '250',
              total_tokens: '750',
              request_count: '5',
              period_start: now,
              period_end: now
            }
          ]
        })
        // By model
        .mockResolvedValueOnce({
          rows: [
            {
              model_id: 'gpt-4',
              total_prompt_tokens: '400',
              total_completion_tokens: '200',
              total_tokens: '600',
              request_count: '4',
              period_start: now,
              period_end: now
            },
            {
              model_id: 'gpt-3.5-turbo',
              total_prompt_tokens: '100',
              total_completion_tokens: '50',
              total_tokens: '150',
              request_count: '1',
              period_start: now,
              period_end: now
            }
          ]
        });

      const response = await request(app)
        .get('/v1/ai/usage/summary')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body.summary.totalTokens).toBe(750);
      expect(response.body.byModel['gpt-4'].totalTokens).toBe(600);
      expect(response.body.byModel['gpt-3.5-turbo'].totalTokens).toBe(150);
    });

    it('returns usage summary with date filters', async () => {
      const now = new Date();

      mockPool.query
        .mockResolvedValueOnce({
          rows: [
            {
              total_prompt_tokens: '500',
              total_completion_tokens: '250',
              total_tokens: '750',
              request_count: '5',
              period_start: now,
              period_end: now
            }
          ]
        })
        .mockResolvedValueOnce({
          rows: []
        });

      const response = await request(app)
        .get('/v1/ai/usage/summary?startDate=2024-01-01&endDate=2024-12-31')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
    });

    it('returns usage summary with startDate only', async () => {
      const now = new Date();

      mockPool.query
        .mockResolvedValueOnce({
          rows: [
            {
              total_prompt_tokens: '500',
              total_completion_tokens: '250',
              total_tokens: '750',
              request_count: '5',
              period_start: now,
              period_end: now
            }
          ]
        })
        .mockResolvedValueOnce({
          rows: []
        });

      const response = await request(app)
        .get('/v1/ai/usage/summary?startDate=2024-01-01')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
    });

    it('returns usage summary with endDate only', async () => {
      const now = new Date();

      mockPool.query
        .mockResolvedValueOnce({
          rows: [
            {
              total_prompt_tokens: '500',
              total_completion_tokens: '250',
              total_tokens: '750',
              request_count: '5',
              period_start: now,
              period_end: now
            }
          ]
        })
        .mockResolvedValueOnce({
          rows: []
        });

      const response = await request(app)
        .get('/v1/ai/usage/summary?endDate=2024-12-31')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
    });

    it('returns empty summary when no usage', async () => {
      mockPool.query
        .mockResolvedValueOnce({
          rows: [
            {
              total_prompt_tokens: '0',
              total_completion_tokens: '0',
              total_tokens: '0',
              request_count: '0',
              period_start: null,
              period_end: null
            }
          ]
        })
        .mockResolvedValueOnce({
          rows: []
        });

      const response = await request(app)
        .get('/v1/ai/usage/summary')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body.summary.totalTokens).toBe(0);
      expect(response.body.summary.requestCount).toBe(0);
    });

    it('returns 500 on database error', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});

      mockPool.query.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app)
        .get('/v1/ai/usage/summary')
        .set('Authorization', authHeader);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get usage summary');
    });

    it('returns 401 without auth', async () => {
      const response = await request(app).get('/v1/ai/usage/summary');

      expect(response.status).toBe(401);
    });
  });
});
