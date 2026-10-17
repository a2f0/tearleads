// Drops every database object the connected login owns. PlanetScale refuses
// to delete a role that still owns objects, so a tier teardown runs this with
// the migration login before destroying the Postgres stack. It belongs only to
// an authorized complete teardown of a tier.
import pg from "pg";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

const client = new pg.Client({
  host: requireEnv("POSTGRES_HOST"),
  port: Number(requireEnv("POSTGRES_PORT")),
  user: requireEnv("POSTGRES_USER"),
  password: requireEnv("POSTGRES_PASSWORD"),
  database: requireEnv("POSTGRES_DATABASE"),
  ssl: { rejectUnauthorized: true },
});

await client.connect();
try {
  const countTables = async (): Promise<number> =>
    Number(
      (
        await client.query(
          "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema')",
        )
      ).rows[0]?.n ?? 0,
    );
  const before = await countTables();
  await client.query("DROP OWNED BY CURRENT_USER CASCADE");
  const after = await countTables();
  console.log(JSON.stringify({ tablesBefore: before, tablesAfter: after }));
} finally {
  await client.end();
}
