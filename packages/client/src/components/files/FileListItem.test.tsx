import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FileListItem, type FileWithThumbnail } from './FileListItem';

const createMockFile = (
  overrides: Partial<FileWithThumbnail> = {}
): FileWithThumbnail => ({
  id: 'test-file-1',
  name: 'test-document.pdf',
  size: 1024,
  mimeType: 'application/pdf',
  uploadDate: new Date('2024-01-15'),
  storagePath: '/files/test-document.pdf',
  thumbnailPath: null,
  deleted: false,
  thumbnailUrl: null,
  ...overrides
});

describe('FileListItem', () => {
  const defaultProps = {
    file: createMockFile(),
    isRecentlyUploaded: false,
    onView: vi.fn(),
    onDownload: vi.fn(),
    onDelete: vi.fn(),
    onRestore: vi.fn(),
    onContextMenu: vi.fn(),
    onClearRecentlyUploaded: vi.fn()
  };

  it('renders file name and size', () => {
    render(<FileListItem {...defaultProps} />);

    expect(screen.getByText('test-document.pdf')).toBeInTheDocument();
    expect(screen.getByText(/1 KB/)).toBeInTheDocument();
  });

  it('renders thumbnail when available', () => {
    const fileWithThumbnail = createMockFile({
      thumbnailUrl: 'blob:http://localhost/thumb-123'
    });

    const { container } = render(
      <FileListItem {...defaultProps} file={fileWithThumbnail} />
    );

    const img = container.querySelector('img');
    expect(img).toHaveAttribute('src', 'blob:http://localhost/thumb-123');
  });

  it('calls onView when clicking viewable file', async () => {
    const user = userEvent.setup();
    const onView = vi.fn();

    render(<FileListItem {...defaultProps} onView={onView} />);

    await user.click(
      screen.getByRole('button', { name: /test-document.pdf/i })
    );

    expect(onView).toHaveBeenCalledTimes(1);
  });

  it('does not render clickable button for non-viewable file types', () => {
    const genericFile = createMockFile({
      mimeType: 'application/octet-stream',
      name: 'data.bin'
    });

    render(<FileListItem {...defaultProps} file={genericFile} />);

    expect(
      screen.queryByRole('button', { name: /data.bin/i })
    ).not.toBeInTheDocument();
    expect(screen.getByText('data.bin')).toBeInTheDocument();
  });

  it('calls onDownload when download button clicked', async () => {
    const user = userEvent.setup();
    const onDownload = vi.fn();

    render(<FileListItem {...defaultProps} onDownload={onDownload} />);

    await user.click(screen.getByTitle('Download'));

    expect(onDownload).toHaveBeenCalledTimes(1);
  });

  it('calls onDelete when delete button clicked', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();

    render(<FileListItem {...defaultProps} onDelete={onDelete} />);

    await user.click(screen.getByTitle('Delete'));

    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('renders restore button for deleted files', () => {
    const deletedFile = createMockFile({ deleted: true });

    render(<FileListItem {...defaultProps} file={deletedFile} />);

    expect(screen.getByTitle('Restore')).toBeInTheDocument();
    expect(screen.queryByTitle('Download')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Delete')).not.toBeInTheDocument();
  });

  it('calls onRestore when restore button clicked', async () => {
    const user = userEvent.setup();
    const onRestore = vi.fn();
    const deletedFile = createMockFile({ deleted: true });

    render(
      <FileListItem
        {...defaultProps}
        file={deletedFile}
        onRestore={onRestore}
      />
    );

    await user.click(screen.getByTitle('Restore'));

    expect(onRestore).toHaveBeenCalledTimes(1);
  });

  it('shows recently uploaded badge when file was just uploaded', () => {
    render(<FileListItem {...defaultProps} isRecentlyUploaded />);

    expect(screen.getByTestId('upload-success-badge')).toBeInTheDocument();
  });

  it('calls onClearRecentlyUploaded when badge clicked', async () => {
    const user = userEvent.setup();
    const onClearRecentlyUploaded = vi.fn();

    render(
      <FileListItem
        {...defaultProps}
        isRecentlyUploaded
        onClearRecentlyUploaded={onClearRecentlyUploaded}
      />
    );

    await user.click(screen.getByTestId('upload-success-badge'));

    expect(onClearRecentlyUploaded).toHaveBeenCalledTimes(1);
  });

  it('applies strikethrough to deleted file names', () => {
    const deletedFile = createMockFile({ deleted: true });

    render(<FileListItem {...defaultProps} file={deletedFile} />);

    expect(screen.getByText('test-document.pdf')).toHaveClass('line-through');
  });

  it('shows "Deleted" label for deleted files', () => {
    const deletedFile = createMockFile({ deleted: true });

    render(<FileListItem {...defaultProps} file={deletedFile} />);

    expect(screen.getByText(/Deleted/)).toBeInTheDocument();
  });

  it('renders audio icon for audio files without thumbnail', () => {
    const audioFile = createMockFile({
      mimeType: 'audio/mp3',
      name: 'song.mp3'
    });

    const { container } = render(
      <FileListItem {...defaultProps} file={audioFile} />
    );

    expect(container.querySelector('.lucide-music')).toBeInTheDocument();
  });

  it('renders pdf icon for PDF files without thumbnail', () => {
    const pdfFile = createMockFile({
      mimeType: 'application/pdf',
      name: 'document.pdf'
    });

    const { container } = render(
      <FileListItem {...defaultProps} file={pdfFile} />
    );

    expect(container.querySelector('.lucide-file-text')).toBeInTheDocument();
  });

  it('triggers onContextMenu when right-clicked', async () => {
    const user = userEvent.setup();
    const onContextMenu = vi.fn();

    render(<FileListItem {...defaultProps} onContextMenu={onContextMenu} />);

    const row = screen
      .getByText('test-document.pdf')
      .closest('[class*="flex"]');
    if (row) {
      await user.pointer({ target: row, keys: '[MouseRight]' });
    }

    expect(onContextMenu).toHaveBeenCalled();
  });

  it('is clickable for image files', async () => {
    const user = userEvent.setup();
    const onView = vi.fn();
    const imageFile = createMockFile({
      mimeType: 'image/jpeg',
      name: 'photo.jpg'
    });

    render(<FileListItem {...defaultProps} file={imageFile} onView={onView} />);

    await user.click(screen.getByRole('button', { name: /photo.jpg/i }));

    expect(onView).toHaveBeenCalledTimes(1);
  });

  it('is clickable for video files', async () => {
    const user = userEvent.setup();
    const onView = vi.fn();
    const videoFile = createMockFile({
      mimeType: 'video/mp4',
      name: 'movie.mp4'
    });

    render(<FileListItem {...defaultProps} file={videoFile} onView={onView} />);

    await user.click(screen.getByRole('button', { name: /movie.mp4/i }));

    expect(onView).toHaveBeenCalledTimes(1);
  });

  it('is clickable for audio files', async () => {
    const user = userEvent.setup();
    const onView = vi.fn();
    const audioFile = createMockFile({
      mimeType: 'audio/mp3',
      name: 'song.mp3'
    });

    render(<FileListItem {...defaultProps} file={audioFile} onView={onView} />);

    await user.click(screen.getByRole('button', { name: /song.mp3/i }));

    expect(onView).toHaveBeenCalledTimes(1);
  });

  it('is not clickable when file is deleted', () => {
    const deletedFile = createMockFile({
      deleted: true,
      mimeType: 'application/pdf'
    });

    render(<FileListItem {...defaultProps} file={deletedFile} />);

    expect(
      screen.queryByRole('button', { name: /test-document.pdf/i })
    ).not.toBeInTheDocument();
  });
});
