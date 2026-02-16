/**
 * Tests for AI Conversations routes.
 */
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../index.js';
import { createAuthHeader } from '../test/auth.js';

const mockPool = {
  query: vi.fn()
};

vi.mock('../lib/postgres.js', () => ({
  getPostgresPool: () => Promise.resolve(mockPool)
}));

let authHeader: string;

describe('AI Conversations Routes', () => {
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
    }, 15000);
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
