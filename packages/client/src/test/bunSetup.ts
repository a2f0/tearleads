import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import '@testing-library/jest-dom/vitest';
import {
  installBrowserGlobalsForBun,
  installVitestPolyfills
} from '@tearleads/bun-dom-compat';
import { cleanup } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeAll, vi } from 'vitest';
import { installBunPolyfills } from './bunPolyfills';

// Install jsdom globals before anything else
installBrowserGlobalsForBun();

// Preload compliance markdown modules for Bun (replaces Vite import.meta.glob)
const COMPLIANCE_MARKDOWN_MODULES_GLOBAL =
  '__TEARLEADS_COMPLIANCE_MARKDOWN_MODULES__';
const COMPLIANCE_DOCS_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../compliance'
);

function collectMarkdownFiles(currentDir: string): string[] {
  const markdownFiles: string[] = [];
  const entries = readdirSync(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      markdownFiles.push(...collectMarkdownFiles(entryPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.md')) {
      markdownFiles.push(entryPath);
    }
  }

  return markdownFiles;
}

function preloadComplianceMarkdownModulesForBun(): void {
  if (typeof Reflect.get(import.meta, 'glob') === 'function') {
    return;
  }

  if (
    typeof Reflect.get(globalThis, COMPLIANCE_MARKDOWN_MODULES_GLOBAL) ===
    'object'
  ) {
    return;
  }

  const markdownModules: Record<string, string> = {};
  const markdownFilePaths = collectMarkdownFiles(COMPLIANCE_DOCS_ROOT);
  for (const filePath of markdownFilePaths) {
    markdownModules[filePath] = readFileSync(filePath, 'utf8');
  }

  Reflect.set(globalThis, COMPLIANCE_MARKDOWN_MODULES_GLOBAL, markdownModules);
}

preloadComplianceMarkdownModulesForBun();

const { hasCustomStubber, unstubAllGlobals } = installVitestPolyfills(vi);

// Initialize i18n for tests (side-effect import, no virtual:app-config dependency)
import '../i18n/testI18n';

// Bun-specific console capture (equivalent to failOnConsole)
installBunPolyfills();

// Install WASM bindings override (shared with vitest setup)
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

// Enable React act() environment checks before tests run.
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  value: true,
  writable: true
});

// Mock virtual:app-config (Vite virtual module, unavailable under Bun)
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

vi.mock('@/db/hooks/useHostRuntimeDatabaseState', () => ({
  useHostRuntimeDatabaseState: () => ({
    isUnlocked: true,
    isLoading: false,
    currentInstanceId: null
  })
}));

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

vi.mock('@/components/window-sync', () => ({
  SyncWindow: createMockWindow('sync', { width: 400, height: 450 })
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

beforeAll(() => {
  installApiV2WasmBindingsOverride();
});

afterEach(() => {
  if (hasCustomStubber) {
    unstubAllGlobals();
  }
  cleanup();
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
