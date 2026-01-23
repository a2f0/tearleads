#!/usr/bin/env -S pnpm exec tsx
import { pathToFileURL } from 'node:url';
import { runCreateAccountFromArgv } from '../packages/api/src/cli/createAccount.ts';

async function main(): Promise<void> {
  await runCreateAccountFromArgv(process.argv.slice(2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error('Failed to create account:', error);
    process.exitCode = 1;
  });
}
