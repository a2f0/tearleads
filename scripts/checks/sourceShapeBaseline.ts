export interface FileSizeBudget {
  readonly bytes: number;
  readonly lines: number;
}

export const suppressionKinds = [
  "biomeIgnore",
  "todo",
  "tsExpectError",
  "tsIgnore",
] as const;

export type SuppressionCounts = Record<
  (typeof suppressionKinds)[number],
  number
>;

export interface SourceShapeBaseline {
  readonly fileSizes: Readonly<Record<string, FileSizeBudget>>;
  readonly suppressions: Readonly<Record<string, Partial<SuppressionCounts>>>;
  readonly approvedStarExports: Readonly<Record<string, readonly string[]>>;
}

function record(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${context}: expected an object`);
  }
  return value as Record<string, unknown>;
}

function keys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  context: string,
) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new Error(`${context}: unknown field ${key}`);
    }
  }
}

function count(value: unknown, context: string, minimum = 0): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum
  ) {
    throw new Error(`${context}: expected an integer >= ${minimum}`);
  }
  return value;
}

function entries(value: unknown, context: string) {
  return Object.entries(record(value, context)).map(([path, entry]) => {
    if (
      !path ||
      path.includes("\\") ||
      path.includes("\0") ||
      path.split("/").some((part) => !part || part === "." || part === "..")
    ) {
      throw new Error(
        `${context}: expected a repository-relative file path: ${path}`,
      );
    }
    return [path, entry] as const;
  });
}

function fileSize(value: unknown, context: string): FileSizeBudget {
  const budget = record(value, context);
  keys(budget, ["lines", "bytes"], context);
  const { lines, bytes } = budget;
  return { lines: count(lines, context), bytes: count(bytes, context) };
}

function suppressions(
  value: unknown,
  context: string,
): Partial<SuppressionCounts> {
  const allowances = record(value, context);
  keys(allowances, suppressionKinds, context);
  if (Object.keys(allowances).length === 0) {
    throw new Error(`${context}: remove empty suppression allowances`);
  }
  return Object.fromEntries(
    Object.entries(allowances).map(([kind, value]) => [
      kind,
      count(value, `${context}.${kind}`, 1),
    ]),
  );
}

function starExports(value: unknown, context: string): readonly string[] {
  const items: unknown[] = Array.isArray(value) ? value : [];
  if (
    items.length === 0 ||
    !items.every(
      (item): item is string => typeof item === "string" && item.length > 0,
    ) ||
    new Set(items).size !== items.length
  ) {
    throw new Error(
      `${context}: expected a nonempty array of distinct export specifiers`,
    );
  }
  return items;
}

export function parseSourceShapeBaseline(source: string): SourceShapeBaseline {
  const baseline = record(JSON.parse(source), "source-shape baseline");
  keys(
    baseline,
    ["fileSizes", "suppressions", "approvedStarExports"],
    "source-shape baseline",
  );
  const {
    fileSizes: sizeEntries,
    suppressions: suppressionEntries,
    approvedStarExports: exportEntries,
  } = baseline;
  return {
    fileSizes: Object.fromEntries(
      entries(sizeEntries, "fileSizes").map(([path, value]) => [
        path,
        fileSize(value, `fileSizes.${path}`),
      ]),
    ),
    suppressions: Object.fromEntries(
      entries(suppressionEntries, "suppressions").map(([path, value]) => [
        path,
        suppressions(value, `suppressions.${path}`),
      ]),
    ),
    approvedStarExports: Object.fromEntries(
      entries(exportEntries, "approvedStarExports").map(([path, value]) => [
        path,
        starExports(value, `approvedStarExports.${path}`),
      ]),
    ),
  };
}
