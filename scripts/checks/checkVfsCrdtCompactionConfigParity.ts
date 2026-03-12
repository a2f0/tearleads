#!/usr/bin/env -S node --import tsx
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const API_DEFAULTS_PATH = 'packages/api/src/lib/vfsCrdtCompaction.ts';

const CONFIG_PATHS = [
  'terraform/stacks/staging/k8s/manifests/configmap.yaml',
  'terraform/stacks/staging/k8s/manifests/kustomize/base/configmap.yaml',
  'terraform/stacks/prod/k8s/manifests/configmap.yaml'
] as const;

type ExpectedEnv = Record<
  | 'VFS_CRDT_COMPACTION_HOT_RETENTION_DAYS'
  | 'VFS_CRDT_COMPACTION_INACTIVE_CLIENT_DAYS'
  | 'VFS_CRDT_COMPACTION_SAFETY_BUFFER_HOURS',
  string
>;

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
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..'
  );

  const expectedEnv = await loadExpectedEnv(repoRoot, errors);

  if (expectedEnv) {
    for (const relativePath of CONFIG_PATHS) {
      const absolutePath = path.join(repoRoot, relativePath);
      const content = await fs.readFile(absolutePath, 'utf8');

      for (const [key, expected] of Object.entries(expectedEnv)) {
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

function extractMultiplierFromSource(input: {
  content: string;
  constantName: string;
  unitName: 'MS_PER_DAY' | 'MS_PER_HOUR';
}): number | null {
  const pattern = new RegExp(
    `${input.constantName}\\s*=\\s*(\\d+)\\s*\\*\\s*${input.unitName}`,
    'u'
  );
  const match = input.content.match(pattern);
  if (!match || !match[1]) {
    return null;
  }

  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function loadExpectedEnv(
  repoRoot: string,
  errors: string[]
): Promise<ExpectedEnv | null> {
  const defaultsSourcePath = path.join(repoRoot, API_DEFAULTS_PATH);
  const content = await fs.readFile(defaultsSourcePath, 'utf8');

  const hotRetentionDays = extractMultiplierFromSource({
    content,
    constantName: 'DEFAULT_VFS_CRDT_HOT_RETENTION_MS',
    unitName: 'MS_PER_DAY'
  });
  const inactiveClientDays = extractMultiplierFromSource({
    content,
    constantName: 'DEFAULT_VFS_CRDT_INACTIVE_CLIENT_WINDOW_MS',
    unitName: 'MS_PER_DAY'
  });
  const safetyBufferHours = extractMultiplierFromSource({
    content,
    constantName: 'DEFAULT_VFS_CRDT_CURSOR_SAFETY_BUFFER_MS',
    unitName: 'MS_PER_HOUR'
  });

  if (!hotRetentionDays) {
    errors.push(
      `${API_DEFAULTS_PATH}: failed to parse DEFAULT_VFS_CRDT_HOT_RETENTION_MS`
    );
  }
  if (!inactiveClientDays) {
    errors.push(
      `${API_DEFAULTS_PATH}: failed to parse DEFAULT_VFS_CRDT_INACTIVE_CLIENT_WINDOW_MS`
    );
  }
  if (!safetyBufferHours) {
    errors.push(
      `${API_DEFAULTS_PATH}: failed to parse DEFAULT_VFS_CRDT_CURSOR_SAFETY_BUFFER_MS`
    );
  }

  if (!hotRetentionDays || !inactiveClientDays || !safetyBufferHours) {
    return null;
  }

  // Keep shape deterministic to avoid undefined key handling downstream.
  return {
    VFS_CRDT_COMPACTION_HOT_RETENTION_DAYS: String(hotRetentionDays),
    VFS_CRDT_COMPACTION_INACTIVE_CLIENT_DAYS: String(inactiveClientDays),
    VFS_CRDT_COMPACTION_SAFETY_BUFFER_HOURS: String(safetyBufferHours)
  };
}

await checkParity();
