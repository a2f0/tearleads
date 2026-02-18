import { describe, expect, it } from 'vitest';
import { DROPDOWN_MENU_Z_INDEX } from './zIndex.js';

describe('zIndex constants', () => {
  it('exports dropdown menu z-index', () => {
    expect(DROPDOWN_MENU_Z_INDEX).toBe(10000);
  });
});
