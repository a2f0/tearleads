// Pure geometry for the avatar crop editor. The model: a square viewport of
// `viewportSize` CSS pixels with an inscribed circle mask; the source image is
// scaled to at least cover the viewport (zoom 1 == cover) and translated by an
// offset expressed in viewport pixels, measured from the centered position.
// The exported crop is the square region of the image visible in the viewport.

export interface AvatarCropImageSize {
  height: number;
  width: number;
}

export interface AvatarCropView {
  offsetX: number;
  offsetY: number;
  zoom: number;
}

interface AvatarCropSourceRect {
  size: number;
  x: number;
  y: number;
}

export const AVATAR_CROP_MIN_ZOOM = 1;
export const AVATAR_CROP_MAX_ZOOM = 8;

export const INITIAL_AVATAR_CROP_VIEW: AvatarCropView = {
  offsetX: 0,
  offsetY: 0,
  zoom: 1,
};

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// Scale that makes the image exactly cover the square viewport at zoom 1.
export function getAvatarCoverScale(
  image: AvatarCropImageSize,
  viewportSize: number,
): number {
  return viewportSize / Math.min(image.width, image.height);
}

function getAvatarViewScale(
  image: AvatarCropImageSize,
  zoom: number,
  viewportSize: number,
): number {
  return getAvatarCoverScale(image, viewportSize) * zoom;
}

// Clamp the zoom into range and the offsets so the image always covers the
// viewport (no background showing through the crop circle).
export function clampAvatarCropView(
  image: AvatarCropImageSize,
  view: AvatarCropView,
  viewportSize: number,
): AvatarCropView {
  const zoom = clampNumber(
    view.zoom,
    AVATAR_CROP_MIN_ZOOM,
    AVATAR_CROP_MAX_ZOOM,
  );
  const scale = getAvatarViewScale(image, zoom, viewportSize);
  const maxOffsetX = Math.max(0, (image.width * scale - viewportSize) / 2);
  const maxOffsetY = Math.max(0, (image.height * scale - viewportSize) / 2);
  return {
    offsetX: clampNumber(view.offsetX, -maxOffsetX, maxOffsetX),
    offsetY: clampNumber(view.offsetY, -maxOffsetY, maxOffsetY),
    zoom,
  };
}

export function panAvatarCropView(
  image: AvatarCropImageSize,
  view: AvatarCropView,
  deltaX: number,
  deltaY: number,
  viewportSize: number,
): AvatarCropView {
  return clampAvatarCropView(
    image,
    {
      offsetX: view.offsetX + deltaX,
      offsetY: view.offsetY + deltaY,
      zoom: view.zoom,
    },
    viewportSize,
  );
}

export function rescaleAvatarCropView(
  image: AvatarCropImageSize,
  view: AvatarCropView,
  previousViewportSize: number,
  nextViewportSize: number,
): AvatarCropView {
  if (previousViewportSize <= 0 || nextViewportSize <= 0) {
    return clampAvatarCropView(image, view, nextViewportSize);
  }
  const ratio = nextViewportSize / previousViewportSize;
  return clampAvatarCropView(
    image,
    {
      offsetX: view.offsetX * ratio,
      offsetY: view.offsetY * ratio,
      zoom: view.zoom,
    },
    nextViewportSize,
  );
}

// Change zoom while keeping the image point at the viewport center fixed:
// offsets are translations of the image center, so they scale with zoom.
export function zoomAvatarCropView(
  image: AvatarCropImageSize,
  view: AvatarCropView,
  nextZoom: number,
  viewportSize: number,
): AvatarCropView {
  const zoom = clampNumber(
    nextZoom,
    AVATAR_CROP_MIN_ZOOM,
    AVATAR_CROP_MAX_ZOOM,
  );
  const ratio = zoom / view.zoom;
  return clampAvatarCropView(
    image,
    {
      offsetX: view.offsetX * ratio,
      offsetY: view.offsetY * ratio,
      zoom,
    },
    viewportSize,
  );
}

// CSS layout for the <img> inside the viewport, in viewport-local pixels.
export function getAvatarImageLayout(
  image: AvatarCropImageSize,
  view: AvatarCropView,
  viewportSize: number,
): { height: number; left: number; top: number; width: number } {
  const scale = getAvatarViewScale(image, view.zoom, viewportSize);
  const width = image.width * scale;
  const height = image.height * scale;
  return {
    height,
    left: (viewportSize - width) / 2 + view.offsetX,
    top: (viewportSize - height) / 2 + view.offsetY,
    width,
  };
}

// The square region of the source image (in image pixels) visible in the
// viewport. Clamped into image bounds to absorb floating-point drift.
export function getAvatarCropSourceRect(
  image: AvatarCropImageSize,
  view: AvatarCropView,
  viewportSize: number,
): AvatarCropSourceRect {
  const scale = getAvatarViewScale(image, view.zoom, viewportSize);
  const size = Math.min(
    viewportSize / scale,
    Math.min(image.width, image.height),
  );
  const x = image.width / 2 - view.offsetX / scale - size / 2;
  const y = image.height / 2 - view.offsetY / scale - size / 2;
  return {
    size,
    x: clampNumber(x, 0, image.width - size),
    y: clampNumber(y, 0, image.height - size),
  };
}
