import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import * as isoStorage from '@/lib/v86/iso-storage';
import { V86Emulator } from './V86Emulator';

vi.mock('@/lib/v86/iso-storage', () => ({
  getIsoUrl: vi.fn()
}));

vi.mock('./useV86', () => ({
  useV86: () => ({
    containerRef: { current: null },
    status: 'idle',
    error: null,
    start: vi.fn(),
    stop: vi.fn(),
    restart: vi.fn()
  })
}));

describe('V86Emulator', () => {
  const mockIso = {
    id: 'test-iso',
    name: 'Test ISO',
    description: 'A test operating system',
    downloadUrl: 'https://example.com/test.iso',
    sizeBytes: 104857600,
    bootType: 'cdrom' as const,
    memoryMb: 256
  };

  beforeEach(() => {
    vi.clearAllMocks();
    URL.createObjectURL = vi.fn(() => 'blob:test-url');
    URL.revokeObjectURL = vi.fn();
  });

  it('shows loading state while fetching ISO URL', () => {
    (isoStorage.getIsoUrl as Mock).mockReturnValue(new Promise(() => {}));

    render(<V86Emulator iso={mockIso} onBack={vi.fn()} />);

    expect(screen.getByText('Loading ISO...')).toBeInTheDocument();
  });

  it('shows error state when ISO loading fails', async () => {
    (isoStorage.getIsoUrl as Mock).mockRejectedValue(
      new Error('ISO not found')
    );

    render(<V86Emulator iso={mockIso} onBack={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('ISO not found')).toBeInTheDocument();
    });

    expect(screen.getByText('Back to ISO Directory')).toBeInTheDocument();
  });

  it('calls onBack when back button is clicked on error state', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    (isoStorage.getIsoUrl as Mock).mockRejectedValue(
      new Error('ISO not found')
    );

    render(<V86Emulator iso={mockIso} onBack={onBack} />);

    await waitFor(() => {
      expect(screen.getByText('Back to ISO Directory')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Back to ISO Directory'));
    expect(onBack).toHaveBeenCalled();
  });

  it('renders emulator UI when ISO loads successfully', async () => {
    (isoStorage.getIsoUrl as Mock).mockResolvedValue('blob:test-url');

    render(<V86Emulator iso={mockIso} onBack={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Back')).toBeInTheDocument();
    });

    expect(screen.getByText(/Test ISO/)).toBeInTheDocument();
  });

  it('displays ISO name and status in the toolbar', async () => {
    (isoStorage.getIsoUrl as Mock).mockResolvedValue('blob:test-url');

    render(<V86Emulator iso={mockIso} onBack={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/Test ISO - idle/)).toBeInTheDocument();
    });
  });

  it('revokes object URL on unmount', async () => {
    (isoStorage.getIsoUrl as Mock).mockResolvedValue('blob:test-url');

    const { unmount } = render(<V86Emulator iso={mockIso} onBack={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Back')).toBeInTheDocument();
    });

    unmount();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-url');
  });

  it('handles generic error messages', async () => {
    (isoStorage.getIsoUrl as Mock).mockRejectedValue('Unknown error');

    render(<V86Emulator iso={mockIso} onBack={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load ISO')).toBeInTheDocument();
    });
  });
});

describe('V86EmulatorInner', () => {
  const mockIso = {
    id: 'test-iso',
    name: 'Test ISO',
    description: 'A test operating system',
    downloadUrl: 'https://example.com/test.iso',
    sizeBytes: 104857600,
    bootType: 'cdrom' as const,
    memoryMb: 256
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders power controls', async () => {
    (isoStorage.getIsoUrl as Mock).mockResolvedValue('blob:test-url');

    render(<V86Emulator iso={mockIso} onBack={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTitle('Restart')).toBeInTheDocument();
      expect(screen.getByTitle('Power On')).toBeInTheDocument();
    });
  });

  it('calls onBack when back button is clicked', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    (isoStorage.getIsoUrl as Mock).mockResolvedValue('blob:test-url');

    render(<V86Emulator iso={mockIso} onBack={onBack} />);

    await waitFor(() => {
      expect(screen.getByText('Back')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Back'));
    expect(onBack).toHaveBeenCalled();
  });
});
