import { readFileSync } from 'node:fs';
import type { GlobalOptions } from '../types.ts';
import type { GitHubClientContext } from './githubClient.ts';

interface DeferredItem {
  body: string;
  path: string;
  line: number | null;
  html_url: string;
}

const AUTO_CLOSE_PATTERN =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/gi;

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

    const body = item['body'];
    const filePath = item['path'];
    const line = item['line'];
    const htmlUrl = item['html_url'];

    if (typeof body !== 'string' || body.trim().length === 0) {
      throw new Error(`Deferred item at index ${index} has invalid "body"`);
    }
    if (typeof filePath !== 'string' || filePath.trim().length === 0) {
      throw new Error(`Deferred item at index ${index} has invalid "path"`);
    }
    if (line !== null && typeof line !== 'number') {
      throw new Error(`Deferred item at index ${index} has invalid "line"`);
    }
    if (typeof htmlUrl !== 'string' || htmlUrl.trim().length === 0) {
      throw new Error(`Deferred item at index ${index} has invalid "html_url"`);
    }

    return {
      body: body.trim(),
      path: filePath.trim(),
      line,
      html_url: htmlUrl.trim()
    };
  });
}

function sanitizeIssueBodyItem(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function collapseBlankLines(text: string): string {
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
}

export async function sanitizePrBodyWithOctokit(
  context: GitHubClientContext,
  prNumber: number
): Promise<string> {
  const pull = await context.octokit.rest.pulls.get({
    owner: context.owner,
    repo: context.repo,
    pull_number: prNumber
  });
  const currentBody = pull.data.body ?? '';

  const issueMatches = [...currentBody.matchAll(AUTO_CLOSE_PATTERN)];
  const issueNumbers = Array.from(
    new Set(issueMatches.map((match) => Number(match[1])))
  );
  const cleanedBody = collapseBlankLines(
    currentBody.replace(AUTO_CLOSE_PATTERN, '')
  );
  const changed = cleanedBody !== currentBody;

  if (changed) {
    await context.octokit.rest.pulls.update({
      owner: context.owner,
      repo: context.repo,
      pull_number: prNumber,
      body: cleanedBody
    });
  }

  return JSON.stringify(
    {
      status: changed ? 'updated' : 'unchanged',
      pr: prNumber,
      changed,
      issue_numbers: issueNumbers,
      body: cleanedBody
    },
    null,
    2
  );
}

export async function createDeferredFixIssueWithOctokit(
  context: GitHubClientContext,
  options: GlobalOptions
): Promise<string> {
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

  const issue = await context.octokit.rest.issues.create({
    owner: context.owner,
    repo: context.repo,
    title: `chore: deferred fixes from PR #${options.number}`,
    labels: ['deferred-fix'],
    body: issueBody
  });

  return JSON.stringify(
    {
      status: 'created',
      source_pr: options.number,
      issue_url: issue.data.html_url,
      deferred_item_count: deferredItems.length
    },
    null,
    2
  );
}

export async function updatePrBodyWithOctokit(
  context: GitHubClientContext,
  options: GlobalOptions
): Promise<string> {
  if (options.number === undefined) {
    throw new Error('updatePrBody requires --number');
  }

  const bodyText =
    options.body ??
    readFileSync(
      (() => {
        if (!options.bodyFile) {
          throw new Error('Missing required option: --body-file');
        }
        return options.bodyFile;
      })(),
      'utf8'
    );

  await context.octokit.rest.pulls.update({
    owner: context.owner,
    repo: context.repo,
    pull_number: options.number,
    body: bodyText
  });

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
