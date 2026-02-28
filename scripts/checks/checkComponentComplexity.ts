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

type ComponentTarget = {
  name: string;
  body: ts.Node;
  startLine: number;
  endLine: number;
};

type ComponentMetrics = {
  filePath: string;
  componentName: string;
  lines: number;
  maxJsxDepth: number;
  branchCount: number;
  breaches: string[];
};

const MAX_COMPONENT_LINES = 220;
const MAX_JSX_DEPTH = 6;
const MAX_BRANCH_COUNT = 18;

const EXCLUDED_FILE_PATTERNS = [
  /\.test\.tsx$/,
  /\.spec\.tsx$/,
  /\.stories\.tsx$/
];
const EXCLUDED_PATH_SEGMENTS = [
  `${path.sep}__tests__${path.sep}`,
  `${path.sep}src${path.sep}test${path.sep}`
];
const ALLOW_DIRECTIVE = 'component-complexity: allow';

function usage(): never {
  console.error(
    'Usage: checkComponentComplexity.ts (--staged | --from-upstream | --all) [--report]'
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
    // Fall through.
  }

  try {
    runGit(['rev-parse', '--verify', 'origin/main']);
    return 'origin/main';
  } catch {
    // Fall through.
  }

  try {
    runGit(['rev-parse', '--verify', 'main']);
    return 'main';
  } catch {
    throw new Error('cannot determine base branch for comparison');
  }
}

function collectCandidateFiles(mode: Mode): string[] {
  const processOutput = (output: string): string[] =>
    output
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

  if (mode === '--all') {
    return processOutput(runGit(['ls-files']));
  }

  if (mode === '--staged') {
    return processOutput(
      runGit(['diff', '--name-only', '--diff-filter=AM', '--cached'])
    );
  }

  const baseBranch = resolveBaseBranch();
  return processOutput(
    runGit(['diff', '--name-only', '--diff-filter=AM', `${baseBranch}..HEAD`])
  );
}

function isPascalCase(name: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/.test(name);
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

  for (const segment of EXCLUDED_PATH_SEGMENTS) {
    if (normalizedPath.includes(segment)) {
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

function findArrowOrFunctionBody(initializer: ts.Expression): ts.Node | null {
  if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
    return initializer.body;
  }

  if (ts.isCallExpression(initializer)) {
    for (const argument of initializer.arguments) {
      if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) {
        return argument.body;
      }
    }
  }

  return nodeContainsJsx(initializer) ? initializer : null;
}

function collectComponentTargets(sourceFile: ts.SourceFile): ComponentTarget[] {
  const targets = new Map<string, ComponentTarget>();

  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node)) {
      const name = node.name?.text;
      if (
        name &&
        isPascalCase(name) &&
        node.body &&
        nodeContainsJsx(node.body)
      ) {
        const startLine = sourceFile.getLineAndCharacterOfPosition(
          node.getStart(sourceFile)
        ).line;
        const endLine = sourceFile.getLineAndCharacterOfPosition(
          node.getEnd()
        ).line;
        targets.set(name, {
          name,
          body: node.body,
          startLine: startLine + 1,
          endLine: endLine + 1
        });
      }
    }

    if (ts.isVariableDeclaration(node)) {
      if (
        ts.isIdentifier(node.name) &&
        isPascalCase(node.name.text) &&
        node.initializer
      ) {
        const body = findArrowOrFunctionBody(node.initializer);
        if (body !== null) {
          const startLine = sourceFile.getLineAndCharacterOfPosition(
            node.getStart(sourceFile)
          ).line;
          const endLine = sourceFile.getLineAndCharacterOfPosition(
            node.getEnd()
          ).line;
          targets.set(node.name.text, {
            name: node.name.text,
            body,
            startLine: startLine + 1,
            endLine: endLine + 1
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return Array.from(targets.values());
}

function computeMaxJsxDepth(node: ts.Node): number {
  let maxDepth = 0;

  const visit = (current: ts.Node, depth: number): void => {
    if (ts.isJsxElement(current) || ts.isJsxFragment(current)) {
      const nextDepth = depth + 1;
      maxDepth = Math.max(maxDepth, nextDepth);
      for (const child of current.children) {
        visit(child, nextDepth);
      }
      return;
    }

    if (ts.isJsxSelfClosingElement(current)) {
      const nextDepth = depth + 1;
      maxDepth = Math.max(maxDepth, nextDepth);
      return;
    }

    ts.forEachChild(current, (child) => visit(child, depth));
  };

  visit(node, 0);
  return maxDepth;
}

function computeBranchCount(node: ts.Node): number {
  let branchCount = 0;
  const visit = (current: ts.Node): void => {
    if (
      ts.isIfStatement(current) ||
      ts.isConditionalExpression(current) ||
      ts.isSwitchStatement(current) ||
      ts.isForStatement(current) ||
      ts.isForOfStatement(current) ||
      ts.isForInStatement(current) ||
      ts.isWhileStatement(current) ||
      ts.isDoStatement(current) ||
      ts.isCatchClause(current)
    ) {
      branchCount += 1;
    }

    if (
      ts.isBinaryExpression(current) &&
      (current.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        current.operatorToken.kind === ts.SyntaxKind.BarBarToken)
    ) {
      branchCount += 1;
    }

    ts.forEachChild(current, visit);
  };

  visit(node);
  return branchCount;
}

function evaluateComponentMetrics(
  filePath: string,
  target: ComponentTarget
): ComponentMetrics | null {
  const lines = target.endLine - target.startLine + 1;
  const maxJsxDepth = computeMaxJsxDepth(target.body);
  const branchCount = computeBranchCount(target.body);
  const breaches: string[] = [];

  if (lines > MAX_COMPONENT_LINES) {
    breaches.push(`lines ${lines} > ${MAX_COMPONENT_LINES}`);
  }
  if (maxJsxDepth > MAX_JSX_DEPTH) {
    breaches.push(`jsx-depth ${maxJsxDepth} > ${MAX_JSX_DEPTH}`);
  }
  if (branchCount > MAX_BRANCH_COUNT) {
    breaches.push(`branch-count ${branchCount} > ${MAX_BRANCH_COUNT}`);
  }

  if (breaches.length === 0) {
    return null;
  }

  return {
    filePath,
    componentName: target.name,
    lines,
    maxJsxDepth,
    branchCount,
    breaches
  };
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

  const violations: ComponentMetrics[] = [];

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

    const targets = collectComponentTargets(sourceFile);
    for (const target of targets) {
      const metrics = evaluateComponentMetrics(filePath, target);
      if (metrics !== null) {
        violations.push(metrics);
      }
    }
  }

  if (violations.length === 0) {
    if (reportOnly) {
      console.log('No component complexity violations found.');
    }
    return;
  }

  if (reportOnly) {
    console.log(`Found ${violations.length} component complexity violations:`);
    for (const violation of violations) {
      console.log(
        `  - ${violation.filePath} :: ${violation.componentName} (${violation.breaches.join(', ')})`
      );
    }
    return;
  }

  console.error('Error: component complexity limits exceeded.');
  console.error(
    `Thresholds: lines<=${MAX_COMPONENT_LINES}, jsx-depth<=${MAX_JSX_DEPTH}, branch-count<=${MAX_BRANCH_COUNT}`
  );
  console.error(
    `Escape hatch: add "${ALLOW_DIRECTIVE}" in the file with a short rationale.`
  );
  console.error('');

  for (const violation of violations) {
    console.error(
      `  - ${violation.filePath} :: ${violation.componentName} (${violation.breaches.join(', ')})`
    );
  }

  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
