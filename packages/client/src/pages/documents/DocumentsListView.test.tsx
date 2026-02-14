import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DocumentsListView } from './DocumentsListView';
import type { DocumentWithUrl } from './documentTypes';

// Mock useVirtualizer to simplify testing
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: vi.fn(({ count }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({
        index: i,
        start: i * 56,
        size: 56,
        key: i
      })),
    getTotalSize: () => count * 56,
    measureElement: vi.fn()
  }))
}));

const createMockDocument = (
  overrides: Partial<DocumentWithUrl> = {}
): DocumentWithUrl => ({
  id: 'doc-1',
  name: 'test-document.pdf',
  size: 1024,
  mimeType: 'application/pdf',
  uploadDate: new Date('2024-01-15'),
  storagePath: '/files/doc-1.pdf',
  thumbnailPath: null,
  deleted: false,
  thumbnailUrl: null,
  ...overrides
});

describe('DocumentsListView', () => {
  const defaultProps = {
    documents: [createMockDocument()],
    canShare: false,
    showDropzone: false,
    uploading: false,
    onDocumentClick: vi.fn(),
    onContextMenu: vi.fn(),
    onBlankSpaceContextMenu: vi.fn(),
    onDownload: vi.fn(),
    onShare: vi.fn(),
    onFilesSelected: vi.fn()
  };

  it('renders list with documents', () => {
    render(<DocumentsListView {...defaultProps} />);

    expect(screen.getByTestId('documents-list')).toBeInTheDocument();
    expect(screen.getByText('test-document.pdf')).toBeInTheDocument();
  });

  it('displays file size and date', () => {
    render(<DocumentsListView {...defaultProps} />);

    expect(screen.getByText(/1 KB/)).toBeInTheDocument();
    expect(screen.getByText(/2024/)).toBeInTheDocument();
  });

  it('calls onDocumentClick when document is clicked', async () => {
    const user = userEvent.setup();
    const onDocumentClick = vi.fn();

    render(
      <DocumentsListView {...defaultProps} onDocumentClick={onDocumentClick} />
    );

    await user.click(screen.getByText('test-document.pdf'));

    expect(onDocumentClick).toHaveBeenCalledWith(defaultProps.documents[0]);
  });

  it('calls onDownload when download button is clicked', async () => {
    const user = userEvent.setup();
    const onDownload = vi.fn();

    render(<DocumentsListView {...defaultProps} onDownload={onDownload} />);

    const downloadButton = screen.getByTitle('Download');
    await user.click(downloadButton);

    expect(onDownload).toHaveBeenCalled();
  });

  it('shows share button when canShare is true', () => {
    render(<DocumentsListView {...defaultProps} canShare={true} />);

    expect(screen.getByTitle('Share')).toBeInTheDocument();
  });

  it('hides share button when canShare is false', () => {
    render(<DocumentsListView {...defaultProps} canShare={false} />);

    expect(screen.queryByTitle('Share')).not.toBeInTheDocument();
  });

  it('shows dropzone when showDropzone is true', () => {
    render(<DocumentsListView {...defaultProps} showDropzone={true} />);

    // Dropzone is rendered with a label prop
    expect(screen.getByText(/PDF or text documents/i)).toBeInTheDocument();
  });

  it('hides dropzone when showDropzone is false', () => {
    render(<DocumentsListView {...defaultProps} showDropzone={false} />);

    expect(
      screen.queryByText(/PDF or text documents/i)
    ).not.toBeInTheDocument();
  });

  it('renders thumbnail when available', () => {
    const docWithThumbnail = createMockDocument({
      thumbnailUrl: 'blob:thumbnail-url'
    });

    render(
      <DocumentsListView {...defaultProps} documents={[docWithThumbnail]} />
    );

    const img = screen.getByAltText('Thumbnail for test-document.pdf');
    expect(img).toHaveAttribute('src', 'blob:thumbnail-url');
  });

  it('renders multiple documents', () => {
    const documents = [
      createMockDocument({ id: '1', name: 'first.pdf' }),
      createMockDocument({ id: '2', name: 'second.pdf' }),
      createMockDocument({ id: '3', name: 'third.pdf' })
    ];

    render(<DocumentsListView {...defaultProps} documents={documents} />);

    expect(screen.getByText('first.pdf')).toBeInTheDocument();
    expect(screen.getByText('second.pdf')).toBeInTheDocument();
    expect(screen.getByText('third.pdf')).toBeInTheDocument();
  });

  it('displays virtual list status', () => {
    const documents = [
      createMockDocument({ id: '1', name: 'doc1.pdf' }),
      createMockDocument({ id: '2', name: 'doc2.pdf' })
    ];

    render(<DocumentsListView {...defaultProps} documents={documents} />);

    // VirtualListStatus should show loaded count
    expect(screen.getByText(/2 documents/i)).toBeInTheDocument();
  });
});
