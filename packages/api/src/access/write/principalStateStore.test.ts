import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { users } from "@tearleads/api-shared/schema";
import {
  computePrincipalMemberEnvelopesRoot,
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
import {
  signPrincipalStateBundle,
  storePrincipalState as storeVerifiedPrincipalState,
} from "../../../test/helpers/principalState";
import {
  getCurrentPrincipalEpochKey,
  getCurrentPrincipalEpochKeys,
  getCurrentPrincipalState,
  getCurrentPrincipalStates,
  getPrincipalStatesForReferences,
  listPrincipalProjectionMembersForStates,
  principalStateReferenceKey,
} from "../read/principalStateStore";

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

test("storeVerifiedPrincipalState persists signed state and epoch key", async () => {
  const { publicKey } = generateKemSeedAndKeyPair();
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const signer = await createPrincipalStateSigner(signingPublicKey);
  const principalId = crypto.randomUUID();
  const nestedGroupId = crypto.randomUUID();
  const signedState = await signPrincipalState(
    {
      principalType: "group",
      principalId,
      version: 1,
      prevStateHash: null,
      keyEpoch: 1,
      encapsulationPublicKey: bytesToBase64(publicKey),
      keyFingerprint: await toFingerprint(publicKey),
      members: [{ userId: signer.signerUserId }, { userId: nestedGroupId }],
      projection: [
        {
          userId: signer.signerUserId,
          role: "admin",
        },
        {
          userId: nestedGroupId,
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

  const currentEpochKey = await getCurrentPrincipalEpochKey(
    "group",
    principalId,
    db,
  );
  expect(currentEpochKey?.epoch).toBe(1);
  expect(currentEpochKey?.introducedByStateHash).toBe(storedState.stateHash);
  expect(currentEpochKey?.keyFingerprint).toBe(await toFingerprint(publicKey));

  const repeatedState = await storeVerifiedPrincipalState(signedState, db);
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
      members: [{ userId: signer.signerUserId }],
      projection: [
        {
          userId: signer.signerUserId,
          role: "admin",
        },
      ],
      signedAt: new Date("2026-04-07T12:00:00.000Z").toISOString(),
      ...signer,
    },
    signingPrivateKey,
  );

  await expect(storeVerifiedPrincipalState(signedState, db)).rejects.toThrow(
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
      members: [{ userId: signer.signerUserId }],
      projection: [
        {
          userId: signer.signerUserId,
          role: "admin",
        },
      ],
      signedAt: new Date("2026-04-07T12:05:00.000Z").toISOString(),
      ...signer,
    },
    signingPrivateKey,
  );
  await expect(
    storeVerifiedPrincipalState(
      {
        ...signedState,
        projection: [
          ...signedState.projection,
          {
            userId: crypto.randomUUID(),
            role: "member",
          },
        ],
      },
      db,
    ),
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
      members: [{ userId: signer.signerUserId }],
      projection: [
        {
          userId: signer.signerUserId,
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
    storeVerifiedPrincipalState(
      {
        ...signedState,
        encryptedPayload: {
          ...signedState.encryptedPayload,
          ciphertext: tamperedCiphertext,
          ciphertextHash:
            await computePrincipalStatePayloadCiphertextHash(
              tamperedCiphertext,
            ),
        },
      },
      db,
    ),
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
      userId: signer.signerUserId,
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
      membershipMode: "projection",
      membershipRoot: await computePrincipalMembershipRoot([
        { userId: signer.signerUserId },
      ]),
      memberEnvelopesRoot: await computePrincipalMemberEnvelopesRoot([]),
      projectionRoot: await computePrincipalProjectionRoot(projection),
      payloadCiphertextHash:
        await computePrincipalStatePayloadCiphertextHash(payloadCiphertext),
      memberCount: projection.length + 1,
      externalAuthority: null,
      signedAt: "2026-04-07T12:07:00.000Z",
      signerUserId: signer.signerUserId,
      signerUserKeyFingerprint: signer.signerUserKeyFingerprint,
    },
    signingPrivateKey,
  );

  await expect(
    storeVerifiedPrincipalState(
      {
        state,
        encryptedPayload: {
          cipherSuite: "aes-256-gcm",
          ciphertext: payloadCiphertext,
          ciphertextHash: state.payloadCiphertextHash,
        },
        projection,
        memberEnvelopes: [],
      },
      db,
    ),
  ).rejects.toThrow("Principal state memberCount does not match projection");
});

test("storeVerifiedPrincipalState accepts empty initial states signed by authorized external admins", async () => {
  const { publicKey } = generateKemSeedAndKeyPair();
  const signingKeys = generateSigningSeedAndKeyPair();
  const signer = await createPrincipalStateSigner(signingKeys.signingPublicKey);
  const externalAuthority = {
    principalType: "group" as const,
    principalId: crypto.randomUUID(),
    version: 1,
    keyEpoch: 1,
    stateHash: crypto.randomUUID(),
    keyFingerprint: await toFingerprint(publicKey),
  };
  const signedState = await signPrincipalState(
    {
      principalType: "group",
      principalId: crypto.randomUUID(),
      version: 1,
      prevStateHash: null,
      keyEpoch: 1,
      encapsulationPublicKey: bytesToBase64(publicKey),
      keyFingerprint: await toFingerprint(publicKey),
      members: [],
      projection: [],
      externalAuthority,
      signedAt: "2026-04-07T12:08:00.000Z",
      ...signer,
    },
    signingKeys.signingPrivateKey,
  );
  await expect(storeVerifiedPrincipalState(signedState, db)).rejects.toThrow(
    "Principal state signer must be an admin",
  );
  const storedState = await storeVerifiedPrincipalState(signedState, db, {
    authorizeExternalAdminSigner: async ({ signerUserId }) =>
      signerUserId === signer.signerUserId,
  });
  expect(storedState.memberCount).toBe(0);
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
      members: [{ userId: adminSigner.signerUserId }],
      projection: [
        {
          userId: adminSigner.signerUserId,
          role: "admin",
        },
      ],
      signedAt: new Date("2026-04-07T12:08:00.000Z").toISOString(),
      ...adminSigner,
    },
    signingPrivateKey,
  );
  const storedInitialState = await storeVerifiedPrincipalState(
    initialState,
    db,
  );
  const successorState = await signPrincipalState(
    {
      principalType: "group",
      principalId,
      version: 2,
      prevStateHash: storedInitialState.stateHash,
      keyEpoch: 1,
      encapsulationPublicKey: bytesToBase64(principalKeyPair.publicKey),
      keyFingerprint: await toFingerprint(principalKeyPair.publicKey),
      members: [{ userId: outsiderSigner.signerUserId }],
      projection: [
        {
          userId: outsiderSigner.signerUserId,
          role: "admin",
        },
      ],
      signedAt: new Date("2026-04-07T12:09:00.000Z").toISOString(),
      ...outsiderSigner,
    },
    outsiderSigningPrivateKey,
  );

  await expect(storeVerifiedPrincipalState(successorState, db)).rejects.toThrow(
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

test("storeVerifiedPrincipalState rejects member removal without key rotation", async () => {
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const signer = await createPrincipalStateSigner(signingPublicKey);
  const { publicKey } = generateKemSeedAndKeyPair();
  const principalId = crypto.randomUUID();
  const removedUserId = crypto.randomUUID();
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
        members: [{ userId: signer.signerUserId }, { userId: removedUserId }],
        projection: [
          {
            userId: signer.signerUserId,
            role: "admin",
          },
          {
            userId: removedUserId,
            role: "member",
          },
        ],
        signedAt: new Date("2026-04-07T12:12:00.000Z").toISOString(),
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
          version: 2,
          prevStateHash: initialState.stateHash,
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
          signedAt: new Date("2026-04-07T12:13:00.000Z").toISOString(),
          ...signer,
        },
        signingPrivateKey,
      ),
      db,
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
  const firstKemInitial = generateKemSeedAndKeyPair();
  const firstKemCurrent = generateKemSeedAndKeyPair();
  const secondKem = generateKemSeedAndKeyPair();

  const firstStateInitial = await signPrincipalState(
    {
      principalType: "group",
      principalId: firstPrincipalId,
      version: 1,
      prevStateHash: null,
      keyEpoch: 1,
      encapsulationPublicKey: bytesToBase64(firstKemInitial.publicKey),
      keyFingerprint: await toFingerprint(firstKemInitial.publicKey),
      members: [{ userId: signer.signerUserId }],
      projection: [
        {
          userId: signer.signerUserId,
          role: "admin",
        },
      ],
      signedAt: new Date("2026-04-07T14:00:00.000Z").toISOString(),
      ...signer,
    },
    signingPrivateKey,
  );
  const storedFirstStateInitial = await storeVerifiedPrincipalState(
    firstStateInitial,
    db,
  );

  await storeVerifiedPrincipalState(
    await signPrincipalState(
      {
        principalType: "group",
        principalId: firstPrincipalId,
        version: 2,
        prevStateHash: storedFirstStateInitial.stateHash,
        keyEpoch: 2,
        encapsulationPublicKey: bytesToBase64(firstKemCurrent.publicKey),
        keyFingerprint: await toFingerprint(firstKemCurrent.publicKey),
        members: [{ userId: signer.signerUserId }],
        projection: [
          {
            userId: signer.signerUserId,
            role: "admin",
          },
        ],
        signedAt: new Date("2026-04-07T14:05:00.000Z").toISOString(),
        ...signer,
      },
      signingPrivateKey,
    ),
    db,
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
        members: [{ userId: signer.signerUserId }],
        projection: [
          {
            userId: signer.signerUserId,
            role: "admin",
          },
        ],
        signedAt: new Date("2026-04-07T14:10:00.000Z").toISOString(),
        ...signer,
      },
      signingPrivateKey,
    ),
    db,
  );

  const epochKeys = await getCurrentPrincipalEpochKeys(
    "group",
    [secondPrincipalId, firstPrincipalId, firstPrincipalId],
    db,
  );

  expect(epochKeys.get(firstPrincipalId)?.epoch).toBe(2);
  expect(epochKeys.get(firstPrincipalId)?.keyFingerprint).toBe(
    await toFingerprint(firstKemCurrent.publicKey),
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
  const firstKemInitial = generateKemSeedAndKeyPair();
  const firstKemCurrent = generateKemSeedAndKeyPair();
  const secondKem = generateKemSeedAndKeyPair();

  const firstStateInitial = await signPrincipalState(
    {
      principalType: "organization",
      principalId: firstPrincipalId,
      version: 1,
      prevStateHash: null,
      keyEpoch: 1,
      encapsulationPublicKey: bytesToBase64(firstKemInitial.publicKey),
      keyFingerprint: await toFingerprint(firstKemInitial.publicKey),
      members: [{ userId: signer.signerUserId }],
      projection: [
        {
          userId: signer.signerUserId,
          role: "admin",
        },
      ],
      signedAt: new Date("2026-04-07T15:00:00.000Z").toISOString(),
      ...signer,
    },
    signingPrivateKey,
  );
  const storedFirstStateInitial = await storeVerifiedPrincipalState(
    firstStateInitial,
    db,
  );

  await storeVerifiedPrincipalState(
    await signPrincipalState(
      {
        principalType: "organization",
        principalId: firstPrincipalId,
        version: 2,
        prevStateHash: storedFirstStateInitial.stateHash,
        keyEpoch: 2,
        encapsulationPublicKey: bytesToBase64(firstKemCurrent.publicKey),
        keyFingerprint: await toFingerprint(firstKemCurrent.publicKey),
        members: [{ userId: signer.signerUserId }],
        projection: [
          {
            userId: signer.signerUserId,
            role: "admin",
          },
        ],
        signedAt: new Date("2026-04-07T15:05:00.000Z").toISOString(),
        ...signer,
      },
      signingPrivateKey,
    ),
    db,
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
        members: [{ userId: signer.signerUserId }],
        projection: [
          {
            userId: signer.signerUserId,
            role: "admin",
          },
        ],
        signedAt: new Date("2026-04-07T15:10:00.000Z").toISOString(),
        ...signer,
      },
      signingPrivateKey,
    ),
    db,
  );

  const currentStates = await getCurrentPrincipalStates(
    "organization",
    [secondPrincipalId, firstPrincipalId, firstPrincipalId],
    db,
  );

  expect(currentStates.get(firstPrincipalId)?.version).toBe(2);
  expect(currentStates.get(firstPrincipalId)?.keyEpoch).toBe(2);
  expect(currentStates.get(secondPrincipalId)?.version).toBe(1);
  expect(currentStates.get(secondPrincipalId)?.keyEpoch).toBe(1);
});

test("getPrincipalStatesForReferences batches exact historical state lookup by referenced head", async () => {
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const signer = await createPrincipalStateSigner(signingPublicKey);
  const principalId = crypto.randomUUID();
  const firstKem = generateKemSeedAndKeyPair();
  const secondKem = generateKemSeedAndKeyPair();

  const firstState = await storeVerifiedPrincipalState(
    await signPrincipalState(
      {
        principalType: "group",
        principalId,
        version: 1,
        prevStateHash: null,
        keyEpoch: 1,
        encapsulationPublicKey: bytesToBase64(firstKem.publicKey),
        keyFingerprint: await toFingerprint(firstKem.publicKey),
        members: [{ userId: signer.signerUserId }],
        projection: [
          {
            userId: signer.signerUserId,
            role: "admin",
          },
        ],
        signedAt: new Date("2026-04-07T15:20:00.000Z").toISOString(),
        ...signer,
      },
      signingPrivateKey,
    ),
    db,
  );
  const secondState = await storeVerifiedPrincipalState(
    await signPrincipalState(
      {
        principalType: "group",
        principalId,
        version: 2,
        prevStateHash: firstState.stateHash,
        keyEpoch: 2,
        encapsulationPublicKey: bytesToBase64(secondKem.publicKey),
        keyFingerprint: await toFingerprint(secondKem.publicKey),
        members: [{ userId: signer.signerUserId }],
        projection: [
          {
            userId: signer.signerUserId,
            role: "admin",
          },
        ],
        signedAt: new Date("2026-04-07T15:25:00.000Z").toISOString(),
        ...signer,
      },
      signingPrivateKey,
    ),
    db,
  );

  const states = await getPrincipalStatesForReferences(
    [firstState, secondState, firstState],
    db,
  );

  expect(states.get(principalStateReferenceKey(firstState))?.version).toBe(1);
  expect(states.get(principalStateReferenceKey(firstState))?.stateHash).toBe(
    firstState.stateHash,
  );
  expect(states.get(principalStateReferenceKey(secondState))?.version).toBe(2);
  expect(states.get(principalStateReferenceKey(secondState))?.stateHash).toBe(
    secondState.stateHash,
  );
});

test("listPrincipalProjectionMembersForStates batches projection lookup by current state", async () => {
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const signer = await createPrincipalStateSigner(signingPublicKey);
  const firstPrincipalId = crypto.randomUUID();
  const secondPrincipalId = crypto.randomUUID();
  const firstMemberId = crypto.randomUUID();
  const nestedGroupId = crypto.randomUUID();
  const firstKem = generateKemSeedAndKeyPair();
  const secondKem = generateKemSeedAndKeyPair();
  const firstProjection = [
    {
      userId: signer.signerUserId,
      role: "admin" as const,
    },
    {
      userId: firstMemberId,
      role: "member" as const,
    },
  ];
  const secondProjection = [
    {
      userId: signer.signerUserId,
      role: "admin" as const,
    },
    {
      userId: nestedGroupId,
      role: "member" as const,
    },
  ];

  const firstState = await storeVerifiedPrincipalState(
    await signPrincipalState(
      {
        principalType: "group",
        principalId: firstPrincipalId,
        version: 1,
        prevStateHash: null,
        keyEpoch: 1,
        encapsulationPublicKey: bytesToBase64(firstKem.publicKey),
        keyFingerprint: await toFingerprint(firstKem.publicKey),
        members: [{ userId: signer.signerUserId }, { userId: firstMemberId }],
        projection: firstProjection,
        signedAt: new Date("2026-04-07T16:00:00.000Z").toISOString(),
        ...signer,
      },
      signingPrivateKey,
    ),
    db,
  );
  const secondState = await storeVerifiedPrincipalState(
    await signPrincipalState(
      {
        principalType: "group",
        principalId: secondPrincipalId,
        version: 1,
        prevStateHash: null,
        keyEpoch: 1,
        encapsulationPublicKey: bytesToBase64(secondKem.publicKey),
        keyFingerprint: await toFingerprint(secondKem.publicKey),
        members: [{ userId: signer.signerUserId }, { userId: nestedGroupId }],
        projection: secondProjection,
        signedAt: new Date("2026-04-07T16:05:00.000Z").toISOString(),
        ...signer,
      },
      signingPrivateKey,
    ),
    db,
  );

  const projections = await listPrincipalProjectionMembersForStates(
    "group",
    [secondState, firstState, firstState],
    db,
  );

  const firstKey = `${firstPrincipalId}:${firstState.stateHash}`;
  const secondKey = `${secondPrincipalId}:${secondState.stateHash}`;
  expect(
    projections
      .get(firstKey)
      ?.map((member) => `${member.userId}:${member.role}`)
      .sort(),
  ).toEqual([`${firstMemberId}:member`, `${signer.signerUserId}:admin`].sort());
  expect(
    projections
      .get(secondKey)
      ?.map((member) => `${member.userId}:${member.role}`)
      .sort(),
  ).toEqual([`${nestedGroupId}:member`, `${signer.signerUserId}:admin`].sort());
});
