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
    if (!packages.has(selector)) {
      throw new Error(
        `Remove or update stale dependency override ${selector}; its parent is absent from bun.lock. Re-run the dependency audit.`,
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

test.each(["upgrade", "removal"])(
  "a parent %s requires explicit override maintenance",
  (change) => {
    const packages = {
      ...resolved,
      nested: change === "upgrade" ? ["@scope/parent@1.2.4"] : undefined,
    };
    expect(() =>
      assertOverrideParents(selectors, JSON.stringify({ packages })),
    ).toThrow("Remove or update stale dependency override @scope/parent@1.2.3");
  },
);
