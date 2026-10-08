import { expect, test } from "bun:test";
import {
  encryptGroupMetadata,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
  unwrapDek,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { currentGroupMutationInput } from "../../../test/helpers/currentGroupMutation";
import { testGroupMetadataKey } from "../../../test/helpers/groupMetadata";
import { policyBundleFromInitialRequest } from "../../../test/helpers/principalPolicyFixtures";
import { createTestTrustedUserIdentity } from "../../../test/helpers/trustedUserIdentity";
import { buildAddGroupUserPolicyRequest } from "./groupPolicyRequests";
import { toRecipientEntries } from "./principalPolicyRecipients";
import { signedGroupPolicyRequest } from "./principalPolicyRequest";

for (const forgedPublicPart of [false, true]) {
  test.each(["full", "current", "expired current"])(
    `%s adding a member repairs a wrong group secret (forged public part: ${forgedPublicPart})`,
    async (mode) => {
      const adminKem = generateKemSeedAndKeyPair();
      const memberKem = generateKemSeedAndKeyPair();
      const signingKeyPair = generateSigningSeedAndKeyPair();
      const signingFingerprint = await toFingerprint(
        signingKeyPair.signingPublicKey,
      );
      const groupKem = generateKemSeedAndKeyPair();
      const wrongSecret = generateKemSeedAndKeyPair().secretKey;
      if (forgedPublicPart) wrongSecret.set(groupKem.publicKey, 1536);
      const [badEnvelope] = await wrapDekForRecipients(wrongSecret, [
        adminKem.publicKey,
      ]);
      if (!badEnvelope) throw new Error("Expected an envelope");
      const identity = async (userId: string, publicKey: Uint8Array) =>
        createTestTrustedUserIdentity({
          userId,
          encapsulationPublicKey: publicKey,
          encapsulationKeyFingerprint: await toFingerprint(publicKey),
          signingPublicKey: signingKeyPair.signingPublicKey,
          signingKeyFingerprint: signingFingerprint,
        });
      const admin = await identity("admin", adminKem.publicKey);
      const member = await identity("member", memberKem.publicKey);
      const currentPolicy = await policyBundleFromInitialRequest({
        groupId: "group",
        initialGroupPolicy: await signedGroupPolicyRequest({
          encapsulationPublicKey: bytesToBase64(groupKem.publicKey),
          externalAuthority: null,
          grants: [],
          keyEpoch: 1,
          keyFingerprint: await toFingerprint(groupKem.publicKey),
          memberEnvelopes: [
            {
              userId: admin.userId,
              memberKeyFingerprint: admin.encapsulationKeyFingerprint,
              kemCipherText: bytesToBase64(badEnvelope.kemCipherText),
              wrappedKey: bytesToBase64(badEnvelope.wrappedKey),
            },
          ],
          payloadCiphertext: await encryptGroupMetadata({
            key: testGroupMetadataKey(),
            groupId: "group",
            name: "Operators",
          }),
          principalId: "group",
          projection: [{ userId: admin.userId, role: "admin" }],
          signedAt: new Date().toISOString(),
          signerUserId: admin.userId,
          signingFingerprint,
          signingKeyPair,
        }),
      });
      const incidents: Array<{ error: unknown; context: unknown }> = [];
      const signerPublicKeys = [
        {
          userId: admin.userId,
          signingKeyFingerprint: signingFingerprint,
          signingPublicKey: signingKeyPair.signingPublicKey,
        },
      ];
      const evidence =
        mode !== "full"
          ? await currentGroupMutationInput(currentPolicy, signerPublicKeys)
          : { currentPolicy, currentPolicySignerPublicKeys: signerPublicKeys };
      const lifetime = { current: true };
      const pending = buildAddGroupUserPolicyRequest({
        ...evidence,
        stillCurrent: () => lifetime.current,
        currentUsers: [admin],
        currentUserSecretKey: adminKem.secretKey,
        reportSecurityIncident: async (error, context) => {
          incidents.push({ context, error });
          if (mode === "expired current") lifetime.current = false;
        },
        signerUserId: admin.userId,
        signingFingerprint,
        signingKeyPair,
        targetUser: member,
      });
      if (mode === "expired current") {
        await expect(pending).rejects.toThrow("generation expired");
        expect(incidents).toHaveLength(1);
        return;
      }
      const request = await pending;
      expect(request.state.keyEpoch).toBe(2);
      // The repair is silent to the user but not to the incident ledger: a policy
      // whose envelopes do not wrap its signed key came from a prior admin or the
      // server, and that is recorded before the rotation proceeds.
      expect(incidents).toHaveLength(1);
      expect(incidents[0]?.error).toMatchObject({
        code: "object_mismatch",
        name: "KeyingVerificationError",
      });
      expect(incidents[0]?.context).toMatchObject({
        evidenceHashes: {
          principalKeyFingerprint: currentPolicy.currentState.keyFingerprint,
          principalStateHash: currentPolicy.currentState.stateHash,
        },
        objectId: "group",
        objectKind: "principal",
        operation: "group.policy.envelope_mismatch",
      });
      const entries = toRecipientEntries(request.memberEnvelopes);
      const adminSecret = await unwrapDek(entries, adminKem.secretKey);
      const memberSecret = await unwrapDek(entries, memberKem.secretKey);
      expect(memberSecret).toEqual(adminSecret);
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const wrapped = await wrapDekForRecipients(challenge, [
        base64ToBytes(request.state.encapsulationPublicKey),
      ]);
      await expect(unwrapDek(wrapped, memberSecret)).resolves.toEqual(
        challenge,
      );
    },
  );
}
