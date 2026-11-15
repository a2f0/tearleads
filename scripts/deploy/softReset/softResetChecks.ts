import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type Identity,
  object,
  type ProviderRecord,
  parse,
} from "./softResetPlans";
import type { ResetRun } from "./softResetRuntime";

export async function inventory(run: ResetRun, identity: Identity) {
  const output = async (stack: string, name?: string) =>
    run.exec(
      [
        `terraform/scripts/run-${stack}-stack.sh`,
        run.tier,
        "output",
        "-json",
        ...(name ? [name] : []),
      ],
      "terraform-state",
    );
  const database = parse(await output("postgres", "database"));
  const bucket = parse(await output("storage", "bucket"));
  if (
    database.name !== `tearleads-${run.tier}` ||
    database.branch !== "main" ||
    database.organization !== identity.organization ||
    typeof database.branch_id !== "string" ||
    !database.branch_id ||
    bucket.name !== `tearleads-blobs-${run.tier}` ||
    bucket.account_id !== identity.account
  )
    throw new Error("Resource identity mismatch.");
  const connection = parse(await output("postgres", "api_connection"));
  const storage = parse(await output("storage", "api_storage"));
  if (
    storage.blob_s3_bucket !== bucket.name ||
    storage.blob_s3_endpoint !==
      `https://${identity.account}.r2.cloudflarestorage.com`
  )
    throw new Error("Blob connection identity mismatch.");
  for (const key of [
    "postgres_host",
    "postgres_db",
    "postgres_migration_user",
    "postgres_migration_password",
  ]) {
    if (typeof connection[key] !== "string" || !connection[key])
      throw new Error("Missing migration connection field.");
  }
  if (connection.postgres_migration_port !== "5432")
    throw new Error("Migration connection must use the direct port.");
  const edge = parse(await output("edge"));
  const suffix = run.tier === "prod" ? "" : "-staging";
  const urls = ["api", "app", "demo"].map((name) => {
    const url = object(edge[`${name}_url`]).value;
    if (url !== `https://${name}${suffix}.${identity.domain}`)
      throw new Error("Unexpected public hostname.");
    return String(url);
  });
  const website: unknown = JSON.parse(await output("website", "url"));
  if (
    website !==
    `https://${run.tier === "prod" ? "" : "website-staging."}${identity.domain}`
  )
    throw new Error("Unexpected website hostname.");
  urls.push(String(website));
  return { database, bucket, connection, storage, urls };
}
export type Inventory = Awaited<ReturnType<typeof inventory>>;

export function recordInventory(
  run: ResetRun,
  phase: "before" | "after",
  snapshot: Inventory,
) {
  writeFileSync(
    join(run.dir, `identities-${phase}.json`),
    JSON.stringify(
      {
        database: snapshot.database,
        bucket: snapshot.bucket,
        urls: snapshot.urls,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
}

export function sameInventory(before: Inventory, after: Inventory) {
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw new Error("Live identities or credentials changed since preflight.");
}

export function bindConnection(snapshot: Inventory, plan: ProviderRecord) {
  const changes = plan.resource_changes;
  if (!Array.isArray(changes)) throw new Error("Missing migration role.");
  const role = changes
    .map(object)
    .find(
      (value) =>
        value.address === "planetscale_postgres_branch_role.migrations",
    );
  const values = object(object(role?.change).after);
  const fields = {
    postgres_host: "access_host_url",
    postgres_db: "database_name",
    postgres_migration_user: "username",
    postgres_migration_password: "password",
  };
  for (const [key, field] of Object.entries(fields)) {
    if (snapshot.connection[key] !== values[field])
      throw new Error("Migration output is not bound to the inspected role.");
  }
}

export async function publicHealth(run: ResetRun, urls: string[]) {
  for (const url of urls) {
    const code = await run.exec(
      [
        "curl",
        "--silent",
        "--show-error",
        "--max-time",
        "20",
        "--output",
        "/dev/null",
        "--write-out",
        "%{http_code}",
        `${url}/`,
      ],
      "bounded-command",
    );
    if (code !== "200")
      throw new Error("Public health check did not return HTTP 200.");
  }
}

export async function emptyBucket(
  run: ResetRun,
  storage: ProviderRecord,
  requireEmpty = true,
) {
  const env = {
    AWS_ACCESS_KEY_ID: String(storage.blob_s3_access_key_id),
    AWS_SECRET_ACCESS_KEY: String(storage.blob_s3_secret_access_key),
    AWS_REQUEST_CHECKSUM_CALCULATION: "when_required",
    AWS_RESPONSE_CHECKSUM_VALIDATION: "when_required",
  };
  for (const [command, key] of [
    ["list-objects-v2", "Contents"],
    ["list-multipart-uploads", "Uploads"],
  ] as const) {
    const text = await run.exec(
      [
        "aws",
        "--endpoint-url",
        String(storage.blob_s3_endpoint),
        "--region",
        "auto",
        "s3api",
        command,
        "--bucket",
        String(storage.blob_s3_bucket),
        "--output",
        "json",
        ...(!requireEmpty ? ["--max-items", "1"] : []),
      ],
      "bounded-command",
      env,
    );
    const listing = text ? parse(text) : {};
    if (
      requireEmpty &&
      listing[key] !== undefined &&
      (!Array.isArray(listing[key]) || listing[key].length !== 0)
    )
      throw new Error("Application bucket is not empty.");
  }
}

export function baseline(run: ResetRun) {
  const dir = join(run.root, "packages/api-shared/drizzle");
  const files = readdirSync(dir).filter((name) => name.endsWith(".sql"));
  if (files.length !== 1 || files[0] !== "0000_greenfield_baseline.sql")
    throw new Error(
      "Baseline layout changed; update the reset schema verifier before use.",
    );
  const sql = readFileSync(join(dir, files[0]), "utf8");
  const names = [...sql.matchAll(/^CREATE TABLE "([a-z_][a-z_0-9]*)" \(/gm)]
    .map((match) => String(match[1]))
    .sort();
  if (!names.length) throw new Error("No baseline tables found.");
  return { names, hash: createHash("sha256").update(sql).digest("hex") };
}

export async function databaseCheck(
  run: ResetRun,
  connection: ProviderRecord,
  mode: "reachable" | "empty" | "baseline",
) {
  const expected = baseline(run);
  const env = {
    PGHOST: String(connection.postgres_host),
    PGPORT: "5432",
    PGDATABASE: String(connection.postgres_db),
    PGUSER: String(connection.postgres_migration_user),
    PGPASSWORD: String(connection.postgres_migration_password),
    PGSSLMODE: "verify-full",
    PGSSLROOTCERT: "system",
    PGCONNECT_TIMEOUT: "15",
    PGOPTIONS: "-c default_transaction_read_only=on -c statement_timeout=15000",
  };
  const query = async (sql: string): Promise<unknown> => {
    const text = await run.exec(
      ["psql", "-X", "-w", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", sql],
      "bounded-command",
      env,
    );
    try {
      return JSON.parse(text);
    } catch {
      throw new Error("Invalid database verification result.");
    }
  };
  if (mode === "reachable") {
    if (
      (await query("SELECT to_json(current_database())")) !==
      connection.postgres_db
    )
      throw new Error("Direct database connection identity mismatch.");
    return;
  }
  if (mode === "empty") {
    const rows = await query(
      "SELECT coalesce(json_agg(c.relname), '[]'::json) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','drizzle')",
    );
    if (!Array.isArray(rows) || rows.length)
      throw new Error("Application public/drizzle relations still exist.");
    return;
  }
  // pg_tables.tablename is name with C collation, not the database locale.
  // Its bytewise order matches baseline()'s ASCII identifier sort.
  const names = await query(
    "SELECT coalesce(json_agg(tablename ORDER BY tablename), '[]'::json) FROM pg_tables WHERE schemaname='public'",
  );
  if (JSON.stringify(names) !== JSON.stringify(expected.names))
    throw new Error("Initialized tables differ from the current baseline.");
  const rows = await query(
    `SELECT json_agg(t) FROM (${expected.names.map((name) => `SELECT '${name}' AS name, count(*)::int AS rows FROM public."${name}"`).join(" UNION ALL ")}) t`,
  );
  if (
    !Array.isArray(rows) ||
    rows.length !== expected.names.length ||
    rows.some((row) => object(row).rows !== 0)
  )
    throw new Error("Application data is not empty after migration.");
  const hashes = await query(
    "SELECT json_agg(hash ORDER BY id) FROM drizzle.__drizzle_migrations",
  );
  if (JSON.stringify(hashes) !== JSON.stringify([expected.hash]))
    throw new Error("Migration journal does not match the source baseline.");
  writeFileSync(
    join(run.dir, "schema.json"),
    JSON.stringify({
      tables: expected.names,
      baseline: expected.hash,
      empty: true,
    }),
    { mode: 0o600 },
  );
}
