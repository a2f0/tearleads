import { describe, expect, it } from 'vitest';
import {
  mockGetSetting,
  setupCanvasMocks,
  setupDefaultMockSettings,
  setupPointerCaptureMocks
} from './Home.testUtils';

describe('Home.testUtils helpers', () => {
  it('configures default settings mock values', () => {
    setupDefaultMockSettings();

    expect(mockGetSetting('desktopPattern')).toBe('solid');
    expect(mockGetSetting('desktopIconDepth')).toBe('debossed');
    expect(mockGetSetting('desktopIconBackground')).toBe('colored');
    expect(mockGetSetting('unknown')).toBe('enabled');
  });

  it('installs pointer capture mocks on Element prototype', () => {
    setupPointerCaptureMocks();

    expect(typeof Element.prototype.setPointerCapture).toBe('function');
    expect(typeof Element.prototype.releasePointerCapture).toBe('function');
  });

  it('configures canvas geometry and bounding box mocks', () => {
    const canvas = document.createElement('canvas');

    setupCanvasMocks(canvas);

    expect(canvas.offsetWidth).toBe(800);
    expect(canvas.offsetHeight).toBe(600);
    const rect = canvas.getBoundingClientRect();
    expect(rect.width).toBe(800);
    expect(rect.height).toBe(600);
    expect(rect.left).toBe(0);
    expect(rect.top).toBe(0);
  });
});
