import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  projectLabel,
  type ScreenshotEntry,
  screenLabel,
  themeLabel,
} from "./screenshotsManifest";

// The frame's 1px border on each side sits outside the image.
const FRAME_BORDER = 2;

// Measure the stage's content box so the image can be capped in pixels. A CSS
// `max-height: 100%` chain cannot do this: the frame is a centered (not
// stretched) flex item, so its height is never definite and the image's
// percentage max-height resolves to none, letting a height-limited screenshot
// overflow into the nav row (or get cropped by the frame's overflow: hidden).
function useStageFit() {
  const stageRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ width: number; height: number }>();

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }
    const observer = new ResizeObserver(() => {
      const style = getComputedStyle(stage);
      setFit({
        width:
          stage.clientWidth -
          Number.parseFloat(style.paddingLeft) -
          Number.parseFloat(style.paddingRight),
        height:
          stage.clientHeight -
          Number.parseFloat(style.paddingTop) -
          Number.parseFloat(style.paddingBottom),
      });
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  return { stageRef, fit };
}

// Size the image from its recorded pixel dimensions, scaled down to fit the
// stage, so the frame holds its final size while the capture loads and the
// layout doesn't jump between screens. Never scales up.
function fitImage(
  fit: { width: number; height: number } | undefined,
  entry: ScreenshotEntry | undefined,
) {
  if (!fit) {
    return undefined;
  }
  const maxWidth = Math.max(0, fit.width - FRAME_BORDER);
  const maxHeight = Math.max(0, fit.height - FRAME_BORDER);
  if (!entry?.width || !entry.height) {
    return { maxWidth, maxHeight };
  }
  const scale = Math.min(maxWidth / entry.width, maxHeight / entry.height, 1);
  return {
    width: Math.floor(entry.width * scale),
    height: Math.floor(entry.height * scale),
  };
}

export function Stage({
  project,
  theme,
  name,
  entry,
}: {
  project: string;
  theme: string;
  name: string | undefined;
  entry: ScreenshotEntry | undefined;
}) {
  const [expanded, setExpanded] = useState(false);
  const zoomRef = useRef<HTMLButtonElement>(null);
  const { stageRef, fit } = useStageFit();
  const imageStyle = fitImage(fit, entry);
  const screen = name ? screenLabel(name) : "this screen";
  const layout = projectLabel(project).toLowerCase();
  const themeName = themeLabel(theme).toLowerCase();
  const alt = `${screen}, ${layout} layout, ${themeName} theme`;
  const missing = (
    <div className="screenshots-browser__missing">
      <p>
        No {themeName}-theme capture of {screen} in the {layout} layout.
      </p>
    </div>
  );
  return (
    // A plain div, not <main>: the Astro layout already provides the page's
    // <main> landmark, and a nested one is invalid.
    <div className="screenshots-browser__stage" ref={stageRef}>
      {entry ? (
        <button
          ref={zoomRef}
          type="button"
          className="screenshots-browser__frame screenshots-browser__zoom"
          onClick={() => setExpanded(true)}
          aria-label={`View full size: ${alt}`}
        >
          <img
            key={entry.src}
            className="screenshots-browser__image"
            src={entry.src}
            alt={alt}
            width={entry.width}
            height={entry.height}
            style={imageStyle}
          />
        </button>
      ) : (
        <div className="screenshots-browser__frame">{missing}</div>
      )}
      {expanded ? (
        <Lightbox
          label={alt}
          entry={entry}
          fallback={missing}
          onClose={() => {
            setExpanded(false);
            // Restore focus so gallery keyboard navigation keeps working.
            zoomRef.current?.focus();
          }}
        />
      ) : null}
    </div>
  );
}

function Lightbox({
  label,
  entry,
  fallback,
  onClose,
}: {
  label: string;
  // Undefined when stepping (while expanded) onto a screen that was not
  // captured for the current theme; the fallback keeps the dialog mounted so
  // focus and keyboard navigation survive.
  entry: ScreenshotEntry | undefined;
  fallback: ReactNode;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // showModal renders in the browser's top layer, so the enlarged image is not
  // clipped by the gallery container's bounds or overflow. Escape closes via
  // the dialog's native cancel behavior, surfacing here as the close event.
  // showModal would focus the first focusable descendant, the invisible
  // full-bleed backdrop button; move focus to the visible Close button.
  useEffect(() => {
    dialogRef.current?.showModal();
    closeRef.current?.focus();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="screenshots-browser__lightbox"
      aria-label={label}
      onClose={onClose}
    >
      <button
        type="button"
        className="screenshots-browser__lightbox-backdrop"
        onClick={onClose}
        aria-label="Close"
        tabIndex={-1}
      />
      {entry ? (
        <img
          key={entry.src}
          className="screenshots-browser__lightbox-image"
          src={entry.src}
          alt={label}
          width={entry.width}
          height={entry.height}
        />
      ) : (
        fallback
      )}
      <button
        ref={closeRef}
        type="button"
        className="screenshots-browser__lightbox-close"
        onClick={onClose}
        aria-label="Close"
      >
        <span aria-hidden="true">×</span>
      </button>
    </dialog>
  );
}
