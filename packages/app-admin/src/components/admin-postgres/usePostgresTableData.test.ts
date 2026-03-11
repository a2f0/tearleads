import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { usePostgresTableData } from './usePostgresTableData';

vi.mock('@/lib/api', () => ({
  api: {
    adminV2: {
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
    {
      name: 'id',
      type: 'integer',
      nullable: false,
      defaultValue: null,
      ordinalPosition: 1
    },
    {
      name: 'email',
      type: 'text',
      nullable: false,
      defaultValue: null,
      ordinalPosition: 2
    }
  ];
  const mockRows = [{ id: 1, email: 'test@example.com' }];
  const getColumnsSpy = vi.spyOn(api.adminV2.postgres, 'getColumns');
  const getRowsSpy = vi.spyOn(api.adminV2.postgres, 'getRows');

  beforeEach(() => {
    vi.clearAllMocks();
    getColumnsSpy.mockResolvedValue({ columns: mockColumns });
    getRowsSpy.mockResolvedValue({
      rows: mockRows,
      totalCount: 1n,
      limit: 50,
      offset: 0
    });
  });

  it('fetches columns and rows on mount', async () => {
    const { result } = renderHook(() =>
      usePostgresTableData(mockSchema, mockTable)
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.columns).toEqual(mockColumns);
    expect(result.current.rows).toEqual(mockRows);
    expect(result.current.totalCount).toBe(1n);
    expect(api.adminV2.postgres.getColumns).toHaveBeenCalledWith(
      mockSchema,
      mockTable
    );
    expect(api.adminV2.postgres.getRows).toHaveBeenCalled();
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
      expect(api.adminV2.postgres.getRows).toHaveBeenCalledWith(
        mockSchema,
        mockTable,
        expect.objectContaining({ sortColumn: 'email', sortDirection: 'asc' })
      );
    });
  });
});
