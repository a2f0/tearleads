import { expect, test } from "bun:test";
import {
  db,
  withDatabaseStatementCounter,
} from "@tearleads/api-shared/postgres";
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
import { getCurrentPrincipalState } from "../read/principalStateStore";

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

test("storeVerifiedPrincipalState keeps external authority off direct and member-bearing initial states", async () => {
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
  const initialState = async (adminUserId: string) =>
    signPrincipalState(
      {
        principalType: "group",
        principalId: crypto.randomUUID(),
        version: 1,
        prevStateHash: null,
        keyEpoch: 1,
        encapsulationPublicKey: bytesToBase64(publicKey),
        keyFingerprint: await toFingerprint(publicKey),
        members: [{ userId: adminUserId }],
        projection: [{ userId: adminUserId, role: "admin" }],
        externalAuthority,
        signedAt: "2026-04-07T12:08:00.000Z",
        ...signer,
      },
      signingKeys.signingPrivateKey,
    );
  let authorizerCalls = 0;
  const options = {
    authorizeExternalAdminSigner: async () => {
      authorizerCalls += 1;
      return true;
    },
  };

  await expect(
    storeVerifiedPrincipalState(
      await initialState(signer.signerUserId),
      db,
      options,
    ),
  ).rejects.toThrow(
    "Directly authorized principal state cannot cite external authority",
  );
  await expect(
    storeVerifiedPrincipalState(
      await initialState(
        (
          await createPrincipalStateSigner(
            generateSigningSeedAndKeyPair().signingPublicKey,
          )
        ).signerUserId,
      ),
      db,
      options,
    ),
  ).rejects.toThrow("Principal state signer must be an admin");
  expect(authorizerCalls).toBe(0);
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

test("storeVerifiedPrincipalState rejects member removal without key rotation", async () => {
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const signer = await createPrincipalStateSigner(signingPublicKey);
  const { publicKey } = generateKemSeedAndKeyPair();
  const principalId = crypto.randomUUID();
  const removedUserId = (
    await createPrincipalStateSigner(
      generateSigningSeedAndKeyPair().signingPublicKey,
    )
  ).signerUserId;
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

// No epoch-key table backs this: the transition rule on the linear version
// chain alone keeps one key per epoch.
test("storeVerifiedPrincipalState refuses a same-epoch key swap", async () => {
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const signer = await createPrincipalStateSigner(signingPublicKey);
  const principalId = crypto.randomUUID();
  const kemA = generateKemSeedAndKeyPair();
  const kemB = generateKemSeedAndKeyPair();
  const members = [{ userId: signer.signerUserId }];
  const projection = [{ userId: signer.signerUserId, role: "admin" as const }];
  const signVersion = async (input: {
    readonly keyEpoch: number;
    readonly kemPublicKey: Uint8Array;
    readonly prevStateHash: string | null;
    readonly version: number;
  }) =>
    signPrincipalState(
      {
        principalType: "group",
        principalId,
        version: input.version,
        prevStateHash: input.prevStateHash,
        keyEpoch: input.keyEpoch,
        encapsulationPublicKey: bytesToBase64(input.kemPublicKey),
        keyFingerprint: await toFingerprint(input.kemPublicKey),
        members,
        projection,
        signedAt: new Date(
          Date.UTC(2026, 3, 7, 14, input.version),
        ).toISOString(),
        ...signer,
      },
      signingPrivateKey,
    );

  const first = await storeVerifiedPrincipalState(
    await signVersion({
      keyEpoch: 1,
      kemPublicKey: kemA.publicKey,
      prevStateHash: null,
      version: 1,
    }),
    db,
  );
  await expect(
    storeVerifiedPrincipalState(
      await signVersion({
        keyEpoch: 1,
        kemPublicKey: kemB.publicKey,
        prevStateHash: first.stateHash,
        version: 2,
      }),
      db,
    ),
  ).rejects.toThrow("Principal policy key change requires a new key epoch");

  const rotationBundle = await signVersion({
    keyEpoch: 2,
    kemPublicKey: kemB.publicKey,
    prevStateHash: first.stateHash,
    version: 2,
  });
  const counter = { statements: 0 };
  const rotated = await withDatabaseStatementCounter(counter, () =>
    storeVerifiedPrincipalState(rotationBundle, db),
  );
  // PGlite / SQLite / Postgres: 9 / 11 / 11 while each store also inserted
  // its epoch-key copy; 8 / 10 / 10 after.
  expect(counter.statements).toBeLessThanOrEqual(10);
  // Swapping back to the first key inside epoch 2 is the same refusal.
  await expect(
    storeVerifiedPrincipalState(
      await signVersion({
        keyEpoch: 2,
        kemPublicKey: kemA.publicKey,
        prevStateHash: rotated.stateHash,
        version: 3,
      }),
      db,
    ),
  ).rejects.toThrow("Principal policy key change requires a new key epoch");

  const current = await getCurrentPrincipalState("group", principalId, db);
  expect(current?.version).toBe(2);
  expect(current?.keyEpoch).toBe(2);
  expect(current?.keyFingerprint).toBe(await toFingerprint(kemB.publicKey));
});
