import { expect, test } from "bun:test";
import {
  AVATAR_CROP_MAX_ZOOM,
  clampAvatarCropView,
  getAvatarCoverScale,
  getAvatarCropSourceRect,
  getAvatarImageLayout,
  INITIAL_AVATAR_CROP_VIEW,
  panAvatarCropView,
  rescaleAvatarCropView,
  zoomAvatarCropView,
} from "./avatarCropGeometry";

const VIEWPORT = 260;

test("cover scale fits the short image edge to the viewport", () => {
  expect(getAvatarCoverScale({ height: 500, width: 1000 }, VIEWPORT)).toBe(
    VIEWPORT / 500,
  );
  expect(getAvatarCoverScale({ height: 1000, width: 500 }, VIEWPORT)).toBe(
    VIEWPORT / 500,
  );
});

test("clamp keeps zoom within range and centers an unzoomed image", () => {
  const image = { height: 500, width: 1000 };

  expect(
    clampAvatarCropView(
      image,
      { offsetX: 40, offsetY: 40, zoom: 0.2 },
      VIEWPORT,
    ),
  ).toEqual({ offsetX: 40, offsetY: 0, zoom: 1 });
  expect(
    clampAvatarCropView(image, { offsetX: 0, offsetY: 0, zoom: 99 }, VIEWPORT),
  ).toEqual({ offsetX: 0, offsetY: 0, zoom: AVATAR_CROP_MAX_ZOOM });
});

test("pan clamps so the image always covers the viewport", () => {
  const image = { height: 500, width: 1000 };
  // Zoom 1: the height exactly covers the viewport, so vertical pan is locked
  // while horizontal pan stops at the image edge.
  const maxOffsetX = (1000 * (VIEWPORT / 500) - VIEWPORT) / 2;

  const panned = panAvatarCropView(
    image,
    INITIAL_AVATAR_CROP_VIEW,
    -10_000,
    25,
    VIEWPORT,
  );
  expect(panned).toEqual({ offsetX: -maxOffsetX, offsetY: 0, zoom: 1 });
});

test("zoom scales the current offsets to keep the center point fixed", () => {
  const image = { height: 1000, width: 1000 };
  const panned = panAvatarCropView(
    image,
    { offsetX: 0, offsetY: 0, zoom: 2 },
    -50,
    30,
    VIEWPORT,
  );

  const zoomed = zoomAvatarCropView(image, panned, 4, VIEWPORT);
  expect(zoomed.zoom).toBe(4);
  expect(zoomed.offsetX).toBeCloseTo(panned.offsetX * 2, 6);
  expect(zoomed.offsetY).toBeCloseTo(panned.offsetY * 2, 6);
});

test("rescaling keeps a valid crop inside a smaller viewport", () => {
  const image = { height: 1000, width: 1000 };
  const view = rescaleAvatarCropView(
    image,
    { offsetX: 390, offsetY: -390, zoom: 4 },
    VIEWPORT,
    160,
  );

  expect(view.offsetX).toBe(240);
  expect(view.offsetY).toBe(-240);
  expect(view.zoom).toBe(4);
});

test("crop source rect starts as the centered cover square", () => {
  const rect = getAvatarCropSourceRect(
    { height: 500, width: 1000 },
    INITIAL_AVATAR_CROP_VIEW,
    VIEWPORT,
  );

  expect(rect.size).toBeCloseTo(500, 6);
  expect(rect.x).toBeCloseTo(250, 6);
  expect(rect.y).toBeCloseTo(0, 6);
});

test("crop source rect follows pan and zoom within image bounds", () => {
  const image = { height: 500, width: 1000 };
  const scale = getAvatarCoverScale(image, VIEWPORT);
  const panned = panAvatarCropView(
    image,
    INITIAL_AVATAR_CROP_VIEW,
    -40,
    0,
    VIEWPORT,
  );

  const rect = getAvatarCropSourceRect(image, panned, VIEWPORT);
  expect(rect.size).toBeCloseTo(500, 6);
  expect(rect.x).toBeCloseTo(250 + 40 / scale, 6);

  const zoomedRect = getAvatarCropSourceRect(
    image,
    zoomAvatarCropView(image, INITIAL_AVATAR_CROP_VIEW, 2, VIEWPORT),
    VIEWPORT,
  );
  expect(zoomedRect.size).toBeCloseTo(250, 6);
  expect(zoomedRect.x).toBeCloseTo(375, 6);
  expect(zoomedRect.y).toBeCloseTo(125, 6);
});

test("image layout mirrors the crop rect mapping", () => {
  const image = { height: 500, width: 1000 };
  const view = panAvatarCropView(
    image,
    { offsetX: 0, offsetY: 0, zoom: 2 },
    -35,
    15,
    VIEWPORT,
  );
  const layout = getAvatarImageLayout(image, view, VIEWPORT);
  const rect = getAvatarCropSourceRect(image, view, VIEWPORT);
  const scale = getAvatarCoverScale(image, VIEWPORT) * view.zoom;

  // The viewport origin (0, 0) must map onto the crop rect's top-left corner.
  expect((0 - layout.left) / scale).toBeCloseTo(rect.x, 6);
  expect((0 - layout.top) / scale).toBeCloseTo(rect.y, 6);
  expect(layout.width).toBeCloseTo(1000 * scale, 6);
  expect(layout.height).toBeCloseTo(500 * scale, 6);
});
