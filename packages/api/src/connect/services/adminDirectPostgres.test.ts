import { Code } from '@connectrpc/connect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getPoolMock,
  getPostgresConnectionInfoMock,
  queryMock,
  requireAdminSessionMock
} = vi.hoisted(() => ({
  getPoolMock: vi.fn(),
  getPostgresConnectionInfoMock: vi.fn(),
  queryMock: vi.fn(),
  requireAdminSessionMock: vi.fn()
}));

vi.mock('../../lib/postgres.js', () => ({
  getPool: (...args: unknown[]) => getPoolMock(...args),
  getPostgresConnectionInfo: (...args: unknown[]) =>
    getPostgresConnectionInfoMock(...args)
}));

vi.mock('./adminDirectAuth.js', async () => {
  const actual = await vi.importActual<typeof import('./adminDirectAuth.js')>(
    './adminDirectAuth.js'
  );
  return {
    ...actual,
    requireAdminSession: (...args: unknown[]) =>
      requireAdminSessionMock(...args)
  };
});

import {
  getColumnsDirect,
  getPostgresInfoDirect,
  getRowsDirect,
  getTablesDirect
} from './adminDirectPostgres.js';

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJson(json: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(json);
  if (!isRecord(parsed)) {
    throw new Error('Expected object JSON response');
  }
  return parsed;
}

describe('adminDirectPostgres', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryMock.mockReset();
    getPoolMock.mockReset();
    requireAdminSessionMock.mockReset();
    getPostgresConnectionInfoMock.mockReset();

    getPoolMock.mockResolvedValue({
      query: queryMock
    });
    requireAdminSessionMock.mockResolvedValue({
      sub: 'admin-1'
    });
    getPostgresConnectionInfoMock.mockReturnValue({
      host: 'localhost',
      port: 5432
    });

    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy?.mockRestore();
    consoleErrorSpy = null;
  });

  it('returns postgres connection info and version', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ version: 'PostgreSQL 16.0' }]
    });

    const response = await getPostgresInfoDirect(
      {},
      {
        requestHeader: new Headers()
      }
    );

    expect(requireAdminSessionMock).toHaveBeenCalledWith(
      '/admin/postgres/info',
      expect.any(Headers)
    );
    expect(parseJson(response.json)).toEqual({
      status: 'ok',
      info: {
        host: 'localhost',
        port: 5432
      },
      serverVersion: 'PostgreSQL 16.0'
    });
  });

  it('maps postgres table metadata rows', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          schema: 'public',
          name: 'users',
          row_count: '12',
          total_bytes: '1024',
          table_bytes: '768',
          index_bytes: '256'
        }
      ]
    });

    const response = await getTablesDirect(
      {},
      {
        requestHeader: new Headers()
      }
    );

    expect(parseJson(response.json)).toEqual({
      tables: [
        {
          schema: 'public',
          name: 'users',
          rowCount: 12,
          totalBytes: 1024,
          tableBytes: 768,
          indexBytes: 256
        }
      ]
    });
  });

  it('returns not found for unknown table columns', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ exists: false }]
    });

    await expect(
      getColumnsDirect(
        {
          schema: 'public',
          table: 'missing'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.NotFound
    });
  });

  it('returns columns for existing table', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ exists: true }]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            column_name: 'id',
            data_type: 'text',
            is_nullable: 'NO',
            column_default: null,
            ordinal_position: 1
          }
        ]
      });

    const response = await getColumnsDirect(
      {
        schema: 'public',
        table: 'users'
      },
      {
        requestHeader: new Headers()
      }
    );

    expect(parseJson(response.json)).toEqual({
      columns: [
        {
          name: 'id',
          type: 'text',
          nullable: false,
          defaultValue: null,
          ordinalPosition: 1
        }
      ]
    });
  });

  it('normalizes row pagination and applies valid sorting', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ column_name: 'email' }, { column_name: 'created_at' }]
      })
      .mockResolvedValueOnce({
        rows: [{ count: '2' }]
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'user-1', email: 'admin@example.com' }]
      });

    const response = await getRowsDirect(
      {
        schema: 'public',
        table: 'users',
        limit: 0,
        offset: -10,
        sortColumn: 'email',
        sortDirection: 'desc'
      },
      {
        requestHeader: new Headers()
      }
    );

    const rowQueryCall = queryMock.mock.calls[2];
    if (!rowQueryCall) {
      throw new Error('Expected row query call');
    }

    const [rowQuerySql, rowQueryParams] = rowQueryCall;
    expect(rowQuerySql).toContain('ORDER BY "email" DESC');
    expect(rowQuerySql).toContain('LIMIT $1 OFFSET $2');
    expect(rowQueryParams).toEqual([50, 0]);

    expect(parseJson(response.json)).toEqual({
      rows: [{ id: 'user-1', email: 'admin@example.com' }],
      totalCount: 2,
      limit: 50,
      offset: 0
    });
  });

  it('returns not found for row queries when table is missing', async () => {
    queryMock.mockResolvedValueOnce({
      rows: []
    });

    await expect(
      getRowsDirect(
        {
          schema: 'public',
          table: 'missing',
          limit: 10,
          offset: 0,
          sortColumn: '',
          sortDirection: ''
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.NotFound
    });
  });

  it('maps unexpected postgres failures to internal errors', async () => {
    getPoolMock.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(
      getTablesDirect(
        {},
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.Internal
    });
  });
});
