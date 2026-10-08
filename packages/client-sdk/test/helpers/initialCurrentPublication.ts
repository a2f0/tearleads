import {
  generateSigningSeedAndKeyPair,
  signPrincipalState,
} from "@tearleads/crypto";
import type { PutPrincipalPolicyRequest } from "@tearleads/validators/request";
import { parseOrganizationAuthorityDescriptor } from "../../src/data/principals/organizationAuthorityDescriptor";
import { principalPolicyReferenceFromBundle } from "../../src/data/principals/principalPolicyAdminSigners";
import {
  buildOrganizationGroupDirectoryPolicyRequest,
  replaceOrganizationGroupHead,
} from "../../src/workflows/organizations/organizationGroupDirectory";
import type { AcknowledgedPrincipalCurrentInput } from "../../src/workflows/organizations/retainAcknowledgedPrincipalCurrents";
import { currentPolicyPublicationFixture } from "./currentPolicyPublication";
import type { signedAuthorityRecoveryHistory } from "./principalAuthorityRecovery";
import {
  policyBundleAfterMutation,
  policyReceiptFromBundle,
  principalPolicyBundleFromState,
} from "./principalPolicyFixtures";

export async function initialCurrentPublicationFixture(
  history: Awaited<ReturnType<typeof signedAuthorityRecoveryHistory>>,
  wrongSigner = false,
) {
  const f = await currentPolicyPublicationFixture(history);
  try {
    let initial = await history.createGroup(
      "New current group",
      false,
      history.admin,
    );
    const {
      createdAt: _createdAt,
      stateHash: _stateHash,
      ...state
    } = initial.currentState;
    const request: PutPrincipalPolicyRequest = {
      state,
      encryptedPayload: {
        cipherSuite: initial.currentPayload.cipherSuite,
        ciphertext: initial.currentPayload.ciphertext,
        ciphertextHash: initial.currentPayload.ciphertextHash,
      },
      projection: initial.currentProjection,
      grants: initial.currentGrants,
      memberEnvelopes: initial.currentMemberEnvelopes.envelopes,
    };
    if (wrongSigner) {
      request.state = await signPrincipalState(
        state,
        generateSigningSeedAndKeyPair().signingPrivateKey,
      );
      initial = await principalPolicyBundleFromState({
        ...request,
        createdAt: initial.currentState.createdAt,
      });
    }
    const head = principalPolicyReferenceFromBundle(initial);
    const identity = await history.resolveTrustedUserIdentity(
      history.signerUserId,
    );
    if (!identity) throw new Error("Missing signer");
    const descriptor = parseOrganizationAuthorityDescriptor(
      history.directory.currentPayload.ciphertext,
    );
    const directoryRequest = await buildOrganizationGroupDirectoryPolicyRequest(
      {
        currentPolicy: history.directory,
        descriptor,
        groupHeads: replaceOrganizationGroupHead({
          descriptor,
          nextHead: head,
        }),
        adminProjection: history.admin.currentProjection,
        adminUsers: [identity],
        signerUserId: history.signerUserId,
        signingFingerprint: identity.signingKeyFingerprint,
        signingKeyPair: history.signingKeyPair,
      },
    );
    const entries: AcknowledgedPrincipalCurrentInput[] = [
      {
        initialGroup: true,
        recovery: { ...f.groupRecovery, expectedHead: head },
        request,
        response: policyReceiptFromBundle({
          ...initial,
          containerMutations: [],
        }),
      },
      {
        recovery: f.organizationRecovery,
        request: directoryRequest,
        response: policyReceiptFromBundle(
          await policyBundleAfterMutation({
            previous: history.directory,
            mutation: directoryRequest,
          }),
        ),
      },
    ];
    return { ...f, initial, publication: { ...f.publication, entries } };
  } catch (error) {
    f.close();
    throw error;
  }
}
