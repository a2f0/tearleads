#!/usr/bin/env -S node --experimental-strip-types

import { readFileSync, readdirSync } from 'node:fs';
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
  const entries = readdirSync(generatedDir, { withFileTypes: true });
  const generated = new Set<string>();

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    if (!entry.name.endsWith('_pb.ts') && !entry.name.endsWith('_connect.ts')) {
      continue;
    }

    generated.add(entry.name);
  }

  return generated;
}

export function findProtoCodegenParityIssues(
  definitions: ReadonlyArray<ProtoDefinition>,
  generatedArtifacts: ReadonlySet<string>
): ProtoCodegenParityIssues {
  const expected = new Set<string>();

  for (const definition of definitions) {
    expected.add(`${definition.basename}_pb.ts`);
    if (definition.hasService) {
      expected.add(`${definition.basename}_connect.ts`);
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

function printIssues(issues: ProtoCodegenParityIssues): void {
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
    'Run `pnpm protoGenerate` to regenerate `packages/shared/src/gen/tearleads/v2`.'
  );
}

function main(): void {
  const repoRoot = getRepoRoot();
  const protoDir = path.join(repoRoot, 'proto', 'tearleads', 'v2');
  const generatedDir = path.join(
    repoRoot,
    'packages',
    'shared',
    'src',
    'gen',
    'tearleads',
    'v2'
  );
  const definitions = readProtoDefinitions(protoDir);
  const generatedArtifacts = readGeneratedArtifactNames(generatedDir);
  const issues = findProtoCodegenParityIssues(definitions, generatedArtifacts);

  if (issues.missing.length === 0 && issues.stale.length === 0) {
    process.exit(0);
  }

  printIssues(issues);
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
