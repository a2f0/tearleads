#!/usr/bin/env -S pnpm exec tsx
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

function usage(scriptPath: string): string {
  return `Usage: ${scriptPath} [--title <value> | <value>]

Sets VS Code window title.
Default title: '<workspace>'
With --title or a positional value: uses that exact title.`;
}

function getRepoRoot(): string {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function parseArgs(argv: string[]): { help: boolean; titleOverride?: string } {
  let titleOverride: string | undefined;
  let help = false;

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '-h' || token === '--help') {
      help = true;
      continue;
    }

    if (token === '--title') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('Error: --title requires a value.');
      }
      titleOverride = value;
      index += 1;
      continue;
    }

    if (titleOverride !== undefined) {
      throw new Error(
        `Error: Unexpected argument '${token}'. Use -h for help.`
      );
    }
    titleOverride = token;
  }

  return {
    help,
    ...(titleOverride === undefined ? {} : { titleOverride })
  };
}

function main(): void {
  const scriptPath = process.argv[1] || 'setVscodeTitle.ts';
  const { help, titleOverride } = parseArgs(process.argv);
  if (help) {
    process.stdout.write(`${usage(scriptPath)}\n`);
    return;
  }

  const repoRoot = getRepoRoot();
  const workspace = path.basename(repoRoot);
  const title = titleOverride ?? workspace;

  const vscodeDir = path.join(repoRoot, '.vscode');
  const settingsFile = path.join(vscodeDir, 'settings.json');
  mkdirSync(vscodeDir, { recursive: true });

  let settings: Record<string, unknown> = {};
  if (existsSync(settingsFile)) {
    const raw = readFileSync(settingsFile, 'utf8');
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        !Array.isArray(parsed)
      ) {
        settings = parsed as Record<string, unknown>;
      } else {
        throw new Error('settings.json must be a JSON object');
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(
          `Error: Failed to parse ${settingsFile} as JSON: ${error.message}`
        );
      }
      throw error;
    }
  }

  settings['window.title'] = title;
  writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`);
  process.stdout.write(`Window title set to: ${title}\n`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
