import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PhotosWindow } from './PhotosWindow';

const mockUploadFile = vi.fn();

vi.mock('@/components/floating-window', () => ({
  FloatingWindow: ({
    children,
    title,
    onClose
  }: {
    children: React.ReactNode;
    title: string;
    onClose: () => void;
  }) => (
    <div data-testid="floating-window">
      <div data-testid="window-title">{title}</div>
      <button type="button" onClick={onClose} data-testid="close-window">
        Close
      </button>
      {children}
    </div>
  )
}));

vi.mock('./PhotosWindowMenuBar', () => ({
  PhotosWindowMenuBar: ({
    viewMode,
    onRefresh,
    onUpload,
    onClose,
    onViewModeChange
  }: {
    viewMode: 'list' | 'table';
    onRefresh: () => void;
    onUpload: () => void;
    onClose: () => void;
    onViewModeChange: (mode: 'list' | 'table') => void;
  }) => (
    <div data-testid="menu-bar">
      <button type="button" onClick={onRefresh} data-testid="refresh-button">
        Refresh
      </button>
      <button type="button" onClick={onUpload} data-testid="upload-button">
        Upload
      </button>
      <button type="button" onClick={onClose} data-testid="menu-close-button">
        Close
      </button>
      <button
        type="button"
        onClick={() => onViewModeChange(viewMode === 'list' ? 'table' : 'list')}
        data-testid="toggle-view-button"
      >
        Toggle
      </button>
    </div>
  )
}));

vi.mock('./PhotosWindowContent', () => ({
  PhotosWindowContent: ({
    onSelectPhoto
  }: {
    onSelectPhoto?: (photoId: string) => void;
  }) => (
    <div data-testid="photos-content">
      <button
        type="button"
        onClick={() => onSelectPhoto?.('photo-123')}
        data-testid="select-photo-button"
      >
        Select Photo
      </button>
      Photos Content
    </div>
  )
}));

vi.mock('./PhotosWindowDetail', () => ({
  PhotosWindowDetail: ({
    photoId,
    onBack
  }: {
    photoId: string;
    onBack: () => void;
    onDeleted: () => void;
  }) => (
    <div data-testid="photos-detail">
      <span data-testid="detail-photo-id">{photoId}</span>
      <button type="button" onClick={onBack} data-testid="detail-back-button">
        Back
      </button>
    </div>
  )
}));

vi.mock('./PhotosWindowTableView', () => ({
  PhotosWindowTableView: () => (
    <div data-testid="photos-table-content">Photos Table Content</div>
  )
}));

vi.mock('@/hooks/useFileUpload', () => ({
  useFileUpload: () => ({
    uploadFile: mockUploadFile
  })
}));

describe('PhotosWindow', () => {
  const defaultProps = {
    id: 'test-window',
    onClose: vi.fn(),
    onMinimize: vi.fn(),
    onFocus: vi.fn(),
    zIndex: 100
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUploadFile.mockClear();
  });

  it('renders in FloatingWindow', () => {
    render(<PhotosWindow {...defaultProps} />);
    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
  });

  it('displays correct title', () => {
    render(<PhotosWindow {...defaultProps} />);
    expect(screen.getByTestId('window-title')).toHaveTextContent('Photos');
  });

  it('renders menu bar', () => {
    render(<PhotosWindow {...defaultProps} />);
    expect(screen.getByTestId('menu-bar')).toBeInTheDocument();
  });

  it('renders photos content', () => {
    render(<PhotosWindow {...defaultProps} />);
    expect(screen.getByTestId('photos-content')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<PhotosWindow {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByTestId('close-window'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when menu close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<PhotosWindow {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByTestId('menu-close-button'));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders hidden file input', () => {
    render(<PhotosWindow {...defaultProps} />);
    expect(screen.getByTestId('photo-file-input')).toBeInTheDocument();
    expect(screen.getByTestId('photo-file-input')).toHaveClass('hidden');
  });

  it('triggers file input when upload button is clicked', async () => {
    const user = userEvent.setup();
    render(<PhotosWindow {...defaultProps} />);

    const fileInput = screen.getByTestId('photo-file-input');
    const clickSpy = vi.spyOn(fileInput, 'click');

    await user.click(screen.getByTestId('upload-button'));

    expect(clickSpy).toHaveBeenCalled();
  });

  it('calls refresh when refresh button is clicked', async () => {
    const user = userEvent.setup();
    render(<PhotosWindow {...defaultProps} />);

    await user.click(screen.getByTestId('refresh-button'));

    expect(screen.getByTestId('photos-content')).toBeInTheDocument();
  });

  it('handles file input change with files', async () => {
    const user = userEvent.setup();
    render(<PhotosWindow {...defaultProps} />);

    const fileInput = screen.getByTestId('photo-file-input');
    if (!(fileInput instanceof HTMLInputElement)) {
      throw new Error('Expected file input to be HTMLInputElement');
    }
    const file = new File(['test content'], 'test.jpg', { type: 'image/jpeg' });

    await user.upload(fileInput, file);

    await waitFor(() => expect(mockUploadFile).toHaveBeenCalledWith(file));
    expect(fileInput.value).toBe('');
  });

  it('handles file input change with no files', () => {
    render(<PhotosWindow {...defaultProps} />);

    const fileInput = screen.getByTestId('photo-file-input');
    if (!(fileInput instanceof HTMLInputElement)) {
      throw new Error('Expected file input to be HTMLInputElement');
    }

    Object.defineProperty(fileInput, 'files', {
      value: [],
      writable: true
    });

    fireEvent.change(fileInput);

    expect(fileInput.value).toBe('');
  });

  it('switches to table view when toggled', async () => {
    const user = userEvent.setup();
    render(<PhotosWindow {...defaultProps} />);

    await user.click(screen.getByTestId('toggle-view-button'));

    expect(screen.getByTestId('photos-table-content')).toBeInTheDocument();
  });

  it('keeps menu bar visible in detail view', async () => {
    const user = userEvent.setup();
    render(<PhotosWindow {...defaultProps} />);

    await user.click(screen.getByTestId('select-photo-button'));

    await waitFor(() => {
      expect(screen.getByTestId('photos-detail')).toBeInTheDocument();
      expect(screen.getByTestId('menu-bar')).toBeInTheDocument();
    });
  });
});
