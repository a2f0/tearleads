import type { Database } from '@tearleads/db/sqlite';
import i18next from 'i18next';
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import {
  ContactsProvider,
  type ContactsTranslationKey,
  type ContactsUIComponents,
  type DatabaseAdapter,
  type DatabaseState
} from '../context';

// Mock translation function that handles the keys used in tests
// (currently using i18next mock instead)

const createMockDatabaseState = (
  overrides?: Partial<DatabaseState>
): DatabaseState => ({
  isUnlocked: true,
  isLoading: false,
  currentInstanceId: 'test-instance',
  ...overrides
});

interface MockDb {
  select: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  orderBy: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
}

export const createMockDatabase = (): MockDb => {
  const chainable = {
    from: vi.fn(() => chainable),
    innerJoin: vi.fn(() => chainable),
    where: vi.fn(() => chainable),
    groupBy: vi.fn(() => Promise.resolve([])),
    orderBy: vi.fn(() => Promise.resolve([]))
  };
  const mockDb: MockDb = {
    select: vi.fn(() => chainable),
    from: vi.fn(() => chainable),
    where: vi.fn(() => chainable),
    orderBy: vi.fn().mockResolvedValue([]),
    insert: vi.fn(() => ({
      values: vi.fn().mockResolvedValue(undefined)
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn().mockResolvedValue(undefined)
      }))
    })),
    delete: vi.fn(() => ({
      where: vi.fn().mockResolvedValue(undefined)
    }))
  };
  return mockDb;
};

const createMockDatabaseAdapter = (): DatabaseAdapter => ({
  beginTransaction: vi.fn().mockResolvedValue(undefined),
  commitTransaction: vi.fn().mockResolvedValue(undefined),
  rollbackTransaction: vi.fn().mockResolvedValue(undefined)
});

const mockUIComponents: ContactsUIComponents = {
  Button: ({ children, onClick, disabled, ...props }) => (
    <button type="button" onClick={onClick} disabled={disabled} {...props}>
      {children}
    </button>
  ),
  Input: ({ value, onChange, inputRef, ...props }) => (
    <input ref={inputRef} value={value} onChange={onChange} {...props} />
  ),
  ContextMenu: ({ children }) => (
    <div data-testid="context-menu">{children}</div>
  ),
  ContextMenuItem: ({ children, onClick }) => (
    <button type="button" onClick={onClick} data-testid="context-menu-item">
      {children}
    </button>
  ),
  ListRow: ({ children, onContextMenu }) => (
    // biome-ignore lint/a11y/noStaticElementInteractions: test mock
    <div onContextMenu={onContextMenu} data-testid="list-row">
      {children}
    </div>
  ),
  RefreshButton: ({ onClick, loading }) => (
    <button
      type="button"
      onClick={onClick}
      data-testid="refresh-button"
      data-loading={loading}
    >
      Refresh
    </button>
  ),
  VirtualListStatus: ({ loadedCount, itemLabel }) => (
    <div data-testid="virtual-list-status">
      {loadedCount} {itemLabel}s
    </div>
  ),
  InlineUnlock: ({ description }) => (
    <div data-testid="inline-unlock">Unlock to access {description}</div>
  ),
  DropdownMenu: ({ trigger, children }) => (
    <div data-testid={`dropdown-${trigger}`}>
      <button type="button" data-testid={`trigger-${trigger}`}>
        {trigger}
      </button>
      <div data-testid={`menu-${trigger}`}>{children}</div>
    </div>
  ),
  DropdownMenuItem: ({ children, onClick, checked, disabled }) => (
    <button
      type="button"
      onClick={onClick}
      data-checked={checked}
      disabled={disabled}
      data-testid={`menuitem-${children}`}
    >
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr data-testid="separator" />,
  WindowOptionsMenuItem: () => <div data-testid="window-options" />,
  AboutMenuItem: () => <div data-testid="about-menu-item" />,
  BackLink: ({ defaultLabel }) => (
    <a href="/" data-testid="back-link">
      {defaultLabel}
    </a>
  ),
  Dropzone: ({ onFilesSelected, disabled }) => (
    <button
      type="button"
      data-testid="dropzone"
      disabled={disabled}
      onClick={() =>
        onFilesSelected([new File(['test'], 'test.csv', { type: 'text/csv' })])
      }
    >
      Drop files here
    </button>
  )
};

export interface TestContactsProviderProps {
  children: ReactNode;
  databaseState?: Partial<DatabaseState>;
  database?: MockDb;
  databaseAdapter?: DatabaseAdapter;
  ui?: ContactsUIComponents;
  t?: (key: ContactsTranslationKey) => string;
  navigate?: (to: string) => void;
  navigateWithFrom?: (to: string) => void;
  saveFile?: (
    content: string,
    filename: string,
    mimeType: string
  ) => Promise<void>;
  registerInVfs?: (
    contactId: string,
    createdAt: Date
  ) => Promise<{ success: boolean; error?: string }>;
  formatDate?: (date: Date) => string;
  openEmailComposer?: (recipients: string[]) => boolean;
}

export function TestContactsProvider({
  children,
  databaseState,
  database,
  databaseAdapter,
  ui = mockUIComponents,
  t = (key) => i18next.t(key, { ns: ['contacts', 'contextMenu', 'common'] }),
  navigate = vi.fn(),
  navigateWithFrom = vi.fn(),
  saveFile = vi.fn().mockResolvedValue(undefined),
  registerInVfs = vi.fn().mockResolvedValue({ success: true }),
  formatDate = (date) => date.toLocaleDateString(),
  openEmailComposer
}: TestContactsProviderProps) {
  const db = database ?? createMockDatabase();
  const adapter = databaseAdapter ?? createMockDatabaseAdapter();

  return (
    <ContactsProvider
      databaseState={createMockDatabaseState(databaseState)}
      getDatabase={() => db as unknown as Database}
      getDatabaseAdapter={() => adapter}
      saveFile={saveFile}
      registerInVfs={registerInVfs}
      ui={ui}
      t={t}
      tooltipZIndex={10000}
      navigate={navigate}
      navigateWithFrom={navigateWithFrom}
      formatDate={formatDate}
      {...(openEmailComposer && { openEmailComposer })}
    >
      {children}
    </ContactsProvider>
  );
}

export function createWrapper(
  options: Omit<TestContactsProviderProps, 'children'> = {}
) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <TestContactsProvider {...options}>{children}</TestContactsProvider>;
  };
}
