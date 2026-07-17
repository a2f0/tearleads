import { expect, test } from "bun:test";
import { planContainerMutationBatchLocks } from "./mutationBatchLocks";

test("container mutation batch lock planning is unique and deterministic", () => {
  expect(
    planContainerMutationBatchLocks({
      groupIds: ["group-b", "group-a", "group-b"],
      organizationIds: ["org-c", "org-a", "org-b", "org-a"],
    }),
  ).toEqual({
    groupIds: ["group-a", "group-b"],
    organizationIds: ["org-a", "org-b", "org-c"],
  });
});
