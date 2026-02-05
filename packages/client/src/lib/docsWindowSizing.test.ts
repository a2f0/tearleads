import { describe, expect, it } from 'vitest';
import {
  DOCS_WINDOW_DEFAULT_HEIGHT,
  DOCS_WINDOW_DEFAULT_WIDTH,
  DOCS_WINDOW_GUTTER,
  DOCS_WINDOW_MIN_HEIGHT,
  DOCS_WINDOW_MIN_WIDTH,
  DOCS_WINDOW_VERTICAL_GUTTER,
  getDocsWindowDefaults
} from './docsWindowSizing';

describe('getDocsWindowDefaults', () => {
  it('returns defaults when viewport is undefined', () => {
    expect(getDocsWindowDefaults()).toEqual({
      defaultWidth: DOCS_WINDOW_DEFAULT_WIDTH,
      defaultHeight: DOCS_WINDOW_DEFAULT_HEIGHT
    });
  });

  it('clamps defaults within viewport bounds', () => {
    const result = getDocsWindowDefaults(800, 700);

    expect(result).toEqual({
      defaultWidth: Math.max(
        DOCS_WINDOW_MIN_WIDTH,
        Math.min(DOCS_WINDOW_DEFAULT_WIDTH, 800 - DOCS_WINDOW_GUTTER)
      ),
      defaultHeight: Math.max(
        DOCS_WINDOW_MIN_HEIGHT,
        Math.min(
          DOCS_WINDOW_DEFAULT_HEIGHT,
          700 - DOCS_WINDOW_VERTICAL_GUTTER
        )
      )
    });
  });
});
