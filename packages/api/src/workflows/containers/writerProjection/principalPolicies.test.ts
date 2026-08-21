import { expect, test } from "bun:test";
import type {
  VerifiedContainerAccessManifest,
  VerifiedPrincipalPolicy,
} from "@symcrypt/crypto";
import { principalPolicyCacheKey } from "./principalPolicies";

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
