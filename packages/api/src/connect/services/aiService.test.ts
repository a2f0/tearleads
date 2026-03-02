import {
  Code,
  createContextValues,
  createHandlerContext
} from '@connectrpc/connect';
import { AiService } from '@tearleads/shared/gen/tearleads/v1/ai_connect';
import {
  GetUsageRequest,
  GetUsageSummaryRequest,
  RecordUsageRequest
} from '@tearleads/shared/gen/tearleads/v1/ai_pb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CONNECT_AUTH_CONTEXT_KEY } from '../context.js';
import { aiConnectService } from './aiService.js';

const mockQuery = vi.fn();
const mockGetPool = vi.fn();
const mockGetPostgresPool = vi.fn();

vi.mock('../../lib/postgres.js', () => ({
  getPool: (...args: unknown[]) => mockGetPool(...args),
  getPostgresPool: () => mockGetPostgresPool()
}));

function createAuthContext(
  method: (typeof AiService.methods)[keyof typeof AiService.methods]
) {
  const contextValues = createContextValues();
  contextValues.set(CONNECT_AUTH_CONTEXT_KEY, {
    claims: {
      sub: 'user-1',
      email: 'user-1@example.com',
      jti: 'session-1'
    },
    session: {
      userId: 'user-1',
      email: 'user-1@example.com',
      admin: false,
      createdAt: '2026-03-02T00:00:00.000Z',
      lastActiveAt: '2026-03-02T00:00:00.000Z',
      ipAddress: '127.0.0.1'
    }
  });

  return createHandlerContext({
    service: AiService,
    method,
    protocolName: 'connect',
    requestMethod: 'POST',
    url: `http://localhost/v1/connect/tearleads.v1.AiService/${method.name}`,
    contextValues
  });
}

function createUnauthenticatedContext(
  method: (typeof AiService.methods)[keyof typeof AiService.methods]
) {
  return createHandlerContext({
    service: AiService,
    method,
    protocolName: 'connect',
    requestMethod: 'POST',
    url: `http://localhost/v1/connect/tearleads.v1.AiService/${method.name}`
  });
}

describe('aiConnectService', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    const pool = { query: mockQuery };
    mockGetPool.mockResolvedValue(pool);
    mockGetPostgresPool.mockResolvedValue(pool);
  });

  it('returns unauthenticated when auth context is missing', async () => {
    await expect(
      aiConnectService.getUsage(
        new GetUsageRequest(),
        createUnauthenticatedContext(AiService.methods.getUsage)
      )
    ).rejects.toMatchObject({
      code: Code.Unauthenticated
    });
  });

  it('records usage and normalizes optional fields', async () => {
    const now = new Date('2026-03-02T12:00:00.000Z');
    mockQuery
      .mockResolvedValueOnce({ rows: [{ organization_id: 'org-1' }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'usage-1',
            conversation_id: null,
            message_id: null,
            user_id: 'user-1',
            organization_id: 'org-1',
            model_id: 'gpt-4',
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15,
            openrouter_request_id: null,
            created_at: now
          }
        ]
      });

    const response = await aiConnectService.recordUsage(
      new RecordUsageRequest({
        conversationId: '  ',
        messageId: '\t',
        modelId: 'gpt-4',
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
        openrouterRequestId: ' '
      }),
      createAuthContext(AiService.methods.recordUsage)
    );

    expect(response.usage?.id).toBe('usage-1');
    expect(response.usage?.conversationId).toBeUndefined();
    expect(response.usage?.messageId).toBeUndefined();
    expect(response.usage?.organizationId).toBe('org-1');
    expect(response.usage?.openrouterRequestId).toBeUndefined();
    expect(response.usage?.createdAt).toBe(now.toISOString());

    expect(mockQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO ai_usage'),
      [
        expect.any(String),
        null,
        null,
        'user-1',
        'org-1',
        'gpt-4',
        10,
        5,
        15,
        null,
        expect.any(Date)
      ]
    );
  });

  it('returns invalid argument when modelId is missing', async () => {
    await expect(
      aiConnectService.recordUsage(
        new RecordUsageRequest({
          modelId: '   ',
          promptTokens: 1,
          completionTokens: 1,
          totalTokens: 2
        }),
        createAuthContext(AiService.methods.recordUsage)
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
  });

  it('returns internal when usage insert returns no rows', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      aiConnectService.recordUsage(
        new RecordUsageRequest({
          modelId: 'gpt-4',
          promptTokens: 1,
          completionTokens: 1,
          totalTokens: 2
        }),
        createAuthContext(AiService.methods.recordUsage)
      )
    ).rejects.toMatchObject({
      code: Code.Internal
    });
  });

  it('lists usage with filters and cursor pagination', async () => {
    const rowOneTime = new Date('2026-03-02T11:00:00.000Z');
    const rowTwoTime = new Date('2026-03-02T10:00:00.000Z');

    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'usage-1',
            conversation_id: 'conv-1',
            message_id: 'msg-1',
            user_id: 'user-1',
            organization_id: 'org-1',
            model_id: 'gpt-4',
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15,
            openrouter_request_id: 'req-1',
            created_at: rowOneTime
          },
          {
            id: 'usage-2',
            conversation_id: 'conv-2',
            message_id: 'msg-2',
            user_id: 'user-1',
            organization_id: 'org-1',
            model_id: 'gpt-4',
            prompt_tokens: 12,
            completion_tokens: 6,
            total_tokens: 18,
            openrouter_request_id: 'req-2',
            created_at: rowTwoTime
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            total_prompt_tokens: '22',
            total_completion_tokens: '11',
            total_tokens: '33',
            request_count: '2',
            period_start: rowTwoTime,
            period_end: rowOneTime
          }
        ]
      });

    const response = await aiConnectService.getUsage(
      new GetUsageRequest({
        startDate: '2026-03-01',
        endDate: '2026-03-31',
        cursor: '2026-03-02T12:00:00.000Z',
        limit: 1
      }),
      createAuthContext(AiService.methods.getUsage)
    );

    expect(response.usage).toHaveLength(1);
    expect(response.summary?.totalTokens).toBe(33);
    expect(response.hasMore).toBe(true);
    expect(response.cursor).toBe(rowOneTime.toISOString());

    expect(mockQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('WHERE user_id = $1'),
      ['user-1', '2026-03-01', '2026-03-31', '2026-03-02T12:00:00.000Z', 2]
    );
  });

  it('returns usage summary grouped by model', async () => {
    const now = new Date('2026-03-02T12:00:00.000Z');
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            total_prompt_tokens: '100',
            total_completion_tokens: '50',
            total_tokens: '150',
            request_count: '3',
            period_start: now,
            period_end: now
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            model_id: 'gpt-4',
            total_prompt_tokens: '80',
            total_completion_tokens: '40',
            total_tokens: '120',
            request_count: '2',
            period_start: now,
            period_end: now
          },
          {
            model_id: 'gpt-3.5-turbo',
            total_prompt_tokens: '20',
            total_completion_tokens: '10',
            total_tokens: '30',
            request_count: '1',
            period_start: now,
            period_end: now
          }
        ]
      });

    const response = await aiConnectService.getUsageSummary(
      new GetUsageSummaryRequest({
        startDate: '2026-03-01',
        endDate: '2026-03-31'
      }),
      createAuthContext(AiService.methods.getUsageSummary)
    );

    expect(response.summary?.totalTokens).toBe(150);
    expect(response.byModel['gpt-4']?.totalTokens).toBe(120);
    expect(response.byModel['gpt-3.5-turbo']?.totalTokens).toBe(30);
  });

  it('returns internal when usage query fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockQuery.mockRejectedValueOnce(new Error('db down'));

    try {
      await expect(
        aiConnectService.getUsage(
          new GetUsageRequest(),
          createAuthContext(AiService.methods.getUsage)
        )
      ).rejects.toMatchObject({
        code: Code.Internal
      });
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
