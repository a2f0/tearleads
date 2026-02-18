import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { GlobalOptions } from '../types.ts';
import type { GitHubClientContext } from './githubClient.ts';

interface SetupCheck {
  name: string;
  ok: boolean;
  details?: string;
}

async function listSecretNames(
  context: GitHubClientContext
): Promise<Set<string>> {
  const secretNames = new Set<string>();
  let page = 1;
  while (true) {
    const response = await context.octokit.rest.actions.listRepoSecrets({
      owner: context.owner,
      repo: context.repo,
      per_page: 100,
      page
    });
    for (const secret of response.data.secrets) {
      secretNames.add(secret.name.trim());
    }
    if (response.data.secrets.length < 100) {
      break;
    }
    page += 1;
  }
  return secretNames;
}

export async function checkMainVersionBumpSetupWithOctokit(
  context: GitHubClientContext,
  options: GlobalOptions
): Promise<string> {
  const repoRoot = execSync('git rev-parse --show-toplevel', {
    encoding: 'utf8'
  }).trim();

  const requiredEnvNames = [
    'TF_VAR_merge_signing_app_id',
    'TF_VAR_merge_signing_app_installation_id'
  ] as const;

  const envChecks: SetupCheck[] = requiredEnvNames.map((envName) => {
    const value = process.env[envName]?.trim();
    const check: SetupCheck = {
      name: `env:${envName}`,
      ok: Boolean(value)
    };
    if (!value) {
      check.details = `${envName} is not set`;
    }
    return check;
  });

  const requestedKeyFile = options.keyFile?.trim();
  const keyFile =
    requestedKeyFile && requestedKeyFile.length > 0
      ? requestedKeyFile
      : '.secrets/tearleads-version-bumper.private-key.pem';
  const keyFilePath = path.isAbsolute(keyFile)
    ? keyFile
    : path.join(repoRoot, keyFile);
  const keyFileExists = fs.existsSync(keyFilePath);
  const keyFileCheck: SetupCheck = {
    name: 'file:merge-signing-private-key',
    ok: keyFileExists
  };
  if (!keyFileExists) {
    keyFileCheck.details = `Missing file at ${keyFilePath}`;
  }

  const secretNames = await listSecretNames(context);
  const secretChecks: SetupCheck[] = [
    'MERGE_SIGNING_APP_ID',
    'MERGE_SIGNING_APP_PRIVATE_KEY'
  ].map((secretName) => {
    const hasSecret = secretNames.has(secretName);
    const check: SetupCheck = {
      name: `secret:${secretName}`,
      ok: hasSecret
    };
    if (!hasSecret) {
      check.details = `${secretName} not found in repo secrets`;
    }
    return check;
  });

  const checks = [...envChecks, keyFileCheck, ...secretChecks];
  const failures = checks.filter((check) => !check.ok);

  return JSON.stringify(
    {
      status: failures.length === 0 ? 'ready' : 'missing_requirements',
      repo: `${context.owner}/${context.repo}`,
      key_file: keyFilePath,
      checks,
      missing: failures.map((failure) => failure.details ?? failure.name)
    },
    null,
    2
  );
}

export async function getDefaultBranchWithOctokit(
  context: GitHubClientContext
): Promise<string> {
  const response = await context.octokit.rest.repos.get({
    owner: context.owner,
    repo: context.repo
  });

  return JSON.stringify(
    {
      default_branch: response.data.default_branch
    },
    null,
    2
  );
}
