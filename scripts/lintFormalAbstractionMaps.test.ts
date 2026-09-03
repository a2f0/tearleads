import { expect, test } from "bun:test";
import {
  collectMappedTokens,
  declaredTlaNames,
  extractBacktickedTokens,
  isProductionSourcePath,
  lexTsSource,
  moduleDeclaresToken,
  verifyAbstractionMaps,
} from "./lintFormalAbstractionMaps";

const DOC_PATH = "formal/example/Example.md";
const MODULE_PATH = "formal/example/Example.tla";

function doc(rows: readonly string[]): {
  readonly content: string;
  readonly path: string;
} {
  return {
    content: [
      "# Example",
      "",
      "[`Example.tla`](./Example.tla) models the example.",
      "",
      "| Model action or predicate | Production implementation |",
      "| --- | --- |",
      ...rows,
      "",
    ].join("\n"),
    path: DOC_PATH,
  };
}

const cleanInput = {
  docs: [doc(["| `Serve` | `serveThings` |"])],
  expectedTables: { [DOC_PATH]: 1 },
  modulesByPath: new Map([[MODULE_PATH, "Serve == TRUE"]]),
  productionFiles: [
    {
      content: "export function serveThings() {}",
      path: "packages/a/src/a.ts",
    },
  ],
};

test("a synchronized map with a registered table passes", () => {
  expect(verifyAbstractionMaps(cleanInput)).toEqual([]);
});

test("model tokens are bound to the nearest documented module", () => {
  // `Serve` exists in another module, but not in the one this table documents.
  const problems = verifyAbstractionMaps({
    ...cleanInput,
    modulesByPath: new Map([
      [MODULE_PATH, "Other == TRUE"],
      ["formal/other/Other.tla", "Serve == TRUE"],
    ]),
  });
  expect(problems).toEqual([
    `${DOC_PATH}:7: \`Serve\` is not declared in ${MODULE_PATH}`,
  ]);
});

test("a table without a preceding module link fails to bind", () => {
  const unlinked = {
    content: [
      "| Model action or predicate | Production implementation |",
      "| --- | --- |",
      "| `Serve` | `serveThings` |",
    ].join("\n"),
    path: DOC_PATH,
  };
  expect(() => collectMappedTokens([unlinked])).toThrow(
    "no .tla link precedes",
  );
});

test("a dotted seam requires all segments together in one file", () => {
  const dotted = {
    ...cleanInput,
    docs: [doc(["| `Serve` | `SyncInput.validateThings` |"])],
  };
  expect(
    verifyAbstractionMaps({
      ...dotted,
      productionFiles: [
        {
          content: "interface SyncInput { validateThings: () => void }",
          path: "packages/a/src/a.ts",
        },
      ],
    }),
  ).toEqual([]);
  // Both names exist, but never in the same file: the qualified seam is gone.
  expect(
    verifyAbstractionMaps({
      ...dotted,
      productionFiles: [
        { content: "interface SyncInput {}", path: "packages/a/src/a.ts" },
        {
          content: "function validateThings() {}",
          path: "packages/a/src/b.ts",
        },
      ],
    }),
  ).toEqual([
    `${DOC_PATH}:7: \`SyncInput.validateThings\` not found together in any production package source file`,
  ]);
});

test("a vanished or unregistered table fails the registry", () => {
  const noTables = {
    ...cleanInput,
    docs: [{ content: "# Example\n\nprose only\n", path: DOC_PATH }],
  };
  expect(verifyAbstractionMaps(noTables)[0]).toContain(
    "expected 1 abstraction-map tables, found 0",
  );

  const unregistered = { ...cleanInput, expectedTables: {} };
  expect(verifyAbstractionMaps(unregistered)[0]).toContain(
    "not registered in scripts/lintFormalAbstractionMaps.ts",
  );
});

test("a missing documented module is reported", () => {
  const problems = verifyAbstractionMaps({
    ...cleanInput,
    modulesByPath: new Map(),
  });
  expect(problems).toEqual([
    `${DOC_PATH}:7: documented module ${MODULE_PATH} does not exist.`,
  ]);
});

test("unexpected token shapes fail loudly instead of passing unchecked", () => {
  expect(() => extractBacktickedTokens("`a b`")).toThrow(
    "unexpected abstraction-map token shape",
  );
  expect(extractBacktickedTokens("`alpha` and `Beta.gamma`")).toEqual([
    "alpha",
    "Beta.gamma",
  ]);
});

test("a row without a backticked production seam is prose-only and fails", () => {
  const problems = verifyAbstractionMaps({
    ...cleanInput,
    docs: [doc(["| `Serve` | described only in prose |"])],
    modulesByPath: new Map([[MODULE_PATH, "Serve == TRUE"]]),
  });
  expect(problems).toEqual([
    `${DOC_PATH}:7: abstraction-map row names no backticked production seam.`,
  ]);
});

test("test-support sources do not count as production seams", () => {
  expect(isProductionSourcePath("packages/api/src/documents/sync.ts")).toBe(
    true,
  );
  expect(isProductionSourcePath("packages/api/src/latestThing.ts")).toBe(true);
  expect(isProductionSourcePath("packages/api/src/sync.test.ts")).toBe(false);
  expect(
    isProductionSourcePath("packages/validators/src/openApiTestFixtures.ts"),
  ).toBe(false);
  expect(isProductionSourcePath("packages/api/src/testHelpers.ts")).toBe(false);
  expect(
    isProductionSourcePath(
      "packages/app/src/providers/sdk/test/organizationReadModelRealtimeHarness.ts",
    ),
  ).toBe(false);
  expect(isProductionSourcePath("packages/test-utils/src/factories.ts")).toBe(
    false,
  );
  expect(isProductionSourcePath("packages/bob-and-alice/src/scenario.ts")).toBe(
    false,
  );
});

test("model tokens must be declarations, not comment mentions", () => {
  expect(moduleDeclaresToken("Serve == TRUE", "Serve")).toBe(true);
  expect(moduleDeclaresToken("Older(id) ==\n  TRUE", "Older")).toBe(true);
  expect(
    moduleDeclaresToken(
      "VARIABLES phase,\n          nextPage\n\nInit == TRUE",
      "nextPage",
    ),
  ).toBe(true);
  expect(
    moduleDeclaresToken(
      "CONSTANTS Peers, MaxCounter\n\nInit == TRUE",
      "MaxCounter",
    ),
  ).toBe(true);
  // The old name survives only in commentary after a rename.
  expect(
    moduleDeclaresToken(
      "\\* Restart used to live here\nReboot == TRUE",
      "Restart",
    ),
  ).toBe(false);
  expect(
    moduleDeclaresToken(
      "(* Restart is documented (* nested *) here *)\nReboot == TRUE",
      "Restart",
    ),
  ).toBe(false);
  // A bare use inside another definition is not a declaration.
  expect(moduleDeclaresToken("Init == Restart", "Restart")).toBe(false);
});

test("a seam surviving only in comments or strings is not production code", () => {
  const problems = verifyAbstractionMaps({
    ...cleanInput,
    productionFiles: [
      {
        content:
          '// serveThings used to live here\nconst note = "serveThings";',
        path: "packages/a/src/a.ts",
      },
    ],
  });
  expect(problems).toEqual([
    `${DOC_PATH}:7: \`serveThings\` not found together in any production package source file`,
  ]);
  const lexed = lexTsSource(
    'code(); // serveThings\nconst a = "serveThings"; /* serveThings */',
  );
  expect(lexed.withoutCommentsAndStrings).not.toContain("serveThings");
  expect(lexed.withoutComments).toContain('"serveThings"');
});

test("snake_case wire tags match as quoted string contracts", () => {
  const tagged = {
    ...cleanInput,
    docs: [doc(["| `Serve` | `interest_state` |"])],
  };
  expect(
    verifyAbstractionMaps({
      ...tagged,
      productionFiles: [
        {
          content: 'z.literal("interest_state")',
          path: "packages/a/src/a.ts",
        },
      ],
    }),
  ).toEqual([]);
  // A bare unquoted mention is not the wire contract.
  expect(
    verifyAbstractionMaps({
      ...tagged,
      productionFiles: [
        { content: "const interest_state = 1;", path: "packages/a/src/a.ts" },
      ],
    }),
  ).toEqual([
    `${DOC_PATH}:7: \`interest_state\` not found together in any production package source file`,
  ]);
});

test("VARIABLES declarations consume only comma-continued lines", () => {
  expect(
    declaredTlaNames("VARIABLES phase,\n          nextPage\nInit == nextStep"),
  ).toEqual(["phase", "nextPage"]);
  // `nextStep` appears right after the declaration but is a use, not a name.
  expect(declaredTlaNames("VARIABLES phase\nInit == nextStep")).toEqual([
    "phase",
  ]);
  expect(
    moduleDeclaresToken("VARIABLES phase\nInit == nextStep", "nextStep"),
  ).toBe(false);
});

test("a wire tag quoted only in a comment is not the live contract", () => {
  const tagged = {
    ...cleanInput,
    docs: [doc(["| `Serve` | `interest_state` |"])],
  };
  expect(
    verifyAbstractionMaps({
      ...tagged,
      productionFiles: [
        {
          content: '// old type: "interest_state" removed in the scrub',
          path: "packages/a/src/a.ts",
        },
      ],
    }),
  ).toEqual([
    `${DOC_PATH}:7: \`interest_state\` not found together in any production package source file`,
  ]);
});

test("lowercase dotted seams are identifier segments, not wire tags", () => {
  const dotted = {
    ...cleanInput,
    docs: [doc(["| `Serve` | `client.sync` |"])],
  };
  // Both segments live in code (unquoted), which a wire-tag-only search
  // would have missed.
  expect(
    verifyAbstractionMaps({
      ...dotted,
      productionFiles: [
        {
          content: "const client = { sync() {} };",
          path: "packages/a/src/a.ts",
        },
      ],
    }),
  ).toEqual([]);
});

test("a model cell needs a token or an explicit boundary-assumption marker", () => {
  const prose = {
    ...cleanInput,
    docs: [doc(["| prose only | `serveThings` |"])],
  };
  expect(verifyAbstractionMaps(prose)).toEqual([
    `${DOC_PATH}:7: abstraction-map row names no backticked model token and is not marked "(boundary assumption)".`,
  ]);
  const exempted = {
    ...cleanInput,
    docs: [doc(["| prose only (boundary assumption) | `serveThings` |"])],
  };
  expect(verifyAbstractionMaps(exempted)).toEqual([]);
});
