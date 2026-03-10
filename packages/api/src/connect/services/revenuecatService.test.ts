import { createHmac } from 'node:crypto';
import { create } from '@bufbuild/protobuf';
import { Code } from '@connectrpc/connect';
import { HandleWebhookRequestSchema } from '@tearleads/shared/gen/tearleads/v2/revenuecat_pb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setTestEnv, unsetTestEnv } from '../../test/env.js';
import { revenuecatConnectService } from './revenuecatService.js';

const mockQuery = vi.fn();
const mockGetPostgresPool = vi.fn();

vi.mock('../../lib/postgres.js', () => ({
  getPostgresPool: () => mockGetPostgresPool(),
  getPool: () => mockGetPostgresPool()
}));

function signPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(Buffer.from(payload, 'utf8'))
    .digest('hex');
}

describe('revenuecatConnectService', () => {
  const webhookSecret = 'webhook-secret';

  beforeEach(() => {
    vi.clearAllMocks();
    setTestEnv('REVENUECAT_WEBHOOK_SECRET', webhookSecret);
  });

  it('handles valid webhook events', async () => {
    const body = JSON.stringify({
      event: {
        id: 'evt_1',
        type: 'RENEWAL',
        app_user_id: 'org:org-1',
        product_id: 'pro_monthly',
        period_type: 'normal',
        event_timestamp_ms: Date.now(),
        expiration_at_ms: Date.now() + 30 * 24 * 60 * 60 * 1000
      }
    });

    mockGetPostgresPool.mockResolvedValue({
      query: mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 'org-1' }] })
        .mockResolvedValueOnce({ rows: [{ event_id: 'evt_1' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
    });

    const response = await revenuecatConnectService.handleWebhook(
      create(HandleWebhookRequestSchema, {
        json: body,
        signature: signPayload(body, webhookSecret)
      })
    );

    expect(JSON.parse(response.json)).toEqual({
      received: true,
      duplicate: false
    });
    expect(String(mockQuery.mock.calls[0]?.[0])).toContain(
      'SELECT id FROM organizations'
    );
    expect(String(mockQuery.mock.calls[1]?.[0])).toContain(
      'INSERT INTO revenuecat_webhook_events'
    );
    expect(String(mockQuery.mock.calls[2]?.[0])).toContain(
      'INSERT INTO organization_billing_accounts'
    );
    expect(String(mockQuery.mock.calls[3]?.[0])).toContain(
      'UPDATE revenuecat_webhook_events'
    );
  });

  it('returns duplicate=true when event_id was already ingested', async () => {
    const body = JSON.stringify({
      event: {
        id: 'evt_1',
        type: 'RENEWAL',
        app_user_id: 'org:org-1',
        event_timestamp_ms: Date.now()
      }
    });

    mockGetPostgresPool.mockResolvedValue({
      query: mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 'org-1' }] })
        .mockResolvedValueOnce({ rows: [] })
    });

    const response = await revenuecatConnectService.handleWebhook(
      create(HandleWebhookRequestSchema, {
        json: body,
        signature: signPayload(body, webhookSecret)
      })
    );

    expect(JSON.parse(response.json)).toEqual({
      received: true,
      duplicate: true
    });
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('maps invalid signatures to unauthenticated connect errors', async () => {
    const body = JSON.stringify({
      event: {
        id: 'evt_invalid_sig',
        type: 'RENEWAL',
        app_user_id: 'org:org-1',
        event_timestamp_ms: Date.now()
      }
    });

    await expect(
      revenuecatConnectService.handleWebhook(
        create(HandleWebhookRequestSchema, {
          json: body,
          signature: '  '
        })
      )
    ).rejects.toMatchObject({
      code: Code.Unauthenticated
    });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('treats empty json input as an invalid payload', async () => {
    const emptyPayload = '{}';

    await expect(
      revenuecatConnectService.handleWebhook(
        create(HandleWebhookRequestSchema, {
          json: '   ',
          signature: signPayload(emptyPayload, webhookSecret)
        })
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('maps missing webhook secret to internal connect errors', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    unsetTestEnv('REVENUECAT_WEBHOOK_SECRET');

    const body = JSON.stringify({
      event: {
        id: 'evt_missing_secret',
        type: 'RENEWAL',
        app_user_id: 'org:org-1',
        event_timestamp_ms: Date.now()
      }
    });

    try {
      await expect(
        revenuecatConnectService.handleWebhook(
          create(HandleWebhookRequestSchema, {
            json: body,
            signature: signPayload(body, webhookSecret)
          })
        )
      ).rejects.toMatchObject({
        code: Code.Internal
      });
      expect(mockQuery).not.toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
