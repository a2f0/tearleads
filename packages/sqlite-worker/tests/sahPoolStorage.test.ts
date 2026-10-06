import { expect, test } from "bun:test";
import { persistentSahPoolStorageForDbName } from "../src/sahPoolStorage";

test("SAHPool storage names preserve existing normalization", () => {
  const cases = [
    ["", "default"],
    [" //// ", "default"],
    ["___", "default"],
    ["__..__", "default"],
    ["__a.b__", "a.b"],
    ["__a_b__", "a_b"],
    [" /a//b 🦭 c/ ", "a_b_c"],
    ["__a-_b__", "a-_b"],
  ] as const;
  for (const [input, segment] of cases) {
    expect(persistentSahPoolStorageForDbName(input)).toEqual({
      directory: `/tearleads-sqlite/${segment}`,
      vfsName: `tearleads-opfs-sahpool-${segment}`,
    });
  }
});

test("SAHPool storage names preserve long internal underscore runs", () => {
  const segment = `a${"_".repeat(100_000)}b`;
  expect(persistentSahPoolStorageForDbName(`__${segment}__`)).toEqual({
    directory: `/tearleads-sqlite/${segment}`,
    vfsName: `tearleads-opfs-sahpool-${segment}`,
  });
}, 1_000);

test("persistent SAHPool storage is stable and database-scoped", () => {
  expect(persistentSahPoolStorageForDbName("/app-identity-abcd.db")).toEqual({
    directory: "/tearleads-sqlite/app-identity-abcd.db",
    vfsName: "tearleads-opfs-sahpool-app-identity-abcd.db",
  });
  expect(persistentSahPoolStorageForDbName("/other/identity.db")).toEqual({
    directory: "/tearleads-sqlite/other_identity.db",
    vfsName: "tearleads-opfs-sahpool-other_identity.db",
  });
  expect(persistentSahPoolStorageForDbName(".")).toEqual({
    directory: "/tearleads-sqlite/default",
    vfsName: "tearleads-opfs-sahpool-default",
  });
  expect(persistentSahPoolStorageForDbName("..")).toEqual({
    directory: "/tearleads-sqlite/default",
    vfsName: "tearleads-opfs-sahpool-default",
  });
});
