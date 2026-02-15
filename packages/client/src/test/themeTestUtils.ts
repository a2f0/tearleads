import { vi } from 'vitest';

/**
 * Sets up mocks needed for theme-related tests.
 * Call this in beforeEach() blocks for tests that use ThemeProvider.
 */
export function setupThemeMocks() {
  document.documentElement.classList.remove('light', 'dark', 'tokyo-night');

  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn()
    },
    writable: true
  });

  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }))
  });
}
