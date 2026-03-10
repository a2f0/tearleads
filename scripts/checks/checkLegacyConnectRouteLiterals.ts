#!/usr/bin/env -S node --import tsx

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export type CheckMode = '--staged' | '--from-upstream' | '--all';

export interface LegacyConnectViolation {
  file: string;
  line: number;
  pattern: string;
  content: string;
}

const LEGACY_PATTERNS: ReadonlyArray<{
  name: string;
  regex: RegExp;
}> = [
  {
    name: 'legacy-service-name',
    regex: /tearleads\.v1\.[A-Za-z0-9_]+Service/
  },
  {
    name: 'legacy-connect-route',
    regex: /\/(?:v1\/)?connect\/tearleads\.v1\.[A-Za-z0-9_]+Service\/[A-Za-z0-9_]+/
  }
];

function getRepoRoot(): string {
  const currentFilePath = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFilePath), '../..');
}

function getSelfScriptPath(): string {
  return path.join(
    getRepoRoot(),
    'scripts',
    'checks',
    'checkLegacyConnectRouteLiterals.ts'
  );
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
  if (mode === '--staged') {
    const output = execSync('git diff --name-only --diff-filter=AM --cached', {
      cwd: repoRoot,
      encoding: 'utf8'
    });

    return output
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => path.join(repoRoot, line));
  }

  if (mode === '--from-upstream') {
    const baseRef = resolveBaseRef(repoRoot);
    const output = execSync(
      `git diff --name-only --diff-filter=AM ${baseRef}..HEAD`,
      {
        cwd: repoRoot,
        encoding: 'utf8'
      }
    );

    return output
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => path.join(repoRoot, line));
  }

  const output = execSync('git ls-files', {
    cwd: repoRoot,
    encoding: 'utf8'
  });

  return output
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => path.join(repoRoot, line));
}

export function shouldScanFile(relativePath: string): boolean {
  const isProjectCode =
    relativePath.startsWith('packages/') || relativePath.startsWith('crates/');
  if (!isProjectCode) {
    return false;
  }

  if (!/\.(ts|tsx|mts|cts|rs)$/.test(relativePath)) {
    return false;
  }

  if (relativePath.includes('/__tests__/')) {
    return false;
  }

  if (/\.(test|spec)\.(ts|tsx|mts|cts)$/.test(relativePath)) {
    return false;
  }

  if (relativePath.endsWith('_test.rs')) {
    return false;
  }

  return true;
}

export function findLegacyConnectViolations(
  content: string,
  filePath: string
): LegacyConnectViolation[] {
  const violations: LegacyConnectViolation[] = [];
  const lines = content.split('\n');

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line) {
      continue;
    }

    for (const pattern of LEGACY_PATTERNS) {
      if (!pattern.regex.test(line)) {
        continue;
      }

      violations.push({
        file: filePath,
        line: index + 1,
        pattern: pattern.name,
        content: line.trim()
      });
      break;
    }
  }

  return violations;
}

function scanFiles(files: string[], repoRoot: string): LegacyConnectViolation[] {
  const violations: LegacyConnectViolation[] = [];
  const selfPath = path.resolve(getSelfScriptPath());

  for (const absoluteFilePath of files) {
    const resolvedPath = path.resolve(absoluteFilePath);
    if (resolvedPath === selfPath) {
      continue;
    }

    if (!fs.existsSync(resolvedPath)) {
      continue;
    }

    const relativePath = path.relative(repoRoot, resolvedPath);
    if (!shouldScanFile(relativePath)) {
      continue;
    }

    const content = fs.readFileSync(resolvedPath, 'utf8');
    violations.push(...findLegacyConnectViolations(content, resolvedPath));
  }

  return violations;
}

function printUsage(): void {
  console.error(
    'Usage: checkLegacyConnectRouteLiterals.ts --staged | --from-upstream | --all'
  );
}

function main(): void {
  const args = process.argv.slice(2);
  const mode = args[0];
  if (
    args.length !== 1 ||
    !mode ||
    (mode !== '--staged' && mode !== '--from-upstream' && mode !== '--all')
  ) {
    printUsage();
    process.exit(2);
  }

  const repoRoot = getRepoRoot();
  const files = collectFiles(mode, repoRoot);
  if (files.length === 0) {
    process.exit(0);
  }

  const violations = scanFiles(files, repoRoot);
  if (violations.length === 0) {
    process.exit(0);
  }

  console.error(
    'Error: legacy Connect v1 service literals detected in runtime code.'
  );
  console.error(
    'Use v2 service paths only and remove v1 compatibility literals from production code.'
  );
  console.error('');

  for (const violation of violations) {
    const relativePath = path.relative(repoRoot, violation.file);
    console.error(`  ${relativePath}:${violation.line}`);
    console.error(`    Pattern: ${violation.pattern}`);
    console.error(`    Content: ${violation.content}`);
    console.error('');
  }

  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
