import type { Database } from '@tearleads/db/sqlite';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NotesProvider, useNotesContext } from '../../context/NotesContext';
import {
  createMockAuth,
  createMockDatabase,
  createMockDatabaseState,
  createMockFeatureFlags,
  createMockVfsApi,
  createMockVfsKeys
} from '../../test/testUtils';
import { useCreateNote } from './useCreateNote';

function Harness({
  onSelectNote,
  onError
}: {
  onSelectNote: (id: string) => void;
  onError: (message: string) => void;
}) {
  const { getDatabase, vfsKeys, auth, featureFlags, vfsApi } =
    useNotesContext();

  const createNote = useCreateNote({
    getDatabase,
    onSelectNote,
    onError,
    vfsKeys,
    auth,
    featureFlags,
    vfsApi
  });

  return (
    <button type="button" onClick={() => void createNote()}>
      Create Note
    </button>
  );
}

describe('useCreateNote', () => {
  it('creates a note and selects it', async () => {
    const user = userEvent.setup();
    const onSelectNote = vi.fn();
    const onError = vi.fn();
    const mockDb = createMockDatabase();

    render(
      <NotesProvider
        databaseState={{ ...createMockDatabaseState(), isUnlocked: true }}
        getDatabase={() => mockDb as unknown as Database}
        ui={{
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
        }}
        t={(key) => key}
        tooltipZIndex={10000}
        vfsKeys={createMockVfsKeys()}
        auth={createMockAuth()}
        featureFlags={createMockFeatureFlags()}
        vfsApi={createMockVfsApi()}
      >
        <Harness onSelectNote={onSelectNote} onError={onError} />
      </NotesProvider>
    );

    await user.click(screen.getByRole('button', { name: 'Create Note' }));

    expect(mockDb.insert).toHaveBeenCalled();
    expect(onSelectNote).toHaveBeenCalledTimes(1);
    expect(onSelectNote).toHaveBeenCalledWith(expect.any(String));
    expect(onError).not.toHaveBeenCalled();
  });
});
