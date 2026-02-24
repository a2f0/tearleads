#!/usr/bin/env -S pnpm exec tsx
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

function main(): void {
  const args = process.argv.slice(2);
  execFileSync(
    'pnpm',
    ['--filter', '@tearleads/api', 'cli', 'list-users', ...args],
    { stdio: 'inherit' }
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main();
  } catch {
    process.exitCode = 1;
  }
}
