import { describe, expect, it, vi } from 'vitest';
import { installBrowserGlobalsForBun, installVitestPolyfills } from './index';

function getGlobal(name: string): unknown {
  return Reflect.get(globalThis, name);
}

describe('installBrowserGlobalsForBun', () => {
  it('installs core DOM globals used by Bun UI suites', () => {
    installBrowserGlobalsForBun();

    const requiredFunctionGlobals = [
      'Element',
      'Storage',
      'HTMLButtonElement',
      'HTMLInputElement',
      'MutationObserver'
    ];

    for (const name of requiredFunctionGlobals) {
      expect(typeof getGlobal(name)).toBe('function');
    }

    expect(getGlobal('window')).toBeDefined();
    expect(getGlobal('document')).toBeDefined();
  });

  it('polyfills TouchEvent when the runtime does not provide one', () => {
    const originalTouchEvent = Reflect.get(globalThis, 'TouchEvent');

    Reflect.deleteProperty(globalThis, 'TouchEvent');
    Reflect.deleteProperty(window, 'TouchEvent');

    installBrowserGlobalsForBun();

    const touchEventCtor = Reflect.get(globalThis, 'TouchEvent');
    expect(typeof touchEventCtor).toBe('function');

    const touchEvent = new TouchEvent('touchmove', {
      touches: [{ clientX: 12, clientY: 34 }]
    });

    expect(touchEvent.touches[0]?.clientX).toBe(12);
    expect(touchEvent.touches[0]?.clientY).toBe(34);

    if (typeof originalTouchEvent === 'function') {
      Object.defineProperty(globalThis, 'TouchEvent', {
        configurable: true,
        writable: true,
        value: originalTouchEvent
      });
      Object.defineProperty(window, 'TouchEvent', {
        configurable: true,
        writable: true,
        value: originalTouchEvent
      });
    }
  });

  it('syncs custom stubGlobal changes to window globals', () => {
    installBrowserGlobalsForBun();

    const viPolyfillTarget: Record<string, unknown> = {};
    const { hasCustomStubber, unstubAllGlobals } =
      installVitestPolyfills(viPolyfillTarget);

    expect(hasCustomStubber).toBe(true);

    const stubGlobal = Reflect.get(viPolyfillTarget, 'stubGlobal');
    if (typeof stubGlobal !== 'function') {
      throw new Error('Expected stubGlobal polyfill to be installed.');
    }

    const originalInnerWidth = window.innerWidth;
    Reflect.apply(stubGlobal, viPolyfillTarget, ['innerWidth', 800]);

    expect(globalThis.innerWidth).toBe(800);
    expect(window.innerWidth).toBe(800);

    unstubAllGlobals();
    expect(window.innerWidth).toBe(originalInnerWidth);
  });

  it('polyfills vi.isMockFunction to detect mock functions', () => {
    const target: Record<string, unknown> = {};
    installVitestPolyfills(target);

    const isMockFunction = target['isMockFunction'] as (
      fn: unknown
    ) => boolean;
    expect(typeof isMockFunction).toBe('function');

    const mockFn = vi.fn();
    expect(isMockFunction(mockFn)).toBe(true);
    expect(isMockFunction(() => {})).toBe(false);
    expect(isMockFunction(42)).toBe(false);
  });

  it('polyfills vi.advanceTimersByTimeAsync from sync advanceTimersByTime', async () => {
    const target: Record<string, unknown> = {
      advanceTimersByTime: vi.fn()
    };
    installVitestPolyfills(target);

    const advanceAsync = target['advanceTimersByTimeAsync'] as (
      ms: number
    ) => Promise<void>;
    expect(typeof advanceAsync).toBe('function');

    await advanceAsync(500);
    expect(target['advanceTimersByTime']).toHaveBeenCalledWith(500);
  });

  it('skips advanceTimersByTimeAsync polyfill when sync variant is already present', () => {
    const existingAsync = vi.fn();
    const target: Record<string, unknown> = {
      advanceTimersByTime: vi.fn(),
      advanceTimersByTimeAsync: existingAsync
    };
    installVitestPolyfills(target);

    expect(target['advanceTimersByTimeAsync']).toBe(existingAsync);
  });
});
