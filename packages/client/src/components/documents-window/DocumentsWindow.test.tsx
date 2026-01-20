import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentsWindow } from './DocumentsWindow';

let lastDocumentsProps: Record<string, unknown> | null = null;

vi.mock('@/components/floating-window', () => ({
  FloatingWindow: ({
    children,
    title,
    onClose,
    ...rest
  }: {
    children: React.ReactNode;
    title: string;
    onClose: () => void;
    [key: string]: unknown;
  }) => (
    <div
      data-testid="floating-window"
      data-props={JSON.stringify(rest)}
      data-props-keys={JSON.stringify(Object.keys(rest))}
    >
      <div data-testid="window-title">{title}</div>
      <button type="button" onClick={onClose} data-testid="close-window">
        Close
      </button>
      {children}
    </div>
  )
}));

vi.mock('@/pages/Documents', async () => {
  const { useLocation } = await import('react-router-dom');
  return {
    Documents: ({
      onSelectDocument,
      ...props
    }: {
      onSelectDocument?: (documentId: string) => void;
      [key: string]: unknown;
    }) => {
      lastDocumentsProps = props;
      const location = useLocation();
      return (
        <div data-testid="documents-content">
          <div data-testid="documents-location">{location.pathname}</div>
          <button
            type="button"
            onClick={() => onSelectDocument?.('doc-1')}
            data-testid="select-document"
          >
            Select Document
          </button>
        </div>
      );
    }
  };
});

vi.mock('@/pages/DocumentDetail', () => ({
  DocumentDetail: ({
    documentId,
    onBack
  }: {
    documentId?: string;
    onBack?: () => void;
  }) => (
    <div data-testid="document-detail">
      <span>Document {documentId}</span>
      <button type="button" onClick={onBack} data-testid="document-back">
        Back
      </button>
    </div>
  )
}));

vi.mock('./DocumentsWindowMenuBar', () => ({
  DocumentsWindowMenuBar: ({
    onUpload,
    onRefresh,
    onClose
  }: {
    onUpload: () => void;
    onRefresh: () => void;
    onClose: () => void;
  }) => (
    <div data-testid="documents-menu">
      <button type="button" onClick={onUpload} data-testid="menu-upload">
        Upload
      </button>
      <button type="button" onClick={onRefresh} data-testid="menu-refresh">
        Refresh
      </button>
      <button type="button" onClick={onClose} data-testid="menu-close">
        Close
      </button>
    </div>
  )
}));

const mockUploadFile = vi.fn();
vi.mock('@/hooks/useFileUpload', () => ({
  useFileUpload: () => ({ uploadFile: mockUploadFile })
}));

describe('DocumentsWindow', () => {
  const defaultProps = {
    id: 'test-window',
    onClose: vi.fn(),
    onMinimize: vi.fn(),
    onFocus: vi.fn(),
    zIndex: 100
  };

  beforeEach(() => {
    vi.clearAllMocks();
    lastDocumentsProps = null;
  });

  it('renders in FloatingWindow', () => {
    render(<DocumentsWindow {...defaultProps} />);
    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
  });

  it('displays the correct title', () => {
    render(<DocumentsWindow {...defaultProps} />);
    expect(screen.getByTestId('window-title')).toHaveTextContent('Documents');
  });

  it('renders Documents content', () => {
    render(<DocumentsWindow {...defaultProps} />);
    expect(screen.getByTestId('documents-content')).toBeInTheDocument();
    expect(screen.getByTestId('documents-location')).toHaveTextContent(
      '/documents'
    );
  });

  it('renders detail view when a document is selected', async () => {
    const user = userEvent.setup();
    render(<DocumentsWindow {...defaultProps} />);

    await user.click(screen.getByTestId('select-document'));

    expect(screen.getByTestId('document-detail')).toHaveTextContent(
      'Document doc-1'
    );
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<DocumentsWindow {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByTestId('close-window'));
    expect(onClose).toHaveBeenCalled();
  });

  it('refreshes documents when menu refresh is clicked', async () => {
    const user = userEvent.setup();
    render(<DocumentsWindow {...defaultProps} />);

    await user.click(screen.getByTestId('menu-refresh'));

    await screen.findByTestId('documents-content');
    expect(lastDocumentsProps?.['refreshToken']).toBe(1);
  });

  it('uploads files when file input changes', async () => {
    const user = userEvent.setup();
    render(<DocumentsWindow {...defaultProps} />);

    await user.click(screen.getByTestId('menu-upload'));

    const fileInput = screen.getByTestId('documents-file-input');
    const file = new File(['hello'], 'test.txt', { type: 'text/plain' });

    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(mockUploadFile).toHaveBeenCalledWith(file);
    });
  });

  it('shows upload errors when files fail to upload', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<DocumentsWindow {...defaultProps} />);

    const fileInput = screen.getByTestId('documents-file-input');
    const file = new File(['hello'], 'test.txt', { type: 'text/plain' });
    mockUploadFile.mockRejectedValueOnce(new Error('Upload failed'));

    fireEvent.change(fileInput, { target: { files: [file] } });

    expect(
      await screen.findByText('"test.txt": Upload failed')
    ).toBeInTheDocument();
    consoleSpy.mockRestore();
  });

  it('returns to documents list when detail back is clicked', async () => {
    const user = userEvent.setup();
    render(<DocumentsWindow {...defaultProps} />);

    await user.click(screen.getByTestId('select-document'));
    expect(screen.getByTestId('document-detail')).toBeInTheDocument();

    await user.click(screen.getByTestId('document-back'));
    expect(screen.getByTestId('documents-content')).toBeInTheDocument();
  });

  it('passes initialDimensions to FloatingWindow when provided', () => {
    const initialDimensions = { x: 120, y: 140, width: 700, height: 550 };
    render(
      <DocumentsWindow
        {...defaultProps}
        initialDimensions={initialDimensions}
      />
    );
    const window = screen.getByTestId('floating-window');
    const props = JSON.parse(window.dataset['props'] || '{}');
    expect(props.initialDimensions).toEqual(initialDimensions);
  });

  it('passes onDimensionsChange to FloatingWindow when provided', () => {
    const onDimensionsChange = vi.fn();
    render(
      <DocumentsWindow
        {...defaultProps}
        onDimensionsChange={onDimensionsChange}
      />
    );
    const window = screen.getByTestId('floating-window');
    const propKeys = JSON.parse(window.dataset['propsKeys'] || '[]');
    expect(propKeys).toContain('onDimensionsChange');
  });
});
