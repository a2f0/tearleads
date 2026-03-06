#!/usr/bin/env -S node --import tsx
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const PM_SCRIPT_PATH = fileURLToPath(new URL('../tooling/pm.sh', import.meta.url));
const API_CLI_PATH = fileURLToPath(
  new URL('../../packages/api/src/apiCli.ts', import.meta.url)
);

function main(): void {
  const args = process.argv.slice(2);
  execFileSync(
    'sh',
    [PM_SCRIPT_PATH, 'exec', 'tsx', API_CLI_PATH, 'list-users', ...args],
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
