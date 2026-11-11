import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import {
  serveRecoveryHistory,
  signedRecoveryHistory,
} from "../../../../test/helpers/principalHistoryRecovery";
import { principalIdentityPinFixture } from "../../../../test/helpers/principalIdentityPinFixture";
import {
  principalPolicyHead,
  signedPrincipalPolicyBundle,
} from "../../../../test/helpers/principalPolicyFixtures";
import { createPublicHistoryFixture } from "../../../../test/helpers/publicPrincipalHistory";
import { createFixtureUserIdentity } from "../../../../test/helpers/trustedUserIdentity";
import type { TrustedUserIdentity } from "../../../data/trustedUserIdentity";
import { recoverPublicPrincipalHistory } from "../publicHistory/recoverPublicPrincipalHistory";
import { recoverPrincipalPolicyHistory } from "./recoverPrincipalPolicyHistory";

const ADMIN_X = "33333333-3333-4333-8333-333333333333";

function identityResponse(identity: TrustedUserIdentity) {
  return {
    userId: identity.userId,
    signingPublicKey: bytesToBase64(identity.signingPublicKey),
    signingKeyFingerprint: identity.signingKeyFingerprint,
    encapsulationPublicKey: bytesToBase64(identity.encapsulationPublicKey),
    encapsulationKeyFingerprint: identity.encapsulationKeyFingerprint,
  };
}

/** One rotated successor of `bundle` whose only member is the owner. */
async function successor(input: {
  readonly bundle: PrincipalPolicyBundleResponse;
  readonly memberKey: ReturnType<typeof generateKemSeedAndKeyPair>;
  readonly ownerId: string;
  readonly signerUserId: string;
  readonly signerFingerprint: string;
  readonly signingPrivateKey: Uint8Array;
}): Promise<PrincipalPolicyBundleResponse> {
  const { bundle } = input;
  const principalKey = generateKemSeedAndKeyPair();
  const [envelope] = await wrapDekForRecipients(principalKey.secretKey, [
    input.memberKey.publicKey,
  ]);
  const owner = bundle.currentProjection.find(
    (member) => member.userId === input.ownerId,
  );
  if (!envelope || !owner) throw new Error("Missing fixture owner");
  const version = bundle.currentState.version + 1;
  return signedPrincipalPolicyBundle({
    memberEnvelopes: [
      {
        userId: input.ownerId,
        memberKeyFingerprint: envelope.keyFingerprint,
        kemCipherText: bytesToBase64(envelope.kemCipherText),
        wrappedKey: bytesToBase64(envelope.wrappedKey),
      },
    ],
    projection: [owner],
    payloadCiphertext: "signed-recovery-fixture",
    previousStates: [
      ...bundle.previousStates,
      {
        state: bundle.currentState,
        projection: bundle.currentProjection,
        grants: [],
      },
    ],
    signing: {
      principalType: "group",
      principalId: bundle.currentState.principalId,
      version,
      prevStateHash: bundle.currentState.stateHash,
      keyEpoch: version,
      encapsulationPublicKey: bytesToBase64(principalKey.publicKey),
      keyFingerprint: await toFingerprint(principalKey.publicKey),
      externalAuthority: null,
      signedAt: "2026-10-06T00:00:00.000Z",
      signerUserId: input.signerUserId,
      signerUserKeyFingerprint: input.signerFingerprint,
    },
    signingPrivateKey: input.signingPrivateKey,
  });
}

/**
 * Admin X is a member of every state on the first 32-entry page; the next page
 * opens with X's removal, signed under a key the server substitutes for X, and
 * the honest owner signs the head after it. The identity endpoint serves X's
 * honest keys until the second page is requested.
 */
async function pageBoundaryForgery() {
  const history = await signedRecoveryHistory(32, (_version, userId) => [
    { userId, role: "admin" },
    { userId: ADMIN_X, role: "admin" },
  ]);
  const [owner, honestX] = await Promise.all([
    history.resolveTrustedUserIdentity(
      history.bundle.currentState.signerUserId,
    ),
    history.resolveTrustedUserIdentity(ADMIN_X),
  ]);
  if (!owner || !honestX) throw new Error("Missing fixture identities");
  const forgedSigning = generateSigningSeedAndKeyPair();
  const forgedX = await createFixtureUserIdentity({
    userId: ADMIN_X,
    signingPublicKey: forgedSigning.signingPublicKey,
  });
  const removal = await successor({
    bundle: history.bundle,
    memberKey: history.memberKey,
    ownerId: owner.userId,
    signerUserId: ADMIN_X,
    signerFingerprint: forgedX.identity.signingKeyFingerprint,
    signingPrivateKey: forgedSigning.signingPrivateKey,
  });
  const head = await successor({
    bundle: removal,
    memberKey: history.memberKey,
    ownerId: owner.userId,
    signerUserId: owner.userId,
    signerFingerprint: owner.signingKeyFingerprint,
    signingPrivateKey: history.signingPrivateKey,
  });
  const pins = await principalIdentityPinFixture(1);
  pins.responses.set(owner.userId, identityResponse(owner));
  pins.responses.set(ADMIN_X, identityResponse(honestX));
  return {
    head,
    honestX,
    pins,
    substituteOnSecondPage(page: { historyPage: { afterVersion: number } }) {
      if (page.historyPage.afterVersion === 32)
        pins.responses.set(ADMIN_X, forgedX.response);
    },
    async expectHonestXPinned() {
      // The accepted first page pinned X's authenticated identity.
      expect(
        await pins.execSql(
          "SELECT provenance, signing_key_fingerprint FROM trusted_user_identity_pins WHERE user_id = ?",
          [ADMIN_X],
        ),
      ).toEqual([
        {
          provenance: "observed",
          signing_key_fingerprint: honestX.signingKeyFingerprint,
        },
      ]);
    },
  };
}

test("a page boundary cannot hand an unpinned admin's authority to a substituted key", async () => {
  const forgery = await pageBoundaryForgery();
  const http = serveRecoveryHistory(forgery.head);
  try {
    http.controls.mutate = forgery.substituteOnSecondPage;
    const recovered = recoverPrincipalPolicyHistory({
      historyReader: http.client(),
      execSql: forgery.pins.execSql,
      organizationId: "org-1",
      expectedHead: principalPolicyHead(forgery.head),
      protection: {
        localKey: new Uint8Array(32).fill(7),
        context: "device-and-trust-domain-1",
      },
      resolveTrustedUserIdentity: forgery.pins.service.resolve,
      stillCurrent: () => true,
    });
    await expect(recovered).rejects.toMatchObject({ code: "signer_mismatch" });
    expect(http.requests).toEqual([0, 32]);
    await forgery.expectHonestXPinned();
  } finally {
    http.close();
    forgery.pins.close();
  }
});

test("a public history page boundary pins its admins before the next page", async () => {
  const forgery = await pageBoundaryForgery();
  const http = await createPublicHistoryFixture({
    bundle: forgery.head,
    resolveTrustedUserIdentity: forgery.pins.service.resolve,
  });
  try {
    http.controls.mutate = forgery.substituteOnSecondPage;
    await expect(
      recoverPublicPrincipalHistory(http.options),
    ).rejects.toMatchObject({ code: "signer_mismatch" });
    expect(http.requests).toEqual([0, 32]);
    await forgery.expectHonestXPinned();
  } finally {
    http.close();
    forgery.pins.close();
  }
});
