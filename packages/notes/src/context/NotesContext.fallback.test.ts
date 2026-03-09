import type { Database } from '@tearleads/db/sqlite';
import { renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  NotesProvider,
  type NotesUIComponents,
  useDatabaseState
} from './NotesContext';

const mockUi: NotesUIComponents = {
  Button: () => null,
  Input: () => null,
  ContextMenu: () => null,
  ContextMenuItem: () => null,
  ListRow: () => null,
  RefreshButton: () => null,
  VirtualListStatus: () => null,
  InlineUnlock: () => null,
  EditableTitle: () => null,
  DropdownMenu: () => null,
  DropdownMenuItem: () => null,
  DropdownMenuSeparator: () => null,
  WindowOptionsMenuItem: () => null,
  AboutMenuItem: () => null,
  BackLink: () => null
};

const getDatabase = (): Database => {
  throw new Error('Not implemented in test');
};

const t = vi.fn((key: string) => key);

describe('NotesContext fallback database state', () => {
  it('uses fallback database state when provider omits databaseState', () => {
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(NotesProvider, {
        children,
        getDatabase,
        ui: mockUi,
        t
      });

    const { result } = renderHook(() => useDatabaseState(), { wrapper });
    expect(result.current).toEqual({
      isUnlocked: true,
      isLoading: false,
      currentInstanceId: null
    });
  });
});
