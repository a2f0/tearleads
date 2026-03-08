import { FileText, Loader2, Music, Pause, Play } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { Button } from '@/components/ui/button';
import type { FileCategory, FileInfo } from './fileDetailTypes';

const PdfViewer = lazy(() =>
  import('@/components/pdf').then((m) => ({ default: m.PdfViewer }))
);

interface FileDetailPreviewProps {
  category: FileCategory;
  documentData: Uint8Array | null;
  file: FileInfo;
  isCurrentlyPlaying: boolean;
  objectUrl: string | null;
  onPlayPause: () => void;
  textContent: string | null;
}

export function FileDetailPreview({
  category,
  documentData,
  file,
  isCurrentlyPlaying,
  objectUrl,
  onPlayPause,
  textContent
}: FileDetailPreviewProps) {
  if (category === 'image' && objectUrl) {
    return (
      <div className="flex-shrink-0 overflow-hidden rounded-lg border bg-muted">
        <img
          src={objectUrl}
          alt={file.name}
          className="mx-auto max-h-48 object-contain"
          data-testid="file-detail-image"
        />
      </div>
    );
  }

  if (category === 'video' && objectUrl) {
    return (
      <div className="flex-shrink-0 overflow-hidden rounded-lg border bg-muted p-2">
        <video
          src={objectUrl}
          controls
          playsInline
          className="mx-auto max-h-48 w-full rounded"
          data-testid="file-detail-video"
        >
          <track kind="captions" />
        </video>
      </div>
    );
  }

  if (category === 'audio' && objectUrl) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border bg-muted p-4">
        <Music className="h-12 w-12 text-muted-foreground" />
        <Button
          variant="outline"
          size="sm"
          onClick={onPlayPause}
          data-testid="file-detail-audio-play"
        >
          {isCurrentlyPlaying ? (
            <>
              <Pause className="mr-1 h-3 w-3" />
              Pause
            </>
          ) : (
            <>
              <Play className="mr-1 h-3 w-3" />
              Play
            </>
          )}
        </Button>
      </div>
    );
  }

  if (
    category === 'document' &&
    file.mimeType === 'application/pdf' &&
    documentData
  ) {
    return (
      <Suspense
        fallback={
          <div className="flex items-center justify-center gap-2 rounded-lg border bg-muted p-8 text-muted-foreground text-xs">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading viewer...
          </div>
        }
      >
        <div
          className="max-h-64 overflow-auto rounded-lg border"
          data-testid="file-detail-pdf"
        >
          <PdfViewer data={documentData} />
        </div>
      </Suspense>
    );
  }

  if (
    category === 'document' &&
    file.mimeType.startsWith('text/') &&
    textContent !== null
  ) {
    return (
      <div
        className="max-h-48 overflow-auto rounded-lg border bg-muted p-2"
        data-testid="file-detail-text"
      >
        <pre className="whitespace-pre-wrap break-words font-mono text-xs">
          {textContent}
        </pre>
      </div>
    );
  }

  if (category === 'unknown') {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border bg-muted p-4">
        <FileText className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground text-xs">Preview not available</p>
      </div>
    );
  }

  return null;
}
