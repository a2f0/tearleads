import "pdfjs-dist/legacy/web/pdf_viewer.css";
import {
  MiniAppButton,
  MiniAppInput,
  MiniAppStatus,
} from "../../components/mini-app/MiniAppLayout";
import { usePdfInlineViewer } from "./usePdfInlineViewer";

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
  const {
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
  } = usePdfInlineViewer(bytes);
  return (
    <section className="file-document-pdf-widget" aria-label={fileName}>
      <div className="file-document-pdf-toolbar">
        <span className="file-document-pdf-page-count">
          {pageCount
            ? `${pageNumber} / ${pageCount}`
            : error
              ? "PDF preview unavailable"
              : passwordPrompt
                ? "Password required"
                : "Loading PDF..."}
        </span>
        <MiniAppButton disabled={!pageCount} onClick={() => zoom(0.8)}>
          −
        </MiniAppButton>
        <MiniAppButton disabled={!pageCount} onClick={fitWidth}>
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
      {passwordPrompt ? (
        <form
          className="file-document-pdf-password"
          onSubmit={(event) => {
            event.preventDefault();
            const value = password;
            setPassword("");
            passwordPrompt.submit(value);
          }}
        >
          <span className="file-document-pdf-password-message">
            {passwordPrompt.incorrect
              ? "Incorrect PDF password. Try again."
              : "This PDF requires a password."}
          </span>
          <MiniAppInput
            aria-label="PDF password"
            autoComplete="off"
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
          <MiniAppButton type="submit">Unlock</MiniAppButton>
          <MiniAppButton onClick={passwordPrompt.cancel}>Cancel</MiniAppButton>
        </form>
      ) : null}
      <div className="file-document-pdf-viewport">
        <div className="file-document-pdf-pages" ref={containerRef}>
          <div className="pdfViewer" ref={pagesRef} />
          {error ? <MiniAppStatus tone="error">{error}</MiniAppStatus> : null}
        </div>
      </div>
    </section>
  );
}
