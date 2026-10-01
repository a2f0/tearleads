import { expect, test } from "bun:test";
import { assertGrantRemovalRotatesKey } from "./grantShrinkRotation";

const read = { accessLevel: "read" as const, containerId: "container-a" };
const write = { accessLevel: "write" as const, containerId: "container-a" };
const other = { accessLevel: "read" as const, containerId: "container-b" };

test("honest same-epoch grant changes keep the granted containers", () => {
  for (const nextGrants of [[write], [read, other]]) {
    expect(() =>
      assertGrantRemovalRotatesKey({
        nextGrants,
        nextKeyEpoch: 2,
        previousGrants: [read],
        previousKeyEpoch: 2,
      }),
    ).not.toThrow();
  }
});

test("a first policy or a rotated key may drop any grant", () => {
  expect(() =>
    assertGrantRemovalRotatesKey({
      nextGrants: [],
      nextKeyEpoch: 1,
      previousGrants: [],
      previousKeyEpoch: null,
    }),
  ).not.toThrow();
  expect(() =>
    assertGrantRemovalRotatesKey({
      nextGrants: [],
      nextKeyEpoch: 3,
      previousGrants: [read],
      previousKeyEpoch: 2,
    }),
  ).not.toThrow();
});

test("a same-epoch policy that drops a container is refused", () => {
  expect(() =>
    assertGrantRemovalRotatesKey({
      nextGrants: [other],
      nextKeyEpoch: 2,
      previousGrants: [read, other],
      previousKeyEpoch: 2,
    }),
  ).toThrow(
    "A group policy that removes a container grant must rotate the group key",
  );
});
