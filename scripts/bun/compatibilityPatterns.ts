export interface PatternDefinition {
  key: string;
  label: string;
  pattern: RegExp;
  riskWeight: number;
  highRisk: boolean;
}

export const COMPAT_PATTERNS: ReadonlyArray<PatternDefinition> = [
  {
    key: 'viHoisted',
    label: 'vi.hoisted',
    pattern: /\bvi\.hoisted\s*(?:<[^>]*>)?\s*\(/g,
    riskWeight: 5,
    highRisk: true
  },
  {
    key: 'viImportActual',
    label: 'vi.importActual',
    pattern: /\bvi\.importActual\s*(?:<[^>]*>)?\s*\(/g,
    riskWeight: 4,
    highRisk: true
  },
  {
    key: 'viMockImportOriginal',
    label: 'vi.mock(importOriginal)',
    pattern: /\bvi\.mock\s*\(\s*[^,\n]+,\s*(?:async\s*)?\(\s*importOriginal\b/g,
    riskWeight: 4,
    highRisk: true
  },
  {
    key: 'viWaitFor',
    label: 'vi.waitFor',
    pattern: /\bvi\.waitFor\s*(?:<[^>]*>)?\s*\(/g,
    riskWeight: 3,
    highRisk: true
  },
  {
    key: 'importMetaGlob',
    label: 'import.meta.glob',
    pattern: /\bimport\.meta\.glob\s*(?:<[^)]*>)?\s*\(/g,
    riskWeight: 3,
    highRisk: true
  },
  {
    key: 'viResetModules',
    label: 'vi.resetModules',
    pattern: /\bvi\.resetModules\s*\(/g,
    riskWeight: 3,
    highRisk: true
  },
  {
    key: 'viMocked',
    label: 'vi.mocked',
    pattern: /\bvi\.mocked\s*\(/g,
    riskWeight: 2,
    highRisk: false
  },
  {
    key: 'viStubEnv',
    label: 'vi.stubEnv',
    pattern: /\bvi\.stubEnv\s*\(/g,
    riskWeight: 1,
    highRisk: false
  }
];

function countMatches(sourceText: string, pattern: RegExp): number {
  const matches = sourceText.match(pattern);
  return matches === null ? 0 : matches.length;
}

export function detectCompatibilityPatternCounts(
  sourceText: string
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const definition of COMPAT_PATTERNS) {
    counts[definition.key] = countMatches(sourceText, definition.pattern);
  }
  return counts;
}
