import type { Database } from '@rapid/db/sqlite';
import { renderHook } from '@testing-library/react';
import { type ReactNode, useMemo } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  ContactsProvider,
  type ContactsUIComponents,
  useContactsContext
} from './ContactsContext';

const mockUi: ContactsUIComponents = {
  Button: () => null,
  Input: () => null,
  ContextMenu: () => null,
  ContextMenuItem: () => null,
  ListRow: () => null,
  RefreshButton: () => null,
  VirtualListStatus: () => null,
  InlineUnlock: () => null,
  DropdownMenu: () => null,
  DropdownMenuItem: () => null,
  DropdownMenuSeparator: () => null,
  WindowOptionsMenuItem: () => null,
  AboutMenuItem: () => null,
  BackLink: () => null,
  Dropzone: () => null
};

const getDatabase = (): Database => {
  throw new Error('Not implemented in test');
};

const getDatabaseAdapter = () => ({
  beginTransaction: vi.fn(async () => {}),
  commitTransaction: vi.fn(async () => {}),
  rollbackTransaction: vi.fn(async () => {})
});

const saveFile = vi.fn(async () => {});
const registerInVfs = vi.fn(async () => ({ success: true }));
const t = vi.fn((key: 'getInfo' | 'edit' | 'delete' | 'exportVCard') => key);
const navigate = vi.fn();
const navigateWithFrom = vi.fn();
const formatDate = vi.fn((date: Date) => date.toISOString());

interface WrapperProps {
  children: ReactNode;
  isUnlocked: boolean;
}

function Wrapper({ children, isUnlocked }: WrapperProps) {
  const databaseState = useMemo(
    () => ({
      isUnlocked,
      isLoading: false,
      currentInstanceId: 'test-instance'
    }),
    [isUnlocked]
  );

  return (
    <ContactsProvider
      databaseState={databaseState}
      getDatabase={getDatabase}
      getDatabaseAdapter={getDatabaseAdapter}
      saveFile={saveFile}
      registerInVfs={registerInVfs}
      ui={mockUi}
      t={t}
      navigate={navigate}
      navigateWithFrom={navigateWithFrom}
      formatDate={formatDate}
    >
      {children}
    </ContactsProvider>
  );
}

describe('ContactsProvider', () => {
  it('preserves context reference when inputs are unchanged', () => {
    const isUnlocked = true;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Wrapper isUnlocked={isUnlocked}>{children}</Wrapper>
    );

    const { result, rerender } = renderHook(() => useContactsContext(), {
      wrapper
    });

    const initialContext = result.current;
    rerender();

    expect(result.current).toBe(initialContext);
  });

  it('updates context when database state changes', () => {
    let isUnlocked = false;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Wrapper isUnlocked={isUnlocked}>{children}</Wrapper>
    );

    const { result, rerender } = renderHook(() => useContactsContext(), {
      wrapper
    });

    expect(result.current.databaseState.isUnlocked).toBe(false);

    isUnlocked = true;
    rerender();

    expect(result.current.databaseState.isUnlocked).toBe(true);
  });
});
