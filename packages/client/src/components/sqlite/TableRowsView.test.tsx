import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TableRowsView } from './TableRowsView';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: vi.fn(({ count }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({
        index: i,
        start: i * 40,
        size: 40,
        key: i
      })),
    getTotalSize: () => count * 40,
    measureElement: vi.fn()
  }))
}));

const mockExecute = vi.fn();
vi.mock('@/db', () => ({
  getDatabaseAdapter: vi.fn(() => ({
    execute: mockExecute
  }))
}));

const mockUseDatabaseContext = vi.fn();
vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockUseDatabaseContext()
}));

const mockDownloadFile = vi.fn();
vi.mock('@/lib/file-utils', () => ({
  downloadFile: (data: Uint8Array, filename: string) =>
    mockDownloadFile(data, filename)
}));

async function flushEffects() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
}

describe('TableRowsView', () => {
  const mockColumns = [
    {
      cid: 0,
      name: 'id',
      type: 'INTEGER',
      notnull: 0,
      dflt_value: null,
      pk: 1
    },
    { cid: 1, name: 'name', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
    {
      cid: 2,
      name: 'age',
      type: 'INTEGER',
      notnull: 0,
      dflt_value: null,
      pk: 0
    }
  ];

  const mockRows = [
    { id: 1, name: 'Alice', age: 30 },
    { id: 2, name: 'Bob', age: 25 }
  ];

  beforeEach(() => {
    vi.clearAllMocks();

    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: true,
      isLoading: false,
      currentInstanceId: 'test-instance'
    });

    mockExecute.mockImplementation((query: string) => {
      if (query.includes('sqlite_master')) {
        return Promise.resolve({ rows: [{ name: 'test_table' }] });
      }
      if (query.includes('PRAGMA table_info')) {
        return Promise.resolve({ rows: mockColumns });
      }
      if (query.includes('COUNT(*)')) {
        return Promise.resolve({ rows: [{ count: mockRows.length }] });
      }
      if (query.includes('SELECT * FROM "test_table"')) {
        return Promise.resolve({ rows: mockRows });
      }
      return Promise.resolve({ rows: [] });
    });
  });

  it('exports table rows to csv via handler', async () => {
    const onExportCsvChange = vi.fn();

    render(
      <TableRowsView
        tableName="test_table"
        onExportCsvChange={onExportCsvChange}
      />
    );
    await flushEffects();

    const handler = onExportCsvChange.mock.calls.find(
      ([exportHandler]) => exportHandler
    )?.[0] as (() => Promise<void>) | undefined;

    expect(handler).toBeDefined();

    await act(async () => {
      await handler?.();
    });

    await waitFor(() => {
      expect(mockDownloadFile).toHaveBeenCalled();
    });

    const [data, filename] = mockDownloadFile.mock.calls[0] ?? [];
    expect(filename).toBe('test_table.csv');
    const text = new TextDecoder().decode(data);
    expect(text).toBe('id,name,age\r\n1,Alice,30\r\n2,Bob,25');
  });
});
