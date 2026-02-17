import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ACTION_CONFIG, SKILL_INVOKED_ACTIONS } from './scriptToolConfig.ts';
import type {
  ActionConfig,
  ActionName,
  SafetyClass
} from './scriptToolTypes.ts';

function escapeMarkdownTableCell(value: string): string {
  return value.replaceAll('|', '\\|');
}

function formatTimeout(seconds: number): string {
  if (seconds >= 3600)
    return `${seconds / 3600} hour${seconds > 3600 ? 's' : ''}`;
  if (seconds >= 60) return `${seconds / 60} minutes`;
  return `${seconds} seconds`;
}

export function generateReadme(): string {
  const lines: string[] = [];

  lines.push('# Script Tool Wrappers');
  lines.push('');
  lines.push(
    '> **Auto-generated from `scriptTool.ts`** - Do not edit manually.'
  );
  lines.push(
    '> Run `./scripts/tooling/scriptTool.ts generateDocs` to regenerate.'
  );
  lines.push('');
  lines.push(
    '`scriptTool.ts` is a TypeScript wrapper around utility scripts in `scripts/` for safer tool-calling.'
  );
  lines.push('');

  // Usage section
  lines.push('## Usage');
  lines.push('');
  lines.push('```sh');
  lines.push('./scripts/tooling/scriptTool.ts <action> [options]');
  lines.push('```');
  lines.push('');

  // Group actions by category
  const categories: Record<string, ActionName[]> = {
    analysis: [],
    device: [],
    environment: [],
    operations: [],
    quality: [],
    testing: []
  };

  for (const [name, config] of Object.entries(ACTION_CONFIG) as [
    ActionName,
    ActionConfig
  ][]) {
    const category = config.category as keyof typeof categories;
    const actionBucket = categories[category];
    if (!actionBucket) {
      throw new Error(`Unknown action category: ${String(category)}`);
    }
    actionBucket.push(name);
  }

  // Actions section
  lines.push('## Actions');
  lines.push('');

  const categoryTitles: Record<keyof typeof categories, string> = {
    analysis: 'Analysis',
    device: 'Device',
    environment: 'Environment',
    operations: 'Operations',
    quality: 'Quality',
    testing: 'Testing'
  };

  for (const [category, actions] of Object.entries(categories) as [
    keyof typeof categories,
    ActionName[]
  ][]) {
    if (actions.length === 0) continue;

    lines.push(`### ${categoryTitles[category]}`);
    lines.push('');

    for (const actionName of actions) {
      const config = ACTION_CONFIG[actionName];
      lines.push(`- \`${actionName}\` - ${config.description}`);
    }
    lines.push('');
  }

  // Skill coverage section
  const manualOnlyActions = (Object.keys(ACTION_CONFIG) as ActionName[]).filter(
    (actionName) => !SKILL_INVOKED_ACTIONS.includes(actionName)
  );
  lines.push('## Skill Coverage');
  lines.push('');
  lines.push(
    'Automation skills currently invoke a focused subset of wrappers:'
  );
  lines.push('');
  lines.push(
    `- Skill-invoked: ${SKILL_INVOKED_ACTIONS.map((action) => `\`${action}\``).join(', ')}`
  );
  lines.push(
    `- Manual-only: ${manualOnlyActions.map((action) => `\`${action}\``).join(', ')}`
  );
  lines.push('');

  // Common options section
  lines.push('## Common Options');
  lines.push('');
  lines.push('All actions support these options:');
  lines.push('');
  lines.push('| Option | Description |');
  lines.push('| ------ | ----------- |');
  lines.push('| `--timeout-seconds <n>` | Override default timeout |');
  lines.push('| `--repo-root <path>` | Execute from specific git root |');
  lines.push('| `--dry-run` | Validate without executing |');
  lines.push('| `--json` | Emit structured JSON summary |');
  lines.push('');

  // Action-specific options
  lines.push('## Action-Specific Options');
  lines.push('');

  for (const [actionName, config] of Object.entries(ACTION_CONFIG) as [
    ActionName,
    ActionConfig
  ][]) {
    if (!config.options || config.options.length === 0) continue;

    lines.push(`### ${actionName}`);
    lines.push('');
    lines.push('| Option | Description | Required |');
    lines.push('| ------ | ----------- | -------- |');

    for (const opt of config.options) {
      lines.push(
        `| \`${escapeMarkdownTableCell(opt.name)}\` | ${escapeMarkdownTableCell(opt.description)} | ${opt.required ? 'Yes' : 'No'} |`
      );
    }
    lines.push('');
  }

  // Default timeouts section
  lines.push('## Default Timeouts');
  lines.push('');
  lines.push('| Action | Timeout |');
  lines.push('| ------ | ------- |');

  for (const [actionName, config] of Object.entries(ACTION_CONFIG) as [
    ActionName,
    ActionConfig
  ][]) {
    lines.push(
      `| \`${actionName}\` | ${formatTimeout(config.defaultTimeoutSeconds)} |`
    );
  }
  lines.push('');

  // Safety classes section
  lines.push('## Safety Classes');
  lines.push('');
  lines.push(
    '- `safe_read`: read-only checks and analysis (no local/remote mutations)'
  );
  lines.push('- `safe_write_local`: mutates local workspace/device state only');
  lines.push(
    '- `safe_write_remote`: may mutate remote systems/accounts and requires explicit confirmation'
  );
  lines.push('');
  lines.push('| Class | Actions |');
  lines.push('| ----- | ------- |');

  const safetyGroups: Record<SafetyClass, ActionName[]> = {
    safe_read: [],
    safe_write_local: [],
    safe_write_remote: []
  };

  for (const [name, config] of Object.entries(ACTION_CONFIG) as [
    ActionName,
    ActionConfig
  ][]) {
    safetyGroups[config.safetyClass].push(name);
  }

  for (const [safetyClass, actions] of Object.entries(safetyGroups)) {
    if (actions.length > 0) {
      lines.push(
        `| \`${safetyClass}\` | ${actions.map((a) => `\`${a}\``).join(', ')} |`
      );
    }
  }
  lines.push('');

  // Examples section
  lines.push('## Examples');
  lines.push('');
  lines.push('```sh');
  lines.push('# Analyze CI impact between commits');
  lines.push(
    './scripts/tooling/scriptTool.ts ciImpact --base origin/main --head HEAD --json'
  );
  lines.push('');
  lines.push('# Run impacted quality checks');
  lines.push(
    './scripts/tooling/scriptTool.ts runImpactedQuality --base origin/main --head HEAD'
  );
  lines.push('');
  lines.push('# Run impacted tests only');
  lines.push(
    './scripts/tooling/scriptTool.ts runImpactedTests --base origin/main --head HEAD'
  );
  lines.push('');
  lines.push('# Check for binary files in staged changes');
  lines.push(
    './scripts/tooling/scriptTool.ts checkBinaryFiles --staged --json'
  );
  lines.push('');
  lines.push('# Run Playwright tests with filter');
  lines.push(
    './scripts/tooling/scriptTool.ts runPlaywrightTests --filter "login" --headed'
  );
  lines.push('');
  lines.push('# Run iOS launch wrapper with explicit simulator');
  lines.push(
    './scripts/tooling/scriptTool.ts runIos --device "iPhone 16 Pro" --dry-run --json'
  );
  lines.push('');
  lines.push('# Preview update-everything quick mode');
  lines.push(
    './scripts/tooling/scriptTool.ts updateEverything --mode quick --dry-run --json'
  );
  lines.push('');
  lines.push('# Sync CLI auth (requires explicit confirmation)');
  lines.push(
    './scripts/tooling/scriptTool.ts syncCliAuth --host ubuntu@tuxedo.example.com --confirm'
  );
  lines.push('```');
  lines.push('');

  // JSON output format section
  lines.push('## JSON Output Format');
  lines.push('');
  lines.push('When `--json` is specified, output includes:');
  lines.push('');
  lines.push('```json');
  lines.push('{');
  lines.push('  "status": "success",');
  lines.push('  "exit_code": 0,');
  lines.push('  "duration_ms": 1234,');
  lines.push('  "action": "ciImpact",');
  lines.push('  "repo_root": "/path/to/repo",');
  lines.push('  "safety_class": "safe_read",');
  lines.push('  "retry_safe": true,');
  lines.push('  "dry_run": false,');
  lines.push('  "key_lines": ["last", "few", "lines", "of", "output"]');
  lines.push('}');
  lines.push('```');
  lines.push('');

  return lines.join('\n');
}

export function runGenerateDocs(
  repoRoot: string,
  dryRun: boolean
): { output: string; changed: boolean } {
  const readmePath = path.join(repoRoot, 'scripts', 'tooling', 'README.md');
  const newContent = generateReadme();

  if (dryRun) {
    return { output: newContent, changed: false };
  }

  let existingContent = '';
  if (existsSync(readmePath)) {
    existingContent = readFileSync(readmePath, 'utf8');
  }

  const changed = existingContent !== newContent;

  if (changed) {
    writeFileSync(readmePath, newContent, 'utf8');
  }

  return {
    output: changed
      ? `Updated ${readmePath}`
      : `No changes needed for ${readmePath}`,
    changed
  };
}
