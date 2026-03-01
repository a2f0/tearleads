import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { generatePostgresSchema } from '../src/generators/postgresql.js';
import { postgresRuntimeTables } from '../src/schema/definition.js';

const outputDir = path.resolve(import.meta.dirname, '../src/generated/postgresql');
const rootOutputPath = path.join(outputDir, 'schema.ts');
const foundationOutputPath = path.join(outputDir, 'schema-foundation.ts');
const contentOutputPath = path.join(outputDir, 'schema-content.ts');
const policyOutputPath = path.join(outputDir, 'schemaPolicy.ts');
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
  'playlists',
  'albums',
  'contactGroups',
  'aiConversations',
  'aiMessages',
  'tags',
  'walletItems',
  'walletItemMedia',
  'emails',
  'composedEmails',
  'emailAttachments'
] as const;

const policyNames = [
  'vfsSharePolicies',
  'vfsSharePolicySelectors',
  'vfsSharePolicyPrincipals',
  'vfsItemState',
  'vfsAclEntries',
  'vfsAclEntryProvenance',
  'vfsSyncChanges',
  'vfsSyncClientState'
] as const;

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

function findLineOrThrow(lines: string[], pattern: string): number {
  const index = lines.findIndex((line) => line.includes(pattern));
  if (index === -1) {
    throw new Error(
      `Expected pattern not found in generated PostgreSQL schema: ${pattern}`
    );
  }

  return index;
}

function detectUsedSymbols(source: string, names: readonly string[]): string[] {
  return names.filter((name) =>
    new RegExp(`\\b${name}\\s*\\.`, 'u').test(source)
  );
}

function detectUsedCoreSymbols(
  source: string,
  names: readonly string[]
): string[] {
  return names.filter((name) => {
    if (name === 'primaryKey') {
      return /(?:^|[^.\w])primaryKey\s*\(/u.test(source);
    }

    return new RegExp(`\\b${name}\\b`, 'u').test(source);
  });
}

function renderPgCoreImport(symbols: readonly string[]): string {
  return `import {\n${symbols
    .map((name) => (name === 'AnyPgColumn' ? `  type ${name},` : `  ${name},`))
    .join('\n')}\n} from 'drizzle-orm/pg-core';\n\n`;
}

function buildModuleImports(
  body: string,
  modulePath: string,
  symbols: readonly string[]
): string | null {
  const used = detectUsedSymbols(body, symbols);
  if (used.length === 0) {
    return null;
  }

  return `import {\n${used.map((name) => `  ${name},`).join('\n')}\n} from '${modulePath}';\n\n`;
}

function splitGeneratedPostgresSchema(input: string): {
  root: string;
  foundation: string;
  content: string;
  policy: string;
  runtime: string;
} {
  const lines = input.split('\n');

  const foundationStart = findLineOrThrow(lines, 'export const syncMetadata = pgTable(');
  const contentStart = findLineOrThrow(lines, 'export const userKeys = pgTable(');
  const policyStart = findLineOrThrow(lines, 'export const vfsSharePolicies = pgTable(');
  const runtimeStart = findLineOrThrow(lines, 'export const vfsCrdtOps = pgTable(');

  const foundationBody = `${lines.slice(foundationStart, contentStart).join('\n').trimEnd()}\n`;
  const contentBody = `${lines.slice(contentStart, policyStart).join('\n').trimEnd()}\n`;
  const policyBody = `${lines.slice(policyStart, runtimeStart).join('\n').trimEnd()}\n`;
  const runtimeBody = `${lines.slice(runtimeStart).join('\n').trimEnd()}\n`;

  const foundationCoreImports = detectUsedCoreSymbols(foundationBody, pgCoreSymbols);
  const contentCoreImports = detectUsedCoreSymbols(contentBody, pgCoreSymbols);
  const policyCoreImports = detectUsedCoreSymbols(policyBody, pgCoreSymbols);
  const runtimeCoreImports = detectUsedCoreSymbols(runtimeBody, pgCoreSymbols);

  const contentImports = [
    renderPgCoreImport(contentCoreImports),
    buildModuleImports(contentBody, './schema-foundation.js', foundationNames)
  ]
    .filter((value): value is string => value !== null)
    .join('');

  const policyImports = [
    renderPgCoreImport(policyCoreImports),
    buildModuleImports(policyBody, './schema-foundation.js', foundationNames),
    buildModuleImports(policyBody, './schema-content.js', contentNames)
  ]
    .filter((value): value is string => value !== null)
    .join('');

  const runtimeImports = [
    renderPgCoreImport(runtimeCoreImports),
    buildModuleImports(runtimeBody, './schema-foundation.js', foundationNames),
    buildModuleImports(runtimeBody, './schema-content.js', contentNames),
    buildModuleImports(runtimeBody, './schemaPolicy.js', policyNames)
  ]
    .filter((value): value is string => value !== null)
    .join('');

  const root =
    "export * from './schema-foundation.js';\nexport * from './schema-content.js';\nexport * from './schemaPolicy.js';\nexport * from './schema-runtime.js';\n";

  return {
    root,
    foundation: `${renderPgCoreImport(foundationCoreImports)}${foundationBody}`,
    content: `${contentImports}${contentBody}`,
    policy: `${policyImports}${policyBody}`,
    runtime: `${runtimeImports}${runtimeBody}`
  };
}

const schemaCode = generatePostgresSchema(postgresRuntimeTables);
const splitSchema = splitGeneratedPostgresSchema(schemaCode);

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(rootOutputPath, splitSchema.root);
fs.writeFileSync(foundationOutputPath, splitSchema.foundation);
fs.writeFileSync(contentOutputPath, splitSchema.content);
fs.writeFileSync(policyOutputPath, splitSchema.policy);
fs.writeFileSync(runtimeOutputPath, splitSchema.runtime);

execSync(
  `pnpm biome check --write --unsafe ${rootOutputPath} ${foundationOutputPath} ${contentOutputPath} ${policyOutputPath} ${runtimeOutputPath}`,
  { stdio: 'inherit' }
);

console.log(`PostgreSQL schema generated at ${outputDir}`);
