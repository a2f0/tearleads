#!/usr/bin/env -S node --experimental-strip-types
import fs from 'node:fs';
import path from 'node:path';
import {
  buildCompatibilityInventoryMarkdown,
  generateCompatibilityInventoryReport,
  INVENTORY_MARKDOWN_RELATIVE_PATH,
  normalizeInventoryMarkdownForCheck
} from './compatibilityInventoryLib.ts';

interface CliArgs {
  check: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  let check = false;
  for (const token of argv.slice(2)) {
    if (token === '--check') {
      check = true;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  return { check };
}

function readFileIfExists(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'ENOENT'
    ) {
      return null;
    }
    throw error;
  }
}

function main(): void {
  const args = parseArgs(process.argv);
  const repoRoot = process.cwd();
  const outputPath = path.join(repoRoot, INVENTORY_MARKDOWN_RELATIVE_PATH);

  const report = generateCompatibilityInventoryReport(
    repoRoot,
    new Date().toISOString()
  );
  const markdownOutput = buildCompatibilityInventoryMarkdown(report);

  if (args.check) {
    const existing = readFileIfExists(outputPath);
    if (
      existing === null ||
      normalizeInventoryMarkdownForCheck(existing) !==
        normalizeInventoryMarkdownForCheck(markdownOutput)
    ) {
      console.error(`Stale file: ${INVENTORY_MARKDOWN_RELATIVE_PATH}`);
      console.error(
        'Run: node --experimental-strip-types scripts/bun/generateCompatibilityInventory.ts'
      );
      process.exit(1);
    }
    console.log('Bun compatibility inventory is up to date.');
    return;
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, markdownOutput, 'utf8');
  console.log(`Wrote ${INVENTORY_MARKDOWN_RELATIVE_PATH}`);
}

main();
