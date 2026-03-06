#!/usr/bin/env -S node --import tsx
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { optimize } from 'svgo';

function exitWithError(message: string): never {
  console.error(message);
  process.exit(1);
}

const [inputPath] = process.argv.slice(2);

if (!inputPath) {
  exitWithError('Usage: optimizeSvg.ts <svg-file>');
}

const resolvedPath = path.resolve(process.cwd(), inputPath);

if (!fs.existsSync(resolvedPath)) {
  exitWithError(`SVG file not found: ${resolvedPath}`);
}

const source = fs.readFileSync(resolvedPath, 'utf8');
const result = optimize(source, { path: resolvedPath });

fs.writeFileSync(resolvedPath, result.data);
