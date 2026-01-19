import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../index.js';

const mockQuery = vi.fn();
const mockGetPostgresPool = vi.fn();
const mockGetPostgresConnectionInfo = vi.fn();

vi.mock('../../lib/postgres.js', () => ({
  getPostgresPool: () => mockGetPostgresPool(),
  getPostgresConnectionInfo: () => mockGetPostgresConnectionInfo()
}));

describe('admin postgres routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /v1/admin/postgres/info returns connection info and version', async () => {
    mockGetPostgresPool.mockResolvedValue({
      query: mockQuery.mockResolvedValue({
        rows: [{ version: 'PostgreSQL 15.1' }]
      })
    });
    mockGetPostgresConnectionInfo.mockReturnValue({
      host: 'localhost',
      port: 5432,
      database: 'rapid',
      user: 'rapid'
    });

    const response = await request(app).get('/v1/admin/postgres/info');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'ok',
      info: {
        host: 'localhost',
        port: 5432,
        database: 'rapid',
        user: 'rapid'
      },
      serverVersion: 'PostgreSQL 15.1'
    });
  });

  it('GET /v1/admin/postgres/info returns 500 on error', async () => {
    mockGetPostgresPool.mockRejectedValue(new Error('connection failed'));

    const response = await request(app).get('/v1/admin/postgres/info');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'connection failed' });
  });

  it('GET /v1/admin/postgres/tables returns table data', async () => {
    mockGetPostgresPool.mockResolvedValue({
      query: mockQuery.mockResolvedValue({
        rows: [
          {
            schema: 'public',
            name: 'users',
            row_count: '12',
            total_bytes: '2048',
            table_bytes: '1024',
            index_bytes: '1024'
          },
          {
            schema: 'analytics',
            name: 'events',
            row_count: 7,
            total_bytes: 4096,
            table_bytes: 3072,
            index_bytes: null
          }
        ]
      })
    });

    const response = await request(app).get('/v1/admin/postgres/tables');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      tables: [
        {
          schema: 'public',
          name: 'users',
          rowCount: 12,
          totalBytes: 2048,
          tableBytes: 1024,
          indexBytes: 1024
        },
        {
          schema: 'analytics',
          name: 'events',
          rowCount: 7,
          totalBytes: 4096,
          tableBytes: 3072,
          indexBytes: 0
        }
      ]
    });
  });

  it('GET /v1/admin/postgres/tables returns 500 on error', async () => {
    mockGetPostgresPool.mockRejectedValue(new Error('query failed'));

    const response = await request(app).get('/v1/admin/postgres/tables');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'query failed' });
  });
});
