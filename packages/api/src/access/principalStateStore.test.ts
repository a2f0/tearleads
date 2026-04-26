import { expect, test } from "bun:test";
import {
  computePrincipalMembershipRoot,
  computePrincipalProjectionRoot,
  computePrincipalStateHash,
  computePrincipalStatePayloadCiphertextHash,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  signPrincipalState as signPrincipalStateHeader,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { signPrincipalStateBundle } from "../../test/helpers/principalState";
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

async function signPrincipalState(
  input: Omit<
    Parameters<typeof signPrincipalStateBundle>[0],
    "payloadCiphertext" | "signingPrivateKey"
  >,
  signingPrivateKey: Uint8Array,
): ReturnType<typeof signPrincipalStateBundle> {
  return signPrincipalStateBundle({
    ...input,
    payloadCiphertext: JSON.stringify({ members: input.projection }),
    signingPrivateKey,
  });
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
    await computePrincipalStateHash(signedState.state),
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

  const repeatedState = await storeVerifiedPrincipalState(signedState);
  expect(repeatedState.stateHash).toBe(storedState.stateHash);
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

test("storeVerifiedPrincipalState rejects projection roots that do not match the projection", async () => {
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
      members: [{ principalType: "user", principalId: signer.signerUserId }],
      projection: [
        {
          memberPrincipalType: "user",
          memberPrincipalId: signer.signerUserId,
          role: "admin",
        },
      ],
      signedAt: new Date("2026-04-07T12:05:00.000Z").toISOString(),
      ...signer,
    },
    signingPrivateKey,
  );

  await expect(
    storeVerifiedPrincipalState({
      ...signedState,
      projection: [
        ...signedState.projection,
        {
          memberPrincipalType: "user",
          memberPrincipalId: crypto.randomUUID(),
          role: "member",
        },
      ],
    }),
  ).rejects.toThrow("Principal state projectionRoot does not match projection");
});

test("storeVerifiedPrincipalState rejects encrypted payloads that do not match the signed header", async () => {
  const { publicKey } = generateKemSeedAndKeyPair();
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const signer = await createPrincipalStateSigner(signingPublicKey);
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
      members: [{ principalType: "user", principalId: signer.signerUserId }],
      projection: [
        {
          memberPrincipalType: "user",
          memberPrincipalId: signer.signerUserId,
          role: "admin",
        },
      ],
      signedAt: new Date("2026-04-07T12:06:00.000Z").toISOString(),
      ...signer,
    },
    signingPrivateKey,
  );
  const tamperedCiphertext = JSON.stringify({
    members: [],
    tampered: true,
  });

  await expect(
    storeVerifiedPrincipalState({
      ...signedState,
      encryptedPayload: {
        ...signedState.encryptedPayload,
        ciphertext: tamperedCiphertext,
        ciphertextHash:
          await computePrincipalStatePayloadCiphertextHash(tamperedCiphertext),
      },
    }),
  ).rejects.toThrow(
    "Principal state payloadCiphertextHash does not match encrypted payload",
  );
});

test("storeVerifiedPrincipalState rejects signed headers whose member count does not match the projection", async () => {
  const { publicKey } = generateKemSeedAndKeyPair();
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const signer = await createPrincipalStateSigner(signingPublicKey);
  const principalId = crypto.randomUUID();
  const projection = [
    {
      memberPrincipalType: "user" as const,
      memberPrincipalId: signer.signerUserId,
      role: "admin" as const,
    },
  ];
  const payloadCiphertext = JSON.stringify({ members: projection });
  const state = await signPrincipalStateHeader(
    {
      principalType: "group",
      principalId,
      version: 1,
      prevStateHash: null,
      keyEpoch: 1,
      encapsulationPublicKey: bytesToBase64(publicKey),
      keyFingerprint: await toFingerprint(publicKey),
      membershipMode: "projection_v1",
      membershipRoot: await computePrincipalMembershipRoot([
        { principalType: "user", principalId: signer.signerUserId },
      ]),
      projectionRoot: await computePrincipalProjectionRoot(projection),
      payloadCiphertextHash:
        await computePrincipalStatePayloadCiphertextHash(payloadCiphertext),
      memberCount: projection.length + 1,
      signedAt: new Date("2026-04-07T12:07:00.000Z").toISOString(),
      signerUserId: signer.signerUserId,
      signerUserKeyFingerprint: signer.signerUserKeyFingerprint,
    },
    signingPrivateKey,
  );

  await expect(
    storeVerifiedPrincipalState({
      state,
      encryptedPayload: {
        cipherSuite: "aes-256-gcm-v1",
        ciphertext: payloadCiphertext,
        ciphertextHash: state.payloadCiphertextHash,
      },
      projection,
    }),
  ).rejects.toThrow("Principal state memberCount does not match projection");
});

test("storeVerifiedPrincipalState rejects successor states signed by non-admins", async () => {
  const principalKeyPair = generateKemSeedAndKeyPair();
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const adminSigner = await createPrincipalStateSigner(signingPublicKey);
  const {
    signingPrivateKey: outsiderSigningPrivateKey,
    signingPublicKey: outsiderSigningPublicKey,
  } = generateSigningSeedAndKeyPair();
  const outsiderSigner = await createPrincipalStateSigner(
    outsiderSigningPublicKey,
  );
  const principalId = crypto.randomUUID();
  const initialState = await signPrincipalState(
    {
      principalType: "group",
      principalId,
      version: 1,
      prevStateHash: null,
      keyEpoch: 1,
      encapsulationPublicKey: bytesToBase64(principalKeyPair.publicKey),
      keyFingerprint: await toFingerprint(principalKeyPair.publicKey),
      members: [
        { principalType: "user", principalId: adminSigner.signerUserId },
      ],
      projection: [
        {
          memberPrincipalType: "user",
          memberPrincipalId: adminSigner.signerUserId,
          role: "admin",
        },
      ],
      signedAt: new Date("2026-04-07T12:08:00.000Z").toISOString(),
      ...adminSigner,
    },
    signingPrivateKey,
  );
  const storedInitialState = await storeVerifiedPrincipalState(initialState);
  const successorState = await signPrincipalState(
    {
      principalType: "group",
      principalId,
      version: 2,
      prevStateHash: storedInitialState.stateHash,
      keyEpoch: 1,
      encapsulationPublicKey: bytesToBase64(principalKeyPair.publicKey),
      keyFingerprint: await toFingerprint(principalKeyPair.publicKey),
      members: [
        { principalType: "user", principalId: outsiderSigner.signerUserId },
      ],
      projection: [
        {
          memberPrincipalType: "user",
          memberPrincipalId: outsiderSigner.signerUserId,
          role: "admin",
        },
      ],
      signedAt: new Date("2026-04-07T12:09:00.000Z").toISOString(),
      ...outsiderSigner,
    },
    outsiderSigningPrivateKey,
  );

  await expect(storeVerifiedPrincipalState(successorState)).rejects.toThrow(
    "Principal state signer must be an admin",
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

test("storeVerifiedPrincipalState rejects member removal without key rotation", async () => {
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const signer = await createPrincipalStateSigner(signingPublicKey);
  const { publicKey } = generateKemSeedAndKeyPair();
  const principalId = crypto.randomUUID();
  const initialState = await storeVerifiedPrincipalState(
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
          { principalType: "user", principalId: "removed-user" },
        ],
        projection: [
          {
            memberPrincipalType: "user",
            memberPrincipalId: signer.signerUserId,
            role: "admin",
          },
          {
            memberPrincipalType: "user",
            memberPrincipalId: "removed-user",
            role: "member",
          },
        ],
        signedAt: new Date("2026-04-07T12:12:00.000Z").toISOString(),
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
          version: 2,
          prevStateHash: initialState.stateHash,
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
          signedAt: new Date("2026-04-07T12:13:00.000Z").toISOString(),
          ...signer,
        },
        signingPrivateKey,
      ),
    ),
  ).rejects.toThrow(
    "Principal policy shrink requires a new key epoch and key material",
  );
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
