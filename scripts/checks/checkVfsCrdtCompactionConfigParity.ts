#!/usr/bin/env -S node --import tsx
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_VFS_CRDT_CURSOR_SAFETY_BUFFER_MS,
  DEFAULT_VFS_CRDT_HOT_RETENTION_MS,
  DEFAULT_VFS_CRDT_INACTIVE_CLIENT_WINDOW_MS
} from '../../packages/api/src/lib/vfsCrdtCompaction.ts';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_HOUR = 60 * 60 * 1000;

const CONFIG_PATHS = [
  'terraform/stacks/staging/k8s/manifests/configmap.yaml',
  'terraform/stacks/staging/k8s/manifests/kustomize/base/configmap.yaml',
  'terraform/stacks/prod/k8s/manifests/configmap.yaml'
] as const;

const EXPECTED_ENV = {
  VFS_CRDT_COMPACTION_HOT_RETENTION_DAYS: String(
    DEFAULT_VFS_CRDT_HOT_RETENTION_MS / MS_PER_DAY
  ),
  VFS_CRDT_COMPACTION_INACTIVE_CLIENT_DAYS: String(
    DEFAULT_VFS_CRDT_INACTIVE_CLIENT_WINDOW_MS / MS_PER_DAY
  ),
  VFS_CRDT_COMPACTION_SAFETY_BUFFER_HOURS: String(
    DEFAULT_VFS_CRDT_CURSOR_SAFETY_BUFFER_MS / MS_PER_HOUR
  )
} as const;

function trimYamlValue(rawValue: string): string {
  const withoutComment = rawValue.split('#')[0]?.trim() ?? '';
  if (withoutComment.startsWith('"') && withoutComment.endsWith('"')) {
    return withoutComment.slice(1, -1);
  }
  if (withoutComment.startsWith("'") && withoutComment.endsWith("'")) {
    return withoutComment.slice(1, -1);
  }
  return withoutComment;
}

function readEnvValue(content: string, key: string): string | null {
  for (const line of content.split(/\r?\n/u)) {
    const separator = line.indexOf(':');
    if (separator < 0) {
      continue;
    }

    const parsedKey = line.slice(0, separator).trim();
    if (parsedKey !== key) {
      continue;
    }

    return trimYamlValue(line.slice(separator + 1));
  }

  return null;
}

async function checkParity(): Promise<void> {
  const errors: string[] = [];

  if (DEFAULT_VFS_CRDT_HOT_RETENTION_MS % MS_PER_DAY !== 0) {
    errors.push(
      'DEFAULT_VFS_CRDT_HOT_RETENTION_MS is not an integer number of days'
    );
  }
  if (DEFAULT_VFS_CRDT_INACTIVE_CLIENT_WINDOW_MS % MS_PER_DAY !== 0) {
    errors.push(
      'DEFAULT_VFS_CRDT_INACTIVE_CLIENT_WINDOW_MS is not an integer number of days'
    );
  }
  if (DEFAULT_VFS_CRDT_CURSOR_SAFETY_BUFFER_MS % MS_PER_HOUR !== 0) {
    errors.push(
      'DEFAULT_VFS_CRDT_CURSOR_SAFETY_BUFFER_MS is not an integer number of hours'
    );
  }

  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..'
  );
  for (const relativePath of CONFIG_PATHS) {
    const absolutePath = path.join(repoRoot, relativePath);
    const content = await fs.readFile(absolutePath, 'utf8');

    for (const [key, expected] of Object.entries(EXPECTED_ENV)) {
      const actual = readEnvValue(content, key);
      if (actual === null) {
        errors.push(`${relativePath}: missing ${key}`);
        continue;
      }
      if (actual !== expected) {
        errors.push(
          `${relativePath}: ${key} expected ${expected} but found ${actual}`
        );
      }
    }
  }

  if (errors.length > 0) {
    console.error('VFS CRDT compaction config parity check failed:');
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log('VFS CRDT compaction config parity check passed.');
}

await checkParity();
