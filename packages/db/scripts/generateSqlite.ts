import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { sqliteRuntimeTables } from '../src/schema/definition.js';
import { generateSqliteSchema } from '../src/generators/sqlite.js';

const outputDir = path.resolve(import.meta.dirname, '../src/generated/sqlite');
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

const runtimeNames = [
  'vfsCrdtOps',
  'mlsKeyPackages',
  'mlsGroups',
  'mlsGroupMembers',
  'mlsMessages',
  'mlsWelcomeMessages',
  'mlsGroupState',
  'aiConversations',
  'aiMessages',
  'aiUsage'
] as const;

function findLineOrThrow(lines: string[], pattern: string): number {
  const index = lines.findIndex((line) => line.includes(pattern));
  if (index === -1) {
    throw new Error(`Expected pattern not found in generated SQLite schema: ${pattern}`);
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

function splitGeneratedSqliteSchema(input: string): {
  root: string;
  foundation: string;
  content: string;
  runtime: string;
} {
  const lines = input.split('\n');

  const foundationStart = findLineOrThrow(
    lines,
    'export const syncMetadata = sqliteTable('
  );
  const contentStart = findLineOrThrow(
    lines,
    'export const userKeys = sqliteTable('
  );
  const runtimeStart = findLineOrThrow(
    lines,
    'export const vfsCrdtOps = sqliteTable('
  );
  const schemaStart = findLineOrThrow(lines, 'export const schema = {');

  const foundationBody = `${lines.slice(foundationStart, contentStart).join('\n').trimEnd()}\n`;
  const contentBody = `${lines.slice(contentStart, runtimeStart).join('\n').trimEnd()}\n`;
  const runtimeBody = `${lines.slice(runtimeStart, schemaStart).join('\n').trimEnd()}\n`;

  const sqliteCoreSymbols = [
    'AnySQLiteColumn',
    'index',
    'integer',
    'primaryKey',
    'sqliteTable',
    'text',
    'uniqueIndex'
  ] as const;
  const foundationCoreImports = detectUsedCoreSymbols(
    foundationBody,
    sqliteCoreSymbols
  );
  const contentCoreImports = detectUsedCoreSymbols(contentBody, sqliteCoreSymbols);
  const runtimeCoreImports = detectUsedCoreSymbols(runtimeBody, sqliteCoreSymbols);

  const renderSqliteCoreImport = (symbols: readonly string[]) =>
    `import {\n${symbols
      .map((name) => (name === 'AnySQLiteColumn' ? `  type ${name},` : `  ${name},`))
      .join('\n')}\n} from 'drizzle-orm/sqlite-core';\n\n`;

  const contentFoundationImports = detectUsedSymbols(
    contentBody,
    foundationNames
  );
  const runtimeFoundationImports = detectUsedSymbols(
    runtimeBody,
    foundationNames
  );
  const runtimeContentImports = detectUsedSymbols(runtimeBody, contentNames);

  const contentImports = [renderSqliteCoreImport(contentCoreImports)];
  if (contentFoundationImports.length > 0) {
    contentImports.push(
      `import {\n${contentFoundationImports.map((name) => `  ${name},`).join('\n')}\n} from './schema-foundation.js';\n\n`
    );
  }

  const runtimeImports = [renderSqliteCoreImport(runtimeCoreImports)];
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

  const root = `import type { SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy';\nimport {\n${foundationNames.map((name) => `  ${name},`).join('\n')}\n} from './schema-foundation.js';\nimport {\n${contentNames.map((name) => `  ${name},`).join('\n')}\n} from './schema-content.js';\nimport {\n${runtimeNames.map((name) => `  ${name},`).join('\n')}\n} from './schema-runtime.js';\n\nexport * from './schema-foundation.js';\nexport * from './schema-content.js';\nexport * from './schema-runtime.js';\n\n/**\n * Schema object containing all table definitions.\n */\nexport const schema = {\n${[...foundationNames, ...contentNames, ...runtimeNames]
    .map((name) => `  ${name},`)
    .join('\n')}\n};\n\n/**\n * Database type for SQLite with full schema.\n */\nexport type Database = SqliteRemoteDatabase<typeof schema>;\n`;

  return {
    root,
    foundation: `${renderSqliteCoreImport(foundationCoreImports)}${foundationBody}`,
    content: `${contentImports.join('')}${contentBody}`,
    runtime: `${runtimeImports.join('')}${runtimeBody}`
  };
}

const schemaCode = generateSqliteSchema(sqliteRuntimeTables);
const splitSchema = splitGeneratedSqliteSchema(schemaCode);

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(rootOutputPath, splitSchema.root);
fs.writeFileSync(foundationOutputPath, splitSchema.foundation);
fs.writeFileSync(contentOutputPath, splitSchema.content);
fs.writeFileSync(runtimeOutputPath, splitSchema.runtime);

execSync(
  `pnpm biome check --write --unsafe ${rootOutputPath} ${foundationOutputPath} ${contentOutputPath} ${runtimeOutputPath}`,
  { stdio: 'inherit' }
);

console.log(`SQLite schema generated at ${outputDir}`);
