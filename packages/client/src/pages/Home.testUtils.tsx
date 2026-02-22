/**
 * Shared test utilities for Home page tests.
 */

import { vi } from 'vitest';

export const mockGetSetting = vi.fn();

export const STORAGE_KEY = 'desktop-icon-positions';

export const MOCK_SAVED_POSITIONS = {
  '/search': { x: 200, y: 100 },
  '/calendar': { x: 250, y: 100 },
  '/businesses': { x: 350, y: 100 },
  '/vehicles': { x: 400, y: 100 },
  '/health': { x: 450, y: 100 },
  '/files': { x: 300, y: 300 },
  '/contacts': { x: 400, y: 100 },
  '/photos': { x: 100, y: 200 },
  '/camera': { x: 150, y: 250 },
  '/documents': { x: 200, y: 200 },
  '/help': { x: 150, y: 200 },
  '/notes': { x: 300, y: 200 },
  '/audio': { x: 400, y: 200 },
  '/videos': { x: 100, y: 300 },
  '/analytics': { x: 300, y: 300 },
  '/sqlite': { x: 400, y: 300 },
  '/console': { x: 100, y: 400 },
  '/debug': { x: 200, y: 400 },
  '/keychain': { x: 200, y: 500 },
  '/wallet': { x: 250, y: 500 },
  '/ai': { x: 300, y: 500 },
  '/mls-chat': { x: 500, y: 500 },
  '/email': { x: 400, y: 500 },
  '/models': { x: 100, y: 600 },
  '/admin': { x: 200, y: 600 },
  '/settings': { x: 300, y: 600 },
  '/admin/users': { x: 400, y: 600 },
  '/admin/organizations': { x: 500, y: 600 },
  '/sync': { x: 100, y: 700 },
  '/vfs': { x: 300, y: 700 },
  '/classic': { x: 400, y: 700 },
  '/backups': { x: 500, y: 700 }
};

export function setupDefaultMockSettings() {
  mockGetSetting.mockImplementation((key: string) => {
    switch (key) {
      case 'desktopPattern':
        return 'solid';
      case 'desktopIconDepth':
        return 'debossed';
      case 'desktopIconBackground':
        return 'colored';
      default:
        return 'enabled';
    }
  });
}

export function setupPointerCaptureMocks() {
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
}

export function setupCanvasMocks(canvas: Element) {
  Object.defineProperty(canvas, 'offsetWidth', {
    value: 800,
    configurable: true
  });
  Object.defineProperty(canvas, 'offsetHeight', {
    value: 600,
    configurable: true
  });
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    right: 800,
    bottom: 600,
    width: 800,
    height: 600,
    x: 0,
    y: 0,
    toJSON: () => ({})
  });
}
