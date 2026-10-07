import { expect, test } from "bun:test";
import { wrapDekForRecipients } from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { currentPolicyPublicationFixture } from "../../../test/helpers/currentPolicyPublication";
import { signedAuthorityRecoveryHistory } from "../../../test/helpers/principalAuthorityRecovery";
import {
  policyBundleAfterMutation,
  principalPolicyHead,
} from "../../../test/helpers/principalPolicyFixtures";
import { parseOrganizationAuthorityDescriptor } from "../../data/principals/organizationAuthorityDescriptor";
import { unwrapKeyEnvelopesWithPrincipalPolicies } from "../../data/principals/principalPolicyCrypto";
import {
  principalHistoryStageScopes,
  principalKeyEnvelopeArchive,
} from "../../data/sqlite/principalHistoryRetentionSchema";
import { principalHistoryStages } from "../../data/sqlite/principalHistoryStageSchema";
import { restorePrincipalHistoryRecoveryStage } from "../principals/principalHistoryRecoveryStage";
import { recoverPrincipalPolicyHistory } from "../principals/recoverPrincipalPolicyHistory";
import { buildOrganizationGroupDirectoryPolicyRequest } from "./organizationGroupDirectory";
import { retainAcknowledgedPrincipalCurrents } from "./retainAcknowledgedPrincipalCurrents";

test("successive acknowledgements reclaim old stages while preserving predecessor recovery and old object keys", async () => {
  const history = await signedAuthorityRecoveryHistory();
  const f = await currentPolicyPublicationFixture(history);
  try {
    const entry = f.publication.entries[1];
    if (!entry) throw new Error("Missing organization receipt");
    const identity = await history.resolveTrustedUserIdentity(
      history.signerUserId,
    );
    if (!identity) throw new Error("Missing signing identity");
    const key = crypto.getRandomValues(new Uint8Array(32));
    const wrapped = await wrapDekForRecipients(key, [
      base64ToBytes(history.directory.currentState.encapsulationPublicKey),
    ]);
    await retainAcknowledgedPrincipalCurrents(f.publication);
    let current = entry.response;
    let predecessor = current;
    for (let count = 0; count < 2; count++) {
      predecessor = current;
      const descriptor = parseOrganizationAuthorityDescriptor(
        current.currentPayload.ciphertext,
      );
      const request = await buildOrganizationGroupDirectoryPolicyRequest({
        adminProjection: history.admin.currentProjection,
        adminUsers: [identity],
        currentPolicy: current,
        descriptor,
        groupHeads: descriptor.groupHeads,
        signerUserId: history.signerUserId,
        signingFingerprint: identity.signingKeyFingerprint,
        signingKeyPair: history.signingKeyPair,
      });
      const response = await policyBundleAfterMutation({
        previous: current,
        mutation: request,
      });
      await retainAcknowledgedPrincipalCurrents({
        ...f.publication,
        entries: [
          {
            recovery: {
              ...f.organizationRecovery,
              expectedHead: principalPolicyHead(current),
            },
            request,
            response,
          },
        ],
      });
      current = response;
    }
    const stages = await f.db.select().from(principalHistoryStages);
    const organizationStages = stages.filter(
      (stage) =>
        JSON.parse(stage.currentJson).currentState.principalType ===
        "organization",
    );
    expect(
      organizationStages.map((stage) => stage.afterVersion + 1).sort(),
    ).toEqual([68, 69]);
    const hints = await f.db.select().from(principalHistoryStageScopes);
    expect(hints.map((hint) => hint.id).sort()).toEqual(
      stages.map((stage) => stage.id).sort(),
    );
    const archive = (
      await f.db.select().from(principalKeyEnvelopeArchive)
    ).filter((row) => row.principalType === "organization");
    expect(archive.map((row) => row.version).sort()).toEqual([66, 67, 68, 69]);
    const requests = f.requests.length;
    const recovery = {
      ...f.organizationRecovery,
      execSql: f.options.execSql,
      organizationId: history.organizationId,
      offline: true,
      stillCurrent: () => true,
    };
    const restored = await restorePrincipalHistoryRecoveryStage(
      { ...recovery, expectedHead: principalPolicyHead(predecessor) },
      { principalType: "organization", principalId: history.organizationId },
    );
    expect(restored.complete).toBe(true);
    expect(restored.verifier.finish(principalPolicyHead(predecessor)).ok).toBe(
      true,
    );
    const recovered = await recoverPrincipalPolicyHistory({
      ...recovery,
      expectedHead: principalPolicyHead(current),
    });
    expect(recovered.policy.version).toBe(69);
    expect(f.requests).toHaveLength(requests);
    const unwrapped = await unwrapKeyEnvelopesWithPrincipalPolicies({
      execSql: f.options.execSql,
      secretKey: history.creatorEncapsulationKeyPair.secretKey,
      envelopes: wrapped.map((envelope) => ({
        keyFingerprint: envelope.keyFingerprint,
        kemCipherText: bytesToBase64(envelope.kemCipherText),
        wrappedKey: bytesToBase64(envelope.wrappedKey),
      })),
    });
    expect(unwrapped).toEqual(key);
  } finally {
    f.close();
  }
}, 15_000);
