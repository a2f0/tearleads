import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FilesWindow } from './FilesWindow';

// Mock FloatingWindow
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

// Mock FilesWindowMenuBar
vi.mock('./FilesWindowMenuBar', () => ({
  FilesWindowMenuBar: ({
    showDeleted,
    onShowDeletedChange,
    onUpload,
    onClose
  }: {
    showDeleted: boolean;
    onShowDeletedChange: (show: boolean) => void;
    onUpload: () => void;
    onClose: () => void;
  }) => (
    <div data-testid="menu-bar">
      <span data-testid="show-deleted-state">
        {showDeleted ? 'true' : 'false'}
      </span>
      <button
        type="button"
        onClick={() => onShowDeletedChange(!showDeleted)}
        data-testid="toggle-show-deleted"
      >
        Toggle Show Deleted
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

// Mock FilesWindowContent
vi.mock('./FilesWindowContent', () => ({
  FilesWindowContent: vi.fn().mockImplementation(
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    ({ showDeleted, ref }: { showDeleted: boolean; ref?: any }) => {
      // Simulate forwardRef behavior by exposing uploadFiles
      if (ref) {
        ref.current = { uploadFiles: mockUploadFiles };
      }
      return (
        <div data-testid="files-content">
          <span data-testid="content-show-deleted">
            {showDeleted ? 'true' : 'false'}
          </span>
        </div>
      );
    }
  )
}));

describe('FilesWindow', () => {
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
  });

  it('renders in FloatingWindow', () => {
    render(<FilesWindow {...defaultProps} />);
    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
  });

  it('displays correct title', () => {
    render(<FilesWindow {...defaultProps} />);
    expect(screen.getByTestId('window-title')).toHaveTextContent('Files');
  });

  it('renders menu bar', () => {
    render(<FilesWindow {...defaultProps} />);
    expect(screen.getByTestId('menu-bar')).toBeInTheDocument();
  });

  it('renders files content', () => {
    render(<FilesWindow {...defaultProps} />);
    expect(screen.getByTestId('files-content')).toBeInTheDocument();
  });

  it('starts with showDeleted as false', () => {
    render(<FilesWindow {...defaultProps} />);
    expect(screen.getByTestId('show-deleted-state')).toHaveTextContent('false');
    expect(screen.getByTestId('content-show-deleted')).toHaveTextContent(
      'false'
    );
  });

  it('toggles showDeleted state', async () => {
    const user = userEvent.setup();
    render(<FilesWindow {...defaultProps} />);

    expect(screen.getByTestId('show-deleted-state')).toHaveTextContent('false');

    await user.click(screen.getByTestId('toggle-show-deleted'));

    expect(screen.getByTestId('show-deleted-state')).toHaveTextContent('true');
    expect(screen.getByTestId('content-show-deleted')).toHaveTextContent(
      'true'
    );
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<FilesWindow {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByTestId('close-window'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when menu close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<FilesWindow {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByTestId('menu-close-button'));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders hidden file input', () => {
    render(<FilesWindow {...defaultProps} />);
    expect(screen.getByTestId('file-input')).toBeInTheDocument();
    expect(screen.getByTestId('file-input')).toHaveClass('hidden');
  });

  it('triggers file input when upload button is clicked', async () => {
    const user = userEvent.setup();
    render(<FilesWindow {...defaultProps} />);

    const fileInput = screen.getByTestId('file-input');
    const clickSpy = vi.spyOn(fileInput, 'click');

    await user.click(screen.getByTestId('upload-button'));

    expect(clickSpy).toHaveBeenCalled();
  });

  it('handles file input change with files', () => {
    render(<FilesWindow {...defaultProps} />);

    const fileInput = screen.getByTestId('file-input') as HTMLInputElement;
    const file = new File(['test content'], 'test.txt', { type: 'text/plain' });

    // Create a mock FileList
    Object.defineProperty(fileInput, 'files', {
      value: [file],
      writable: true
    });

    fireEvent.change(fileInput);

    expect(mockUploadFiles).toHaveBeenCalledWith([file]);

    // Input should be reset after change
    expect(fileInput.value).toBe('');
  });

  it('handles file input change with no files', () => {
    render(<FilesWindow {...defaultProps} />);

    const fileInput = screen.getByTestId('file-input') as HTMLInputElement;

    // Create empty FileList
    Object.defineProperty(fileInput, 'files', {
      value: [],
      writable: true
    });

    fireEvent.change(fileInput);

    // Should not throw an error with empty file list
    expect(fileInput.value).toBe('');
  });
});
