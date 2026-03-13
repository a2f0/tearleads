import { JSDOM } from 'jsdom';

let installedDom = false;

const WINDOW_GLOBAL_NAMES: ReadonlyArray<string> = [
  'Element',
  'HTMLElement',
  'HTMLMediaElement',
  'HTMLVideoElement',
  'HTMLCanvasElement',
  'HTMLButtonElement',
  'HTMLInputElement',
  'HTMLTextAreaElement',
  'HTMLSelectElement',
  'HTMLAnchorElement',
  'SVGElement',
  'Node',
  'NodeList',
  'Document',
  'DocumentFragment',
  'Storage',
  'EventTarget',
  'Event',
  'CustomEvent',
  'MouseEvent',
  'TouchEvent',
  'KeyboardEvent',
  'FocusEvent',
  'PointerEvent',
  'InputEvent',
  'MutationObserver',
  'ResizeObserver',
  'DOMRect'
];

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

function defineGlobalFromWindow(windowObject: object, name: string): void {
  const value = Reflect.get(windowObject, name);
  if (typeof value === 'undefined') {
    return;
  }
  defineGlobal(name, value);
}

interface TouchLike {
  clientX?: number;
  clientY?: number;
  identifier?: number;
  pageX?: number;
  pageY?: number;
  screenX?: number;
  screenY?: number;
  target?: EventTarget | null;
}

type TouchEventInitWithTouches = EventInit & {
  changedTouches?: ReadonlyArray<TouchLike>;
  targetTouches?: ReadonlyArray<TouchLike>;
  touches?: ReadonlyArray<TouchLike>;
};

function installTouchEventPolyfill(windowObject: object): void {
  if (typeof Reflect.get(globalThis, 'TouchEvent') === 'function') {
    return;
  }

  const eventCtor = Reflect.get(windowObject, 'Event');
  if (typeof eventCtor !== 'function') {
    return;
  }

  class BunTouchEvent extends Event {
    changedTouches: ReadonlyArray<TouchLike>;
    targetTouches: ReadonlyArray<TouchLike>;
    touches: ReadonlyArray<TouchLike>;

    constructor(type: string, init: TouchEventInitWithTouches = {}) {
      super(type, init);
      this.changedTouches = Array.from(init.changedTouches ?? []);
      this.targetTouches = Array.from(init.targetTouches ?? []);
      this.touches = Array.from(init.touches ?? []);
    }
  }

  defineGlobal('TouchEvent', BunTouchEvent);
  definePropertyIfMissing(windowObject, 'TouchEvent', BunTouchEvent);
}

export function installBrowserGlobalsForBun(): void {
  let windowObject: object;

  if (!installedDom) {
    if (
      typeof globalThis.window === 'undefined' ||
      typeof globalThis.document === 'undefined'
    ) {
      const dom = new JSDOM('<!doctype html><html><body></body></html>', {
        url: 'http://localhost/'
      });
      windowObject = dom.window;

      defineGlobal('window', dom.window);
      defineGlobal('document', dom.window.document);
      defineGlobal('navigator', dom.window.navigator);
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        get: () => dom.window.localStorage
      });
      Object.defineProperty(globalThis, 'sessionStorage', {
        configurable: true,
        get: () => dom.window.sessionStorage
      });
    } else {
      windowObject = globalThis.window;
    }

    installedDom = true;
  } else {
    windowObject = globalThis.window;
  }

  defineGlobalIfMissing('self', globalThis.window);
  for (const name of WINDOW_GLOBAL_NAMES) {
    defineGlobalFromWindow(windowObject, name);
  }
  installTouchEventPolyfill(windowObject);

  const getComputedStyleFn = Reflect.get(windowObject, 'getComputedStyle');
  if (typeof getComputedStyleFn === 'function') {
    defineGlobal('getComputedStyle', getComputedStyleFn.bind(windowObject));
  }

  const atobFn = Reflect.get(windowObject, 'atob');
  if (typeof atobFn === 'function') {
    defineGlobalIfMissing('atob', atobFn.bind(windowObject));
  }

  const btoaFn = Reflect.get(windowObject, 'btoa');
  if (typeof btoaFn === 'function') {
    defineGlobalIfMissing('btoa', btoaFn.bind(windowObject));
  }

  const timingWindow = globalThis.window;
  const requestAnimationFrameImpl =
    timingWindow.requestAnimationFrame?.bind(timingWindow) ??
    ((callback: FrameRequestCallback): number =>
      timingWindow.setTimeout(() => {
        callback(Date.now());
      }, 16));
  const cancelAnimationFrameImpl =
    timingWindow.cancelAnimationFrame?.bind(timingWindow) ??
    ((handle: number): void => {
      timingWindow.clearTimeout(handle);
    });
  defineGlobalIfMissing('requestAnimationFrame', requestAnimationFrameImpl);
  defineGlobalIfMissing('cancelAnimationFrame', cancelAnimationFrameImpl);

  definePropertyIfMissing(
    timingWindow,
    'requestAnimationFrame',
    requestAnimationFrameImpl
  );
  definePropertyIfMissing(
    timingWindow,
    'cancelAnimationFrame',
    cancelAnimationFrameImpl
  );

  const htmlElementCtor = Reflect.get(windowObject, 'HTMLElement');
  if (typeof htmlElementCtor === 'function') {
    const prototype = Reflect.get(htmlElementCtor, 'prototype');
    if (typeof prototype === 'object' && prototype !== null) {
      definePropertyIfMissing(prototype, 'attachEvent', () => {
        // React's input polyfill path still checks these legacy hooks.
      });
      definePropertyIfMissing(prototype, 'detachEvent', () => {
        // No-op keeps jsdom compatible with that branch.
      });
    }
  }
}

interface VitestPolyfillResult {
  hasCustomStubber: boolean;
  unstubAllGlobals: () => void;
}

/**
 * Install polyfills for Vitest helpers that are unavailable when running
 * tests under Bun: `vi.hoisted`, `vi.mocked`, `vi.stubGlobal`,
 * `vi.unstubAllGlobals`, `vi.setSystemTime`, `vi.advanceTimersByTimeAsync`,
 * and `vi.isMockFunction`.
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

  if (typeof Reflect.get(vi, 'isMockFunction') !== 'function') {
    Reflect.set(
      vi,
      'isMockFunction',
      (fn: unknown): boolean =>
        typeof fn === 'function' &&
        typeof Reflect.get(fn, 'mock') === 'object' &&
        Reflect.get(fn, 'mock') !== null
    );
  }

  if (typeof Reflect.get(vi, 'setSystemTime') !== 'function') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const bunTest = require('bun:test') as {
        setSystemTime: (date?: Date | number) => void;
      };
      Reflect.set(vi, 'setSystemTime', (date?: Date | number) => {
        bunTest.setSystemTime(date === undefined ? new Date() : date);
      });
    } catch {
      // Not running under Bun — skip polyfill.
    }
  }

  if (typeof Reflect.get(vi, 'advanceTimersByTimeAsync') !== 'function') {
    const syncAdvance = Reflect.get(vi, 'advanceTimersByTime') as
      | ((ms: number) => void)
      | undefined;
    if (typeof syncAdvance === 'function') {
      Reflect.set(
        vi,
        'advanceTimersByTimeAsync',
        async (ms: number): Promise<void> => {
          syncAdvance.call(vi, ms);
          // Flush microtask queue so pending promise callbacks settle.
          for (let i = 0; i < 10; i += 1) {
            await Promise.resolve();
          }
        }
      );
    }
  }

  let hasCustomStubber = false;
  let cleanup = (): void => {};

  if (typeof Reflect.get(vi, 'stubGlobal') !== 'function') {
    hasCustomStubber = true;
    const stubbedGlobals = new Map<
      string,
      { hadValue: boolean; value: unknown }
    >();
    const stubbedWindowGlobals = new Map<
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

      const windowObject = Reflect.get(globalThis, 'window');
      if (typeof windowObject === 'object' && windowObject !== null) {
        if (
          Reflect.has(windowObject, name) &&
          !stubbedWindowGlobals.has(name)
        ) {
          stubbedWindowGlobals.set(name, {
            hadValue: Reflect.has(windowObject, name),
            value: Reflect.get(windowObject, name)
          });
        }

        if (Reflect.has(windowObject, name)) {
          Object.defineProperty(windowObject, name, {
            configurable: true,
            writable: true,
            value
          });
        }
      }
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

      const windowObject = Reflect.get(globalThis, 'window');
      if (typeof windowObject === 'object' && windowObject !== null) {
        for (const [name, original] of stubbedWindowGlobals) {
          if (original.hadValue) {
            Object.defineProperty(windowObject, name, {
              configurable: true,
              writable: true,
              value: original.value
            });
          } else {
            Reflect.deleteProperty(windowObject, name);
          }
        }
      }
      stubbedWindowGlobals.clear();
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
