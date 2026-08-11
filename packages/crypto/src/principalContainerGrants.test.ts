import { expect, test } from "bun:test";
import {
  computePrincipalContainerGrantRoot,
  normalizePrincipalContainerGrants,
} from "./principalContainerGrants";

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
