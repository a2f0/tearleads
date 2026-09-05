import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

interface FileSizeBudget {
  readonly bytes: number;
  readonly lines: number;
}

interface SuppressionCounts {
  readonly biomeIgnore: number;
  readonly todo: number;
  readonly tsExpectError: number;
  readonly tsIgnore: number;
}

interface SourceShapeBaseline {
  readonly approvedStarExports: Record<string, readonly string[]>;
  readonly fileSizes: Record<string, FileSizeBudget>;
  readonly suppressions: Record<string, Partial<SuppressionCounts>>;
}

const lineLimit = 500;
const byteLimit = 20_000;

const sourceShapeBaseline = JSON.parse(
  readFileSync("scripts/sourceShapeBaseline.json", "utf8"),
) as SourceShapeBaseline;

const suppressionKinds = [
  "biomeIgnore",
  "todo",
  "tsExpectError",
  "tsIgnore",
] as const satisfies readonly (keyof SuppressionCounts)[];

const zeroSuppressions: SuppressionCounts = {
  biomeIgnore: 0,
  todo: 0,
  tsExpectError: 0,
  tsIgnore: 0,
};

const suppressionBaseline = sourceShapeBaseline.suppressions;
const approvedStarExports = sourceShapeBaseline.approvedStarExports;
const fileSizeBaseline = sourceShapeBaseline.fileSizes;

const scanExtensions = new Set([
  ".astro",
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsonc",
  ".jsx",
  ".md",
  ".mjs",
  ".sh",
  ".ts",
  ".tsx",
]);

const ignoredPathPatterns = [
  /^bun\.lock$/,
  /^\.codex\//,
  /^\.serena\//,
  /^\.turbo\//,
  /^dist\//,
  /^build\//,
  /^node_modules\//,
  /^pkg\//,
  /^packages\/[^/]+\/\.turbo\//,
  /^packages\/[^/]+\/dist\//,
  /^packages\/[^/]+\/build\//,
  /^packages\/[^/]+\/pkg\//,
  /^packages\/[^/]+\/test-results\//,
  /^packages\/api-shared\/drizzle\/[^/]+\.sql$/,
  /^packages\/api-shared\/drizzle\/meta\/[^/]+\.json$/,
  /^packages\/api-shared\/drizzle-sqlite\/[^/]+\.sql$/,
  /^packages\/api-shared\/drizzle-sqlite\/meta\/[^/]+\.json$/,
  /^packages\/website\/\.astro\//,
  /^playwright-report\//,
  /^scripts\/lintSourceShape\.ts$/,
  /^scripts\/sourceShapeBaseline\.json$/,
  /^test-results\//,
  /\.min\.js$/,
  /\.map$/,
];

interface Violation {
  readonly detail: string;
  readonly filePath: string;
}

function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .split("\n")
    .filter((path) => path.length > 0)
    .sort();
}

function parseRange(args: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--range") {
      return args[index + 1];
    }

    if (arg?.startsWith("--range=")) {
      return arg.slice("--range=".length);
    }
  }

  return undefined;
}

function filesChangedIn(args: readonly string[]): string[] {
  if (args.includes("--staged")) {
    return execFileSync(
      "git",
      ["diff", "--name-only", "--diff-filter=ACMRD", "--cached"],
      { encoding: "utf8" },
    )
      .split("\n")
      .filter((path) => path.length > 0)
      .sort();
  }

  const range = parseRange(args);

  if (range) {
    return execFileSync(
      "git",
      ["diff", "--name-only", "--diff-filter=ACMRD", range],
      { encoding: "utf8" },
    )
      .split("\n")
      .filter((path) => path.length > 0)
      .sort();
  }

  return trackedFiles();
}

function extensionOf(filePath: string): string {
  const match = /\.[^.]+$/.exec(filePath);
  return match?.[0] ?? "";
}

function shouldScan(filePath: string): boolean {
  return (
    scanExtensions.has(extensionOf(filePath)) &&
    !ignoredPathPatterns.some((pattern) => pattern.test(filePath))
  );
}

function shouldCheckFileSize(filePath: string): boolean {
  return !ignoredPathPatterns.some((pattern) => pattern.test(filePath));
}

function countMatches(source: string, pattern: RegExp): number {
  if (!pattern.global) {
    throw new Error(
      `RegExp pattern must have the global ('g') flag set: ${pattern.source}`,
    );
  }

  let count = 0;
  pattern.lastIndex = 0;

  while (pattern.exec(source)) {
    count += 1;
  }

  return count;
}

function fileSizeOf(buffer: Buffer): FileSizeBudget {
  return {
    bytes: buffer.byteLength,
    lines: countMatches(buffer.toString("utf8"), /\n/g),
  };
}

function isOverDefaultBudget(size: FileSizeBudget): boolean {
  return size.lines > lineLimit || size.bytes > byteLimit;
}

function isOverBudget(size: FileSizeBudget, budget: FileSizeBudget): boolean {
  return size.lines > budget.lines || size.bytes > budget.bytes;
}

function formatFileSize(size: FileSizeBudget): string {
  return `${size.lines} lines/${size.bytes} bytes`;
}

function findFileSizeViolations(
  filePath: string,
  size: FileSizeBudget,
): Violation[] {
  const baselineBudget = fileSizeBaseline[filePath];

  if (baselineBudget) {
    if (!isOverDefaultBudget(size)) {
      return [
        {
          detail: `file size baseline is no longer needed; current size is ${formatFileSize(size)} under the default ${lineLimit} lines/${byteLimit} bytes budget`,
          filePath,
        },
      ];
    }

    return isOverBudget(size, baselineBudget)
      ? [
          {
            detail: `file size is ${formatFileSize(size)} but baseline allows ${formatFileSize(baselineBudget)}`,
            filePath,
          },
        ]
      : [];
  }

  return isOverDefaultBudget(size)
    ? [
        {
          detail: `file size is ${formatFileSize(size)} but default budget allows ${lineLimit} lines/${byteLimit} bytes`,
          filePath,
        },
      ]
    : [];
}

function sourceShapeFiles(args: readonly string[]): string[] {
  return filesChangedIn(args);
}

function isFullSourceShapeScan(args: readonly string[]): boolean {
  return args.length === 0 || args.includes("--all");
}

function fileSizeViolations(args: readonly string[]): Violation[] {
  const files = sourceShapeFiles(args);
  const scannedFiles = new Set(files);
  const violations = files.flatMap((filePath) => {
    if (!existsSync(filePath)) {
      return fileSizeBaseline[filePath]
        ? [
            {
              detail: "file size baseline refers to a missing file; remove it",
              filePath,
            },
          ]
        : [];
    }

    if (!shouldCheckFileSize(filePath)) {
      return [];
    }

    const buffer = readFileSync(filePath);

    if (buffer.includes(0)) {
      return [];
    }

    return findFileSizeViolations(filePath, fileSizeOf(buffer));
  });

  if (isFullSourceShapeScan(args)) {
    for (const filePath of Object.keys(fileSizeBaseline)) {
      if (!scannedFiles.has(filePath)) {
        violations.push({
          detail:
            "file size baseline refers to a file that is no longer tracked; remove it",
          filePath,
        });
      }
    }
  }

  return violations;
}

function suppressionCounts(source: string): SuppressionCounts {
  return {
    biomeIgnore: countMatches(source, /(?:\/\/|\/\*)\s*biome-ignore\b/g),
    todo: countMatches(source, /(?:\/\/|#|\/\*)[^\n]*\bTODO\b/g),
    tsExpectError: countMatches(source, /(?:\/\/|\/\*)\s*@ts-expect-error\b/g),
    tsIgnore: countMatches(source, /(?:\/\/|\/\*)\s*@ts-ignore\b/g),
  };
}

function findSuppressionViolations(
  filePath: string,
  source: string,
): Violation[] {
  const current = suppressionCounts(source);
  const allowed = {
    ...zeroSuppressions,
    ...suppressionBaseline[filePath as keyof typeof suppressionBaseline],
  };

  return suppressionKinds.flatMap((kind) => {
    const extraCount = current[kind] - allowed[kind];

    return extraCount > 0
      ? [
          {
            detail: `${kind} count is ${current[kind]} but baseline allows ${allowed[kind]}`,
            filePath,
          },
        ]
      : [];
  });
}

function starExportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const starExportPattern =
    /^\s*export\s+(?:type\s+)?\*\s+(?:as\s+\w+\s+)?from\s+["']([^"']+)["']/gm;
  let match = starExportPattern.exec(source);

  while (match) {
    const [, specifier] = match;
    if (specifier) {
      specifiers.push(specifier);
    }
    match = starExportPattern.exec(source);
  }

  return specifiers;
}

function findStarExportViolations(
  filePath: string,
  source: string,
): Violation[] {
  const approvedSpecifiers = new Set(
    approvedStarExports[filePath as keyof typeof approvedStarExports] ?? [],
  );

  return starExportSpecifiers(source).flatMap((specifier) =>
    approvedSpecifiers.has(specifier)
      ? []
      : [
          {
            detail: `unapproved export * from ${JSON.stringify(specifier)}`,
            filePath,
          },
        ],
  );
}

function sourceShapeViolations(args: readonly string[]): Violation[] {
  const files = sourceShapeFiles(args);
  const scannedFiles = new Set(files);
  const violations = files.flatMap((filePath) => {
    if (!existsSync(filePath)) {
      const missingBaselineViolations: Violation[] = [];

      if (filePath in suppressionBaseline) {
        missingBaselineViolations.push({
          detail: "suppression baseline refers to a missing file; remove it",
          filePath,
        });
      }

      if (filePath in approvedStarExports) {
        missingBaselineViolations.push({
          detail:
            "approved star exports baseline refers to a missing file; remove it",
          filePath,
        });
      }

      return missingBaselineViolations;
    }

    if (!shouldScan(filePath)) {
      return [];
    }

    const source = readFileSync(filePath, "utf8");
    return [
      ...findSuppressionViolations(filePath, source),
      ...findStarExportViolations(filePath, source),
    ];
  });

  if (isFullSourceShapeScan(args)) {
    for (const filePath of Object.keys(suppressionBaseline)) {
      if (!scannedFiles.has(filePath)) {
        violations.push({
          detail:
            "suppression baseline refers to a file that is no longer tracked; remove it",
          filePath,
        });
      }
    }

    for (const filePath of Object.keys(approvedStarExports)) {
      if (!scannedFiles.has(filePath)) {
        violations.push({
          detail:
            "approved star exports baseline refers to a file that is no longer tracked; remove it",
          filePath,
        });
      }
    }
  }

  return violations;
}

const args = process.argv.slice(2);
const supportedArgs =
  args.length === 0 ||
  (args.length === 1 && args[0] === "--staged") ||
  (args.length === 2 && args[0] === "--range" && Boolean(args[1])) ||
  (args.length === 1 &&
    Boolean(args[0]?.startsWith("--range=") && args[0].slice(8)));
if (!supportedArgs) {
  throw new Error(
    "Usage: lintSourceShape.ts [--staged | --range <base>..<head>]",
  );
}

const violations = [
  ...fileSizeViolations(args),
  ...sourceShapeViolations(args),
];

if (violations.length > 0) {
  console.error(
    "error source-shape: source-shape budgets, suppressions, or barrel facades exceeded the approved baseline.",
  );
  for (const violation of violations) {
    console.error(`  ${violation.filePath}: ${violation.detail}`);
  }
  console.error(
    "Remove the new suppression/barrel, split the code, or update the baseline intentionally with reviewer context.",
  );
  process.exit(1);
}
