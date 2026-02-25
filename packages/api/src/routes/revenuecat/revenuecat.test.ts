import { createHmac } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../index.js';

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

describe('RevenueCat webhook routes', () => {
  const webhookSecret = 'webhook-secret';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('REVENUECAT_WEBHOOK_SECRET', webhookSecret);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('accepts and processes a valid webhook event', async () => {
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

    const response = await request(app)
      .post('/v1/revenuecat/webhooks')
      .set('Content-Type', 'application/json')
      .set('x-revenuecat-signature', signPayload(body, webhookSecret))
      .send(body);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: true, duplicate: false });
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

    const response = await request(app)
      .post('/v1/revenuecat/webhooks')
      .set('Content-Type', 'application/json')
      .set('x-revenuecat-signature', signPayload(body, webhookSecret))
      .send(body);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: true, duplicate: true });
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('accepts events with non-organization app user IDs without billing upsert', async () => {
    const body = JSON.stringify({
      event: {
        id: 'evt_2',
        type: 'INITIAL_PURCHASE',
        app_user_id: '$RCAnonymousID:123',
        event_timestamp_ms: Date.now()
      }
    });

    mockGetPostgresPool.mockResolvedValue({
      query: mockQuery
        .mockResolvedValueOnce({ rows: [{ event_id: 'evt_2' }] })
        .mockResolvedValueOnce({ rows: [] })
    });

    const response = await request(app)
      .post('/v1/revenuecat/webhooks')
      .set('Content-Type', 'application/json')
      .set('x-revenuecat-signature', signPayload(body, webhookSecret))
      .send(body);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: true, duplicate: false });
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(String(mockQuery.mock.calls[0]?.[0])).toContain(
      'INSERT INTO revenuecat_webhook_events'
    );
    expect(String(mockQuery.mock.calls[1]?.[0])).toContain(
      'UPDATE revenuecat_webhook_events'
    );
  });

  it('ignores unsupported RevenueCat event types', async () => {
    const body = JSON.stringify({
      event: {
        id: 'evt_unsupported',
        type: 'TRANSFER',
        app_user_id: 'org:org-1',
        event_timestamp_ms: Date.now()
      }
    });

    mockGetPostgresPool.mockResolvedValue({
      query: mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 'org-1' }] })
        .mockResolvedValueOnce({ rows: [{ event_id: 'evt_unsupported' }] })
        .mockResolvedValueOnce({ rows: [] })
    });

    const response = await request(app)
      .post('/v1/revenuecat/webhooks')
      .set('Content-Type', 'application/json')
      .set('x-revenuecat-signature', signPayload(body, webhookSecret))
      .send(body);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      received: true,
      duplicate: false,
      ignored: true,
      reason: 'unsupported_event_type'
    });
    expect(mockQuery).toHaveBeenCalledTimes(3);
    expect(String(mockQuery.mock.calls[2]?.[0])).toContain('processing_error');
  });

  it('ignores events outside the replay window', async () => {
    vi.stubEnv('REVENUECAT_WEBHOOK_MAX_AGE_SECONDS', '60');
    const body = JSON.stringify({
      event: {
        id: 'evt_old',
        type: 'RENEWAL',
        app_user_id: 'org:org-1',
        event_timestamp_ms: Date.now() - 3600 * 1000
      }
    });

    mockGetPostgresPool.mockResolvedValue({
      query: mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 'org-1' }] })
        .mockResolvedValueOnce({ rows: [{ event_id: 'evt_old' }] })
        .mockResolvedValueOnce({ rows: [] })
    });

    const response = await request(app)
      .post('/v1/revenuecat/webhooks')
      .set('Content-Type', 'application/json')
      .set('x-revenuecat-signature', signPayload(body, webhookSecret))
      .send(body);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      received: true,
      duplicate: false,
      ignored: true,
      reason: 'event_too_old'
    });
    expect(mockQuery).toHaveBeenCalledTimes(3);
    expect(String(mockQuery.mock.calls[2]?.[0])).toContain('processing_error');
  });

  it('ignores events missing event timestamps', async () => {
    const body = JSON.stringify({
      event: {
        id: 'evt_missing_timestamp',
        type: 'RENEWAL',
        app_user_id: 'org:org-1'
      }
    });

    mockGetPostgresPool.mockResolvedValue({
      query: mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 'org-1' }] })
        .mockResolvedValueOnce({
          rows: [{ event_id: 'evt_missing_timestamp' }]
        })
        .mockResolvedValueOnce({ rows: [] })
    });

    const response = await request(app)
      .post('/v1/revenuecat/webhooks')
      .set('Content-Type', 'application/json')
      .set('x-revenuecat-signature', signPayload(body, webhookSecret))
      .send(body);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      received: true,
      duplicate: false,
      ignored: true,
      reason: 'missing_event_timestamp'
    });
    expect(mockQuery).toHaveBeenCalledTimes(3);
    expect(String(mockQuery.mock.calls[2]?.[0])).toContain('processing_error');
  });

  it('rejects webhook requests with invalid signature', async () => {
    const response = await request(app)
      .post('/v1/revenuecat/webhooks')
      .set('Content-Type', 'application/json')
      .set('x-revenuecat-signature', 'invalid')
      .send('{}');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Invalid webhook signature' });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects invalid webhook payloads', async () => {
    const body = JSON.stringify({
      event: {
        id: 'evt_3'
      }
    });

    const response = await request(app)
      .post('/v1/revenuecat/webhooks')
      .set('Content-Type', 'application/json')
      .set('x-revenuecat-signature', signPayload(body, webhookSecret))
      .send(body);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'Invalid RevenueCat webhook payload'
    });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('records processing errors and returns 500', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const body = JSON.stringify({
      event: {
        id: 'evt_4',
        type: 'INITIAL_PURCHASE',
        app_user_id: 'org:org-1'
      }
    });

    mockGetPostgresPool.mockResolvedValue({
      query: mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 'org-1' }] })
        .mockResolvedValueOnce({ rows: [{ event_id: 'evt_4' }] })
        .mockRejectedValueOnce(new Error('upsert failed'))
        .mockResolvedValueOnce({ rows: [] })
    });

    const response = await request(app)
      .post('/v1/revenuecat/webhooks')
      .set('Content-Type', 'application/json')
      .set('x-revenuecat-signature', signPayload(body, webhookSecret))
      .send(body);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: 'Failed to process RevenueCat webhook'
    });
    expect(String(mockQuery.mock.calls[3]?.[0])).toContain('processing_error');
    consoleError.mockRestore();
  });

  it('returns 500 when webhook secret is missing', async () => {
    vi.unstubAllEnvs();
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const body = JSON.stringify({
      event: {
        id: 'evt_missing_secret',
        type: 'RENEWAL',
        app_user_id: 'org:org-1',
        event_timestamp_ms: Date.now()
      }
    });

    const response = await request(app)
      .post('/v1/revenuecat/webhooks')
      .set('Content-Type', 'application/json')
      .set('x-revenuecat-signature', signPayload(body, webhookSecret))
      .send(body);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: 'RevenueCat webhook secret is not configured'
    });
    expect(mockQuery).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('returns 500 when event ingestion fails before processing', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const body = JSON.stringify({
      event: {
        id: 'evt_ingest_fail',
        type: 'RENEWAL',
        app_user_id: 'org:org-1',
        event_timestamp_ms: Date.now()
      }
    });

    mockGetPostgresPool.mockRejectedValue(new Error('pool unavailable'));

    const response = await request(app)
      .post('/v1/revenuecat/webhooks')
      .set('Content-Type', 'application/json')
      .set('x-revenuecat-signature', signPayload(body, webhookSecret))
      .send(body);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: 'Failed to ingest RevenueCat webhook'
    });
    consoleError.mockRestore();
  });

  it('ignores events that are too far in the future', async () => {
    vi.stubEnv('REVENUECAT_WEBHOOK_MAX_FUTURE_SKEW_SECONDS', '60');
    const body = JSON.stringify({
      event: {
        id: 'evt_future',
        type: 'RENEWAL',
        app_user_id: 'org:org-1',
        event_timestamp_ms: Date.now() + 10 * 60 * 1000
      }
    });

    mockGetPostgresPool.mockResolvedValue({
      query: mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 'org-1' }] })
        .mockResolvedValueOnce({ rows: [{ event_id: 'evt_future' }] })
        .mockResolvedValueOnce({ rows: [] })
    });

    const response = await request(app)
      .post('/v1/revenuecat/webhooks')
      .set('Content-Type', 'application/json')
      .set('x-revenuecat-signature', signPayload(body, webhookSecret))
      .send(body);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      received: true,
      duplicate: false,
      ignored: true,
      reason: 'event_too_far_in_future'
    });
  });
});
