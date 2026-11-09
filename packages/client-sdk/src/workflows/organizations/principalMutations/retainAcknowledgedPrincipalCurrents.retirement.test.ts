import { expect, test } from "bun:test";
import { currentPolicyPublicationFixture } from "../../../../test/helpers/currentPolicyPublication";
import { signedAuthorityRecoveryHistory } from "../../../../test/helpers/principalAuthorityRecovery";
import {
  policyBundleAfterMutation,
  policyReceiptFromBundle,
  principalPolicyHead,
} from "../../../../test/helpers/principalPolicyFixtures";
import { parseOrganizationAuthorityDescriptor } from "../../../data/principals/organizationAuthorityDescriptor";
import { principalGrantRetirements } from "../../../data/sqlite/schema/principalGrantRetirementSchema";
import { captureAcknowledgedPrincipalPredecessor } from "../../principals/acknowledgements/acknowledgedPrincipalPredecessor";
import { groupPolicyMutationHead } from "../groupPolicy/groupPolicyMutationHead";
import { buildGroupAccessSetShrinkPolicyRequest } from "../groupPolicy/groupPolicyRequests";
import {
  buildOrganizationGroupDirectoryPolicyRequest,
  replaceOrganizationGroupHead,
} from "../groups/organizationGroupDirectory";
import { retainAcknowledgedPrincipalCurrents } from "./retainAcknowledgedPrincipalCurrents";

test("a retirement persists a grant present only in the acknowledged predecessor", async () => {
  const history = await signedAuthorityRecoveryHistory();
  const f = await currentPolicyPublicationFixture(history);
  try {
    const [verifiedCurrentPolicy] = await retainAcknowledgedPrincipalCurrents(
      f.publication,
    );
    const [group, directory] = f.publication.entries;
    const groupBundle = f.response;
    const directoryBundle = f.organizationBundle;
    const identity = await history.resolveTrustedUserIdentity(
      history.signerUserId,
    );
    const containerId = groupBundle.currentGrants[0]?.containerId;
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
      currentPolicy: groupBundle,
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
      directoryBundle.currentPayload.ciphertext,
    );
    const organizationRequest =
      await buildOrganizationGroupDirectoryPolicyRequest({
        ...signer,
        adminProjection: history.admin.currentProjection,
        adminUsers: [identity],
        currentPolicy: directoryBundle,
        descriptor,
        groupHeads: replaceOrganizationGroupHead({
          descriptor,
          nextHead: await groupPolicyMutationHead(request),
        }),
      });
    const response = await policyBundleAfterMutation({
      previous: groupBundle,
      mutation: request,
    });
    await retainAcknowledgedPrincipalCurrents({
      ...f.publication,
      entries: [
        {
          predecessor: await captureAcknowledgedPrincipalPredecessor({
            ...group.recovery,
            expectedHead: principalPolicyHead(groupBundle),
          }),
          recovery: {
            ...group.recovery,
            expectedHead: principalPolicyHead(groupBundle),
          },
          request,
          response: policyReceiptFromBundle(response),
        },
        {
          predecessor: await captureAcknowledgedPrincipalPredecessor({
            ...directory.recovery,
            expectedHead: principalPolicyHead(directoryBundle),
          }),
          recovery: {
            ...directory.recovery,
            expectedHead: principalPolicyHead(directoryBundle),
          },
          request: organizationRequest,
          response: policyReceiptFromBundle(
            await policyBundleAfterMutation({
              previous: directoryBundle,
              mutation: organizationRequest,
            }),
          ),
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
