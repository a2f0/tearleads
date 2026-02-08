import { ThemeProvider } from '@rapid/ui';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchWindowContent } from './SearchWindowContent';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate
  };
});

const mockSearch = vi.fn();
vi.mock('@/search', () => ({
  useSearch: () => ({
    search: mockSearch,
    isInitialized: true,
    isIndexing: false,
    documentCount: 10
  })
}));

function renderContent() {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <SearchWindowContent />
      </ThemeProvider>
    </MemoryRouter>
  );
}

describe('SearchWindowContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearch.mockResolvedValue({ hits: [], count: 0 });
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

    it('shows empty state when no query', () => {
      renderContent();
      expect(
        screen.getByText('Enter a search term to find your data')
      ).toBeInTheDocument();
      expect(screen.getAllByText('10 items indexed')).toHaveLength(2);
    });

    it('shows indexed count in status bar when query is empty', () => {
      renderContent();
      const statusLine = screen.getAllByText('10 items indexed')[1];
      expect(statusLine).toHaveClass('border-t');
    });
  });

  describe('searching', () => {
    it('performs search on input', async () => {
      const user = userEvent.setup();
      renderContent();

      const input = screen.getByPlaceholderText('Search...');
      await user.type(input, 'test');

      await waitFor(() => {
        expect(mockSearch).toHaveBeenCalledWith('test');
      });
    });

    it('clears results when query is empty', async () => {
      const user = userEvent.setup();
      mockSearch.mockResolvedValue({
        hits: [
          {
            id: 'contact-1',
            entityType: 'contact',
            document: { title: 'John' }
          }
        ],
        count: 1
      });
      renderContent();

      const input = screen.getByPlaceholderText('Search...');
      await user.type(input, 'john');

      await waitFor(() => {
        expect(screen.getByText('John')).toBeInTheDocument();
      });

      await user.clear(input);

      await waitFor(() => {
        expect(
          screen.getByText('Enter a search term to find your data')
        ).toBeInTheDocument();
      });
    });

    it('shows no results message when search returns empty', async () => {
      const user = userEvent.setup();
      mockSearch.mockResolvedValue({ hits: [], count: 0 });
      renderContent();

      const input = screen.getByPlaceholderText('Search...');
      await user.type(input, 'nonexistent');

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

      const input = screen.getByPlaceholderText('Search...');
      await user.type(input, 'john');

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

      const input = screen.getByPlaceholderText('Search...');
      await user.type(input, 'john');

      await waitFor(() => {
        expect(screen.getByText('1 result')).toBeInTheDocument();
      });
    });

    it('shows search duration in status bar after searching', async () => {
      const user = userEvent.setup();
      mockSearch.mockResolvedValue({ hits: [], count: 0 });
      renderContent();

      const input = screen.getByPlaceholderText('Search...');
      await user.type(input, 'timing');

      await waitFor(() => {
        expect(screen.getByText(/Search took \d+ ms/)).toBeInTheDocument();
      });
    });
  });

  describe('filtering', () => {
    it('changes filter when clicking tab', async () => {
      const user = userEvent.setup();
      renderContent();

      await user.click(screen.getByText('Contacts'));
      expect(screen.getByText('Contacts')).toHaveClass('bg-primary');
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

      const input = screen.getByPlaceholderText('Search...');
      await user.type(input, 'test');

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

      const input = screen.getByPlaceholderText('Search...');
      await user.type(input, 'john');

      await waitFor(() => {
        expect(screen.getByText('John Doe')).toBeInTheDocument();
      });

      await user.click(screen.getByText('John Doe'));
      expect(mockNavigate).toHaveBeenCalledWith('/contacts/contact-123');
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

      const input = screen.getByPlaceholderText('Search...');
      await user.type(input, 'meeting');

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

      const input = screen.getByPlaceholderText('Search...');
      await user.type(input, 'project');

      await waitFor(() => {
        expect(screen.getByText('Re: Project Update')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Re: Project Update'));
      expect(mockNavigate).toHaveBeenCalledWith('/emails/email-789');
    });

    it('navigates to file when clicking file result', async () => {
      const user = userEvent.setup();
      mockSearch.mockResolvedValue({
        hits: [
          {
            id: 'file-101',
            entityType: 'file',
            document: { title: 'document.pdf' }
          }
        ],
        count: 1
      });
      renderContent();

      const input = screen.getByPlaceholderText('Search...');
      await user.type(input, 'document');

      await waitFor(() => {
        expect(screen.getByText('document.pdf')).toBeInTheDocument();
      });

      await user.click(screen.getByText('document.pdf'));
      expect(mockNavigate).toHaveBeenCalledWith('/documents/file-101');
    });

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

      const input = screen.getByPlaceholderText('Search...');
      await user.type(input, 'playlist');

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

      const input = screen.getByPlaceholderText('Search...');
      await user.type(input, 'album');

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

      const input = screen.getByPlaceholderText('Search...');
      await user.type(input, 'code');

      await waitFor(() => {
        expect(screen.getByText('Chat about code')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Chat about code'));
      expect(mockNavigate).toHaveBeenCalledWith('/ai?conversation=ai-404');
    });
  });
});
