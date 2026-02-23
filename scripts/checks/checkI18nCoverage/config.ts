import path from 'node:path';

export interface HardcodedString {
  file: string;
  line: number;
  column: number;
  type: 'jsx-text' | 'attribute' | 'array-literal';
  value: string;
  context: string;
  attributeName?: string;
}

export interface LanguageCoverage {
  language: string;
  keyCount: number;
  missingFromEnglish: string[];
  orphanKeys: string[];
}

export interface I18nCoverageResult {
  hardcodedStrings: HardcodedString[];
  englishKeyCount: number;
  languageCoverage: LanguageCoverage[];
  namespaces: string[];
}

export const ROOT_DIR = process.cwd();
export const PACKAGES_DIR = path.join(ROOT_DIR, 'packages');
export const TRANSLATIONS_DIR = path.join(
  ROOT_DIR,
  'packages/client/src/i18n/translations'
);

export const SKIP_PATTERNS = [
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

export const USER_FACING_ATTRIBUTES = new Set([
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

export const SKIP_ATTRIBUTES = new Set([
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

export const SKIP_TEXT_PATTERNS = [
  /^[A-Z_]+$/,
  /^\d+(\.\d+)?$/,
  /^#[0-9a-fA-F]{3,8}$/,
  /^(px|em|rem|%|vh|vw|pt)$/,
  /^https?:\/\//,
  /^[a-z]+:\/\//,
  /^\{.*\}$/,
  /^[./]/,
  /^@/,
  /^[a-z-]+\/[a-z-]+$/,
  /^(true|false|null|undefined)$/,
  /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/,
  /^[a-z]+_[a-z_]+$/i,
  /^[a-z]+[A-Z][a-zA-Z]*$/
];

export const MIN_TEXT_LENGTH = 2;
