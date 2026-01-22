import { describe, expect, it, vi } from 'vitest';
import { getDatabaseAdapter } from '@/db';
import { downloadFile } from '@/lib/file-utils';
import {
  exportTableAsCsv,
  getNumberField,
  getStringField,
  parseColumnInfo
} from './exportTableCsv';

vi.mock('@/db', () => ({
  getDatabaseAdapter: vi.fn()
}));

vi.mock('@/lib/file-utils', () => ({
  downloadFile: vi.fn()
}));

describe('exportTableCsv helpers', () => {
  it('returns string fields when present', () => {
    expect(getStringField({ name: 'table' }, 'name')).toBe('table');
    expect(getStringField({ name: 123 }, 'name')).toBeNull();
  });

  it('returns numeric fields when present', () => {
    expect(getNumberField({ pk: 1 }, 'pk')).toBe(1);
    expect(getNumberField({ pk: NaN }, 'pk')).toBeNull();
  });

  it('parses column info and filters invalid rows', () => {
    const columns = parseColumnInfo([
      { name: 'id', type: 'integer', pk: 1 },
      { name: 'title', type: 'text', pk: 0 },
      { name: 'missing-type', pk: 0 }
    ]);

    expect(columns).toEqual([
      { name: 'id', type: 'integer', pk: 1 },
      { name: 'title', type: 'text', pk: 0 }
    ]);
  });
});

describe('exportTableAsCsv', () => {
  it('throws when table does not exist', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    vi.mocked(getDatabaseAdapter).mockReturnValue({ execute });

    await expect(
      exportTableAsCsv({
        tableName: 'missing_table',
        columns: []
      })
    ).rejects.toThrow('Table "missing_table" does not exist.');
  });

  it('exports with provided columns without schema lookup', async () => {
    const execute = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes('sqlite_master')) {
        return Promise.resolve({ rows: [{ name: 'analytics_events' }] });
      }
      if (sql.includes('PRAGMA table_info')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({
        rows: [
          {
            event_name: 'db_setup',
            duration_ms: 120,
            success: 1,
            timestamp: 1_700_000_000_000,
            detail: null
          }
        ]
      });
    });

    vi.mocked(getDatabaseAdapter).mockReturnValue({ execute });

    await exportTableAsCsv({
      tableName: 'analytics_events',
      columns: [
        { name: 'event_name', type: 'text', pk: 0 },
        { name: 'duration_ms', type: 'integer', pk: 0 },
        { name: 'success', type: 'integer', pk: 0 }
      ],
      sortColumn: 'duration_ms',
      sortDirection: 'desc'
    });

    expect(
      execute.mock.calls.some(([sql]) =>
        String(sql).includes('PRAGMA table_info')
      )
    ).toBe(false);
    expect(downloadFile).toHaveBeenCalledTimes(1);
    expect(downloadFile).toHaveBeenCalledWith(
      expect.anything(),
      'analytics_events.csv'
    );
  });

  it('resolves columns when none are provided', async () => {
    const execute = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes('sqlite_master')) {
        return Promise.resolve({ rows: [{ name: 'analytics_events' }] });
      }
      if (sql.includes('PRAGMA table_info')) {
        return Promise.resolve({
          rows: [{ name: 'id', type: 'integer', pk: 1 }]
        });
      }
      return Promise.resolve({ rows: [{ id: 1 }] });
    });

    const onColumnsResolved = vi.fn();
    vi.mocked(getDatabaseAdapter).mockReturnValue({ execute });

    await exportTableAsCsv({
      tableName: 'analytics_events',
      columns: [],
      onColumnsResolved
    });

    expect(onColumnsResolved).toHaveBeenCalledWith([
      { name: 'id', type: 'integer', pk: 1 }
    ]);
  });
});
