export type ApiDatabaseKind = "memory" | "postgres" | "sqlite";

interface ApiDatabaseKindEnv {
  readonly API_DATABASE?: string | undefined;
  readonly [key: string]: string | undefined;
}

export function readApiDatabaseKind(
  env: ApiDatabaseKindEnv = process.env,
): ApiDatabaseKind {
  const value = env.API_DATABASE?.trim().toLowerCase() ?? "memory";
  if (value === "memory" || value === "pglite") {
    return "memory";
  }
  if (value === "postgres" || value === "sqlite") {
    return value;
  }

  throw new Error(`Unsupported API_DATABASE value: ${value}`);
}

export function isSqliteSchemaDialect(
  env: ApiDatabaseKindEnv = process.env,
): boolean {
  return readApiDatabaseKind(env) === "sqlite";
}
