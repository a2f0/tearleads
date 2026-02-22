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

  describe('searching', () => {
    it('keeps search input focused when clicking a filter pill', async () => {
      const user = userEvent.setup();
      renderContent();

      const input = screen.getByPlaceholderText('Search...');
      const appsFilter = screen.getByRole('button', { name: 'Apps' });

      expect(document.activeElement).toBe(input);

      await user.click(appsFilter);

      expect(document.activeElement).toBe(input);
      expect(appsFilter).toHaveAttribute('data-selected', 'true');
    });

    it('performs typeahead search as user types', async () => {
      const user = userEvent.setup();
      renderContent();

      const input = screen.getByPlaceholderText('Search...');
      await user.type(input, 'test');

      await waitFor(
        () => {
          expect(mockSearch).toHaveBeenCalledWith('test');
        },
        { timeout: 500 }
      );
    });

    it('requires enter for empty search', async () => {
      const user = userEvent.setup();
      renderContent();

      const input = screen.getByPlaceholderText('Search...');
      await user.click(input);
      expect(mockSearch).not.toHaveBeenCalled();

      await user.keyboard('{Enter}');

      await waitFor(() => {
        expect(mockSearch).toHaveBeenCalledWith('');
      });
    });

    it('shows all items when submitting an empty query', async () => {
      const user = userEvent.setup();
      mockSearch.mockImplementation(async (query: string) => {
        if (query === '') return blankQueryResults;
        if (query === 'john') {
          return {
            hits: [
              {
                id: 'contact-1',
                entityType: 'contact',
                document: { title: 'John' }
              }
            ],
            count: 1
          };
        }
        return { hits: [], count: 0 };
      });
      renderContent();

      await searchFor(user, 'john');

      await waitFor(() => {
        expect(screen.getByText('John')).toBeInTheDocument();
      });

      const input = screen.getByPlaceholderText('Search...');
      await user.clear(input);
      await user.keyboard('{Enter}');

      await waitFor(() => {
        expect(screen.getByText('All Contacts')).toBeInTheDocument();
      });
    });

    it('shows no results message when search returns empty', async () => {
      const user = userEvent.setup();
      mockSearch.mockResolvedValue({ hits: [], count: 0 });
      renderContent();

      await searchFor(user, 'nonexistent');

      await waitFor(() => {
        expect(screen.getByText(/No results found/)).toBeInTheDocument();
      });
    });

    it('displays search results', async () => {
      const user = userEvent.setup();
      mockSearch.mockResolvedValue({
        hits: [
          {
            id: 'contact-1',
            entityType: 'contact',
            document: {
              title: 'John Doe',
              content: 'john@example.com'
            }
          }
        ],
        count: 1
      });
      renderContent();

      await searchFor(user, 'john');

      await waitFor(() => {
        expect(screen.getByText('John Doe')).toBeInTheDocument();
        expect(screen.getByText('Contact')).toBeInTheDocument();
      });
    });

    it('shows result count', async () => {
      const user = userEvent.setup();
      mockSearch.mockResolvedValue({
        hits: [
          {
            id: 'contact-1',
            entityType: 'contact',
            document: { title: 'John Doe' }
          }
        ],
        count: 1
      });
      renderContent();

      await searchFor(user, 'john');

      await waitFor(() => {
        expect(screen.getByText('1 result')).toBeInTheDocument();
      });
    });

    it('shows search duration in status bar after searching', async () => {
      const user = userEvent.setup();
      mockSearch.mockResolvedValue({ hits: [], count: 0 });
      renderContent();

      await searchFor(user, 'timing');

      await waitFor(() => {
        expect(screen.getByText(/Search took \d+ ms/)).toBeInTheDocument();
      });
    });

    it('ignores stale results from earlier searches', async () => {
      const user = userEvent.setup();
      type MockSearchResponse = {
        hits: Array<{
          id: string;
          entityType: 'contact';
          document: { title: string };
        }>;
        count: number;
      };

      const unresolved = () => {
        throw new Error('Resolver was not assigned');
      };
      let resolveFirst: (value: {
        hits: MockSearchResponse['hits'];
        count: number;
      }) => void = unresolved;
      let resolveSecond: (value: {
        hits: MockSearchResponse['hits'];
        count: number;
      }) => void = unresolved;

      mockSearch.mockImplementation(
        (query: string) =>
          new Promise((resolve) => {
            if (query === 'first') {
              resolveFirst = resolve;
              return;
            }
            resolveSecond = resolve;
          })
      );

      renderContent();

      await searchFor(user, 'first');

      const input = screen.getByPlaceholderText('Search...');
      await user.clear(input);
      await searchFor(user, 'second');

      resolveSecond({
        hits: [
          {
            id: 'second-1',
            entityType: 'contact',
            document: { title: 'Second Result' }
          }
        ],
        count: 1
      });

      resolveFirst({
        hits: [
          {
            id: 'first-1',
            entityType: 'contact',
            document: { title: 'First Result' }
          }
        ],
        count: 1
      });

      await waitFor(() => {
        expect(screen.getByText('Second Result')).toBeInTheDocument();
        expect(screen.queryByText('First Result')).not.toBeInTheDocument();
      });
    });
  });
});
