import { toFingerprint } from "@tearleads/crypto";
import { parseOrganizationAuthorityDescriptor } from "../../src/data/principals/organizationAuthorityDescriptor";
import { groupPolicyMutationHead } from "../../src/workflows/organizations/groupPolicyMutationHead";
import { buildSetGroupContainerGrantPolicyRequest } from "../../src/workflows/organizations/groupPolicyRequests";
import { buildOrganizationGroupDirectoryPolicyRequest } from "../../src/workflows/organizations/organizationGroupDirectory";
import { recoverScopedPrincipalPolicyHistory } from "../../src/workflows/principals/recoverScopedPrincipalPolicyHistory";
import {
  createAuthorityRecoveryFixture,
  type signedAuthorityRecoveryHistory,
} from "./principalAuthorityRecovery";
import {
  policyBundleAfterMutation,
  principalPolicyHead,
} from "./principalPolicyFixtures";

export async function currentPolicyAcknowledgementFixture(
  history: Awaited<ReturnType<typeof signedAuthorityRecoveryHistory>>,
  kind: "group" | "organization",
) {
  const fixture = await createAuthorityRecoveryFixture(history);
  try {
    const previous = kind === "group" ? history.group : history.directory;
    const recovered = await recoverScopedPrincipalPolicyHistory({
      ...fixture.options,
      reference: principalPolicyHead(previous),
    });
    const lifetime = { current: true };
    const signingFingerprint = await toFingerprint(
      history.signingKeyPair.signingPublicKey,
    );
    const signerPublicKeys = [
      {
        userId: history.signerUserId,
        signingKeyFingerprint: signingFingerprint,
        signingPublicKey: history.signingKeyPair.signingPublicKey,
      },
    ];
    const externalAuthority = {
      currentHead: {
        ...principalPolicyHead(history.admin),
        principalType: "group" as const,
      },
      states: [
        {
          head: {
            ...principalPolicyHead(history.admin),
            principalType: "group" as const,
          },
          projection: history.admin.currentProjection,
        },
      ],
    };
    const current = {
      currentPolicy: recovered.current,
      verifiedCurrentPolicy: recovered.policy,
      externalAuthority,
      signerPublicKeys,
      localPolicyCheckpoint: recovered.policy.checkpoint,
      stillCurrent: () => lifetime.current,
    };
    const signer = {
      signerUserId: history.signerUserId,
      signingFingerprint,
      signingKeyPair: history.signingKeyPair,
    };
    const identity = await history.resolveTrustedUserIdentity(
      history.signerUserId,
    );
    if (!identity) throw new Error("Missing fixture signing identity");
    const descriptor = parseOrganizationAuthorityDescriptor(
      history.directory.currentPayload.ciphertext,
    );
    const request =
      kind === "group"
        ? await buildSetGroupContainerGrantPolicyRequest({
            ...current,
            ...signer,
            currentOrgAdminUserIds: [history.signerUserId],
            containerId: crypto.randomUUID(),
            accessLevel: "read",
          })
        : await buildOrganizationGroupDirectoryPolicyRequest({
            ...signer,
            adminProjection: history.admin.currentProjection,
            adminUsers: [identity],
            currentPolicy: previous,
            descriptor,
            groupHeads: descriptor.groupHeads,
          });
    const response = await policyBundleAfterMutation({
      previous,
      mutation: request,
    });
    const { currentPolicy, ...evidence } = current;
    return {
      ...fixture,
      currentPolicy,
      lifetime,
      response,
      input: {
        ...evidence,
        request,
        expectedHead: await groupPolicyMutationHead(request),
      },
    };
  } catch (error) {
    fixture.close();
    throw error;
  }
}
