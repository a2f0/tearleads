import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../index.js';
import { createAuthHeader } from '../../test/auth.js';
import { coerceNumber } from './postgres/shared.js';

const mockQuery = vi.fn();
const mockGetPostgresPool = vi.fn();
const mockGetPostgresConnectionInfo = vi.fn();

vi.mock('../../lib/postgres.js', () => ({
  getPostgresPool: () => mockGetPostgresPool(),
  getPool: () => mockGetPostgresPool(),
  getPostgresConnectionInfo: () => mockGetPostgresConnectionInfo()
}));

describe('admin postgres routes', () => {
  let authHeader: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv('JWT_SECRET', 'test-secret');
    authHeader = await createAuthHeader({
      id: 'admin-1',
      email: 'admin@example.com',
      admin: true
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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
      database: 'tearleads',
      user: 'tearleads'
    });

    const response = await request(app)
      .get('/v1/admin/postgres/info')
      .set('Authorization', authHeader);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'ok',
      info: {
        host: 'localhost',
        port: 5432,
        database: 'tearleads',
        user: 'tearleads'
      },
      serverVersion: 'PostgreSQL 15.1'
    });
  });

  it('GET /v1/admin/postgres/info returns 500 on error', async () => {
    mockGetPostgresPool.mockRejectedValue(new Error('connection failed'));
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const response = await request(app)
      .get('/v1/admin/postgres/info')
      .set('Authorization', authHeader);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'connection failed' });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
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

    const response = await request(app)
      .get('/v1/admin/postgres/tables')
      .set('Authorization', authHeader);

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
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const response = await request(app)
      .get('/v1/admin/postgres/tables')
      .set('Authorization', authHeader);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'query failed' });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  describe('GET /v1/admin/postgres/tables/:schema/:table/columns', () => {
    it('returns column metadata for a table', async () => {
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery
          .mockResolvedValueOnce({ rows: [{ exists: true }] })
          .mockResolvedValueOnce({
            rows: [
              {
                column_name: 'id',
                data_type: 'integer',
                is_nullable: 'NO',
                column_default: null,
                ordinal_position: 1
              },
              {
                column_name: 'name',
                data_type: 'text',
                is_nullable: 'YES',
                column_default: "'default'",
                ordinal_position: 2
              }
            ]
          })
      });

      const response = await request(app)
        .get('/v1/admin/postgres/tables/public/users/columns')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        columns: [
          {
            name: 'id',
            type: 'integer',
            nullable: false,
            defaultValue: null,
            ordinalPosition: 1
          },
          {
            name: 'name',
            type: 'text',
            nullable: true,
            defaultValue: "'default'",
            ordinalPosition: 2
          }
        ]
      });
    });

    it('returns 404 when table not found', async () => {
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery.mockResolvedValue({ rows: [{ exists: false }] })
      });

      const response = await request(app)
        .get('/v1/admin/postgres/tables/public/nonexistent/columns')
        .set('Authorization', authHeader);

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Table not found' });
    });

    it('returns 500 on error', async () => {
      mockGetPostgresPool.mockRejectedValue(new Error('query failed'));
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const response = await request(app)
        .get('/v1/admin/postgres/tables/public/users/columns')
        .set('Authorization', authHeader);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'query failed' });
      consoleError.mockRestore();
    });
  });

  describe('GET /v1/admin/postgres/tables/:schema/:table/rows', () => {
    it('returns paginated rows', async () => {
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery
          .mockResolvedValueOnce({
            rows: [{ column_name: 'id' }, { column_name: 'name' }]
          })
          .mockResolvedValueOnce({ rows: [{ count: '100' }] })
          .mockResolvedValueOnce({
            rows: [
              { id: 1, name: 'Alice' },
              { id: 2, name: 'Bob' }
            ]
          })
      });

      const response = await request(app)
        .get('/v1/admin/postgres/tables/public/users/rows?limit=2&offset=0')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        rows: [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' }
        ],
        totalCount: 100,
        limit: 2,
        offset: 0
      });
    });

    it('returns rows with sorting', async () => {
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery
          .mockResolvedValueOnce({
            rows: [{ column_name: 'id' }, { column_name: 'name' }]
          })
          .mockResolvedValueOnce({ rows: [{ count: '10' }] })
          .mockResolvedValueOnce({
            rows: [{ id: 2, name: 'Bob' }]
          })
      });

      const response = await request(app)
        .get(
          '/v1/admin/postgres/tables/public/users/rows?sortColumn=name&sortDirection=desc'
        )
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body.rows).toEqual([{ id: 2, name: 'Bob' }]);
    });

    it('ignores invalid sort column', async () => {
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery
          .mockResolvedValueOnce({
            rows: [{ column_name: 'id' }]
          })
          .mockResolvedValueOnce({ rows: [{ count: '5' }] })
          .mockResolvedValueOnce({
            rows: [{ id: 1 }]
          })
      });

      const response = await request(app)
        .get(
          '/v1/admin/postgres/tables/public/users/rows?sortColumn=invalid_col'
        )
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
    });

    it('returns 404 when table not found', async () => {
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery.mockResolvedValue({ rows: [] })
      });

      const response = await request(app)
        .get('/v1/admin/postgres/tables/public/nonexistent/rows')
        .set('Authorization', authHeader);

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Table not found' });
    });

    it('returns 500 on error', async () => {
      mockGetPostgresPool.mockRejectedValue(new Error('query failed'));
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const response = await request(app)
        .get('/v1/admin/postgres/tables/public/users/rows')
        .set('Authorization', authHeader);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'query failed' });
      consoleError.mockRestore();
    });

    it('clamps limit to valid range', async () => {
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery
          .mockResolvedValueOnce({ rows: [{ column_name: 'id' }] })
          .mockResolvedValueOnce({ rows: [{ count: '0' }] })
          .mockResolvedValueOnce({ rows: [] })
      });

      const response = await request(app)
        .get('/v1/admin/postgres/tables/public/users/rows?limit=9999')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body.limit).toBe(1000);
    });
  });
});

describe('coerceNumber', () => {
  it('returns 0 for non-numeric strings', () => {
    expect(coerceNumber('not-a-number')).toBe(0);
    expect(coerceNumber('Infinity')).toBe(0);
  });
});
