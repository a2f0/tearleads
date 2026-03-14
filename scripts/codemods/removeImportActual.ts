#!/usr/bin/env bun
/**
 * Codemod: replace vi.importActual with dynamic import()
 *
 * vi.importActual<T>(path) → import(path)
 *
 * Inside a vi.mock factory, dynamic import() returns the REAL (unmocked)
 * module — the same semantics as vi.importActual — so the replacement is
 * safe and eliminates the Bun-incompatible API.
 *
 * Handles:
 *  - vi.importActual<typeof import('...')>('...')   (typed, single-line)
 *  - vi.importActual<\n  typeof import('...')\n>   (typed, multi-line)
 *  - vi.importActual<Record<string, unknown>>       (nested generics)
 *  - vi.importActual('...')                          (untyped)
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const TOKEN = 'vi.importActual';

function replaceImportActual(content: string): {
  result: string;
  replacements: number;
} {
  let replacements = 0;
  let result = content;

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  while (true) {
    const idx = result.indexOf(TOKEN);
    if (idx === -1) break;

    let pos = idx + TOKEN.length;

    // Skip optional whitespace after vi.importActual
    while (pos < result.length && /\s/u.test(result[pos])) pos++;

    if (result[pos] === '<') {
      // Has type parameter — find matching '>' respecting nesting
      let depth = 1;
      pos++; // skip opening '<'
      while (pos < result.length && depth > 0) {
        if (result[pos] === '<') depth++;
        if (result[pos] === '>') depth--;
        pos++;
      }
      // pos is now past the closing '>'
      // Skip whitespace before '('
      while (pos < result.length && /\s/u.test(result[pos])) pos++;
    }

    if (result[pos] === '(') {
      // Replace  vi.importActual<...>(  →  import(
      result = result.substring(0, idx) + 'import(' + result.substring(pos + 1);
      replacements++;
    } else {
      // Unexpected token after vi.importActual — bail on this occurrence
      console.error(
        `  ⚠  unexpected char '${result[pos]}' at offset ${pos}, skipping`
      );
      break;
    }
  }

  return { result, replacements };
}

// ── main ──────────────────────────────────────────────────────────────
const files = execSync(
  'grep -rln "vi.importActual" packages/client/src --include="*.test.*"',
  { encoding: 'utf8' }
)
  .trim()
  .split('\n')
  .filter(Boolean);

let totalReplacements = 0;
let filesModified = 0;

for (const file of files) {
  const original = readFileSync(file, 'utf8');
  const { result, replacements } = replaceImportActual(original);

  if (replacements > 0) {
    writeFileSync(file, result);
    filesModified++;
    totalReplacements += replacements;
    console.log(`  ✔  ${file} (${replacements} replacement${replacements > 1 ? 's' : ''})`);
  }
}

console.log(
  `\nDone: ${totalReplacements} replacements across ${filesModified} files`
);
