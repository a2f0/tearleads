import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
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
    expect(screen.getByText('Viewing 1-3 of 3 files')).toBeInTheDocument();
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

    await waitFor(() => {
      expect(screen.getByTestId('files-detail')).toBeInTheDocument();
      expect(screen.getByTestId('detail-file-id')).toHaveTextContent(
        'test-file-id'
      );
      expect(screen.queryByTestId('files-content')).not.toBeInTheDocument();
      expect(screen.getByTestId('menu-bar')).toBeInTheDocument();
    });
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

  it('returns to list view when control bar back is clicked', async () => {
    const user = userEvent.setup();
    render(<FilesWindow {...defaultProps} />);

    await user.click(screen.getByTestId('select-file-button'));
    expect(screen.getByTestId('files-window-control-back')).toBeInTheDocument();

    await user.click(screen.getByTestId('files-window-control-back'));

    expect(screen.queryByTestId('files-detail')).not.toBeInTheDocument();
    expect(screen.getByTestId('files-content')).toBeInTheDocument();
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

  it('renders without error when inside a router context (WindowRenderer is inside BrowserRouter)', () => {
    expect(() =>
      render(
        <MemoryRouter>
          <FilesWindow {...defaultProps} />
        </MemoryRouter>
      )
    ).not.toThrow();
    expect(screen.getByTestId('files-content')).toBeInTheDocument();
  });
});
