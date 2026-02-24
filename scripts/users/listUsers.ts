#!/usr/bin/env -S pnpm exec tsx
import { pathToFileURL } from 'node:url';
import { runListUsersFromArgv } from '../../packages/api/src/cli/listUsers.ts';

async function main(): Promise<void> {
  await runListUsersFromArgv(process.argv.slice(2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error('Failed to list users:', error);
    process.exitCode = 1;
  });
}
