import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildCompatibilityInventoryMarkdown,
  type CompatibilityInventoryReport,
  detectCompatibilityPatternCounts
} from './compatibilityInventoryLib.ts';

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

  it('counts import.meta.glob usages', () => {
    const source = `
      const modules = import.meta.glob('./fixtures/*.md', {
        eager: true
      });
      const typed = import.meta.glob<Record<string, string>>('./*.json');
      const notCounted = import.meta.resolve('./fixtures/foo.md');
    `;

    const counts = detectCompatibilityPatternCounts(source);

    assert.equal(counts.importMetaGlob, 2);
  });
});

describe('buildCompatibilityInventoryMarkdown', () => {
  it('summarizes DOM setup blockers in top blockers table', () => {
    const report: CompatibilityInventoryReport = {
      generatedAt: '2026-03-09T00:00:00.000Z',
      summary: {
        packagesWithTests: 1,
        bunPrimaryPackages: 0,
        bunAutoFallbackPackages: 0,
        vitestPrimaryPackages: 1,
        packagesWithJsdomIndicators: 1,
        packagesWithHighRiskVitestApis: 1
      },
      packages: [
        {
          packageName: '@tearleads/demo',
          testFileCount: 2,
          testScriptMode: 'vitest-primary',
          hasTestVitestScript: false,
          jsdomIndicators: [
            '@testing-library/jest-dom dependency',
            '@testing-library/jest-dom/vitest import',
            'DOM test environment in vitest config',
            'jsdom dependency'
          ],
          compatPatternCounts: {
            viHoisted: 0,
            viImportActual: 0,
            viMockImportOriginal: 0,
            viWaitFor: 0,
            importMetaGlob: 0,
            viResetModules: 0,
            viMocked: 0,
            viStubEnv: 0,
            viStubGlobal: 0
          },
          riskScore: 5,
          readiness: 'high-remediation',
          blockers: [
            'DOM setup (@testing-library/jest-dom dependency; @testing-library/jest-dom/vitest import; DOM test environment in vitest config; jsdom dependency)',
            'test script is vitest-primary'
          ]
        }
      ]
    };

    const markdown = buildCompatibilityInventoryMarkdown(report);

    assert.match(
      markdown,
      /\| `@tearleads\/demo` \| 5 \| DOM setup \(4 indicators; see Package Inventory\), test script is vitest-primary \|/
    );
    assert.match(
      markdown,
      /@testing-library\/jest-dom dependency; @testing-library\/jest-dom\/vitest import; DOM test environment in vitest config; jsdom dependency/
    );
  });
});
