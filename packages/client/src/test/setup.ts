import '@testing-library/jest-dom/vitest';
import { createTestContext, type TestContext } from '@tearleads/api-test-utils';
import {
  configureForExpressPassthrough,
  getRecordedApiRequests,
  resetMockApiServerState,
  server
} from '@tearleads/msw/node';
import { cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createElement, Fragment } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, expect, vi } from 'vitest';
import failOnConsole from 'vitest-fail-on-console';
import {
  resetSharedTestContextAccessed,
  setSharedTestContext,
  wasSharedTestContextAccessed
} from './testContext';

let testContext: TestContext | null = null;

const REAL_API_TEST_PATH_PATTERNS = [
  /\/src\/lib\/api\.msw(?:\..+)?\.test\.tsx?$/,
  /\/src\/test\/msw\/.*\.test\.tsx?$/
];

function shouldUseRealApiForCurrentTest(): boolean {
  const testPath = expect.getState().testPath;
  if (typeof testPath !== 'string') {
    return false;
  }
  return REAL_API_TEST_PATH_PATTERNS.some((pattern) => pattern.test(testPath));
}

async function ensureRealApiTestContext(): Promise<TestContext> {
  if (testContext) {
    return testContext;
  }
  testContext = await createTestContext(async () => {
    const api = await import('@tearleads/api');
    return { app: api.app, migrations: api.migrations };
  });
  setSharedTestContext(testContext);
  return testContext;
}

// Enable React act() environment checks before tests run.
// https://react.dev/reference/react-dom/test-utils/act#environment
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  value: true,
  writable: true
});

if (typeof window.confirm !== 'function') {
  Object.defineProperty(window, 'confirm', {
    value: () => true,
    writable: true,
    configurable: true
  });
}

// happy-dom replaces fetch/Response; Node's instantiateStreaming performs
// strict brand checks on Response instances. Use arrayBuffer-based instantiate
// in tests to avoid Response constructor mismatches.
const originalInstantiateStreaming = WebAssembly.instantiateStreaming;
if (originalInstantiateStreaming) {
  Object.defineProperty(WebAssembly, 'instantiateStreaming', {
    configurable: true,
    writable: true,
    value: async (
      source: Promise<Response> | Response,
      importObject: WebAssembly.Imports
    ): Promise<WebAssembly.WebAssemblyInstantiatedSource> => {
      const resolvedSource = await source;
      const bytes = await resolvedSource.arrayBuffer();
      return WebAssembly.instantiate(bytes, importObject);
    }
  });
}

// Initialize i18n for tests (side-effect import)
import '../i18n';

// Guardrail: fail tests on console warnings/errors unless tests explicitly mock or assert them.
// Agents: do not add allow/skip exceptions here; ask the user first if changes are needed.
failOnConsole();

vi.mock('@tearleads/ui', async () => {
  const actual =
    await vi.importActual<typeof import('@tearleads/ui')>('@tearleads/ui');

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

vi.mock('@/components/console-window', () => ({
  ConsoleWindow: ({
    id,
    onClose,
    onMinimize,
    onFocus,
    zIndex,
    initialDimensions
  }: {
    id: string;
    onClose: () => void;
    onMinimize: (dimensions: {
      x: number;
      y: number;
      width: number;
      height: number;
    }) => void;
    onFocus: () => void;
    zIndex: number;
    initialDimensions?: { width?: number } | undefined;
  }) =>
    createElement(
      'div',
      {
        'data-testid': `console-window-${id}`,
        'data-initial-width': initialDimensions?.width,
        'data-zindex': zIndex,
        onClick: onFocus
      },
      createElement(
        'button',
        {
          type: 'button',
          onClick: onClose,
          'data-testid': `close-${id}`
        },
        'Close'
      ),
      createElement(
        'button',
        {
          type: 'button',
          onClick: () =>
            onMinimize({
              x: 0,
              y: 0,
              width: 600,
              height: 400
            }),
          'data-testid': `minimize-${id}`
        },
        'Minimize'
      )
    )
}));

type MockWindowProps = {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => void;
  onFocus: () => void;
  zIndex: number;
};

function createMockWindow(
  name: string,
  minimizeDimensions: { width: number; height: number }
) {
  return ({ id, onClose, onMinimize, onFocus, zIndex }: MockWindowProps) =>
    createElement(
      'div',
      {
        role: 'dialog',
        'data-testid': `${name}-window-${id}`,
        'data-zindex': zIndex,
        onClick: onFocus
      },
      createElement(
        'button',
        {
          type: 'button',
          onClick: onClose,
          'data-testid': `close-${id}`
        },
        'Close'
      ),
      createElement(
        'button',
        {
          type: 'button',
          onClick: () => onMinimize({ x: 0, y: 0, ...minimizeDimensions }),
          'data-testid': `minimize-${id}`
        },
        'Minimize'
      )
    );
}

vi.mock('@/components/keychain-window', () => ({
  KeychainWindow: createMockWindow('keychain', { width: 600, height: 500 })
}));

vi.mock('@/components/sync-window', () => ({
  SyncWindow: createMockWindow('sync', { width: 400, height: 450 })
}));

vi.mock('@/components/admin-windows', () => ({
  AdminWindow: createMockWindow('admin', { width: 700, height: 600 }),
  AdminRedisWindow: createMockWindow('admin-redis', {
    width: 700,
    height: 600
  }),
  AdminPostgresWindow: createMockWindow('admin-postgres', {
    width: 700,
    height: 600
  }),
  AdminGroupsWindow: createMockWindow('admin-groups', {
    width: 700,
    height: 600
  }),
  AdminUsersWindow: createMockWindow('admin-users', {
    width: 700,
    height: 600
  }),
  AdminOrganizationsWindow: createMockWindow('admin-organizations', {
    width: 840,
    height: 620
  })
}));

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

beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'warn' });
});

beforeEach(async () => {
  if (!shouldUseRealApiForCurrentTest()) {
    return;
  }
  const ctx = await ensureRealApiTestContext();
  configureForExpressPassthrough('http://localhost', ctx.port);
});

afterEach(async () => {
  cleanup();
  server.resetHandlers();
  if (testContext) {
    configureForExpressPassthrough('http://localhost', testContext.port);
    const usedApi = getRecordedApiRequests().length > 0;
    const usedSharedContext = wasSharedTestContextAccessed();
    if (usedApi || usedSharedContext) {
      await testContext.resetState();
    }
  }
  resetMockApiServerState();
  resetSharedTestContextAccessed();
});

afterAll(async () => {
  server.close();
  await testContext?.teardown();
  testContext = null;
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
