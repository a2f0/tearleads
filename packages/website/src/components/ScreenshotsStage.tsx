import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  projectLabel,
  type ScreenshotEntry,
  themeLabel,
  titleCase,
} from "./screenshotsManifest";

const DEVICE_FRAME_CHROME: Readonly<Record<string, number>> = {
  mobile: 22,
  ipad: 18,
};

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
  // The frame's border (and the device variants' padding) sit outside the
  // image, so subtract them from the measured budget to keep the frame inside
  // the stage.
  const frameChrome = DEVICE_FRAME_CHROME[project] ?? 2;
  const imageStyle = fit
    ? {
        maxWidth: Math.max(0, fit.width - frameChrome),
        maxHeight: Math.max(0, fit.height - frameChrome),
      }
    : undefined;
  const label = `${projectLabel(project)} · ${theme} · ${name}`;
  const frameClass = [
    "screenshots-browser__frame",
    project === "mobile" ? "screenshots-browser__frame--mobile" : "",
    project === "ipad" ? "screenshots-browser__frame--ipad" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const missing = (
    <div className="screenshots-browser__missing">
      <p>
        {name ? titleCase(name) : "This screen"} was not captured in{" "}
        {themeLabel(theme)} for {projectLabel(project)}.
      </p>
    </div>
  );
  return (
    // A plain div, not <main>: the Astro page already provides the page's
    // <main> landmark, and a nested one is invalid.
    <div className="screenshots-browser__stage" ref={stageRef}>
      {entry ? (
        <button
          ref={zoomRef}
          type="button"
          className={`${frameClass} screenshots-browser__zoom`}
          onClick={() => setExpanded(true)}
          aria-label={`View ${label} full size`}
        >
          <img
            key={entry.src}
            className="screenshots-browser__image"
            src={entry.src}
            alt={label}
            style={imageStyle}
          />
        </button>
      ) : (
        <div className={frameClass}>{missing}</div>
      )}
      {expanded ? (
        <Lightbox
          label={label}
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

  // showModal renders in the browser's top layer, so the enlarged image is not
  // clipped by the gallery container's bounds or overflow. Escape closes via
  // the dialog's native cancel behavior, surfacing here as the close event.
  useEffect(() => {
    dialogRef.current?.showModal();
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
        aria-label="Close full size view"
        tabIndex={-1}
      />
      {entry ? (
        <img
          key={entry.src}
          className="screenshots-browser__lightbox-image"
          src={entry.src}
          alt={label}
        />
      ) : (
        fallback
      )}
      <button
        type="button"
        className="screenshots-browser__lightbox-close"
        onClick={onClose}
        aria-label="Close full size view"
      >
        ×
      </button>
    </dialog>
  );
}
