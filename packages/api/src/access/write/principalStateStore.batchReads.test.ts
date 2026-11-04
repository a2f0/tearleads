import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
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
import {
  getCurrentPrincipalStates,
  getPrincipalStatesForReferences,
  listPrincipalProjectionMembersForStates,
  principalStateReferenceKey,
} from "../read/principalStateStore";

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
  const secondMemberId = crypto.randomUUID();
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
      userId: secondMemberId,
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
        members: [{ userId: signer.signerUserId }, { userId: secondMemberId }],
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
  ).toEqual(
    [`${secondMemberId}:member`, `${signer.signerUserId}:admin`].sort(),
  );
});
