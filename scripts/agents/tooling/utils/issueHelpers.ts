import type { GlobalOptions } from '../types.ts';

export interface ExistingIssueCandidate {
  number: number;
  title: string;
  url: string;
}

export function buildIssueTemplate(
  templateType: 'user-requested' | 'deferred-fix',
  options: GlobalOptions
): string {
  if (templateType === 'user-requested') {
    return `## Summary
<one paragraph describing the user goal and outcome in your own words>

## Context
<why this matters, impacted area, or constraints mentioned by the user>

## Requirements
- [ ] <clear, testable requirement 1>
- [ ] <clear, testable requirement 2>

## Implementation Notes
<initial approach, dependencies, or questions to resolve>`;
  }

  const sourcePr = options.sourcePr ? `#${options.sourcePr}` : '#<pr-number>';
  const reviewThread = options.reviewThreadUrl ?? '<url to thread>';
  return `## Summary
<brief description of what was deferred>

## Source
- PR: ${sourcePr}
- Review thread: ${reviewThread}

## Deferred Items
- [ ] <item 1 from review feedback>
- [ ] <item 2 from review feedback>`;
}

export function parseFirstJsonObject(rawOutput: string): unknown {
  const trimmed = rawOutput.trim();
  if (!trimmed || trimmed === 'null') return null;
  return JSON.parse(trimmed);
}

export function parseExistingIssueCandidate(
  value: unknown
): ExistingIssueCandidate | null {
  if (typeof value !== 'object' || value === null) return null;
  const number = Reflect.get(value, 'number');
  const title = Reflect.get(value, 'title');
  const url = Reflect.get(value, 'url');
  if (typeof number !== 'number') return null;
  if (typeof title !== 'string') return null;
  if (typeof url !== 'string') return null;
  return { number, title, url };
}
