import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DocumentsTableView } from './DocumentsTableView';
import type { DocumentWithUrl } from './documentTypes';

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

describe('DocumentsTableView', () => {
  const defaultProps = {
    documents: [createMockDocument()],
    canShare: false,
    onDocumentClick: vi.fn(),
    onContextMenu: vi.fn(),
    onBlankSpaceContextMenu: vi.fn(),
    onDownload: vi.fn(),
    onShare: vi.fn()
  };

  it('renders table with documents', () => {
    render(<DocumentsTableView {...defaultProps} />);

    expect(screen.getByTestId('documents-table')).toBeInTheDocument();
    expect(screen.getByText('test-document.pdf')).toBeInTheDocument();
  });

  it('renders sortable headers', () => {
    render(<DocumentsTableView {...defaultProps} />);

    expect(screen.getByRole('button', { name: /Name/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Size/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Type/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Date/i })).toBeInTheDocument();
  });

  it('displays document type label', () => {
    render(<DocumentsTableView {...defaultProps} />);

    expect(screen.getByText('PDF')).toBeInTheDocument();
  });

  it('displays formatted file size', () => {
    render(<DocumentsTableView {...defaultProps} />);

    expect(screen.getByText('1 KB')).toBeInTheDocument();
  });

  it('displays formatted date', () => {
    render(<DocumentsTableView {...defaultProps} />);

    // Date format depends on locale, just check it exists
    expect(screen.getByText(/2024/)).toBeInTheDocument();
  });

  it('calls onDocumentClick when row is clicked', async () => {
    const user = userEvent.setup();
    const onDocumentClick = vi.fn();

    render(
      <DocumentsTableView {...defaultProps} onDocumentClick={onDocumentClick} />
    );

    const row = screen.getByText('test-document.pdf').closest('tr');
    expect(row).not.toBeNull();
    await user.click(row as HTMLElement);

    expect(onDocumentClick).toHaveBeenCalledWith(defaultProps.documents[0]);
  });

  it('calls onDownload when download button is clicked', async () => {
    const user = userEvent.setup();
    const onDownload = vi.fn();

    render(<DocumentsTableView {...defaultProps} onDownload={onDownload} />);

    const downloadButton = screen.getByTitle('Download');
    await user.click(downloadButton);

    expect(onDownload).toHaveBeenCalled();
  });

  it('shows share button when canShare is true', () => {
    render(<DocumentsTableView {...defaultProps} canShare={true} />);

    expect(screen.getByTitle('Share')).toBeInTheDocument();
  });

  it('hides share button when canShare is false', () => {
    render(<DocumentsTableView {...defaultProps} canShare={false} />);

    expect(screen.queryByTitle('Share')).not.toBeInTheDocument();
  });

  it('sorts documents by name when name header is clicked', async () => {
    const user = userEvent.setup();
    const documents = [
      createMockDocument({ id: '1', name: 'zebra.pdf' }),
      createMockDocument({ id: '2', name: 'alpha.pdf' })
    ];

    render(<DocumentsTableView {...defaultProps} documents={documents} />);

    await user.click(screen.getByRole('button', { name: /Name/i }));

    const rows = screen.getAllByRole('row').slice(1); // Skip header row
    expect(rows).toHaveLength(2);
    expect(
      within(rows[0] as HTMLElement).getByText('alpha.pdf')
    ).toBeInTheDocument();
    expect(
      within(rows[1] as HTMLElement).getByText('zebra.pdf')
    ).toBeInTheDocument();
  });

  it('toggles sort direction when same header is clicked twice', async () => {
    const user = userEvent.setup();
    const documents = [
      createMockDocument({ id: '1', name: 'zebra.pdf' }),
      createMockDocument({ id: '2', name: 'alpha.pdf' })
    ];

    render(<DocumentsTableView {...defaultProps} documents={documents} />);

    // First click - ascending
    await user.click(screen.getByRole('button', { name: /Name/i }));
    let rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(
      within(rows[0] as HTMLElement).getByText('alpha.pdf')
    ).toBeInTheDocument();

    // Second click - descending
    await user.click(screen.getByRole('button', { name: /Name/i }));
    rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(
      within(rows[0] as HTMLElement).getByText('zebra.pdf')
    ).toBeInTheDocument();
  });

  it('renders thumbnail when available', () => {
    const docWithThumbnail = createMockDocument({
      thumbnailUrl: 'blob:thumbnail-url'
    });

    render(
      <DocumentsTableView {...defaultProps} documents={[docWithThumbnail]} />
    );

    const img = screen.getByAltText('Thumbnail for test-document.pdf');
    expect(img).toHaveAttribute('src', 'blob:thumbnail-url');
  });
});
