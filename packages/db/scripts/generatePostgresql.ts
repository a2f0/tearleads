import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { postgresRuntimeTables } from '../src/schema/definition.js';
import { generatePostgresSchema } from '../src/generators/postgresql.js';

const outputDir = path.resolve(import.meta.dirname, '../src/generated/postgresql');
const rootOutputPath = path.join(outputDir, 'schema.ts');
const foundationOutputPath = path.join(outputDir, 'schema-foundation.ts');
const contentOutputPath = path.join(outputDir, 'schema-content.ts');
const runtimeOutputPath = path.join(outputDir, 'schema-runtime.ts');

const foundationNames = [
  'syncMetadata',
  'userSettings',
  'users',
  'organizations',
  'userOrganizations',
  'organizationBillingAccounts',
  'revenuecatWebhookEvents',
  'userCredentials',
  'migrations',
  'secrets',
  'files',
  'contacts',
  'contactPhones',
  'contactEmails',
  'analyticsEvents',
  'notes',
  'vehicles',
  'healthExercises',
  'healthWeightReadings',
  'healthBloodPressureReadings',
  'healthWorkoutEntries',
  'groups',
  'userGroups'
] as const;

const contentNames = [
  'userKeys',
  'vfsRegistry',
  'vfsLinks',
  'vfsItemState',
  'playlists',
  'albums',
  'contactGroups',
  'emailFolders',
  'tags',
  'walletItems',
  'walletItemMedia',
  'emails',
  'composedEmails',
  'emailAttachments',
  'vfsAclEntries',
  'vfsSyncChanges',
  'vfsSyncClientState'
] as const;

function findLineOrThrow(lines: string[], pattern: string): number {
  const index = lines.findIndex((line) => line.includes(pattern));
  if (index === -1) {
    throw new Error(
      `Expected pattern not found in generated PostgreSQL schema: ${pattern}`
    );
  }

  return index;
}

function detectUsedSymbols(
  source: string,
  names: readonly string[]
): string[] {
  return names.filter((name) =>
    new RegExp(`\\b${name}\\s*\\.`, 'u').test(source)
  );
}

function detectUsedCoreSymbols(
  source: string,
  names: readonly string[]
): string[] {
  return names.filter((name) => new RegExp(`\\b${name}\\b`, 'u').test(source));
}

function splitGeneratedPostgresSchema(input: string): {
  root: string;
  foundation: string;
  content: string;
  runtime: string;
} {
  const lines = input.split('\n');

  const foundationStart = findLineOrThrow(
    lines,
    'export const syncMetadata = pgTable('
  );
  const contentStart = findLineOrThrow(lines, 'export const userKeys = pgTable(');
  const runtimeStart = findLineOrThrow(lines, 'export const vfsCrdtOps = pgTable(');

  const foundationBody = `${lines.slice(foundationStart, contentStart).join('\n').trimEnd()}\n`;
  const contentBody = `${lines.slice(contentStart, runtimeStart).join('\n').trimEnd()}\n`;
  const runtimeBody = `${lines.slice(runtimeStart).join('\n').trimEnd()}\n`;

  const pgCoreSymbols = [
    'AnyPgColumn',
    'boolean',
    'index',
    'integer',
    'jsonb',
    'pgTable',
    'primaryKey',
    'text',
    'timestamp',
    'uniqueIndex'
  ] as const;
  const foundationCoreImports = detectUsedCoreSymbols(foundationBody, pgCoreSymbols);
  const contentCoreImports = detectUsedCoreSymbols(contentBody, pgCoreSymbols);
  const runtimeCoreImports = detectUsedCoreSymbols(runtimeBody, pgCoreSymbols);

  const renderPgCoreImport = (symbols: readonly string[]) =>
    `import {\n${symbols
      .map((name) => (name === 'AnyPgColumn' ? `  type ${name},` : `  ${name},`))
      .join('\n')}\n} from 'drizzle-orm/pg-core';\n\n`;

  const contentFoundationImports = detectUsedSymbols(
    contentBody,
    foundationNames
  );
  const runtimeFoundationImports = detectUsedSymbols(
    runtimeBody,
    foundationNames
  );
  const runtimeContentImports = detectUsedSymbols(runtimeBody, contentNames);

  const contentImports = [renderPgCoreImport(contentCoreImports)];
  if (contentFoundationImports.length > 0) {
    contentImports.push(
      `import {\n${contentFoundationImports.map((name) => `  ${name},`).join('\n')}\n} from './schema-foundation.js';\n\n`
    );
  }

  const runtimeImports = [renderPgCoreImport(runtimeCoreImports)];
  if (runtimeFoundationImports.length > 0) {
    runtimeImports.push(
      `import {\n${runtimeFoundationImports.map((name) => `  ${name},`).join('\n')}\n} from './schema-foundation.js';\n\n`
    );
  }
  if (runtimeContentImports.length > 0) {
    runtimeImports.push(
      `import {\n${runtimeContentImports.map((name) => `  ${name},`).join('\n')}\n} from './schema-content.js';\n\n`
    );
  }

  const root =
    "export * from './schema-foundation.js';\nexport * from './schema-content.js';\nexport * from './schema-runtime.js';\n";

  return {
    root,
    foundation: `${renderPgCoreImport(foundationCoreImports)}${foundationBody}`,
    content: `${contentImports.join('')}${contentBody}`,
    runtime: `${runtimeImports.join('')}${runtimeBody}`
  };
}

const schemaCode = generatePostgresSchema(postgresRuntimeTables);
const splitSchema = splitGeneratedPostgresSchema(schemaCode);

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(rootOutputPath, splitSchema.root);
fs.writeFileSync(foundationOutputPath, splitSchema.foundation);
fs.writeFileSync(contentOutputPath, splitSchema.content);
fs.writeFileSync(runtimeOutputPath, splitSchema.runtime);

execSync(
  `pnpm biome check --write --unsafe ${rootOutputPath} ${foundationOutputPath} ${contentOutputPath} ${runtimeOutputPath}`,
  { stdio: 'inherit' }
);

console.log(`PostgreSQL schema generated at ${outputDir}`);
