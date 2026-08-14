export type ApiMigrationDialect = "postgres" | "sqlite";

const migrationPathSegments: Record<ApiMigrationDialect, string> = {
  postgres: "packages/api-shared/drizzle/",
  sqlite: "packages/api-shared/drizzle-sqlite/",
};

export const migrationAssetPatterns = [
  "packages/api-shared/drizzle/**/*.sql",
  "packages/api-shared/drizzle/**/*.json",
  "packages/api-shared/drizzle-sqlite/**/*.sql",
  "packages/api-shared/drizzle-sqlite/**/*.json",
] as const;

export function migrationDialectForDatabase(
  database: string | undefined,
): ApiMigrationDialect {
  const kind = database?.trim().toLowerCase();
  return kind === "sqlite" || kind === "turso" ? "sqlite" : "postgres";
}

export function embeddedMigrationPath(
  name: string,
  dialect: ApiMigrationDialect,
): string | undefined {
  const pathSegment = migrationPathSegments[dialect];
  const markerIndex = name.lastIndexOf(pathSegment);
  if (markerIndex < 0) {
    return undefined;
  }

  return name.slice(markerIndex + pathSegment.length);
}
