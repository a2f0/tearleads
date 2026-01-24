import { act, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import * as isoStorage from '@/lib/v86/iso-storage';
import { IsoDirectoryItem } from './IsoDirectoryItem';

vi.mock('@/lib/v86/iso-storage', () => ({
  downloadIso: vi.fn(),
  deleteIso: vi.fn()
}));

describe('IsoDirectoryItem', () => {
  const mockEntry = {
    id: 'test-iso',
    name: 'Test ISO',
    description: 'A test operating system ISO',
    downloadUrl: 'https://example.com/test.iso',
    sizeBytes: 104857600, // 100 MB
    bootType: 'cdrom' as const,
    memoryMb: 256
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders ISO entry information', () => {
    render(
      <IsoDirectoryItem
        entry={mockEntry}
        isDownloaded={false}
        onBoot={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    expect(screen.getByText('Test ISO')).toBeInTheDocument();
    expect(screen.getByText('A test operating system ISO')).toBeInTheDocument();
    expect(screen.getByText('100.0 MB')).toBeInTheDocument();
    expect(screen.getByText('256 MB RAM')).toBeInTheDocument();
    expect(screen.getByText('Boot: cdrom')).toBeInTheDocument();
  });

  it('shows Download button when not downloaded', () => {
    render(
      <IsoDirectoryItem
        entry={mockEntry}
        isDownloaded={false}
        onBoot={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    expect(screen.getByText('Download')).toBeInTheDocument();
    expect(screen.queryByText('Boot')).not.toBeInTheDocument();
  });

  it('shows Boot and Delete buttons when downloaded', () => {
    render(
      <IsoDirectoryItem
        entry={mockEntry}
        isDownloaded={true}
        onBoot={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    expect(screen.getByText('Boot')).toBeInTheDocument();
    expect(screen.getByText('Downloaded')).toBeInTheDocument();
    expect(screen.queryByText('Download')).not.toBeInTheDocument();
  });

  it('downloads ISO when Download button is clicked', async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    (isoStorage.downloadIso as Mock).mockResolvedValue(undefined);

    render(
      <IsoDirectoryItem
        entry={mockEntry}
        isDownloaded={false}
        onBoot={vi.fn()}
        onRefresh={onRefresh}
      />
    );

    await user.click(screen.getByText('Download'));

    await waitFor(() => {
      expect(isoStorage.downloadIso).toHaveBeenCalledWith(
        mockEntry,
        expect.any(Function)
      );
    });

    await waitFor(() => {
      expect(onRefresh).toHaveBeenCalled();
    });
  });

  it('shows downloading state and progress', async () => {
    const user = userEvent.setup();
    let progressCallback: (progress: {
      loaded: number;
      total: number;
      percentage: number;
    }) => void = () => {};

    (isoStorage.downloadIso as Mock).mockImplementation(
      (_entry, onProgress) => {
        progressCallback = onProgress;
        return new Promise(() => {}); // Never resolves
      }
    );

    render(
      <IsoDirectoryItem
        entry={mockEntry}
        isDownloaded={false}
        onBoot={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    await user.click(screen.getByText('Download'));

    await waitFor(() => {
      expect(screen.getByText('Downloading...')).toBeInTheDocument();
    });

    // Simulate progress - wrapped in act since it triggers state updates
    act(() => {
      progressCallback({ loaded: 52428800, total: 104857600, percentage: 50 });
    });

    await waitFor(() => {
      expect(screen.getByText(/50%/)).toBeInTheDocument();
    });
  });

  it('shows error message when download fails', async () => {
    const user = userEvent.setup();
    (isoStorage.downloadIso as Mock).mockRejectedValue(
      new Error('Network error')
    );

    render(
      <IsoDirectoryItem
        entry={mockEntry}
        isDownloaded={false}
        onBoot={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    await user.click(screen.getByText('Download'));

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('calls onBoot when Boot button is clicked', async () => {
    const user = userEvent.setup();
    const onBoot = vi.fn();

    render(
      <IsoDirectoryItem
        entry={mockEntry}
        isDownloaded={true}
        onBoot={onBoot}
        onRefresh={vi.fn()}
      />
    );

    await user.click(screen.getByText('Boot'));

    expect(onBoot).toHaveBeenCalledWith(mockEntry);
  });

  it('deletes ISO when delete button is clicked', async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    (isoStorage.deleteIso as Mock).mockResolvedValue(undefined);

    render(
      <IsoDirectoryItem
        entry={mockEntry}
        isDownloaded={true}
        onBoot={vi.fn()}
        onRefresh={onRefresh}
      />
    );

    // Find the delete button (it has a Trash2 icon, no text)
    const deleteButton = screen.getByRole('button', { name: '' });
    await user.click(deleteButton);

    await waitFor(() => {
      expect(isoStorage.deleteIso).toHaveBeenCalledWith('test-iso');
    });

    await waitFor(() => {
      expect(onRefresh).toHaveBeenCalled();
    });
  });

  it('shows error message when delete fails', async () => {
    const user = userEvent.setup();
    (isoStorage.deleteIso as Mock).mockRejectedValue(
      new Error('Delete failed')
    );

    render(
      <IsoDirectoryItem
        entry={mockEntry}
        isDownloaded={true}
        onBoot={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    const deleteButton = screen.getByRole('button', { name: '' });
    await user.click(deleteButton);

    await waitFor(() => {
      expect(screen.getByText('Delete failed')).toBeInTheDocument();
    });
  });

  it('formats small file sizes correctly', () => {
    render(
      <IsoDirectoryItem
        entry={{ ...mockEntry, sizeBytes: 500 }}
        isDownloaded={false}
        onBoot={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    expect(screen.getByText('500 B')).toBeInTheDocument();
  });

  it('formats KB file sizes correctly', () => {
    render(
      <IsoDirectoryItem
        entry={{ ...mockEntry, sizeBytes: 51200 }}
        isDownloaded={false}
        onBoot={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    expect(screen.getByText('50.0 KB')).toBeInTheDocument();
  });

  it('formats GB file sizes correctly', () => {
    render(
      <IsoDirectoryItem
        entry={{ ...mockEntry, sizeBytes: 1073741824 }}
        isDownloaded={false}
        onBoot={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    expect(screen.getByText('1.0 GB')).toBeInTheDocument();
  });
});
