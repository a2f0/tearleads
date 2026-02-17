import { execFileSync, execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import type { GlobalOptions } from '../types.ts';

type RunGh = (args: string[]) => string;

interface DeferredItem {
  body: string;
  path: string;
  line: number | null;
  html_url: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseDeferredItems(rawItems: string): DeferredItem[] {
  const parsed: unknown = JSON.parse(rawItems);
  if (!Array.isArray(parsed)) {
    throw new Error('--deferred-items-json must be a JSON array');
  }

  return parsed.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`Deferred item at index ${index} must be an object`);
    }

    const {
      body: itemBody,
      path: itemPath,
      line: itemLine,
      html_url: itemHtmlUrl
    } = item;

    if (typeof itemBody !== 'string' || itemBody.trim().length === 0) {
      throw new Error(`Deferred item at index ${index} has invalid "body"`);
    }
    if (typeof itemPath !== 'string' || itemPath.trim().length === 0) {
      throw new Error(`Deferred item at index ${index} has invalid "path"`);
    }
    if (itemLine !== null && typeof itemLine !== 'number') {
      throw new Error(`Deferred item at index ${index} has invalid "line"`);
    }
    if (typeof itemHtmlUrl !== 'string' || itemHtmlUrl.trim().length === 0) {
      throw new Error(`Deferred item at index ${index} has invalid "html_url"`);
    }

    return {
      body: itemBody.trim(),
      path: itemPath.trim(),
      line: itemLine,
      html_url: itemHtmlUrl.trim()
    };
  });
}

function sanitizeIssueBodyItem(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function handleCreateDeferredFixIssue(
  options: GlobalOptions,
  repo: string,
  runGh: RunGh
): string {
  if (options.number === undefined) {
    throw new Error('createDeferredFixIssue requires --number');
  }
  if (!options.prUrl) {
    throw new Error('createDeferredFixIssue requires --pr-url');
  }
  if (!options.deferredItemsJson) {
    throw new Error('createDeferredFixIssue requires --deferred-items-json');
  }

  const deferredItems = parseDeferredItems(options.deferredItemsJson);
  if (deferredItems.length === 0) {
    throw new Error(
      'createDeferredFixIssue requires at least one deferred item'
    );
  }

  const checklist = deferredItems
    .map((item) => {
      const linePart =
        typeof item.line === 'number' ? `${item.path}:${item.line}` : item.path;
      const itemBody = sanitizeIssueBodyItem(item.body);
      return `- [ ] ${itemBody} - \`${linePart}\` ([thread](${item.html_url}))`;
    })
    .join('\n');

  const issueBody = `## Summary
Review feedback deferred from PR #${options.number} to a follow-up PR.

## Source
- PR: #${options.number}
- URL: ${options.prUrl}

## Deferred Items
${checklist}

## Notes
These items were explicitly marked for deferral during review. Address each item and check it off, then close this issue.`;

  const issueUrl = runGh([
    'issue',
    'create',
    '--title',
    `chore: deferred fixes from PR #${options.number}`,
    '--label',
    'deferred-fix',
    '--body',
    issueBody,
    '-R',
    repo
  ]).trim();

  return JSON.stringify(
    {
      status: 'created',
      source_pr: options.number,
      issue_url: issueUrl,
      deferred_item_count: deferredItems.length
    },
    null,
    2
  );
}

const AUTO_CLOSE_PATTERN =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/gi;

function collapseBlankLines(text: string): string {
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
}

export function handleSanitizePrBody(
  options: GlobalOptions,
  repo: string,
  runGh: RunGh
): string {
  if (options.number === undefined) {
    throw new Error('sanitizePrBody requires --number');
  }

  const currentBody = runGh([
    'pr',
    'view',
    String(options.number),
    '--json',
    'body',
    '-R',
    repo,
    '--jq',
    '.body // ""'
  ]);

  const issueMatches = [...currentBody.matchAll(AUTO_CLOSE_PATTERN)];
  const issueNumbers = Array.from(
    new Set(issueMatches.map((match) => Number(match[1])))
  );
  const cleanedBody = collapseBlankLines(
    currentBody.replace(AUTO_CLOSE_PATTERN, '')
  );
  const changed = cleanedBody !== currentBody;

  if (changed) {
    runGh([
      'pr',
      'edit',
      String(options.number),
      '--body',
      cleanedBody,
      '-R',
      repo
    ]);
  }

  return JSON.stringify(
    {
      status: changed ? 'updated' : 'unchanged',
      pr: options.number,
      changed,
      issue_numbers: issueNumbers,
      body: cleanedBody
    },
    null,
    2
  );
}

export function handleUpdatePrBody(
  options: GlobalOptions,
  repo: string,
  runGh: RunGh
): string {
  if (options.number === undefined) {
    throw new Error('updatePrBody requires --number');
  }

  const bodyText =
    typeof options.body === 'string'
      ? options.body
      : readFileSync(options.bodyFile ?? '', 'utf8');

  runGh(['pr', 'edit', String(options.number), '--body', bodyText, '-R', repo]);

  return JSON.stringify(
    {
      status: 'updated',
      pr: options.number,
      body_length: bodyText.length
    },
    null,
    2
  );
}

function resolveBranchName(branch: string | undefined): string {
  if (branch) return branch;
  return execSync('git branch --show-current', { encoding: 'utf8' }).trim();
}

function validateBranchName(branch: string): void {
  if (!/^[0-9A-Za-z._/-]+$/.test(branch)) {
    throw new Error(`Invalid branch name: ${branch}`);
  }
}

export function handleVerifyBranchPush(options: GlobalOptions): string {
  const branch = resolveBranchName(options.branch);
  validateBranchName(branch);

  execFileSync('git', ['fetch', 'origin', branch], {
    encoding: 'utf8',
    stdio: ['ignore', 'ignore', 'pipe']
  });

  const localHead = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  const remoteHead = execFileSync('git', ['rev-parse', `origin/${branch}`], {
    encoding: 'utf8'
  }).trim();
  const synced = localHead === remoteHead;

  return JSON.stringify(
    {
      status: synced ? 'synced' : 'not_synced',
      branch,
      synced,
      local_head: localHead,
      remote_head: remoteHead
    },
    null,
    2
  );
}
