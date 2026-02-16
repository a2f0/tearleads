import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { allTables } from '../src/schema/definition.js';
import { generatePostgresSchema } from '../src/generators/postgresql.js';

const outputPath = path.resolve(
  import.meta.dirname,
  '../src/generated/postgresql/schema.ts'
);

const schemaCode = generatePostgresSchema(allTables);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, schemaCode);

// Format with biome
execSync(`pnpm biome check --write ${outputPath}`, { stdio: 'inherit' });
console.log(`PostgreSQL schema generated at ${outputPath}`);
