#!/usr/bin/env -S pnpm exec tsx
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readEnvValueFromFile,
  type AndroidKeystoreCredentials,
  validateAndroidKeystore,
  validateAndroidKeystoreBase64
} from '../../../../../scripts/lib/androidKeystore.ts';

interface MigrateOptions {
  dryRun: boolean;
  force: boolean;
  secretsDir: string;
}

interface VaultSecretPayload {
  content: string;
  encoding: string;
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  cwd: scriptDir,
  encoding: 'utf8'
}).trim();
process.chdir(repoRoot);

const vaultAddr = process.env.VAULT_ADDR ?? 'http://vault-prod:8200';
const vaultPathPrefix = 'secret/files';
const defaultSecretsDir = resolve(repoRoot, '.secrets');
const vaultKeysFile = resolve(repoRoot, '.secrets/vault-keys.json');
const excludedPatterns = new Set([
  'README.md',
  'vault-keys.json',
  'vault-backups',
  '.DS_Store',
  'dev.env'
]);

function usage(): never {
  process.stdout.write(`Usage: ${process.argv[1]} [options]\n\n`);
  process.stdout.write('Migrates files from .secrets/ to Vault\n\n');
  process.stdout.write('Options:\n');
  process.stdout.write(
    '  -d, --dry-run       Show what would be migrated without doing it\n'
  );
  process.stdout.write(
    '  -f, --force         Write all secrets even if unchanged\n'
  );
  process.stdout.write(
    '  -s, --secrets-dir   Source directory (default: .secrets)\n'
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

function parseArgs(argv: string[]): MigrateOptions {
  let dryRun = false;
  let force = false;
  let secretsDir = defaultSecretsDir;

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

    if (token === '-s' || token === '--secrets-dir') {
      const nextValue = argv[index + 1];
      if (!nextValue) {
        throw new Error(`Missing value for ${token}`);
      }
      secretsDir = resolve(repoRoot, nextValue);
      index += 1;
      continue;
    }

    if (token === '-h' || token === '--help') {
      usage();
    }

    throw new Error(`Unknown option: ${token}`);
  }

  return { dryRun, force, secretsDir };
}

function runVault(args: string[]): string {
  return execFileSync('vault', args, {
    encoding: 'utf8',
    env: { ...process.env, VAULT_ADDR: vaultAddr },
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function ensureVaultAuth(dryRun: boolean): void {
  if (dryRun) {
    return;
  }

  if (!process.env.VAULT_TOKEN) {
    if (existsSync(vaultKeysFile)) {
      const parsed = JSON.parse(readFileSync(vaultKeysFile, 'utf8'));
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'root_token' in parsed &&
        typeof parsed.root_token === 'string' &&
        parsed.root_token.length > 0
      ) {
        process.env.VAULT_TOKEN = parsed.root_token;
      }
    }

    if (!process.env.VAULT_TOKEN) {
      const tokenPath = join(homedir(), '.vault-token');
      if (existsSync(tokenPath)) {
        process.env.VAULT_TOKEN = readFileSync(tokenPath, 'utf8').trim();
      }
    }

    if (
      !process.env.VAULT_TOKEN &&
      process.env.VAULT_USERNAME &&
      process.env.VAULT_PASSWORD
    ) {
      execFileSync(
        'vault',
        [
          'login',
          '-method=userpass',
          `username=${process.env.VAULT_USERNAME}`,
          `password=${process.env.VAULT_PASSWORD}`
        ],
        { env: { ...process.env, VAULT_ADDR: vaultAddr }, stdio: 'ignore' }
      );
    }
  }

  if (!process.env.VAULT_TOKEN) {
    throw new Error(
      `No VAULT_TOKEN, ${vaultKeysFile}, ~/.vault-token, or VAULT_USERNAME/VAULT_PASSWORD set.`
    );
  }

  runVault(['token', 'lookup']);

  const capabilities = runVault([
    'token',
    'capabilities',
    'secret/data/files/_migrate_probe'
  ]).trim();
  if (!/(create|update|root|sudo)/.test(capabilities)) {
    throw new Error(
      `Current token cannot write to secret/data/files/* (capabilities: ${capabilities || 'none'}).`
    );
  }
}

function isExcluded(relativePath: string): boolean {
  const fileName = basename(relativePath);
  if (excludedPatterns.has(fileName)) {
    return true;
  }

  for (const pattern of excludedPatterns) {
    if (relativePath.includes(pattern)) {
      return true;
    }
  }

  return false;
}

function collectFiles(rootPath: string): string[] {
  const files: string[] = [];

  function walk(currentPath: string): void {
    for (const entry of readdirSync(currentPath)) {
      const absolutePath = join(currentPath, entry);
      const stats = statSync(absolutePath);
      if (stats.isDirectory()) {
        walk(absolutePath);
        continue;
      }

      if (stats.isFile()) {
        files.push(absolutePath);
      }
    }
  }

  walk(rootPath);
  return files;
}

function isBinaryFile(filePath: string): boolean {
  const extension = filePath.split('.').at(-1) ?? '';
  if (extension === 'keystore' || extension === 'p8' || extension === 'asc') {
    return true;
  }

  const buffer = readFileSync(filePath);
  return buffer.includes(0);
}

function isJsonFile(filePath: string): boolean {
  return (filePath.split('.').at(-1) ?? '') === 'json';
}

function getVaultPayload(path: string): VaultSecretPayload | undefined {
  try {
    const raw = runVault(['kv', 'get', '-format=json', path]);
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return undefined;
    }

    const data = 'data' in parsed ? parsed.data : undefined;
    if (typeof data !== 'object' || data === null) {
      return undefined;
    }

    const nested = 'data' in data ? data.data : undefined;
    if (typeof nested !== 'object' || nested === null) {
      return undefined;
    }

    const content = 'content' in nested ? nested.content : undefined;
    if (typeof content !== 'string') {
      return undefined;
    }

    const encoding =
      'encoding' in nested && typeof nested.encoding === 'string'
        ? nested.encoding
        : 'text';

    return { content, encoding };
  } catch {
    return undefined;
  }
}

function resolveKeystoreCredentials(secretsDir: string): AndroidKeystoreCredentials {
  const alias = process.env.ANDROID_KEY_ALIAS ?? 'tearleads';
  const rootEnvPath = join(secretsDir, 'root.env');
  const storePassword =
    process.env.ANDROID_KEYSTORE_STORE_PASS ??
    (existsSync(rootEnvPath)
      ? readEnvValueFromFile(rootEnvPath, 'ANDROID_KEYSTORE_STORE_PASS')
      : undefined);
  const keyPassword =
    process.env.ANDROID_KEYSTORE_KEY_PASS ??
    (existsSync(rootEnvPath)
      ? readEnvValueFromFile(rootEnvPath, 'ANDROID_KEYSTORE_KEY_PASS')
      : undefined);

  if (!storePassword || !keyPassword) {
    throw new Error(
      `Keystore validation failed: missing ANDROID_KEYSTORE_STORE_PASS/ANDROID_KEYSTORE_KEY_PASS (env or ${rootEnvPath}).`
    );
  }

  return { keyAlias: alias, keyPassword, storePassword };
}

function main(): void {
  const options = parseArgs(process.argv);

  if (!existsSync(options.secretsDir)) {
    throw new Error(`Secrets directory not found: ${options.secretsDir}`);
  }

  ensureVaultAuth(options.dryRun);

  process.stdout.write(
    `==> Migrating secrets from ${options.secretsDir} to Vault\n`
  );
  process.stdout.write(`    Vault: ${vaultAddr}\n`);
  process.stdout.write(`    Path prefix: ${vaultPathPrefix}\n`);
  if (options.dryRun) {
    process.stdout.write('    Mode: DRY RUN (no changes will be made)\n');
  }
  process.stdout.write('\n');

  let newCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;
  let skippedCount = 0;

  for (const filePath of collectFiles(options.secretsDir)) {
    const relativePath = filePath.slice(options.secretsDir.length + 1);

    if (isExcluded(relativePath)) {
      process.stdout.write(`[SKIP] ${relativePath} (excluded)\n`);
      skippedCount += 1;
      continue;
    }

    const fileName = basename(filePath);
    const vaultPath = `${vaultPathPrefix}/${fileName}`;

    let content: string;
    let encoding: string;
    if (isBinaryFile(filePath)) {
      content = readFileSync(filePath).toString('base64');
      encoding = 'base64';
    } else if (isJsonFile(filePath)) {
      content = readFileSync(filePath, 'utf8');
      encoding = 'json';
    } else {
      content = readFileSync(filePath, 'utf8');
      encoding = 'text';
    }

    const existingPayload =
      options.dryRun || !options.force ? getVaultPayload(vaultPath) : undefined;
    const secretExists = existingPayload !== undefined;

    let existingKeystoreValid = true;
    if (encoding === 'base64' && fileName.endsWith('.keystore')) {
      const credentials = resolveKeystoreCredentials(options.secretsDir);
      validateAndroidKeystore(
        filePath,
        credentials,
        `Local file ${relativePath}`
      );
      validateAndroidKeystoreBase64(
        content,
        credentials,
        `Encoded payload for ${relativePath}`
      );

      if (existingPayload) {
        try {
          validateAndroidKeystoreBase64(
            existingPayload.content,
            credentials,
            `Existing Vault secret ${vaultPath}`
          );
        } catch {
          existingKeystoreValid = false;
          process.stderr.write(
            `WARNING: Existing Vault keystore at ${vaultPath} is invalid; update required.\n`
          );
        }
      }
    }

    const unchanged =
      !options.force &&
      secretExists &&
      existingKeystoreValid &&
      existingPayload?.content === content;

    if (options.dryRun) {
      if (unchanged) {
        process.stdout.write(`[UNCHANGED] ${relativePath} (${encoding})\n`);
        unchangedCount += 1;
        continue;
      }

      if (secretExists) {
        process.stdout.write(
          `[DRY][UPDATE] ${relativePath} -> ${vaultPath} (${encoding})\n`
        );
        updatedCount += 1;
      } else {
        process.stdout.write(
          `[DRY][NEW] ${relativePath} -> ${vaultPath} (${encoding})\n`
        );
        newCount += 1;
      }
      continue;
    }

    if (unchanged) {
      process.stdout.write(`[UNCHANGED] ${relativePath} (${encoding})\n`);
      unchangedCount += 1;
      continue;
    }

    if (secretExists) {
      process.stdout.write(
        `[UPDATE] ${relativePath} -> ${vaultPath} (${encoding})\n`
      );
      updatedCount += 1;
    } else {
      process.stdout.write(`[NEW] ${relativePath} -> ${vaultPath} (${encoding})\n`);
      newCount += 1;
    }

    runVault([
      'kv',
      'put',
      vaultPath,
      `content=${content}`,
      `encoding=${encoding}`,
      `original_filename=${fileName}`
    ]);
  }

  process.stdout.write('\n==> Migration complete!\n');
  process.stdout.write(`    New:       ${newCount} files\n`);
  process.stdout.write(`    Updated:   ${updatedCount} files\n`);
  process.stdout.write(`    Unchanged: ${unchangedCount} files\n`);
  process.stdout.write(`    Skipped:   ${skippedCount} files\n`);

  if (options.dryRun) {
    process.stdout.write('\nThis was a dry run. Run without -d to actually migrate.\n');
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`ERROR: ${message}\n`);
  process.exit(1);
}
