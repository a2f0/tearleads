#!/usr/bin/env -S pnpm exec tsx
/**
 * i18n Coverage and Hardcoded String Detection Tool
 *
 * This script scans TSX files for potential hardcoded strings that should be
 * translated, and checks translation key coverage across all supported languages.
 *
 * Usage:
 *   ./scripts/preen/checkI18nCoverage.ts           # Text summary
 *   ./scripts/preen/checkI18nCoverage.ts --json    # JSON output
 *   ./scripts/preen/checkI18nCoverage.ts --strict  # Exit 1 if issues found
 *
 * The script detects:
 * 1. Hardcoded JSX text content (e.g., <span>Hello</span>)
 * 2. Hardcoded user-facing attribute values (e.g., title="Hello", label="Submit")
 * 3. Missing translation keys across languages
 * 4. Orphan keys (keys in non-English files not in English source)
 */
import fs from 'node:fs/promises';
import path from 'node:path';

// ============================================================================
// Types
// ============================================================================

interface HardcodedString {
  file: string;
  line: number;
  column: number;
  type: 'jsx-text' | 'attribute' | 'array-literal';
  value: string;
  context: string;
  attributeName?: string;
}

interface LanguageCoverage {
  language: string;
  keyCount: number;
  missingFromEnglish: string[];
  orphanKeys: string[];
}

interface I18nCoverageResult {
  hardcodedStrings: HardcodedString[];
  englishKeyCount: number;
  languageCoverage: LanguageCoverage[];
  namespaces: string[];
}

// ============================================================================
// Configuration
// ============================================================================

const ROOT_DIR = process.cwd();
const PACKAGES_DIR = path.join(ROOT_DIR, 'packages');
const TRANSLATIONS_DIR = path.join(
  ROOT_DIR,
  'packages/client/src/i18n/translations'
);

// Directories and files to skip
const SKIP_PATTERNS = [
  '/node_modules/',
  '/.next/',
  '/dist/',
  '/coverage/',
  '.test.tsx',
  '.spec.tsx',
  '/test/',
  '/tests/',
  '/__tests__/',
  '/__mocks__/',
  '/mocks/'
];

// Attributes that commonly contain user-facing text
const USER_FACING_ATTRIBUTES = new Set([
  'title',
  'label',
  'placeholder',
  'alt',
  'aria-label',
  'aria-description',
  'trigger',
  'appName',
  'closeLabel',
  'description',
  'helperText',
  'errorMessage',
  'successMessage',
  'emptyMessage',
  'loadingText',
  'buttonText',
  'submitLabel',
  'cancelLabel',
  'confirmLabel',
  'header',
  'subheader',
  'tooltip'
]);

// Attributes to skip (technical, not user-facing)
const SKIP_ATTRIBUTES = new Set([
  'className',
  'class',
  'id',
  'data-testid',
  'data-test-id',
  'testId',
  'key',
  'ref',
  'name',
  'type',
  'role',
  'href',
  'src',
  'srcSet',
  'fill',
  'stroke',
  'viewBox',
  'd',
  'transform',
  'style',
  'pattern',
  'accept',
  'autoComplete',
  'autoFocus',
  'method',
  'action',
  'target',
  'rel',
  'xmlns',
  'version',
  'encoding'
]);

// Patterns for text that should be skipped (technical/code values)
const SKIP_TEXT_PATTERNS = [
  /^[A-Z_]+$/, // ALL_CAPS constants
  /^\d+(\.\d+)?$/, // Numbers
  /^#[0-9a-fA-F]{3,8}$/, // Hex colors
  /^(px|em|rem|%|vh|vw|pt)$/, // CSS units
  /^https?:\/\//, // URLs
  /^[a-z]+:\/\//, // Protocol URLs
  /^\{.*\}$/, // JSX expressions (curly braces)
  /^[./]/, // Paths
  /^@/, // Package scopes
  /^[a-z-]+\/[a-z-]+$/, // Package names
  /^(true|false|null|undefined)$/, // Boolean/null literals
  /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/, // HTTP methods
  /^[a-z]+_[a-z_]+$/i, // snake_case identifiers
  /^[a-z]+[A-Z][a-zA-Z]*$/ // camelCase identifiers (likely code)
];

// Minimum length for text to be considered translatable
const MIN_TEXT_LENGTH = 2;

// ============================================================================
// File System Utilities
// ============================================================================

const shouldSkipFile = (filePath: string): boolean => {
  const normalized = filePath.replace(/\\/g, '/');
  return SKIP_PATTERNS.some((pattern) => normalized.includes(pattern));
};

const listTsxFiles = async (directory: string): Promise<string[]> => {
  const files: string[] = [];

  const processDirectory = async (dir: string): Promise<void> => {
    let entries: Awaited<ReturnType<typeof fs.readdir>>;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const absolutePath = path.join(dir, entry.name);

      if (shouldSkipFile(absolutePath)) {
        continue;
      }

      if (entry.isDirectory()) {
        await processDirectory(absolutePath);
      } else if (entry.isFile() && entry.name.endsWith('.tsx')) {
        files.push(absolutePath);
      }
    }
  };

  await processDirectory(directory);
  return files;
};

// ============================================================================
// Text Analysis
// ============================================================================

const isLikelyTranslatableText = (text: string): boolean => {
  const trimmed = text.trim();

  // Too short
  if (trimmed.length < MIN_TEXT_LENGTH) {
    return false;
  }

  // Check skip patterns
  for (const pattern of SKIP_TEXT_PATTERNS) {
    if (pattern.test(trimmed)) {
      return false;
    }
  }

  // Must contain at least one letter
  if (!/[a-zA-Z]/.test(trimmed)) {
    return false;
  }

  // Single character followed by special chars (e.g., "x", "-")
  if (/^[a-zA-Z][-_:.]?$/.test(trimmed)) {
    return false;
  }

  // Likely CSS class or code identifier
  if (/^[a-z]+(-[a-z]+)+$/.test(trimmed) || /^[a-z]+_[a-z]+$/.test(trimmed)) {
    return false;
  }

  return true;
};

const getLineAndColumn = (
  content: string,
  index: number
): { line: number; column: number } => {
  const lines = content.substring(0, index).split('\n');
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1
  };
};

const getContextLine = (content: string, index: number): string => {
  const start = content.lastIndexOf('\n', index) + 1;
  const end = content.indexOf('\n', index);
  return content.substring(start, end === -1 ? content.length : end).trim();
};

// ============================================================================
// Hardcoded String Detection
// ============================================================================

const findHardcodedStrings = async (
  filePath: string
): Promise<HardcodedString[]> => {
  const content = await fs.readFile(filePath, 'utf8');
  const relativePath = path.relative(ROOT_DIR, filePath);
  const results: HardcodedString[] = [];

  // Pattern 1: JSX text content - text between > and <
  // Match: >Some Text< but not >{expression}<
  const jsxTextRegex = />([^<>{}\n]+)</g;
  let match: RegExpExecArray | null;

  match = jsxTextRegex.exec(content);
  while (match !== null) {
    const currentMatch = match;
    match = jsxTextRegex.exec(content);
    const text = currentMatch[1].trim();

    if (!isLikelyTranslatableText(text)) {
      continue;
    }

    // Skip if inside a comment
    const beforeMatch = content.substring(
      Math.max(0, currentMatch.index - 100),
      currentMatch.index
    );
    if (beforeMatch.includes('//') || beforeMatch.includes('/*')) {
      continue;
    }

    const { line, column } = getLineAndColumn(content, currentMatch.index);
    results.push({
      file: relativePath,
      line,
      column,
      type: 'jsx-text',
      value: text,
      context: getContextLine(content, currentMatch.index)
    });
  }

  // Pattern 2: User-facing attributes with string literals
  // Match: attribute="value" or attribute='value'
  const attributeRegex = /(\w+)=["']([^"']+)["']/g;

  match = attributeRegex.exec(content);
  while (match !== null) {
    const currentMatch = match;
    match = attributeRegex.exec(content);
    const attrName = currentMatch[1];
    const attrValue = currentMatch[2].trim();

    // Skip non-user-facing attributes
    if (SKIP_ATTRIBUTES.has(attrName)) {
      continue;
    }

    // Only check user-facing attributes
    if (!USER_FACING_ATTRIBUTES.has(attrName)) {
      continue;
    }

    if (!isLikelyTranslatableText(attrValue)) {
      continue;
    }

    const { line, column } = getLineAndColumn(content, currentMatch.index);
    results.push({
      file: relativePath,
      line,
      column,
      type: 'attribute',
      value: attrValue,
      attributeName: attrName,
      context: getContextLine(content, currentMatch.index)
    });
  }

  // Pattern 3: Array literals with label properties (common pattern for tabs, menus)
  // Match: { id: 'x', label: 'Text' }
  const labelInObjectRegex =
    /label:\s*["']([^"']+)["']|trigger:\s*["']([^"']+)["']/g;

  match = labelInObjectRegex.exec(content);
  while (match !== null) {
    const currentMatch = match;
    match = labelInObjectRegex.exec(content);
    const value = (currentMatch[1] || currentMatch[2]).trim();

    if (!isLikelyTranslatableText(value)) {
      continue;
    }

    const { line, column } = getLineAndColumn(content, currentMatch.index);
    results.push({
      file: relativePath,
      line,
      column,
      type: 'array-literal',
      value,
      context: getContextLine(content, currentMatch.index)
    });
  }

  return results;
};

// ============================================================================
// Translation Coverage Analysis
// ============================================================================

const extractKeysFromTranslationFile = async (
  filePath: string
): Promise<Set<string>> => {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const keys = new Set<string>();

    // Match keys in the format: keyName: 'value' or keyName: "value"
    // This simple approach works for the flat structure used in the codebase
    const keyRegex = /^\s+(\w+):\s*['"][^'"]*['"]/gm;
    let match: RegExpExecArray | null;

    match = keyRegex.exec(content);
    while (match !== null) {
      keys.add(match[1]);
      match = keyRegex.exec(content);
    }

    return keys;
  } catch {
    return new Set();
  }
};

const extractNamespacesFromTranslationFile = async (
  filePath: string
): Promise<string[]> => {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const namespaces: string[] = [];

    // Match namespace declarations: common: { ... }, menu: { ... }
    const namespaceRegex = /^\s{2}(\w+):\s*\{/gm;
    let match: RegExpExecArray | null;

    match = namespaceRegex.exec(content);
    while (match !== null) {
      namespaces.push(match[1]);
      match = namespaceRegex.exec(content);
    }

    return namespaces;
  } catch {
    return [];
  }
};

const analyzeTranslationCoverage = async (): Promise<{
  englishKeyCount: number;
  languageCoverage: LanguageCoverage[];
  namespaces: string[];
}> => {
  const languages = ['en', 'es', 'ua', 'pt'];
  const englishFile = path.join(TRANSLATIONS_DIR, 'en.ts');

  const englishKeys = await extractKeysFromTranslationFile(englishFile);
  const namespaces = await extractNamespacesFromTranslationFile(englishFile);

  const coverage: LanguageCoverage[] = [];

  for (const lang of languages) {
    const langFile = path.join(TRANSLATIONS_DIR, `${lang}.ts`);
    const langKeys = await extractKeysFromTranslationFile(langFile);

    const missingFromEnglish: string[] = [];
    const orphanKeys: string[] = [];

    // Find keys in English but missing from this language
    for (const key of englishKeys) {
      if (!langKeys.has(key)) {
        missingFromEnglish.push(key);
      }
    }

    // Find keys in this language but not in English (orphans)
    if (lang !== 'en') {
      for (const key of langKeys) {
        if (!englishKeys.has(key)) {
          orphanKeys.push(key);
        }
      }
    }

    coverage.push({
      language: lang,
      keyCount: langKeys.size,
      missingFromEnglish,
      orphanKeys
    });
  }

  return {
    englishKeyCount: englishKeys.size,
    languageCoverage: coverage,
    namespaces
  };
};

// ============================================================================
// Main Analysis
// ============================================================================

const runAnalysis = async (): Promise<I18nCoverageResult> => {
  // Find all TSX files
  const tsxFiles = await listTsxFiles(PACKAGES_DIR);

  // Find hardcoded strings
  const allHardcoded: HardcodedString[] = [];
  for (const file of tsxFiles) {
    const hardcoded = await findHardcodedStrings(file);
    allHardcoded.push(...hardcoded);
  }

  // Sort by file and line
  allHardcoded.sort((a, b) => {
    const fileCompare = a.file.localeCompare(b.file);
    if (fileCompare !== 0) return fileCompare;
    return a.line - b.line;
  });

  // Analyze translation coverage
  const { englishKeyCount, languageCoverage, namespaces } =
    await analyzeTranslationCoverage();

  return {
    hardcodedStrings: allHardcoded,
    englishKeyCount,
    languageCoverage,
    namespaces
  };
};

// ============================================================================
// Output Formatting
// ============================================================================

const summarizeByFile = (
  strings: HardcodedString[]
): Array<{ file: string; count: number }> => {
  const counts = new Map<string, number>();

  for (const s of strings) {
    const current = counts.get(s.file) ?? 0;
    counts.set(s.file, current + 1);
  }

  return [...counts.entries()]
    .map(([file, count]) => ({ file, count }))
    .sort((a, b) => b.count - a.count);
};

const formatTextReport = (result: I18nCoverageResult): string => {
  const lines: string[] = [];

  lines.push('=== i18n Coverage Report ===');
  lines.push('');

  // Summary
  lines.push(`Hardcoded strings found: ${result.hardcodedStrings.length}`);
  lines.push(`English translation keys: ${result.englishKeyCount}`);
  lines.push(`Registered namespaces: ${result.namespaces.join(', ')}`);
  lines.push('');

  // Language coverage
  lines.push('=== Language Coverage ===');
  for (const lang of result.languageCoverage) {
    const status =
      lang.missingFromEnglish.length === 0 && lang.orphanKeys.length === 0
        ? '✓'
        : '⚠';
    lines.push(
      `${status} ${lang.language}: ${lang.keyCount} keys, ` +
        `${lang.missingFromEnglish.length} missing, ` +
        `${lang.orphanKeys.length} orphan`
    );
  }
  lines.push('');

  // Hardcoded strings by file
  if (result.hardcodedStrings.length > 0) {
    lines.push('=== Hardcoded Strings by File ===');
    for (const summary of summarizeByFile(result.hardcodedStrings).slice(
      0,
      20
    )) {
      lines.push(`- ${summary.file}: ${summary.count}`);
    }
    lines.push('');

    // First 50 hardcoded strings with details
    lines.push('=== First 50 Hardcoded Strings ===');
    for (const s of result.hardcodedStrings.slice(0, 50)) {
      const attr = s.attributeName ? ` (${s.attributeName})` : '';
      lines.push(`${s.file}:${s.line}:${s.column} [${s.type}${attr}]`);
      lines.push(`  Value: "${s.value}"`);
      lines.push(`  Context: ${s.context}`);
      lines.push('');
    }
  }

  // Missing translations
  for (const lang of result.languageCoverage) {
    if (lang.missingFromEnglish.length > 0) {
      lines.push(
        `=== ${lang.language.toUpperCase()}: Missing ${lang.missingFromEnglish.length} keys ===`
      );
      for (const key of lang.missingFromEnglish.slice(0, 20)) {
        lines.push(`- ${key}`);
      }
      if (lang.missingFromEnglish.length > 20) {
        lines.push(`... and ${lang.missingFromEnglish.length - 20} more`);
      }
      lines.push('');
    }

    if (lang.orphanKeys.length > 0) {
      lines.push(
        `=== ${lang.language.toUpperCase()}: ${lang.orphanKeys.length} orphan keys ===`
      );
      for (const key of lang.orphanKeys.slice(0, 20)) {
        lines.push(`- ${key}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
};

// ============================================================================
// Main
// ============================================================================

const main = async (): Promise<void> => {
  const args = new Set(process.argv.slice(2));
  const asJson = args.has('--json');
  const strict = args.has('--strict');

  const result = await runAnalysis();

  if (asJson) {
    const payload = {
      hardcodedStringCount: result.hardcodedStrings.length,
      hardcodedByFile: summarizeByFile(result.hardcodedStrings),
      hardcodedStrings: result.hardcodedStrings,
      englishKeyCount: result.englishKeyCount,
      namespaces: result.namespaces,
      languageCoverage: result.languageCoverage,
      totalMissingKeys: result.languageCoverage.reduce(
        (sum, lang) => sum + lang.missingFromEnglish.length,
        0
      ),
      totalOrphanKeys: result.languageCoverage.reduce(
        (sum, lang) => sum + lang.orphanKeys.length,
        0
      )
    };
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(formatTextReport(result));
  }

  if (strict && result.hardcodedStrings.length > 0) {
    process.exit(1);
  }
};

await main();
