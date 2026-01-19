import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPreserveWindowState,
  getPreserveWindowState,
  setPreserveWindowState,
  subscribePreserveWindowState
} from './windowStatePreference';

describe('windowStatePreference', () => {
  beforeEach(() => {
    localStorage.clear();
    clearPreserveWindowState();
  });

  it('defaults to preserving window state', () => {
    expect(getPreserveWindowState()).toBe(true);
  });

  it('reads stored preference when present', () => {
    localStorage.setItem('window-state-preserve', 'false');

    expect(getPreserveWindowState()).toBe(false);
  });

  it('falls back to default for invalid stored values', () => {
    localStorage.setItem('window-state-preserve', 'maybe');

    expect(getPreserveWindowState()).toBe(true);
  });

  it('clears saved window dimensions when disabled', () => {
    localStorage.setItem(
      'window-dimensions:notes',
      JSON.stringify({ width: 400, height: 300, x: 10, y: 20 })
    );
    localStorage.setItem('other-key', 'keep');

    setPreserveWindowState(false);

    expect(localStorage.getItem('window-state-preserve')).toBe('false');
    expect(localStorage.getItem('window-dimensions:notes')).toBeNull();
    expect(localStorage.getItem('other-key')).toBe('keep');
  });

  it('notifies subscribers when preference changes', () => {
    const listener = vi.fn();
    const unsubscribe = subscribePreserveWindowState(listener);

    setPreserveWindowState(false);

    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });
});
