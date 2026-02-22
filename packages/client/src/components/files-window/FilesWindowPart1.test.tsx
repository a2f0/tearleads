import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FilesWindow } from './FilesWindow';

vi.mock('@/contexts/WindowManagerContext', () => ({
  useWindowOpenRequest: () => undefined
}));

// Mock FloatingWindow
vi.mock('@tearleads/window-manager', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@tearleads/window-manager')>();

  return {
    ...actual,
    DesktopFloatingWindow: ({
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
  };
});

// Mock FilesWindowMenuBar
vi.mock('./FilesWindowMenuBar', () => ({
  FilesWindowMenuBar: ({
    showDeleted,
    onShowDeletedChange,
    showDropzone,
    onShowDropzoneChange,
    viewMode,
    onViewModeChange,
    onUpload,
    onClose
  }: {
    showDeleted: boolean;
    onShowDeletedChange: (show: boolean) => void;
    showDropzone: boolean;
    onShowDropzoneChange: (show: boolean) => void;
    viewMode: 'list' | 'table';
    onViewModeChange: (mode: 'list' | 'table') => void;
    onUpload: () => void;
    onClose: () => void;
  }) => (
    <div data-testid="menu-bar">
      <span data-testid="show-deleted-state">
        {showDeleted ? 'true' : 'false'}
      </span>
      <span data-testid="show-dropzone-state">
        {showDropzone ? 'true' : 'false'}
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
        onClick={() => onShowDropzoneChange(!showDropzone)}
        data-testid="toggle-show-dropzone"
      >
        Toggle Show Dropzone
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
  FilesWindowContent: vi.fn().mockImplementation(
    ({
      showDeleted,
      showDropzone,
      refreshToken,
      ref,
      onSelectFile,
      onStatusTextChange,
      onUploadInProgressChange
    }: {
      showDeleted: boolean;
      showDropzone: boolean;
      refreshToken?: number;
      ref?: React.RefObject<{
        uploadFiles: (files: File[]) => void;
      } | null>;
      onSelectFile?: (fileId: string) => void;
      onStatusTextChange?: (text: string) => void;
      onUploadInProgressChange?: (inProgress: boolean) => void;
    }) => {
      // Simulate forwardRef behavior by exposing uploadFiles
      if (ref) {
        ref.current = { uploadFiles: mockUploadFiles };
      }
      React.useEffect(() => {
        onStatusTextChange?.('Viewing 1-3 of 3 files');
      }, [onStatusTextChange]);
      return (
        <div data-testid="files-content">
          <span data-testid="content-show-deleted">
            {showDeleted ? 'true' : 'false'}
          </span>
          <span data-testid="content-show-dropzone">
            {showDropzone ? 'true' : 'false'}
          </span>
          <span data-testid="content-refresh-token">{refreshToken}</span>
          {onUploadInProgressChange && (
            <>
              <button
                type="button"
                data-testid="set-upload-in-progress"
                onClick={() => onUploadInProgressChange(true)}
              >
                Set Upload In Progress
              </button>
              <button
                type="button"
                data-testid="clear-upload-in-progress"
                onClick={() => onUploadInProgressChange(false)}
              >
                Clear Upload In Progress
              </button>
            </>
          )}
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

  it('renders control bar actions in list view', () => {
    render(<FilesWindow {...defaultProps} />);
    expect(
      screen.getByTestId('files-window-control-upload')
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('files-window-control-refresh')
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('files-window-control-back')
    ).not.toBeInTheDocument();
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

  it('starts with showDropzone as false', () => {
    render(<FilesWindow {...defaultProps} />);
    expect(screen.getByTestId('show-dropzone-state')).toHaveTextContent(
      'false'
    );
    expect(screen.getByTestId('content-show-dropzone')).toHaveTextContent(
      'false'
    );
  });

  it('toggles showDropzone state', async () => {
    const user = userEvent.setup();
    render(<FilesWindow {...defaultProps} />);

    expect(screen.getByTestId('show-dropzone-state')).toHaveTextContent(
      'false'
    );

    await user.click(screen.getByTestId('toggle-show-dropzone'));

    expect(screen.getByTestId('show-dropzone-state')).toHaveTextContent('true');
    expect(screen.getByTestId('content-show-dropzone')).toHaveTextContent(
      'true'
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

  it('triggers file input when control bar upload is clicked', async () => {
    const user = userEvent.setup();
    render(<FilesWindow {...defaultProps} />);

    const fileInput = screen.getByTestId('file-input');
    const clickSpy = vi.spyOn(fileInput, 'click');

    await user.click(screen.getByTestId('files-window-control-upload'));

    expect(clickSpy).toHaveBeenCalled();
  });

  it('refreshes list content when control bar refresh is clicked', async () => {
    const user = userEvent.setup();
    render(<FilesWindow {...defaultProps} />);

    expect(screen.getByTestId('content-refresh-token')).toHaveTextContent('0');

    await user.click(screen.getByTestId('files-window-control-refresh'));

    expect(screen.getByTestId('content-refresh-token')).toHaveTextContent('1');
  });

  it('disables control bar upload and refresh while upload is in progress', async () => {
    const user = userEvent.setup();
    render(<FilesWindow {...defaultProps} />);

    const uploadButton = screen.getByTestId('files-window-control-upload');
    const refreshButton = screen.getByTestId('files-window-control-refresh');

    expect(uploadButton).toBeEnabled();
    expect(refreshButton).toBeEnabled();

    await user.click(screen.getByTestId('set-upload-in-progress'));

    await waitFor(() => {
      expect(uploadButton).toBeDisabled();
      expect(refreshButton).toBeDisabled();
    });
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
