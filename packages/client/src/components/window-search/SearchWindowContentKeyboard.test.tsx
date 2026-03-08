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

  describe('keyboard navigation', () => {
    it('resets the search state when pressing Escape', async () => {
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

      await user.click(screen.getByText('Contacts'));
      await searchFor(user, 'john');

      await waitFor(() => {
        expect(screen.getByText('John Doe')).toBeInTheDocument();
      });

      const input = screen.getByPlaceholderText(
        'Search...'
      ) as HTMLInputElement;
      expect(input.value).toBe('john');
      expect(screen.getByText('Contacts')).toHaveClass('bg-primary');

      await user.keyboard('{Escape}');

      await waitFor(() => {
        expect(input.value).toBe('');
        expect(screen.getByText('Start typing to search')).toBeInTheDocument();
      });
      expect(screen.queryByText('John Doe')).not.toBeInTheDocument();
      expect(screen.getByText('All')).toHaveClass('bg-primary');
      expect(screen.getByText('Contacts')).not.toHaveClass('bg-primary');
      expect(screen.getByText('10 items indexed')).toBeInTheDocument();
    });

    it('highlights first result when pressing ArrowDown', async () => {
      const user = userEvent.setup();
      mockSearch.mockResolvedValue({
        hits: [
          {
            id: 'contact-1',
            entityType: 'contact',
            document: { title: 'John Doe' }
          },
          {
            id: 'contact-2',
            entityType: 'contact',
            document: { title: 'Jane Doe' }
          }
        ],
        count: 2
      });
      renderContent();

      await searchFor(user, 'doe');

      await waitFor(() => {
        expect(screen.getByText('John Doe')).toBeInTheDocument();
      });

      await user.keyboard('{ArrowDown}');

      const firstResult = screen.getByText('John Doe').closest('button');
      expect(firstResult).toHaveClass('bg-accent');
    });

    it('moves selection down with ArrowDown and up with ArrowUp', async () => {
      const user = userEvent.setup();
      mockSearch.mockResolvedValue({
        hits: [
          {
            id: 'contact-1',
            entityType: 'contact',
            document: { title: 'John Doe' }
          },
          {
            id: 'contact-2',
            entityType: 'contact',
            document: { title: 'Jane Doe' }
          }
        ],
        count: 2
      });
      renderContent();

      await searchFor(user, 'doe');

      await waitFor(() => {
        expect(screen.getByText('John Doe')).toBeInTheDocument();
      });

      await user.keyboard('{ArrowDown}');
      await user.keyboard('{ArrowDown}');

      const secondResult = screen.getByText('Jane Doe').closest('button');
      expect(secondResult).toHaveClass('bg-accent');

      await user.keyboard('{ArrowUp}');

      const firstResult = screen.getByText('John Doe').closest('button');
      expect(firstResult).toHaveClass('bg-accent');
    });

    it('opens selected result when pressing Enter', async () => {
      const user = userEvent.setup();
      mockSearch.mockResolvedValue({
        hits: [
          {
            id: 'contact-1',
            entityType: 'contact',
            document: { title: 'John Doe' }
          },
          {
            id: 'note-1',
            entityType: 'note',
            document: { title: 'Meeting Notes' }
          }
        ],
        count: 2
      });
      renderContent();

      await searchFor(user, 'test');

      await waitFor(() => {
        expect(screen.getByText('John Doe')).toBeInTheDocument();
      });

      await user.keyboard('{ArrowDown}');
      await user.keyboard('{ArrowDown}');
      await user.keyboard('{Enter}');

      expect(mockNavigate).toHaveBeenCalledWith('/notes/note-1');
    });

    it('does not move selection past the last result', async () => {
      const user = userEvent.setup();
      mockSearch.mockResolvedValue({
        hits: [
          {
            id: 'contact-1',
            entityType: 'contact',
            document: { title: 'John Doe' }
          },
          {
            id: 'contact-2',
            entityType: 'contact',
            document: { title: 'Jane Doe' }
          }
        ],
        count: 2
      });
      renderContent();

      await searchFor(user, 'doe');

      await waitFor(() => {
        expect(screen.getByText('John Doe')).toBeInTheDocument();
      });

      await user.keyboard('{ArrowDown}');
      await user.keyboard('{ArrowDown}');
      await user.keyboard('{ArrowDown}');
      await user.keyboard('{ArrowDown}');

      const secondResult = screen.getByText('Jane Doe').closest('button');
      expect(secondResult).toHaveClass('bg-accent');
    });

    it('does not move selection above first result', async () => {
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

      await searchFor(user, 'doe');

      await waitFor(() => {
        expect(screen.getByText('John Doe')).toBeInTheDocument();
      });

      await user.keyboard('{ArrowDown}');
      await user.keyboard('{ArrowUp}');
      await user.keyboard('{ArrowUp}');

      const firstResult = screen.getByText('John Doe').closest('button');
      expect(firstResult).toHaveClass('bg-accent');
    });

    it('resets selection when results change', async () => {
      const user = userEvent.setup();
      mockSearch.mockImplementation(async (query: string) => {
        if (query === 'john') {
          return {
            hits: [
              {
                id: 'contact-1',
                entityType: 'contact',
                document: { title: 'John Doe' }
              }
            ],
            count: 1
          };
        }

        if (query === 'note') {
          return {
            hits: [
              {
                id: 'note-1',
                entityType: 'note',
                document: { title: 'New Note' }
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
        expect(screen.getByText('John Doe')).toBeInTheDocument();
      });

      await user.keyboard('{ArrowDown}');
      expect(screen.getByText('John Doe').closest('button')).toHaveClass(
        'bg-accent'
      );

      const input = screen.getByPlaceholderText('Search...');
      await user.clear(input);
      await searchFor(user, 'note');

      await waitFor(() => {
        expect(screen.getByText('New Note')).toBeInTheDocument();
      });

      await waitFor(() => {
        expect(screen.getByText('New Note').closest('button')).not.toHaveClass(
          'bg-accent'
        );
      });
    });

    it('keeps focus in input while navigating', async () => {
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
        expect(screen.getByText('John Doe')).toBeInTheDocument();
      });

      const input = screen.getByPlaceholderText('Search...');
      await user.keyboard('{ArrowDown}');

      expect(document.activeElement).toBe(input);
    });

    it('highlights selected row in table view', async () => {
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
      renderContent('table');

      await searchFor(user, 'john');

      await waitFor(() => {
        expect(screen.getByText('John Doe')).toBeInTheDocument();
      });

      await user.keyboard('{ArrowDown}');

      const row = screen.getByText('John Doe').closest('tr');
      expect(row).toHaveClass('bg-accent/50');
    });

    it('submits search form when Enter pressed with no selection', async () => {
      const user = userEvent.setup();
      mockSearch.mockResolvedValue({ hits: [], count: 0 });
      renderContent();

      const input = screen.getByPlaceholderText('Search...');
      await user.type(input, 'test');
      await user.keyboard('{Enter}');

      await waitFor(() => {
        expect(mockSearch).toHaveBeenCalledWith('test');
      });
    });
  });
});
