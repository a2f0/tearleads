import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type SyntheticEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type AvatarCropImageSize,
  type AvatarCropView,
  INITIAL_AVATAR_CROP_VIEW,
  panAvatarCropView,
  zoomAvatarCropView,
} from "./avatarCropGeometry";
import { renderAvatarCropToBlob } from "./avatarCropRender";

const WHEEL_ZOOM_SENSITIVITY = 0.002;

type AvatarCropErrorKind = "encode" | "read" | null;

type PointerPoint = { x: number; y: number };
type SetView = (update: (view: AvatarCropView) => AvatarCropView) => void;

// One-pointer drags pan; two-pointer moves pinch-zoom by the change in
// pointer distance. Returns null when the event carries no tracked pointer.
function applyTrackedPointerMove(params: {
  event: ReactPointerEvent<HTMLDivElement>;
  imageSize: AvatarCropImageSize;
  pointers: Map<number, PointerPoint>;
  setView: SetView;
  viewportSize: number;
}): void {
  const { event, imageSize, pointers, setView, viewportSize } = params;
  const previous = pointers.get(event.pointerId);
  if (!previous) {
    return;
  }

  const next = { x: event.clientX, y: event.clientY };
  pointers.set(event.pointerId, next);
  if (pointers.size === 1) {
    setView((current) =>
      panAvatarCropView(
        imageSize,
        current,
        next.x - previous.x,
        next.y - previous.y,
        viewportSize,
      ),
    );
    return;
  }

  const other = [...pointers.entries()].find(
    ([pointerId]) => pointerId !== event.pointerId,
  )?.[1];
  if (!other) {
    return;
  }
  const previousDistance = Math.hypot(
    previous.x - other.x,
    previous.y - other.y,
  );
  const nextDistance = Math.hypot(next.x - other.x, next.y - other.y);
  if (previousDistance <= 0) {
    return;
  }
  setView((current) =>
    zoomAvatarCropView(
      imageSize,
      current,
      current.zoom * (nextDistance / previousDistance),
      viewportSize,
    ),
  );
}

function useAvatarCropPointerHandlers(params: {
  imageSize: AvatarCropImageSize | null;
  setView: SetView;
  viewportSize: number;
}) {
  const { imageSize, setView, viewportSize } = params;
  const pointersRef = useRef(new Map<number, PointerPoint>());

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!imageSize) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!imageSize) {
      return;
    }
    applyTrackedPointerMove({
      event,
      imageSize,
      pointers: pointersRef.current,
      setView,
      viewportSize,
    });
  }

  function onPointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    pointersRef.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return {
    onPointerCancel: onPointerEnd,
    onPointerDown,
    onPointerMove,
    onPointerUp: onPointerEnd,
  };
}

// React registers wheel listeners passively, so an onWheel prop could not
// preventDefault the page scroll; attach a non-passive listener directly.
function useAvatarCropWheelZoom(params: {
  imageSize: AvatarCropImageSize | null;
  setView: SetView;
  viewportRef: RefObject<HTMLDivElement | null>;
  viewportSize: number;
}) {
  const { imageSize, setView, viewportRef, viewportSize } = params;

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !imageSize) {
      return;
    }

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      setView((current) =>
        zoomAvatarCropView(
          imageSize,
          current,
          current.zoom * Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY),
          viewportSize,
        ),
      );
    };
    viewport.addEventListener("wheel", handleWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", handleWheel);
  }, [imageSize, setView, viewportRef, viewportSize]);
}

function useMeasuredViewportSize(
  viewportRef: RefObject<HTMLDivElement | null>,
  initialSize: number,
): number {
  const [size, setSize] = useState(initialSize);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === "undefined") {
      return;
    }

    const updateSize = (nextSize: number) => {
      if (nextSize > 0) {
        setSize((current) => (current === nextSize ? current : nextSize));
      }
    };
    updateSize(viewport.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => {
      updateSize(entry?.contentRect.width ?? 0);
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [viewportRef]);

  return size;
}

export function useAvatarCropEditorState(source: Blob, viewportSize: number) {
  const [imageSize, setImageSize] = useState<AvatarCropImageSize | null>(null);
  const [view, setView] = useState<AvatarCropView>(INITIAL_AVATAR_CROP_VIEW);
  const [errorKind, setErrorKind] = useState<AvatarCropErrorKind>(null);
  const [saving, setSaving] = useState(false);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const activeViewportSize = useMeasuredViewportSize(viewportRef, viewportSize);

  const sourceUrl = useMemo(() => URL.createObjectURL(source), [source]);
  useEffect(() => () => URL.revokeObjectURL(sourceUrl), [sourceUrl]);
  useAvatarCropWheelZoom({
    imageSize,
    setView,
    viewportRef,
    viewportSize: activeViewportSize,
  });

  function handleImageLoad(event: SyntheticEvent<HTMLImageElement>) {
    const { naturalHeight, naturalWidth } = event.currentTarget;
    if (naturalWidth <= 0 || naturalHeight <= 0) {
      setErrorKind("read");
      return;
    }
    setImageSize({ height: naturalHeight, width: naturalWidth });
    setView(INITIAL_AVATAR_CROP_VIEW);
    setErrorKind(null);
  }

  async function applyCrop(): Promise<Blob | null> {
    const image = imageRef.current;
    if (!image || !imageSize || saving) {
      return null;
    }
    setSaving(true);
    try {
      return await renderAvatarCropToBlob({
        image,
        imageSize,
        view,
        viewportSize: activeViewportSize,
      });
    } catch {
      setErrorKind("encode");
      return null;
    } finally {
      setSaving(false);
    }
  }

  return {
    applyCrop,
    errorKind,
    handleImageError: () => setErrorKind("read"),
    handleImageLoad,
    handleZoomChange: (nextZoom: number) => {
      if (imageSize && !Number.isNaN(nextZoom)) {
        setView((current) =>
          zoomAvatarCropView(imageSize, current, nextZoom, activeViewportSize),
        );
      }
    },
    imageRef,
    imageSize,
    pointerHandlers: useAvatarCropPointerHandlers({
      imageSize,
      setView,
      viewportSize: activeViewportSize,
    }),
    saving,
    sourceUrl,
    viewportSize: activeViewportSize,
    view,
    viewportRef,
  };
}
