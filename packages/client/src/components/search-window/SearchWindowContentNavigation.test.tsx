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

    it('opens AI conversation in floating window on desktop', async () => {
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
      expect(mockOpenWindow).toHaveBeenCalledWith('ai');
      expect(mockRequestWindowOpen).toHaveBeenCalledWith('ai', {
        conversationId: 'ai-404'
      });
      expect(mockNavigate).not.toHaveBeenCalled();
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
    ])('opens $expectedWindow window when file resolves to $fileTarget on desktop', async ({
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
    });

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

    it('navigates to email when clicking email result on mobile', async () => {
      const user = userEvent.setup();
      mockUseIsMobile.mockReturnValue(true);
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

    it('opens email in floating window on desktop', async () => {
      const user = userEvent.setup();
      mockUseIsMobile.mockReturnValue(false);
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
      expect(mockOpenWindow).toHaveBeenCalledWith('email');
      expect(mockRequestWindowOpen).toHaveBeenCalledWith('email', {
        emailId: 'email-789'
      });
      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });
});
