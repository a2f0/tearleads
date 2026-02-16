import { renderHook, waitFor, act } from '@testing-library/react';
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
  const mockColumns = [{ name: 'id', type: 'integer' }, { name: 'email', type: 'text' }];
  const mockRows = [{ id: 1, email: 'test@example.com' }];

  beforeEach(() => {
    vi.clearAllMocks();
    (api.admin.postgres.getColumns as any).mockResolvedValue({ columns: mockColumns });
    (api.admin.postgres.getRows as any).mockResolvedValue({ rows: mockRows, totalCount: 1 });
  });

  it('fetches columns and rows on mount', async () => {
    const { result } = renderHook(() => usePostgresTableData(mockSchema, mockTable));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.columns).toEqual(mockColumns);
    expect(result.current.rows).toEqual(mockRows);
    expect(api.admin.postgres.getColumns).toHaveBeenCalledWith(mockSchema, mockTable);
    expect(api.admin.postgres.getRows).toHaveBeenCalled();
  });

  it('handles sorting', async () => {
    const { result } = renderHook(() => usePostgresTableData(mockSchema, mockTable));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      result.current.handleSort('email');
    });

    await waitFor(() => {
      expect(result.current.sort).toEqual({ column: 'email', direction: 'asc' });
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
