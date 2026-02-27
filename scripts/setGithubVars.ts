#!/usr/bin/env -S pnpm exec tsx
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
process.chdir(path.resolve(scriptDir, '..'));

const requiredEnvVars = [
  'APPLE_ID',
  'TEAM_ID',
  'ITC_TEAM_ID',
  'GITHUB_REPO',
  'APP_STORE_CONNECT_ISSUER_ID',
  'APP_STORE_CONNECT_KEY_ID',
  'MATCH_GIT_URL',
  'MATCH_PASSWORD',
  'MATCH_GIT_BASIC_AUTHORIZATION',
  'ANDROID_KEYSTORE_STORE_PASS',
  'ANDROID_KEYSTORE_KEY_PASS',
  'ANTHROPIC_API_KEY',
  'TF_VAR_server_username',
  'TAILSCALE_GITHUB_OAUTH_CLIENT_ID',
  'TAILSCALE_GITHUB_OAUTH_CLIENT_SECRET'
] as const;

const managedSecretNames = [
  'APPLE_ID',
  'TEAM_ID',
  'ITC_TEAM_ID',
  'APP_STORE_CONNECT_KEY_ID',
  'APP_STORE_CONNECT_ISSUER_ID',
  'APP_STORE_CONNECT_API_KEY',
  'MATCH_GIT_URL',
  'MATCH_PASSWORD',
  'MATCH_GIT_BASIC_AUTHORIZATION',
  'ANDROID_KEYSTORE_BASE64',
  'ANDROID_KEYSTORE_STORE_PASS',
  'ANDROID_KEYSTORE_KEY_PASS',
  'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON',
  'ANTHROPIC_API_KEY',
  'OPENROUTER_API_KEY',
  'DEPLOY_SSH_KEY',
  'DEPLOY_DOMAIN_PROD',
  'DEPLOY_DOMAIN_STAGING',
  'DEPLOY_USER',
  'TAILSCALE_GITHUB_OAUTH_CLIENT_ID',
  'TAILSCALE_GITHUB_OAUTH_CLIENT_SECRET'
] as const;

const optionalGithubVars = [
  'AWS_STAGING_ECR_ROLE_ARN',
  'AWS_PROD_ECR_ROLE_ARN'
] as const;

const secretsEnvFile = '.secrets/root.env';

interface SecretListItem {
  name?: string;
}

function loadSecretsEnv(): void {
  if (!existsSync(secretsEnvFile)) {
    process.stderr.write(
      `WARNING: ${secretsEnvFile} not found. Environment variables must be set manually.\n`
    );
    return;
  }

  const content = readFileSync(secretsEnvFile, 'utf8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const withoutExport = line.startsWith('export ')
      ? line.slice('export '.length)
      : line;

    const eqIndex = withoutExport.indexOf('=');
    if (eqIndex === -1) {
      continue;
    }

    const key = withoutExport.slice(0, eqIndex).trim();
    if (!key) {
      continue;
    }
    let value = withoutExport.slice(eqIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function readEnvValue(filePath: string, key: string): string {
  if (!existsSync(filePath)) {
    throw new Error(`${filePath} not found`);
  }
  const content = readFileSync(filePath, 'utf8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const withoutExport = line.startsWith('export ')
      ? line.slice('export '.length)
      : line;
    const eqIndex = withoutExport.indexOf('=');
    if (eqIndex === -1) {
      continue;
    }
    const k = withoutExport.slice(0, eqIndex).trim();
    if (k !== key) {
      continue;
    }
    let value = withoutExport.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value;
  }
  throw new Error(`${key} not found in ${filePath}`);
}

function getRequiredEnv(name: (typeof requiredEnvVars)[number]): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Error: ${name} is not set.`);
  }
  return value;
}

function requireFile(filePath: string, errorMessage: string): void {
  if (!existsSync(filePath)) {
    throw new Error(errorMessage);
  }
}

function runGh(args: string[]): string {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function setGithubValue(
  type: 'secret' | 'variable',
  repo: string,
  name: string,
  value: string
): void {
  execFileSync('gh', [type, 'set', name, '-R', repo, '--body', value], {
    stdio: ['ignore', 'inherit', 'inherit']
  });
}

function listCurrentSecretNames(repo: string): string[] {
  const raw = runGh(['secret', 'list', '-R', repo, '--json', 'name']);
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    return [];
  }

  const secretNames: string[] = [];
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }

    const entry = item as SecretListItem;
    if (typeof entry.name === 'string') {
      secretNames.push(entry.name);
    }
  }

  return secretNames;
}

function parseArgs(argv: string[]): { deleteExtra: boolean } {
  let deleteExtra = false;

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--delete') {
      deleteExtra = true;
      continue;
    }

    throw new Error(`Unknown option: ${token}`);
  }

  return { deleteExtra };
}

function main(): void {
  const { deleteExtra } = parseArgs(process.argv);

  loadSecretsEnv();

  const env = Object.fromEntries(
    requiredEnvVars.map((name) => [name, getRequiredEnv(name)])
  ) as Record<(typeof requiredEnvVars)[number], string>;

  const prodDomain = readEnvValue('.secrets/prod.env', 'TF_VAR_domain');
  const stagingDomain = readEnvValue('.secrets/staging.env', 'TF_VAR_domain');
  const openrouterApiKey = readEnvValue(
    '.secrets/prod.env',
    'OPENROUTER_API_KEY'
  );

  const p8File = `.secrets/AuthKey_${env.APP_STORE_CONNECT_KEY_ID}.p8`;
  const keystoreFile = '.secrets/tearleads-release.keystore';
  const googlePlayJsonFile = '.secrets/google-play-service-account.json';
  const deployKeyFile = '.secrets/deploy.key';

  requireFile(p8File, `Error: .p8 file not found at ${p8File}`);
  requireFile(
    keystoreFile,
    `Error: Android keystore not found at ${keystoreFile}`
  );
  requireFile(
    googlePlayJsonFile,
    `Error: Google Play service account JSON not found at ${googlePlayJsonFile}`
  );
  requireFile(
    deployKeyFile,
    `Error: Deploy SSH key not found at ${deployKeyFile}`
  );

  const appStoreConnectApiKey = readFileSync(p8File).toString('base64');
  const deploySshKey = readFileSync(deployKeyFile, 'utf8');
  const androidKeystoreBase64 = readFileSync(keystoreFile).toString('base64');
  const googlePlayServiceAccountJsonBase64 =
    readFileSync(googlePlayJsonFile).toString('base64');

  const secrets: Array<{ name: string; value: string }> = [
    { name: 'APPLE_ID', value: env.APPLE_ID },
    { name: 'TEAM_ID', value: env.TEAM_ID },
    { name: 'ITC_TEAM_ID', value: env.ITC_TEAM_ID },
    { name: 'APP_STORE_CONNECT_KEY_ID', value: env.APP_STORE_CONNECT_KEY_ID },
    {
      name: 'APP_STORE_CONNECT_ISSUER_ID',
      value: env.APP_STORE_CONNECT_ISSUER_ID
    },
    { name: 'APP_STORE_CONNECT_API_KEY', value: appStoreConnectApiKey },
    { name: 'MATCH_GIT_URL', value: env.MATCH_GIT_URL },
    { name: 'MATCH_PASSWORD', value: env.MATCH_PASSWORD },
    {
      name: 'MATCH_GIT_BASIC_AUTHORIZATION',
      value: env.MATCH_GIT_BASIC_AUTHORIZATION
    },
    { name: 'ANDROID_KEYSTORE_BASE64', value: androidKeystoreBase64 },
    {
      name: 'ANDROID_KEYSTORE_STORE_PASS',
      value: env.ANDROID_KEYSTORE_STORE_PASS
    },
    { name: 'ANDROID_KEYSTORE_KEY_PASS', value: env.ANDROID_KEYSTORE_KEY_PASS },
    {
      name: 'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON',
      value: googlePlayServiceAccountJsonBase64
    },
    { name: 'ANTHROPIC_API_KEY', value: env.ANTHROPIC_API_KEY },
    { name: 'OPENROUTER_API_KEY', value: openrouterApiKey },
    { name: 'DEPLOY_SSH_KEY', value: deploySshKey },
    { name: 'DEPLOY_DOMAIN_PROD', value: prodDomain },
    { name: 'DEPLOY_DOMAIN_STAGING', value: stagingDomain },
    { name: 'DEPLOY_USER', value: env.TF_VAR_server_username },
    {
      name: 'TAILSCALE_GITHUB_OAUTH_CLIENT_ID',
      value: env.TAILSCALE_GITHUB_OAUTH_CLIENT_ID
    },
    {
      name: 'TAILSCALE_GITHUB_OAUTH_CLIENT_SECRET',
      value: env.TAILSCALE_GITHUB_OAUTH_CLIENT_SECRET
    }
  ];

  for (const secret of secrets) {
    setGithubValue('secret', env.GITHUB_REPO, secret.name, secret.value);
  }

  for (const variableName of optionalGithubVars) {
    const value = process.env[variableName];
    if (!value) {
      continue;
    }
    setGithubValue('variable', env.GITHUB_REPO, variableName, value);
  }

  process.stdout.write(
    '\nAll managed secrets and optional variables have been set successfully!\n'
  );

  if (!deleteExtra) {
    return;
  }

  process.stdout.write('\nChecking for extra secrets to delete...\n');
  const currentSecretNames = listCurrentSecretNames(env.GITHUB_REPO);
  const managedSet = new Set<string>(managedSecretNames);

  for (const name of currentSecretNames) {
    if (managedSet.has(name)) {
      continue;
    }
    process.stdout.write(`Deleting extra secret: ${name}\n`);
    execFileSync('gh', ['secret', 'delete', name, '-R', env.GITHUB_REPO], {
      stdio: ['ignore', 'inherit', 'inherit']
    });
  }

  process.stdout.write('Extra secrets cleanup complete.\n');
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
}
