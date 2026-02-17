#!/usr/bin/env -S pnpm exec tsx
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface DeployKey {
  id?: number;
  title?: string;
  key?: string;
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const keyPath = path.join(repoRoot, '.secrets', 'tuxedoGithubDeployKey');
const pubPath = `${keyPath}.pub`;
const keyTitle = 'tuxedoGithubDeployKey';
const oldKeyTitle = 'tuxedo deploy key';
const oldKeyPath = path.join(repoRoot, '.secrets', 'tuxedoDeploy.key');
const oldPubPath = `${oldKeyPath}.pub`;

const ghEnv: NodeJS.ProcessEnv = {
  ...process.env,
  GH_PAGER: 'cat',
  GH_NO_UPDATE_NOTIFIER: '1'
};

function runGh(args: string[], input?: string): string {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: ghEnv,
    input
  }).trim();
}

function renameIfNeeded(fromPath: string, toPath: string): void {
  if (!existsSync(toPath) && existsSync(fromPath)) {
    renameSync(fromPath, toPath);
  }
}

function ensureKeypair(): void {
  mkdirSync(path.dirname(keyPath), { recursive: true });
  renameIfNeeded(oldKeyPath, keyPath);
  renameIfNeeded(oldPubPath, pubPath);

  if (!existsSync(keyPath)) {
    const result = spawnSync(
      'ssh-keygen',
      ['-t', 'ed25519', '-C', keyTitle, '-f', keyPath, '-N', ''],
      { stdio: 'inherit' }
    );
    if (result.status !== 0) {
      throw new Error('ssh-keygen failed');
    }
  }

  if (!existsSync(pubPath)) {
    throw new Error(`Missing public key at ${pubPath}`);
  }
}

function parsePublicKey(): string {
  const raw = readFileSync(pubPath, 'utf8').trim();
  const parts = raw.split(/\s+/);
  return parts.length >= 2 ? `${parts[0]} ${parts[1]}` : raw;
}

function getRepoNameWithOwner(): string {
  const repo = runGh([
    'repo',
    'view',
    '--json',
    'nameWithOwner',
    '-q',
    '.nameWithOwner'
  ]);
  if (repo.length === 0) {
    throw new Error('Could not determine repository from gh CLI');
  }
  return repo;
}

function main(): void {
  ensureKeypair();
  const repo = getRepoNameWithOwner();
  const pubKey = parsePublicKey();

  const existingRaw = runGh(['api', '--paginate', `/repos/${repo}/keys`]);
  const existing = JSON.parse(existingRaw) as DeployKey[];

  const idsToDelete: number[] = [];
  let foundMatchingKey = false;

  for (const item of existing) {
    if (typeof item.id !== 'number') {
      continue;
    }

    if (item.title === oldKeyTitle) {
      idsToDelete.push(item.id);
      continue;
    }

    if (item.title === keyTitle) {
      if (item.key === pubKey) {
        foundMatchingKey = true;
      } else {
        idsToDelete.push(item.id);
      }
    }
  }

  for (const keyId of idsToDelete) {
    runGh(['api', '-X', 'DELETE', `/repos/${repo}/keys/${keyId}`]);
  }

  if (foundMatchingKey) {
    process.stdout.write('Deploy key already exists and matches public key.\n');
    return;
  }

  const payload = JSON.stringify({
    title: keyTitle,
    key: pubKey,
    read_only: false
  });
  runGh(['api', '-X', 'POST', `/repos/${repo}/keys`, '--input', '-'], payload);
  process.stdout.write('Deploy key created.\n');
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
}
