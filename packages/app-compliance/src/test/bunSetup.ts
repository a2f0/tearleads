import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { installBrowserGlobalsForBun } from '@tearleads/bun-dom-compat';

const COMPLIANCE_MARKDOWN_MODULES_GLOBAL =
  '__TEARLEADS_COMPLIANCE_MARKDOWN_MODULES__';
const COMPLIANCE_DOCS_ROOT = resolve(import.meta.dir, '../../../../compliance');

function collectMarkdownFiles(currentDir: string): string[] {
  const markdownFiles: string[] = [];
  const entries = readdirSync(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      markdownFiles.push(...collectMarkdownFiles(entryPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.md')) {
      markdownFiles.push(entryPath);
    }
  }

  return markdownFiles;
}

function preloadComplianceMarkdownModulesForBun(): void {
  if (typeof Reflect.get(import.meta, 'glob') === 'function') {
    return;
  }

  if (
    typeof Reflect.get(globalThis, COMPLIANCE_MARKDOWN_MODULES_GLOBAL) ===
    'object'
  ) {
    return;
  }

  const markdownModules: Record<string, string> = {};
  const markdownFilePaths = collectMarkdownFiles(COMPLIANCE_DOCS_ROOT);
  for (const filePath of markdownFilePaths) {
    markdownModules[filePath] = readFileSync(filePath, 'utf8');
  }

  Reflect.set(globalThis, COMPLIANCE_MARKDOWN_MODULES_GLOBAL, markdownModules);
}

installBrowserGlobalsForBun();
preloadComplianceMarkdownModulesForBun();
await import('./setup.js');
