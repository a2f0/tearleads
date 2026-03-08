import { ThemeProvider } from '@tearleads/ui';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchWindowContent } from './SearchWindowContent';

const mockNavigate = vi.fn();
const mockOpenWindow = vi.fn();
const mockRequestWindowOpen = vi.fn();
const mockUseIsMobile = vi.fn();
const mockResolveFileOpenTarget = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate
  };
});

const mockSearch = vi.fn();
const mockUseSearch = vi.fn();
vi.mock('@/search', () => ({
  useSearch: (options: unknown) => mockUseSearch(options)
}));

const blankQueryResults = {
  hits: [
    {
      id: 'all-1',
      entityType: 'contact',
      document: { title: 'All Contacts' }
    }
  ],
  count: 1
};

vi.mock('@/contexts/WindowManagerContext', () => ({
  useWindowManagerActions: () => ({
    openWindow: mockOpenWindow,
    requestWindowOpen: mockRequestWindowOpen
  })
}));

vi.mock('@/db/hooks/useDatabaseContext', () => ({
  useDatabaseContext: () => ({ isUnlocked: true, isLoading: false })
}));

vi.mock('@/hooks/device', () => ({
  useIsMobile: () => mockUseIsMobile()
}));

vi.mock('@/lib/vfsOpen', () => ({
  resolveFileOpenTarget: (fileId: string) => mockResolveFileOpenTarget(fileId)
}));

function renderContent(viewMode?: 'list' | 'table') {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <SearchWindowContent {...(viewMode ? { viewMode } : {})} />
      </ThemeProvider>
    </MemoryRouter>
  );
}

async function searchFor(
  user: ReturnType<typeof userEvent.setup>,
  text: string
) {
  const input = screen.getByPlaceholderText('Search...');
  await user.type(input, text);
  await user.keyboard('{Enter}');
}

describe('SearchWindowContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseIsMobile.mockReturnValue(true);
    mockResolveFileOpenTarget.mockResolvedValue('document');
    mockSearch.mockImplementation(async (query: string) =>
      query === '' ? blankQueryResults : { hits: [], count: 0 }
    );
    mockUseSearch.mockImplementation(() => ({
      search: mockSearch,
      isInitialized: true,
      isIndexing: false,
      documentCount: 10
    }));
  });

  describe('rendering', () => {
    it('renders search input', () => {
      renderContent();
      expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument();
    });

    it('uses a shrinkable results scroll container to keep status bar visible', () => {
      renderContent();

      expect(
        document.querySelector('div.flex.h-full.min-h-0.flex-col')
      ).toBeInTheDocument();
      expect(
        document.querySelector('div.min-h-0.flex-1.overflow-auto')
      ).toBeInTheDocument();
    });

    it('renders filter tabs', () => {
      renderContent();
      expect(screen.getByText('All')).toBeInTheDocument();
      expect(screen.getByText('Apps')).toBeInTheDocument();
      expect(screen.getByText('Help Docs')).toBeInTheDocument();
      expect(screen.getByText('Contacts')).toBeInTheDocument();
      expect(screen.getByText('Notes')).toBeInTheDocument();
      expect(screen.getByText('Emails')).toBeInTheDocument();
      expect(screen.getByText('Files')).toBeInTheDocument();
      expect(screen.getByText('Playlists')).toBeInTheDocument();
      expect(screen.getByText('AI Chats')).toBeInTheDocument();
    });

    it('shows initial search prompt', async () => {
      renderContent();

      expect(screen.getByText('Start typing to search')).toBeInTheDocument();
      expect(screen.getByText('10 items indexed')).toBeInTheDocument();
      expect(screen.queryByText('All Contacts')).not.toBeInTheDocument();
      expect(mockSearch).not.toHaveBeenCalled();
    });

    it('shows prompt for listing all objects', () => {
      renderContent();

      expect(
        screen.getByText('Press Enter to list all objects')
      ).toBeInTheDocument();
    });

    it('renders table view when mode is table', async () => {
      const user = userEvent.setup();
      mockSearch.mockResolvedValue({
        hits: [
          {
            id: 'contact-1',
            entityType: 'contact',
            document: { title: 'John Doe', content: 'john@example.com' }
          }
        ],
        count: 1
      });
      renderContent('table');

      await searchFor(user, 'john');

      await waitFor(() => {
        expect(screen.getByRole('table')).toBeInTheDocument();
      });
      expect(screen.getByText('Title')).toBeInTheDocument();
      expect(screen.getByText('Type')).toBeInTheDocument();
      expect(screen.getByText('Preview')).toBeInTheDocument();
    });

    it('does not render preview text for app results in table view', async () => {
      const user = userEvent.setup();
      mockSearch.mockResolvedValue({
        hits: [
          {
            id: 'app:notes',
            entityType: 'app',
            document: {
              title: 'Notes',
              content: 'Should not be shown',
              metadata: 'Should not be shown either'
            }
          }
        ],
        count: 1
      });
      renderContent('table');

      await searchFor(user, 'notes');

      await waitFor(() => {
        expect(screen.getByText('1 result')).toBeInTheDocument();
      });

      const row = screen.getByRole('cell', { name: 'Notes' }).closest('tr');
      expect(row).toBeTruthy();
      if (!row) {
        throw new Error('App result row was not found');
      }

      const cells = within(row).getAllByRole('cell');
      expect(cells[2]?.textContent).toBe('');
    });

    it('does not render preview text for app results in list view', async () => {
      const user = userEvent.setup();
      mockSearch.mockResolvedValue({
        hits: [
          {
            id: 'app:notes',
            entityType: 'app',
            document: {
              title: 'Notes',
              content: 'Should not be shown',
              metadata: 'Should not be shown either'
            }
          }
        ],
        count: 1
      });
      renderContent('list');

      await searchFor(user, 'notes');

      await waitFor(() => {
        expect(screen.getByText('1 result')).toBeInTheDocument();
      });

      expect(screen.queryByText('Should not be shown')).not.toBeInTheDocument();
      expect(
        screen.queryByText('Should not be shown either')
      ).not.toBeInTheDocument();
    });

    it('refocuses search input when view mode changes', () => {
      const view = render(
        <MemoryRouter>
          <ThemeProvider>
            <SearchWindowContent viewMode="list" />
          </ThemeProvider>
        </MemoryRouter>
      );
      const input = screen.getByPlaceholderText('Search...');

      input.blur();
      expect(document.activeElement).not.toBe(input);

      view.rerender(
        <MemoryRouter>
          <ThemeProvider>
            <SearchWindowContent viewMode="table" />
          </ThemeProvider>
        </MemoryRouter>
      );

      expect(document.activeElement).toBe(input);
    });
  });
});
