import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { allTables } from '../src/schema/definition.js';
import { generateSqliteSchema } from '../src/generators/sqlite.js';

const outputPath = path.resolve(
  import.meta.dirname,
  '../src/generated/sqlite/schema.ts'
);

const schemaCode = generateSqliteSchema(allTables);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, schemaCode);

// Format with biome
execSync(`pnpm biome check --write ${outputPath}`, { stdio: 'inherit' });
console.log(`SQLite schema generated at ${outputPath}`);
