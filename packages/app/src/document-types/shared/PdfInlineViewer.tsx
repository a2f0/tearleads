import {
  GlobalWorkerOptions,
  getDocument,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  EventBus,
  PDFLinkService,
  PDFViewer,
} from "pdfjs-dist/legacy/web/pdf_viewer.mjs";
import "pdfjs-dist/legacy/web/pdf_viewer.css";
import { useEffect, useRef, useState } from "react";
import {
  MiniAppButton,
  MiniAppStatus,
} from "../../components/mini-app/MiniAppLayout";

interface PdfInlineViewerProps {
  bytes: Uint8Array<ArrayBuffer>;
  fileName: string;
  onOpenExternal: (() => void) | null;
}

export default function PdfInlineViewer({
  bytes,
  fileName,
  onOpenExternal,
}: PdfInlineViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<PDFViewer | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    const pages = pagesRef.current;
    if (!container || !pages) return;

    let active = true;
    setError(null);
    setPageNumber(1);
    setPageCount(0);
    GlobalWorkerOptions.workerSrc = new URL(
      "/pdf.worker.js",
      window.location.href,
    ).href;

    const eventBus = new EventBus();
    const linkService = new PDFLinkService({ eventBus });
    const viewer = new PDFViewer({
      container,
      viewer: pages,
      eventBus,
      linkService,
    });
    viewerRef.current = viewer;
    linkService.setViewer(viewer);
    eventBus.on("pagesinit", () => {
      if (active) viewer.currentScaleValue = "page-width";
    });
    eventBus.on("pagechanging", (event: { pageNumber: number }) => {
      if (active) setPageNumber(event.pageNumber);
    });

    // PDF.js transfers the input buffer to its worker. Keep the BlobStore's
    // original bytes intact for a possible external-open action.
    const task = getDocument({ data: bytes.slice() });
    void task.promise
      .then((document) => {
        if (!active) return;
        setPageCount(document.numPages);
        viewer.setDocument(document);
        linkService.setDocument(document);
      })
      .catch(() => {
        if (active)
          setError("Couldn't display this PDF. You can still download it.");
      });

    return () => {
      active = false;
      viewerRef.current = null;
      void task.destroy();
    };
  }, [bytes]);

  const zoom = (factor: number) => {
    const viewer = viewerRef.current;
    if (viewer) {
      viewer.currentScale = Math.min(
        3,
        Math.max(0.5, viewer.currentScale * factor),
      );
    }
  };

  return (
    <section className="file-document-pdf-widget" aria-label={fileName}>
      <div className="file-document-pdf-toolbar">
        <span className="file-document-pdf-page-count">
          {pageCount ? `${pageNumber} / ${pageCount}` : "Loading PDF..."}
        </span>
        <MiniAppButton disabled={!pageCount} onClick={() => zoom(0.8)}>
          −
        </MiniAppButton>
        <MiniAppButton
          disabled={!pageCount}
          onClick={() => {
            const viewer = viewerRef.current;
            if (viewer) viewer.currentScaleValue = "page-width";
          }}
        >
          Fit width
        </MiniAppButton>
        <MiniAppButton disabled={!pageCount} onClick={() => zoom(1.25)}>
          +
        </MiniAppButton>
        {onOpenExternal ? (
          <MiniAppButton onClick={onOpenExternal}>
            Open externally
          </MiniAppButton>
        ) : null}
      </div>
      <div className="file-document-pdf-viewport">
        <div className="file-document-pdf-pages" ref={containerRef}>
          <div className="pdfViewer" ref={pagesRef} />
          {error ? <MiniAppStatus tone="error">{error}</MiniAppStatus> : null}
        </div>
      </div>
    </section>
  );
}
