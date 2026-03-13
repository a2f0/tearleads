#!/usr/bin/env -S node --experimental-strip-types

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

type CheckMode = '--staged' | '--from-upstream';

interface Violation {
  file: string;
  line: number;
  content: string;
}

const STATIC_NODE_IMPORT_RE = /^\s*import\s.*from\s+['"]node:/m;

const BROWSER_SCOPES = [
  'packages/client/src/',
  'packages/app-',
  'packages/shared/src/'
];

const EXCLUDED_PATHS = [
  'packages/shared/src/server/',
  'packages/shared/src/redis/',
  'packages/shared/src/scaffolding/',
  '/wasmNode/',
  '/test/bunSetup.ts'
];

function getRepoRoot(): string {
  const currentFilePath = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFilePath), '../..');
}

function resolveBaseRef(repoRoot: string): string {
  try {
    return execSync('git rev-parse --abbrev-ref --symbolic-full-name @{u}', {
      cwd: repoRoot,
      encoding: 'utf8'
    }).trim();
  } catch {
    try {
      execSync('git rev-parse --verify origin/main', {
        cwd: repoRoot,
        encoding: 'utf8'
      });
      return 'origin/main';
    } catch {
      return 'main';
    }
  }
}

function collectFiles(mode: CheckMode, repoRoot: string): string[] {
  let output: string;
  if (mode === '--staged') {
    output = execSync('git diff --name-only --diff-filter=AM --cached', {
      cwd: repoRoot,
      encoding: 'utf8'
    });
  } else {
    const baseRef = resolveBaseRef(repoRoot);
    output = execSync(
      `git diff --name-only --diff-filter=AM ${baseRef}..HEAD`,
      {
        cwd: repoRoot,
        encoding: 'utf8'
      }
    );
  }

  return output
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => path.join(repoRoot, line));
}

function isBrowserScopeFile(relativePath: string): boolean {
  if (!/\.(ts|tsx|mts|cts)$/.test(relativePath)) {
    return false;
  }

  if (!BROWSER_SCOPES.some((scope) => relativePath.startsWith(scope))) {
    return false;
  }

  if (EXCLUDED_PATHS.some((excluded) => relativePath.includes(excluded))) {
    return false;
  }

  if (/\.(test|spec)\.(ts|tsx|mts|cts)$/.test(relativePath)) {
    return false;
  }

  if (relativePath.includes('/__tests__/')) {
    return false;
  }

  return true;
}

function findViolations(content: string, filePath: string): Violation[] {
  if (!STATIC_NODE_IMPORT_RE.test(content)) {
    return [];
  }

  const violations: Violation[] = [];
  const lines = content.split('\n');

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line) {
      continue;
    }

    if (/^\s*import\s.*from\s+['"]node:/.test(line)) {
      violations.push({
        file: filePath,
        line: index + 1,
        content: line.trim()
      });
    }
  }

  return violations;
}

function main(): void {
  const args = process.argv.slice(2);
  const mode = args[0];
  if (
    args.length !== 1 ||
    !mode ||
    (mode !== '--staged' && mode !== '--from-upstream')
  ) {
    console.error(
      'Usage: checkNodeImportsInClientCode.ts --staged | --from-upstream'
    );
    process.exit(2);
  }

  const repoRoot = getRepoRoot();
  const files = collectFiles(mode as CheckMode, repoRoot);
  if (files.length === 0) {
    process.exit(0);
  }

  const violations: Violation[] = [];

  for (const absoluteFilePath of files) {
    const resolvedPath = path.resolve(absoluteFilePath);
    if (!fs.existsSync(resolvedPath)) {
      continue;
    }

    const relativePath = path.relative(repoRoot, resolvedPath);
    if (!isBrowserScopeFile(relativePath)) {
      continue;
    }

    const content = fs.readFileSync(resolvedPath, 'utf8');
    violations.push(...findViolations(content, resolvedPath));
  }

  if (violations.length === 0) {
    process.exit(0);
  }

  console.error(
    'Error: static node:* imports detected in browser-targeted source files.'
  );
  console.error(
    'Move Node.js-only code behind a /server subpath export or use dynamic import().'
  );
  console.error('');

  for (const violation of violations) {
    const relativePath = path.relative(repoRoot, violation.file);
    console.error(`  ${relativePath}:${violation.line}`);
    console.error(`    ${violation.content}`);
    console.error('');
  }

  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
