import '@testing-library/jest-dom/vitest';
import { installVitestPolyfills } from '@tearleads/bun-dom-compat';
import { cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createElement, Fragment } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, expect, vi } from 'vitest';
import failOnConsole from 'vitest-fail-on-console';

const isBun = typeof Reflect.get(globalThis, 'Bun') !== 'undefined';
const { hasCustomStubber, unstubAllGlobals } = installVitestPolyfills(vi);

// MSW and real-API helpers are vitest-only (MSW's WASM interceptor doesn't work under Bun)
import type {
  ApiV2ServiceHarness,
  TestContext
} from '@tearleads/api-test-utils';

const mswMod = isBun ? undefined : await import('@tearleads/msw/node');
const apiTestUtilsMod = isBun
  ? undefined
  : await import('@tearleads/api-test-utils');
const testContextMod = isBun ? undefined : await import('./testContext.js');

let testContext: TestContext | null = null;
let apiV2Harness: ApiV2ServiceHarness | null = null;

const REAL_API_TEST_PATH_PATTERNS = [
  /\/src\/lib\/api\.msw(?:\..+)?\.test\.tsx?$/,
  /\/src\/test\/msw\/.*\.test\.tsx?$/
];
const API_V2_ADMIN_ROUTE_PATTERN =
  /^\/(?:v1\/)?connect\/tearleads\.v2\.AdminService\//;

function installApiV2WasmBindingsOverride(): void {
  const normalizeConnectBaseUrl = (apiBaseUrl: string): string => {
    const trimmed = apiBaseUrl.trim();
    const normalizedBaseUrl = trimmed.replace(/\/+$/u, '');
    if (normalizedBaseUrl.length === 0) {
      return '/connect';
    }
    if (normalizedBaseUrl.endsWith('/connect')) {
      return normalizedBaseUrl;
    }
    return `${normalizedBaseUrl}/connect`;
  };

  const normalizeBearerToken = (bearerToken?: string | null): string | null => {
    if (typeof bearerToken !== 'string' || bearerToken.length === 0) {
      return null;
    }

    return /^Bearer\s+\S+\.\S+\.\S+$/.test(bearerToken)
      ? bearerToken
      : 'Bearer header.payload.signature';
  };

  Reflect.set(globalThis, '__tearleadsImportApiV2ClientWasmModule', () =>
    Promise.resolve({
      normalizeConnectBaseUrl,
      resolveRpcPath: (serviceName: string, methodName: string) =>
        `/${serviceName}/${methodName}`,
      getProtocolConfig: () => ({
        connectPrefix: '/connect',
        adminServiceName: 'tearleads.v2.AdminService',
        mlsServiceName: 'tearleads.v2.MlsService',
        authorizationHeader: 'authorization',
        organizationHeader: 'x-tearleads-organization-id'
      }),
      buildRequestHeaders: (bearerToken?: string | null) => {
        const normalizedBearerToken = normalizeBearerToken(bearerToken);
        return {
          headers: normalizedBearerToken
            ? { authorization: normalizedBearerToken }
            : {}
        };
      }
    })
  );
}

function shouldUseRealApiForCurrentTest(): boolean {
  if (isBun) {
    return false;
  }
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
  // Safe: this function is only called when !isBun, so apiTestUtilsMod is defined
  const mod = apiTestUtilsMod;
  if (!mod) {
    throw new Error('apiTestUtilsMod is unexpectedly undefined');
  }
  const { createTestContext, startApiV2ServiceHarness } = mod;
  const [createdTestContext, harness] = await Promise.all([
    createTestContext(async () => {
      const api = await import('@tearleads/api');
      return { app: api.app, migrations: api.migrations };
    }),
    startApiV2ServiceHarness()
  ]);
  testContext = createdTestContext;
  apiV2Harness = harness;
  testContextMod?.setSharedTestContext(testContext);
  return testContext;
}

function configurePassthroughRoutes(ctx: TestContext): void {
  const routeOverrides =
    apiV2Harness === null
      ? []
      : [
          {
            pathnamePattern: API_V2_ADMIN_ROUTE_PATTERN,
            targetPort: apiV2Harness.port,
            pathPrefix: '',
            stripPathPrefix: '/v1'
          }
        ];

  mswMod?.configureForExpressPassthrough(
    'http://localhost',
    ctx.port,
    '/v1',
    routeOverrides
  );
}

// Enable React act() environment checks before tests run.
// https://react.dev/reference/react-dom/test-utils/act#environment
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  value: true,
  writable: true
});

// Initialize i18n for tests (side-effect import, no virtual:app-config dependency)
import '../i18n/testI18n';

// Guardrail: fail tests on console warnings/errors unless tests explicitly mock or assert them.
// Agents: do not add allow/skip exceptions here; ask the user first if changes are needed.
if (!isBun) {
  failOnConsole();
} else {
  const { installBunPolyfills } = await import('./bunPolyfills.js');
  installBunPolyfills();
}

// Mock virtual:app-config (Vite virtual module, unavailable under Bun)
if (isBun) {
  vi.mock('virtual:app-config', () => ({
    default: {
      id: 'tearleads',
      displayName: 'Tearleads',
      features: [
        'admin',
        'analytics',
        'audio',
        'businesses',
        'calendar',
        'camera',
        'classic',
        'compliance',
        'contacts',
        'email',
        'health',
        'mls-chat',
        'notes',
        'sync',
        'terminal',
        'vehicles',
        'wallet'
      ]
    }
  }));
}

vi.mock('@/db/hooks/useHostRuntimeDatabaseState', () => ({
  useHostRuntimeDatabaseState: () => ({
    isUnlocked: true,
    isLoading: false,
    currentInstanceId: null
  })
}));

if (!isBun) {
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
}

vi.mock('@/components/window-console', () => ({
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

if (!isBun) {
  vi.mock('@tearleads/app-keychain/clientEntry', async () => ({
    ...(await vi.importActual<Record<string, unknown>>(
      '@tearleads/app-keychain/clientEntry'
    )),
    KeychainWindow: createMockWindow('keychain', { width: 600, height: 500 })
  }));
}

vi.mock('@/components/window-sync', () => ({
  SyncWindow: createMockWindow('sync', { width: 400, height: 450 })
}));

if (!isBun) {
  vi.mock('@tearleads/app-admin/clientEntry', async () => ({
    ...(await vi.importActual<Record<string, unknown>>(
      '@tearleads/app-admin/clientEntry'
    )),
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
}

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
  installApiV2WasmBindingsOverride();
  if (!isBun) {
    mswMod?.server.listen({ onUnhandledRequest: 'warn' });
  }
});

beforeEach(async () => {
  if (!shouldUseRealApiForCurrentTest()) {
    return;
  }
  const ctx = await ensureRealApiTestContext();
  configurePassthroughRoutes(ctx);
});

afterEach(async () => {
  if (hasCustomStubber) {
    unstubAllGlobals();
  }
  cleanup();
  if (!isBun) {
    mswMod?.server.resetHandlers();
    if (testContext) {
      configurePassthroughRoutes(testContext);
      const usedApi = (mswMod?.getRecordedApiRequests().length ?? 0) > 0;
      const usedSharedContext =
        testContextMod?.wasSharedTestContextAccessed() ?? false;
      if (usedApi || usedSharedContext) {
        await testContext.resetState();
      }
    }
    mswMod?.resetMockApiServerState();
    testContextMod?.resetSharedTestContextAccessed();
  }
});

afterAll(async () => {
  if (!isBun) {
    mswMod?.server.close();
    await apiV2Harness?.stop();
    apiV2Harness = null;
    await testContext?.teardown();
    testContext = null;
  }
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
