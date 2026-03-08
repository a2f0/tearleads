import { describe, expect, it } from 'vitest';
import { installBrowserGlobalsForBun } from './index';

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
});
