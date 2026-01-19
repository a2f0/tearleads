import { describe, expect, it } from 'vitest';
import { mockConsoleError, mockConsoleWarn } from './console-mocks.js';

describe('console mocks', () => {
  it('stubs console.error', () => {
    const spy = mockConsoleError();
    console.error('oops');
    expect(spy).toHaveBeenCalledWith('oops');
    spy.mockRestore();
  });

  it('stubs console.warn', () => {
    const spy = mockConsoleWarn();
    console.warn('warn');
    expect(spy).toHaveBeenCalledWith('warn');
    spy.mockRestore();
  });
});
