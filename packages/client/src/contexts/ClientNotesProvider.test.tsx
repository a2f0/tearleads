import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { ClientNotesProvider } from './ClientNotesProvider';

let capturedNotesProviderProps: Record<string, unknown> | null = null;

beforeEach(() => {
  capturedNotesProviderProps = null;
});

vi.mock('@tearleads/app-notes', () => ({
  NotesAboutMenuItem: () => <div>NotesAboutMenuItem</div>,
  NotesProvider: ({
    children,
    ...props
  }: {
    children: React.ReactNode;
  } & Record<string, unknown>) => {
    capturedNotesProviderProps = props;
    return <div data-testid="notes-provider">{children}</div>;
  }
}));

vi.mock('@/components/sqlite/InlineUnlock', () => ({
  InlineUnlock: () => <div>InlineUnlock</div>
}));

vi.mock('@/components/ui/button', () => ({
  Button: () => <button type="button">Button</button>
}));

vi.mock('@tearleads/window-manager', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@tearleads/window-manager')>();

  return {
    ...actual,
    DesktopContextMenu: () => <div>ContextMenu</div>,
    DesktopContextMenuItem: () => <div>ContextMenuItem</div>
  };
});

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: () => <div>DropdownMenu</div>,
  DropdownMenuItem: () => <div>DropdownMenuItem</div>,
  DropdownMenuSeparator: () => <div>DropdownMenuSeparator</div>
}));

vi.mock('@/components/ui/editable-title', () => ({
  EditableTitle: () => <div>EditableTitle</div>
}));

vi.mock('@/components/ui/input', () => ({
  Input: () => <input />
}));

vi.mock('@/components/ui/ListRow', () => ({
  ListRow: () => <div>ListRow</div>
}));

vi.mock('@/components/ui/RefreshButton', () => ({
  RefreshButton: () => <button type="button">Refresh</button>
}));

vi.mock('@/components/ui/VirtualListStatus', () => ({
  VirtualListStatus: () => <div>VirtualListStatus</div>
}));

vi.mock('@/components/window-menu/WindowOptionsMenuItem', () => ({
  WindowOptionsMenuItem: () => <div>WindowOptionsMenuItem</div>
}));

vi.mock('@/db', () => ({
  getDatabase: vi.fn()
}));

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => ({
    isUnlocked: true,
    isLoading: false,
    currentInstanceId: 'test-instance'
  })
}));

vi.mock('@/db/hooks/useHostRuntimeDatabaseState', () => ({
  useHostRuntimeDatabaseState: () => ({
    isUnlocked: true,
    isLoading: false,
    currentInstanceId: 'test-instance'
  })
}));

vi.mock('@/hooks/vfs/useVfsKeys', () => ({
  generateSessionKey: vi.fn(),
  wrapSessionKey: vi.fn()
}));

vi.mock('@/i18n', () => ({
  useTypedTranslation: () => ({ t: (key: string) => key })
}));

vi.mock('@/lib/api', () => ({
  api: {
    vfs: {
      register: vi.fn()
    }
  }
}));

vi.mock('@/lib/authStorage', () => ({
  isLoggedIn: () => true,
  readStoredAuth: () => ({ user: { id: 'test-user' } })
}));

vi.mock('@/lib/featureFlags', () => ({
  getFeatureFlagValue: vi.fn().mockReturnValue(false)
}));

describe('ClientNotesProvider', () => {
  it('renders children within NotesProvider', () => {
    render(
      <MemoryRouter>
        <ClientNotesProvider>
          <div data-testid="child">Child content</div>
        </ClientNotesProvider>
      </MemoryRouter>
    );

    expect(screen.getByTestId('notes-provider')).toBeInTheDocument();
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('passes host runtime database state to NotesProvider', () => {
    render(
      <MemoryRouter>
        <ClientNotesProvider>
          <div>Child</div>
        </ClientNotesProvider>
      </MemoryRouter>
    );

    expect(capturedNotesProviderProps).not.toBeNull();
    expect(capturedNotesProviderProps?.databaseState).toEqual({
      isUnlocked: true,
      isLoading: false,
      currentInstanceId: 'test-instance'
    });
  });

  it('ignores already-registered conflicts for vfsApi.register', async () => {
    const conflictError = new Error('Conflict');
    Reflect.set(conflictError, 'status', 409);
    vi.mocked(api.vfs.register).mockRejectedValueOnce(conflictError);

    render(
      <MemoryRouter>
        <ClientNotesProvider>
          <div>Child</div>
        </ClientNotesProvider>
      </MemoryRouter>
    );

    const vfsApi = capturedNotesProviderProps?.vfsApi as {
      register: (input: {
        id: string;
        objectType: 'note' | 'file' | 'folder' | 'contact' | 'photo';
        encryptedSessionKey: string;
      }) => Promise<void>;
    };

    await expect(
      vfsApi.register({
        id: 'note-1',
        objectType: 'note',
        encryptedSessionKey: 'wrapped'
      })
    ).resolves.toBeUndefined();
  });
});
