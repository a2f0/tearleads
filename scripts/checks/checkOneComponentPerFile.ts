#!/usr/bin/env -S pnpm exec tsx
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

type Mode = '--staged' | '--from-upstream' | '--all';
type ParsedArgs = {
  mode: Mode;
  reportOnly: boolean;
};

const EXCLUDED_FILE_PATTERNS = [/\.stories\.tsx$/];

const ALLOW_DIRECTIVE = 'one-component-per-file: allow';

function usage(): never {
  console.error(
    'Usage: checkOneComponentPerFile.ts (--staged | --from-upstream | --all) [--report]'
  );
  process.exit(2);
}

function parseArgs(argv: string[]): ParsedArgs {
  const modeArg = argv[2];
  const optionalArg = argv[3];

  if (
    modeArg !== '--staged' &&
    modeArg !== '--from-upstream' &&
    modeArg !== '--all'
  ) {
    usage();
  }

  if (optionalArg !== undefined && optionalArg !== '--report') {
    usage();
  }

  return {
    mode: modeArg,
    reportOnly: optionalArg === '--report'
  };
}

function runGit(args: string[]): string {
  const result = spawnSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });

  if (result.status !== 0) {
    const stderr = (result.stderr ?? '').trim();
    throw new Error(stderr || `git ${args.join(' ')} failed`);
  }

  return result.stdout ?? '';
}

function resolveBaseBranch(): string {
  try {
    const upstream = runGit([
      'rev-parse',
      '--abbrev-ref',
      '--symbolic-full-name',
      '@{u}'
    ]).trim();
    if (upstream.length > 0) {
      return upstream;
    }
  } catch {
    // Fall through to origin/main and main checks.
  }

  try {
    runGit(['rev-parse', '--verify', 'origin/main']);
    return 'origin/main';
  } catch {
    // Fall through to local main check.
  }

  try {
    runGit(['rev-parse', '--verify', 'main']);
    return 'main';
  } catch {
    throw new Error('cannot determine base branch for comparison');
  }
}

function collectCandidateFiles(mode: Mode): string[] {
  if (mode === '--all') {
    const output = runGit(['ls-files']);
    return output
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  if (mode === '--staged') {
    const output = runGit([
      'diff',
      '--name-only',
      '--diff-filter=AM',
      '--cached'
    ]);
    return output
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  const baseBranch = resolveBaseBranch();
  // Phase 1: enforce only newly added files in push range.
  const output = runGit([
    'diff',
    '--name-only',
    '--diff-filter=A',
    `${baseBranch}..HEAD`
  ]);
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function isExcluded(filePath: string): boolean {
  const normalizedPath = filePath.split('/').join(path.sep);
  if (!normalizedPath.endsWith('.tsx')) {
    return true;
  }

  for (const pattern of EXCLUDED_FILE_PATTERNS) {
    if (pattern.test(normalizedPath)) {
      return true;
    }
  }

  return false;
}

function nodeContainsJsx(node: ts.Node): boolean {
  let found = false;
  const visit = (current: ts.Node): void => {
    if (found) {
      return;
    }

    if (
      ts.isJsxElement(current) ||
      ts.isJsxSelfClosingElement(current) ||
      ts.isJsxFragment(current)
    ) {
      found = true;
      return;
    }

    ts.forEachChild(current, visit);
  };

  visit(node);
  return found;
}

function initializerContainsComponentJsx(initializer: ts.Expression): boolean {
  if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
    return nodeContainsJsx(initializer.body);
  }

  if (ts.isCallExpression(initializer)) {
    for (const argument of initializer.arguments) {
      if (
        ts.isArrowFunction(argument) ||
        ts.isFunctionExpression(argument) ||
        ts.isCallExpression(argument)
      ) {
        if (initializerContainsComponentJsx(argument)) {
          return true;
        }
      } else if (nodeContainsJsx(argument)) {
        return true;
      }
    }
  }

  return nodeContainsJsx(initializer);
}

function collectComponentNames(sourceFile: ts.SourceFile): string[] {
  const componentNames = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node)) {
      const functionName = node.name?.text;
      if (functionName && node.body && nodeContainsJsx(node.body)) {
        componentNames.add(functionName);
      }
      ts.forEachChild(node, visit);
      return;
    }

    if (ts.isVariableDeclaration(node)) {
      if (ts.isIdentifier(node.name) && node.initializer) {
        if (initializerContainsComponentJsx(node.initializer)) {
          componentNames.add(node.name.text);
        }
      }
      ts.forEachChild(node, visit);
      return;
    }

    if (ts.isClassDeclaration(node)) {
      const className = node.name?.text;
      if (className && nodeContainsJsx(node)) {
        componentNames.add(className);
      }
      ts.forEachChild(node, visit);
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return Array.from(componentNames);
}

function main(): void {
  const { mode, reportOnly } = parseArgs(process.argv);

  let candidateFiles: string[];
  try {
    candidateFiles = collectCandidateFiles(mode);
  } catch (error) {
    console.error(`Error: ${(error as Error).message}`);
    process.exit(1);
  }

  const violations: Array<{ filePath: string; names: string[] }> = [];

  for (const filePath of candidateFiles) {
    if (
      isExcluded(filePath) ||
      !fs.existsSync(filePath) ||
      !fs.statSync(filePath).isFile()
    ) {
      continue;
    }

    const sourceText = fs.readFileSync(filePath, 'utf8');
    if (sourceText.includes(ALLOW_DIRECTIVE)) {
      continue;
    }

    const sourceFile = ts.createSourceFile(
      filePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );

    const componentNames = collectComponentNames(sourceFile);
    if (componentNames.length > 1) {
      violations.push({ filePath, names: componentNames });
    }
  }

  if (violations.length === 0) {
    if (reportOnly) {
      console.log('No one-component-per-file violations found.');
    }
    return;
  }

  if (reportOnly) {
    console.log(
      `Found ${violations.length} files with one-component-per-file violations:`
    );
    for (const violation of violations) {
      console.log(
        `  - ${violation.filePath} (${violation.names.length} components: ${violation.names.join(', ')})`
      );
    }
    return;
  }

  console.error(
    'Error: found .tsx files with more than one JSX component declaration.'
  );
  console.error(
    'Rule: keep one component per file and colocate tests/stories next to it.'
  );
  console.error(
    `Escape hatch: add "${ALLOW_DIRECTIVE}" in the file when absolutely necessary.`
  );
  console.error('');

  for (const violation of violations) {
    console.error(
      `  - ${violation.filePath} (${violation.names.length} components: ${violation.names.join(', ')})`
    );
  }

  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
