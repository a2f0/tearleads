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
    viewMode,
    onViewModeChange,
    onUpload,
    onClose
  }: {
    showDeleted: boolean;
    onShowDeletedChange: (show: boolean) => void;
    viewMode: 'list' | 'table';
    onViewModeChange: (mode: 'list' | 'table') => void;
    onUpload: () => void;
    onClose: () => void;
  }) => (
    <div data-testid="menu-bar">
      <span data-testid="show-deleted-state">
        {showDeleted ? 'true' : 'false'}
      </span>
      <span data-testid="view-mode-state">{viewMode}</span>
      <button
        type="button"
        onClick={() => onShowDeletedChange(!showDeleted)}
        data-testid="toggle-show-deleted"
      >
        Toggle Show Deleted
      </button>
      <button
        type="button"
        onClick={() => onViewModeChange(viewMode === 'list' ? 'table' : 'list')}
        data-testid="toggle-view-mode"
      >
        Toggle View Mode
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

// Mock FilesWindowTableView
vi.mock('./FilesWindowTableView', () => ({
  FilesWindowTableView: ({
    showDeleted,
    onUpload
  }: {
    showDeleted: boolean;
    onUpload: () => void;
  }) => (
    <div data-testid="files-table-view">
      <span data-testid="table-show-deleted">
        {showDeleted ? 'true' : 'false'}
      </span>
      <button
        type="button"
        onClick={onUpload}
        data-testid="table-upload-button"
      >
        Upload
      </button>
    </div>
  )
}));

// Mock FilesWindowContent
vi.mock('./FilesWindowContent', () => ({
  FilesWindowContent: vi
    .fn()
    .mockImplementation(
      ({
        showDeleted,
        ref,
        onSelectFile
      }: {
        showDeleted: boolean;
        ref?: React.RefObject<{ uploadFiles: (files: File[]) => void } | null>;
        onSelectFile?: (fileId: string) => void;
      }) => {
        // Simulate forwardRef behavior by exposing uploadFiles
        if (ref) {
          ref.current = { uploadFiles: mockUploadFiles };
        }
        return (
          <div data-testid="files-content">
            <span data-testid="content-show-deleted">
              {showDeleted ? 'true' : 'false'}
            </span>
            {onSelectFile && (
              <button
                type="button"
                data-testid="select-file-button"
                onClick={() => onSelectFile('test-file-id')}
              >
                Select File
              </button>
            )}
          </div>
        );
      }
    )
}));

// Mock FilesWindowDetail
vi.mock('./FilesWindowDetail', () => ({
  FilesWindowDetail: ({
    fileId,
    onBack,
    onDeleted
  }: {
    fileId: string;
    onBack: () => void;
    onDeleted: () => void;
  }) => (
    <div data-testid="files-detail">
      <span data-testid="detail-file-id">{fileId}</span>
      <button type="button" data-testid="detail-back" onClick={onBack}>
        Back
      </button>
      <button type="button" data-testid="detail-deleted" onClick={onDeleted}>
        Deleted
      </button>
    </div>
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

  it('starts with viewMode as list', () => {
    render(<FilesWindow {...defaultProps} />);
    expect(screen.getByTestId('view-mode-state')).toHaveTextContent('list');
  });

  it('toggles viewMode state', async () => {
    const user = userEvent.setup();
    render(<FilesWindow {...defaultProps} />);

    expect(screen.getByTestId('view-mode-state')).toHaveTextContent('list');
    expect(screen.getByTestId('files-content')).toBeInTheDocument();

    await user.click(screen.getByTestId('toggle-view-mode'));

    expect(screen.getByTestId('view-mode-state')).toHaveTextContent('table');
    expect(screen.getByTestId('files-table-view')).toBeInTheDocument();
  });

  it('renders table view when viewMode is table', async () => {
    const user = userEvent.setup();
    render(<FilesWindow {...defaultProps} />);

    await user.click(screen.getByTestId('toggle-view-mode'));

    expect(screen.getByTestId('files-table-view')).toBeInTheDocument();
    expect(screen.queryByTestId('files-content')).not.toBeInTheDocument();
  });

  it('renders list view when viewMode is list', () => {
    render(<FilesWindow {...defaultProps} />);

    expect(screen.getByTestId('files-content')).toBeInTheDocument();
    expect(screen.queryByTestId('files-table-view')).not.toBeInTheDocument();
  });

  it('passes showDeleted to table view', async () => {
    const user = userEvent.setup();
    render(<FilesWindow {...defaultProps} />);

    await user.click(screen.getByTestId('toggle-view-mode'));
    expect(screen.getByTestId('table-show-deleted')).toHaveTextContent('false');

    await user.click(screen.getByTestId('toggle-show-deleted'));
    expect(screen.getByTestId('table-show-deleted')).toHaveTextContent('true');
  });

  it('renders with initialDimensions', () => {
    render(
      <FilesWindow
        {...defaultProps}
        initialDimensions={{ x: 100, y: 100, width: 500, height: 400 }}
      />
    );
    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
  });

  it('handles file input change with null files', () => {
    render(<FilesWindow {...defaultProps} />);

    const fileInput = screen.getByTestId('file-input') as HTMLInputElement;

    Object.defineProperty(fileInput, 'files', {
      value: null,
      writable: true
    });

    fireEvent.change(fileInput);

    expect(mockUploadFiles).not.toHaveBeenCalled();
    expect(fileInput.value).toBe('');
  });

  it('shows detail view when a file is selected', async () => {
    const user = userEvent.setup();
    render(<FilesWindow {...defaultProps} />);

    await user.click(screen.getByTestId('select-file-button'));

    expect(screen.getByTestId('files-detail')).toBeInTheDocument();
    expect(screen.getByTestId('detail-file-id')).toHaveTextContent(
      'test-file-id'
    );
    expect(screen.queryByTestId('files-content')).not.toBeInTheDocument();
    expect(screen.queryByTestId('menu-bar')).not.toBeInTheDocument();
  });

  it('returns to list view when back button is clicked', async () => {
    const user = userEvent.setup();
    render(<FilesWindow {...defaultProps} />);

    await user.click(screen.getByTestId('select-file-button'));
    expect(screen.getByTestId('files-detail')).toBeInTheDocument();

    await user.click(screen.getByTestId('detail-back'));

    expect(screen.queryByTestId('files-detail')).not.toBeInTheDocument();
    expect(screen.getByTestId('files-content')).toBeInTheDocument();
    expect(screen.getByTestId('menu-bar')).toBeInTheDocument();
  });

  it('returns to list view when file is deleted', async () => {
    const user = userEvent.setup();
    render(<FilesWindow {...defaultProps} />);

    await user.click(screen.getByTestId('select-file-button'));
    expect(screen.getByTestId('files-detail')).toBeInTheDocument();

    await user.click(screen.getByTestId('detail-deleted'));

    expect(screen.queryByTestId('files-detail')).not.toBeInTheDocument();
    expect(screen.getByTestId('files-content')).toBeInTheDocument();
  });
});
