import fs from 'node:fs';
import path from 'node:path';
import { classifyTestScript, type TestScriptMode } from './testScriptMode.ts';

export type PackageReadiness =
  | 'ready'
  | 'needs-remediation'
  | 'high-remediation';

interface PackageJsonShape {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface PatternDefinition {
  key: string;
  label: string;
  pattern: RegExp;
  riskWeight: number;
  highRisk: boolean;
}

export interface PackageInventory {
  packageName: string;
  testFileCount: number;
  testScriptMode: TestScriptMode;
  hasTestVitestScript: boolean;
  jsdomIndicators: string[];
  compatPatternCounts: Record<string, number>;
  riskScore: number;
  readiness: PackageReadiness;
  blockers: string[];
}

export interface InventorySummary {
  packagesWithTests: number;
  bunPrimaryPackages: number;
  bunAutoFallbackPackages: number;
  vitestPrimaryPackages: number;
  packagesWithJsdomIndicators: number;
  packagesWithHighRiskVitestApis: number;
}

export interface CompatibilityInventoryReport {
  generatedAt: string;
  summary: InventorySummary;
  packages: PackageInventory[];
}

export const INVENTORY_MARKDOWN_RELATIVE_PATH =
  'docs/en/bun-compatibility-inventory.md';

const TEST_FILE_PATTERN =
  /(?:^|\/)__tests__\/|(?:^|\/)[^/]+\.(?:test|spec)\.[cm]?[jt]sx?$/;
const SOURCE_FILE_PATTERN = /\.[cm]?[jt]sx?$/;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.turbo']);

const COMPAT_PATTERNS: ReadonlyArray<PatternDefinition> = [
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

function toRepoRelative(repoRoot: string, absolutePath: string): string {
  return path.relative(repoRoot, absolutePath).split(path.sep).join('/');
}

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

function listFilesRecursive(rootDir: string): string[] {
  const output: string[] = [];
  const queue: string[] = [rootDir];

  while (queue.length > 0) {
    const currentDir = queue.pop();
    if (currentDir === undefined) {
      continue;
    }
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) {
          continue;
        }
        queue.push(path.join(currentDir, entry.name));
        continue;
      }
      if (entry.isFile()) {
        output.push(path.join(currentDir, entry.name));
      }
    }
  }

  return output;
}

function readPackageJson(
  repoRoot: string,
  packageDir: string
): PackageJsonShape {
  const packageJsonPath = path.join(packageDir, 'package.json');
  const packageJsonRaw = fs.readFileSync(packageJsonPath, 'utf8');
  const parsed = JSON.parse(packageJsonRaw) as unknown;
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(
      `Invalid package.json at ${toRepoRelative(repoRoot, packageJsonPath)}`
    );
  }
  return parsed as PackageJsonShape;
}

function hasDependency(
  packageJson: PackageJsonShape,
  dependencyName: string
): boolean {
  return (
    packageJson.dependencies?.[dependencyName] !== undefined ||
    packageJson.devDependencies?.[dependencyName] !== undefined
  );
}

function collectJsdomIndicators(
  packageJson: PackageJsonShape,
  sourceFiles: string[]
): string[] {
  const indicators = new Set<string>();
  if (hasDependency(packageJson, 'jsdom')) {
    indicators.add('jsdom dependency');
  }
  if (hasDependency(packageJson, '@testing-library/jest-dom')) {
    indicators.add('@testing-library/jest-dom dependency');
  }

  const vitestConfigFiles = sourceFiles.filter((filePath) =>
    /\/vitest\.config\.[cm]?[jt]s$/.test(filePath)
  );
  for (const configFile of vitestConfigFiles) {
    const content = fs.readFileSync(configFile, 'utf8');
    if (
      /environment\s*:\s*['"]jsdom['"]/.test(content) ||
      /environment\s*:\s*['"]happy-dom['"]/.test(content)
    ) {
      indicators.add('DOM test environment in vitest config');
    }
  }

  for (const sourceFile of sourceFiles) {
    const content = fs.readFileSync(sourceFile, 'utf8');
    if (content.includes('@testing-library/jest-dom/vitest')) {
      indicators.add('@testing-library/jest-dom/vitest import');
      break;
    }
  }

  return [...indicators].sort();
}

function calculateRiskScore(
  compatPatternCounts: Record<string, number>,
  jsdomIndicators: string[],
  testScriptMode: TestScriptMode
): number {
  let score = 0;
  for (const definition of COMPAT_PATTERNS) {
    if ((compatPatternCounts[definition.key] ?? 0) > 0) {
      score += definition.riskWeight;
    }
  }
  if (jsdomIndicators.length > 0) {
    score += 2;
  }
  if (testScriptMode === 'vitest-primary') {
    score += 3;
  } else if (testScriptMode === 'bun-auto-fallback') {
    score += 1;
  }
  return score;
}

function collectBlockers(
  compatPatternCounts: Record<string, number>,
  jsdomIndicators: string[],
  testScriptMode: TestScriptMode
): string[] {
  const blockers: string[] = [];
  for (const definition of COMPAT_PATTERNS) {
    const count = compatPatternCounts[definition.key] ?? 0;
    if (count > 0) {
      blockers.push(`${definition.label} (${count})`);
    }
  }
  if (jsdomIndicators.length > 0) {
    blockers.push(`DOM setup (${jsdomIndicators.join('; ')})`);
  }
  if (testScriptMode === 'bun-auto-fallback') {
    blockers.push('transitional test script uses bun auto-fallback');
  } else if (testScriptMode === 'vitest-primary') {
    blockers.push('test script is vitest-primary');
  }
  return blockers;
}

function buildPackageInventory(
  repoRoot: string,
  packageDir: string
): PackageInventory | null {
  const packageJson = readPackageJson(repoRoot, packageDir);
  const packageName = packageJson.name;
  if (packageName === undefined) {
    return null;
  }

  const allFiles = listFilesRecursive(packageDir);
  const sourceFiles = allFiles.filter((filePath) => {
    const relative = toRepoRelative(repoRoot, filePath);
    return SOURCE_FILE_PATTERN.test(relative) && !relative.endsWith('.d.ts');
  });
  const testFiles = sourceFiles.filter((filePath) =>
    TEST_FILE_PATTERN.test(toRepoRelative(repoRoot, filePath))
  );
  if (testFiles.length === 0) {
    return null;
  }

  const compatPatternCounts: Record<string, number> = {};
  for (const definition of COMPAT_PATTERNS) {
    compatPatternCounts[definition.key] = 0;
  }

  for (const sourceFile of sourceFiles) {
    const content = fs.readFileSync(sourceFile, 'utf8');
    const contentCounts = detectCompatibilityPatternCounts(content);
    for (const definition of COMPAT_PATTERNS) {
      const currentCount = compatPatternCounts[definition.key] ?? 0;
      compatPatternCounts[definition.key] =
        currentCount + (contentCounts[definition.key] ?? 0);
    }
  }

  const testScriptMode = classifyTestScript(packageJson.scripts?.test);
  const hasTestVitestScript = packageJson.scripts?.testVitest !== undefined;
  const jsdomIndicators = collectJsdomIndicators(packageJson, sourceFiles);
  const riskScore = calculateRiskScore(
    compatPatternCounts,
    jsdomIndicators,
    testScriptMode
  );
  const readiness: PackageReadiness =
    riskScore <= 1
      ? 'ready'
      : riskScore <= 4
        ? 'needs-remediation'
        : 'high-remediation';
  const blockers = collectBlockers(
    compatPatternCounts,
    jsdomIndicators,
    testScriptMode
  );

  return {
    packageName,
    testFileCount: testFiles.length,
    testScriptMode,
    hasTestVitestScript,
    jsdomIndicators,
    compatPatternCounts,
    riskScore,
    readiness,
    blockers
  };
}

function summarize(packages: PackageInventory[]): InventorySummary {
  let bunPrimaryPackages = 0;
  let bunAutoFallbackPackages = 0;
  let vitestPrimaryPackages = 0;
  let packagesWithJsdomIndicators = 0;
  let packagesWithHighRiskVitestApis = 0;

  for (const pkg of packages) {
    if (pkg.testScriptMode === 'bun-primary') {
      bunPrimaryPackages += 1;
    } else if (pkg.testScriptMode === 'bun-auto-fallback') {
      bunAutoFallbackPackages += 1;
    } else if (pkg.testScriptMode === 'vitest-primary') {
      vitestPrimaryPackages += 1;
    }
    if (pkg.jsdomIndicators.length > 0) {
      packagesWithJsdomIndicators += 1;
    }
    if (
      COMPAT_PATTERNS.some(
        (definition) =>
          definition.highRisk &&
          (pkg.compatPatternCounts[definition.key] ?? 0) > 0
      )
    ) {
      packagesWithHighRiskVitestApis += 1;
    }
  }

  return {
    packagesWithTests: packages.length,
    bunPrimaryPackages,
    bunAutoFallbackPackages,
    vitestPrimaryPackages,
    packagesWithJsdomIndicators,
    packagesWithHighRiskVitestApis
  };
}

export function generateCompatibilityInventoryReport(
  repoRoot: string,
  generatedAt: string
): CompatibilityInventoryReport {
  const packagesDir = path.join(repoRoot, 'packages');
  const packageDirs = fs
    .readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(packagesDir, entry.name))
    .filter((packageDir) =>
      fs.existsSync(path.join(packageDir, 'package.json'))
    );

  const inventories: PackageInventory[] = [];
  for (const packageDir of packageDirs) {
    const inventory = buildPackageInventory(repoRoot, packageDir);
    if (inventory !== null) {
      inventories.push(inventory);
    }
  }

  inventories.sort((a, b) => a.packageName.localeCompare(b.packageName));
  return {
    generatedAt,
    summary: summarize(inventories),
    packages: inventories
  };
}

export function buildCompatibilityInventoryMarkdown(
  report: CompatibilityInventoryReport
): string {
  const lines: string[] = [];
  const summary = report.summary;

  lines.push('# Bun Compatibility Inventory');
  lines.push('');
  lines.push(
    `Generated: \`${report.generatedAt}\` via \`node --experimental-strip-types scripts/bun/generateCompatibilityInventory.ts\`.`
  );
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Packages with tests: ${summary.packagesWithTests}`);
  lines.push(`- Bun-primary test scripts: ${summary.bunPrimaryPackages}`);
  lines.push(
    `- Transitional bun auto-fallback scripts: ${summary.bunAutoFallbackPackages}`
  );
  lines.push(`- Vitest-primary test scripts: ${summary.vitestPrimaryPackages}`);
  lines.push(
    `- Packages with DOM/jsdom indicators: ${summary.packagesWithJsdomIndicators}`
  );
  lines.push(
    `- Packages using high-risk Vitest APIs (\`vi.hoisted\`, \`vi.importActual\`, \`vi.mock(importOriginal)\`, \`vi.resetModules\`): ${summary.packagesWithHighRiskVitestApis}`
  );
  lines.push('');

  const blockers = [...report.packages]
    .filter((pkg) => pkg.blockers.length > 0)
    .sort(
      (a, b) =>
        b.riskScore - a.riskScore || a.packageName.localeCompare(b.packageName)
    )
    .slice(0, 15);

  lines.push('## Top Blockers');
  lines.push('');
  lines.push('| Package | Risk score | Blockers |');
  lines.push('| --- | ---: | --- |');
  if (blockers.length === 0) {
    lines.push('| _none_ | 0 | _none_ |');
  } else {
    for (const pkg of blockers) {
      lines.push(
        `| \`${pkg.packageName}\` | ${pkg.riskScore} | ${pkg.blockers.join(', ')} |`
      );
    }
  }
  lines.push('');

  lines.push('## Package Inventory');
  lines.push('');
  lines.push(
    '| Package | Tests | Script mode | Vitest fallback script | Advanced APIs | DOM indicators | Readiness |'
  );
  lines.push('| --- | ---: | --- | --- | --- | --- | --- |');

  const sortedPackages = [...report.packages].sort(
    (a, b) =>
      b.riskScore - a.riskScore || a.packageName.localeCompare(b.packageName)
  );
  for (const pkg of sortedPackages) {
    const advancedApis = COMPAT_PATTERNS.filter(
      (definition) => (pkg.compatPatternCounts[definition.key] ?? 0) > 0
    )
      .map(
        (definition) =>
          `${definition.label}:${pkg.compatPatternCounts[definition.key]}`
      )
      .join(', ');
    const domIndicators =
      pkg.jsdomIndicators.length === 0
        ? 'none'
        : pkg.jsdomIndicators.join('; ');

    lines.push(
      `| \`${pkg.packageName}\` | ${pkg.testFileCount} | \`${pkg.testScriptMode}\` | ${
        pkg.hasTestVitestScript ? 'yes' : 'no'
      } | ${advancedApis.length > 0 ? advancedApis : 'none'} | ${domIndicators} | \`${
        pkg.readiness
      }\` |`
    );
  }

  lines.push('');
  lines.push('## Notes');
  lines.push('');
  lines.push(
    '- This inventory is heuristic and intended for Phase 4 planning, not as an absolute compatibility verdict.'
  );
  lines.push(
    '- Prioritize high-risk packages first for shared adapter work and targeted codemods before promoting `bun test`.'
  );

  return `${lines.join('\n')}\n`;
}

export function normalizeInventoryMarkdownForCheck(
  markdownText: string
): string {
  return markdownText.replace(
    /Generated: `[^`]+` via `node --experimental-strip-types scripts\/bun\/generateCompatibilityInventory\.ts`\./,
    'Generated: `__GENERATED_AT__` via `node --experimental-strip-types scripts/bun/generateCompatibilityInventory.ts`.'
  );
}
