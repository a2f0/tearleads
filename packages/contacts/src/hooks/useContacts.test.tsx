import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createWrapper } from '../test/testUtils';
import { useContacts } from './useContacts';

function createContactsQueryResult(id: string, firstName: string) {
  return [
    {
      id,
      firstName,
      lastName: null,
      primaryEmail: null,
      primaryPhone: null
    }
  ];
}

describe('useContacts', () => {
  it('refetches when group filter changes', async () => {
    const mockOrderBy = vi
      .fn()
      .mockResolvedValueOnce(createContactsQueryResult('contact-1', 'Alice'))
      .mockResolvedValueOnce(createContactsQueryResult('contact-2', 'Bob'));
    const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
    const chainTarget = {
      leftJoin: vi.fn(),
      innerJoin: vi.fn(),
      where: mockWhere
    };
    chainTarget.leftJoin = vi.fn().mockReturnValue(chainTarget);
    chainTarget.innerJoin = vi.fn().mockReturnValue(chainTarget);
    const mockFrom = vi.fn().mockReturnValue(chainTarget);
    const mockDatabase = {
      select: vi.fn().mockReturnValue({ from: mockFrom })
    };

    const wrapper = createWrapper({
      database: mockDatabase as never
    });

    const { result, rerender } = renderHook(
      ({ groupId }) => useContacts({ groupId }),
      {
        initialProps: { groupId: undefined as string | undefined },
        wrapper
      }
    );

    await waitFor(() => {
      expect(result.current.contactsList).toEqual(
        createContactsQueryResult('contact-1', 'Alice')
      );
    });

    rerender({ groupId: 'group-1' });

    await waitFor(() => {
      expect(result.current.contactsList).toEqual(
        createContactsQueryResult('contact-2', 'Bob')
      );
    });

    expect(mockOrderBy).toHaveBeenCalledTimes(2);
    expect(chainTarget.innerJoin).toHaveBeenCalledTimes(1);
  });

  it('refetches when active organization changes', async () => {
    const mockOrderBy = vi
      .fn()
      .mockResolvedValueOnce(createContactsQueryResult('contact-1', 'Alice'))
      .mockResolvedValueOnce(createContactsQueryResult('contact-2', 'Bob'));
    const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
    const chainTarget = {
      leftJoin: vi.fn(),
      innerJoin: vi.fn(),
      where: mockWhere
    };
    chainTarget.leftJoin = vi.fn().mockReturnValue(chainTarget);
    chainTarget.innerJoin = vi.fn().mockReturnValue(chainTarget);
    const mockFrom = vi.fn().mockReturnValue(chainTarget);
    const mockDatabase = {
      select: vi.fn().mockReturnValue({ from: mockFrom })
    };

    const { result, rerender } = renderHook(() => useContacts(), {
      wrapper: createWrapper({
        database: mockDatabase as never,
        activeOrganizationId: null
      })
    });

    await waitFor(() => {
      expect(result.current.contactsList).toEqual(
        createContactsQueryResult('contact-1', 'Alice')
      );
    });

    // Rerender with a different org - need a new wrapper
    const { result: result2 } = renderHook(() => useContacts(), {
      wrapper: createWrapper({
        database: mockDatabase as never,
        activeOrganizationId: 'org-1'
      })
    });

    await waitFor(() => {
      expect(result2.current.contactsList).toEqual(
        createContactsQueryResult('contact-2', 'Bob')
      );
    });

    expect(mockOrderBy).toHaveBeenCalledTimes(2);
  });
});
