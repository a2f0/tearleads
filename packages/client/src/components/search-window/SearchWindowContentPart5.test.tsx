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

  describe('navigation', () => {
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
    ])('navigates to $expectedRoute when file resolves to $fileTarget', async ({
      fileTarget,
      fileId,
      fileTitle,
      query,
      expectedRoute
    }) => {
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

      await searchFor(user, 'playlist');

      await waitFor(() => {
        expect(screen.getByText('My Playlist')).toBeInTheDocument();
      });

      await user.click(screen.getByText('My Playlist'));
      expect(mockNavigate).toHaveBeenCalledWith('/audio?playlist=playlist-202');
    });

    it('navigates to album when clicking album result on mobile', async () => {
      const user = userEvent.setup();
      mockUseIsMobile.mockReturnValue(true);
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

    it('opens album in audio floating window on desktop', async () => {
      const user = userEvent.setup();
      mockUseIsMobile.mockReturnValue(false);
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
      expect(mockOpenWindow).toHaveBeenCalledWith('audio');
      expect(mockRequestWindowOpen).toHaveBeenCalledWith('audio', {
        albumId: 'album-303'
      });
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('navigates to AI conversation when clicking AI chat result on mobile', async () => {
      const user = userEvent.setup();
      mockUseIsMobile.mockReturnValue(true);
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

    it('navigates to help doc on mobile when clicking help-doc result', async () => {
      const user = userEvent.setup();
      mockUseIsMobile.mockReturnValue(true);
      mockSearch.mockResolvedValue({
        hits: [
          {
            id: 'help-doc:cli',
            entityType: 'help_doc',
            document: { title: 'CLI' }
          }
        ],
        count: 1
      });
      renderContent();

      await searchFor(user, 'cli');

      await waitFor(() => {
        expect(screen.getByText('CLI')).toBeInTheDocument();
      });

      await user.click(screen.getByText('CLI'));
      expect(mockNavigate).toHaveBeenCalledWith('/help/docs/cli');
    });

    it('opens help window on desktop when clicking help-doc result', async () => {
      const user = userEvent.setup();
      mockUseIsMobile.mockReturnValue(false);
      mockSearch.mockResolvedValue({
        hits: [
          {
            id: 'help-doc:cli',
            entityType: 'help_doc',
            document: { title: 'CLI' }
          }
        ],
        count: 1
      });
      renderContent();

      await searchFor(user, 'cli');

      await waitFor(() => {
        expect(screen.getByText('CLI')).toBeInTheDocument();
      });

      await user.click(screen.getByText('CLI'));
      expect(mockOpenWindow).toHaveBeenCalledWith('help');
      expect(mockRequestWindowOpen).toHaveBeenCalledWith('help', {
        helpDocId: 'cli'
      });
    });

    it('opens app window on desktop when clicking app result', async () => {
      const user = userEvent.setup();
      mockUseIsMobile.mockReturnValue(false);
      mockSearch.mockResolvedValue({
        hits: [
          {
            id: 'app:notes',
            entityType: 'app',
            document: { title: 'Notes' }
          }
        ],
        count: 1
      });
      renderContent();

      const input = screen.getByPlaceholderText('Search...');
      await user.type(input, 'note');

      await waitFor(() => {
        expect(mockSearch).toHaveBeenCalledWith('note');
        expect(screen.getByText('App')).toBeInTheDocument();
      });

      const appResultButton = screen.getByText('App').closest('button');
      expect(appResultButton).toBeTruthy();
      if (!appResultButton) {
        throw new Error('App result button was not found');
      }

      await user.click(appResultButton);
      expect(mockOpenWindow).toHaveBeenCalledWith('notes');
    });
  });
});
