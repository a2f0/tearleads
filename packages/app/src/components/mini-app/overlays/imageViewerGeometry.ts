// Pure geometry for the full-screen image viewer. The model: a viewport of
// `width` x `height` CSS pixels holding the image at its contain-fit size (never
// upscaled past 1:1, so a small blob stays crisp rather than blurred to fill the
// screen), with zoom and pan layered on top as the CSS transform
// `translate(x, y) scale(zoom)`. Because the translation is applied outside the
// scale, `x`/`y` are unscaled viewport pixels measured from the centered
// position, and an anchor point is measured from the viewport center.

export interface ImageViewerSize {
  height: number;
  width: number;
}

export interface ImageViewerPoint {
  x: number;
  y: number;
}

export interface ImageViewerView {
  x: number;
  y: number;
  zoom: number;
}

export const IMAGE_VIEWER_MIN_ZOOM = 1;
export const IMAGE_VIEWER_MAX_ZOOM = 8;
// Where a double-tap (or double-click) lands when starting from the fitted view.
export const IMAGE_VIEWER_DOUBLE_TAP_ZOOM = 3;
// Multiplier for one press of the toolbar's zoom in / zoom out buttons.
export const IMAGE_VIEWER_ZOOM_STEP = 1.6;

export const EMPTY_IMAGE_VIEWER_SIZE: ImageViewerSize = { height: 0, width: 0 };

export const INITIAL_IMAGE_VIEWER_VIEW: ImageViewerView = {
  x: 0,
  y: 0,
  zoom: IMAGE_VIEWER_MIN_ZOOM,
};

const VIEWPORT_CENTER: ImageViewerPoint = { x: 0, y: 0 };

// Bound one pan axis to +/- `max`. Non-finite input is treated as centered: a
// gesture carrying no coordinates (or landing on an element the platform reports
// no geometry for) must not put NaN into the transform, which would blank the
// image rather than merely misplace it.
function clampOffset(value: number, max: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const clamped = Math.min(max, Math.max(-max, value));
  // Clamping a negative offset against a zero bound yields -0, which would
  // reach the DOM as `translate(-0px, -0px)`; normalize it back to 0.
  return clamped === 0 ? 0 : clamped;
}

function clampImageViewerZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) {
    return IMAGE_VIEWER_MIN_ZOOM;
  }

  return Math.min(IMAGE_VIEWER_MAX_ZOOM, Math.max(IMAGE_VIEWER_MIN_ZOOM, zoom));
}

// The image's laid-out size at zoom 1: contained inside the viewport, and never
// scaled above its natural size. Mirrors what `max-width/max-height: 100%` does
// to the <img> itself, so the transform math matches the real layout box.
export function getFittedImageSize(
  image: ImageViewerSize,
  viewport: ImageViewerSize,
): ImageViewerSize {
  if (
    image.width <= 0 ||
    image.height <= 0 ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    return EMPTY_IMAGE_VIEWER_SIZE;
  }

  const ratio = Math.min(
    viewport.width / image.width,
    viewport.height / image.height,
    1,
  );

  return { height: image.height * ratio, width: image.width * ratio };
}

// Half the overhang of the zoomed image past one edge of the viewport. An axis
// that still fits stays pinned to the center, so its only legal offset is 0 —
// which is what keeps a fitted image from being flung off-screen by a drag.
function getMaxPan(
  fittedExtent: number,
  zoom: number,
  viewportExtent: number,
): number {
  return Math.max(0, (fittedExtent * zoom - viewportExtent) / 2);
}

export function clampImageViewerView(params: {
  fitted: ImageViewerSize;
  view: ImageViewerView;
  viewport: ImageViewerSize;
}): ImageViewerView {
  const zoom = clampImageViewerZoom(params.view.zoom);
  const maxX = getMaxPan(params.fitted.width, zoom, params.viewport.width);
  const maxY = getMaxPan(params.fitted.height, zoom, params.viewport.height);

  return {
    x: clampOffset(params.view.x, maxX),
    y: clampOffset(params.view.y, maxY),
    zoom,
  };
}

export function panImageViewerView(params: {
  delta: ImageViewerPoint;
  fitted: ImageViewerSize;
  view: ImageViewerView;
  viewport: ImageViewerSize;
}): ImageViewerView {
  return clampImageViewerView({
    fitted: params.fitted,
    view: {
      x: params.view.x + params.delta.x,
      y: params.view.y + params.delta.y,
      zoom: params.view.zoom,
    },
    viewport: params.viewport,
  });
}

// Zoom about a fixed anchor: the image point under the anchor stays under it, so
// the pan offset moves with the zoom ratio. Omit the anchor to zoom about the
// viewport center (the toolbar buttons); a pinch or wheel passes its own.
export function zoomImageViewerView(params: {
  anchor?: ImageViewerPoint | undefined;
  fitted: ImageViewerSize;
  view: ImageViewerView;
  viewport: ImageViewerSize;
  zoom: number;
}): ImageViewerView {
  const zoom = clampImageViewerZoom(params.zoom);
  const ratio = zoom / params.view.zoom;
  const anchor = params.anchor ?? VIEWPORT_CENTER;

  return clampImageViewerView({
    fitted: params.fitted,
    view: {
      x: anchor.x - (anchor.x - params.view.x) * ratio,
      y: anchor.y - (anchor.y - params.view.y) * ratio,
      zoom,
    },
    viewport: params.viewport,
  });
}

export function getImageViewerTransform(view: ImageViewerView): string {
  return `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;
}

export function isSameImageViewerView(
  left: ImageViewerView,
  right: ImageViewerView,
): boolean {
  return left.x === right.x && left.y === right.y && left.zoom === right.zoom;
}
