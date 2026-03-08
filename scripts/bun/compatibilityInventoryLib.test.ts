import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectCompatibilityPatternCounts } from './compatibilityInventoryLib.ts';

describe('detectCompatibilityPatternCounts', () => {
  it('counts vi.mock(importOriginal) variants', () => {
    const source = `
      vi.mock('@tearleads/ui', async (importOriginal) => {
        const actual = await importOriginal<typeof import('@tearleads/ui')>();
        return { ...actual };
      });
      vi.mock("@tearleads/window-manager", (importOriginal) => {
        return importOriginal();
      });
      vi.mock(moduleSpecifier, async (importOriginal) => importOriginal());
    `;

    const counts = detectCompatibilityPatternCounts(source);

    assert.equal(counts.viMockImportOriginal, 3);
  });

  it('does not count other vi.mock callback parameter names', () => {
    const source = `
      vi.mock('@tearleads/ui', async (importModule) => {
        return importModule();
      });
    `;

    const counts = detectCompatibilityPatternCounts(source);

    assert.equal(counts.viMockImportOriginal, 0);
  });

  it('matches multiline first-argument formatting', () => {
    const source = `
      vi.mock(
        '@tearleads/ui',
        async (importOriginal) => {
          return importOriginal();
        }
      );
    `;

    const counts = detectCompatibilityPatternCounts(source);

    assert.equal(counts.viMockImportOriginal, 1);
  });

  it('counts vi.waitFor usages', () => {
    const source = `
      await vi.waitFor(() => expect(button).toBeDisabled());
      await vi.waitFor<{ ready: boolean }>(() => {
        return { ready: true };
      });
      await waitFor(() => expect(input).toHaveFocus());
    `;

    const counts = detectCompatibilityPatternCounts(source);

    assert.equal(counts.viWaitFor, 2);
  });
});
