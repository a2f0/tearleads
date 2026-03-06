#!/usr/bin/env -S node --import tsx
import { pathToFileURL } from 'node:url';
import { runApiCli } from './lib/runApiCli.ts';

function main(): void {
  runApiCli(['list-admins', ...process.argv.slice(2)]);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main();
  } catch (error) {
    console.error('Failed to list admins:', error);
    process.exitCode = 1;
  }
}
