import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FileDetailPreview } from './FileDetailPreview';

vi.mock('@/components/pdf', () => ({
  PdfViewer: ({ data }: { data: Uint8Array }) => (
    <div data-testid="pdf-viewer">PDF ({data.byteLength})</div>
  )
}));

const baseFile = {
  id: 'file-1',
  name: 'sample-file',
  size: 1024,
  uploadDate: new Date('2024-01-01'),
  storagePath: '/files/sample'
};

describe('FileDetailPreview', () => {
  it('renders image preview', () => {
    render(
      <FileDetailPreview
        category="image"
        documentData={null}
        file={{ ...baseFile, mimeType: 'image/jpeg', name: 'image.jpg' }}
        isCurrentlyPlaying={false}
        objectUrl="blob:image"
        onPlayPause={vi.fn()}
        textContent={null}
      />
    );

    expect(screen.getByTestId('file-detail-image')).toBeInTheDocument();
  });

  it('renders video preview', () => {
    render(
      <FileDetailPreview
        category="video"
        documentData={null}
        file={{ ...baseFile, mimeType: 'video/mp4', name: 'video.mp4' }}
        isCurrentlyPlaying={false}
        objectUrl="blob:video"
        onPlayPause={vi.fn()}
        textContent={null}
      />
    );

    expect(screen.getByTestId('file-detail-video')).toBeInTheDocument();
  });

  it('renders audio controls and calls onPlayPause', async () => {
    const user = userEvent.setup();
    const onPlayPause = vi.fn();

    render(
      <FileDetailPreview
        category="audio"
        documentData={null}
        file={{ ...baseFile, mimeType: 'audio/mpeg', name: 'audio.mp3' }}
        isCurrentlyPlaying={false}
        objectUrl="blob:audio"
        onPlayPause={onPlayPause}
        textContent={null}
      />
    );

    await user.click(screen.getByTestId('file-detail-audio-play'));

    expect(onPlayPause).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Play')).toBeInTheDocument();
  });

  it('renders text preview for text documents', () => {
    render(
      <FileDetailPreview
        category="document"
        documentData={null}
        file={{ ...baseFile, mimeType: 'text/plain', name: 'notes.txt' }}
        isCurrentlyPlaying={false}
        objectUrl={null}
        onPlayPause={vi.fn()}
        textContent="hello world"
      />
    );

    expect(screen.getByTestId('file-detail-text')).toBeInTheDocument();
    expect(screen.getByText('hello world')).toBeInTheDocument();
  });

  it('renders unknown fallback', () => {
    render(
      <FileDetailPreview
        category="unknown"
        documentData={null}
        file={{ ...baseFile, mimeType: 'application/octet-stream' }}
        isCurrentlyPlaying={false}
        objectUrl={null}
        onPlayPause={vi.fn()}
        textContent={null}
      />
    );

    expect(screen.getByText('Preview not available')).toBeInTheDocument();
  });
});
