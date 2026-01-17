import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PhotosWindow } from './PhotosWindow';

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
    onRefresh,
    onUpload,
    onClose
  }: {
    onRefresh: () => void;
    onUpload: () => void;
    onClose: () => void;
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
    </div>
  )
}));

const mockUploadFiles = vi.fn();
const mockRefresh = vi.fn();

vi.mock('./PhotosWindowContent', () => ({
  PhotosWindowContent: vi.fn().mockImplementation(
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    ({ ref }: { ref?: any }) => {
      if (ref) {
        ref.current = { uploadFiles: mockUploadFiles, refresh: mockRefresh };
      }
      return <div data-testid="photos-content">Photos Content</div>;
    }
  )
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
    mockUploadFiles.mockClear();
    mockRefresh.mockClear();
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

    expect(mockRefresh).toHaveBeenCalled();
  });

  it('handles file input change with files', () => {
    render(<PhotosWindow {...defaultProps} />);

    const fileInput = screen.getByTestId(
      'photo-file-input'
    ) as HTMLInputElement;
    const file = new File(['test content'], 'test.jpg', { type: 'image/jpeg' });

    Object.defineProperty(fileInput, 'files', {
      value: [file],
      writable: true
    });

    fireEvent.change(fileInput);

    expect(mockUploadFiles).toHaveBeenCalledWith([file]);
    expect(fileInput.value).toBe('');
  });

  it('handles file input change with no files', () => {
    render(<PhotosWindow {...defaultProps} />);

    const fileInput = screen.getByTestId(
      'photo-file-input'
    ) as HTMLInputElement;

    Object.defineProperty(fileInput, 'files', {
      value: [],
      writable: true
    });

    fireEvent.change(fileInput);

    expect(fileInput.value).toBe('');
  });
});
