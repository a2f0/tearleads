import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import type { GlobalOptions } from '../types.ts';
import { sleepMs } from './helpers.ts';

type RunGh = (args: string[]) => string;

interface SetupCheck {
  name: string;
  ok: boolean;
  details?: string;
}

export function handleCheckMainVersionBumpSetup(
  options: GlobalOptions,
  repo: string,
  runGh: RunGh
): string {
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

  const secretNames = new Set<string>();
  const secretListOutput = runGh(['secret', 'list', '-R', repo]);
  for (const line of secretListOutput.split('\n')) {
    const [name] = line.split('\t');
    if (name) {
      secretNames.add(name.trim());
    }
  }

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
      repo,
      key_file: keyFilePath,
      checks,
      missing: failures.map((failure) => failure.details ?? failure.name)
    },
    null,
    2
  );
}

export function handleGetReviewThreads(
  options: GlobalOptions,
  repo: string,
  runGh: RunGh
): string {
  if (options.number === undefined) {
    throw new Error('getReviewThreads requires --number');
  }

  const filter = options.unresolvedOnly
    ? 'map(select(.isResolved == false))'
    : '.';
  const query = `
    query($owner: String!, $repo: String!, $pr: Int!, $after: String) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $pr) {
          reviewThreads(first: 100, after: $after) {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              id
              isResolved
              path
              line
              comments(first: 100) {
                pageInfo {
                  hasNextPage
                }
                nodes {
                  id
                  databaseId
                  author { login }
                  body
                }
              }
            }
          }
        }
      }
    }
  `;
  const threadJsonChunks: string[] = [];
  let afterCursor: string | undefined;

  while (true) {
    const queryArgs = [
      'api',
      'graphql',
      '-f',
      `query=${query}`,
      '-f',
      `owner=${repo.split('/')[0]}`,
      '-f',
      `repo=${repo.split('/')[1]}`,
      '-F',
      `pr=${options.number}`
    ];
    if (afterCursor) {
      queryArgs.push('-F', `after=${afterCursor}`);
    }

    const pageHasNext = runGh([
      ...queryArgs,
      '--jq',
      '.data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage'
    ]).trim();
    const pageEndCursor = runGh([
      ...queryArgs,
      '--jq',
      '.data.repository.pullRequest.reviewThreads.pageInfo.endCursor // ""'
    ]).trim();

    const threadIdsWithExtraComments = runGh([
      ...queryArgs,
      '--jq',
      '.data.repository.pullRequest.reviewThreads.nodes[] | select(.comments.pageInfo.hasNextPage == true) | .id'
    ]).trim();
    if (threadIdsWithExtraComments) {
      throw new Error(
        `getReviewThreads found threads with >100 comments; unsupported pagination for thread IDs: ${threadIdsWithExtraComments}`
      );
    }

    const pageThreads = runGh([
      ...queryArgs,
      '--jq',
      `.data.repository.pullRequest.reviewThreads.nodes | ${filter}`
    ]).trim();
    if (pageThreads.startsWith('[') && pageThreads.endsWith(']')) {
      const innerJson = pageThreads.slice(1, -1).trim();
      if (innerJson.length > 0) {
        threadJsonChunks.push(innerJson);
      }
    } else {
      throw new Error('Unexpected getReviewThreads response shape');
    }

    if (pageHasNext !== 'true') {
      break;
    }
    if (!pageEndCursor) {
      throw new Error(
        'getReviewThreads pagination indicated next page but missing endCursor'
      );
    }
    afterCursor = pageEndCursor;
  }

  return `[${threadJsonChunks.join(',')}]`;
}

export function handleTriggerGeminiReview(
  options: GlobalOptions,
  repo: string,
  runGh: RunGh
): string {
  const pollTimeoutSeconds = options.pollTimeout ?? 300;
  const pollIntervalMilliseconds = 15_000;
  const prNumber = String(options.number);
  const latestGeminiReviewQuery = [
    'pr',
    'view',
    prNumber,
    '--json',
    'reviews',
    '-R',
    repo,
    '--jq',
    '[.reviews[] | select(.author.login == "gemini-code-assist") | .submittedAt] | max // ""'
  ];

  const latestReviewBeforeRequest = runGh(latestGeminiReviewQuery).trim();

  runGh(['pr', 'comment', prNumber, '-R', repo, '--body', '/gemini review']);

  const deadline = Date.now() + pollTimeoutSeconds * 1000;
  while (Date.now() < deadline) {
    const latestReviewAfterRequest = runGh(latestGeminiReviewQuery).trim();
    if (
      latestReviewAfterRequest &&
      (!latestReviewBeforeRequest ||
        latestReviewAfterRequest > latestReviewBeforeRequest)
    ) {
      return JSON.stringify({
        status: 'review_received',
        pr: options.number,
        submitted_at: latestReviewAfterRequest
      });
    }
    sleepMs(pollIntervalMilliseconds);
  }

  return JSON.stringify({
    status: 'review_requested',
    pr: options.number,
    timed_out: true,
    poll_timeout_seconds: pollTimeoutSeconds
  });
}

const DEFAULT_GEMINI_QUOTA_MESSAGE =
  'You have reached your daily quota limit. Please wait up to 24 hours and I will start processing your requests again!';

export function handleCheckGeminiQuota(
  options: GlobalOptions,
  repo: string,
  runGh: RunGh
): string {
  if (options.number === undefined) {
    throw new Error('checkGeminiQuota requires --number');
  }

  const quotaMessage = options.quotaMessage ?? DEFAULT_GEMINI_QUOTA_MESSAGE;
  const prNumber = String(options.number);

  const responseBodies = [
    runGh([
      'pr',
      'view',
      prNumber,
      '--json',
      'reviews',
      '-R',
      repo,
      '--jq',
      '.reviews[].body // ""'
    ]),
    runGh([
      'api',
      `repos/${repo}/pulls/${prNumber}/comments`,
      '--jq',
      '.[].body // ""'
    ]),
    runGh([
      'api',
      `repos/${repo}/issues/${prNumber}/comments`,
      '--jq',
      '.[].body // ""'
    ])
  ];

  const messages = responseBodies
    .flatMap((surface) => surface.split('\n'))
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const matches = messages.filter((line) => line.includes(quotaMessage));

  return JSON.stringify(
    {
      status: 'success',
      pr: options.number,
      quota_exhausted: matches.length > 0,
      match_count: matches.length
    },
    null,
    2
  );
}

export function handleGeneratePrSummary(
  options: GlobalOptions,
  repo: string,
  runGh: RunGh
): string {
  const resolveBranch = (): string =>
    execSync('git branch --show-current', { encoding: 'utf8' }).trim();

  const branchName = options.branch ?? resolveBranch();
  let prNumber = options.number;

  if (prNumber === undefined) {
    const prNumberOutput = runGh([
      'pr',
      'list',
      '--head',
      branchName,
      '--state',
      'all',
      '--json',
      'number',
      '-R',
      repo,
      '--jq',
      '.[0].number // ""'
    ]).trim();

    if (!prNumberOutput) {
      throw new Error(
        `generatePrSummary could not find a PR for branch ${branchName}`
      );
    }

    prNumber = Number(prNumberOutput);
    if (Number.isNaN(prNumber)) {
      throw new Error(
        `generatePrSummary received invalid PR number: ${prNumberOutput}`
      );
    }
  }

  const prText = runGh([
    'pr',
    'view',
    String(prNumber),
    '--json',
    'number,title,body,state,mergeStateStatus,headRefName,baseRefName,url,author,files',
    '-R',
    repo
  ]);

  const prData = JSON.parse(prText) as {
    number: number;
    title?: string;
    body?: string;
    state?: string;
    mergeStateStatus?: string;
    headRefName?: string;
    baseRefName?: string;
    url?: string;
    author?: { login?: string };
    files?: Array<{ path: string }>;
  };

  const summaryLines: string[] = [
    `PR #${prData.number}: ${prData.title ?? '<no title>'}`,
    `State: ${prData.state ?? 'unknown'} (${prData.mergeStateStatus ?? 'unknown'})`,
    `Base: ${prData.baseRefName ?? 'unknown'} ← Head: ${prData.headRefName ?? 'unknown'}`,
    `Author: ${prData.author?.login ?? 'unknown'}`,
    `URL: ${prData.url ?? 'unknown'}`,
    ''
  ];

  const trimmedBody = prData.body?.trim();
  if (trimmedBody) {
    summaryLines.push('Description:');
    summaryLines.push(...trimmedBody.split('\n').slice(0, 3));
  } else {
    summaryLines.push('Description: (none)');
  }

  const fileList = Array.isArray(prData.files) ? prData.files : [];
  summaryLines.push('', `Files changed (${fileList.length}):`);
  if (fileList.length === 0) {
    summaryLines.push('- (none)');
  } else {
    fileList.slice(0, 5).forEach((file) => {
      summaryLines.push(`- ${file.path}`);
    });
    if (fileList.length > 5) {
      summaryLines.push(`- ...and ${fileList.length - 5} more files`);
    }
  }

  return summaryLines.join('\n');
}
