import type { Database } from '@tearleads/db/sqlite';
import { renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  ContactsProvider,
  type ContactsUIComponents,
  useDatabaseState
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
const t = vi.fn((key: string) => key);
const navigate = vi.fn();
const navigateWithFrom = vi.fn();
const formatDate = vi.fn((date: Date) => date.toISOString());

describe('ContactsContext fallback database state', () => {
  it('uses fallback database state when provider omits databaseState', () => {
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(ContactsProvider, {
        children,
        getDatabase,
        getDatabaseAdapter,
        saveFile,
        registerInVfs,
        ui: mockUi,
        t,
        navigate,
        navigateWithFrom,
        formatDate
      });

    const { result } = renderHook(() => useDatabaseState(), { wrapper });
    expect(result.current).toEqual({
      isUnlocked: true,
      isLoading: false,
      currentInstanceId: null
    });
  });
});
