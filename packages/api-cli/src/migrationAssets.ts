const migrationPathSegment = "packages/api-shared/drizzle/";

export const migrationAssetPatterns = [
  "packages/api-shared/drizzle/**/*.sql",
  "packages/api-shared/drizzle/**/*.json",
] as const;

export function embeddedMigrationPath(name: string): string | undefined {
  const markerIndex = name.lastIndexOf(migrationPathSegment);
  if (markerIndex < 0) {
    return undefined;
  }

  return name.slice(markerIndex + migrationPathSegment.length);
}
