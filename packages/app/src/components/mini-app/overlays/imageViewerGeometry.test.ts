import { expect, test } from "bun:test";
import {
  clampImageViewerView,
  getFittedImageSize,
  getImageViewerTransform,
  IMAGE_VIEWER_MAX_ZOOM,
  IMAGE_VIEWER_MIN_ZOOM,
  INITIAL_IMAGE_VIEWER_VIEW,
  panImageViewerView,
  zoomImageViewerView,
} from "./imageViewerGeometry";

const VIEWPORT = { height: 600, width: 400 };

test("fit contains a large image and leaves a small one at natural size", () => {
  // 1000x1000 into 400x600: the width is the tight axis, so both edges scale by
  // 400/1000.
  expect(getFittedImageSize({ height: 1000, width: 1000 }, VIEWPORT)).toEqual({
    height: 400,
    width: 400,
  });
  // Smaller than the viewport: never upscaled, so it stays 1:1.
  expect(getFittedImageSize({ height: 50, width: 80 }, VIEWPORT)).toEqual({
    height: 50,
    width: 80,
  });
});

test("fit degrades to an empty box for an unmeasured image or viewport", () => {
  expect(
    getFittedImageSize({ height: 100, width: 100 }, { height: 0, width: 0 }),
  ).toEqual({ height: 0, width: 0 });
  expect(getFittedImageSize({ height: 0, width: 0 }, VIEWPORT)).toEqual({
    height: 0,
    width: 0,
  });
});

test("clamp bounds the zoom and centers an image that still fits", () => {
  const fitted = { height: 400, width: 400 };

  expect(
    clampImageViewerView({
      fitted,
      view: { x: 30, y: 30, zoom: 0.1 },
      viewport: VIEWPORT,
    }),
  ).toEqual({ x: 0, y: 0, zoom: IMAGE_VIEWER_MIN_ZOOM });
  expect(
    clampImageViewerView({
      fitted,
      view: { x: 0, y: 0, zoom: 99 },
      viewport: VIEWPORT,
    }).zoom,
  ).toBe(IMAGE_VIEWER_MAX_ZOOM);
});

test("pan stops at the zoomed image's overhang on each axis", () => {
  const fitted = { height: 400, width: 400 };
  // At zoom 2 the image is 800x800 in a 400x600 viewport: 200px of horizontal
  // overhang each side, 100px vertical.
  const panned = panImageViewerView({
    delta: { x: 1000, y: -1000 },
    fitted,
    view: { x: 0, y: 0, zoom: 2 },
    viewport: VIEWPORT,
  });

  expect(panned).toEqual({ x: 200, y: -100, zoom: 2 });
});

test("a fitted image cannot be dragged off center", () => {
  expect(
    panImageViewerView({
      delta: { x: 120, y: 90 },
      fitted: { height: 400, width: 400 },
      view: INITIAL_IMAGE_VIEWER_VIEW,
      viewport: VIEWPORT,
    }),
  ).toEqual({ x: 0, y: 0, zoom: 1 });
});

test("zoom about an anchor keeps the image point under it fixed", () => {
  const fitted = { height: 600, width: 400 };
  // Anchor 100px right of center; doubling the zoom pushes the offset out so the
  // same image pixel stays beneath the pointer: x' = 100 - (100 - 0) * 2.
  const zoomed = zoomImageViewerView({
    anchor: { x: 100, y: 0 },
    fitted,
    view: INITIAL_IMAGE_VIEWER_VIEW,
    viewport: VIEWPORT,
    zoom: 2,
  });

  expect(zoomed).toEqual({ x: -100, y: 0, zoom: 2 });
});

test("zoom without an anchor scales about the viewport center", () => {
  const fitted = { height: 600, width: 400 };

  expect(
    zoomImageViewerView({
      fitted,
      view: { x: 50, y: 20, zoom: 2 },
      viewport: VIEWPORT,
      zoom: 4,
    }),
  ).toEqual({ x: 100, y: 40, zoom: 4 });
});

test("zooming back out re-centers the image", () => {
  const fitted = { height: 600, width: 400 };
  const zoomedIn = zoomImageViewerView({
    anchor: { x: 150, y: 150 },
    fitted,
    view: INITIAL_IMAGE_VIEWER_VIEW,
    viewport: VIEWPORT,
    zoom: 4,
  });

  expect(
    zoomImageViewerView({
      fitted,
      view: zoomedIn,
      viewport: VIEWPORT,
      zoom: IMAGE_VIEWER_MIN_ZOOM,
    }),
  ).toEqual({ x: 0, y: 0, zoom: 1 });
});

test("the transform translates outside the scale", () => {
  expect(getImageViewerTransform({ x: -12.5, y: 4, zoom: 2 })).toBe(
    "translate(-12.5px, 4px) scale(2)",
  );
});
