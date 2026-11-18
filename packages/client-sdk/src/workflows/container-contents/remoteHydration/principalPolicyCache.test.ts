import { expect, test } from "bun:test";
import {
  KeyingVerificationError,
  type ReferencedPrincipalHead,
} from "@tearleads/crypto";
import {
  cacheRemoteContainerPrincipalPolicies,
  warmListedContainerPolicies,
} from "./principalPolicyCache";

function reference(principalId: string): ReferencedPrincipalHead {
  return {
    keyEpoch: 1,
    keyFingerprint: `${principalId}-fingerprint`,
    principalId,
    principalType: "group",
    stateHash: `${principalId}-state-hash`,
    version: 1,
  };
}

test("remote hydration warms principal policies against each container owner", async () => {
  const ownerAReference = reference("group-a");
  const ownerASecondReference = reference("group-a-second");
  const ownerBReference = reference("group-b");
  const requests: Array<{
    organizationId: string;
    references: readonly ReferencedPrincipalHead[];
  }> = [];

  await cacheRemoteContainerPrincipalPolicies({
    cacheReferencedPrincipalPolicies: async (request) => {
      requests.push(request);
    },
    remoteContainers: [
      {
        metadataReferencedPrincipals: [ownerAReference],
        organizationId: "owner-a",
      },
      {
        metadataReferencedPrincipals: [ownerBReference],
        organizationId: "owner-b",
      },
      {
        metadataReferencedPrincipals: [ownerAReference, ownerASecondReference],
        organizationId: "owner-a",
      },
      {
        metadataReferencedPrincipals: [],
        organizationId: "owner-without-references",
      },
      {
        metadataReferencedPrincipals: [reference("group-without-owner")],
        organizationId: "",
      },
    ],
  });

  expect(requests).toEqual([
    {
      organizationId: "owner-a",
      references: [ownerAReference, ownerASecondReference],
    },
    { organizationId: "owner-b", references: [ownerBReference] },
  ]);
});

test("a refused reference in a batch leaves independent references available", async () => {
  const good = {
    organizationId: "org",
    metadataReferencedPrincipals: [reference("ok")],
  };
  const bad = {
    organizationId: "org",
    metadataReferencedPrincipals: [reference("refused")],
  };
  const warmed: string[][] = [];
  const result = await warmListedContainerPolicies(
    [good, bad],
    async ({ references }) => {
      const ids = references.map((ref) => ref.principalId);
      warmed.push(ids);
      if (ids.includes("refused"))
        throw new KeyingVerificationError("equivocation", "test refusal");
    },
    () => {},
  );
  expect(result).toEqual({ items: [good], outcome: "refused" });
  expect(warmed).toEqual([["ok", "refused"], ["ok"], ["refused"]]);
});
