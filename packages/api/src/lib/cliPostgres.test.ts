import { describe, expect, it, vi } from 'vitest';
import { buildPostgresConnectionLabel } from './cliPostgres.js';

const mockGetPostgresConnectionInfo = vi.fn();

vi.mock('./postgres.js', () => ({
  getPostgresConnectionInfo: () => mockGetPostgresConnectionInfo()
}));

describe('buildPostgresConnectionLabel', () => {
  it('builds a label with available connection info', () => {
    mockGetPostgresConnectionInfo.mockReturnValue({
      host: 'localhost',
      port: 5432,
      user: 'tearleads',
      database: 'tearleads_test'
    });

    expect(buildPostgresConnectionLabel()).toBe(
      'host=localhost, port=5432, user=tearleads, database=tearleads_test'
    );
  });

  it('omits missing optional connection fields', () => {
    mockGetPostgresConnectionInfo.mockReturnValue({
      host: undefined,
      port: undefined,
      user: undefined,
      database: 'tearleads_test'
    });

    expect(buildPostgresConnectionLabel()).toBe('database=tearleads_test');
  });

  it('throws when database is missing', () => {
    mockGetPostgresConnectionInfo.mockReturnValue({
      host: 'localhost',
      port: 5432,
      user: 'tearleads',
      database: undefined
    });

    expect(() => buildPostgresConnectionLabel()).toThrow(
      'Missing Postgres connection info. Set DATABASE_URL or PGDATABASE/POSTGRES_DATABASE (plus PGHOST/PGPORT/PGUSER as needed).'
    );
  });
});
