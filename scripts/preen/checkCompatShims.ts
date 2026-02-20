#!/usr/bin/env -S pnpm exec tsx

/**
 * Detects backward compatibility re-export patterns that violate greenfield policy.
 *
 * This script scans TypeScript files for:
 * 1. Comments indicating backward compatibility (e.g., "for backward compatibility")
 * 2. Files that are purely re-export wrappers
 * 3. Re-export statements with compatibility comments
 *
 * Usage:
 *   pnpm exec tsx scripts/preen/checkCompatShims.ts [--staged | --from-upstream]
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

interface Violation {
  file: string;
  line: number;
  pattern: string;
  content: string;
}

const COMPAT_COMMENT_PATTERNS = [
  /backward[s]?\s+compatib/i,
  /backwards?\s+compat\b/i,
  /legacy\s+support/i,
  /for\s+compat(?:ibility)?/i,
  /re-?export[s]?\s+(?:for|from).*(?:backward|compat|legacy)/i,
  /\bcompat(?:ibility)?\s+(?:shim|layer|wrapper)/i
];

const PURE_REEXPORT_DOCSTRING_PATTERN =
  /^\s*\/\*\*[\s\S]*?re-?exports?\s+(?:from|the)[\s\S]*?for\s+backward[s]?\s+compatib[\s\S]*?\*\//im;

function getRepoRoot(): string {
  const currentFilePath = fileURLToPath(import.meta.url);
  const scriptDir = path.dirname(currentFilePath);
  return path.resolve(scriptDir, '../..');
}

function collectFiles(mode: string): string[] {
  const repoRoot = getRepoRoot();

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
    let baseBranch: string;
    try {
      baseBranch = execSync(
        'git rev-parse --abbrev-ref --symbolic-full-name @{u}',
        { cwd: repoRoot, encoding: 'utf8' }
      ).trim();
    } catch {
      try {
        execSync('git rev-parse --verify origin/main', {
          cwd: repoRoot,
          encoding: 'utf8'
        });
        baseBranch = 'origin/main';
      } catch {
        baseBranch = 'main';
      }
    }

    const output = execSync(
      `git diff --name-only --diff-filter=AM ${baseBranch}..HEAD`,
      { cwd: repoRoot, encoding: 'utf8' }
    );
    return output
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => path.join(repoRoot, line));
  }

  throw new Error('Usage: checkCompatShims.ts --staged | --from-upstream');
}

function isTypeScriptFile(filePath: string): boolean {
  return /\.(ts|tsx|mts|cts)$/.test(filePath);
}

function isPureReexportFile(content: string): boolean {
  const lines = content.split('\n');
  const nonEmptyLines = lines.filter((line) => {
    const trimmed = line.trim();
    return (
      trimmed.length > 0 &&
      !trimmed.startsWith('//') &&
      !trimmed.startsWith('*') &&
      !trimmed.startsWith('/*') &&
      !trimmed.startsWith('*/')
    );
  });

  const exportLines = nonEmptyLines.filter(
    (line) =>
      line.includes('export {') ||
      line.includes('export type {') ||
      line.includes("} from '") ||
      line.includes('} from "')
  );

  return (
    nonEmptyLines.length > 0 &&
    exportLines.length >= nonEmptyLines.length * 0.8 &&
    PURE_REEXPORT_DOCSTRING_PATTERN.test(content)
  );
}

function findCompatComments(content: string, filePath: string): Violation[] {
  const violations: Violation[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    for (const pattern of COMPAT_COMMENT_PATTERNS) {
      if (pattern.test(line)) {
        violations.push({
          file: filePath,
          line: i + 1,
          pattern: pattern.source,
          content: line.trim()
        });
        break;
      }
    }
  }

  return violations;
}

function checkFile(filePath: string): Violation[] {
  if (!fs.existsSync(filePath) || !isTypeScriptFile(filePath)) {
    return [];
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const violations: Violation[] = [];

  if (isPureReexportFile(content)) {
    violations.push({
      file: filePath,
      line: 1,
      pattern: 'pure-reexport-file',
      content:
        'File appears to be a pure re-export wrapper for backward compatibility'
    });
  }

  violations.push(...findCompatComments(content, filePath));

  return violations;
}

function main(): void {
  const args = process.argv.slice(2);
  const arg = args[0];
  if (
    args.length !== 1 ||
    !arg ||
    !['--staged', '--from-upstream'].includes(arg)
  ) {
    console.error('Usage: checkCompatShims.ts --staged | --from-upstream');
    process.exit(2);
  }

  const mode = arg;
  const files = collectFiles(mode);

  if (files.length === 0) {
    process.exit(0);
  }

  const allViolations: Violation[] = [];

  for (const file of files) {
    const violations = checkFile(file);
    allViolations.push(...violations);
  }

  if (allViolations.length === 0) {
    process.exit(0);
  }

  console.error(
    'Error: backward compatibility patterns detected (violates greenfield policy).'
  );
  console.error('');
  console.error(
    'This repository is in greenfield design mode. Do not add reverse-compatibility'
  );
  console.error(
    'layers, compatibility re-export packages, or legacy alias modules.'
  );
  console.error('');
  console.error(
    'Instead: update imports to use the canonical module path directly.'
  );
  console.error('');

  for (const violation of allViolations) {
    const repoRoot = getRepoRoot();
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
