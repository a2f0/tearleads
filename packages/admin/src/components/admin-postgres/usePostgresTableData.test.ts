import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { usePostgresTableData } from './usePostgresTableData';

vi.mock('@/lib/api', () => ({
  api: {
    admin: {
      postgres: {
        getColumns: vi.fn(),
        getRows: vi.fn()
      }
    }
  }
}));

describe('usePostgresTableData', () => {
  const mockSchema = 'public';
  const mockTable = 'users';
  const mockColumns = [
    { name: 'id', type: 'integer' },
    { name: 'email', type: 'text' }
  ];
  const mockRows = [{ id: 1, email: 'test@example.com' }];
  const mockedGetColumns = vi.mocked(api.admin.postgres.getColumns);
  const mockedGetRows = vi.mocked(api.admin.postgres.getRows);

  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetColumns.mockResolvedValue({ columns: mockColumns });
    mockedGetRows.mockResolvedValue({
      rows: mockRows,
      totalCount: 1
    });
  });

  it('fetches columns and rows on mount', async () => {
    const { result } = renderHook(() =>
      usePostgresTableData(mockSchema, mockTable)
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.columns).toEqual(mockColumns);
    expect(result.current.rows).toEqual(mockRows);
    expect(api.admin.postgres.getColumns).toHaveBeenCalledWith(
      mockSchema,
      mockTable
    );
    expect(api.admin.postgres.getRows).toHaveBeenCalled();
  });

  it('handles sorting', async () => {
    const { result } = renderHook(() =>
      usePostgresTableData(mockSchema, mockTable)
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      result.current.handleSort('email');
    });

    await waitFor(() => {
      expect(result.current.sort).toEqual({
        column: 'email',
        direction: 'asc'
      });
    });

    await waitFor(() => {
      expect(api.admin.postgres.getRows).toHaveBeenCalledWith(
        mockSchema,
        mockTable,
        expect.objectContaining({ sortColumn: 'email', sortDirection: 'asc' })
      );
    });
  });
});
