import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Photos } from './Photos';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate
  };
});

// Mock database context using function approach
const mockUseDatabaseContext = vi.fn();

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockUseDatabaseContext()
}));

// Mock getDatabase
const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn()
};

vi.mock('@/db', () => ({
  getDatabase: vi.fn(() => mockDb)
}));

vi.mock('@/db/crypto', () => ({
  getKeyManager: vi.fn(() => ({
    getCurrentKey: vi.fn(() => new Uint8Array(32))
  }))
}));

// Mock file storage
const mockStorage = {
  retrieve: vi.fn()
};

vi.mock('@/storage/opfs', () => ({
  isFileStorageInitialized: vi.fn(() => true),
  initializeFileStorage: vi.fn(),
  getFileStorage: vi.fn(() => mockStorage)
}));

const mockPhotos = [
  {
    id: 'photo-1',
    name: 'test-image.jpg',
    size: 1024,
    mimeType: 'image/jpeg',
    uploadDate: new Date('2025-01-01'),
    storagePath: '/photos/test-image.jpg'
  },
  {
    id: 'photo-2',
    name: 'another-image.png',
    size: 2048,
    mimeType: 'image/png',
    uploadDate: new Date('2025-01-02'),
    storagePath: '/photos/another-image.png'
  }
];

function renderPhotos() {
  return render(
    <MemoryRouter>
      <Photos />
    </MemoryRouter>
  );
}

describe('Photos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDatabaseContext.mockReturnValue({
      isUnlocked: true,
      isLoading: false,
      currentInstanceId: 'test-instance'
    });

    // Mock database query
    mockDb.orderBy.mockResolvedValue(mockPhotos);

    // Mock file storage
    mockStorage.retrieve.mockResolvedValue(new Uint8Array([1, 2, 3]));

    // Mock URL.createObjectURL
    global.URL.createObjectURL = vi.fn(() => 'blob:test-url');
    global.URL.revokeObjectURL = vi.fn();
  });

  describe('page rendering', () => {
    it('renders the page title', async () => {
      renderPhotos();

      await waitFor(() => {
        expect(screen.getByText('Photos')).toBeInTheDocument();
      });
    });

    it('shows loading state when database is loading', async () => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: false,
        isLoading: true,
        currentInstanceId: null
      });

      renderPhotos();

      expect(screen.getByText('Loading database...')).toBeInTheDocument();
    });

    it('shows locked message when database is locked', async () => {
      mockUseDatabaseContext.mockReturnValue({
        isUnlocked: false,
        isLoading: false,
        currentInstanceId: null
      });

      renderPhotos();

      expect(
        screen.getByText(/Database is locked. Unlock it/)
      ).toBeInTheDocument();
    });
  });

  describe('context menu', () => {
    it('shows context menu on right-click', async () => {
      const user = userEvent.setup();
      renderPhotos();

      await waitFor(() => {
        expect(screen.getByAltText('test-image.jpg')).toBeInTheDocument();
      });

      const photo = screen.getByAltText('test-image.jpg');
      await user.pointer({ keys: '[MouseRight]', target: photo });

      await waitFor(() => {
        expect(screen.getByText('Get info')).toBeInTheDocument();
      });
    });

    it('navigates to photo detail when "Get info" is clicked', async () => {
      const user = userEvent.setup();
      renderPhotos();

      await waitFor(() => {
        expect(screen.getByAltText('test-image.jpg')).toBeInTheDocument();
      });

      const photo = screen.getByAltText('test-image.jpg');
      await user.pointer({ keys: '[MouseRight]', target: photo });

      await waitFor(() => {
        expect(screen.getByText('Get info')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Get info'));

      expect(mockNavigate).toHaveBeenCalledWith('/photos/photo-1');
    });

    it('closes context menu when clicking elsewhere', async () => {
      const user = userEvent.setup();
      renderPhotos();

      await waitFor(() => {
        expect(screen.getByAltText('test-image.jpg')).toBeInTheDocument();
      });

      const photo = screen.getByAltText('test-image.jpg');
      await user.pointer({ keys: '[MouseRight]', target: photo });

      await waitFor(() => {
        expect(screen.getByText('Get info')).toBeInTheDocument();
      });

      // Click the backdrop
      await user.click(
        screen.getByRole('button', { name: /close context menu/i })
      );

      await waitFor(() => {
        expect(screen.queryByText('Get info')).not.toBeInTheDocument();
      });
    });

    it('closes context menu when pressing Escape', async () => {
      const user = userEvent.setup();
      renderPhotos();

      await waitFor(() => {
        expect(screen.getByAltText('test-image.jpg')).toBeInTheDocument();
      });

      const photo = screen.getByAltText('test-image.jpg');
      await user.pointer({ keys: '[MouseRight]', target: photo });

      await waitFor(() => {
        expect(screen.getByText('Get info')).toBeInTheDocument();
      });

      await user.keyboard('{Escape}');

      await waitFor(() => {
        expect(screen.queryByText('Get info')).not.toBeInTheDocument();
      });
    });
  });

  describe('photo click navigation', () => {
    it('navigates to photo detail on left click', async () => {
      const user = userEvent.setup();
      renderPhotos();

      await waitFor(() => {
        expect(screen.getByAltText('test-image.jpg')).toBeInTheDocument();
      });

      await user.click(screen.getByAltText('test-image.jpg'));

      expect(mockNavigate).toHaveBeenCalledWith('/photos/photo-1');
    });

    it.each([
      ['Enter', '{Enter}'],
      ['Space', ' ']
    ])('navigates to photo detail on keyboard %s', async (_keyName, key) => {
      const user = userEvent.setup();
      renderPhotos();

      await waitFor(() => {
        expect(screen.getByAltText('test-image.jpg')).toBeInTheDocument();
      });

      const photoContainer =
        screen.getByAltText('test-image.jpg').parentElement;
      photoContainer?.focus();
      await user.keyboard(key);

      expect(mockNavigate).toHaveBeenCalledWith('/photos/photo-1');
    });
  });

  describe('accessibility', () => {
    it('does not have nested buttons in photo thumbnails', async () => {
      renderPhotos();

      await waitFor(() => {
        expect(screen.getByAltText('test-image.jpg')).toBeInTheDocument();
      });

      // Verify that no <button> element is a descendant of another <button> element
      const nestedButtons = document.querySelectorAll('button button');
      expect(nestedButtons).toHaveLength(0);

      // Additionally, verify that the photo container is a div with role="button" as intended
      const photoContainer =
        screen.getByAltText('test-image.jpg').parentElement;
      expect(photoContainer?.tagName).toBe('DIV');
      expect(photoContainer).toHaveAttribute('role', 'button');
    });

    it('photo container is keyboard focusable', async () => {
      renderPhotos();

      await waitFor(() => {
        expect(screen.getByAltText('test-image.jpg')).toBeInTheDocument();
      });

      const photoContainer =
        screen.getByAltText('test-image.jpg').parentElement;
      expect(photoContainer).toHaveAttribute('tabIndex', '0');
      expect(photoContainer).toHaveAttribute('role', 'button');
    });
  });
});
