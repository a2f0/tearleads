import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

interface SuppressionCounts {
  readonly biomeIgnore: number;
  readonly todo: number;
  readonly tsExpectError: number;
  readonly tsIgnore: number;
}

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

const suppressionBaseline = {
  "packages/app/src/components/shared/MiniAppLayout.tsx": { biomeIgnore: 1 },
  "packages/app/src/mini-apps/explorer/Explorer.tsx": { biomeIgnore: 1 },
  "packages/app/src/mini-apps/explorer/ExplorerTree.tsx": { biomeIgnore: 1 },
  "packages/app/src/mini-apps/explorer/detail/ExplorerDetailPanel.tsx": {
    biomeIgnore: 1,
  },
  "packages/app/src/mini-apps/explorer/hooks/useExplorerModel.ts": {
    biomeIgnore: 1,
  },
  "packages/app/src/mini-apps/explorer/hooks/useExplorerPanelState.ts": {
    biomeIgnore: 1,
  },
  "packages/app/src/mini-apps/org-manager/hooks/useOrgManagerModel.ts": {
    biomeIgnore: 1,
  },
  "packages/app/src/stores/org-manager/OrgManagerProvider.tsx": {
    biomeIgnore: 1,
  },
  "packages/client-sdk/src/data/documents/shared/responses.ts": { todo: 1 },
  "packages/client-sdk/src/workflows/containers/child/revoke.ts": {
    biomeIgnore: 1,
  },
  "packages/client-sdk/src/workflows/containers/child/share.ts": {
    biomeIgnore: 1,
  },
} satisfies Record<string, Partial<SuppressionCounts>>;

const approvedStarExports = {
  "packages/client-sdk/src/documents.ts": [
    "./data/blobContracts",
    "./data/documentSummary",
    "./data/documents/documentConstants",
    "./data/documents/documentContent",
  ],
  "packages/client-sdk/src/stores/container-contents/index.ts": [
    "./containerContentsStore",
    "./state",
    "./syncAgent",
    "./types",
  ],
  "packages/client-sdk/src/stores/documents/index.ts": [
    "./documentStore",
    "./types",
  ],
  "packages/crypto/src/keying.ts": ["./keying/index"],
  "packages/crypto/src/keying/index.ts": [
    "./accessEvent",
    "./canonical",
    "./checkpoints",
    "./containerAccess",
    "./containerKek",
    "./documentAccess",
    "./principalPolicy",
    "./transparency",
    "./types",
    "./writeHeader",
  ],
  "packages/loro/src/index.ts": ["./server", "./shared"],
} satisfies Record<string, readonly string[]>;

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
  /^\.gemini\//,
  /^\.serena\//,
  /^\.turbo\//,
  /^dist\//,
  /^build\//,
  /^node_modules\//,
  /^packages\/[^/]+\/\.turbo\//,
  /^packages\/[^/]+\/dist\//,
  /^packages\/[^/]+\/build\//,
  /^playwright-report\//,
  /^scripts\/lintSourceShape\.ts$/,
  /^test-results\//,
];

interface Violation {
  readonly detail: string;
  readonly filePath: string;
}

function runFileLimitCheck(args: readonly string[]): void {
  const result = spawnSync(
    "sh",
    ["scripts/checks/checkFileLimits.sh", ...args],
    {
      stdio: "inherit",
    },
  );

  if (result.error) {
    console.error("Failed to execute file limit check:", result.error);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
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
}

function filesChangedIn(args: readonly string[]): string[] {
  if (args.includes("--staged")) {
    return execFileSync(
      "git",
      ["diff", "--name-only", "--diff-filter=ACM", "--cached"],
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
      ["diff", "--name-only", "--diff-filter=ACM", range],
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
  return filesChangedIn(args).flatMap((filePath) => {
    if (!existsSync(filePath) || !shouldScan(filePath)) {
      return [];
    }

    const source = readFileSync(filePath, "utf8");
    return [
      ...findSuppressionViolations(filePath, source),
      ...findStarExportViolations(filePath, source),
    ];
  });
}

const args = process.argv.slice(2);

runFileLimitCheck(args);

const violations = sourceShapeViolations(args);

if (violations.length > 0) {
  console.error(
    "error source-shape: source-shape suppressions and barrel facades exceeded the approved baseline.",
  );
  for (const violation of violations) {
    console.error(`  ${violation.filePath}: ${violation.detail}`);
  }
  console.error(
    "Remove the new suppression/barrel, split the code, or update the baseline intentionally with reviewer context.",
  );
  process.exit(1);
}
