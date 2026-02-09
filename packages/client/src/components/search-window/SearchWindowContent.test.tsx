import { ThemeProvider } from '@rapid/ui';
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

vi.mock('@/hooks/useIsMobile', () => ({
  useIsMobile: () => mockUseIsMobile()
}));

vi.mock('@/lib/vfs-open', () => ({
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

    it('renders filter tabs', () => {
      renderContent();
      expect(screen.getByText('All')).toBeInTheDocument();
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
  });

  describe('searching', () => {
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

  describe('navigation', () => {
    it('opens note in floating window on desktop', async () => {
      const user = userEvent.setup();
      mockUseIsMobile.mockReturnValue(false);
      mockSearch.mockResolvedValue({
        hits: [
          {
            id: 'note-456',
            entityType: 'note',
            document: { title: 'Meeting Notes' }
          }
        ],
        count: 1
      });
      renderContent();

      await searchFor(user, 'meeting');

      await waitFor(() => {
        expect(screen.getByText('Meeting Notes')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Meeting Notes'));
      expect(mockOpenWindow).toHaveBeenCalledWith('notes');
      expect(mockRequestWindowOpen).toHaveBeenCalledWith('notes', {
        noteId: 'note-456'
      });
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('stops click propagation when opening result on desktop', async () => {
      const user = userEvent.setup();
      mockUseIsMobile.mockReturnValue(false);
      mockSearch.mockResolvedValue({
        hits: [
          {
            id: 'note-456',
            entityType: 'note',
            document: { title: 'Meeting Notes' }
          }
        ],
        count: 1
      });

      render(
        <MemoryRouter>
          <ThemeProvider>
            <SearchWindowContent />
          </ThemeProvider>
        </MemoryRouter>
      );

      await searchFor(user, 'meeting');

      await waitFor(() => {
        expect(screen.getByText('Meeting Notes')).toBeInTheDocument();
      });

      const resultButton = screen.getByText('Meeting Notes');
      const clickEvent = new MouseEvent('click', { bubbles: true });
      const stopPropagationSpy = vi.spyOn(clickEvent, 'stopPropagation');
      resultButton.dispatchEvent(clickEvent);

      expect(stopPropagationSpy).toHaveBeenCalled();
      expect(mockOpenWindow).toHaveBeenCalledWith('notes');
    });

    it('navigates to AI conversation on desktop to preserve context', async () => {
      const user = userEvent.setup();
      mockUseIsMobile.mockReturnValue(false);
      mockSearch.mockResolvedValue({
        hits: [
          {
            id: 'ai-404',
            entityType: 'ai_conversation',
            document: { title: 'Chat about code' }
          }
        ],
        count: 1
      });
      renderContent();

      await searchFor(user, 'code');

      await waitFor(() => {
        expect(screen.getByText('Chat about code')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Chat about code'));
      expect(mockNavigate).toHaveBeenCalledWith('/ai?conversation=ai-404');
      expect(mockOpenWindow).not.toHaveBeenCalledWith('chat');
    });

    it.each([
      {
        fileTarget: 'audio',
        fileId: 'audio-456',
        fileTitle: 'mix.flac',
        query: 'mix',
        expectedWindow: 'audio',
        expectedPayload: { audioId: 'audio-456' }
      },
      {
        fileTarget: 'photo',
        fileId: 'photo-456',
        fileTitle: 'cover.png',
        query: 'cover',
        expectedWindow: 'photos',
        expectedPayload: { photoId: 'photo-456' }
      }
    ])(
      'opens $expectedWindow window when file resolves to $fileTarget on desktop',
      async ({
        fileTarget,
        fileId,
        fileTitle,
        query,
        expectedWindow,
        expectedPayload
      }) => {
        const user = userEvent.setup();
        mockUseIsMobile.mockReturnValue(false);
        mockResolveFileOpenTarget.mockResolvedValue(fileTarget);
        mockSearch.mockResolvedValue({
          hits: [
            {
              id: fileId,
              entityType: 'file',
              document: { title: fileTitle }
            }
          ],
          count: 1
        });
        renderContent();

        await searchFor(user, query);

        await waitFor(() => {
          expect(screen.getByText(fileTitle)).toBeInTheDocument();
        });

        await user.click(screen.getByText(fileTitle));
        await waitFor(() => {
          expect(mockOpenWindow).toHaveBeenCalledWith(expectedWindow);
        });
        expect(mockRequestWindowOpen).toHaveBeenCalledWith(
          expectedWindow,
          expectedPayload
        );
      }
    );

    it('navigates to contact when clicking contact result', async () => {
      const user = userEvent.setup();
      mockSearch.mockResolvedValue({
        hits: [
          {
            id: 'contact-123',
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

      await user.click(screen.getByText('John Doe'));
      expect(mockNavigate).toHaveBeenCalledWith('/contacts/contact-123');
    });

    it('opens contact detail in floating window on desktop', async () => {
      const user = userEvent.setup();
      mockUseIsMobile.mockReturnValue(false);
      mockSearch.mockResolvedValue({
        hits: [
          {
            id: 'contact-777',
            entityType: 'contact',
            document: { title: 'Jane Doe' }
          }
        ],
        count: 1
      });
      renderContent();

      await searchFor(user, 'jane');

      await waitFor(() => {
        expect(screen.getByText('Jane Doe')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Jane Doe'));
      expect(mockOpenWindow).toHaveBeenCalledWith('contacts');
      expect(mockRequestWindowOpen).toHaveBeenCalledWith('contacts', {
        contactId: 'contact-777'
      });
      expect(mockNavigate).not.toHaveBeenCalledWith('/contacts/contact-777');
    });

    it('navigates to note when clicking note result', async () => {
      const user = userEvent.setup();
      mockSearch.mockResolvedValue({
        hits: [
          {
            id: 'note-456',
            entityType: 'note',
            document: { title: 'Meeting Notes' }
          }
        ],
        count: 1
      });
      renderContent();

      await searchFor(user, 'meeting');

      await waitFor(() => {
        expect(screen.getByText('Meeting Notes')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Meeting Notes'));
      expect(mockNavigate).toHaveBeenCalledWith('/notes/note-456');
    });

    it('navigates to email when clicking email result', async () => {
      const user = userEvent.setup();
      mockSearch.mockResolvedValue({
        hits: [
          {
            id: 'email-789',
            entityType: 'email',
            document: { title: 'Re: Project Update' }
          }
        ],
        count: 1
      });
      renderContent();

      await searchFor(user, 'project');

      await waitFor(() => {
        expect(screen.getByText('Re: Project Update')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Re: Project Update'));
      expect(mockNavigate).toHaveBeenCalledWith('/emails/email-789');
    });

    it.each([
      {
        fileTarget: 'document',
        fileId: 'file-101',
        fileTitle: 'document.pdf',
        query: 'document',
        expectedRoute: '/documents/file-101'
      },
      {
        fileTarget: 'audio',
        fileId: 'audio-101',
        fileTitle: 'track.mp3',
        query: 'track',
        expectedRoute: '/audio/audio-101'
      },
      {
        fileTarget: 'photo',
        fileId: 'photo-101',
        fileTitle: 'image.jpg',
        query: 'image',
        expectedRoute: '/photos/photo-101'
      }
    ])(
      'navigates to $expectedRoute when file resolves to $fileTarget',
      async ({ fileTarget, fileId, fileTitle, query, expectedRoute }) => {
        const user = userEvent.setup();
        mockResolveFileOpenTarget.mockResolvedValue(fileTarget);
        mockSearch.mockResolvedValue({
          hits: [
            {
              id: fileId,
              entityType: 'file',
              document: { title: fileTitle }
            }
          ],
          count: 1
        });
        renderContent();

        await searchFor(user, query);

        await waitFor(() => {
          expect(screen.getByText(fileTitle)).toBeInTheDocument();
        });

        await user.click(screen.getByText(fileTitle));
        await waitFor(() => {
          expect(mockNavigate).toHaveBeenCalledWith(expectedRoute);
        });
      }
    );

    it('navigates to playlist when clicking playlist result', async () => {
      const user = userEvent.setup();
      mockSearch.mockResolvedValue({
        hits: [
          {
            id: 'playlist-202',
            entityType: 'playlist',
            document: { title: 'My Playlist' }
          }
        ],
        count: 1
      });
      renderContent();

      await searchFor(user, 'playlist');

      await waitFor(() => {
        expect(screen.getByText('My Playlist')).toBeInTheDocument();
      });

      await user.click(screen.getByText('My Playlist'));
      expect(mockNavigate).toHaveBeenCalledWith('/audio?playlist=playlist-202');
    });

    it('navigates to album when clicking album result', async () => {
      const user = userEvent.setup();
      mockSearch.mockResolvedValue({
        hits: [
          {
            id: 'album-303',
            entityType: 'album',
            document: { title: 'Best Album' }
          }
        ],
        count: 1
      });
      renderContent();

      await searchFor(user, 'album');

      await waitFor(() => {
        expect(screen.getByText('Best Album')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Best Album'));
      expect(mockNavigate).toHaveBeenCalledWith('/audio?album=album-303');
    });

    it('navigates to AI conversation when clicking AI chat result', async () => {
      const user = userEvent.setup();
      mockSearch.mockResolvedValue({
        hits: [
          {
            id: 'ai-404',
            entityType: 'ai_conversation',
            document: { title: 'Chat about code' }
          }
        ],
        count: 1
      });
      renderContent();

      await searchFor(user, 'code');

      await waitFor(() => {
        expect(screen.getByText('Chat about code')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Chat about code'));
      expect(mockNavigate).toHaveBeenCalledWith('/ai?conversation=ai-404');
    });
  });
});
