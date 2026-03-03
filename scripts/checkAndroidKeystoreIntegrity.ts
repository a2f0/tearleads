#!/usr/bin/env -S pnpm exec tsx
import { existsSync, readFileSync } from 'node:fs';
import {
  validateAndroidKeystore,
  validateAndroidKeystoreBase64
} from './lib/androidKeystore.ts';

type SourceType = 'file' | 'env';

interface IntegrityOptions {
  source: SourceType;
  filePath?: string;
  base64EnvName?: string;
  keyAlias: string;
  keyAliasEnvName?: string;
  storePassEnvName: string;
  keyPassEnvName: string;
  context: string;
}

function usage(): never {
  process.stdout.write(
    `Usage: ${process.argv[1]} --source <file|env> [options]\n\n`
  );
  process.stdout.write('Options:\n');
  process.stdout.write(
    '  --source <file|env>               Validation source type\n'
  );
  process.stdout.write(
    '  --file <path>                     Required when --source file\n'
  );
  process.stdout.write(
    '  --base64-env <ENV_NAME>           Required when --source env\n'
  );
  process.stdout.write(
    '  --store-pass-env <ENV_NAME>       Env var containing store password\n'
  );
  process.stdout.write(
    '  --key-pass-env <ENV_NAME>         Env var containing key password\n'
  );
  process.stdout.write(
    '  --key-alias <alias>               Keystore alias (default: tearleads)\n'
  );
  process.stdout.write(
    '  --key-alias-env <ENV_NAME>        Alias env var (takes precedence)\n'
  );
  process.stdout.write(
    '  --context <label>                 Context label for error messages\n'
  );
  process.stdout.write('  --help                            Show help\n');
  process.exit(0);
}

function requireArgValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function parseArgs(argv: string[]): IntegrityOptions {
  let source: SourceType | undefined;
  let filePath: string | undefined;
  let base64EnvName: string | undefined;
  let keyAlias = 'tearleads';
  let keyAliasEnvName: string | undefined;
  let storePassEnvName: string | undefined;
  let keyPassEnvName: string | undefined;
  let context = 'Android keystore integrity check';

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') {
      usage();
    }

    if (token === '--source') {
      const value = requireArgValue(argv, index, token);
      if (value !== 'file' && value !== 'env') {
        throw new Error(`Invalid source '${value}'. Expected 'file' or 'env'.`);
      }
      source = value;
      index += 1;
      continue;
    }

    if (token === '--file') {
      filePath = requireArgValue(argv, index, token);
      index += 1;
      continue;
    }

    if (token === '--base64-env') {
      base64EnvName = requireArgValue(argv, index, token);
      index += 1;
      continue;
    }

    if (token === '--store-pass-env') {
      storePassEnvName = requireArgValue(argv, index, token);
      index += 1;
      continue;
    }

    if (token === '--key-pass-env') {
      keyPassEnvName = requireArgValue(argv, index, token);
      index += 1;
      continue;
    }

    if (token === '--key-alias') {
      keyAlias = requireArgValue(argv, index, token);
      index += 1;
      continue;
    }

    if (token === '--key-alias-env') {
      keyAliasEnvName = requireArgValue(argv, index, token);
      index += 1;
      continue;
    }

    if (token === '--context') {
      context = requireArgValue(argv, index, token);
      index += 1;
      continue;
    }

    throw new Error(`Unknown option: ${token}`);
  }

  if (!source) {
    throw new Error('--source is required.');
  }

  if (!storePassEnvName) {
    throw new Error('--store-pass-env is required.');
  }

  if (!keyPassEnvName) {
    throw new Error('--key-pass-env is required.');
  }

  if (source === 'file' && !filePath) {
    throw new Error('--file is required when --source file is used.');
  }

  if (source === 'env' && !base64EnvName) {
    throw new Error('--base64-env is required when --source env is used.');
  }

  const options: IntegrityOptions = {
    source,
    keyAlias,
    storePassEnvName,
    keyPassEnvName,
    context
  };

  if (filePath !== undefined) {
    options.filePath = filePath;
  }
  if (base64EnvName !== undefined) {
    options.base64EnvName = base64EnvName;
  }
  if (keyAliasEnvName !== undefined) {
    options.keyAliasEnvName = keyAliasEnvName;
  }

  return options;
}

function requireNonEmptyEnv(
  envName: string,
  purpose: string,
  trimWhitespace = false
): string {
  const value = process.env[envName];
  if (typeof value !== 'string') {
    throw new Error(
      `${purpose}: missing required environment variable ${envName}.`
    );
  }

  const inspected = trimWhitespace ? value.trim() : value;
  if (inspected.length === 0) {
    throw new Error(
      `${purpose}: ${envName} is empty. ` +
        'If this is a Dependabot-triggered workflow, configure Dependabot app secrets for Android keystore values.'
    );
  }

  return value;
}

function resolveKeyAlias(options: IntegrityOptions): string {
  if (options.keyAliasEnvName) {
    return requireNonEmptyEnv(
      options.keyAliasEnvName,
      options.context,
      true
    ).trim();
  }

  return options.keyAlias;
}

function runFileValidation(
  options: IntegrityOptions,
  storePassword: string,
  keyPassword: string,
  keyAlias: string
): void {
  const filePath = options.filePath;
  if (!filePath) {
    throw new Error('Internal error: filePath missing for file validation.');
  }

  if (!existsSync(filePath)) {
    throw new Error(
      `${options.context}: keystore file not found at ${filePath}.`
    );
  }

  validateAndroidKeystore(
    filePath,
    {
      keyAlias,
      keyPassword,
      storePassword
    },
    options.context
  );

  // Catch base64 transport issues before the value is sent to remote systems.
  const encoded = readFileSync(filePath).toString('base64');
  validateAndroidKeystoreBase64(
    encoded,
    {
      keyAlias,
      keyPassword,
      storePassword
    },
    `${options.context} (base64 round-trip)`
  );
}

function runEnvValidation(
  options: IntegrityOptions,
  storePassword: string,
  keyPassword: string,
  keyAlias: string
): void {
  const base64EnvName = options.base64EnvName;
  if (!base64EnvName) {
    throw new Error(
      'Internal error: base64EnvName missing for env validation.'
    );
  }

  const base64Payload = requireNonEmptyEnv(
    base64EnvName,
    options.context,
    true
  );
  validateAndroidKeystoreBase64(
    base64Payload,
    {
      keyAlias,
      keyPassword,
      storePassword
    },
    options.context
  );
}

function main(): void {
  const options = parseArgs(process.argv);
  const storePassword = requireNonEmptyEnv(
    options.storePassEnvName,
    options.context
  );
  const keyPassword = requireNonEmptyEnv(
    options.keyPassEnvName,
    options.context
  );
  const keyAlias = resolveKeyAlias(options);

  if (options.source === 'file') {
    runFileValidation(options, storePassword, keyPassword, keyAlias);
  } else {
    runEnvValidation(options, storePassword, keyPassword, keyAlias);
  }

  process.stdout.write(
    `OK: ${options.context} passed for alias '${keyAlias}'.\n`
  );
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`ERROR: ${message}\n`);
  process.exit(1);
}
