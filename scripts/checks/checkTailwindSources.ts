#!/usr/bin/env -S pnpm exec tsx
/**
 * checkTailwindSources.ts
 *
 * Guards against a dev-mode-only Tailwind CSS v4 regression: when a new
 * @tearleads/* dependency with UI components (.tsx files) is added to the
 * client package, the Vite plugin's JIT compiler needs a matching @source
 * directive in packages/client/src/index.css to scan that package for
 * utility class names. Without the directive, utilities used only in the
 * missing package are silently skipped in dev mode (production builds may
 * still work because they process imports differently).
 *
 * This check:
 *   1. Reads packages/client/package.json and collects @tearleads/* deps
 *   2. For each dep, checks whether packages/<name>/src/ contains .tsx files
 *   3. Reads packages/client/src/index.css and extracts @source directives
 *   4. Fails if any dep with .tsx files lacks a matching @source directive
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

function hasTsxFiles(dir: string): boolean {
  if (!fs.existsSync(dir)) {
    return false;
  }

  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        stack.push(path.join(current, entry.name));
        continue;
      }

      if (entry.isFile() && entry.name.endsWith('.tsx')) {
        return true;
      }
    }
  }

  return false;
}

function extractSourceDirectives(cssContent: string): Set<string> {
  const sources = new Set<string>();
  const regex = /@source\s+"\.\.\/\.\.\/([^"]+)\/src";/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(cssContent)) !== null) {
    if (match[1]) {
      sources.add(match[1]);
    }
  }
  return sources;
}

function main(): void {
  const currentFilePath = fileURLToPath(import.meta.url);
  const scriptDir = path.dirname(currentFilePath);
  const repoRoot = path.resolve(scriptDir, '../..');
  const packagesDir = path.join(repoRoot, 'packages');

  const clientPkgPath = path.join(packagesDir, 'client', 'package.json');
  const clientPkg = JSON.parse(fs.readFileSync(clientPkgPath, 'utf8')) as {
    dependencies?: Record<string, string>;
  };

  const tearleadsDeps: string[] = [];
  if (clientPkg.dependencies) {
    for (const name of Object.keys(clientPkg.dependencies)) {
      if (name.startsWith('@tearleads/')) {
        tearleadsDeps.push(name);
      }
    }
  }

  const depsWithTsx: string[] = [];
  for (const dep of tearleadsDeps) {
    const dirName = dep.replace('@tearleads/', '');
    const srcDir = path.join(packagesDir, dirName, 'src');
    if (hasTsxFiles(srcDir)) {
      depsWithTsx.push(dirName);
    }
  }

  const indexCssPath = path.join(packagesDir, 'client', 'src', 'index.css');
  const cssContent = fs.readFileSync(indexCssPath, 'utf8');
  const sourceDirs = extractSourceDirectives(cssContent);

  const missing = depsWithTsx.filter((dir) => !sourceDirs.has(dir));

  if (missing.length > 0) {
    console.error(
      'Error: @tearleads/* packages with .tsx files are missing @source directives in packages/client/src/index.css.'
    );
    console.error(
      'Without @source directives, Tailwind CSS v4 will not scan these packages for utility classes in dev mode.'
    );
    console.error('');
    console.error('Missing directives:');
    for (const dir of missing.sort()) {
      console.error(`  @source "../../${dir}/src";`);
    }
    console.error('');
    console.error(
      'Fix: add the missing @source lines to packages/client/src/index.css.'
    );
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
