import { ArrowsInSimpleIcon } from "@phosphor-icons/react/dist/csr/ArrowsInSimple";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { MagnifyingGlassMinusIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlassMinus";
import { MagnifyingGlassPlusIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlassPlus";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { type ReactNode, type RefObject, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useCurrentWindow } from "../../window/CurrentWindowContext";
import "./MiniAppImageViewer.css";
import { useImageViewerState } from "./useImageViewerState";

const IMAGE_VIEWER_LABELS = {
  close: "Close",
  download: "Download",
  error: "Could not display this image.",
  fit: "Fit to screen",
  stage: "Image: drag to pan, pinch or double-tap to zoom",
  toolbar: "Image viewer toolbar",
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
} as const;

function ImageViewerButton(params: {
  buttonRef?: RefObject<HTMLButtonElement | null> | undefined;
  children: ReactNode;
  disabled?: boolean | undefined;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={params.label}
      className="mini-app-image-viewer-button"
      disabled={params.disabled ?? false}
      ref={params.buttonRef}
      title={params.label}
      type="button"
      onClick={params.onClick}
    >
      {params.children}
    </button>
  );
}

function ImageViewerChrome(params: {
  canZoomIn: boolean;
  closeButtonRef: RefObject<HTMLButtonElement | null>;
  isZoomed: boolean;
  onClose: () => void;
  onDownload?: (() => void) | undefined;
  onReset: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
}) {
  const { onDownload } = params;

  return (
    <div className="mini-app-image-viewer-chrome">
      <div
        aria-label={IMAGE_VIEWER_LABELS.toolbar}
        className="mini-app-image-viewer-toolbar"
        role="toolbar"
      >
        <ImageViewerButton
          disabled={!params.isZoomed}
          label={IMAGE_VIEWER_LABELS.zoomOut}
          onClick={params.onZoomOut}
        >
          <MagnifyingGlassMinusIcon aria-hidden size={18} />
        </ImageViewerButton>
        <ImageViewerButton
          disabled={!params.canZoomIn}
          label={IMAGE_VIEWER_LABELS.zoomIn}
          onClick={params.onZoomIn}
        >
          <MagnifyingGlassPlusIcon aria-hidden size={18} />
        </ImageViewerButton>
        <ImageViewerButton
          disabled={!params.isZoomed}
          label={IMAGE_VIEWER_LABELS.fit}
          onClick={params.onReset}
        >
          <ArrowsInSimpleIcon aria-hidden size={18} />
        </ImageViewerButton>
        {onDownload ? (
          <ImageViewerButton
            label={IMAGE_VIEWER_LABELS.download}
            onClick={onDownload}
          >
            <DownloadSimpleIcon aria-hidden size={18} />
          </ImageViewerButton>
        ) : null}
        <ImageViewerButton
          buttonRef={params.closeButtonRef}
          label={IMAGE_VIEWER_LABELS.close}
          onClick={params.onClose}
        >
          <XIcon aria-hidden size={18} />
        </ImageViewerButton>
      </div>
    </div>
  );
}

// Escape closes, and focus moves into the overlay on open and back to whatever
// opened it on close, so keyboard focus is never dropped to the document body.
function useImageViewerDismissal(params: {
  closeButtonRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  viewerRef: RefObject<HTMLDivElement | null>;
}) {
  const { closeButtonRef, onClose, viewerRef } = params;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        event.key === "Escape" &&
        viewerRef.current?.contains(document.activeElement)
      ) {
        event.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, viewerRef]);

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    closeButtonRef.current?.focus();
    return () => {
      if (previouslyFocused instanceof HTMLElement) {
        previouslyFocused.focus();
      }
    };
  }, [closeButtonRef]);
}

/**
 * A full-screen look at one image: the picture, a toolbar, and nothing else.
 *
 * It exists because an inline preview cannot be inspected on a phone — there is
 * no room, and no way in. Here the image fills the screen and pinch, wheel,
 * drag, and double-tap zoom and pan it (see {@link useImageViewerState}).
 *
 * Routed layouts portal into <body> and fill the viewport. A desktop window's
 * content pane instead becomes the portal host so the viewer leaves the window
 * chrome and sidebar available. The stage takes `touch-action: none` so the
 * browser hands the pinch to the viewer instead of page-zooming behind it.
 */
export function MiniAppImageViewer(params: {
  label: string;
  onClose: () => void;
  onDownload?: (() => void) | undefined;
  url: string;
}) {
  const viewer = useImageViewerState();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const currentWindow = useCurrentWindow();
  const portalHost = currentWindow?.overlayHost ?? document.body;
  const isWindowed = portalHost !== document.body;

  useImageViewerDismissal({
    closeButtonRef,
    onClose: params.onClose,
    viewerRef,
  });

  return createPortal(
    <div
      aria-label={params.label}
      aria-modal={isWindowed ? undefined : "true"}
      className={`mini-app-image-viewer${isWindowed ? " mini-app-image-viewer--windowed" : ""}`}
      onPointerDownCapture={() =>
        viewerRef.current?.focus({ preventScroll: true })
      }
      ref={viewerRef}
      role="dialog"
      tabIndex={-1}
    >
      <ImageViewerChrome
        canZoomIn={viewer.canZoomIn}
        closeButtonRef={closeButtonRef}
        isZoomed={viewer.isZoomed}
        onClose={params.onClose}
        onDownload={params.onDownload}
        onReset={viewer.reset}
        onZoomIn={viewer.zoomIn}
        onZoomOut={viewer.zoomOut}
      />
      {/* The stage runs its own pointer interaction model rather than exposing
          discrete controls, which is what role="application" announces — the
          same role the app's panes use for their custom surfaces. */}
      <div
        aria-label={IMAGE_VIEWER_LABELS.stage}
        className="mini-app-image-viewer-stage"
        ref={viewer.stageRef}
        role="application"
        {...viewer.pointerHandlers}
      >
        {viewer.hasError ? (
          <p className="mini-app-image-viewer-error">
            {IMAGE_VIEWER_LABELS.error}
          </p>
        ) : (
          <img
            alt={params.label}
            className="mini-app-image-viewer-image"
            draggable={false}
            onError={viewer.handleImageError}
            onLoad={viewer.handleImageLoad}
            src={params.url}
            style={{ transform: viewer.transform }}
          />
        )}
      </div>
    </div>,
    portalHost,
  );
}
