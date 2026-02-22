import type { WindowDimensions } from '../../components/FloatingWindow.js';
import type { WindowInstance } from './types.js';

const DEFAULT_WINDOW_WIDTH_RATIO = 0.51;
const DEFAULT_WINDOW_ASPECT_RATIO = 16 / 10;
const DEFAULT_WINDOW_MIN_WIDTH = 480;
const DEFAULT_WINDOW_MIN_HEIGHT = 320;
const DEFAULT_WINDOW_HORIZONTAL_MARGIN = 120;
const DEFAULT_WINDOW_VERTICAL_MARGIN = 160;
const DEFAULT_WINDOW_CASCADE_OFFSET_X = 36;
const DEFAULT_WINDOW_CASCADE_OFFSET_Y = 28;

export interface DefaultDesktopWindowDimensionsOptions {
  mobileBreakpoint: number;
  currentWindows: WindowInstance[];
}

export function getDefaultDesktopWindowDimensions({
  mobileBreakpoint,
  currentWindows
}: DefaultDesktopWindowDimensionsOptions): WindowDimensions | undefined {
  if (
    typeof window === 'undefined' ||
    window.innerWidth < mobileBreakpoint ||
    window.innerHeight <= 0
  ) {
    return undefined;
  }

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const maxWidth = Math.max(
    DEFAULT_WINDOW_MIN_WIDTH,
    viewportWidth - DEFAULT_WINDOW_HORIZONTAL_MARGIN
  );
  const maxHeight = Math.max(
    DEFAULT_WINDOW_MIN_HEIGHT,
    viewportHeight - DEFAULT_WINDOW_VERTICAL_MARGIN
  );

  let width = Math.max(
    DEFAULT_WINDOW_MIN_WIDTH,
    Math.min(maxWidth, Math.round(viewportWidth * DEFAULT_WINDOW_WIDTH_RATIO))
  );
  const height = Math.max(
    DEFAULT_WINDOW_MIN_HEIGHT,
    Math.min(maxHeight, Math.round(width / DEFAULT_WINDOW_ASPECT_RATIO))
  );

  if (height === maxHeight) {
    width = Math.max(
      DEFAULT_WINDOW_MIN_WIDTH,
      Math.min(maxWidth, Math.round(height * DEFAULT_WINDOW_ASPECT_RATIO))
    );
  }

  const centeredX = Math.max(0, Math.round((viewportWidth - width) / 2));
  const centeredY = Math.max(0, Math.round((viewportHeight - height) / 2));
  const centeredDimensions: WindowDimensions = {
    width,
    height,
    x: centeredX,
    y: centeredY
  };

  if (currentWindows.length === 0) {
    return centeredDimensions;
  }

  const topWindow = currentWindows.reduce((highest, candidate) =>
    candidate.zIndex > highest.zIndex ? candidate : highest
  );
  const anchor = topWindow.dimensions;
  if (!anchor) {
    return centeredDimensions;
  }

  const maxX = Math.max(0, viewportWidth - width);
  const maxY = Math.max(0, viewportHeight - height);
  const x = Math.max(
    0,
    Math.min(maxX, anchor.x + DEFAULT_WINDOW_CASCADE_OFFSET_X)
  );
  const y = Math.max(
    0,
    Math.min(maxY, anchor.y + DEFAULT_WINDOW_CASCADE_OFFSET_Y)
  );

  return {
    ...centeredDimensions,
    x,
    y
  };
}
