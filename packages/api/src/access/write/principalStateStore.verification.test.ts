import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  computePrincipalContainerGrantRoot,
  computePrincipalMemberEnvelopesRoot,
  computePrincipalMembershipRoot,
  computePrincipalProjectionRoot,
  computePrincipalStatePayloadCiphertextHash,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  signPrincipalState as signPrincipalStateHeader,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { storePrincipalState as storeVerifiedPrincipalState } from "../../../test/helpers/principalState";
import {
  createPrincipalStateSigner,
  signPrincipalState,
} from "../../../test/helpers/principalStateStoreFixtures";

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

test.each(["memberCount", "grantCount", "grantRoot"] as const)(
  "storeVerifiedPrincipalState rejects signed headers whose %s does not match its projection",
  async (mismatchedArtifact) => {
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
        grantRoot:
          mismatchedArtifact === "grantRoot"
            ? "0".repeat(64)
            : await computePrincipalContainerGrantRoot([]),
        payloadCiphertextHash:
          await computePrincipalStatePayloadCiphertextHash(payloadCiphertext),
        memberCount:
          mismatchedArtifact === "memberCount"
            ? projection.length + 1
            : projection.length,
        grantCount: mismatchedArtifact === "grantCount" ? 1 : 0,
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
          grants: [],
          memberEnvelopes: [],
        },
        db,
      ),
    ).rejects.toThrow(
      mismatchedArtifact === "memberCount"
        ? "Principal state memberCount does not match projection"
        : mismatchedArtifact === "grantCount"
          ? "Principal state grantCount does not match grant projection"
          : "Principal state grantRoot does not match grant projection",
    );
  },
);
