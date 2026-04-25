import { expect, test } from "bun:test";
import {
  computePrincipalStateHash,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  signPrincipalState,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { db } from "../adapters/postgres";
import { users } from "../schema";
import {
  getCurrentPrincipalEpochKey,
  getCurrentPrincipalEpochKeys,
  getCurrentPrincipalState,
  getCurrentPrincipalStates,
  storeVerifiedPrincipalState,
} from "./principalStateStore";

async function createPrincipalStateSigner(
  signingPublicKey: Uint8Array,
): Promise<{ signerUserId: string; signerUserKeyFingerprint: string }> {
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const signerUserId = crypto.randomUUID();
  const signerUserKeyFingerprint = await toFingerprint(signingPublicKey);

  await db.insert(users).values({
    id: signerUserId,
    fingerprint: signerUserKeyFingerprint,
    signingPublicKey: bytesToBase64(signingPublicKey),
    encapsulationPublicKey: bytesToBase64(encapsulationKeyPair.publicKey),
    encapsulationKeyFingerprint: await toFingerprint(
      encapsulationKeyPair.publicKey,
    ),
    defaultOrganizationId: crypto.randomUUID(),
  });

  return { signerUserId, signerUserKeyFingerprint };
}

test("storeVerifiedPrincipalState persists the latest signed principal state and epoch key", async () => {
  const { publicKey } = generateKemSeedAndKeyPair();
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const signer = await createPrincipalStateSigner(signingPublicKey);
  const principalId = crypto.randomUUID();
  const signedState = await signPrincipalState(
    {
      principalType: "group",
      principalId,
      version: 1,
      prevStateHash: null,
      keyEpoch: 1,
      encapsulationPublicKey: bytesToBase64(publicKey),
      keyFingerprint: await toFingerprint(publicKey),
      members: [
        {
          principalType: "user",
          principalId: signer.signerUserId,
        },
        {
          principalType: "user",
          principalId: "bob",
        },
        {
          principalType: "group",
          principalId: "nested-group",
        },
      ],
      projection: [
        {
          memberPrincipalType: "user",
          memberPrincipalId: signer.signerUserId,
          role: "admin",
        },
        {
          memberPrincipalType: "group",
          memberPrincipalId: "nested-group",
          role: "member",
        },
      ],
      signedAt: new Date("2026-04-07T12:00:00.000Z").toISOString(),
      ...signer,
    },
    signingPrivateKey,
  );

  const storedState = await storeVerifiedPrincipalState(signedState);

  expect(storedState.stateHash).toBe(
    await computePrincipalStateHash(signedState),
  );
  expect(storedState.memberCount).toBe(2);
  expect(storedState.membershipMode).toBe("projection_v1");

  const currentState = await getCurrentPrincipalState("group", principalId);
  expect(currentState?.stateHash).toBe(storedState.stateHash);
  expect(currentState?.keyEpoch).toBe(1);

  const currentEpochKey = await getCurrentPrincipalEpochKey(
    "group",
    principalId,
  );
  expect(currentEpochKey?.epoch).toBe(1);
  expect(currentEpochKey?.introducedByStateHash).toBe(storedState.stateHash);
  expect(currentEpochKey?.keyFingerprint).toBe(await toFingerprint(publicKey));
});

test("storeVerifiedPrincipalState rejects invalid signatures", async () => {
  const { publicKey } = generateKemSeedAndKeyPair();
  const { signingPrivateKey } = generateSigningSeedAndKeyPair();
  const { signingPublicKey: wrongSigningPublicKey } =
    generateSigningSeedAndKeyPair();
  const signer = await createPrincipalStateSigner(wrongSigningPublicKey);
  const principalId = crypto.randomUUID();
  const signedState = await signPrincipalState(
    {
      principalType: "organization",
      principalId,
      version: 1,
      prevStateHash: null,
      keyEpoch: 1,
      encapsulationPublicKey: bytesToBase64(publicKey),
      keyFingerprint: await toFingerprint(publicKey),
      members: [
        {
          principalType: "user",
          principalId: signer.signerUserId,
        },
      ],
      projection: [
        {
          memberPrincipalType: "user",
          memberPrincipalId: signer.signerUserId,
          role: "admin",
        },
      ],
      signedAt: new Date("2026-04-07T12:00:00.000Z").toISOString(),
      ...signer,
    },
    signingPrivateKey,
  );

  await expect(storeVerifiedPrincipalState(signedState)).rejects.toThrow(
    "Invalid principal state signature",
  );
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
        members: [{ principalType: "user", principalId: signer.signerUserId }],
        projection: [
          {
            memberPrincipalType: "user",
            memberPrincipalId: signer.signerUserId,
            role: "admin",
          },
        ],
        signedAt: new Date("2026-04-07T12:10:00.000Z").toISOString(),
        ...signer,
      },
      signingPrivateKey,
    ),
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
          members: [
            { principalType: "user", principalId: signer.signerUserId },
          ],
          projection: [
            {
              memberPrincipalType: "user",
              memberPrincipalId: signer.signerUserId,
              role: "admin",
            },
          ],
          signedAt: new Date("2026-04-07T12:11:00.000Z").toISOString(),
          ...signer,
        },
        signingPrivateKey,
      ),
    ),
  ).rejects.toThrow("Principal state version conflict");
});

test("getCurrentPrincipalEpochKeys batches latest epoch-key lookup by principal id", async () => {
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const signer = await createPrincipalStateSigner(signingPublicKey);
  const firstPrincipalId = crypto.randomUUID();
  const secondPrincipalId = crypto.randomUUID();
  const firstKemV1 = generateKemSeedAndKeyPair();
  const firstKemV2 = generateKemSeedAndKeyPair();
  const secondKem = generateKemSeedAndKeyPair();

  const firstStateV1 = await signPrincipalState(
    {
      principalType: "group",
      principalId: firstPrincipalId,
      version: 1,
      prevStateHash: null,
      keyEpoch: 1,
      encapsulationPublicKey: bytesToBase64(firstKemV1.publicKey),
      keyFingerprint: await toFingerprint(firstKemV1.publicKey),
      members: [{ principalType: "user", principalId: signer.signerUserId }],
      projection: [
        {
          memberPrincipalType: "user",
          memberPrincipalId: signer.signerUserId,
          role: "admin",
        },
      ],
      signedAt: new Date("2026-04-07T14:00:00.000Z").toISOString(),
      ...signer,
    },
    signingPrivateKey,
  );
  const storedFirstStateV1 = await storeVerifiedPrincipalState(firstStateV1);

  await storeVerifiedPrincipalState(
    await signPrincipalState(
      {
        principalType: "group",
        principalId: firstPrincipalId,
        version: 2,
        prevStateHash: storedFirstStateV1.stateHash,
        keyEpoch: 2,
        encapsulationPublicKey: bytesToBase64(firstKemV2.publicKey),
        keyFingerprint: await toFingerprint(firstKemV2.publicKey),
        members: [{ principalType: "user", principalId: signer.signerUserId }],
        projection: [
          {
            memberPrincipalType: "user",
            memberPrincipalId: signer.signerUserId,
            role: "admin",
          },
        ],
        signedAt: new Date("2026-04-07T14:05:00.000Z").toISOString(),
        ...signer,
      },
      signingPrivateKey,
    ),
  );

  await storeVerifiedPrincipalState(
    await signPrincipalState(
      {
        principalType: "group",
        principalId: secondPrincipalId,
        version: 1,
        prevStateHash: null,
        keyEpoch: 1,
        encapsulationPublicKey: bytesToBase64(secondKem.publicKey),
        keyFingerprint: await toFingerprint(secondKem.publicKey),
        members: [{ principalType: "user", principalId: signer.signerUserId }],
        projection: [
          {
            memberPrincipalType: "user",
            memberPrincipalId: signer.signerUserId,
            role: "admin",
          },
        ],
        signedAt: new Date("2026-04-07T14:10:00.000Z").toISOString(),
        ...signer,
      },
      signingPrivateKey,
    ),
  );

  const epochKeys = await getCurrentPrincipalEpochKeys("group", [
    secondPrincipalId,
    firstPrincipalId,
    firstPrincipalId,
  ]);

  expect(epochKeys.get(firstPrincipalId)?.epoch).toBe(2);
  expect(epochKeys.get(firstPrincipalId)?.keyFingerprint).toBe(
    await toFingerprint(firstKemV2.publicKey),
  );
  expect(epochKeys.get(secondPrincipalId)?.epoch).toBe(1);
  expect(epochKeys.get(secondPrincipalId)?.keyFingerprint).toBe(
    await toFingerprint(secondKem.publicKey),
  );
});

test("getCurrentPrincipalStates batches latest state lookup by principal id", async () => {
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const signer = await createPrincipalStateSigner(signingPublicKey);
  const firstPrincipalId = crypto.randomUUID();
  const secondPrincipalId = crypto.randomUUID();
  const firstKemV1 = generateKemSeedAndKeyPair();
  const firstKemV2 = generateKemSeedAndKeyPair();
  const secondKem = generateKemSeedAndKeyPair();

  const firstStateV1 = await signPrincipalState(
    {
      principalType: "organization",
      principalId: firstPrincipalId,
      version: 1,
      prevStateHash: null,
      keyEpoch: 1,
      encapsulationPublicKey: bytesToBase64(firstKemV1.publicKey),
      keyFingerprint: await toFingerprint(firstKemV1.publicKey),
      members: [{ principalType: "user", principalId: signer.signerUserId }],
      projection: [
        {
          memberPrincipalType: "user",
          memberPrincipalId: signer.signerUserId,
          role: "admin",
        },
      ],
      signedAt: new Date("2026-04-07T15:00:00.000Z").toISOString(),
      ...signer,
    },
    signingPrivateKey,
  );
  const storedFirstStateV1 = await storeVerifiedPrincipalState(firstStateV1);

  await storeVerifiedPrincipalState(
    await signPrincipalState(
      {
        principalType: "organization",
        principalId: firstPrincipalId,
        version: 2,
        prevStateHash: storedFirstStateV1.stateHash,
        keyEpoch: 2,
        encapsulationPublicKey: bytesToBase64(firstKemV2.publicKey),
        keyFingerprint: await toFingerprint(firstKemV2.publicKey),
        members: [{ principalType: "user", principalId: signer.signerUserId }],
        projection: [
          {
            memberPrincipalType: "user",
            memberPrincipalId: signer.signerUserId,
            role: "admin",
          },
        ],
        signedAt: new Date("2026-04-07T15:05:00.000Z").toISOString(),
        ...signer,
      },
      signingPrivateKey,
    ),
  );

  await storeVerifiedPrincipalState(
    await signPrincipalState(
      {
        principalType: "organization",
        principalId: secondPrincipalId,
        version: 1,
        prevStateHash: null,
        keyEpoch: 1,
        encapsulationPublicKey: bytesToBase64(secondKem.publicKey),
        keyFingerprint: await toFingerprint(secondKem.publicKey),
        members: [{ principalType: "user", principalId: signer.signerUserId }],
        projection: [
          {
            memberPrincipalType: "user",
            memberPrincipalId: signer.signerUserId,
            role: "admin",
          },
        ],
        signedAt: new Date("2026-04-07T15:10:00.000Z").toISOString(),
        ...signer,
      },
      signingPrivateKey,
    ),
  );

  const currentStates = await getCurrentPrincipalStates("organization", [
    secondPrincipalId,
    firstPrincipalId,
    firstPrincipalId,
  ]);

  expect(currentStates.get(firstPrincipalId)?.version).toBe(2);
  expect(currentStates.get(firstPrincipalId)?.keyEpoch).toBe(2);
  expect(currentStates.get(secondPrincipalId)?.version).toBe(1);
  expect(currentStates.get(secondPrincipalId)?.keyEpoch).toBe(1);
});
