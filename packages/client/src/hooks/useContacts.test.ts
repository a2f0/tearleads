import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useContacts } from './useContacts';

const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockLeftJoin = vi.fn();
const mockWhere = vi.fn();
const mockOrderBy = vi.fn();

vi.mock('@/db', () => ({
  getDatabase: () => ({
    select: mockSelect
  })
}));

const mockDatabaseContext = {
  isUnlocked: true,
  isLoading: false,
  currentInstanceId: 'test-instance'
};

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockDatabaseContext
}));

describe('useContacts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDatabaseContext.isUnlocked = true;
    mockDatabaseContext.currentInstanceId = 'test-instance';

    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ leftJoin: mockLeftJoin });
    mockLeftJoin.mockReturnValue({ leftJoin: mockLeftJoin, where: mockWhere });
    mockWhere.mockReturnValue({ orderBy: mockOrderBy });
    mockOrderBy.mockResolvedValue([
      {
        id: '1',
        firstName: 'Alice',
        lastName: 'Smith',
        primaryEmail: 'alice@example.com',
        primaryPhone: '555-1234'
      }
    ]);
  });

  it('fetches contacts when unlocked', async () => {
    const { result } = renderHook(() => useContacts());

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    expect(result.current.contactsList).toHaveLength(1);
    expect(result.current.contactsList[0]?.firstName).toBe('Alice');
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('does not fetch when locked', async () => {
    mockDatabaseContext.isUnlocked = false;

    const { result } = renderHook(() => useContacts());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(result.current.hasFetched).toBe(false);
    expect(result.current.contactsList).toHaveLength(0);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('refetches when refreshToken changes', async () => {
    const { result, rerender } = renderHook(
      ({ refreshToken }) => useContacts({ refreshToken }),
      { initialProps: { refreshToken: 0 } }
    );

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    expect(mockOrderBy).toHaveBeenCalledTimes(1);

    act(() => {
      rerender({ refreshToken: 1 });
    });

    await waitFor(() => {
      expect(mockOrderBy).toHaveBeenCalledTimes(2);
    });
  });

  it('handles fetch errors', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    mockOrderBy.mockRejectedValue(new Error('Database error'));

    const { result } = renderHook(() => useContacts());

    await waitFor(() => {
      expect(result.current.error).toBe('Database error');
    });

    expect(result.current.contactsList).toHaveLength(0);
    expect(result.current.loading).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to fetch contacts:',
      expect.any(Error)
    );
    consoleErrorSpy.mockRestore();
  });

  it('refetches on instance change', async () => {
    const { result, rerender } = renderHook(() => useContacts());

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    expect(mockOrderBy).toHaveBeenCalledTimes(1);

    mockDatabaseContext.currentInstanceId = 'new-instance';
    rerender();

    await waitFor(() => {
      expect(mockOrderBy).toHaveBeenCalledTimes(2);
    });
  });

  it('exposes setHasFetched to trigger refetch', async () => {
    const { result } = renderHook(() => useContacts());

    await waitFor(() => {
      expect(result.current.hasFetched).toBe(true);
    });

    expect(mockOrderBy).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.setHasFetched(false);
    });

    await waitFor(() => {
      expect(mockOrderBy).toHaveBeenCalledTimes(2);
    });
  });
});
