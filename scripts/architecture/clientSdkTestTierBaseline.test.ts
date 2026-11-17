import { describe, expect, test } from "bun:test";

import {
  baselinedFilePatterns,
  clientSdkTestTierBaselinePath,
  findStaleTestTierBaselineEntries,
  findTestTierViolators,
} from "./clientSdkTestTierBaseline";

const sdk = "packages/client-sdk";
const rule = {
  name: "data-tests-load-only-data",
  from: { path: `^${sdk}/src/data/` },
  to: {
    path: [`^${sdk}/src/`, `^${sdk}/test/helpers/`],
    pathNot: [`^${sdk}/src/data/`, `^${sdk}/test/helpers/data/`],
  },
};
const runtime = ["local", "import"];
const typeOnly = ["local", "import", "type-only"];

const graph = {
  modules: [
    {
      source: `${sdk}/src/data/upward.test.ts`,
      dependencies: [
        { dependencyTypes: runtime, resolved: `${sdk}/src/data/store.ts` },
        {
          dependencyTypes: runtime,
          resolved: `${sdk}/test/helpers/workflows/documentSync.ts`,
        },
      ],
    },
    {
      source: `${sdk}/src/data/typeOnly.test.ts`,
      dependencies: [
        {
          dependencyTypes: typeOnly,
          resolved: `${sdk}/src/workflows/documents/index.ts`,
        },
        {
          dependencyTypes: runtime,
          resolved: `${sdk}/test/helpers/data/waitFor.ts`,
        },
      ],
    },
    {
      source: `${sdk}/src/workflows/sync.test.ts`,
      dependencies: [
        {
          dependencyTypes: runtime,
          resolved: `${sdk}/src/client/index.ts`,
        },
      ],
    },
  ],
};

describe("findTestTierViolators", () => {
  test("lists files with a runtime edge out of the tier, ignoring type-only edges", () => {
    expect(findTestTierViolators(graph, [rule])).toEqual({
      [rule.name]: [`${sdk}/src/data/upward.test.ts`],
    });
  });
});

describe("baselinedFilePatterns", () => {
  test("anchors and escapes each exempt file", () => {
    const patterns = baselinedFilePatterns(
      { [rule.name]: [`${sdk}/src/data/a.test.ts`] },
      rule.name,
    );
    expect(patterns).toEqual([`^packages/client-sdk/src/data/a\\.test\\.ts$`]);
    const pattern = new RegExp(patterns[0] ?? "");
    expect(pattern.test(`${sdk}/src/data/a.test.ts`)).toBe(true);
    expect(pattern.test(`${sdk}/src/data/aXtest.ts`)).toBe(false);
    expect(pattern.test(`${sdk}/src/data/a.test.tsx`)).toBe(false);
  });

  test("exempts nothing for a rule without entries", () => {
    expect(baselinedFilePatterns({}, rule.name)).toEqual([]);
  });
});

describe("findStaleTestTierBaselineEntries", () => {
  test("accepts entries that still violate", () => {
    expect(
      findStaleTestTierBaselineEntries(graph, [rule], {
        [rule.name]: [`${sdk}/src/data/upward.test.ts`],
      }),
    ).toEqual([]);
  });

  test("reports entries that no longer violate or no longer exist", () => {
    expect(
      findStaleTestTierBaselineEntries(graph, [rule], {
        [rule.name]: [
          `${sdk}/src/data/typeOnly.test.ts`,
          `${sdk}/src/data/moved.test.ts`,
        ],
      }),
    ).toEqual([
      `${sdk}/src/data/typeOnly.test.ts: no longer breaks ${rule.name}; delete it from ${clientSdkTestTierBaselinePath}`,
      `${sdk}/src/data/moved.test.ts: no longer exists; delete it from ${rule.name} in ${clientSdkTestTierBaselinePath}`,
    ]);
  });

  test("reports an entry that moved out of the rule's tier", () => {
    // The workflow test still has a runtime edge out of the data tier, but the
    // data rule no longer governs it, so its exemption must go.
    expect(
      findStaleTestTierBaselineEntries(graph, [rule], {
        [rule.name]: [`${sdk}/src/workflows/sync.test.ts`],
      }),
    ).toEqual([
      `${sdk}/src/workflows/sync.test.ts: no longer breaks ${rule.name}; delete it from ${clientSdkTestTierBaselinePath}`,
    ]);
  });

  test("reports a baseline key that names no rule", () => {
    expect(
      findStaleTestTierBaselineEntries(graph, [rule], {
        "retired-rule": [`${sdk}/src/data/upward.test.ts`],
      }),
    ).toEqual([
      `retired-rule: no such rule; delete it from ${clientSdkTestTierBaselinePath}`,
    ]);
  });
});
