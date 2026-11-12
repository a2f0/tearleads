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

const ADMIN_X = "44444444-4444-4444-8444-444444444444";

function identityResponse(identity: TrustedUserIdentity) {
  return {
    userId: identity.userId,
    signingPublicKey: bytesToBase64(identity.signingPublicKey),
    signingKeyFingerprint: identity.signingKeyFingerprint,
    encapsulationPublicKey: bytesToBase64(identity.encapsulationPublicKey),
    encapsulationKeyFingerprint: identity.encapsulationKeyFingerprint,
  };
}

/**
 * Admin X founds the group and signs versions 1 and 2 with the owner as a
 * fellow admin; the owner signs version 3, which removes X. X then appears
 * only as a historical signer, in no selected projection.
 */
async function departedSignerHistory(lastXVersion = 2) {
  const base = await signedRecoveryHistory(1);
  const owner = await base.resolveTrustedUserIdentity(
    base.bundle.currentState.signerUserId,
  );
  const ownerMember = base.bundle.currentProjection[0];
  if (!owner || !ownerMember) throw new Error("Missing fixture owner");
  const xSigning = generateSigningSeedAndKeyPair();
  const honestX = await createFixtureUserIdentity({
    userId: ADMIN_X,
    signingPublicKey: xSigning.signingPublicKey,
  });
  const xMember = {
    userId: ADMIN_X,
    role: "admin" as const,
    identityBundleFingerprint: honestX.identityBundleFingerprint,
  };
  let bundle: PrincipalPolicyBundleResponse | undefined;
  for (const version of [1, 2, 3]) {
    const departed = version === 3;
    const xSigns = version <= lastXVersion;
    const principalKey = generateKemSeedAndKeyPair();
    const [envelope] = await wrapDekForRecipients(principalKey.secretKey, [
      base.memberKey.publicKey,
    ]);
    if (!envelope) throw new Error("Missing fixture envelope");
    bundle = await signedPrincipalPolicyBundle({
      memberEnvelopes: [
        {
          userId: owner.userId,
          memberKeyFingerprint: envelope.keyFingerprint,
          kemCipherText: bytesToBase64(envelope.kemCipherText),
          wrappedKey: bytesToBase64(envelope.wrappedKey),
        },
      ],
      projection: departed ? [ownerMember] : [ownerMember, xMember],
      payloadCiphertext: "departed-signer-fixture",
      previousStates: bundle
        ? [
            ...bundle.previousStates,
            {
              state: bundle.currentState,
              projection: bundle.currentProjection,
              grants: [],
            },
          ]
        : [],
      signing: {
        principalType: "group",
        principalId: base.bundle.currentState.principalId,
        version,
        prevStateHash: bundle?.currentState.stateHash ?? null,
        keyEpoch: version,
        encapsulationPublicKey: bytesToBase64(principalKey.publicKey),
        keyFingerprint: await toFingerprint(principalKey.publicKey),
        externalAuthority: null,
        signedAt: "2026-10-06T00:00:00.000Z",
        signerUserId: xSigns ? ADMIN_X : owner.userId,
        signerUserKeyFingerprint: xSigns
          ? honestX.identity.signingKeyFingerprint
          : owner.signingKeyFingerprint,
      },
      signingPrivateKey: xSigns
        ? xSigning.signingPrivateKey
        : base.signingPrivateKey,
    });
  }
  if (!bundle) throw new Error("Empty departed-signer fixture");
  const pins = await principalIdentityPinFixture(1);
  pins.responses.set(owner.userId, identityResponse(owner));
  pins.responses.set(ADMIN_X, honestX.response);
  return {
    bundle,
    pins,
    /**
     * From now on, serve X under its own signing key with a substituted
     * encapsulation key.
     */
    async substituteXEncapsulationKey() {
      const substitute = await createFixtureUserIdentity({
        userId: ADMIN_X,
        signingPublicKey: xSigning.signingPublicKey,
      });
      let reads = 0;
      const served = pins.responses.get.bind(pins.responses);
      pins.responses.get = (userId: string) => {
        if (userId !== ADMIN_X) return served(userId);
        reads += 1;
        return substitute.response;
      };
      return () => reads;
    },
    /**
     * Fail the first pin write once: the recovery fails after its pages were
     * accepted and its stage saved, before X is pinned.
     */
    failFirstPinWrite() {
      let failed = false;
      pins.afterSql((sql) => {
        if (
          !sql.startsWith("insert") ||
          !sql.includes("trusted_user_identity_pins")
        )
          return;
        pins.afterSql(undefined);
        failed = true;
        throw new Error("Injected pin write failure");
      });
      return () => failed;
    },
    async xPins() {
      return pins.execSql(
        "SELECT encapsulation_key_fingerprint FROM trusted_user_identity_pins WHERE user_id = ?",
        [ADMIN_X],
      );
    },
    async expectXPinnedAndBound() {
      expect(
        await pins.execSql(
          "SELECT provenance, signing_key_fingerprint FROM trusted_user_identity_pins WHERE user_id = ?",
          [ADMIN_X],
        ),
      ).toEqual([
        {
          provenance: "observed",
          signing_key_fingerprint: honestX.identity.signingKeyFingerprint,
        },
      ]);
      // A later substituted answer for the departed signer now conflicts.
      const substitute = await createFixtureUserIdentity({ userId: ADMIN_X });
      pins.responses.set(ADMIN_X, substitute.response);
      pins.api.evictUserIdentity(ADMIN_X);
      await expect(pins.service.resolve(ADMIN_X)).rejects.toMatchObject({
        code: "equivocation",
      });
    },
  };
}

test("cold recovery pins a departed historical signer once the head verifies", async () => {
  const run = await departedSignerHistory();
  const http = serveRecoveryHistory(run.bundle);
  try {
    await recoverPrincipalPolicyHistory({
      historyReader: http.client(),
      execSql: run.pins.execSql,
      organizationId: "org-1",
      expectedHead: principalPolicyHead(run.bundle),
      protection: {
        localKey: new Uint8Array(32).fill(7),
        context: "device-and-trust-domain-1",
      },
      resolveTrustedUserIdentity: run.pins.service.resolve,
      stillCurrent: () => true,
    });
    await run.expectXPinnedAndBound();
  } finally {
    http.close();
    run.pins.close();
  }
});

test("cold public recovery pins a departed historical signer once the head verifies", async () => {
  const run = await departedSignerHistory();
  const http = await createPublicHistoryFixture({
    bundle: run.bundle,
    resolveTrustedUserIdentity: run.pins.service.resolve,
  });
  try {
    await recoverPublicPrincipalHistory(http.options);
    await run.expectXPinnedAndBound();
  } finally {
    http.close();
    run.pins.close();
  }
});

test("a founder who signed only genesis is bound to its committed bundle at publication", async () => {
  const run = await departedSignerHistory(1);
  const pinWriteFailed = run.failFirstPinWrite();
  const http = serveRecoveryHistory(run.bundle);
  const options = {
    historyReader: http.client(),
    execSql: run.pins.execSql,
    organizationId: "org-1",
    expectedHead: principalPolicyHead(run.bundle),
    protection: {
      localKey: new Uint8Array(32).fill(7),
      context: "device-and-trust-domain-1",
    },
    resolveTrustedUserIdentity: run.pins.service.resolve,
    stillCurrent: () => true,
  };
  try {
    // Pages are collected against an honest X, then publication fails.
    await expect(recoverPrincipalPolicyHistory(options)).rejects.toBeDefined();
    expect(pinWriteFailed()).toBe(true);
    // After a restart nothing collected X, so publication reads it fresh: a
    // substituted encapsulation key must meet the founder's own commitment.
    const xReads = await run.substituteXEncapsulationKey();
    const restarted = run.pins.restart();
    await expect(
      recoverPrincipalPolicyHistory({
        ...options,
        resolveTrustedUserIdentity: restarted.service.resolve,
      }),
    ).rejects.toMatchObject({ code: "hash_mismatch" });
    expect(xReads()).toBe(1);
    expect(await run.xPins()).toEqual([]);
  } finally {
    http.close();
    run.pins.close();
  }
});

test("a recovery resumed after a failed pin write still pins the departed signer", async () => {
  const run = await departedSignerHistory();
  const pinWriteFailed = run.failFirstPinWrite();
  const http = serveRecoveryHistory(run.bundle);
  const options = {
    historyReader: http.client(),
    execSql: run.pins.execSql,
    organizationId: "org-1",
    expectedHead: principalPolicyHead(run.bundle),
    protection: {
      localKey: new Uint8Array(32).fill(7),
      context: "device-and-trust-domain-1",
    },
    resolveTrustedUserIdentity: run.pins.service.resolve,
    stillCurrent: () => true,
  };
  try {
    await expect(recoverPrincipalPolicyHistory(options)).rejects.toBeDefined();
    expect(pinWriteFailed()).toBe(true);
    expect(await run.xPins()).toEqual([]);
    // The retry resumes the saved stage rather than replaying X's pages; the
    // verifier's sealed progress still carries X for publication.
    await recoverPrincipalPolicyHistory(options);
    await run.expectXPinnedAndBound();
  } finally {
    http.close();
    run.pins.close();
  }
});

test("a public recovery resumed after a failed pin write still pins the departed signer", async () => {
  const run = await departedSignerHistory();
  const pinWriteFailed = run.failFirstPinWrite();
  const http = await createPublicHistoryFixture({
    bundle: run.bundle,
    resolveTrustedUserIdentity: run.pins.service.resolve,
  });
  try {
    await expect(
      recoverPublicPrincipalHistory(http.options),
    ).rejects.toBeDefined();
    expect(pinWriteFailed()).toBe(true);
    expect(await run.xPins()).toEqual([]);
    await recoverPublicPrincipalHistory(http.options);
    await run.expectXPinnedAndBound();
  } finally {
    http.close();
    run.pins.close();
  }
});
