import { expect, test } from "bun:test";
import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import type {
  VerifiedContainerAccessManifest,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import {
  loadPrincipalPoliciesForAccessPaths,
  principalPolicyCacheKey,
  principalPolicyReferenceCacheKey,
} from "./principalPolicies";
import type { PrincipalPolicyReferenceCache } from "./types";

function createManifestReference(
  overrides: Partial<
    VerifiedContainerAccessManifest["state"]["referencedPrincipalHeads"][number]
  > = {},
): VerifiedContainerAccessManifest["state"]["referencedPrincipalHeads"][number] {
  return {
    principalType: "group",
    principalId: "group-1",
    version: 1,
    keyEpoch: 1,
    stateHash: "state-hash",
    keyFingerprint: "key-fingerprint",
    ...overrides,
  };
}

function createPolicy(
  overrides: Partial<VerifiedPrincipalPolicy> = {},
): VerifiedPrincipalPolicy {
  return {
    principalType: "group",
    principalId: "group-1",
    version: 1,
    keyEpoch: 1,
    stateHash: "state-hash",
    state: {
      keyFingerprint: "key-fingerprint",
    },
    ...overrides,
  } as VerifiedPrincipalPolicy;
}

test("principal policy cache keys distinguish missing referenced policies", () => {
  const reference = createManifestReference();
  const manifest = {
    state: {
      referencedPrincipalHeads: [reference],
    },
  } as VerifiedContainerAccessManifest;

  expect(
    principalPolicyCacheKey({
      manifest,
      principalPolicies: [createPolicy()],
    }),
  ).toBe("group:group-1:1:1:state-hash:key-fingerprint");

  expect(
    principalPolicyCacheKey({
      manifest,
      principalPolicies: [
        createPolicy({
          stateHash: "different-state-hash",
        }),
      ],
    }),
  ).toBe("missing:group:group-1:1:1:state-hash:key-fingerprint");
});

test("principal policy cache keys match historical referenced policy heads", () => {
  const reference = createManifestReference({
    stateHash: "state-hash-1",
  });
  const manifest = {
    state: {
      referencedPrincipalHeads: [reference],
    },
  } as VerifiedContainerAccessManifest;

  expect(
    principalPolicyCacheKey({
      manifest,
      principalPolicies: [
        createPolicy({
          version: 2,
          stateHash: "state-hash-2",
          history: [
            {
              state: {
                principalType: "group",
                principalId: "group-1",
                version: 1,
                keyEpoch: 1,
                stateHash: "state-hash-1",
                keyFingerprint: "key-fingerprint",
              } as VerifiedPrincipalPolicy["state"],
              projection: [],
              grants: [],
            },
          ],
        }),
      ],
    }),
  ).toBe("group:group-1:1:1:state-hash-1:key-fingerprint");
});

/** Any read fails with this executor, so a test sees whether one was tried. */
const failingExecutor = {
  select: () => {
    throw new Error("own load");
  },
} as unknown as DatabaseSession;

function pathCiting(
  reference: VerifiedContainerAccessManifest["state"]["referencedPrincipalHeads"][number],
): VerifiedContainerAccessManifest[] {
  return [
    { state: { referencedPrincipalHeads: [reference] } },
  ] as VerifiedContainerAccessManifest[];
}

test("a request policy cache lends a loaded reference without a read", async () => {
  const reference = createManifestReference();
  const policy = createPolicy();
  const cache: PrincipalPolicyReferenceCache = new Map([
    [principalPolicyReferenceCacheKey(reference), Promise.resolve(policy)],
  ]);

  await expect(
    loadPrincipalPoliciesForAccessPaths(
      failingExecutor,
      [pathCiting(reference)],
      [],
      cache,
    ),
  ).resolves.toEqual([policy]);
});

test("a borrower loads a reference itself when the lending load failed", async () => {
  const reference = createManifestReference();
  const lent = Promise.reject(new Error("another lane's load"));
  lent.catch(() => undefined);
  const cache: PrincipalPolicyReferenceCache = new Map([
    [principalPolicyReferenceCacheKey(reference), lent],
  ]);

  // The caller fails only on its own load, never on another lane's failure.
  await expect(
    loadPrincipalPoliciesForAccessPaths(
      failingExecutor,
      [pathCiting(reference)],
      [],
      cache,
    ),
  ).rejects.toThrow("own load");
});

test("a failed policy load is evicted from the request cache", async () => {
  const reference = createManifestReference();
  const cache: PrincipalPolicyReferenceCache = new Map();

  await expect(
    loadPrincipalPoliciesForAccessPaths(
      failingExecutor,
      [pathCiting(reference)],
      [],
      cache,
    ),
  ).rejects.toThrow("own load");
  expect(cache.size).toBe(0);
});
