#!/usr/bin/env -S pnpm exec tsx
/**
 * Renames TypeScript files from kebab-case to camelCase/PascalCase.
 *
 * Usage:
 *   ./scripts/refactor/renameKebabToCamel.ts --dry-run     # Preview changes
 *   ./scripts/refactor/renameKebabToCamel.ts --execute     # Execute renames
 *   ./scripts/refactor/renameKebabToCamel.ts --manifest    # Output JSON manifest
 */
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..', '..');

// Directories to exclude from renaming
const EXCLUDED_DIRS = [
  'node_modules',
  'dist',
  'dist-tests',
  '.claude',
  '.codex',
  '.git',
  '.next',
  'coverage',
  '.turbo'
];

// File patterns to exclude (keep kebab-case)
const EXCLUDED_PATTERNS = [
  /vite-env\.d\.ts$/, // Vite environment types
  /playwright-env\.d\.ts$/ // Playwright environment types
];

interface RenameEntry {
  oldPath: string;
  newPath: string;
  oldBasename: string;
  newBasename: string;
  isComponent: boolean;
  isTest: boolean;
  isTypeDefinition: boolean;
}

/**
 * Convert kebab-case to camelCase
 * Example: "key-manager" -> "keyManager"
 */
function kebabToCamelCase(str: string): string {
  return str.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Convert kebab-case to PascalCase
 * Example: "key-manager" -> "KeyManager"
 */
function kebabToPascalCase(str: string): string {
  const camel = kebabToCamelCase(str);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

/**
 * Check if a file is a React component (should use PascalCase)
 */
function isReactComponent(filePath: string): boolean {
  const ext = extname(filePath);
  if (ext !== '.tsx') return false;

  // Test files are not components
  if (isTestFile(filePath)) return false;

  // Files in test directories are test utilities, not components
  const parts = filePath.split('/');
  if (parts.some((p) => p === 'test' || p === 'tests' || p === '__tests__')) {
    return false;
  }

  // Files named *-utils, *-helper, *-mock are utilities
  const base = basename(filePath);
  if (/-(utils|helper|mock|mocks|wrapper|provider|context)\.tsx?$/.test(base)) {
    return false;
  }

  // Check if it's in a components directory or UI directory
  const inComponentsDir = parts.some((p) => p === 'components' || p === 'ui');

  // Files in components/ui directories are components
  if (inComponentsDir) return true;

  // Check file contents for JSX return
  try {
    const content = readFileSync(filePath, 'utf-8');
    // Simple heuristic: contains React.FC, function Component, or export default function
    const hasComponentPattern =
      /export\s+(default\s+)?function\s+[A-Z]/.test(content) ||
      /:\s*React\.(FC|FunctionComponent)/.test(content) ||
      /export\s+const\s+[A-Z]\w+\s*[:=]/.test(content);
    return hasComponentPattern;
  } catch {
    return false;
  }
}

/**
 * Check if a file is a test file
 */
function isTestFile(filePath: string): boolean {
  const base = basename(filePath);
  return base.includes('.test.') || base.includes('.spec.') || base.includes('.integration.test.');
}

/**
 * Check if a file is a type definition
 */
function isTypeDefinition(filePath: string): boolean {
  return filePath.endsWith('.d.ts');
}

/**
 * Check if a filename contains kebab-case (has hyphens in the name part)
 */
function hasKebabCase(filePath: string): boolean {
  const base = basename(filePath);
  // Remove extension(s) to get the name
  const namePart = base.replace(/(\.(test|spec|integration\.test))?\.d?\.tsx?$/, '');
  return namePart.includes('-');
}

/**
 * Generate new filename based on file type
 */
function generateNewBasename(oldPath: string): string {
  const base = basename(oldPath);
  const ext = extname(base);

  // Handle .d.ts files
  if (base.endsWith('.d.ts')) {
    const nameWithoutExt = base.slice(0, -5); // Remove ".d.ts"
    const newName = kebabToCamelCase(nameWithoutExt);
    return `${newName}.d.ts`;
  }

  // Handle test files
  if (isTestFile(oldPath)) {
    // Extract the test suffix pattern
    const testMatch = base.match(/(\.(test|spec|integration\.test))(\.tsx?)$/);
    if (testMatch) {
      const testSuffix = testMatch[1];
      const fileExt = testMatch[3];
      const nameWithoutTestExt = base.slice(0, -(testSuffix.length + fileExt.length));
      const newName = isReactComponent(oldPath.replace(testSuffix, ''))
        ? kebabToPascalCase(nameWithoutTestExt)
        : kebabToCamelCase(nameWithoutTestExt);
      return `${newName}${testSuffix}${fileExt}`;
    }
  }

  // Handle React components (.tsx)
  if (isReactComponent(oldPath)) {
    const nameWithoutExt = base.slice(0, -ext.length);
    return `${kebabToPascalCase(nameWithoutExt)}${ext}`;
  }

  // Default: camelCase for .ts files
  const nameWithoutExt = base.slice(0, -ext.length);
  return `${kebabToCamelCase(nameWithoutExt)}${ext}`;
}

/**
 * Recursively find all TypeScript files with kebab-case names
 */
function findKebabCaseFiles(dir: string, files: string[] = []): string[] {
  const entries = readdirSync(dir);

  for (const entry of entries) {
    const fullPath = join(dir, entry);

    // Skip excluded directories
    if (EXCLUDED_DIRS.includes(entry)) continue;

    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      findKebabCaseFiles(fullPath, files);
    } else if (stat.isFile()) {
      // Check if it's a TypeScript file with kebab-case naming
      if ((entry.endsWith('.ts') || entry.endsWith('.tsx')) && hasKebabCase(fullPath)) {
        // Skip excluded patterns
        if (EXCLUDED_PATTERNS.some((pattern) => pattern.test(fullPath))) {
          continue;
        }
        files.push(fullPath);
      }
    }
  }

  return files;
}

/**
 * Generate the rename manifest
 */
function generateManifest(): RenameEntry[] {
  const packagesDir = join(ROOT_DIR, 'packages');
  const scriptsDir = join(ROOT_DIR, 'scripts');

  const files = [...findKebabCaseFiles(packagesDir), ...findKebabCaseFiles(scriptsDir)];

  const manifest: RenameEntry[] = [];

  for (const oldPath of files) {
    const oldBasename = basename(oldPath);
    const newBasename = generateNewBasename(oldPath);

    // Skip if no change needed
    if (oldBasename === newBasename) continue;

    const newPath = join(dirname(oldPath), newBasename);

    manifest.push({
      oldPath: relative(ROOT_DIR, oldPath),
      newPath: relative(ROOT_DIR, newPath),
      oldBasename,
      newBasename,
      isComponent: isReactComponent(oldPath),
      isTest: isTestFile(oldPath),
      isTypeDefinition: isTypeDefinition(oldPath)
    });
  }

  // Sort by path for consistent ordering
  return manifest.sort((a, b) => a.oldPath.localeCompare(b.oldPath));
}

/**
 * Find all files that import a given module
 */
function findImporters(modulePath: string): string[] {
  const relPath = relative(ROOT_DIR, modulePath);
  const moduleNameNoExt = relPath.replace(/\.(tsx?|d\.ts)$/, '');
  const baseName = basename(moduleNameNoExt);

  // Use grep to find files that import this module
  try {
    const result = spawnSync(
      'grep',
      ['-r', '-l', '--include=*.ts', '--include=*.tsx', baseName, 'packages/', 'scripts/'],
      { cwd: ROOT_DIR, encoding: 'utf-8' }
    );
    if (result.stdout) {
      return result.stdout
        .trim()
        .split('\n')
        .filter((f) => f.length > 0);
    }
  } catch {
    // Ignore errors
  }
  return [];
}

/**
 * Update import statements in a file
 */
function updateImportsInFile(
  filePath: string,
  renames: Map<string, string>,
  dryRun: boolean
): number {
  const fullPath = join(ROOT_DIR, filePath);
  if (!existsSync(fullPath)) return 0;

  let content = readFileSync(fullPath, 'utf-8');
  let changeCount = 0;

  for (const [oldName, newName] of renames) {
    // Match various import patterns:
    // from './old-name'
    // from './old-name.js'
    // from '../path/old-name'
    // from '@/lib/old-name'
    const patterns = [
      // Import with quotes and potential .js extension
      new RegExp(`(from\\s+['"])([^'"]*/)${escapeRegex(oldName)}(\\.js)?(['"])`, 'g'),
      // Dynamic import
      new RegExp(`(import\\(['"])([^'"]*/)${escapeRegex(oldName)}(\\.js)?(['"]\\))`, 'g'),
      // Require
      new RegExp(`(require\\(['"])([^'"]*/)${escapeRegex(oldName)}(\\.js)?(['"]\\))`, 'g'),
      // vi.mock / jest.mock
      new RegExp(`(mock\\(['"])([^'"]*/)${escapeRegex(oldName)}(\\.js)?(['"])`, 'g'),
      // export from
      new RegExp(`(export\\s+\\*?\\s*from\\s+['"])([^'"]*/)${escapeRegex(oldName)}(\\.js)?(['"])`, 'g')
    ];

    for (const pattern of patterns) {
      const newContent = content.replace(pattern, `$1$2${newName}$3$4`);
      if (newContent !== content) {
        changeCount++;
        content = newContent;
      }
    }
  }

  if (changeCount > 0 && !dryRun) {
    writeFileSync(fullPath, content, 'utf-8');
  }

  return changeCount;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Execute git mv for a single rename
 */
function executeRename(entry: RenameEntry, dryRun: boolean): boolean {
  const oldFullPath = join(ROOT_DIR, entry.oldPath);
  const newFullPath = join(ROOT_DIR, entry.newPath);

  if (!existsSync(oldFullPath)) {
    console.error(`  ✗ File not found: ${entry.oldPath}`);
    return false;
  }

  if (existsSync(newFullPath)) {
    console.error(`  ✗ Target already exists: ${entry.newPath}`);
    return false;
  }

  if (dryRun) {
    console.log(`  → Would rename: ${entry.oldBasename} → ${entry.newBasename}`);
    return true;
  }

  try {
    execSync(`git mv "${entry.oldPath}" "${entry.newPath}"`, {
      cwd: ROOT_DIR,
      stdio: 'pipe'
    });
    console.log(`  ✓ Renamed: ${entry.oldBasename} → ${entry.newBasename}`);
    return true;
  } catch (error) {
    console.error(`  ✗ Failed to rename: ${entry.oldPath}`);
    console.error(`    ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/**
 * Main execution
 */
function main(): void {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const execute = args.includes('--execute');
  const manifestOnly = args.includes('--manifest');

  if (!dryRun && !execute && !manifestOnly) {
    console.log('Usage:');
    console.log('  ./scripts/refactor/renameKebabToCamel.ts --dry-run     # Preview changes');
    console.log('  ./scripts/refactor/renameKebabToCamel.ts --execute     # Execute renames');
    console.log('  ./scripts/refactor/renameKebabToCamel.ts --manifest    # Output JSON manifest');
    process.exit(1);
  }

  console.log('Scanning for kebab-case TypeScript files...\n');
  const manifest = generateManifest();

  if (manifest.length === 0) {
    console.log('No kebab-case TypeScript files found.');
    process.exit(0);
  }

  if (manifestOnly) {
    console.log(JSON.stringify(manifest, null, 2));
    process.exit(0);
  }

  // Group by directory for better output
  const byDir = new Map<string, RenameEntry[]>();
  for (const entry of manifest) {
    const dir = dirname(entry.oldPath);
    if (!byDir.has(dir)) {
      byDir.set(dir, []);
    }
    byDir.get(dir)!.push(entry);
  }

  console.log(`Found ${manifest.length} files to rename:\n`);

  // Build rename mapping (old basename without ext -> new basename without ext)
  const renameMap = new Map<string, string>();
  for (const entry of manifest) {
    const oldNameNoExt = entry.oldBasename.replace(/\.(tsx?|d\.ts)$/, '').replace(/\.(test|spec|integration\.test)$/, '');
    const newNameNoExt = entry.newBasename.replace(/\.(tsx?|d\.ts)$/, '').replace(/\.(test|spec|integration\.test)$/, '');
    renameMap.set(oldNameNoExt, newNameNoExt);
  }

  let successCount = 0;
  let failCount = 0;

  for (const [dir, entries] of byDir) {
    console.log(`\n${dir}/`);
    for (const entry of entries) {
      const success = executeRename(entry, dryRun);
      if (success) {
        successCount++;
      } else {
        failCount++;
      }
    }
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Summary: ${successCount} renamed, ${failCount} failed`);

  if (execute && successCount > 0) {
    console.log('\nUpdating import statements...');

    // Find all TypeScript files that might have imports
    const allTsFiles = [
      ...findAllTsFiles(join(ROOT_DIR, 'packages')),
      ...findAllTsFiles(join(ROOT_DIR, 'scripts'))
    ].map((f) => relative(ROOT_DIR, f));

    let importUpdateCount = 0;
    for (const file of allTsFiles) {
      const changes = updateImportsInFile(file, renameMap, false);
      if (changes > 0) {
        importUpdateCount += changes;
        console.log(`  ✓ Updated imports in: ${file}`);
      }
    }

    console.log(`\nUpdated ${importUpdateCount} import statements.`);
  } else if (dryRun) {
    console.log('\nDry run complete. Use --execute to apply changes.');
  }
}

/**
 * Find all TypeScript files (not just kebab-case)
 */
function findAllTsFiles(dir: string, files: string[] = []): string[] {
  const entries = readdirSync(dir);

  for (const entry of entries) {
    const fullPath = join(dir, entry);

    if (EXCLUDED_DIRS.includes(entry)) continue;

    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      findAllTsFiles(fullPath, files);
    } else if (stat.isFile() && (entry.endsWith('.ts') || entry.endsWith('.tsx'))) {
      files.push(fullPath);
    }
  }

  return files;
}

main();
