import { expect, test } from "bun:test";
import { normalizeContainerDirectGrant } from "./containerAccessState";

// P18 (#2903): the organization directory keeps its key across writes, and a
// rotation back to an old key is accepted, only because nothing encrypts to
// an organization principal's key. A container grant naming an organization
// would change that; restore rotation-on-write or a no-reuse rule first.
test("a container grant cannot name an organization principal", () => {
  for (const subjectType of ["group", "user"] as const)
    expect(
      normalizeContainerDirectGrant({
        accessLevel: "read",
        subjectId: crypto.randomUUID(),
        subjectType,
      }).subjectType,
    ).toBe(subjectType);
  expect(() =>
    normalizeContainerDirectGrant({
      accessLevel: "read",
      subjectId: crypto.randomUUID(),
      subjectType: "organization",
    }),
  ).toThrow("container direct grant.subjectType is unsupported");
});
