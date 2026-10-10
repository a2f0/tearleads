import { expect, test } from "bun:test";
import { currentPolicyPublicationFixture } from "../../../test/helpers/currentPolicyPublication";
import { signedAuthorityRecoveryHistory } from "../../../test/helpers/principalAuthorityRecovery";
import {
  policyBundleAfterMutation,
  principalPolicyHead,
} from "../../../test/helpers/principalPolicyFixtures";
import { parseOrganizationAuthorityDescriptor } from "../../data/principals/organizationAuthorityDescriptor";
import { principalGrantRetirements } from "../../data/sqlite/principalGrantRetirementSchema";
import { captureAcknowledgedPrincipalPredecessor } from "./acknowledgedPrincipalPredecessor";
import { groupPolicyMutationHead } from "./groupPolicyMutationHead";
import { buildGroupAccessSetShrinkPolicyRequest } from "./groupPolicyRequests";
import {
  buildOrganizationGroupDirectoryPolicyRequest,
  replaceOrganizationGroupHead,
} from "./organizationGroupDirectory";
import { retainAcknowledgedPrincipalCurrents } from "./retainAcknowledgedPrincipalCurrents";

test("a retirement persists a grant present only in the acknowledged predecessor", async () => {
  const history = await signedAuthorityRecoveryHistory();
  const f = await currentPolicyPublicationFixture(history);
  try {
    const [verifiedCurrentPolicy] = await retainAcknowledgedPrincipalCurrents(
      f.publication,
    );
    const [group, directory] = f.publication.entries;
    const identity = await history.resolveTrustedUserIdentity(
      history.signerUserId,
    );
    const containerId = group?.response.currentGrants[0]?.containerId;
    if (
      !verifiedCurrentPolicy ||
      !group ||
      !directory ||
      !identity ||
      !containerId
    )
      throw new Error("Missing retirement fixture");
    const signer = {
      signerUserId: history.signerUserId,
      signingFingerprint: identity.signingKeyFingerprint,
      signingKeyPair: history.signingKeyPair,
    };
    const request = await buildGroupAccessSetShrinkPolicyRequest({
      ...signer,
      currentPolicy: group.response,
      verifiedCurrentPolicy,
      localPolicyCheckpoint: verifiedCurrentPolicy.checkpoint,
      currentOrgAdminUserIds: [history.signerUserId],
      currentUsers: [identity],
      externalAuthority: f.input.externalAuthority,
      revokedContainerId: containerId,
      stillCurrent: f.publication.stillCurrent,
    });
    expect(request.grants).toEqual([]);
    const descriptor = parseOrganizationAuthorityDescriptor(
      directory.response.currentPayload.ciphertext,
    );
    const organizationRequest =
      await buildOrganizationGroupDirectoryPolicyRequest({
        ...signer,
        adminProjection: history.admin.currentProjection,
        adminUsers: [identity],
        currentPolicy: directory.response,
        descriptor,
        groupHeads: replaceOrganizationGroupHead({
          descriptor,
          nextHead: await groupPolicyMutationHead(request),
        }),
      });
    const response = await policyBundleAfterMutation({
      previous: group.response,
      mutation: request,
    });
    await retainAcknowledgedPrincipalCurrents({
      ...f.publication,
      entries: [
        {
          predecessor: await captureAcknowledgedPrincipalPredecessor({
            ...group.recovery,
            expectedHead: principalPolicyHead(group.response),
          }),
          recovery: {
            ...group.recovery,
            expectedHead: principalPolicyHead(group.response),
          },
          request,
          response,
        },
        {
          predecessor: await captureAcknowledgedPrincipalPredecessor({
            ...directory.recovery,
            expectedHead: principalPolicyHead(directory.response),
          }),
          recovery: {
            ...directory.recovery,
            expectedHead: principalPolicyHead(directory.response),
          },
          request: organizationRequest,
          response: await policyBundleAfterMutation({
            previous: directory.response,
            mutation: organizationRequest,
          }),
        },
      ],
      retirements: [
        {
          principalId: request.state.principalId,
          principalType: "group",
          containerIds: [containerId],
        },
      ],
    });
    expect(await f.db.select().from(principalGrantRetirements)).toEqual([
      {
        organizationId: history.organizationId,
        containerId,
        principalId: request.state.principalId,
        policyStateHash: response.currentState.stateHash,
      },
    ]);
  } finally {
    f.close();
  }
}, 15_000);
