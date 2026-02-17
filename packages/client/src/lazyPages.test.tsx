import { describe, expect, it } from 'vitest';
import * as lazyPages from './lazyPages';

describe('lazyPages', () => {
  it('exports lazy React components for all pages', () => {
    const entries = Object.entries(lazyPages);

    expect(entries.length).toBeGreaterThan(0);

    for (const [name, page] of entries) {
      expect(name.length).toBeGreaterThan(0);
      expect(page).toBeTruthy();
      expect(typeof page).toBe('object');

      if (typeof page === 'object' && page !== null) {
        expect('$$typeof' in page).toBe(true);
      }
    }
  });
});
