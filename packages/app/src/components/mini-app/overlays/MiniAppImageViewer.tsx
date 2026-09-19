import { ArrowsInSimpleIcon } from "@phosphor-icons/react/dist/csr/ArrowsInSimple";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { MagnifyingGlassMinusIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlassMinus";
import { MagnifyingGlassPlusIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlassPlus";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import { useRoutedPaneOverlayHost } from "../../layout/routed/RoutedPaneOverlayHost";
import { classNames } from "../../shared/classNames";
import {
  useCurrentWindow,
  useSuppressWindowToolbar,
} from "../../window/CurrentWindowContext";
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
  host: HTMLElement;
  onClose: () => void;
  viewerRef: RefObject<HTMLDivElement | null>;
}) {
  const { closeButtonRef, host, onClose, viewerRef } = params;

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

  // A layout effect, and declared before the toolbar suppression below so it runs
  // first: the control that opened this viewer may be a window toolbar action the
  // suppression is about to unmount, and reading `activeElement` after that would
  // record <body> instead of the opener.
  useLayoutEffect(() => {
    const previouslyFocused = document.activeElement;
    closeButtonRef.current?.focus();
    return () => {
      // The opener may have been unmounted while the viewer covered it — a
      // suppressed toolbar action, or a row the host re-rendered away. Focusing a
      // detached node silently drops focus to the document body, and Tab would
      // then resume from the top of the page; land in the host pane instead so
      // focus stays where the overlay was.
      if (
        previouslyFocused instanceof HTMLElement &&
        previouslyFocused.isConnected
      ) {
        previouslyFocused.focus();
        return;
      }
      host.focus();
    };
  }, [closeButtonRef, host]);
}

/**
 * Which surface a viewer opened on. `screen` is the whole viewport (<body>);
 * the other two confine it to a pane that keeps its chrome beside it.
 */
type ImageViewerHostKind = "window" | "pane" | "screen";

interface ImageViewerHost {
  element: HTMLElement;
  kind: ImageViewerHostKind;
}

// One stable key per host element, so the surface below is keyed on the host's
// identity rather than on its kind — two different elements of the same kind
// must still rebuild it. A WeakMap keeps the lookup idempotent across re-renders
// and lets a detached host be collected with its key.
const imageViewerHostKeys = new WeakMap<HTMLElement, string>();
let nextImageViewerHostKey = 0;

function imageViewerHostKey(element: HTMLElement): string {
  const existing = imageViewerHostKeys.get(element);
  if (existing !== undefined) {
    return existing;
  }
  nextImageViewerHostKey += 1;
  const key = `image-viewer-host-${nextImageViewerHostKey}`;
  imageViewerHostKeys.set(element, key);
  return key;
}

// Ordered by how much else is on screen worth keeping: a desktop window's own
// content pane first, then the routed tablet shell's, then the viewport.
function resolveImageViewerHost(params: {
  routedPaneHost: HTMLElement | null;
  windowHost: HTMLElement | null;
}): ImageViewerHost {
  if (params.windowHost) {
    return { element: params.windowHost, kind: "window" };
  }
  if (params.routedPaneHost) {
    return { element: params.routedPaneHost, kind: "pane" };
  }
  return { element: document.body, kind: "screen" };
}

interface MiniAppImageViewerProps {
  label: string;
  onClose: () => void;
  onDownload?: (() => void) | undefined;
  url: string;
}

function ImageViewerSurface(
  params: MiniAppImageViewerProps & { host: ImageViewerHost },
) {
  const viewer = useImageViewerState();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const { host } = params;
  const portalHost = host.element;
  const isWindowed = host.kind === "window";
  const fillsRoutedPane = host.kind === "pane";

  useImageViewerDismissal({
    closeButtonRef,
    host: portalHost,
    onClose: params.onClose,
    viewerRef,
  });
  // The viewer covers the window's content pane and carries the zoom controls,
  // so the window's own toolbar row stands down while it is open.
  useSuppressWindowToolbar(isWindowed);

  return createPortal(
    <div
      aria-label={params.label}
      aria-modal={isWindowed ? undefined : "true"}
      className={classNames(
        "mini-app-image-viewer",
        isWindowed && "mini-app-image-viewer--windowed",
        fillsRoutedPane && "mini-app-image-viewer--pane",
      )}
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

/**
 * An uninterrupted look at one image: the picture, a toolbar, and nothing else.
 *
 * It exists because an inline preview cannot be inspected on a phone — there is
 * no room, and no way in. Here the image takes the whole surface and pinch,
 * wheel, drag, and double-tap zoom and pan it (see {@link useImageViewerState}).
 *
 * Where it opens follows how much else is on screen worth keeping:
 *
 * - A desktop window's content pane becomes the portal host, so the viewer
 *   leaves the window frame and sidebar available; that window's toolbar row
 *   stands down while the viewer is open, since the toolbar below carries the
 *   same surface's controls.
 * - The routed tablet/iPad shell is a multi-pane surface too — a nav rail and
 *   often a tree sidebar sit beside the content — so there the main content pane
 *   hosts it, the same pane the note attachment preview fills.
 * - A phone has nothing beside the content to preserve and the least room to
 *   spare, so it keeps <body> and the whole viewport. That is the case this
 *   viewer exists for: an inline preview cannot be inspected at that size.
 *
 * Both routed cases are `aria-modal`: each paints over the content beneath it —
 * the pane's own note editor or blob list — and nothing marks that content
 * inert, so a screen reader would otherwise still reach what the viewer hides.
 * The chrome outside the pane staying operable is not the test; what the dialog
 * covers is. The windowed case keeps its long-standing omission, where the
 * window's own semantics carry it.
 *
 * The stage takes `touch-action: none` so the browser hands the pinch to the
 * viewer instead of page-zooming behind it.
 */
export function MiniAppImageViewer(params: MiniAppImageViewerProps) {
  const currentWindow = useCurrentWindow();
  const routedPane = useRoutedPaneOverlayHost();
  const host = resolveImageViewerHost({
    routedPaneHost: routedPane.tier === "tablet" ? routedPane.host : null,
    windowHost: currentWindow?.overlayHost ?? null,
  });

  // Keyed on the host element so a move rebuilds the surface rather than
  // relocating it. The stage's ResizeObserver and wheel listener bind once to
  // the node behind `stageRef` (see useImageViewerState); moving a portal
  // remounts that node, and without this remount they would stay on the
  // detached one — the measured viewport would latch at 0x0 and the zoom clamp
  // would run against an empty box. Two moves are reachable: crossing the 760px
  // tier line with the viewer open (a phone turned to landscape), and the first
  // frame of a routed shell whose pane element has not reached context yet.
  //
  // The rebuild refits the picture, dropping any zoom and pan. That is the
  // deliberate trade for not rewiring the shared gesture hook onto a
  // state-backed stage node: the moves above are rare, and both already change
  // the box the view is clamped to.
  return (
    <ImageViewerSurface
      key={imageViewerHostKey(host.element)}
      {...params}
      host={host}
    />
  );
}
