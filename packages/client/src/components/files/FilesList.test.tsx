import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FilesList } from './FilesList';

// Mock dependencies
vi.mock('@/audio', () => ({
  useAudio: () => ({
    currentTrack: null,
    isPlaying: false,
    play: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn()
  })
}));

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => ({
    isUnlocked: true,
    isLoading: false,
    currentInstanceId: 'test-instance'
  })
}));

vi.mock('@/db', () => ({
  getDatabase: () => ({
    select: () => ({
      from: () => ({
        orderBy: () => Promise.resolve([])
      })
    }),
    update: () => ({
      set: () => ({
        where: () => Promise.resolve()
      })
    })
  })
}));

vi.mock('@/db/crypto', () => ({
  getKeyManager: () => ({
    getCurrentKey: () => new Uint8Array(32)
  })
}));

vi.mock('@/storage/opfs', () => ({
  initializeFileStorage: vi.fn(),
  getFileStorage: () => ({
    measureRetrieve: vi.fn()
  }),
  createRetrieveLogger: vi.fn()
}));

vi.mock('@/hooks/useFileUpload', () => ({
  useFileUpload: () => ({
    uploadFile: vi.fn()
  })
}));

vi.mock('@/lib/navigation', () => ({
  useNavigateWithFrom: () => vi.fn()
}));

vi.mock('@/i18n', () => ({
  useTypedTranslation: () => ({
    t: (key: string) => key
  })
}));

vi.mock('@/components/sqlite/InlineUnlock', () => ({
  InlineUnlock: () => <div data-testid="inline-unlock">Unlock</div>
}));

vi.mock('@/components/ui/dropzone', () => ({
  Dropzone: ({
    onFilesSelected,
    disabled
  }: {
    onFilesSelected: (files: File[]) => void;
    disabled: boolean;
  }) => (
    <button
      type="button"
      data-testid="dropzone"
      data-disabled={disabled}
      onClick={() => {
        const file = new File(['test'], 'test.txt', { type: 'text/plain' });
        onFilesSelected([file]);
      }}
    >
      Dropzone
    </button>
  )
}));

vi.mock('@/components/ui/refresh-button', () => ({
  RefreshButton: ({
    onClick,
    loading
  }: {
    onClick: () => void;
    loading: boolean;
  }) => (
    <button
      type="button"
      data-testid="refresh-button"
      data-loading={loading}
      onClick={onClick}
    >
      Refresh
    </button>
  )
}));

vi.mock('@/components/ui/VirtualListStatus', () => ({
  VirtualListStatus: () => <div data-testid="virtual-list-status">Status</div>
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => ({
    getVirtualItems: () => [],
    getTotalSize: () => 0,
    measureElement: vi.fn()
  })
}));

vi.mock('@/hooks/useVirtualVisibleRange', () => ({
  useVirtualVisibleRange: () => ({
    firstVisible: 0,
    lastVisible: 0
  })
}));

describe('FilesList', () => {
  const renderWithRouter = (ui: ReactElement) =>
    render(<MemoryRouter>{ui}</MemoryRouter>);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders header when showHeader is true', () => {
    renderWithRouter(<FilesList showDeleted={false} showHeader={true} />);
    expect(screen.getByText('Files')).toBeInTheDocument();
  });

  it('does not render header when showHeader is false', () => {
    renderWithRouter(<FilesList showDeleted={false} showHeader={false} />);
    expect(screen.queryByText('Files')).not.toBeInTheDocument();
  });

  it('renders dropzone when unlocked', () => {
    renderWithRouter(<FilesList showDeleted={false} />);
    expect(screen.getByTestId('dropzone')).toBeInTheDocument();
  });

  it('renders refresh button when unlocked', () => {
    renderWithRouter(<FilesList showDeleted={false} showHeader={true} />);
    expect(screen.getByTestId('refresh-button')).toBeInTheDocument();
  });

  it('renders show deleted toggle when onShowDeletedChange is provided', () => {
    const onShowDeletedChange = vi.fn();
    renderWithRouter(
      <FilesList
        showDeleted={false}
        showHeader={true}
        onShowDeletedChange={onShowDeletedChange}
      />
    );
    expect(screen.getByText('Show deleted')).toBeInTheDocument();
  });

  it('calls onShowDeletedChange when toggle is clicked', async () => {
    const user = userEvent.setup();
    const onShowDeletedChange = vi.fn();
    renderWithRouter(
      <FilesList
        showDeleted={false}
        showHeader={true}
        onShowDeletedChange={onShowDeletedChange}
      />
    );

    await user.click(screen.getByRole('switch'));
    expect(onShowDeletedChange).toHaveBeenCalledWith(true);
  });

  it('shows loading state initially', () => {
    renderWithRouter(<FilesList showDeleted={false} />);
    expect(screen.getByText('Loading files...')).toBeInTheDocument();
  });
});
