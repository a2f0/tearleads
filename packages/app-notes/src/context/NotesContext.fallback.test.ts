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
  BackLink: () => null
};

const getDatabase = (): Database => {
  throw new Error('Not implemented in test');
};

const t = vi.fn((key: string) => key);

describe('NotesContext database state', () => {
  it('exposes provided database state through context', () => {
    const databaseState = {
      isUnlocked: true,
      isLoading: false,
      currentInstanceId: null
    };

    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(NotesProvider, {
        children,
        databaseState,
        getDatabase,
        ui: mockUi,
        t
      });

    const { result } = renderHook(() => useDatabaseState(), { wrapper });
    expect(result.current).toEqual(databaseState);
  });
});
