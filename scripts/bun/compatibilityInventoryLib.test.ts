import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
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
});
