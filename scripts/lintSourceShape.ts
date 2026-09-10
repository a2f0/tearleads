import {
  type FileSizeBudget,
  parseSourceShapeBaseline,
  type SuppressionCounts,
  suppressionKinds,
} from "./checks/sourceShapeBaseline";
import { sourceShapeSnapshot } from "./checks/sourceShapeSnapshot";

const lineLimit = 500;
const byteLimit = 20_000;

const snapshot = sourceShapeSnapshot(process.argv.slice(2));
const baselineBuffer = snapshot.read("scripts/sourceShapeBaseline.json");
if (!baselineBuffer)
  throw new Error(
    "Missing scripts/sourceShapeBaseline.json in selected snapshot",
  );
const sourceShapeBaseline = parseSourceShapeBaseline(
  baselineBuffer.toString("utf8"),
);

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

function fileSizeViolations(): Violation[] {
  const files = snapshot.files;
  const scannedFiles = new Set(files);
  const violations = files.flatMap((filePath) => {
    const buffer = snapshot.read(filePath);
    if (!buffer) {
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

    if (buffer.includes(0)) {
      return [];
    }

    return findFileSizeViolations(filePath, fileSizeOf(buffer));
  });

  if (snapshot.full) {
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

    return extraCount !== 0
      ? [
          {
            detail:
              extraCount > 0
                ? `${kind} count is ${current[kind]} but baseline allows ${allowed[kind]}`
                : `${kind} allowance is stale: current count is ${current[kind]} but baseline allows ${allowed[kind]}; reduce or remove it`,
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

  const actualSpecifiers = new Set(starExportSpecifiers(source));
  return [
    ...[...actualSpecifiers].flatMap((specifier) =>
      approvedSpecifiers.has(specifier)
        ? []
        : [
            {
              detail: `unapproved export * from ${JSON.stringify(specifier)}`,
              filePath,
            },
          ],
    ),
    ...[...approvedSpecifiers]
      .filter((specifier) => !actualSpecifiers.has(specifier))
      .map((specifier) => ({
        filePath,
        detail: `approved star export ${JSON.stringify(specifier)} is stale; remove it`,
      })),
  ];
}

function sourceShapeViolations(): Violation[] {
  const files = snapshot.files;
  const scannedFiles = new Set(files);
  const violations = files.flatMap((filePath) => {
    const buffer = snapshot.read(filePath);
    if (!buffer) {
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

    const source = buffer.toString("utf8");
    return [
      ...findSuppressionViolations(filePath, source),
      ...findStarExportViolations(filePath, source),
    ];
  });

  if (snapshot.full) {
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

const violations: Violation[] = [];
for (const [baseline, applicable] of [
  [fileSizeBaseline, shouldCheckFileSize],
  [suppressionBaseline, shouldScan],
  [approvedStarExports, shouldScan],
] as const) {
  for (const filePath of Object.keys(baseline)) {
    if (!applicable(filePath)) {
      violations.push({
        filePath,
        detail:
          "baseline refers to an excluded file; remove the unused allowance",
      });
    }
  }
}
violations.push(...fileSizeViolations(), ...sourceShapeViolations());

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
