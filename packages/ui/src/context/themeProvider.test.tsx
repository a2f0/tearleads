import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from './themeProvider';
import { useTheme } from './useTheme';

// Store for localStorage mock
let localStorageData: Record<string, string> = {};

// Mock matchMedia
let mockMatchMediaMatches = false;
const mockMatchMediaListeners: ((e: MediaQueryListEvent) => void)[] = [];

function TestConsumer() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="resolved-theme">{resolvedTheme}</span>
      <button type="button" onClick={() => setTheme('light')}>
        Set Light
      </button>
      <button type="button" onClick={() => setTheme('dark')}>
        Set Dark
      </button>
      <button type="button" onClick={() => setTheme('tokyo-night')}>
        Set Tokyo Night
      </button>
      <button type="button" onClick={() => setTheme('monochrome')}>
        Set Monochrome
      </button>
      <button type="button" onClick={() => setTheme('system')}>
        Set System
      </button>
    </div>
  );
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageData = {};
    mockMatchMediaMatches = false;
    mockMatchMediaListeners.length = 0;

    // Reset document classes
    document.documentElement.classList.remove(
      'light',
      'dark',
      'tokyo-night',
      'monochrome'
    );

    // Mock localStorage
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: vi.fn((key: string) => localStorageData[key] ?? null),
        setItem: vi.fn((key: string, value: string) => {
          localStorageData[key] = value;
        }),
        removeItem: vi.fn((key: string) => {
          delete localStorageData[key];
        }),
        clear: vi.fn(() => {
          localStorageData = {};
        })
      },
      writable: true
    });

    // Mock matchMedia
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: mockMatchMediaMatches,
        media: '(prefers-color-scheme: dark)',
        onchange: null,
        addEventListener: vi.fn(
          (_event: string, handler: (e: MediaQueryListEvent) => void) => {
            mockMatchMediaListeners.push(handler);
          }
        ),
        removeEventListener: vi.fn(
          (_event: string, handler: (e: MediaQueryListEvent) => void) => {
            const index = mockMatchMediaListeners.indexOf(handler);
            if (index > -1) {
              mockMatchMediaListeners.splice(index, 1);
            }
          }
        ),
        dispatchEvent: vi.fn()
      }))
    });
  });

  describe('initialization', () => {
    it('uses default theme when no stored value', () => {
      render(
        <ThemeProvider>
          <TestConsumer />
        </ThemeProvider>
      );

      expect(screen.getByTestId('theme')).toHaveTextContent('monochrome');
    });

    it('uses custom default theme', () => {
      render(
        <ThemeProvider defaultTheme="dark">
          <TestConsumer />
        </ThemeProvider>
      );

      expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    });

    it('loads theme from localStorage', () => {
      localStorageData['theme'] = 'dark';

      render(
        <ThemeProvider>
          <TestConsumer />
        </ThemeProvider>
      );

      expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    });

    it('loads tokyo-night theme from localStorage', () => {
      localStorageData['theme'] = 'tokyo-night';

      render(
        <ThemeProvider>
          <TestConsumer />
        </ThemeProvider>
      );

      expect(screen.getByTestId('theme')).toHaveTextContent('tokyo-night');
    });

    it('loads monochrome theme from localStorage', () => {
      localStorageData['theme'] = 'monochrome';

      render(
        <ThemeProvider>
          <TestConsumer />
        </ThemeProvider>
      );

      expect(screen.getByTestId('theme')).toHaveTextContent('monochrome');
    });

    it('uses custom storage key', () => {
      localStorageData['custom-theme'] = 'light';

      render(
        <ThemeProvider storageKey="custom-theme">
          <TestConsumer />
        </ThemeProvider>
      );

      expect(screen.getByTestId('theme')).toHaveTextContent('light');
    });

    it('ignores invalid stored values', () => {
      localStorageData['theme'] = 'invalid';

      render(
        <ThemeProvider defaultTheme="light">
          <TestConsumer />
        </ThemeProvider>
      );

      expect(screen.getByTestId('theme')).toHaveTextContent('light');
    });
  });

  describe('resolvedTheme', () => {
    it('resolves to light when theme is light', () => {
      render(
        <ThemeProvider defaultTheme="light">
          <TestConsumer />
        </ThemeProvider>
      );

      expect(screen.getByTestId('resolved-theme')).toHaveTextContent('light');
    });

    it('resolves to dark when theme is dark', () => {
      render(
        <ThemeProvider defaultTheme="dark">
          <TestConsumer />
        </ThemeProvider>
      );

      expect(screen.getByTestId('resolved-theme')).toHaveTextContent('dark');
    });

    it('resolves to tokyo-night when theme is tokyo-night', () => {
      render(
        <ThemeProvider defaultTheme="tokyo-night">
          <TestConsumer />
        </ThemeProvider>
      );

      expect(screen.getByTestId('resolved-theme')).toHaveTextContent(
        'tokyo-night'
      );
    });

    it('resolves to monochrome when theme is monochrome', () => {
      render(
        <ThemeProvider defaultTheme="monochrome">
          <TestConsumer />
        </ThemeProvider>
      );

      expect(screen.getByTestId('resolved-theme')).toHaveTextContent(
        'monochrome'
      );
    });

    it('resolves to system preference when theme is system (light)', () => {
      mockMatchMediaMatches = false;

      render(
        <ThemeProvider defaultTheme="system">
          <TestConsumer />
        </ThemeProvider>
      );

      expect(screen.getByTestId('resolved-theme')).toHaveTextContent('light');
    });

    it('resolves to system preference when theme is system (dark)', () => {
      mockMatchMediaMatches = true;

      render(
        <ThemeProvider defaultTheme="system">
          <TestConsumer />
        </ThemeProvider>
      );

      expect(screen.getByTestId('resolved-theme')).toHaveTextContent('dark');
    });
  });

  describe('setTheme', () => {
    it('updates theme state', async () => {
      const user = userEvent.setup();

      render(
        <ThemeProvider defaultTheme="light">
          <TestConsumer />
        </ThemeProvider>
      );

      await user.click(screen.getByText('Set Dark'));

      expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    });

    it('persists theme to localStorage', async () => {
      const user = userEvent.setup();

      render(
        <ThemeProvider>
          <TestConsumer />
        </ThemeProvider>
      );

      await user.click(screen.getByText('Set Dark'));

      expect(localStorage.setItem).toHaveBeenCalledWith('theme', 'dark');
    });

    it('uses custom storage key when persisting', async () => {
      const user = userEvent.setup();

      render(
        <ThemeProvider storageKey="my-theme">
          <TestConsumer />
        </ThemeProvider>
      );

      await user.click(screen.getByText('Set Light'));

      expect(localStorage.setItem).toHaveBeenCalledWith('my-theme', 'light');
    });
  });

  describe('DOM class management', () => {
    it('adds light class to document when resolved to light', () => {
      render(
        <ThemeProvider defaultTheme="light">
          <TestConsumer />
        </ThemeProvider>
      );

      expect(document.documentElement.classList.contains('light')).toBe(true);
      expect(document.documentElement.classList.contains('dark')).toBe(false);
    });

    it('adds dark class to document when resolved to dark', () => {
      render(
        <ThemeProvider defaultTheme="dark">
          <TestConsumer />
        </ThemeProvider>
      );

      expect(document.documentElement.classList.contains('dark')).toBe(true);
      expect(document.documentElement.classList.contains('light')).toBe(false);
    });

    it('adds tokyo-night class to document when resolved to tokyo-night', () => {
      render(
        <ThemeProvider defaultTheme="tokyo-night">
          <TestConsumer />
        </ThemeProvider>
      );

      expect(document.documentElement.classList.contains('tokyo-night')).toBe(
        true
      );
      expect(document.documentElement.classList.contains('light')).toBe(false);
      expect(document.documentElement.classList.contains('dark')).toBe(false);
    });

    it('adds monochrome class to document when resolved to monochrome', () => {
      render(
        <ThemeProvider defaultTheme="monochrome">
          <TestConsumer />
        </ThemeProvider>
      );

      expect(document.documentElement.classList.contains('monochrome')).toBe(
        true
      );
      expect(document.documentElement.classList.contains('light')).toBe(false);
      expect(document.documentElement.classList.contains('dark')).toBe(false);
      expect(document.documentElement.classList.contains('tokyo-night')).toBe(
        false
      );
    });

    it('updates document class when theme changes', async () => {
      const user = userEvent.setup();

      render(
        <ThemeProvider defaultTheme="light">
          <TestConsumer />
        </ThemeProvider>
      );

      expect(document.documentElement.classList.contains('light')).toBe(true);

      await user.click(screen.getByText('Set Dark'));

      expect(document.documentElement.classList.contains('dark')).toBe(true);
      expect(document.documentElement.classList.contains('light')).toBe(false);
    });
  });

  describe('system theme changes', () => {
    it('updates resolved theme when system preference changes', async () => {
      mockMatchMediaMatches = false;

      render(
        <ThemeProvider defaultTheme="system">
          <TestConsumer />
        </ThemeProvider>
      );

      expect(screen.getByTestId('resolved-theme')).toHaveTextContent('light');

      // Simulate system theme change
      act(() => {
        for (const listener of mockMatchMediaListeners) {
          listener({ matches: true } as MediaQueryListEvent);
        }
      });

      expect(screen.getByTestId('resolved-theme')).toHaveTextContent('dark');
    });
  });

  describe('children rendering', () => {
    it('renders children correctly', () => {
      render(
        <ThemeProvider>
          <div data-testid="child">Hello World</div>
        </ThemeProvider>
      );

      expect(screen.getByTestId('child')).toHaveTextContent('Hello World');
    });
  });

  describe('settings-synced event', () => {
    it('updates theme when settings-synced event is dispatched', async () => {
      render(
        <ThemeProvider defaultTheme="light">
          <TestConsumer />
        </ThemeProvider>
      );

      expect(screen.getByTestId('theme')).toHaveTextContent('light');

      act(() => {
        window.dispatchEvent(
          new CustomEvent('settings-synced', {
            detail: { settings: { theme: 'dark' } }
          })
        );
      });

      expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    });

    it('updates to tokyo-night theme from settings-synced event', async () => {
      render(
        <ThemeProvider defaultTheme="light">
          <TestConsumer />
        </ThemeProvider>
      );

      act(() => {
        window.dispatchEvent(
          new CustomEvent('settings-synced', {
            detail: { settings: { theme: 'tokyo-night' } }
          })
        );
      });

      expect(screen.getByTestId('theme')).toHaveTextContent('tokyo-night');
    });

    it('updates to monochrome theme from settings-synced event', async () => {
      render(
        <ThemeProvider defaultTheme="light">
          <TestConsumer />
        </ThemeProvider>
      );

      act(() => {
        window.dispatchEvent(
          new CustomEvent('settings-synced', {
            detail: { settings: { theme: 'monochrome' } }
          })
        );
      });

      expect(screen.getByTestId('theme')).toHaveTextContent('monochrome');
    });

    it('ignores invalid theme in settings-synced event', async () => {
      render(
        <ThemeProvider defaultTheme="light">
          <TestConsumer />
        </ThemeProvider>
      );

      act(() => {
        window.dispatchEvent(
          new CustomEvent('settings-synced', {
            detail: { settings: { theme: 'invalid-theme' } }
          })
        );
      });

      // Should remain light
      expect(screen.getByTestId('theme')).toHaveTextContent('light');
    });

    it('ignores settings-synced event without theme', async () => {
      render(
        <ThemeProvider defaultTheme="dark">
          <TestConsumer />
        </ThemeProvider>
      );

      act(() => {
        window.dispatchEvent(
          new CustomEvent('settings-synced', {
            detail: { settings: { language: 'es' } }
          })
        );
      });

      // Should remain dark
      expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    });

    it('updates DOM class when theme changes via settings-synced', async () => {
      render(
        <ThemeProvider defaultTheme="light">
          <TestConsumer />
        </ThemeProvider>
      );

      expect(document.documentElement.classList.contains('light')).toBe(true);

      act(() => {
        window.dispatchEvent(
          new CustomEvent('settings-synced', {
            detail: { settings: { theme: 'dark' } }
          })
        );
      });

      expect(document.documentElement.classList.contains('dark')).toBe(true);
      expect(document.documentElement.classList.contains('light')).toBe(false);
    });
  });
});
