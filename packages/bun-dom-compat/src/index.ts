import { JSDOM } from 'jsdom';

let installedDom = false;

function defineGlobal(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value
  });
}

function defineGlobalIfMissing(name: string, value: unknown): void {
  if (typeof Reflect.get(globalThis, name) !== 'undefined') {
    return;
  }
  defineGlobal(name, value);
}

function definePropertyIfMissing(
  target: object,
  property: string,
  value: unknown
): void {
  if (typeof Reflect.get(target, property) !== 'undefined') {
    return;
  }
  Object.defineProperty(target, property, {
    configurable: true,
    writable: true,
    value
  });
}

export function installBrowserGlobalsForBun(): void {
  if (
    installedDom ||
    (typeof globalThis.document !== 'undefined' &&
      typeof globalThis.localStorage !== 'undefined')
  ) {
    return;
  }

  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/'
  });

  defineGlobal('window', dom.window);
  defineGlobal('document', dom.window.document);
  defineGlobal('navigator', dom.window.navigator);
  defineGlobal('HTMLElement', dom.window.HTMLElement);
  defineGlobal('HTMLMediaElement', dom.window.HTMLMediaElement);
  defineGlobal('HTMLVideoElement', dom.window.HTMLVideoElement);
  defineGlobal('HTMLCanvasElement', dom.window.HTMLCanvasElement);
  defineGlobal('Node', dom.window.Node);
  defineGlobal('Event', dom.window.Event);
  defineGlobal('CustomEvent', dom.window.CustomEvent);
  defineGlobal('MouseEvent', dom.window.MouseEvent);
  defineGlobal('KeyboardEvent', dom.window.KeyboardEvent);
  defineGlobal('FocusEvent', dom.window.FocusEvent);
  defineGlobal('MutationObserver', dom.window.MutationObserver);
  defineGlobal(
    'getComputedStyle',
    dom.window.getComputedStyle.bind(dom.window)
  );
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get: () => dom.window.localStorage
  });
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    get: () => dom.window.sessionStorage
  });
  defineGlobalIfMissing('atob', dom.window.atob.bind(dom.window));
  defineGlobalIfMissing('btoa', dom.window.btoa.bind(dom.window));
  const requestAnimationFrameImpl =
    dom.window.requestAnimationFrame?.bind(dom.window) ??
    ((callback: FrameRequestCallback): number =>
      dom.window.setTimeout(() => {
        callback(Date.now());
      }, 16));
  const cancelAnimationFrameImpl =
    dom.window.cancelAnimationFrame?.bind(dom.window) ??
    ((handle: number): void => {
      dom.window.clearTimeout(handle);
    });
  defineGlobalIfMissing('requestAnimationFrame', requestAnimationFrameImpl);
  defineGlobalIfMissing('cancelAnimationFrame', cancelAnimationFrameImpl);
  definePropertyIfMissing(
    dom.window,
    'requestAnimationFrame',
    requestAnimationFrameImpl
  );
  definePropertyIfMissing(
    dom.window,
    'cancelAnimationFrame',
    cancelAnimationFrameImpl
  );
  definePropertyIfMissing(
    dom.window.HTMLElement.prototype,
    'attachEvent',
    () => {
      // React's input polyfill path still checks these legacy hooks.
    }
  );
  definePropertyIfMissing(
    dom.window.HTMLElement.prototype,
    'detachEvent',
    () => {
      // No-op keeps jsdom compatible with that branch.
    }
  );

  installedDom = true;
}

interface VitestPolyfillResult {
  hasCustomStubber: boolean;
  unstubAllGlobals: () => void;
}

/**
 * Install polyfills for `vi.hoisted`, `vi.mocked`, `vi.stubGlobal`, and
 * `vi.unstubAllGlobals` when running tests under Bun where these
 * Vitest helpers are unavailable.
 *
 * `vi.mocked` is an identity function in Vitest itself — it exists
 * purely for TypeScript type narrowing (`Mocked<T>`). The polyfill
 * mirrors that behaviour exactly.
 */
export function installVitestPolyfills(vi: object): VitestPolyfillResult {
  if (typeof Reflect.get(vi, 'hoisted') !== 'function') {
    Reflect.set(vi, 'hoisted', <T>(factory: () => T): T => factory());
  }

  if (typeof Reflect.get(vi, 'mocked') !== 'function') {
    Reflect.set(vi, 'mocked', <T>(value: T) => value);
  }

  let hasCustomStubber = false;
  let cleanup = (): void => {};

  if (typeof Reflect.get(vi, 'stubGlobal') !== 'function') {
    hasCustomStubber = true;
    const stubbedGlobals = new Map<
      string,
      { hadValue: boolean; value: unknown }
    >();

    Reflect.set(vi, 'stubGlobal', (name: string, value: unknown) => {
      if (!stubbedGlobals.has(name)) {
        stubbedGlobals.set(name, {
          hadValue: Reflect.has(globalThis, name),
          value: Reflect.get(globalThis, name)
        });
      }
      Object.defineProperty(globalThis, name, {
        configurable: true,
        writable: true,
        value
      });
    });

    cleanup = () => {
      for (const [name, original] of stubbedGlobals) {
        if (original.hadValue) {
          Object.defineProperty(globalThis, name, {
            configurable: true,
            writable: true,
            value: original.value
          });
        } else {
          Reflect.deleteProperty(globalThis, name);
        }
      }
      stubbedGlobals.clear();
    };

    Reflect.set(vi, 'unstubAllGlobals', cleanup);
  }

  return { hasCustomStubber, unstubAllGlobals: cleanup };
}

export function formatConsoleArg(arg: unknown): string {
  if (typeof arg === 'string') {
    return arg;
  }
  if (arg instanceof Error) {
    return arg.stack ?? arg.message;
  }
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}
