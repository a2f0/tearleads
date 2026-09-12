import { expect, spyOn, test } from "bun:test";
import {
  computePrincipalContainerGrantRoot,
  normalizePrincipalContainerGrants,
} from "./principalContainerGrants";

test("grant roots are identical under Danish and English device collations", async () => {
  const grants = [
    {
      accessLevel: "read" as const,
      containerId: "ab0e8f7c-1111-4111-8111-111111111111",
    },
    {
      accessLevel: "write" as const,
      containerId: "aa1e8f7c-1111-4111-8111-111111111111",
    },
  ] as const;
  const expectedRoot = await computePrincipalContainerGrantRoot(grants);
  const danish = new Intl.Collator("da");
  expect(
    danish.compare(grants[0].containerId, grants[1].containerId),
  ).toBeLessThan(0);
  const comparison = spyOn(
    String.prototype,
    "localeCompare",
  ).mockImplementation(function (this: string, other: string) {
    return danish.compare(this, other);
  });
  try {
    expect(await computePrincipalContainerGrantRoot(grants)).toBe(expectedRoot);
    expect(normalizePrincipalContainerGrants(grants)).toEqual(
      [...grants].reverse(),
    );
  } finally {
    comparison.mockRestore();
  }
});

test("principal container grants normalize to a stable canonical order", async () => {
  const left = [
    { accessLevel: "read" as const, containerId: "container-b" },
    { accessLevel: "admin" as const, containerId: "container-a" },
  ];
  const right = [...left].reverse();

  expect(normalizePrincipalContainerGrants(left)).toEqual([
    { accessLevel: "admin", containerId: "container-a" },
    { accessLevel: "read", containerId: "container-b" },
  ]);
  expect(await computePrincipalContainerGrantRoot(left)).toBe(
    await computePrincipalContainerGrantRoot(right),
  );
});

test("principal container grants reject duplicate container ids", () => {
  expect(() =>
    normalizePrincipalContainerGrants([
      { accessLevel: "read", containerId: "container-a" },
      { accessLevel: "write", containerId: "container-a" },
    ]),
  ).toThrow("Principal cannot contain duplicate container grants");
});

test("principal container grants reject invalid entries", () => {
  expect(() =>
    normalizePrincipalContainerGrants([
      { accessLevel: "read", containerId: "" },
    ]),
  ).toThrow("Principal container grant is invalid");
});
