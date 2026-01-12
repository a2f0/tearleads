import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeAll, vi } from 'vitest';

// Initialize i18n for tests (side-effect import)
import '../i18n';

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

// Fail tests on React act() warnings
beforeAll(() => {
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    const message = typeof args[0] === 'string' ? args[0] : '';
    if (message.includes('not wrapped in act(')) {
      throw new Error(
        `React act() warning detected. Wrap state updates in act():\n${args.join(' ')}`
      );
    }
    originalError.apply(console, args);
  };
});

afterEach(() => {
  cleanup();
});

// Mock localStorage for tests
const localStorageMock: {
  store: Record<string, string>;
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  clear: () => void;
} = {
  store: {},
  getItem(key: string) {
    return this.store[key] ?? null;
  },
  setItem(key: string, value: string) {
    this.store[key] = value;
  },
  removeItem(key: string) {
    delete this.store[key];
  },
  clear() {
    this.store = {};
  }
};
Object.defineProperty(window, 'localStorage', {
  value: localStorageMock
});

// Mock __APP_VERSION__ global defined by Vite
vi.stubGlobal('__APP_VERSION__', '0.0.0-test');

// Mock import.meta.env
vi.stubGlobal('import.meta', {
  env: {
    MODE: 'test'
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
