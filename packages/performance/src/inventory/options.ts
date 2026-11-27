import { parseArgs } from "node:util";

export interface InventoryOptions {
  /** Optional saved `perf:canaries` JSON report to compare against ceilings. */
  readonly canariesReport?: string;
  /** Print the full JSON report to stdout instead of Markdown. */
  readonly json: boolean;
}

export const inventoryUsage = `Run a static census of Tearleads schema, indexes, routes, unread fields, and canary ceilings.

bun run perf:inventory [--canaries .test_files/performance/<canaries>.json] [--json]

Scans:
- PostgreSQL migrations (packages/api-shared/drizzle) and Drizzle schema mappings
- Client SQLite tables (packages/client-sdk/src/data/sqlite/schema + app projectors)
- OpenAPI operations and 2xx JSON response fields (docs/openapi.json)
- Left-prefix duplicate indexes and zero-reader table/column/field leads
- Canary request budget ceilings (plus live ceiling drift when --canaries is passed)

Saves JSON and Markdown reports under .test_files/performance/.`;

export function parseInventoryOptions(
  args: readonly string[],
): InventoryOptions | null {
  const { values, positionals } = parseArgs({
    args: [...args],
    options: {
      canaries: { type: "string" },
      json: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    strict: true,
    allowPositionals: true,
  });
  if (values.help) return null;
  if (positionals.length > 0) {
    throw new Error(`Unexpected argument ${positionals[0]}; see --help.`);
  }
  return {
    ...(values.canaries !== undefined
      ? { canariesReport: values.canaries }
      : {}),
    json: values.json,
  };
}
