// Wrangler aliases `@libsql/client` here; see bunSqlite.ts.
export function createClient(): never {
  throw new Error("Turso is unavailable in the Workers runtime");
}
