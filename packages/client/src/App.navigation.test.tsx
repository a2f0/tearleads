import { ThemeProvider } from '@rapid/ui';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { Contacts } from './pages/Contacts';
import { Debug } from './pages/Debug';
import { Files } from './pages/Files';
import { Settings } from './pages/Settings';
import { Sqlite } from './pages/Sqlite';
import { Tables } from './pages/Tables';

// Mock database context
vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => ({
    isUnlocked: true,
    isLoading: false
  }),
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
  getDatabase: () => dbMock
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
    <MemoryRouter initialEntries={[initialPath]}>
      <ThemeProvider>
        <Routes>
          <Route path="/" element={<App />}>
            <Route index element={<Files />} />
            <Route path="contacts" element={<Contacts />} />
            <Route path="sqlite" element={<Sqlite />} />
            <Route path="debug" element={<Debug />} />
            <Route path="settings" element={<Settings />} />
            <Route path="tables" element={<Tables />} />
          </Route>
        </Routes>
      </ThemeProvider>
    </MemoryRouter>
  );
}

describe('App Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOrderBy.mockResolvedValue([]);
  });

  describe('navigation', () => {
    it('renders home page (Files) by default', async () => {
      renderAppWithRoutes('/');

      await waitFor(() => {
        expect(screen.getByText('Tearleads')).toBeInTheDocument();
      });

      // Files page should be rendered - check for heading
      expect(
        screen.getByRole('heading', { name: 'Files' })
      ).toBeInTheDocument();
    });

    it('navigates to Contacts page when clicking sidebar link', async () => {
      const user = userEvent.setup();
      renderAppWithRoutes('/');

      await waitFor(() => {
        expect(screen.getByText('Tearleads')).toBeInTheDocument();
      });

      // Click Contacts in sidebar
      const contactsLinks = screen.getAllByText('Contacts');
      await user.click(contactsLinks[0] as HTMLElement);

      await waitFor(() => {
        expect(
          screen.getByPlaceholderText('Search contacts...')
        ).toBeInTheDocument();
      });
    });

    it('navigates to SQLite page when clicking header link', async () => {
      const user = userEvent.setup();
      renderAppWithRoutes('/');

      await waitFor(() => {
        expect(screen.getByText('Tearleads')).toBeInTheDocument();
      });

      // Click SQLite in header
      const sqliteLink = screen.getByTestId('sqlite-link');
      await user.click(sqliteLink);

      await waitFor(() => {
        expect(screen.getByTestId('database-test')).toBeInTheDocument();
      });
    });

    it('navigates to Debug page and displays debug info', async () => {
      const user = userEvent.setup();
      renderAppWithRoutes('/');

      await waitFor(() => {
        expect(screen.getByText('Tearleads')).toBeInTheDocument();
      });

      // Click Debug in header
      const debugLink = screen.getByTestId('debug-link');
      await user.click(debugLink);

      await waitFor(() => {
        expect(screen.getByText('Environment Info')).toBeInTheDocument();
        expect(screen.getByText('Device Info')).toBeInTheDocument();
      });
    });

    it('navigates to Settings page', async () => {
      const user = userEvent.setup();
      renderAppWithRoutes('/');

      await waitFor(() => {
        expect(screen.getByText('Tearleads')).toBeInTheDocument();
      });

      // Click Settings in header
      const settingsLink = screen.getByTestId('settings-link');
      await user.click(settingsLink);

      await waitFor(() => {
        expect(screen.getByText('Dark Mode')).toBeInTheDocument();
      });
    });

    it('navigates to Tables page', async () => {
      const user = userEvent.setup();
      renderAppWithRoutes('/');

      await waitFor(() => {
        expect(screen.getByText('Tearleads')).toBeInTheDocument();
      });

      // Click Tables in header
      const tablesLink = screen.getByTestId('tables-link');
      await user.click(tablesLink);

      await waitFor(() => {
        expect(
          screen.getByRole('heading', { name: 'Tables' })
        ).toBeInTheDocument();
      });
    });
  });

  describe('deep linking', () => {
    it('renders Contacts page when navigating directly to /contacts', async () => {
      renderAppWithRoutes('/contacts');

      await waitFor(() => {
        expect(screen.getByText('Tearleads')).toBeInTheDocument();
        expect(
          screen.getByPlaceholderText('Search contacts...')
        ).toBeInTheDocument();
      });
    });

    it('renders SQLite page when navigating directly to /sqlite', async () => {
      renderAppWithRoutes('/sqlite');

      await waitFor(() => {
        expect(screen.getByText('Tearleads')).toBeInTheDocument();
        expect(screen.getByTestId('database-test')).toBeInTheDocument();
      });
    });

    it('renders Debug page when navigating directly to /debug', async () => {
      renderAppWithRoutes('/debug');

      await waitFor(() => {
        expect(screen.getByText('Tearleads')).toBeInTheDocument();
        expect(screen.getByText('Environment Info')).toBeInTheDocument();
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

      // Navigate to different page
      const debugLink = screen.getByTestId('debug-link');
      await user.click(debugLink);

      // App shell should still be present
      await waitFor(() => {
        expect(screen.getByTestId('app-container')).toBeInTheDocument();
        expect(screen.getByRole('navigation')).toBeInTheDocument();
        expect(screen.getByText('Tearleads')).toBeInTheDocument();
        expect(screen.getByText('Environment Info')).toBeInTheDocument();
      });
    });

    it('home link navigates back to Files', async () => {
      const user = userEvent.setup();
      renderAppWithRoutes('/debug');

      await waitFor(() => {
        expect(screen.getByText('Environment Info')).toBeInTheDocument();
      });

      // Click home link (Tearleads logo/title)
      const homeLink = screen.getByRole('link', { name: /Tearleads/i });
      await user.click(homeLink);

      await waitFor(() => {
        // Should be back at Files page
        expect(screen.queryByText('Environment Info')).not.toBeInTheDocument();
      });
    });
  });
});
