import { describe, expect, it } from 'vitest';
import {
  getDefaultDesktopWindowDimensions,
  type DefaultDesktopWindowDimensionsOptions
} from './defaultDesktopWindowDimensions.js';

const DEFAULT_OPTIONS: DefaultDesktopWindowDimensionsOptions = {
  mobileBreakpoint: 768,
  currentWindows: []
};

describe('getDefaultDesktopWindowDimensions', () => {
  it('returns undefined on mobile viewports', () => {
    Object.defineProperty(window, 'innerWidth', {
      value: 767,
      configurable: true
    });
    Object.defineProperty(window, 'innerHeight', {
      value: 900,
      configurable: true
    });

    const dimensions = getDefaultDesktopWindowDimensions(DEFAULT_OPTIONS);
    expect(dimensions).toBeUndefined();
  });

  it('returns centered landscape dimensions when no windows are open', () => {
    Object.defineProperty(window, 'innerWidth', {
      value: 1440,
      configurable: true
    });
    Object.defineProperty(window, 'innerHeight', {
      value: 900,
      configurable: true
    });

    const dimensions = getDefaultDesktopWindowDimensions(DEFAULT_OPTIONS);
    expect(dimensions).toEqual({
      width: 734,
      height: 459,
      x: 353,
      y: 221
    });
  });

  it('cascades from the top-most window with dimensions', () => {
    Object.defineProperty(window, 'innerWidth', {
      value: 1440,
      configurable: true
    });
    Object.defineProperty(window, 'innerHeight', {
      value: 900,
      configurable: true
    });

    const dimensions = getDefaultDesktopWindowDimensions({
      ...DEFAULT_OPTIONS,
      currentWindows: [
        {
          id: 'low',
          type: 'notes',
          zIndex: 100,
          isMinimized: false,
          dimensions: { width: 600, height: 400, x: 20, y: 40 }
        },
        {
          id: 'high',
          type: 'files',
          zIndex: 200,
          isMinimized: false,
          dimensions: { width: 640, height: 480, x: 100, y: 120 }
        }
      ]
    });

    expect(dimensions?.x).toBe(136);
    expect(dimensions?.y).toBe(148);
  });
});
