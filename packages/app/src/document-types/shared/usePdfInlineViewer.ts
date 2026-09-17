import {
  AnnotationMode,
  GlobalWorkerOptions,
  getDocument,
  PasswordResponses,
  version,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  EventBus,
  PDFLinkService,
  PDFViewer,
} from "pdfjs-dist/legacy/web/pdf_viewer.mjs";
import { useEffect, useRef, useState } from "react";

interface PasswordPrompt {
  cancel: () => void;
  incorrect: boolean;
  submit: (password: string) => void;
}

export function usePdfInlineViewer(bytes: Uint8Array<ArrayBuffer>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<PDFViewer | null>(null);
  const fitWidthRef = useRef(true);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [passwordPrompt, setPasswordPrompt] = useState<PasswordPrompt | null>(
    null,
  );

  useEffect(() => {
    const container = containerRef.current;
    const pages = pagesRef.current;
    if (!container || !pages) return;
    setError(null);
    setPageNumber(1);
    setPageCount(0);
    setPassword("");
    setPasswordPrompt(null);
    fitWidthRef.current = true;
    return startPdfViewer({
      bytes,
      container,
      pages,
      fitWidthRef,
      viewerRef,
      setError,
      setPageNumber,
      setPageCount,
      setPassword,
      setPasswordPrompt,
    });
  }, [bytes]);

  const zoom = (factor: number) => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    fitWidthRef.current = false;
    viewer.currentScale = Math.min(
      3,
      Math.max(0.5, viewer.currentScale * factor),
    );
  };
  const fitWidth = () => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    fitWidthRef.current = true;
    viewer.currentScaleValue = "page-width";
  };
  return {
    containerRef,
    pagesRef,
    pageNumber,
    pageCount,
    error,
    password,
    setPassword,
    passwordPrompt,
    zoom,
    fitWidth,
  };
}

interface ViewerSetup {
  bytes: Uint8Array<ArrayBuffer>;
  container: HTMLDivElement;
  pages: HTMLDivElement;
  fitWidthRef: { current: boolean };
  viewerRef: { current: PDFViewer | null };
  setError: (value: string | null) => void;
  setPageNumber: (value: number) => void;
  setPageCount: (value: number) => void;
  setPassword: (value: string) => void;
  setPasswordPrompt: (value: PasswordPrompt | null) => void;
}

function startPdfViewer(setup: ViewerSetup) {
  const {
    bytes,
    container,
    pages,
    fitWidthRef,
    viewerRef,
    setError,
    setPageNumber,
    setPageCount,
    setPassword,
    setPasswordPrompt,
  } = setup;
  let active = true;
  const assetBase = new URL(`/pdfjs/${version}/`, window.location.href);
  GlobalWorkerOptions.workerSrc = new URL("pdf.worker.js", assetBase).href;
  const eventBus = new EventBus();
  const linkService = new PDFLinkService({ eventBus });
  const viewer = new PDFViewer({
    container,
    viewer: pages,
    eventBus,
    linkService,
    // Downloads export original BlobStore bytes, so forms are read-only here.
    annotationMode: AnnotationMode.ENABLE,
  });
  viewerRef.current = viewer;
  linkService.setViewer(viewer);
  const handlePagesInit = () => {
    if (active) viewer.currentScaleValue = "page-width";
  };
  const handlePageChanging = (event: { pageNumber: number }) => {
    if (active) setPageNumber(event.pageNumber);
  };
  eventBus.on("pagesinit", handlePagesInit);
  eventBus.on("pagechanging", handlePageChanging);
  const resizeObserver = new ResizeObserver(() => {
    if (active && fitWidthRef.current && viewer.pdfDocument) {
      viewer.currentScaleValue = "page-width";
    }
  });
  resizeObserver.observe(container);
  // PDF.js transfers its input buffer; preserve the BlobStore copy.
  const task = getDocument({
    data: bytes.slice(),
    cMapUrl: new URL("cmaps/", assetBase).href,
    cMapPacked: true,
    standardFontDataUrl: new URL("standard_fonts/", assetBase).href,
    wasmUrl: new URL("wasm/", assetBase).href,
  });
  task.onPassword = (submit: (value: string) => void, reason: number) => {
    if (!active) return;
    setPassword("");
    setPasswordPrompt({
      submit,
      incorrect: reason === PasswordResponses.INCORRECT_PASSWORD,
      cancel: () => {
        active = false;
        setPasswordPrompt(null);
        setError("PDF preview cancelled.");
        void task.destroy();
      },
    });
  };
  void task.promise
    .then((document) => {
      if (!active) return;
      setPasswordPrompt(null);
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
    resizeObserver.disconnect();
    eventBus.off("pagesinit", handlePagesInit);
    eventBus.off("pagechanging", handlePageChanging);
    viewer.cleanup();
    // PDF.js accepts null to detach a document; its declaration omits it.
    Reflect.apply(viewer.setDocument, viewer, [null]);
    linkService.setDocument(null);
    void task.destroy();
  };
}
