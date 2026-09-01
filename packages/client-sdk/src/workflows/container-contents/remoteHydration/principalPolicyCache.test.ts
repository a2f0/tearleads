import { expect, test } from "bun:test";
import type { ReferencedPrincipalHead } from "@tearleads/crypto";
import { cacheRemoteContainerPrincipalPolicies } from "./principalPolicyCache";

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
