import { ThemeProvider } from '@tearleads/ui';
import { render, screen, waitFor } from '@testing-library/react';
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

  describe('filtering', () => {
    it('toggles multiple filters on and off', async () => {
      const user = userEvent.setup();
      renderContent();

      await user.click(screen.getByText('Contacts'));
      expect(screen.getByText('Contacts')).toHaveClass('bg-primary');

      await user.click(screen.getByText('Notes'));
      expect(screen.getByText('Notes')).toHaveClass('bg-primary');

      await user.click(screen.getByText('Contacts'));
      expect(screen.getByText('Contacts')).not.toHaveClass('bg-primary');
      expect(screen.getByText('Notes')).toHaveClass('bg-primary');
    });

    it('clears other selected filters when clicking All', async () => {
      const user = userEvent.setup();
      renderContent();

      await user.click(screen.getByText('Contacts'));
      await user.click(screen.getByText('Notes'));

      expect(screen.getByText('Contacts')).toHaveClass('bg-primary');
      expect(screen.getByText('Notes')).toHaveClass('bg-primary');

      await user.click(screen.getByText('All'));

      expect(screen.getByText('All')).toHaveClass('bg-primary');
      expect(screen.getByText('Contacts')).not.toHaveClass('bg-primary');
      expect(screen.getByText('Notes')).not.toHaveClass('bg-primary');
    });

    it('passes multiple entity types to search hook options', async () => {
      const user = userEvent.setup();
      renderContent();

      await user.click(screen.getByText('Contacts'));
      await user.click(screen.getByText('Notes'));

      await waitFor(() => {
        expect(mockUseSearch).toHaveBeenLastCalledWith({
          entityTypes: ['contact', 'note'],
          limit: 50
        });
      });

      await user.click(screen.getByText('All'));

      await waitFor(() => {
        expect(mockUseSearch).toHaveBeenLastCalledWith({ limit: 50 });
      });
    });
  });

  describe('error handling', () => {
    it('handles search error gracefully', async () => {
      const user = userEvent.setup();
      mockSearch.mockRejectedValue(new Error('Search failed'));
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      renderContent();

      await searchFor(user, 'test');

      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith(
          'Search failed:',
          expect.any(Error)
        );
      });

      consoleSpy.mockRestore();
    });
  });
});
