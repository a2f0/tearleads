import { expect, test } from "bun:test";
import { derivePrincipalMutationLockKeys } from "./principalMutationLock";

test("principal mutation locks hash the domain and complete canonical UUID", async () => {
  const first = "11111111-1111-4111-8111-222222222222";
  const sameOuterBits = "11111111-aaaa-4aaa-8aaa-222222222222";
  const groupKeys = await derivePrincipalMutationLockKeys("group", first);

  expect(groupKeys).toEqual(
    await derivePrincipalMutationLockKeys("group", first.toUpperCase()),
  );
  expect(groupKeys).not.toEqual(
    await derivePrincipalMutationLockKeys("group", sameOuterBits),
  );
  expect(groupKeys).not.toEqual(
    await derivePrincipalMutationLockKeys("organization", first),
  );
});
