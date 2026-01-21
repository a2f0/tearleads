#!/usr/bin/env -S pnpm exec tsx
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

type Row = {
  blank: number;
  code: number;
  comment: number;
  files: number;
  language: string;
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

const result = spawnSync(
  'tokei',
  ['--output', 'json', '--sort', 'code', ...process.argv.slice(2)],
  { cwd: rootDir, encoding: 'utf8' },
);

if (result.error) {
  console.error('Error: tokei is not installed');
  console.error('Install with: brew install tokei');
  process.exit(1);
}

if (typeof result.status === 'number' && result.status !== 0) {
  const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : '';
  if (stderr) {
    console.error(stderr);
  }
  process.exit(result.status);
}

const output = typeof result.stdout === 'string' ? result.stdout : '';
const data: Record<string, unknown> = JSON.parse(output);

const formatter = new Intl.NumberFormat('en-US');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const readStat = (stats: unknown, key: string): number => {
  if (!isRecord(stats)) {
    return 0;
  }

  const value = stats[key];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  return 0;
};

const rows: Row[] = Object.entries(data)
  .filter(([name]) => name !== 'Total')
  .map(([language, stats]) => ({
    language,
    files: readStat(stats, 'files'),
    blank: readStat(stats, 'blanks'),
    comment: readStat(stats, 'comments'),
    code: readStat(stats, 'code'),
  }))
  .sort((a, b) => b.code - a.code);

const totalStats = data.Total;
if (totalStats) {
  rows.push({
    language: 'Total',
    files: readStat(totalStats, 'files'),
    blank: readStat(totalStats, 'blanks'),
    comment: readStat(totalStats, 'comments'),
    code: readStat(totalStats, 'code'),
  });
}

const formatNumber = (value: number): string => formatter.format(value);

const headers = {
  language: 'Language',
  files: 'Files',
  blank: 'Blank',
  comment: 'Comment',
  code: 'Code',
};

const columnWidths = rows.reduce(
  (widths, row) => ({
    language: Math.max(widths.language, row.language.length),
    files: Math.max(widths.files, formatNumber(row.files).length),
    blank: Math.max(widths.blank, formatNumber(row.blank).length),
    comment: Math.max(widths.comment, formatNumber(row.comment).length),
    code: Math.max(widths.code, formatNumber(row.code).length),
  }),
  {
    language: headers.language.length,
    files: headers.files.length,
    blank: headers.blank.length,
    comment: headers.comment.length,
    code: headers.code.length,
  },
);

const padRight = (value: string, width: number): string => value.padEnd(width);
const padLeft = (value: string, width: number): string => value.padStart(width);

const headerLine =
  `${padRight(headers.language, columnWidths.language)}  ` +
  `${padLeft(headers.files, columnWidths.files)}  ` +
  `${padLeft(headers.blank, columnWidths.blank)}  ` +
  `${padLeft(headers.comment, columnWidths.comment)}  ` +
  `${padLeft(headers.code, columnWidths.code)}`;

const separatorLine =
  `${'-'.repeat(columnWidths.language)}  ` +
  `${'-'.repeat(columnWidths.files)}  ` +
  `${'-'.repeat(columnWidths.blank)}  ` +
  `${'-'.repeat(columnWidths.comment)}  ` +
  `${'-'.repeat(columnWidths.code)}`;

console.log(headerLine);
console.log(separatorLine);

rows.forEach((row) => {
  const line =
    `${padRight(row.language, columnWidths.language)}  ` +
    `${padLeft(formatNumber(row.files), columnWidths.files)}  ` +
    `${padLeft(formatNumber(row.blank), columnWidths.blank)}  ` +
    `${padLeft(formatNumber(row.comment), columnWidths.comment)}  ` +
    `${padLeft(formatNumber(row.code), columnWidths.code)}`;

  console.log(line);
});
