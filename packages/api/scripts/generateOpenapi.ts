import fs from 'node:fs';
import path from 'node:path';
import { openapiSpecification } from '../src/openapi.js';

const outputPath = path.resolve(import.meta.dirname, '../dist/openapi.json');

fs.mkdirSync(path.dirname(outputPath), { recursive: true });

fs.writeFileSync(outputPath, JSON.stringify(openapiSpecification, null, 2));
console.log(`OpenAPI spec generated at ${outputPath}`);
