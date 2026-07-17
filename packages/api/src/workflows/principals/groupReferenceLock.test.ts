import { expect, test } from "bun:test";
import {
  deriveGroupReferenceLockKeys,
  sortGroupReferenceIds,
} from "./groupReferenceLock";
import { derivePrincipalMutationLockKeys } from "./principalMutationLock";

test("group reference locks use a distinct full-UUID domain", async () => {
  const first = "11111111-1111-4111-8111-222222222222";
  const sameOuterBits = "11111111-aaaa-4aaa-8aaa-222222222222";
  const referenceKeys = await deriveGroupReferenceLockKeys(first);

  expect(referenceKeys).toEqual(
    await deriveGroupReferenceLockKeys(first.toUpperCase()),
  );
  expect(referenceKeys).not.toEqual(
    await deriveGroupReferenceLockKeys(sameOuterBits),
  );
  expect(referenceKeys).not.toEqual(
    await derivePrincipalMutationLockKeys("group", first),
  );
});

test("group reference lock plans are unique and UUID-sorted", () => {
  const lower = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const upper = "22222222-2222-4222-8222-222222222222";

  expect(sortGroupReferenceIds([upper, lower, upper])).toEqual([upper, lower]);
});
