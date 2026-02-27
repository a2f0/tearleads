#!/usr/bin/env -S pnpm exec tsx
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decodeBase64Strict,
  validateAndroidKeystore
} from '../../../../../scripts/lib/androidKeystore.ts';
import {
  ensureVaultAuth as ensureVaultAuthShared,
  readVaultSecretPayload,
  resolveKeystoreCredentials,
  runVault
} from '../../../../../scripts/lib/vault.ts';

interface FetchOptions {
  dryRun: boolean;
  force: boolean;
  outputDir: string;
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  cwd: scriptDir,
  encoding: 'utf8'
}).trim();
process.chdir(repoRoot);

const vaultPathPrefix = 'secret/files';
const defaultSecretsDir = resolve(repoRoot, '.secrets');
const vaultKeysFile = resolve(repoRoot, '.secrets/vault-keys.json');
const vaultAddr = process.env.VAULT_ADDR ?? 'http://vault-prod:8200';

function usage(): never {
  process.stdout.write(`Usage: ${process.argv[1]} [options]\n\n`);
  process.stdout.write(
    'Fetches secrets from Vault and compares against .secrets/.\n'
  );
  process.stdout.write(
    'By default, fetches into memory and reports diffs without writing.\n'
  );
  process.stdout.write('Use -f to actually write files.\n\n');
  process.stdout.write('Options:\n');
  process.stdout.write(
    '  -d, --dry-run       List secrets without fetching from Vault\n'
  );
  process.stdout.write(
    '  -o, --output-dir    Output directory (default: .secrets)\n'
  );
  process.stdout.write(
    '  -f, --force         Write fetched secrets to disk (overwrite existing)\n'
  );
  process.stdout.write('  -h, --help          Show this help\n\n');
  process.stdout.write('Environment:\n');
  process.stdout.write(
    '  VAULT_USERNAME     Username for userpass auth (optional)\n'
  );
  process.stdout.write(
    '  VAULT_PASSWORD     Password for userpass auth (optional)\n'
  );
  process.stdout.write(
    '  ANDROID_KEY_ALIAS  Keystore alias override (default: tearleads)\n'
  );
  process.stdout.write('  VAULT_TOKEN        Direct token auth (optional)\n');
  process.stdout.write(
    `  VAULT_ADDR         Vault address (default: ${vaultAddr})\n`
  );
  process.exit(0);
}

function parseArgs(argv: string[]): FetchOptions {
  let dryRun = false;
  let force = false;
  let outputDir = defaultSecretsDir;

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '-d' || token === '--dry-run') {
      dryRun = true;
      continue;
    }

    if (token === '-f' || token === '--force') {
      force = true;
      continue;
    }

    if (token === '-o' || token === '--output-dir') {
      const nextValue = argv[index + 1];
      if (!nextValue) {
        throw new Error(`Missing value for ${token}`);
      }
      outputDir = resolve(repoRoot, nextValue);
      index += 1;
      continue;
    }

    if (token === '-h' || token === '--help') {
      usage();
    }

    throw new Error(`Unknown option: ${token}`);
  }

  return { dryRun, force, outputDir };
}

function ensureVaultAuth(): void {
  ensureVaultAuthShared({
    vaultAddr,
    vaultKeysFile
  });
}

function listVaultSecrets(): string[] {
  const raw = runVault(['kv', 'list', '-format=json', vaultPathPrefix], vaultAddr);
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    return [];
  }

  const names: string[] = [];
  for (const item of parsed) {
    if (typeof item === 'string' && item.length > 0) {
      names.push(item);
    }
  }

  names.sort((left, right) => {
    if (left === 'root.env') {
      return -1;
    }
    if (right === 'root.env') {
      return 1;
    }
    return left.localeCompare(right);
  });

  return names;
}

function main(): void {
  const options = parseArgs(process.argv);
  ensureVaultAuth();

  process.stdout.write(
    `==> Fetching secrets from Vault to ${options.outputDir}\n`
  );
  process.stdout.write(`    Vault: ${vaultAddr}\n`);
  process.stdout.write(`    Path: ${vaultPathPrefix}\n`);
  if (options.dryRun) {
    process.stdout.write('    Mode: DRY RUN\n');
  }
  process.stdout.write('\n');

  mkdirSync(options.outputDir, { recursive: true });
  const secretNames = listVaultSecrets();
  if (secretNames.length === 0) {
    process.stdout.write(`No secrets found at ${vaultPathPrefix}\n`);
    return;
  }

  let incoming = 0;
  let newFiles = 0;
  let unchanged = 0;
  let written = 0;

  for (const secretName of secretNames) {
    const secretPath = `${vaultPathPrefix}/${secretName}`;
    const outputPath = join(options.outputDir, secretName);

    if (options.dryRun) {
      process.stdout.write(`[DRY] ${secretPath} -> ${outputPath}\n`);
      newFiles += 1;
      continue;
    }

    const payload = readVaultSecretPayload(secretPath, vaultAddr);
    const tempDir = mkdtempSync(join(tmpdir(), 'tearleads-vault-fetch-'));
    const tempPath = join(tempDir, 'secret.bin');

    try {
      if (payload.encoding === 'base64') {
        writeFileSync(
          tempPath,
          decodeBase64Strict(payload.content, `Vault secret ${secretPath}`)
        );
      } else {
        writeFileSync(tempPath, `${payload.content}\n`, 'utf8');
      }

      if (secretName.endsWith('.keystore')) {
        validateAndroidKeystore(
          tempPath,
          resolveKeystoreCredentials(
            options.outputDir,
            'Vault keystore validation failed'
          ),
          `Vault secret ${secretPath}`
        );
      }

      if (existsSync(outputPath)) {
        const nextBuffer = readFileSync(tempPath);
        const currentBuffer = readFileSync(outputPath);
        if (Buffer.compare(nextBuffer, currentBuffer) === 0) {
          process.stdout.write(`[OK] ${secretName} (unchanged)\n`);
          unchanged += 1;
          continue;
        }

        if (!options.force) {
          process.stdout.write(
            `[INCOMING] ${secretName} (remote differs, use -f to overwrite)\n`
          );
          incoming += 1;
          continue;
        }

        process.stdout.write(
          `[UPDATE] ${secretPath} -> ${outputPath} (${payload.encoding})\n`
        );
        copyFileSync(tempPath, outputPath);
        chmodSync(outputPath, 0o600);
        written += 1;
        continue;
      }

      if (!options.force) {
        process.stdout.write(
          `[NEW] ${secretName} (not on disk, use -f to write)\n`
        );
        newFiles += 1;
        continue;
      }

      process.stdout.write(
        `[NEW] ${secretPath} -> ${outputPath} (${payload.encoding})\n`
      );
      copyFileSync(tempPath, outputPath);
      chmodSync(outputPath, 0o600);
      written += 1;
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  }

  process.stdout.write('\n==> Fetch complete!\n');
  process.stdout.write(`    Unchanged: ${unchanged} files\n`);
  process.stdout.write(`    Incoming changes: ${incoming} files\n`);
  process.stdout.write(`    New (not on disk): ${newFiles} files\n`);
  process.stdout.write(`    Written: ${written} files\n`);
  if (incoming > 0 || newFiles > 0) {
    process.stdout.write('\n    Run with -f to apply incoming changes and write new files.\n');
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`ERROR: ${message}\n`);
  process.exit(1);
}
