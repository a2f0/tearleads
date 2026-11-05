import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  computePrincipalStateHash,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { storePrincipalState as storeVerifiedPrincipalState } from "../../../test/helpers/principalState";
import {
  createPrincipalStateSigner,
  signPrincipalState,
} from "../../../test/helpers/principalStateStoreFixtures";
import { getCurrentPrincipalState } from "../read/principalStateStore";

test("storeVerifiedPrincipalState persists signed state and epoch key", async () => {
  const { publicKey } = generateKemSeedAndKeyPair();
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const signer = await createPrincipalStateSigner(signingPublicKey);
  const principalId = crypto.randomUUID();
  const secondMemberId = crypto.randomUUID();
  const signedState = await signPrincipalState(
    {
      principalType: "group",
      principalId,
      version: 1,
      prevStateHash: null,
      keyEpoch: 1,
      encapsulationPublicKey: bytesToBase64(publicKey),
      keyFingerprint: await toFingerprint(publicKey),
      members: [{ userId: signer.signerUserId }, { userId: secondMemberId }],
      projection: [
        {
          userId: signer.signerUserId,
          role: "admin",
        },
        {
          userId: secondMemberId,
          role: "member",
        },
      ],
      signedAt: new Date("2026-04-07T12:00:00.000Z").toISOString(),
      ...signer,
    },
    signingPrivateKey,
  );

  const storedState = await storeVerifiedPrincipalState(signedState, db);

  expect(storedState.stateHash).toBe(
    await computePrincipalStateHash(signedState.state),
  );
  expect(storedState.memberCount).toBe(2);
  expect(storedState.membershipMode).toBe("projection");

  const currentState = await getCurrentPrincipalState("group", principalId, db);
  expect(currentState?.stateHash).toBe(storedState.stateHash);
  expect(currentState?.keyEpoch).toBe(1);

  // The current state's key is the principal's recipient key.
  expect(currentState?.keyFingerprint).toBe(await toFingerprint(publicKey));

  const repeatedState = await storeVerifiedPrincipalState(signedState, db);
  expect(repeatedState.stateHash).toBe(storedState.stateHash);
});

test("storeVerifiedPrincipalState rejects same-version state hash conflicts", async () => {
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const signer = await createPrincipalStateSigner(signingPublicKey);
  const { publicKey } = generateKemSeedAndKeyPair();
  const principalId = crypto.randomUUID();

  await storeVerifiedPrincipalState(
    await signPrincipalState(
      {
        principalType: "group",
        principalId,
        version: 1,
        prevStateHash: null,
        keyEpoch: 1,
        encapsulationPublicKey: bytesToBase64(publicKey),
        keyFingerprint: await toFingerprint(publicKey),
        members: [{ userId: signer.signerUserId }],
        projection: [
          {
            userId: signer.signerUserId,
            role: "admin",
          },
        ],
        signedAt: new Date("2026-04-07T12:10:00.000Z").toISOString(),
        ...signer,
      },
      signingPrivateKey,
    ),
    db,
  );

  await expect(
    storeVerifiedPrincipalState(
      await signPrincipalState(
        {
          principalType: "group",
          principalId,
          version: 1,
          prevStateHash: null,
          keyEpoch: 1,
          encapsulationPublicKey: bytesToBase64(publicKey),
          keyFingerprint: await toFingerprint(publicKey),
          members: [{ userId: signer.signerUserId }],
          projection: [
            {
              userId: signer.signerUserId,
              role: "admin",
            },
          ],
          signedAt: new Date("2026-04-07T12:11:00.000Z").toISOString(),
          ...signer,
        },
        signingPrivateKey,
      ),
      db,
    ),
  ).rejects.toThrow("Principal state version conflict");
});
