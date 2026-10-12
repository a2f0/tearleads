// Wrangler aliases `bun:sqlite` here. The shared database module imports the
// SQLite adapter statically for local development and tests; the Worker only
// ever selects Postgres, so the alias keeps Bun's native module out of the
// bundle and fails loudly if anything reaches for it.
export class Database {
  constructor() {
    throw new Error("bun:sqlite is unavailable in the Workers runtime");
  }
}
