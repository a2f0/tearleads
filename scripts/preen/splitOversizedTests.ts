import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

type ChunkResult = {
  file: string;
  parts: string[];
  oversizedParts: { file: string; lines: number }[];
  skipped: boolean;
  reason?: string;
};

const MAX_LINES = Number.parseInt(process.env.MAX_LINES ?? '450', 10);
if (Number.isNaN(MAX_LINES) || MAX_LINES <= 0) {
  console.error('MAX_LINES must be a positive integer.');
  process.exit(1);
}

const inputFiles = process.argv.slice(2);
if (inputFiles.length === 0) {
  console.error('Usage: tsx scripts/preen/splitOversizedTests.ts <file...>');
  process.exit(1);
}

const isTestStatement = (statement: ts.Statement): boolean => {
  if (!ts.isExpressionStatement(statement)) return false;
  const expression = statement.expression;
  if (!ts.isCallExpression(expression)) return false;
  const callee = expression.expression;

  const isTargetIdentifier = (node: ts.Expression): boolean => {
    if (ts.isIdentifier(node)) {
      return node.text === 'describe' || node.text === 'test' || node.text === 'it';
    }
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      return (
        node.expression.text === 'describe' ||
        node.expression.text === 'test' ||
        node.expression.text === 'it'
      );
    }
    return false;
  };

  return isTargetIdentifier(callee);
};

const getTestCall = (statement: ts.Statement): ts.CallExpression | undefined => {
  if (!ts.isExpressionStatement(statement)) return undefined;
  const expression = statement.expression;
  if (!ts.isCallExpression(expression)) return undefined;
  return expression;
};

const getCallbackArgument = (
  callExpression: ts.CallExpression,
): { argument: ts.ArrowFunction | ts.FunctionExpression; index: number } | undefined => {
  for (let index = callExpression.arguments.length - 1; index >= 0; index -= 1) {
    const argument = callExpression.arguments[index];
    if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) {
      return { argument, index };
    }
  }
  return undefined;
};

const countLines = (text: string): number => {
  if (text.length === 0) return 0;
  return text.split(/\r?\n/).length;
};

const buildPartPath = (filePath: string, partIndex: number): string => {
  const dir = path.dirname(filePath);
  const fileName = path.basename(filePath);
  const match = fileName.match(/^(.*)\.(test|spec)\.(tsx|ts)$/);
  if (!match) {
    const ext = path.extname(fileName);
    const stem = path.basename(fileName, ext);
    return path.join(dir, `${stem}Part${partIndex}${ext}`);
  }
  const [, base, kind, ext] = match;
  return path.join(dir, `${base}Part${partIndex}.${kind}.${ext}`);
};

const splitFile = (filePath: string): ChunkResult => {
  const content = fs.readFileSync(filePath, 'utf8');
  const scriptKind = filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, scriptKind);
  const statements = sourceFile.statements;
  const firstTestIndex = statements.findIndex(isTestStatement);

  if (firstTestIndex === -1) {
    return {
      file: filePath,
      parts: [],
      oversizedParts: [],
      skipped: true,
      reason: 'No top-level test/describe statements found.',
    };
  }

  const preambleStatements = statements.slice(0, firstTestIndex);
  const preamble = preambleStatements.map((statement) => statement.getFullText(sourceFile)).join('');
  const preambleLines = countLines(preamble);

  const remainingStatements = statements.slice(firstTestIndex).map((statement) => statement.getFullText(sourceFile));
  const chunks: string[][] = [];
  let currentChunk: string[] = [];
  let currentLines = 0;

  for (const statementText of remainingStatements) {
    const statementLines = countLines(statementText);
    const projectedLines = preambleLines + currentLines + statementLines;
    if (currentChunk.length > 0 && projectedLines > MAX_LINES) {
      chunks.push(currentChunk);
      currentChunk = [statementText];
      currentLines = statementLines;
      continue;
    }
    currentChunk.push(statementText);
    currentLines += statementLines;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  if (chunks.length <= 1) {
    const testStatements = statements.filter(isTestStatement);
    if (testStatements.length === 1) {
      const testStatement = testStatements[0];
      const testCall = getTestCall(testStatement);
      if (testCall) {
        const callbackInfo = getCallbackArgument(testCall);
        if (callbackInfo) {
          const callbackBody = callbackInfo.argument.body;
          if (ts.isBlock(callbackBody)) {
            const innerStatements = callbackBody.statements;
            const innerFirstTestIndex = innerStatements.findIndex(isTestStatement);
            if (innerFirstTestIndex !== -1) {
              const innerPreambleStatements = innerStatements.slice(0, innerFirstTestIndex);
              const innerPreamble = innerPreambleStatements
                .map((statement) => statement.getFullText(sourceFile))
                .join('');
              const innerPreambleLines = countLines(innerPreamble);
              const innerRemainingStatements = innerStatements
                .slice(innerFirstTestIndex)
                .map((statement) => statement.getFullText(sourceFile));

              const innerChunks: string[][] = [];
              let currentInnerChunk: string[] = [];
              let currentInnerLines = 0;

              for (const statementText of innerRemainingStatements) {
                const statementLines = countLines(statementText);
                const projectedLines = preambleLines + innerPreambleLines + currentInnerLines + statementLines + 4;
                if (currentInnerChunk.length > 0 && projectedLines > MAX_LINES) {
                  innerChunks.push(currentInnerChunk);
                  currentInnerChunk = [statementText];
                  currentInnerLines = statementLines;
                  continue;
                }
                currentInnerChunk.push(statementText);
                currentInnerLines += statementLines;
              }

              if (currentInnerChunk.length > 0) {
                innerChunks.push(currentInnerChunk);
              }

              if (innerChunks.length > 1) {
                const calleeText = testCall.expression.getText(sourceFile);
                const argumentTexts = testCall.arguments.map((argument) => argument.getText(sourceFile));
                const beforeArgs = argumentTexts.slice(0, callbackInfo.index);
                const afterArgs = argumentTexts.slice(callbackInfo.index + 1);
                const argsPrefix = [...beforeArgs, '() => {'].join(', ');
                const argsSuffix = afterArgs.length > 0 ? `}, ${afterArgs.join(', ')}` : '}';
                const wrapperStart = `${calleeText}(${argsPrefix}\n`;
                const wrapperEnd = `\n${argsSuffix});\n`;

                const parts: string[] = [];
                const oversizedParts: { file: string; lines: number }[] = [];

                innerChunks.forEach((innerChunk, index) => {
                  const partIndex = index + 1;
                  const newPath = buildPartPath(filePath, partIndex);
                  const nextContent = `${preamble}${wrapperStart}${innerPreamble}${innerChunk.join(
                    '',
                  )}${wrapperEnd}`;
                  fs.writeFileSync(newPath, nextContent, 'utf8');
                  parts.push(newPath);
                  const totalLines = countLines(nextContent);
                  if (totalLines > MAX_LINES) {
                    oversizedParts.push({ file: newPath, lines: totalLines });
                  }
                });

                fs.unlinkSync(filePath);

                return {
                  file: filePath,
                  parts,
                  oversizedParts,
                  skipped: false,
                };
              }
            }
          }
        }
      }
    }

    return {
      file: filePath,
      parts: [],
      oversizedParts: [],
      skipped: true,
      reason: 'Unable to split into multiple chunks within MAX_LINES.',
    };
  }

  const parts: string[] = [];
  const oversizedParts: { file: string; lines: number }[] = [];

  chunks.forEach((chunk, index) => {
    const partIndex = index + 1;
    const newPath = buildPartPath(filePath, partIndex);
    const nextContent = `${preamble}${chunk.join('')}`;
    fs.writeFileSync(newPath, nextContent, 'utf8');
    parts.push(newPath);
    const totalLines = countLines(nextContent);
    if (totalLines > MAX_LINES) {
      oversizedParts.push({ file: newPath, lines: totalLines });
    }
  });

  fs.unlinkSync(filePath);

  return {
    file: filePath,
    parts,
    oversizedParts,
    skipped: false,
  };
};

const results: ChunkResult[] = [];
for (const file of inputFiles) {
  if (!fs.existsSync(file)) {
    results.push({ file, parts: [], oversizedParts: [], skipped: true, reason: 'File not found.' });
    continue;
  }
  results.push(splitFile(file));
}

const skipped = results.filter((result) => result.skipped);
const oversizedParts = results.flatMap((result) => result.oversizedParts);

if (skipped.length > 0) {
  console.error('Skipped files:');
  skipped.forEach((result) => {
    console.error(`- ${result.file}${result.reason ? `: ${result.reason}` : ''}`);
  });
}

if (oversizedParts.length > 0) {
  console.error('Oversized parts:');
  oversizedParts.forEach((part) => {
    console.error(`- ${part.file} (${part.lines} lines)`);
  });
}

if (skipped.length > 0 || oversizedParts.length > 0) {
  process.exitCode = 1;
}
