import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import * as isoStorage from '@/lib/v86/iso-storage';
import { IsoDirectory } from './IsoDirectory';

vi.mock('@/lib/v86/iso-storage', () => ({
  isOpfsSupported: vi.fn(),
  listDownloadedIsos: vi.fn(),
  getStorageUsage: vi.fn()
}));

vi.mock('@/lib/v86/iso-catalog', () => ({
  ISO_CATALOG: [
    {
      id: 'test-iso-1',
      name: 'Test ISO 1',
      description: 'A test ISO',
      downloadUrl: 'https://example.com/test1.iso',
      sizeBytes: 1048576,
      bootType: 'cdrom',
      memoryMb: 256
    },
    {
      id: 'test-iso-2',
      name: 'Test ISO 2',
      description: 'Another test ISO',
      downloadUrl: 'https://example.com/test2.iso',
      sizeBytes: 2097152,
      bootType: 'hda',
      memoryMb: 512
    }
  ]
}));

vi.mock('./IsoDirectoryItem', () => ({
  IsoDirectoryItem: ({
    entry,
    isDownloaded,
    onBoot
  }: {
    entry: { id: string; name: string };
    isDownloaded: boolean;
    onBoot: (entry: { id: string; name: string }) => void;
  }) => (
    <div data-testid={`iso-item-${entry.id}`}>
      <span>{entry.name}</span>
      {isDownloaded && <span data-testid="downloaded-badge">Downloaded</span>}
      <button type="button" onClick={() => onBoot(entry)}>
        Boot
      </button>
    </div>
  )
}));

describe('IsoDirectory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state initially', () => {
    (isoStorage.isOpfsSupported as Mock).mockReturnValue(true);
    (isoStorage.listDownloadedIsos as Mock).mockReturnValue(
      new Promise(() => {})
    );
    (isoStorage.getStorageUsage as Mock).mockReturnValue(new Promise(() => {}));

    render(<IsoDirectory onSelectIso={vi.fn()} />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows error when OPFS is not supported', () => {
    (isoStorage.isOpfsSupported as Mock).mockReturnValue(false);

    render(<IsoDirectory onSelectIso={vi.fn()} />);
    expect(screen.getByText('Browser Not Supported')).toBeInTheDocument();
    expect(screen.getByText(/Origin Private File System/)).toBeInTheDocument();
  });

  it('renders ISO catalog items after loading', async () => {
    (isoStorage.isOpfsSupported as Mock).mockReturnValue(true);
    (isoStorage.listDownloadedIsos as Mock).mockResolvedValue([]);
    (isoStorage.getStorageUsage as Mock).mockResolvedValue({
      used: 0,
      available: 1073741824
    });

    render(<IsoDirectory onSelectIso={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('iso-item-test-iso-1')).toBeInTheDocument();
      expect(screen.getByTestId('iso-item-test-iso-2')).toBeInTheDocument();
    });
  });

  it('marks downloaded ISOs correctly', async () => {
    (isoStorage.isOpfsSupported as Mock).mockReturnValue(true);
    (isoStorage.listDownloadedIsos as Mock).mockResolvedValue([
      { id: 'test-iso-1', name: 'Test ISO 1', sizeBytes: 1048576 }
    ]);
    (isoStorage.getStorageUsage as Mock).mockResolvedValue({
      used: 1048576,
      available: 1073741824
    });

    render(<IsoDirectory onSelectIso={vi.fn()} />);

    await waitFor(() => {
      const item1 = screen.getByTestId('iso-item-test-iso-1');
      const item2 = screen.getByTestId('iso-item-test-iso-2');
      expect(
        item1.querySelector('[data-testid="downloaded-badge"]')
      ).toBeInTheDocument();
      expect(
        item2.querySelector('[data-testid="downloaded-badge"]')
      ).not.toBeInTheDocument();
    });
  });

  it('shows storage usage', async () => {
    (isoStorage.isOpfsSupported as Mock).mockReturnValue(true);
    (isoStorage.listDownloadedIsos as Mock).mockResolvedValue([]);
    (isoStorage.getStorageUsage as Mock).mockResolvedValue({
      used: 1048576,
      available: 1073741824
    });

    render(<IsoDirectory onSelectIso={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/1.0 MB used/)).toBeInTheDocument();
      expect(screen.getByText(/1.0 GB available/)).toBeInTheDocument();
    });
  });

  it('calls onSelectIso when boot is clicked', async () => {
    const user = userEvent.setup();
    const onSelectIso = vi.fn();
    (isoStorage.isOpfsSupported as Mock).mockReturnValue(true);
    (isoStorage.listDownloadedIsos as Mock).mockResolvedValue([]);
    (isoStorage.getStorageUsage as Mock).mockResolvedValue({
      used: 0,
      available: 1073741824
    });

    render(<IsoDirectory onSelectIso={onSelectIso} />);

    await waitFor(() => {
      expect(screen.getByTestId('iso-item-test-iso-1')).toBeInTheDocument();
    });

    const bootButton = screen.getAllByText('Boot')[0];
    if (!bootButton) throw new Error('Boot button not found');
    await user.click(bootButton);

    expect(onSelectIso).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'test-iso-1' })
    );
  });

  it('renders ISO Directory header', async () => {
    (isoStorage.isOpfsSupported as Mock).mockReturnValue(true);
    (isoStorage.listDownloadedIsos as Mock).mockResolvedValue([]);
    (isoStorage.getStorageUsage as Mock).mockResolvedValue({
      used: 0,
      available: 1073741824
    });

    render(<IsoDirectory onSelectIso={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('ISO Directory')).toBeInTheDocument();
    });
  });
});
