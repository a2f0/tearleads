import { expect, test } from "bun:test";
import { overrides } from "../../../package.json";

function assertOverrideParents(selectors: readonly string[], source: string) {
  const lockfile: unknown = Bun.JSONC.parse(source);
  if (
    typeof lockfile !== "object" ||
    lockfile === null ||
    !("packages" in lockfile) ||
    typeof lockfile.packages !== "object" ||
    lockfile.packages === null
  ) {
    throw new Error("bun.lock: missing resolved packages");
  }
  const packages = new Set(
    Object.values(lockfile.packages).map((entry: unknown) => {
      if (!Array.isArray(entry) || typeof entry[0] !== "string") {
        throw new Error("bun.lock: invalid resolved package entry");
      }
      return entry[0];
    }),
  );
  for (const selector of selectors) {
    // Only exact version-scoped overrides become stale on a parent upgrade.
    if (!/@\d+\.\d+\.\d+(?:[-+][\w.+-]+)?$/.test(selector)) continue;
    const parent = selector.slice(0, selector.lastIndexOf("@"));
    const identities = [...packages].filter((entry) =>
      entry.startsWith(`${parent}@`),
    );
    if (identities.length !== 1 || identities[0] !== selector) {
      const reason =
        identities.length === 0
          ? "the parent is absent"
          : identities.includes(selector)
            ? "an additional parent version is present"
            : "the parent version changed";
      throw new Error(
        `Remove or update stale dependency override ${selector}; ${reason} in bun.lock. Re-run the dependency audit.`,
      );
    }
  }
}

test("temporary overrides still match resolved parent versions", async () => {
  const source = await Bun.file(
    new URL("../../../bun.lock", import.meta.url),
  ).text();
  assertOverrideParents(Object.keys(overrides), source);
});

const selectors = ["@scope/parent@1.2.3", "parent@2.0.0-alpha"];
const resolved = {
  nested: [selectors[0]],
  parent: [selectors[1]],
};

test("parent matching uses resolved identities, including nested packages", () => {
  assertOverrideParents(selectors, JSON.stringify({ packages: resolved }));
});

test.each([
  ["upgrade", "the parent version changed"],
  ["removal", "the parent is absent"],
])("a parent %s requires explicit override maintenance", (change, reason) => {
  const packages = {
    ...resolved,
    nested: change === "upgrade" ? ["@scope/parent@1.2.4"] : undefined,
  };
  expect(() =>
    assertOverrideParents(selectors, JSON.stringify({ packages })),
  ).toThrow(reason);
});

test("an additional parent version requires a new compatibility review", () => {
  const packages = { ...resolved, additional: ["@scope/parent@1.2.4"] };
  expect(() =>
    assertOverrideParents(selectors, JSON.stringify({ packages })),
  ).toThrow("an additional parent version is present");
});
