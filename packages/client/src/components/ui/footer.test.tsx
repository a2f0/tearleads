import { describe, expect, it } from 'vitest';
import { Footer } from './footer';

describe('Footer', () => {
  it('exports Footer component from @tearleads/ui', () => {
    expect(Footer).toBeDefined();
    expect(typeof Footer).toBe('function');
  });
});
