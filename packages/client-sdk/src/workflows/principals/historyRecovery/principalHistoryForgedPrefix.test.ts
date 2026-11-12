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

/**
 * An honest 34-state history in which admin X serves through version 32 and
 * leaves at 33, and a self-consistent forged first page: versions 1..32 of
 * the same principal, signed by a key the server substitutes for X and
 * committing X to that substituted bundle. The forged page verifies on its
 * own but cannot connect to the honest head.
 */
async function forgedFirstPage() {
  const history = await signedRecoveryHistory(34, (version, userId) =>
    version <= 32
      ? [
          { userId, role: "admin" },
          { userId: ADMIN_X, role: "admin" },
        ]
      : [{ userId, role: "admin" }],
  );
  const [owner, honestX] = await Promise.all([
    history.resolveTrustedUserIdentity(
      history.bundle.currentState.signerUserId,
    ),
    history.resolveTrustedUserIdentity(ADMIN_X),
  ]);
  if (!owner || !honestX) throw new Error("Missing fixture identities");
  const ownerMember = history.bundle.currentProjection.find(
    (member) => member.userId === owner.userId,
  );
  if (!ownerMember) throw new Error("Missing fixture owner");
  const forgedSigning = generateSigningSeedAndKeyPair();
  const forgedX = await createFixtureUserIdentity({
    userId: ADMIN_X,
    signingPublicKey: forgedSigning.signingPublicKey,
  });
  const principalKey = generateKemSeedAndKeyPair();
  const [envelope] = await wrapDekForRecipients(principalKey.secretKey, [
    history.memberKey.publicKey,
  ]);
  if (!envelope) throw new Error("Missing fixture envelope");
  const projection = [
    ownerMember,
    {
      userId: ADMIN_X,
      role: "admin" as const,
      identityBundleFingerprint: forgedX.identityBundleFingerprint,
    },
  ];
  let forged: PrincipalPolicyBundleResponse | undefined;
  for (let version = 1; version <= 33; version += 1) {
    forged = await signedPrincipalPolicyBundle({
      memberEnvelopes: [
        {
          userId: owner.userId,
          memberKeyFingerprint: envelope.keyFingerprint,
          kemCipherText: bytesToBase64(envelope.kemCipherText),
          wrappedKey: bytesToBase64(envelope.wrappedKey),
        },
      ],
      projection,
      payloadCiphertext: "forged-recovery-fixture",
      previousStates: forged
        ? [
            ...forged.previousStates,
            {
              state: forged.currentState,
              projection: forged.currentProjection,
              grants: [],
            },
          ]
        : [],
      signing: {
        principalType: "group",
        principalId: history.bundle.currentState.principalId,
        version,
        prevStateHash: forged?.currentState.stateHash ?? null,
        keyEpoch: 1,
        encapsulationPublicKey: bytesToBase64(principalKey.publicKey),
        keyFingerprint: await toFingerprint(principalKey.publicKey),
        externalAuthority: null,
        signedAt: "2026-10-06T00:00:00.000Z",
        signerUserId: ADMIN_X,
        signerUserKeyFingerprint: forgedX.identity.signingKeyFingerprint,
      },
      signingPrivateKey: forgedSigning.signingPrivateKey,
    });
  }
  if (!forged) throw new Error("Empty forged fixture");
  const forgedEntries = forged.previousStates.slice(0, 32);
  const pins = await principalIdentityPinFixture(1);
  pins.responses.set(owner.userId, identityResponse(owner));
  pins.responses.set(ADMIN_X, identityResponse(honestX));
  let forgedOnce = false;
  return {
    history,
    pins,
    /** Serve the forged first page once, with X's substituted identity. */
    forgeFirstPage(page: {
      historyPage: { afterVersion: number };
      previousStates: PrincipalPolicyBundleResponse["previousStates"];
    }) {
      if (page.historyPage.afterVersion === 0 && !forgedOnce) {
        forgedOnce = true;
        page.previousStates = structuredClone(forgedEntries);
        pins.responses.set(ADMIN_X, forgedX.response);
        pins.api.evictUserIdentity(ADMIN_X);
      } else if (page.historyPage.afterVersion === 0) {
        pins.responses.set(ADMIN_X, identityResponse(honestX));
        pins.api.evictUserIdentity(ADMIN_X);
      }
    },
    forged: () => forgedOnce,
    async xPins() {
      return pins.execSql(
        "SELECT signing_key_fingerprint FROM trusted_user_identity_pins WHERE user_id = ?",
        [ADMIN_X],
      );
    },
    forgedFingerprint: forgedX.identity.signingKeyFingerprint,
  };
}

const protection = {
  localKey: new Uint8Array(32).fill(7),
  context: "device-and-trust-domain-1",
};

/** Recover until the corrected history succeeds or a retry is refused. */
async function recoverTwice(recover: () => Promise<unknown>) {
  try {
    await recover();
  } catch {
    // The forged prefix cannot reach the honest head; retry with honest pages.
  }
  await recover();
}

test("a forged first page pins nothing, so the corrected history still recovers", async () => {
  const run = await forgedFirstPage();
  const http = serveRecoveryHistory(run.history.bundle);
  try {
    http.controls.mutate = run.forgeFirstPage;
    await recoverTwice(() =>
      recoverPrincipalPolicyHistory({
        historyReader: http.client(),
        execSql: run.pins.execSql,
        organizationId: "org-1",
        expectedHead: principalPolicyHead(run.history.bundle),
        protection,
        resolveTrustedUserIdentity: run.pins.service.resolve,
        stillCurrent: () => true,
      }),
    );
    expect(run.forged()).toBe(true);
    expect(await run.xPins()).not.toContainEqual({
      signing_key_fingerprint: run.forgedFingerprint,
    });
  } finally {
    http.close();
    run.pins.close();
  }
});

test("a forged public first page pins nothing, so the corrected history still recovers", async () => {
  const run = await forgedFirstPage();
  const http = await createPublicHistoryFixture({
    bundle: run.history.bundle,
    resolveTrustedUserIdentity: run.pins.service.resolve,
  });
  try {
    http.controls.mutate = run.forgeFirstPage;
    await recoverTwice(() => recoverPublicPrincipalHistory(http.options));
    expect(run.forged()).toBe(true);
    expect(await run.xPins()).not.toContainEqual({
      signing_key_fingerprint: run.forgedFingerprint,
    });
  } finally {
    http.close();
    run.pins.close();
  }
});
