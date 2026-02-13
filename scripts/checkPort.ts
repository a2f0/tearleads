#!/usr/bin/env -S pnpm exec tsx
/**
 * Check if a port is already in use. Exits with code 1 if the port is occupied.
 * Usage: tsx scripts/checkPort.ts <port> [host]
 */
import net from 'node:net';

const port = Number.parseInt(process.argv[2] || '3000', 10);
const host = process.argv[3] || '127.0.0.1';
const timeoutMs = 500;

if (Number.isNaN(port) || port < 1 || port > 65535) {
  console.error(`Invalid port: ${process.argv[2]}`);
  process.exit(2);
}

let finished = false;
const finish = (code: number): void => {
  if (finished) {
    return;
  }
  finished = true;
  process.exit(code);
};

const socket = net.connect({ host, port });

socket.setTimeout(timeoutMs);

socket.once('connect', () => {
  console.error(`Error: Port ${port} is already in use on ${host}.`);
  console.error('Please stop the existing server before running tests.');
  socket.end();
  finish(1);
});

socket.once('timeout', () => {
  socket.destroy();
  finish(0);
});

socket.once('error', () => {
  socket.destroy();
  finish(0);
});
