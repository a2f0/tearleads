#!/usr/bin/env -S pnpm exec tsx
/**
 * Check if a port is already in use. Exits with code 1 if the port is occupied.
 * Usage: tsx scripts/lib/checkPort.ts <port> [host]
 */
import { createExitOnce, isPortInUse, parsePort } from './portHelpers.ts';

const portArg = process.argv[2] || '3000';
const port = parsePort(portArg);
const host = process.argv[3] || '127.0.0.1';
const timeoutMs = 500;

if (port === null) {
  console.error(`Invalid port: ${process.argv[2]}`);
  process.exit(2);
}

const finish = createExitOnce();

const main = async (): Promise<void> => {
  const inUse = await isPortInUse({ host, port, timeoutMs });
  if (inUse) {
    console.error(`Error: Port ${port} is already in use on ${host}.`);
    console.error('Please stop the existing server before running tests.');
    finish(1);
    return;
  }

  finish(0);
};

main().catch((error: unknown) => {
  console.error('[checkPort] Error:', error);
  finish(1);
});
