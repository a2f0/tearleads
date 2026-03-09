import { describe, expect, it } from 'vitest';
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
});
