import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  type AndroidKeystoreCredentials,
  readEnvValueFromFile
} from './androidKeystore.ts';

export interface VaultSecretPayload {
  content: string;
  encoding: string;
}

interface EnsureVaultAuthOptions {
  dryRun?: boolean;
  requireWritePath?: string;
  vaultAddr: string;
  vaultKeysFile: string;
}

export function runVault(args: string[], vaultAddr: string): string {
  return execFileSync('vault', args, {
    encoding: 'utf8',
    env: { ...process.env, VAULT_ADDR: vaultAddr },
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

export function ensureVaultAuth(options: EnsureVaultAuthOptions): void {
  if (options.dryRun) {
    return;
  }

  if (!process.env.VAULT_TOKEN) {
    if (existsSync(options.vaultKeysFile)) {
      const parsed = JSON.parse(readFileSync(options.vaultKeysFile, 'utf8'));
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
        {
          env: { ...process.env, VAULT_ADDR: options.vaultAddr },
          stdio: 'ignore'
        }
      );
    }
  }

  if (!process.env.VAULT_TOKEN) {
    throw new Error(
      `No VAULT_TOKEN, ${options.vaultKeysFile}, ~/.vault-token, or VAULT_USERNAME/VAULT_PASSWORD set.`
    );
  }

  runVault(['token', 'lookup'], options.vaultAddr);

  if (options.requireWritePath) {
    const capabilities = runVault(
      ['token', 'capabilities', options.requireWritePath],
      options.vaultAddr
    ).trim();
    if (!/(create|update|root|sudo)/.test(capabilities)) {
      throw new Error(
        `Current token cannot write to ${options.requireWritePath} (capabilities: ${capabilities || 'none'}).`
      );
    }
  }
}

export function readVaultSecretPayload(
  secretPath: string,
  vaultAddr: string
): VaultSecretPayload {
  const raw = runVault(['kv', 'get', '-format=json', secretPath], vaultAddr);
  const parsed = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`Vault payload is malformed for ${secretPath}`);
  }

  const data = 'data' in parsed ? parsed.data : undefined;
  if (typeof data !== 'object' || data === null) {
    throw new Error(`Vault data node is missing for ${secretPath}`);
  }

  const nested = 'data' in data ? data.data : undefined;
  if (typeof nested !== 'object' || nested === null) {
    throw new Error(`Vault secret fields are missing for ${secretPath}`);
  }

  const content = 'content' in nested ? nested.content : undefined;
  if (typeof content !== 'string') {
    throw new Error(`Vault secret content is missing for ${secretPath}`);
  }

  const encoding =
    'encoding' in nested && typeof nested.encoding === 'string'
      ? nested.encoding
      : 'text';

  return { content, encoding };
}

export function tryReadVaultSecretPayload(
  secretPath: string,
  vaultAddr: string
): VaultSecretPayload | undefined {
  try {
    return readVaultSecretPayload(secretPath, vaultAddr);
  } catch {
    return undefined;
  }
}

export function resolveKeystoreCredentials(
  secretsDir: string,
  errorPrefix: string
): AndroidKeystoreCredentials {
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
      `${errorPrefix}: missing ANDROID_KEYSTORE_STORE_PASS/ANDROID_KEYSTORE_KEY_PASS (env or ${rootEnvPath}).`
    );
  }

  return { keyAlias: alias, keyPassword, storePassword };
}
