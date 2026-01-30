import type { ReactNode } from 'react';
import { vi } from 'vitest';
import {
  type DatabaseState,
  NotesProvider,
  type NotesProviderProps
} from '../context/NotesContext';

export const createMockDatabaseState = (): DatabaseState => ({
  isUnlocked: true,
  isLoading: false,
  currentInstanceId: 'test-instance'
});

interface MockDb {
  select: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
}

export const createMockDatabase = (): MockDb => {
  const mockDb: MockDb = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    insert: vi.fn(() => ({
      values: vi.fn().mockResolvedValue(undefined)
    }))
  };
  return mockDb;
};

export const createMockVfsKeys = () => ({
  generateSessionKey: vi.fn(() => new Uint8Array(32)),
  wrapSessionKey: vi.fn(async () => 'wrapped-session-key')
});

export const createMockAuth = () => ({
  isLoggedIn: vi.fn(() => false),
  readStoredAuth: vi.fn((): { user: { id: string } | null } => ({
    user: { id: 'test-user-id' }
  }))
});

export const createMockFeatureFlags = () => ({
  getFeatureFlagValue: vi.fn(() => false)
});

export const createMockVfsApi = () => ({
  register: vi.fn(async () => {})
});

export const createMockUI = () => ({
  Button: ({
    children,
    ...props
  }: { children: ReactNode } & Record<string, unknown>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Input: (props: Record<string, unknown>) => <input {...props} />,
  ContextMenu: ({ children }: { children: ReactNode }) => (
    <div data-testid="context-menu">{children}</div>
  ),
  ContextMenuItem: ({ children }: { children: ReactNode }) => (
    <div data-testid="context-menu-item">{children}</div>
  ),
  ListRow: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  RefreshButton: () => <button type="button">Refresh</button>,
  VirtualListStatus: () => <div>Status</div>,
  InlineUnlock: () => <div>Unlock</div>,
  EditableTitle: () => <div>Title</div>,
  DropdownMenu: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuSeparator: () => <hr />,
  WindowOptionsMenuItem: () => <div>Options</div>,
  AboutMenuItem: () => <div>About</div>
});

export interface MockContextOptions {
  databaseState?: Partial<DatabaseState>;
  database?: ReturnType<typeof createMockDatabase>;
  vfsKeys?: Partial<ReturnType<typeof createMockVfsKeys>>;
  auth?: Partial<ReturnType<typeof createMockAuth>>;
  featureFlags?: Partial<ReturnType<typeof createMockFeatureFlags>>;
  vfsApi?: Partial<ReturnType<typeof createMockVfsApi>>;
}

export function createMockContextValue(options: MockContextOptions = {}) {
  const database = options.database ?? createMockDatabase();

  return {
    databaseState: {
      ...createMockDatabaseState(),
      ...options.databaseState
    },
    getDatabase: () =>
      database as unknown as ReturnType<NotesProviderProps['getDatabase']>,
    ui: createMockUI() as unknown as NotesProviderProps['ui'],
    vfsKeys: {
      ...createMockVfsKeys(),
      ...options.vfsKeys
    },
    auth: {
      ...createMockAuth(),
      ...options.auth
    },
    featureFlags: {
      ...createMockFeatureFlags(),
      ...options.featureFlags
    },
    vfsApi: {
      ...createMockVfsApi(),
      ...options.vfsApi
    }
  };
}

export function createWrapper(options: MockContextOptions = {}) {
  const contextValue = createMockContextValue(options);

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <NotesProvider
        databaseState={contextValue.databaseState}
        getDatabase={contextValue.getDatabase}
        ui={contextValue.ui}
        t={(key) => key}
        tooltipZIndex={10000}
        vfsKeys={contextValue.vfsKeys}
        auth={contextValue.auth}
        featureFlags={contextValue.featureFlags}
        vfsApi={contextValue.vfsApi}
      >
        {children}
      </NotesProvider>
    );
  };
}
