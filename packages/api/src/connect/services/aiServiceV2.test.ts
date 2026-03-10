import { create } from '@bufbuild/protobuf';
import { Code } from '@connectrpc/connect';
import {
  AiServiceGetUsageRequestSchema,
  AiServiceGetUsageSummaryRequestSchema,
  AiServiceRecordUsageRequestSchema
} from '@tearleads/shared/gen/tearleads/v2/ai_pb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { aiConnectServiceV2 } from './aiServiceV2.js';

const authenticateMock = vi.fn();
const getPoolMock = vi.fn();
const getPostgresPoolMock = vi.fn();
const queryMock = vi.fn();

vi.mock('./connectRequestAuth.js', () => ({
  authenticate: (...args: unknown[]) => authenticateMock(...args)
}));

vi.mock('../../lib/postgres.js', () => ({
  getPool: (...args: unknown[]) => getPoolMock(...args),
  getPostgresPool: (...args: unknown[]) => getPostgresPoolMock(...args)
}));

describe('aiConnectServiceV2', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    getPoolMock.mockReset();
    getPostgresPoolMock.mockReset();
    queryMock.mockReset();
    authenticateMock.mockResolvedValue({
      ok: true,
      claims: {
        sub: 'user-1'
      }
    });
    getPoolMock.mockResolvedValue({ query: queryMock });
    getPostgresPoolMock.mockResolvedValue({ query: queryMock });
  });

  it('maps failed authentication to a connect unauthenticated error', async () => {
    authenticateMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      error: 'Unauthorized'
    });

    await expect(
      aiConnectServiceV2.getUsage(create(AiServiceGetUsageRequestSchema, {}), {
        requestHeader: new Headers()
      })
    ).rejects.toMatchObject({
      code: Code.Unauthenticated
    });
  });

  it('returns usage rows and summary for the authenticated user', async () => {
    const usageTime = new Date('2026-03-09T18:00:00.000Z');
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'usage-1',
            conversation_id: null,
            message_id: null,
            user_id: 'user-1',
            organization_id: 'org-1',
            model_id: 'openai/gpt-4o-mini',
            prompt_tokens: 12,
            completion_tokens: 8,
            total_tokens: 20,
            openrouter_request_id: 'req-1',
            created_at: usageTime
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            total_prompt_tokens: '12',
            total_completion_tokens: '8',
            total_tokens: '20',
            request_count: '1',
            period_start: usageTime,
            period_end: usageTime
          }
        ]
      });

    const response = await aiConnectServiceV2.getUsage(
      create(AiServiceGetUsageRequestSchema, {
        startDate: '2026-03-01',
        endDate: '2026-03-31',
        limit: 25
      }),
      { requestHeader: new Headers({ authorization: 'Bearer token' }) }
    );

    expect(response.usage).toHaveLength(1);
    expect(response.usage[0]).toMatchObject({
      id: 'usage-1',
      userId: 'user-1',
      organizationId: 'org-1',
      totalTokens: 20
    });
    expect(response.summary).toMatchObject({
      totalTokens: 20,
      requestCount: 1
    });
    expect(queryMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('WHERE user_id = $1'),
      ['user-1', '2026-03-01', '2026-03-31', 26]
    );
  });

  it('records usage for the authenticated user and normalizes optional fields', async () => {
    const createdAt = new Date('2026-03-09T18:00:00.000Z');
    queryMock
      .mockResolvedValueOnce({ rows: [{ organization_id: 'org-1' }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'usage-1',
            conversation_id: null,
            message_id: null,
            user_id: 'user-1',
            organization_id: 'org-1',
            model_id: 'openai/gpt-4o-mini',
            prompt_tokens: 12,
            completion_tokens: 8,
            total_tokens: 20,
            openrouter_request_id: null,
            created_at: createdAt
          }
        ]
      });

    const response = await aiConnectServiceV2.recordUsage(
      create(AiServiceRecordUsageRequestSchema, {
        conversationId: ' ',
        messageId: '\t',
        modelId: 'openai/gpt-4o-mini',
        promptTokens: 12,
        completionTokens: 8,
        totalTokens: 20,
        openrouterRequestId: '  '
      }),
      { requestHeader: new Headers({ authorization: 'Bearer token' }) }
    );

    expect(response.usage).toMatchObject({
      id: 'usage-1',
      userId: 'user-1',
      organizationId: 'org-1',
      modelId: 'openai/gpt-4o-mini',
      totalTokens: 20,
      createdAt: createdAt.toISOString()
    });
    expect(response.usage?.conversationId).toBeUndefined();
    expect(response.usage?.messageId).toBeUndefined();
    expect(response.usage?.openrouterRequestId).toBeUndefined();
    expect(queryMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO ai_usage'),
      [
        expect.any(String),
        null,
        null,
        'user-1',
        'org-1',
        'openai/gpt-4o-mini',
        12,
        8,
        20,
        null,
        expect.any(Date)
      ]
    );
  });

  it('rejects negative usage counts before touching the database', async () => {
    await expect(
      aiConnectServiceV2.recordUsage(
        create(AiServiceRecordUsageRequestSchema, {
          modelId: 'openai/gpt-4o-mini',
          promptTokens: -1,
          completionTokens: 8,
          totalTokens: 7
        }),
        { requestHeader: new Headers({ authorization: 'Bearer token' }) }
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('rejects inconsistent total token counts before touching the database', async () => {
    await expect(
      aiConnectServiceV2.recordUsage(
        create(AiServiceRecordUsageRequestSchema, {
          modelId: 'openai/gpt-4o-mini',
          promptTokens: 12,
          completionTokens: 8,
          totalTokens: 19
        }),
        { requestHeader: new Headers({ authorization: 'Bearer token' }) }
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('rejects missing model ids before touching the database', async () => {
    await expect(
      aiConnectServiceV2.recordUsage(
        create(AiServiceRecordUsageRequestSchema, {
          modelId: '   ',
          promptTokens: 12,
          completionTokens: 8,
          totalTokens: 20
        }),
        { requestHeader: new Headers({ authorization: 'Bearer token' }) }
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('returns internal when usage insert returns no rows', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ organization_id: 'org-1' }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      aiConnectServiceV2.recordUsage(
        create(AiServiceRecordUsageRequestSchema, {
          modelId: 'openai/gpt-4o-mini',
          promptTokens: 12,
          completionTokens: 8,
          totalTokens: 20
        }),
        { requestHeader: new Headers({ authorization: 'Bearer token' }) }
      )
    ).rejects.toMatchObject({
      code: Code.Internal
    });
  });

  it('returns internal when the usage insert query fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    queryMock
      .mockResolvedValueOnce({ rows: [{ organization_id: 'org-1' }] })
      .mockRejectedValueOnce(new Error('db down'));

    try {
      await expect(
        aiConnectServiceV2.recordUsage(
          create(AiServiceRecordUsageRequestSchema, {
            modelId: 'openai/gpt-4o-mini',
            promptTokens: 12,
            completionTokens: 8,
            totalTokens: 20
          }),
          { requestHeader: new Headers({ authorization: 'Bearer token' }) }
        )
      ).rejects.toMatchObject({
        code: Code.Internal
      });
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('returns grouped summary results for the authenticated user', async () => {
    const usageTime = new Date('2026-03-09T18:00:00.000Z');
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            total_prompt_tokens: '12',
            total_completion_tokens: '8',
            total_tokens: '20',
            request_count: '1',
            period_start: usageTime,
            period_end: usageTime
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            model_id: 'openai/gpt-4o-mini',
            total_prompt_tokens: '12',
            total_completion_tokens: '8',
            total_tokens: '20',
            request_count: '1',
            period_start: usageTime,
            period_end: usageTime
          }
        ]
      });

    const response = await aiConnectServiceV2.getUsageSummary(
      create(AiServiceGetUsageSummaryRequestSchema, {
        startDate: '2026-03-01',
        endDate: '2026-03-31'
      }),
      { requestHeader: new Headers({ authorization: 'Bearer token' }) }
    );

    expect(response.summary).toMatchObject({
      totalPromptTokens: 12,
      totalTokens: 20
    });
    expect(response.byModel['openai/gpt-4o-mini']).toMatchObject({
      totalCompletionTokens: 8,
      totalTokens: 20
    });
  });

  it('returns internal when the usage read query fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    queryMock.mockRejectedValueOnce(new Error('db down'));

    try {
      await expect(
        aiConnectServiceV2.getUsage(
          create(AiServiceGetUsageRequestSchema, {
            startDate: '2026-03-01',
            endDate: '2026-03-31',
            limit: 25
          }),
          { requestHeader: new Headers({ authorization: 'Bearer token' }) }
        )
      ).rejects.toMatchObject({
        code: Code.Internal
      });
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('returns internal when the usage summary query fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    queryMock.mockRejectedValueOnce(new Error('db down'));

    try {
      await expect(
        aiConnectServiceV2.getUsageSummary(
          create(AiServiceGetUsageSummaryRequestSchema, {
            startDate: '2026-03-01',
            endDate: '2026-03-31'
          }),
          { requestHeader: new Headers({ authorization: 'Bearer token' }) }
        )
      ).rejects.toMatchObject({
        code: Code.Internal
      });
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
