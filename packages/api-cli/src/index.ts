import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  type ApiMigrationDialect,
  embeddedMigrationPath,
  migrationDialectForDatabase,
} from "./migrationAssets";

const apiDatabaseEnvKey = "API_DATABASE";

function usage(): string {
  return [
    "Usage: tearleads-api-cli <command>",
    "",
    "Commands:",
    "  blob-store:list-keys [--prefix <prefix>] [--with-size]    List configured S3 blob store keys",
    "  make-admin <fingerprint>      Grant root (global admin) access to the identity with this signing key fingerprint",
    "  migrate    Run API database migrations",
    "  revoke-admin <fingerprint>    Revoke root (global admin) access from the identity with this signing key fingerprint",
  ].join("\n");
}

function isHelpArg(arg: string | undefined): boolean {
  return arg === "-h" || arg === "--help";
}

function embeddedFileName(file: Blob): string | undefined {
  if (!("name" in file)) {
    return undefined;
  }

  return typeof file.name === "string" ? file.name : undefined;
}

async function materializeEmbeddedMigrations(
  dialect: ApiMigrationDialect,
): Promise<string | undefined> {
  const migrationFiles = Bun.embeddedFiles
    .map((file) => {
      const name = embeddedFileName(file);
      return {
        file,
        path: name ? embeddedMigrationPath(name, dialect) : undefined,
      };
    })
    .filter((entry) => entry.path !== undefined);

  if (migrationFiles.length === 0) {
    return undefined;
  }

  const migrationsFolder = await mkdtemp(
    join(tmpdir(), "tearleads-api-migrations-"),
  );

  try {
    for (const { file, path } of migrationFiles) {
      if (path === undefined) {
        continue;
      }

      const filePath = join(migrationsFolder, path);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, await file.text());
    }
  } catch (error) {
    await rm(migrationsFolder, { force: true, recursive: true });
    throw error;
  }

  return migrationsFolder;
}

async function cleanupApiDatabase(
  closeApiDatabase: () => Promise<void>,
  migrationsFolder: string | undefined,
): Promise<unknown> {
  let cleanupError: unknown;

  try {
    await closeApiDatabase();
  } catch (error) {
    cleanupError ??= error;
    console.error("Error closing API database:", error);
  }

  try {
    if (migrationsFolder) {
      await rm(migrationsFolder, { force: true, recursive: true });
    }
  } catch (error) {
    cleanupError ??= error;
    console.error("Error cleaning up API migration files:", error);
  }

  return cleanupError;
}

async function runMigrations(): Promise<void> {
  process.env[apiDatabaseEnvKey] ??= "postgres";

  const migrationDialect = migrationDialectForDatabase(
    process.env[apiDatabaseEnvKey],
  );
  const migrationsFolder =
    await materializeEmbeddedMigrations(migrationDialect);
  const { closeApiDatabase, db, initializeApiDatabase } = await import(
    "@tearleads/api-shared/postgres"
  );
  const { assertCurrentApiSchema } = await import("./assertCurrentSchema");

  try {
    console.log("Running API database migrations...");
    await initializeApiDatabase(
      migrationsFolder ? { migrationsFolder } : undefined,
    );
    await assertCurrentApiSchema(db);
    console.log("API database migrations complete.");
  } catch (error) {
    await cleanupApiDatabase(closeApiDatabase, migrationsFolder);
    throw error;
  }

  const cleanupError = await cleanupApiDatabase(
    closeApiDatabase,
    migrationsFolder,
  );
  if (cleanupError) {
    throw cleanupError;
  }
}

async function listBlobStoreKeys(args: readonly string[]): Promise<void> {
  const { listS3BlobStoreKeys, parseListBlobStoreKeysArgs } = await import(
    "./blobStoreKeys"
  );
  await listS3BlobStoreKeys(parseListBlobStoreKeysArgs(args));
}

async function setRootAccess(
  args: readonly string[],
  isRoot: boolean,
): Promise<void> {
  // The schema module resolves the database dialect when it is imported, and
  // it throws under NODE_ENV=production without API_DATABASE, so the default
  // must be in place before anything that imports the schema loads.
  process.env[apiDatabaseEnvKey] ??= "postgres";
  const {
    formatRootAccessOutcome,
    parseRootAccessArgs,
    setIdentityRootAccess,
  } = await import("./rootAccess");
  const { fingerprint } = parseRootAccessArgs(args);

  const { closeApiDatabase, db } = await import(
    "@tearleads/api-shared/postgres"
  );

  try {
    const result = await setIdentityRootAccess(db, { fingerprint, isRoot });
    console.log(formatRootAccessOutcome(fingerprint, isRoot, result));
  } finally {
    await closeApiDatabase();
  }
}

const command = process.argv[2];

if (isHelpArg(command)) {
  console.log(usage());
} else if (command === "blob-store:list-keys") {
  await listBlobStoreKeys(process.argv.slice(3));
} else if (command === "make-admin") {
  await setRootAccess(process.argv.slice(3), true);
} else if (command === "migrate") {
  await runMigrations();
} else if (command === "revoke-admin") {
  await setRootAccess(process.argv.slice(3), false);
} else {
  if (command) {
    console.error(`Unknown command: ${command}`);
  } else {
    console.error(usage());
  }
  process.exit(1);
}
