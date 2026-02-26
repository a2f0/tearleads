#!/usr/bin/env -S pnpm exec tsx

import { accessSync, constants, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

type Mode = 'strict' | 'summary' | 'count';

const usage = (): never => {
  console.error('Usage: ./scripts/checks/preen/checkPreenEcosystem.ts [--strict|--summary|--count-issues]');
  console.error('');
  console.error('Modes:');
  console.error('  --strict       Print findings and exit non-zero on issues (default)');
  console.error('  --summary      Print findings but always exit zero');
  console.error('  --count-issues Print issue count only and exit zero');
  process.exit(2);
};

const parseMode = (args: string[]): Mode => {
  if (args.length > 1) {
    usage();
  }
  if (args.length === 0) {
    return 'strict';
  }

  switch (args[0]) {
    case '--strict':
      return 'strict';
    case '--summary':
      return 'summary';
    case '--count-issues':
      return 'count';
    default:
      usage();
  }
};

const mode = parseMode(process.argv.slice(2));

const commandNames = readdirSync('.claude/skills', { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

if (commandNames.length === 0) {
  console.error('Error: no command names found under .claude/skills');
  process.exit(1);
}

const escapedCommandNames = commandNames.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const commandAlt = escapedCommandNames.join('|');

const slashPattern = new RegExp(`(^|[^\\w.-])/(${commandAlt})([^\\w-]|$)`);
const dollarPattern = new RegExp(`(^|[^\\w.-])\\$(${commandAlt})([^\\w-]|$)`);

let issues = 0;

const reportIssue = (message: string): void => {
  issues += 1;
  if (mode !== 'count') {
    console.error(`[preen-check] ${message}`);
  }
};

const readText = (filePath: string): string => readFileSync(filePath, 'utf8');

const listSkillFiles = (rootDir: string): string[] => {
  const output: string[] = [];

  const walk = (dirPath: string): void => {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name === 'SKILL.md') {
        output.push(fullPath);
      }
    }
  };

  if (existsSync(rootDir)) {
    walk(rootDir);
  }

  output.sort();
  return output;
};

const collectLineMatches = (filePath: string, pattern: RegExp): string[] => {
  const lines = readText(filePath).split('\n');
  const matches: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (pattern.test(lines[index])) {
      matches.push(`${index + 1}:${lines[index]}`);
    }
  }
  return matches;
};

const checkPrefixUsage = (filePath: string, expectedStyle: 'codex' | 'gemini' | 'claude'): void => {
  if (!existsSync(filePath)) {
    return;
  }

  const pattern = expectedStyle === 'codex' ? slashPattern : dollarPattern;
  const matches = collectLineMatches(filePath, pattern);

  if (matches.length === 0) {
    return;
  }

  if (expectedStyle === 'codex') {
    reportIssue(`Codex skill uses slash command '/<cmd>' in ${filePath}`);
  } else if (expectedStyle === 'gemini') {
    reportIssue(`Gemini skill uses dollar command '$<cmd>' in ${filePath}`);
  } else {
    reportIssue(`Claude skill uses dollar command '$<cmd>' in ${filePath}`);
  }

  if (mode !== 'count') {
    for (const match of matches) {
      console.error(`  ${match}`);
    }
  }
};

const stripFrontmatter = (text: string): string => {
  const lines = text.split('\n');
  if (lines[0] !== '---') {
    return text;
  }

  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index] === '---') {
      return lines.slice(index + 1).join('\n');
    }
  }

  return text;
};

const normalizeText = (text: string): string => {
  let normalized = stripFrontmatter(text);

  normalized = normalized.replace(
    new RegExp(`(^|[^\\w.-])/(${commandAlt})([^\\w-]|$)`, 'gm'),
    '$1<cmd:$2>$3',
  );

  normalized = normalized.replace(
    new RegExp(`(^|[^\\w.-])\\$(${commandAlt})([^\\w-]|$)`, 'gm'),
    '$1<cmd:$2>$3',
  );

  normalized = normalized
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n');

  normalized = normalized.replace(/^(?:\s*\n)+/, '');

  return normalized;
};

const normalizedCache = new Map<string, string>();

const getNormalizedText = (filePath: string): string => {
  const cached = normalizedCache.get(filePath);
  if (cached !== undefined) {
    return cached;
  }

  const normalized = normalizeText(readText(filePath));
  normalizedCache.set(filePath, normalized);

  return normalized;
};

const renderDiffSnippet = (leftText: string, rightText: string): string[] => {
  const leftLines = leftText.split('\n');
  const rightLines = rightText.split('\n');
  const maxLen = Math.max(leftLines.length, rightLines.length);

  for (let index = 0; index < maxLen; index += 1) {
    const leftLine = leftLines[index] ?? '';
    const rightLine = rightLines[index] ?? '';
    if (leftLine !== rightLine) {
      return [
        `  @@ first diff at line ${index + 1} @@`,
        `  - ${leftLine}`,
        `  + ${rightLine}`,
      ];
    }
  }

  return ['  @@ contents differ but no line-level diff was detected @@'];
};

const compareNormalizedPair = (label: string, leftFile: string, rightFile: string): void => {
  const leftNormalized = getNormalizedText(leftFile);
  const rightNormalized = getNormalizedText(rightFile);

  if (leftNormalized === rightNormalized) {
    return;
  }

  reportIssue(`Semantic drift detected for ${label}`);
  if (mode !== 'count') {
    for (const line of renderDiffSnippet(leftNormalized, rightNormalized)) {
      console.error(line);
    }
  }
};

const collectTopLevelPreenIds = (rootDir: string): string[] => {
  if (!existsSync(rootDir)) {
    return [];
  }

  return readdirSync(rootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^preen-/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
};

const reportMissing = (label: string, source: string[], target: Set<string>): void => {
  for (const value of source) {
    if (!target.has(value)) {
      reportIssue(`Missing ${label} preen skill for ${value}`);
    }
  }
};

const checkRegistryGeneration = (): void => {
  if (!existsSync('.claude/skills')) {
    return;
  }

  const generatorPath = 'scripts/preen/generatePreenDocs.sh';
  if (!existsSync(generatorPath)) {
    reportIssue('Missing executable generator: scripts/preen/generatePreenDocs.sh');
    return;
  }

  const generatorContent = readText(generatorPath);

  if (!generatorContent.includes('.claude/skills/preen/SKILL.md')) {
    return;
  }

  try {
    accessSync(generatorPath, constants.X_OK);
  } catch {
    reportIssue('Missing executable generator: scripts/preen/generatePreenDocs.sh');
    return;
  }

  const result = spawnSync(`./${generatorPath}`, ['--check'], { encoding: 'utf8' });
  if (result.status === 0) {
    return;
  }

  reportIssue('Top-level preen docs are not generated from scripts/preen/registry.json');
  if (mode !== 'count') {
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    const lines = output.split('\n').slice(0, 120);
    for (const line of lines) {
      if (line.length > 0) {
        console.error(line);
      }
    }
  }
};

const codexSkillFiles = listSkillFiles('.codex/skills').filter(
  (filePath) => /\/preen[^/]*\/SKILL\.md$/.test(filePath) || /\/misc\/preen-enhancements\/SKILL\.md$/.test(filePath),
);
for (const filePath of codexSkillFiles) {
  checkPrefixUsage(filePath, 'codex');
}

const geminiSkillFiles = listSkillFiles('.gemini/skills').filter(
  (filePath) => /\/preen[^/]*\/SKILL\.md$/.test(filePath) || /\/preen-enhancements\/SKILL\.md$/.test(filePath),
);
for (const filePath of geminiSkillFiles) {
  checkPrefixUsage(filePath, 'gemini');
}

const claudePreenDirs = readdirSync('.claude/skills', { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^preen/.test(entry.name))
  .map((entry) => join('.claude/skills', entry.name, 'SKILL.md'))
  .sort();
for (const filePath of claudePreenDirs) {
  checkPrefixUsage(filePath, 'claude');
}

const claudePreenIds = collectTopLevelPreenIds('.claude/skills');
const codexPreenIds = collectTopLevelPreenIds('.codex/skills');
const geminiPreenIds = collectTopLevelPreenIds('.gemini/skills');

reportMissing('Codex', claudePreenIds, new Set(codexPreenIds));
reportMissing('Gemini', claudePreenIds, new Set(geminiPreenIds));
reportMissing('Claude', codexPreenIds, new Set(claudePreenIds));

for (const preenId of claudePreenIds) {
  const claudeFile = `.claude/skills/${preenId}/SKILL.md`;
  const codexFile = `.codex/skills/${preenId}/SKILL.md`;
  const geminiFile = `.gemini/skills/${preenId}/SKILL.md`;

  if (existsSync(claudeFile) && existsSync(codexFile)) {
    compareNormalizedPair(`${preenId} (Claude/Codex)`, claudeFile, codexFile);
  }
  if (existsSync(claudeFile) && existsSync(geminiFile)) {
    compareNormalizedPair(`${preenId} (Claude/Gemini)`, claudeFile, geminiFile);
  }
}

if (existsSync('.claude/skills/preen/SKILL.md') && existsSync('.codex/skills/preen/SKILL.md')) {
  compareNormalizedPair(
    'preen (Claude/Codex)',
    '.claude/skills/preen/SKILL.md',
    '.codex/skills/preen/SKILL.md',
  );
}
if (existsSync('.claude/skills/preen/SKILL.md') && existsSync('.gemini/skills/preen/SKILL.md')) {
  compareNormalizedPair(
    'preen (Claude/Gemini)',
    '.claude/skills/preen/SKILL.md',
    '.gemini/skills/preen/SKILL.md',
  );
}

checkRegistryGeneration();

if (mode === 'count') {
  console.log(String(issues));
  process.exit(0);
}

if (issues === 0) {
  console.error('[preen-check] OK');
  process.exit(0);
}

if (mode === 'strict') {
  console.error(`[preen-check] Found ${issues} issue(s)`);
  process.exit(1);
}

console.error(`[preen-check] Found ${issues} issue(s) (summary mode)`);
process.exit(0);
