import { encryptGroupMetadata } from "@tearleads/crypto";
import { parseOrganizationAuthorityDescriptor } from "../../src/data/principals/organizationAuthorityDescriptor";
import {
  buildOrganizationGroupDirectoryPolicyRequest,
  replaceOrganizationGroupHead,
} from "../../src/workflows/organizations/organizationGroupDirectory";
import type { createCurrentShareMetadataFixture } from "./currentShareMetadata";
import {
  policyBundleAfterMutation,
  principalPolicyHead,
  signedPrincipalPolicyBundle,
} from "./principalPolicyFixtures";
import {
  projectionDirectoryPayload,
  projectionPolicySource,
} from "./projectionPolicyHistory";

/** Prepare a genuine rename to publish between the share read and grant mint. */
export async function prepareCurrentShareRename(
  f: Awaited<ReturnType<typeof createCurrentShareMetadataFixture>>,
) {
  const signingKeyPair = f.runtime.crypto.signingKeyPair;
  const signerUserId = f.runtime.auth.userId;
  if (!signingKeyPair || !signerUserId)
    throw new Error("Missing fixture signer");
  const identity = await f.runtime.resolveTrustedUserIdentity(signerUserId);
  if (!identity) throw new Error("Missing fixture identity");
  const group = await signedPrincipalPolicyBundle({
    memberEnvelopes: f.group.currentMemberEnvelopes.envelopes,
    payloadCiphertext: await encryptGroupMetadata({
      key: f.metadataKey,
      groupId: f.group.currentState.principalId,
      name: "Renamed group",
    }),
    projection: f.group.currentProjection,
    previousStates: [
      {
        state: f.group.currentState,
        projection: f.group.currentProjection,
        grants: f.group.currentGrants,
      },
    ],
    signing: {
      ...f.group.currentState,
      grants: f.group.currentGrants,
      version: 2,
      prevStateHash: f.group.currentState.stateHash,
    },
    signingPrivateKey: signingKeyPair.signingPrivateKey,
  });
  const descriptor = parseOrganizationAuthorityDescriptor(
    f.directory.currentPayload.ciphertext,
  );
  const directory = await policyBundleAfterMutation({
    previous: f.directory,
    mutation: await buildOrganizationGroupDirectoryPolicyRequest({
      adminProjection: f.admin.currentProjection,
      adminUsers: [identity],
      currentPolicy: f.directory,
      descriptor,
      groupHeads: replaceOrganizationGroupHead({
        descriptor,
        nextHead: principalPolicyHead(group),
      }),
      signerUserId,
      signingFingerprint: identity.signingKeyFingerprint,
      signingKeyPair,
    }),
  });
  return () => {
    f.policies.set(group.currentState.principalId, group);
    f.policies.set(f.organizationId, directory);
    for (const projection of [f.projection, f.rootProjection]) {
      projection.policyEvidence.organization =
        projectionPolicySource(directory);
      projection.policyEvidence.organizationPayloads = [
        projectionDirectoryPayload(directory),
      ];
    }
  };
}
