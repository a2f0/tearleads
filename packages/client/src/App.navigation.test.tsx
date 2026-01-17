import { ThemeProvider } from '@rapid/ui';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { WindowManagerProvider } from './contexts/WindowManagerContext';
import { Contacts } from './pages/contacts';
import { Debug } from './pages/debug';
import { Files } from './pages/Files';
import { Home } from './pages/Home';
import { Settings } from './pages/Settings';
import { Sqlite } from './pages/Sqlite';
import { Tables } from './pages/Tables';

const mockExecute = vi.fn().mockResolvedValue({ rows: [] });

// Mock database context - shared mock factory
const createDatabaseContextMock = () => ({
  isUnlocked: true,
  isLoading: false,
  currentInstanceId: 'test-instance',
  currentInstanceName: 'Instance 1',
  instances: [
    {
      id: 'test-instance',
      name: 'Instance 1',
      createdAt: Date.now(),
      lastAccessedAt: Date.now()
    }
  ],
  createInstance: vi.fn(async () => 'new-instance'),
  switchInstance: vi.fn(async () => true),
  deleteInstance: vi.fn(async () => {}),
  refreshInstances: vi.fn(async () => {})
});

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => createDatabaseContextMock(),
  DatabaseProvider: ({ children }: { children: React.ReactNode }) => children
}));

// Also mock the direct import path used by AccountSwitcher
vi.mock('@/db/hooks/useDatabase', () => ({
  useDatabaseContext: () => createDatabaseContextMock(),
  DatabaseProvider: ({ children }: { children: React.ReactNode }) => children
}));

// Mock getDatabase
const mockOrderBy = vi.fn();
const dbMock = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  leftJoin: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: mockOrderBy
};

vi.mock('@/db', () => ({
  getDatabase: () => dbMock,
  getDatabaseAdapter: () => ({
    execute: mockExecute
  })
}));

// Mock SettingsProvider for TooltipsToggle and DesktopBackground
vi.mock('@/db/SettingsProvider', () => ({
  useSettings: () => ({
    getSetting: vi.fn((key: string) => {
      const settings: Partial<Record<string, string>> = {
        desktopPattern: 'solid'
      };
      return settings[key] ?? 'enabled';
    }),
    setSetting: vi.fn()
  })
}));

// Mock API
vi.mock('@/lib/api', () => ({
  api: {
    health: { get: vi.fn() },
    ping: { get: vi.fn() }
  },
  API_BASE_URL: 'http://localhost:3000'
}));

// Mock components that are complex/have side effects
vi.mock('@/components/sqlite/DatabaseTest', () => ({
  DatabaseTest: () => <div data-testid="database-test">DatabaseTest Mock</div>
}));

vi.mock('@/components/sqlite/TableSizes', () => ({
  TableSizes: () => <div data-testid="table-sizes">TableSizes Mock</div>
}));

vi.mock('@/hooks/useContactsImport', () => ({
  useContactsImport: () => ({
    parseFile: vi.fn(),
    importContacts: vi.fn(),
    importing: false,
    progress: 0
  })
}));

// Mock storage adapter
vi.mock('@/storage', () => ({
  getStorageAdapter: vi.fn().mockResolvedValue({
    listFiles: vi.fn().mockResolvedValue([])
  })
}));

function renderAppWithRoutes(initialPath = '/') {
  return render(
    <ThemeProvider>
      <WindowManagerProvider>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route path="/" element={<App />}>
              <Route index element={<Home />} />
              <Route path="files" element={<Files />} />
              <Route path="contacts" element={<Contacts />} />
              <Route path="sqlite" element={<Sqlite />} />
              <Route path="debug" element={<Debug />} />
              <Route path="settings" element={<Settings />} />
              <Route path="tables" element={<Tables />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </WindowManagerProvider>
    </ThemeProvider>
  );
}

describe('App Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOrderBy.mockResolvedValue([]);
  });

  describe('navigation', () => {
    let user: UserEvent;

    beforeEach(async () => {
      user = userEvent.setup();
      renderAppWithRoutes('/');
      await waitFor(() => {
        expect(screen.getByTestId('start-button')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('start-button'));
    });

    it('renders home page with app icons by default', () => {
      // Sidebar has links, home page has draggable buttons (double-click to open)
      const filesLink = screen.getByRole('link', { name: 'Files' });
      const filesButton = screen.getByRole('button', { name: 'Files' });
      const contactsLink = screen.getByRole('link', { name: 'Contacts' });
      const contactsButton = screen.getByRole('button', { name: 'Contacts' });
      expect(filesLink).toBeInTheDocument();
      expect(filesButton).toBeInTheDocument();
      expect(contactsLink).toBeInTheDocument();
      expect(contactsButton).toBeInTheDocument();
    });

    it('navigates to Contacts page when clicking sidebar link', async () => {
      const contactsLinks = screen.getAllByText('Contacts');
      await user.click(contactsLinks[0] as HTMLElement);

      // When no contacts exist, the add contact card is shown instead of search
      await waitFor(() => {
        expect(screen.getByTestId('add-contact-card')).toBeInTheDocument();
      });
    });

    describe('mobile menu navigation', () => {
      beforeEach(async () => {
        // Open mobile menu for all tests in this block
        await user.click(screen.getByTestId('mobile-menu-button'));
      });

      it('navigates to SQLite page', async () => {
        const dropdown = screen.getByTestId('mobile-menu-dropdown');
        const sqliteLink = within(dropdown).getByTestId('sqlite-link');
        await user.click(sqliteLink);

        await waitFor(() => {
          expect(screen.getByTestId('database-test')).toBeInTheDocument();
        });
      });

      it('navigates to Debug page and displays debug info', async () => {
        const dropdown = screen.getByTestId('mobile-menu-dropdown');
        const debugLink = within(dropdown).getByTestId('debug-link');
        await user.click(debugLink);

        await waitFor(() => {
          expect(screen.getByText('System Info')).toBeInTheDocument();
        });
      });

      it('navigates to Settings page', async () => {
        const dropdown = screen.getByTestId('mobile-menu-dropdown');
        const settingsLink = within(dropdown).getByTestId('settings-link');
        await user.click(settingsLink);

        await waitFor(() => {
          expect(screen.getByText('Theme')).toBeInTheDocument();
        });
      });

      it('navigates to Tables page', async () => {
        const dropdown = screen.getByTestId('mobile-menu-dropdown');
        const tablesLink = within(dropdown).getByTestId('tables-link');
        await user.click(tablesLink);

        await waitFor(() => {
          expect(
            screen.getByRole('heading', { name: 'Tables' })
          ).toBeInTheDocument();
        });
      });
    });
  });

  describe('deep linking', () => {
    it('renders Contacts page when navigating directly to /contacts', async () => {
      renderAppWithRoutes('/contacts');

      await waitFor(() => {
        expect(screen.getByTestId('start-button')).toBeInTheDocument();
        expect(
          screen.getByPlaceholderText('Search contacts...')
        ).toBeInTheDocument();
      });
    });

    it('renders SQLite page when navigating directly to /sqlite', async () => {
      renderAppWithRoutes('/sqlite');

      await waitFor(() => {
        expect(screen.getByTestId('start-button')).toBeInTheDocument();
        expect(screen.getByTestId('database-test')).toBeInTheDocument();
      });
    });

    it('renders Debug page when navigating directly to /debug', async () => {
      renderAppWithRoutes('/debug');

      await waitFor(() => {
        expect(screen.getByTestId('start-button')).toBeInTheDocument();
        expect(screen.getByText('System Info')).toBeInTheDocument();
      });
    });
  });

  describe('layout', () => {
    it('maintains app shell across navigation', async () => {
      const user = userEvent.setup();
      renderAppWithRoutes('/');

      // App shell should be present
      await waitFor(() => {
        expect(screen.getByTestId('app-container')).toBeInTheDocument();
        expect(screen.getByRole('navigation')).toBeInTheDocument();
      });

      // Open mobile menu and navigate to different page
      await user.click(screen.getByTestId('mobile-menu-button'));
      const dropdown = screen.getByTestId('mobile-menu-dropdown');
      const debugLink = within(dropdown).getByTestId('debug-link');
      await user.click(debugLink);

      // App shell should still be present
      await waitFor(() => {
        expect(screen.getByTestId('app-container')).toBeInTheDocument();
        expect(screen.getByRole('navigation')).toBeInTheDocument();
        expect(screen.getByTestId('start-button')).toBeInTheDocument();
        expect(screen.getByText('System Info')).toBeInTheDocument();
      });
    });

    it('home link navigates back to Home', async () => {
      const user = userEvent.setup();
      renderAppWithRoutes('/debug');

      await waitFor(() => {
        expect(screen.getByText('System Info')).toBeInTheDocument();
      });

      // Click home link in sidebar
      const homeLink = screen.getByRole('link', { name: 'Home' });
      await user.click(homeLink);

      await waitFor(() => {
        // Should be back at Home page with app icons
        expect(screen.queryByText('System Info')).not.toBeInTheDocument();
      });
    });
  });
});
