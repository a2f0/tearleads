#!/usr/bin/env tsx
import { existsSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

const target = 'CLAUDE.md';
const link = 'AGENTS.md';

const targetPath = join(rootDir, target);
const linkPath = join(rootDir, link);

if (!existsSync(targetPath)) {
  console.log(`postinstall: missing ${target}, skipping ${link} symlink`);
  process.exit(0);
}

// Remove existing link/file if it exists
rmSync(linkPath, { force: true });

// Create symlink - on Windows this may fail without admin rights or developer mode
try {
  symlinkSync(target, linkPath);
} catch (error) {
  if (process.platform === 'win32') {
    console.warn(
      `postinstall: skipping ${link} symlink on Windows (requires admin rights or developer mode)`,
    );
  } else {
    throw error;
  }
}
