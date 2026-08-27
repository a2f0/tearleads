import { expect, test } from "bun:test";
import { derivePrincipalMutationLockKeys } from "../../principals/principalMutationLock";
import { deriveDocumentLifecycleLockKeys } from "./documentLifecycleLock";

test("document lifecycle locks hash the domain and complete id", async () => {
  const first = "11111111-1111-4111-8111-222222222222";
  const sameOuterBits = "11111111-aaaa-4aaa-8aaa-222222222222";
  const documentKeys = await deriveDocumentLifecycleLockKeys(first);

  expect(documentKeys).toEqual(
    await deriveDocumentLifecycleLockKeys(first.toUpperCase()),
  );
  expect(documentKeys).not.toEqual(
    await deriveDocumentLifecycleLockKeys(sameOuterBits),
  );
  expect(documentKeys).not.toEqual(
    await derivePrincipalMutationLockKeys("group", first),
  );
});
