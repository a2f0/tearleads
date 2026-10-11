// Wrangler aliases `@electric-sql/pglite` here; see bunSqlite.ts. Drizzle's
// PGlite session imports the type-parser table at module load, so the stub
// exports an empty one; it is only consulted by a PGlite-backed session.
export class PGlite {
  constructor() {
    throw new Error("PGlite is unavailable in the Workers runtime");
  }
}

export const types = {};
