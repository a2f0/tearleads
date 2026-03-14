#!/usr/bin/env bun
/**
 * Codemod: replace `await import()` with `importOriginal()` in vi.mock factories
 *
 * vi.mock('mod', async () => {
 *   const actual = await import('mod');
 *   return { ...actual, override };
 * })
 * →
 * vi.mock('mod', async (importOriginal) => {
 *   const actual = await importOriginal<typeof import('mod')>();
 *   return { ...actual, override };
 * })
 *
 * Inside a vi.mock factory, dynamic import() is intercepted by Bun's mock
 * layer and deadlocks. Using importOriginal (the first parameter to the
 * factory) avoids this by going through the test runner's official API.
 *
 * Handles:
 *  - const actual = await import('module');
 *  - const original = await import('module');
 *  - ...(await import('module'))   (inline spread)
 *  - With or without existing type parameters
 *  - Arrow functions with or without existing parameters
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

/**
 * Transform all vi.mock calls with async factories that use await import().
 *
 * Strategy:
 * 1. Find vi.mock(..., async () => { ... }) or async (...) => { ... }
 * 2. Within those factories, replace `await import('path')` with
 *    `await importOriginal<typeof import('path')>()`
 * 3. Add `importOriginal` as the factory parameter if not present
 */
function transformFile(content: string): {
  result: string;
  replacements: number;
} {
  let replacements = 0;
  let result = content;

  // Match vi.mock('...', async (...) => { ... })
  // We process each vi.mock block individually.
  //
  // Pattern breakdown:
  //   vi\.mock\(\s*(['"`])  – vi.mock( followed by opening quote
  //   (.+?)                 – module path (captured)
  //   \1\s*,\s*             – closing quote, comma
  //   async\s*              – async keyword
  //   (\([^)]*\))           – parameter list in parens (captured)
  //   \s*=>\s*\{            – arrow and opening brace
  //
  // We then find the matching closing brace to extract the factory body.

  const viMockPattern =
    /vi\.mock\(\s*(['"`])((?:(?!\1).)+)\1\s*,\s*async\s*(\([^)]*\))\s*=>\s*\{/gu;

  let match: RegExpExecArray | null;

  // Collect matches first to avoid issues with modifying string during iteration
  const matches: Array<{
    fullMatchStart: number;
    fullMatchEnd: number;
    modulePath: string;
    paramList: string;
    paramListStart: number;
    paramListEnd: number;
    bodyStart: number;
  }> = [];

  for (
    match = viMockPattern.exec(content);
    match !== null;
    match = viMockPattern.exec(content)
  ) {
    const paramListStartInMatch = match[0].indexOf(match[3]!);
    matches.push({
      fullMatchStart: match.index,
      fullMatchEnd: match.index + match[0].length,
      modulePath: match[2]!,
      paramList: match[3]!,
      paramListStart: match.index + paramListStartInMatch,
      paramListEnd: match.index + paramListStartInMatch + match[3]!.length,
      bodyStart: match.index + match[0].length // right after '{'
    });
  }

  // Process matches in reverse order so offsets don't shift
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i]!;

    // Find the end of the factory body by counting braces
    let braceDepth = 1;
    let pos = m.bodyStart;
    while (pos < result.length && braceDepth > 0) {
      const ch = result.charAt(pos);
      if (ch === '{') braceDepth++;
      if (ch === '}') braceDepth--;
      if (ch === "'" || ch === '"' || ch === '`') {
        // Skip string literals
        const quote = ch;
        pos++;
        while (pos < result.length && result.charAt(pos) !== quote) {
          if (result.charAt(pos) === '\\') pos++; // skip escaped char
          pos++;
        }
      }
      pos++;
    }
    const bodyEnd = pos; // past the closing '}'

    // Extract the factory body (between the braces)
    const body = result.substring(m.bodyStart, bodyEnd);

    // Check if body contains `await import(` — if not, skip
    if (!body.includes('await import(')) continue;

    // Replace `await import('modulePath')` with
    // `await importOriginal<typeof import('modulePath')>()`
    //
    // Patterns to handle:
    //   await import('modulePath')
    //   await import("modulePath")
    //   await import(`modulePath`)
    //   await import<SomeType>('modulePath')  (rare, strip existing type param)
    //
    // The modulePath in import() should match the vi.mock module path.
    // We replace ALL await import() calls within this factory body.

    const escapedModulePath = m.modulePath.replace(
      /[.*+?^${}()|[\]\\]/gu,
      '\\$&'
    );

    // Match await import with optional type parameter and the module path
    const importPattern = new RegExp(
      `await\\s+import\\s*(?:<[^>]*>)?\\s*\\(\\s*(['"\`])${escapedModulePath}\\1\\s*\\)`,
      'gu'
    );

    let bodyModified = false;
    const newBody = body.replace(importPattern, () => {
      bodyModified = true;
      return `await importOriginal<typeof import('${m.modulePath}')>()`;
    });

    if (!bodyModified) continue;

    // Determine if we need to add importOriginal parameter
    let newParamList = m.paramList;
    const hasImportOriginal = /importOriginal/u.test(m.paramList);

    if (!hasImportOriginal) {
      // Transform parameter list
      const trimmedParams = m.paramList.slice(1, -1).trim();
      if (trimmedParams === '') {
        // () → (importOriginal)
        newParamList = '(importOriginal)';
      } else {
        // (existingParam) → (importOriginal, existingParam)
        // Preserve internal spacing
        newParamList = `(importOriginal, ${trimmedParams})`;
      }
    }

    // Apply body replacement
    result =
      result.substring(0, m.bodyStart) + newBody + result.substring(bodyEnd);

    // Apply parameter list replacement
    if (newParamList !== m.paramList) {
      result =
        result.substring(0, m.paramListStart) +
        newParamList +
        result.substring(m.paramListStart + m.paramList.length);
    }

    replacements++;
  }

  return { result, replacements };
}

// ── main ──────────────────────────────────────────────────────────────

// Find test files and specific non-test files that may contain vi.mock
const clientSrc = ['packages', 'client', 'src'].join('/');
const testFiles = execSync(
  `grep -rln "await import(" ${clientSrc} ` +
    '--include="*.test.ts" --include="*.test.tsx" --include="*.testUtils.tsx"',
  { encoding: 'utf8' }
)
  .trim()
  .split('\n')
  .filter(Boolean);

// Also check specific non-test files
const extraFiles = [
  `${clientSrc}/test/setup.ts`,
  `${clientSrc}/test/setupIntegration.ts`,
  `${clientSrc}/test/screensaverMock.ts`,
  `${clientSrc}/test/windowRendererTestHarness.tsx`
];

const extraMatches: string[] = [];
for (const f of extraFiles) {
  try {
    const content = readFileSync(f, 'utf8');
    if (content.includes('await import(')) {
      extraMatches.push(f);
    }
  } catch {
    // File doesn't exist, skip
  }
}

const allFiles = [...new Set([...testFiles, ...extraMatches])];

let totalReplacements = 0;
let filesModified = 0;

for (const file of allFiles) {
  const original = readFileSync(file, 'utf8');
  const { result, replacements } = transformFile(original);

  if (replacements > 0) {
    writeFileSync(file, result);
    filesModified++;
    totalReplacements += replacements;
    console.log(
      `  ✔  ${file} (${replacements} vi.mock${replacements > 1 ? 's' : ''} transformed)`
    );
  }
}

console.log(
  `\nDone: ${totalReplacements} vi.mock factories transformed across ${filesModified} files`
);
