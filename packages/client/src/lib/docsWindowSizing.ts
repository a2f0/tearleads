export const DOCS_WINDOW_DEFAULT_WIDTH = 960;
export const DOCS_WINDOW_DEFAULT_HEIGHT = 720;
export const DOCS_WINDOW_GUTTER = 120;
export const DOCS_WINDOW_VERTICAL_GUTTER = 180;
export const DOCS_WINDOW_MIN_WIDTH = 360;
export const DOCS_WINDOW_MIN_HEIGHT = 320;
export const DOCS_WINDOW_MAX_WIDTH_PERCENT = 0.9;
export const DOCS_WINDOW_MAX_HEIGHT_PERCENT = 0.85;

export function getDocsWindowDefaults(
  viewportWidth?: number,
  viewportHeight?: number
) {
  if (viewportWidth === undefined || viewportHeight === undefined) {
    return {
      defaultWidth: DOCS_WINDOW_DEFAULT_WIDTH,
      defaultHeight: DOCS_WINDOW_DEFAULT_HEIGHT
    };
  }

  const defaultWidth = Math.max(
    DOCS_WINDOW_MIN_WIDTH,
    Math.min(DOCS_WINDOW_DEFAULT_WIDTH, viewportWidth - DOCS_WINDOW_GUTTER)
  );
  const defaultHeight = Math.max(
    DOCS_WINDOW_MIN_HEIGHT,
    Math.min(
      DOCS_WINDOW_DEFAULT_HEIGHT,
      viewportHeight - DOCS_WINDOW_VERTICAL_GUTTER
    )
  );

  return { defaultWidth, defaultHeight };
}
