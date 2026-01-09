import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  ZoomIn,
  ZoomOut
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { Button } from '@/components/ui/button';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const SCALE_STEP = 0.25;

interface PdfViewerProps {
  data: Uint8Array;
  className?: string;
}

export function PdfViewer({ data, className }: PdfViewerProps) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const pdfUrl = useMemo(() => {
    const buffer = new ArrayBuffer(data.byteLength);
    new Uint8Array(buffer).set(data);
    const blob = new Blob([buffer], { type: 'application/pdf' });
    return URL.createObjectURL(blob);
  }, [data]);

  useEffect(() => {
    return () => {
      URL.revokeObjectURL(pdfUrl);
    };
  }, [pdfUrl]);

  const onDocumentLoadSuccess = useCallback(
    ({ numPages: pages }: { numPages: number }) => {
      setNumPages(pages);
      setLoading(false);
      setError(null);
    },
    []
  );

  const onDocumentLoadError = useCallback((err: Error) => {
    setError(err.message || 'Failed to load PDF');
    setLoading(false);
  }, []);

  const goToPreviousPage = useCallback(() => {
    setPageNumber((prev) => Math.max(1, prev - 1));
  }, []);

  const goToNextPage = useCallback(() => {
    setPageNumber((prev) => Math.min(numPages ?? prev, prev + 1));
  }, [numPages]);

  const zoomIn = useCallback(() => {
    setScale((prev) => Math.min(MAX_SCALE, prev + SCALE_STEP));
  }, []);

  const zoomOut = useCallback(() => {
    setScale((prev) => Math.max(MIN_SCALE, prev - SCALE_STEP));
  }, []);

  if (error) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-destructive bg-destructive/10 p-8 text-destructive text-sm"
        data-testid="pdf-error"
      >
        {error}
      </div>
    );
  }

  return (
    <div className={className} data-testid="pdf-viewer">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={goToPreviousPage}
            disabled={pageNumber <= 1}
            aria-label="Previous page"
            data-testid="pdf-prev-page"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span
            className="min-w-[100px] text-center text-sm"
            data-testid="pdf-page-info"
          >
            {loading ? (
              'Loading...'
            ) : (
              <>
                Page {pageNumber} of {numPages}
              </>
            )}
          </span>
          <Button
            variant="outline"
            size="icon"
            onClick={goToNextPage}
            disabled={pageNumber >= (numPages ?? 1)}
            aria-label="Next page"
            data-testid="pdf-next-page"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={zoomOut}
            disabled={scale <= MIN_SCALE}
            aria-label="Zoom out"
            data-testid="pdf-zoom-out"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span
            className="min-w-[60px] text-center text-sm"
            data-testid="pdf-zoom-level"
          >
            {Math.round(scale * 100)}%
          </span>
          <Button
            variant="outline"
            size="icon"
            onClick={zoomIn}
            disabled={scale >= MAX_SCALE}
            aria-label="Zoom in"
            data-testid="pdf-zoom-in"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div
        className="overflow-auto rounded-lg border bg-muted"
        style={{ touchAction: 'pan-x pan-y pinch-zoom' }}
        data-testid="pdf-container"
      >
        <Document
          file={pdfUrl}
          onLoadSuccess={onDocumentLoadSuccess}
          onLoadError={onDocumentLoadError}
          loading={
            <div className="flex items-center justify-center gap-2 p-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading PDF...
            </div>
          }
        >
          <Page
            pageNumber={pageNumber}
            scale={scale}
            className="mx-auto"
            renderTextLayer={true}
            renderAnnotationLayer={true}
            loading={
              <div className="flex items-center justify-center gap-2 p-12 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                Loading page...
              </div>
            }
          />
        </Document>
      </div>
    </div>
  );
}
