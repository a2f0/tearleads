#!/usr/bin/env -S node --experimental-strip-types

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export interface ProtoDefinition {
  basename: string;
  hasService: boolean;
}

export interface ProtoCodegenParityIssues {
  missing: string[];
  stale: string[];
}

function getRepoRoot(): string {
  const currentFilePath = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFilePath), '../..');
}

function hasServiceDefinition(content: string): boolean {
  return /^\s*service\s+[A-Za-z_][A-Za-z0-9_]*\s*\{/m.test(content);
}

export function readProtoDefinitions(protoDir: string): ProtoDefinition[] {
  const entries = readdirSync(protoDir, { withFileTypes: true });
  const definitions: ProtoDefinition[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.proto')) {
      continue;
    }

    const basename = entry.name.slice(0, -'.proto'.length);
    const content = readFileSync(path.join(protoDir, entry.name), 'utf8');
    definitions.push({
      basename,
      hasService: hasServiceDefinition(content)
    });
  }

  return definitions.sort((left, right) =>
    left.basename.localeCompare(right.basename)
  );
}

export function readGeneratedArtifactNames(generatedDir: string): Set<string> {
  return readGeneratedArtifactNamesWithExtension(generatedDir, '.ts');
}

function readGeneratedArtifactNamesWithExtension(
  generatedDir: string,
  extension: string
): Set<string> {
  const entries = readdirSync(generatedDir, { withFileTypes: true });
  const generated = new Set<string>();
  const pbSuffix = `_pb${extension}`;
  const connectSuffix = `_connect${extension}`;

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    if (!entry.name.endsWith(pbSuffix) && !entry.name.endsWith(connectSuffix)) {
      continue;
    }

    generated.add(entry.name);
  }

  return generated;
}

export function findProtoCodegenParityIssues(
  definitions: ReadonlyArray<ProtoDefinition>,
  generatedArtifacts: ReadonlySet<string>,
  extension = '.ts'
): ProtoCodegenParityIssues {
  const expected = new Set<string>();

  for (const definition of definitions) {
    expected.add(`${definition.basename}_pb${extension}`);
    if (definition.hasService) {
      expected.add(`${definition.basename}_connect${extension}`);
    }
  }

  const missing = [...expected]
    .filter((artifactName) => !generatedArtifacts.has(artifactName))
    .sort((left, right) => left.localeCompare(right));
  const stale = [...generatedArtifacts]
    .filter((artifactName) => !expected.has(artifactName))
    .sort((left, right) => left.localeCompare(right));

  return { missing, stale };
}

function printIssues(
  issues: ProtoCodegenParityIssues,
  generatedDir: string
): void {
  console.error('Error: proto codegen parity check failed.');
  console.error('');

  if (issues.missing.length > 0) {
    console.error('Missing generated artifacts:');
    for (const missingArtifact of issues.missing) {
      console.error(`  - ${missingArtifact}`);
    }
    console.error('');
  }

  if (issues.stale.length > 0) {
    console.error('Stale generated artifacts:');
    for (const staleArtifact of issues.stale) {
      console.error(`  - ${staleArtifact}`);
    }
    console.error('');
  }

  console.error(
    `Run \`pnpm protoGenerate\` and (for dist checks) \`pnpm --filter @tearleads/shared build\` to regenerate ${generatedDir}.`
  );
}

function resolveOverridePath(
  repoRoot: string,
  overrideValue: string | undefined,
  defaultValue: string
): string {
  if (!overrideValue || overrideValue.trim().length === 0) {
    return defaultValue;
  }

  return path.isAbsolute(overrideValue)
    ? overrideValue
    : path.join(repoRoot, overrideValue);
}

function main(): void {
  const repoRoot = getRepoRoot();
  const defaultProtoDir = path.join(repoRoot, 'proto', 'tearleads', 'v2');
  const defaultGeneratedDir = path.join(
    repoRoot,
    'packages',
    'shared',
    'src',
    'gen',
    'tearleads',
    'v2'
  );
  const protoDir = resolveOverridePath(
    repoRoot,
    process.env['PROTO_CODEGEN_PARITY_PROTO_DIR'],
    defaultProtoDir
  );
  const generatedDir = resolveOverridePath(
    repoRoot,
    process.env['PROTO_CODEGEN_PARITY_GENERATED_DIR'],
    defaultGeneratedDir
  );
  const extension =
    process.env['PROTO_CODEGEN_PARITY_ARTIFACT_EXTENSION'] ?? '.ts';
  const definitions = readProtoDefinitions(protoDir);
  const generatedArtifacts = readGeneratedArtifactNamesWithExtension(
    generatedDir,
    extension
  );
  const issues = findProtoCodegenParityIssues(
    definitions,
    generatedArtifacts,
    extension
  );

  if (issues.missing.length === 0 && issues.stale.length === 0) {
    process.exit(0);
  }

  printIssues(issues, generatedDir);
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
