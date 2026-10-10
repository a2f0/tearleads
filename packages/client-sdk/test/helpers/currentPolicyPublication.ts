import { serializeKeyingCanonicalJson } from "@tearleads/crypto";
import { advanceKeyingCheckpointsAtomically } from "../../src/data/persistence/keyingCheckpointAdvancePersistence";
import { parseOrganizationAuthorityDescriptor } from "../../src/data/principals/organizationAuthorityDescriptor";
import { captureAcknowledgedPrincipalPredecessor } from "../../src/workflows/organizations/acknowledgedPrincipalPredecessor";
import {
  buildOrganizationGroupDirectoryPolicyRequest,
  replaceOrganizationGroupHead,
} from "../../src/workflows/organizations/organizationGroupDirectory";
import type { RecoverPrincipalPolicyHistoryOptions } from "../../src/workflows/principals/principalHistoryRecoveryTypes";
import { recoverScopedPrincipalPolicyHistory } from "../../src/workflows/principals/recoverScopedPrincipalPolicyHistory";
import { currentPolicyAcknowledgementFixture } from "./currentPolicyAcknowledgement";
import type { signedAuthorityRecoveryHistory } from "./principalAuthorityRecovery";
import {
  policyBundleAfterMutation,
  principalPolicyHead,
} from "./principalPolicyFixtures";

export async function currentPolicyPublicationFixture(
  history: Awaited<ReturnType<typeof signedAuthorityRecoveryHistory>>,
) {
  const f = await currentPolicyAcknowledgementFixture(history, "group");
  try {
    const directory = await recoverScopedPrincipalPolicyHistory({
      ...f.options,
      reference: principalPolicyHead(history.directory),
    });
    await advanceKeyingCheckpointsAtomically({
      execSql: f.options.execSql,
      organizationId: history.organizationId,
      access: [],
      policies: [f.input.verifiedCurrentPolicy, directory.policy],
    });
    const identity = await history.resolveTrustedUserIdentity(
      history.signerUserId,
    );
    if (!identity) throw new Error("Missing fixture identity");
    const descriptor = parseOrganizationAuthorityDescriptor(
      history.directory.currentPayload.ciphertext,
    );
    const organizationRequest =
      await buildOrganizationGroupDirectoryPolicyRequest({
        adminProjection: history.admin.currentProjection,
        adminUsers: [identity],
        currentPolicy: history.directory,
        descriptor,
        groupHeads: replaceOrganizationGroupHead({
          descriptor,
          nextHead: f.input.expectedHead,
        }),
        signerUserId: history.signerUserId,
        signingFingerprint: identity.signingKeyFingerprint,
        signingKeyPair: history.signingKeyPair,
      });
    const organizationResponse = await policyBundleAfterMutation({
      previous: history.directory,
      mutation: organizationRequest,
    });
    const groupRecovery: RecoverPrincipalPolicyHistoryOptions = {
      ...f.options,
      expectedHead: principalPolicyHead(history.group),
      protection: {
        ...f.options.protection,
        context: serializeKeyingCanonicalJson([
          "tearleads.sdk.principal-history.scoped-group.v1",
          f.options.protection.context,
          history.organizationId,
          history.admin.currentState.principalId,
        ]),
      },
      loadExternalAuthority: async () => f.input.externalAuthority,
    };
    const organizationRecovery: RecoverPrincipalPolicyHistoryOptions = {
      ...f.options,
      expectedHead: principalPolicyHead(history.directory),
      protection: {
        ...f.options.protection,
        context: serializeKeyingCanonicalJson([
          "tearleads.sdk.principal-history.directory.v1",
          f.options.protection.context,
        ]),
      },
    };
    return {
      ...f,
      groupRecovery,
      organizationRecovery,
      publication: {
        execSql: f.options.execSql,
        organizationId: history.organizationId,
        entries: [
          {
            recovery: groupRecovery,
            predecessor:
              await captureAcknowledgedPrincipalPredecessor(groupRecovery),
            request: f.input.request,
            response: f.response,
          },
          {
            recovery: organizationRecovery,
            predecessor:
              await captureAcknowledgedPrincipalPredecessor(
                organizationRecovery,
              ),
            request: organizationRequest,
            response: organizationResponse,
          },
        ],
        stillCurrent: () => f.lifetime.current,
      },
    };
  } catch (error) {
    f.close();
    throw error;
  }
}
