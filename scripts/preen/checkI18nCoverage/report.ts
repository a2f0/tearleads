import type { HardcodedString, I18nCoverageResult } from './config.ts';

export const summarizeByFile = (
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

export const formatTextReport = (result: I18nCoverageResult): string => {
  const lines: string[] = [];

  lines.push('=== i18n Coverage Report ===');
  lines.push('');
  lines.push(`Hardcoded strings found: ${result.hardcodedStrings.length}`);
  lines.push(`English translation keys: ${result.englishKeyCount}`);
  lines.push(`Registered namespaces: ${result.namespaces.join(', ')}`);
  lines.push('');

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

  if (result.hardcodedStrings.length > 0) {
    lines.push('=== Hardcoded Strings by File ===');
    for (const summary of summarizeByFile(result.hardcodedStrings).slice(
      0,
      20
    )) {
      lines.push(`- ${summary.file}: ${summary.count}`);
    }
    lines.push('');

    lines.push('=== First 50 Hardcoded Strings ===');
    for (const s of result.hardcodedStrings.slice(0, 50)) {
      const attr = s.attributeName ? ` (${s.attributeName})` : '';
      lines.push(`${s.file}:${s.line}:${s.column} [${s.type}${attr}]`);
      lines.push(`  Value: "${s.value}"`);
      lines.push(`  Context: ${s.context}`);
      lines.push('');
    }
  }

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
