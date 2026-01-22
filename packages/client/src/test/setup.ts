import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createElement, Fragment } from 'react';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import failOnConsole from 'vitest-fail-on-console';

// Enable React act() environment checks before tests run.
// https://react.dev/reference/react-dom/test-utils/act#environment
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  value: true,
  writable: true
});

// Initialize i18n for tests (side-effect import)
import '../i18n';
import { server } from './msw/server';

// Guardrail: fail tests on console warnings/errors unless tests explicitly mock or assert them.
// Agents: do not add allow/skip exceptions here; ask the user first if changes are needed.
failOnConsole();

vi.mock('@rapid/ui', async () => {
  const actual =
    await vi.importActual<typeof import('@rapid/ui')>('@rapid/ui');

  return {
    ...actual,
    Tooltip: ({ children }: { children: ReactNode }) =>
      createElement(Fragment, null, children),
    TooltipTrigger: ({ children }: { children: ReactNode }) =>
      createElement(Fragment, null, children),
    TooltipContent: ({ children, ...props }: { children: ReactNode }) =>
      createElement('span', props, children)
  };
});

// Mock @ionic/core gestures to avoid DOM issues in jsdom
vi.mock('@ionic/core', () => ({
  createGesture: vi.fn(() => ({
    enable: vi.fn(),
    destroy: vi.fn()
  }))
}));

// Mock pdfjs-dist to avoid DOMMatrix requirement in jsdom
vi.mock('pdfjs-dist', () => {
  const mockPage = {
    getViewport: vi.fn().mockReturnValue({ width: 612, height: 792 }),
    render: vi.fn().mockReturnValue({ promise: Promise.resolve() })
  };
  const mockPdf = {
    numPages: 1,
    getPage: vi.fn().mockResolvedValue(mockPage),
    destroy: vi.fn().mockResolvedValue(undefined)
  };
  return {
    getDocument: vi.fn().mockReturnValue({
      promise: Promise.resolve(mockPdf)
    }),
    GlobalWorkerOptions: { workerSrc: '' }
  };
});

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'warn' });
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

// Mock __APP_VERSION__ global defined by Vite
vi.stubGlobal('__APP_VERSION__', '0.0.0-test');

// Mock import.meta.env
vi.stubGlobal('import.meta', {
  env: {
    MODE: 'test',
    VITE_API_URL: 'http://localhost'
  }
});

// Mock localStorage
const localStorageStore: Record<string, string> = {};
Object.defineProperty(window, 'localStorage', {
  value: {
    getItem: vi.fn((key: string) => localStorageStore[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      localStorageStore[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete localStorageStore[key];
    }),
    clear: vi.fn(() => {
      for (const key of Object.keys(localStorageStore)) {
        delete localStorageStore[key];
      }
    }),
    key: vi.fn(
      (index: number) => Object.keys(localStorageStore)[index] ?? null
    ),
    get length() {
      return Object.keys(localStorageStore).length;
    }
  },
  writable: true
});

// Mock matchMedia for ThemeProvider
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn()
  }))
});

// Mock IntersectionObserver for components that use it
class MockIntersectionObserver {
  readonly root: Element | Document | null = null;
  readonly rootMargin: string = '';
  readonly thresholds: ReadonlyArray<number> = [];

  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}
vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);

// Mock ResizeObserver for components that use it (e.g., DurationChart)
class MockResizeObserver implements ResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
vi.stubGlobal('ResizeObserver', MockResizeObserver);
