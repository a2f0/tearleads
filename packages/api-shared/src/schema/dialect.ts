export type ApiDatabaseKind = "memory" | "postgres" | "sqlite";

interface ApiDatabaseKindEnv {
  readonly API_DATABASE?: string | undefined;
  readonly NODE_ENV?: string | undefined;
  readonly [key: string]: string | undefined;
}

export function readApiDatabaseKind(
  env: ApiDatabaseKindEnv = process.env,
): ApiDatabaseKind {
  const configuredValue = env.API_DATABASE?.trim().toLowerCase();
  if (!configuredValue) {
    if (env.NODE_ENV?.trim() === "production") {
      throw new Error("API_DATABASE is required when NODE_ENV=production");
    }

    return "memory";
  }

  const value = configuredValue;
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
