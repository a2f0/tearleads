#!/usr/bin/env -S pnpm exec tsx
import { pathToFileURL } from 'node:url';
import { runListAdminsFromArgv } from '../../packages/api/src/cli/listAdmins.ts';

async function main(): Promise<void> {
  await runListAdminsFromArgv(process.argv.slice(2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error('Failed to list admins:', error);
    process.exitCode = 1;
  });
}
