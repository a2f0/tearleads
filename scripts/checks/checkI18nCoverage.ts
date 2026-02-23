#!/usr/bin/env -S pnpm exec tsx
/**
 * i18n Coverage and Hardcoded String Detection Tool
 *
 * This script scans TSX files for potential hardcoded strings that should be
 * translated, and checks translation key coverage across all supported languages.
 *
 * Usage:
 *   ./scripts/checks/checkI18nCoverage.ts           # Text summary
 *   ./scripts/checks/checkI18nCoverage.ts --json    # JSON output
 *   ./scripts/checks/checkI18nCoverage.ts --strict  # Exit 1 if issues found
 *
 * The script detects:
 * 1. Hardcoded JSX text content (e.g., <span>Hello</span>)
 * 2. Hardcoded user-facing attribute values (e.g., title="Hello", label="Submit")
 * 3. Missing translation keys across languages
 * 4. Orphan keys (keys in non-English files not in English source)
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  type HardcodedString,
  type I18nCoverageResult,
  type LanguageCoverage,
  MIN_TEXT_LENGTH,
  PACKAGES_DIR,
  ROOT_DIR,
  SKIP_ATTRIBUTES,
  SKIP_PATTERNS,
  SKIP_TEXT_PATTERNS,
  TRANSLATIONS_DIR,
  USER_FACING_ATTRIBUTES
} from './checkI18nCoverage/config.ts';
import {
  formatTextReport,
  summarizeByFile
} from './checkI18nCoverage/report.ts';

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
    try {
      const entries = await fs.readdir(dir, {
        withFileTypes: true,
        encoding: 'utf8'
      });

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
    } catch {
      return;
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
    column: (lines[lines.length - 1]?.length ?? 0) + 1
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
    const textValue = match[1];
    if (textValue === undefined) {
      match = jsxTextRegex.exec(content);
      continue;
    }
    const text = textValue.trim();
    const matchIndex = match.index;

    if (isLikelyTranslatableText(text)) {
      // Skip if inside a comment
      const beforeMatch = content.substring(
        Math.max(0, matchIndex - 100),
        matchIndex
      );
      if (!beforeMatch.includes('//') && !beforeMatch.includes('/*')) {
        const { line, column } = getLineAndColumn(content, matchIndex);
        results.push({
          file: relativePath,
          line,
          column,
          type: 'jsx-text',
          value: text,
          context: getContextLine(content, matchIndex)
        });
      }
    }

    match = jsxTextRegex.exec(content);
  }

  // Pattern 2: User-facing attributes with string literals
  // Match: attribute="value" or attribute='value'
  const attributeRegex = /(\w+)=["']([^"']+)["']/g;

  match = attributeRegex.exec(content);
  while (match !== null) {
    const attrName = match[1];
    const attrValueRaw = match[2];
    if (attrName === undefined || attrValueRaw === undefined) {
      match = attributeRegex.exec(content);
      continue;
    }
    const attrValue = attrValueRaw.trim();
    const matchIndex = match.index;

    const isUserFacing =
      !SKIP_ATTRIBUTES.has(attrName) && USER_FACING_ATTRIBUTES.has(attrName);
    if (isUserFacing && isLikelyTranslatableText(attrValue)) {
      const { line, column } = getLineAndColumn(content, matchIndex);
      const entry: HardcodedString = {
        file: relativePath,
        line,
        column,
        type: 'attribute',
        value: attrValue,
        attributeName: attrName,
        context: getContextLine(content, matchIndex)
      };
      results.push(entry);
    }

    match = attributeRegex.exec(content);
  }

  // Pattern 3: Array literals with label properties (common pattern for tabs, menus)
  // Match: { id: 'x', label: 'Text' }
  const labelInObjectRegex =
    /label:\s*["']([^"']+)["']|trigger:\s*["']([^"']+)["']/g;

  match = labelInObjectRegex.exec(content);
  while (match !== null) {
    const first = match[1];
    const second = match[2];
    const rawValue = first ?? second;
    if (rawValue === undefined) {
      match = labelInObjectRegex.exec(content);
      continue;
    }
    const value = rawValue.trim();
    const matchIndex = match.index;

    if (isLikelyTranslatableText(value)) {
      const { line, column } = getLineAndColumn(content, matchIndex);
      results.push({
        file: relativePath,
        line,
        column,
        type: 'array-literal',
        value,
        context: getContextLine(content, matchIndex)
      });
    }

    match = labelInObjectRegex.exec(content);
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
      const key = match[1];
      if (key !== undefined) {
        keys.add(key);
      }
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
      const namespace = match[1];
      if (namespace !== undefined) {
        namespaces.push(namespace);
      }
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
