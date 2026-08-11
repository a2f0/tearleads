import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  clampImageViewerView,
  EMPTY_IMAGE_VIEWER_SIZE,
  getFittedImageSize,
  getImageViewerTransform,
  IMAGE_VIEWER_DOUBLE_TAP_ZOOM,
  IMAGE_VIEWER_MAX_ZOOM,
  IMAGE_VIEWER_MIN_ZOOM,
  IMAGE_VIEWER_ZOOM_STEP,
  type ImageViewerPoint,
  type ImageViewerSize,
  type ImageViewerView,
  INITIAL_IMAGE_VIEWER_VIEW,
  isSameImageViewerView,
  panImageViewerView,
  zoomImageViewerView,
} from "./imageViewerGeometry";

const WHEEL_ZOOM_SENSITIVITY = 0.002;
// A second tap within this long of the first, and this close to it, double-taps.
// The same slop separates a tap from a drag.
const DOUBLE_TAP_TIMEOUT_MS = 300;
const TAP_SLOP_PX = 32;

type SetView = (update: (view: ImageViewerView) => ImageViewerView) => void;

// A live pointer: where it went down (to tell a tap from a drag) and where it is
// now (the frame every gesture measures its delta against).
interface TrackedPointer {
  origin: ImageViewerPoint;
  point: ImageViewerPoint;
}

interface ImageViewerGestureContext {
  fitted: ImageViewerSize;
  setView: SetView;
  stage: HTMLElement;
  viewport: ImageViewerSize;
}

// Client coordinates measured from the stage's center — the frame the geometry's
// pan offsets and zoom anchors live in.
function getStageAnchor(
  stage: HTMLElement,
  point: ImageViewerPoint,
): ImageViewerPoint {
  const rect = stage.getBoundingClientRect();

  return {
    x: point.x - rect.left - rect.width / 2,
    y: point.y - rect.top - rect.height / 2,
  };
}

function getMidpoint(
  left: ImageViewerPoint,
  right: ImageViewerPoint,
): ImageViewerPoint {
  return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
}

function getDistance(left: ImageViewerPoint, right: ImageViewerPoint): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

// Two pointers: zoom by the change in their separation, anchored on the midpoint
// they started from, then pan by however far that midpoint itself travelled — so
// one pinch both magnifies and reframes.
function applyPinch(
  context: ImageViewerGestureContext,
  points: {
    next: ImageViewerPoint;
    other: ImageViewerPoint;
    previous: ImageViewerPoint;
  },
): void {
  const { next, other, previous } = points;
  const previousDistance = getDistance(previous, other);
  if (previousDistance <= 0) {
    return;
  }

  const previousMidpoint = getMidpoint(previous, other);
  const nextMidpoint = getMidpoint(next, other);
  const anchor = getStageAnchor(context.stage, previousMidpoint);
  const zoomRatio = getDistance(next, other) / previousDistance;
  const delta = {
    x: nextMidpoint.x - previousMidpoint.x,
    y: nextMidpoint.y - previousMidpoint.y,
  };

  context.setView((view) =>
    panImageViewerView({
      delta,
      fitted: context.fitted,
      view: zoomImageViewerView({
        anchor,
        fitted: context.fitted,
        view,
        viewport: context.viewport,
        zoom: view.zoom * zoomRatio,
      }),
      viewport: context.viewport,
    }),
  );
}

function applyTrackedPointerMove(params: {
  context: ImageViewerGestureContext;
  event: ReactPointerEvent<HTMLDivElement>;
  pointers: Map<number, TrackedPointer>;
}): void {
  const { context, event, pointers } = params;
  const tracked = pointers.get(event.pointerId);
  if (!tracked) {
    return;
  }

  const previous = tracked.point;
  const next = { x: event.clientX, y: event.clientY };
  const other = [...pointers.entries()].find(
    ([pointerId]) => pointerId !== event.pointerId,
  )?.[1];
  pointers.set(event.pointerId, { origin: tracked.origin, point: next });

  if (!other) {
    context.setView((view) =>
      panImageViewerView({
        delta: { x: next.x - previous.x, y: next.y - previous.y },
        fitted: context.fitted,
        view,
        viewport: context.viewport,
      }),
    );
    return;
  }

  applyPinch(context, { next, other: other.point, previous });
}

// React attaches wheel listeners passively, so an onWheel prop could not
// preventDefault the page scroll behind the overlay; attach it directly.
function useImageViewerWheelZoom(params: {
  fitted: ImageViewerSize;
  setView: SetView;
  stageRef: RefObject<HTMLDivElement | null>;
  viewport: ImageViewerSize;
}) {
  const { fitted, setView, stageRef, viewport } = params;

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const anchor = getStageAnchor(stage, {
        x: event.clientX,
        y: event.clientY,
      });
      setView((view) =>
        zoomImageViewerView({
          anchor,
          fitted,
          view,
          viewport,
          zoom: view.zoom * Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY),
        }),
      );
    };

    stage.addEventListener("wheel", handleWheel, { passive: false });
    return () => stage.removeEventListener("wheel", handleWheel);
  }, [fitted, setView, stageRef, viewport]);
}

function useMeasuredViewport(
  stageRef: RefObject<HTMLDivElement | null>,
): ImageViewerSize {
  const [size, setSize] = useState<ImageViewerSize>(EMPTY_IMAGE_VIEWER_SIZE);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }

    const measure = () => {
      setSize((current) =>
        current.width === stage.clientWidth &&
        current.height === stage.clientHeight
          ? current
          : { height: stage.clientHeight, width: stage.clientWidth },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [stageRef]);

  return size;
}

// A resize or rotation can shrink the frame under a zoomed-in view, stranding
// the image past its new bounds; pull it back inside whenever the fit changes.
function useClampedViewOnResize(params: {
  fitted: ImageViewerSize;
  setView: SetView;
  viewport: ImageViewerSize;
}) {
  const { fitted, setView, viewport } = params;

  useEffect(() => {
    setView((current) => {
      const next = clampImageViewerView({ fitted, view: current, viewport });
      return isSameImageViewerView(current, next) ? current : next;
    });
  }, [fitted, setView, viewport]);
}

function useImageViewerZoomActions(params: {
  fitted: ImageViewerSize;
  setView: SetView;
  viewport: ImageViewerSize;
  zoom: number;
}) {
  const { fitted, setView, viewport, zoom } = params;
  const lastTapRef = useRef<{ point: ImageViewerPoint; time: number } | null>(
    null,
  );

  const zoomTo = useCallback(
    (nextZoom: number, anchor?: ImageViewerPoint | undefined) => {
      setView((view) =>
        zoomImageViewerView({
          anchor,
          fitted,
          view,
          viewport,
          zoom: nextZoom,
        }),
      );
    },
    [fitted, setView, viewport],
  );

  // Double-tap is a toggle: away from the fitted view it snaps back to fit,
  // otherwise it magnifies the point that was tapped.
  const toggleZoom = useCallback(
    (anchor: ImageViewerPoint) => {
      setView((view) =>
        view.zoom > IMAGE_VIEWER_MIN_ZOOM
          ? INITIAL_IMAGE_VIEWER_VIEW
          : zoomImageViewerView({
              anchor,
              fitted,
              view,
              viewport,
              zoom: IMAGE_VIEWER_DOUBLE_TAP_ZOOM,
            }),
      );
    },
    [fitted, setView, viewport],
  );

  // Every pointer type pairs its taps here — mouse included — rather than any of
  // them going through `dblclick`. A touch browser synthesizes `dblclick` after
  // two taps, so a stage that also listened for it would toggle the zoom twice
  // per double-tap and land back where it started; leaving that event unhandled
  // is what makes the ghost harmless instead of something to time out.
  const handleTap = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const point = { x: event.clientX, y: event.clientY };
      const previous = lastTapRef.current;
      if (
        previous &&
        event.timeStamp - previous.time <= DOUBLE_TAP_TIMEOUT_MS &&
        getDistance(point, previous.point) <= TAP_SLOP_PX
      ) {
        lastTapRef.current = null;
        toggleZoom(getStageAnchor(event.currentTarget, point));
        return;
      }

      lastTapRef.current = { point, time: event.timeStamp };
    },
    [toggleZoom],
  );

  return {
    // A pinch must not leave a half-formed double-tap behind it (see
    // `onPointerDown`), so the gesture layer can discard the pending tap.
    clearTapTracking: useCallback(() => {
      lastTapRef.current = null;
    }, []),
    handleTap,
    reset: useCallback(
      () => setView(() => INITIAL_IMAGE_VIEWER_VIEW),
      [setView],
    ),
    zoomIn: useCallback(
      () => zoomTo(zoom * IMAGE_VIEWER_ZOOM_STEP),
      [zoom, zoomTo],
    ),
    zoomOut: useCallback(
      () => zoomTo(zoom / IMAGE_VIEWER_ZOOM_STEP),
      [zoom, zoomTo],
    ),
  };
}

function useImageViewerPointerHandlers(params: {
  clearTapTracking: () => void;
  fitted: ImageViewerSize;
  onTap: (event: ReactPointerEvent<HTMLDivElement>) => void;
  setView: SetView;
  stageRef: RefObject<HTMLDivElement | null>;
  viewport: ImageViewerSize;
}) {
  const { clearTapTracking, fitted, onTap, setView, stageRef, viewport } =
    params;
  const pointersRef = useRef(new Map<number, TrackedPointer>());
  // Set the moment a gesture holds two pointers, and cleared only once every
  // pointer is up. A pinch is not a tap even though its anchoring finger can lift
  // within the tap slop of where it landed — without this the anchor would be
  // recorded as a tap and pair with the next one into a stray double-tap.
  const isMultiPointerGestureRef = useRef(false);

  const releasePointer = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): TrackedPointer | undefined => {
      const tracked = pointersRef.current.get(event.pointerId);
      pointersRef.current.delete(event.pointerId);
      if (pointersRef.current.size === 0) {
        isMultiPointerGestureRef.current = false;
      }
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      return tracked;
    },
    [],
  );

  return {
    onPointerCancel: useCallback(
      (event: ReactPointerEvent<HTMLDivElement>) => {
        releasePointer(event);
      },
      [releasePointer],
    ),
    onPointerDown: useCallback(
      (event: ReactPointerEvent<HTMLDivElement>) => {
        // Capture keeps a drag alive when the pointer leaves the stage; guarded
        // because non-browser DOM implementations do not all provide it.
        event.currentTarget.setPointerCapture?.(event.pointerId);
        const point = { x: event.clientX, y: event.clientY };
        pointersRef.current.set(event.pointerId, { origin: point, point });
        if (pointersRef.current.size > 1) {
          isMultiPointerGestureRef.current = true;
          // A second finger also invalidates any tap already waiting for its
          // partner, so a pinch can never complete an earlier half double-tap.
          clearTapTracking();
        }
      },
      [clearTapTracking],
    ),
    onPointerMove: useCallback(
      (event: ReactPointerEvent<HTMLDivElement>) => {
        applyTrackedPointerMove({
          context: {
            fitted,
            setView,
            stage: stageRef.current ?? event.currentTarget,
            viewport,
          },
          event,
          pointers: pointersRef.current,
        });
      },
      [fitted, setView, stageRef, viewport],
    ),
    onPointerUp: useCallback(
      (event: ReactPointerEvent<HTMLDivElement>) => {
        const wasMultiPointerGesture = isMultiPointerGestureRef.current;
        const tracked = releasePointer(event);
        // Only the last pointer up, from a single-pointer gesture that never
        // travelled far enough to be a drag, counts toward the double-tap.
        if (
          !wasMultiPointerGesture &&
          tracked &&
          pointersRef.current.size === 0 &&
          getDistance({ x: event.clientX, y: event.clientY }, tracked.origin) <=
            TAP_SLOP_PX
        ) {
          onTap(event);
        }
      },
      [onTap, releasePointer],
    ),
  };
}

/**
 * Zoom/pan state for the full-screen image viewer: drag (or one-finger swipe) to
 * pan, pinch or wheel to zoom about the gesture's own anchor, and double-tap or
 * double-click to toggle between the fitted view and a close-up of that point.
 *
 * The image lays out at its contain-fit size and every gesture resolves into one
 * CSS transform on it (see {@link imageViewerGeometry}), so nothing re-decodes
 * or reflows while zooming.
 */
export function useImageViewerState() {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [imageSize, setImageSize] = useState<ImageViewerSize | null>(null);
  const [hasError, setHasError] = useState(false);
  const [view, setView] = useState<ImageViewerView>(INITIAL_IMAGE_VIEWER_VIEW);
  const viewport = useMeasuredViewport(stageRef);
  const fitted = useMemo(
    () =>
      imageSize
        ? getFittedImageSize(imageSize, viewport)
        : EMPTY_IMAGE_VIEWER_SIZE,
    [imageSize, viewport],
  );

  useClampedViewOnResize({ fitted, setView, viewport });
  useImageViewerWheelZoom({ fitted, setView, stageRef, viewport });

  const zoomActions = useImageViewerZoomActions({
    fitted,
    setView,
    viewport,
    zoom: view.zoom,
  });
  const pointerHandlers = useImageViewerPointerHandlers({
    clearTapTracking: zoomActions.clearTapTracking,
    fitted,
    onTap: zoomActions.handleTap,
    setView,
    stageRef,
    viewport,
  });

  const handleImageLoad = useCallback(
    (event: SyntheticEvent<HTMLImageElement>) => {
      const { naturalHeight, naturalWidth } = event.currentTarget;
      if (naturalWidth <= 0 || naturalHeight <= 0) {
        setHasError(true);
        return;
      }
      setImageSize({ height: naturalHeight, width: naturalWidth });
      setHasError(false);
      setView(INITIAL_IMAGE_VIEWER_VIEW);
    },
    [],
  );

  return {
    canZoomIn: view.zoom < IMAGE_VIEWER_MAX_ZOOM,
    handleImageError: useCallback(() => setHasError(true), []),
    handleImageLoad,
    hasError,
    isZoomed: view.zoom > IMAGE_VIEWER_MIN_ZOOM,
    pointerHandlers,
    reset: zoomActions.reset,
    stageRef,
    transform: getImageViewerTransform(view),
    zoomIn: zoomActions.zoomIn,
    zoomOut: zoomActions.zoomOut,
  };
}
