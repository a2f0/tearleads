import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import { generateKemSeedAndKeyPair } from "./encapsulation/generateKeyPair";
import { toFingerprint } from "./fingerprint";
import { verifySignedAccessEvent } from "./keying/accessEvent";
import { encodeDomainPayload } from "./keying/canonical";
import { readSignedAt } from "./keying/shared";
import {
  createSignedContainerEvent,
  createWriteHeaderFixture,
  fixtureHash,
  signTransparencyTreeHeadFixture,
} from "./keying/testFixtures";
import { verifySignedTransparencyTreeHead } from "./keying/transparency";
import { verifyWriteHeader } from "./keying/writeHeader";
import {
  buildPrincipalStateSigningInput,
  computePrincipalStateHash,
  serializeUnsignedPrincipalState,
  signPrincipalState,
} from "./principalState";
import {
  verifySignedPrincipalState,
  verifySignedPrincipalStateResult,
} from "./principalStateVerification";
import { generateSigningSeedAndKeyPair } from "./signing/generateKeyPair";
import { sign } from "./signing/sign";
import { verify } from "./signing/verify";

// Canonical `toISOString()` output that a `timestamp` column does not store
// verbatim: two-digit-year pivot (0001-0099), pre-epoch years no honest clock
// produces, expanded years Postgres rejects, and years past 9999.
const outOfRangeTimestamps = [
  "0001-01-01T00:00:00.000Z",
  "0050-01-01T00:00:00.000Z",
  "0099-12-31T23:59:59.999Z",
  "0100-01-01T00:00:00.000Z",
  "1969-12-31T23:59:59.999Z",
  "+010000-01-01T00:00:00.000Z",
  "10000-01-01T00:00:00.000Z",
];

const nonCanonicalTimestamps = [
  "2026-09-12T00:00:00Z",
  "2026-09-12T00:00:00.0000Z",
  "2026-09-12T01:00:00.000+01:00",
  "2026-09-12",
  "2026-02-30T00:00:00.000Z",
  "invalid",
  ...outOfRangeTimestamps,
];

const boundaryTimestamps = [
  "1970-01-01T00:00:00.000Z",
  "9999-12-31T23:59:59.999Z",
];

async function createPrincipalInput() {
  const { publicKey } = generateKemSeedAndKeyPair();
  const signing = generateSigningSeedAndKeyPair();
  const input = await buildPrincipalStateSigningInput({
    principalType: "group",
    principalId: "group-1",
    version: 1,
    prevStateHash: null,
    keyEpoch: 1,
    encapsulationPublicKey: bytesToBase64(publicKey),
    keyFingerprint: await toFingerprint(publicKey),
    members: [],
    memberEnvelopes: [],
    projection: [],
    grants: [],
    payloadCiphertext: "ciphertext",
    externalAuthority: null,
    signedAt: "2026-09-12T00:00:00.000Z",
    signerUserId: "alice",
    signerUserKeyFingerprint: await toFingerprint(signing.signingPublicKey),
  });
  return { input, ...signing };
}

test("signed timestamps must survive database ISO serialization unchanged", () => {
  for (const signedAt of nonCanonicalTimestamps) {
    expect(() => readSignedAt({ signedAt }, "signedAt", "event")).toThrow(
      "event.signedAt must be",
    );
  }
  for (const signedAt of [...boundaryTimestamps, "2026-09-12T00:00:00.123Z"]) {
    expect(readSignedAt({ signedAt }, "signedAt", "event")).toBe(signedAt);
  }
});

test("out-of-range years are canonical toISOString output and still refused", () => {
  // Every vector is exactly what `Date` prints, so `toISOString() === value`
  // alone would accept it; only the range bound refuses it.
  for (const signedAt of outOfRangeTimestamps.filter(
    (value) => !value.startsWith("+") && value.length === 24,
  )) {
    expect(new Date(signedAt).toISOString()).toBe(signedAt);
  }
  expect(new Date("+010000-01-01T00:00:00.000Z").toISOString()).toBe(
    "+010000-01-01T00:00:00.000Z",
  );
});

test("principal state verification types shape failures apart from signature failures", async () => {
  const { input, signingPrivateKey, signingPublicKey } =
    await createPrincipalInput();
  const signed = await signPrincipalState(input, signingPrivateKey);
  expect(
    await verifySignedPrincipalStateResult(signed, signingPublicKey),
  ).toMatchObject({ ok: true });
  for (const signedAt of [...nonCanonicalTimestamps, ""]) {
    expect(
      await verifySignedPrincipalStateResult(
        { ...signed, signedAt },
        signingPublicKey,
      ),
    ).toMatchObject({ ok: false, error: { code: "invalid_shape" } });
  }
  // An undecodable signature is a bad signature, not a malformed header.
  expect(
    await verifySignedPrincipalStateResult(
      { ...signed, signature: "not base64!" },
      signingPublicKey,
    ),
  ).toMatchObject({ ok: false, error: { code: "signature_mismatch" } });
  const { signingPublicKey: otherPublicKey } = generateSigningSeedAndKeyPair();
  expect(
    await verifySignedPrincipalStateResult(signed, otherPublicKey),
  ).toMatchObject({ ok: false, error: { code: "signature_mismatch" } });
  for (const signedAt of boundaryTimestamps) {
    const boundary = await signPrincipalState(
      { ...input, signedAt },
      signingPrivateKey,
    );
    expect(
      await verifySignedPrincipalStateResult(boundary, signingPublicKey),
    ).toMatchObject({ ok: true });
  }
});

test("access event verification rejects a correctly signed noncanonical timestamp", async () => {
  const fixture = await createSignedContainerEvent({});
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const { signature: _signature, ...original } = fixture.event;
  const unsigned = {
    ...original,
    signedAt: "2026-09-12T00:00:00Z",
    signerKeyFingerprint: await toFingerprint(signingPublicKey),
  };
  const signature = sign(
    encodeDomainPayload("tearleads.keying.access-event-signing", unsigned),
    signingPrivateKey,
  );
  expect(
    await verifySignedAccessEvent({
      body: fixture.body,
      event: { ...unsigned, signature: bytesToBase64(signature) },
      signerPublicKey: signingPublicKey,
    }),
  ).toMatchObject({ ok: false, error: { code: "invalid_shape" } });
});

test("principal signing, hashing and verification reject noncanonical timestamps", async () => {
  const { input, signingPrivateKey, signingPublicKey } =
    await createPrincipalInput();
  const signed = await signPrincipalState(input, signingPrivateKey);
  expect(await verifySignedPrincipalState(signed, signingPublicKey)).toBe(true);
  for (const signedAt of nonCanonicalTimestamps) {
    const malformed = { ...input, signedAt };
    await expect(
      signPrincipalState(malformed, signingPrivateKey),
    ).rejects.toThrow();
    await expect(computePrincipalStateHash(malformed)).rejects.toThrow();
    expect(
      await verifySignedPrincipalState(
        { ...signed, signedAt },
        signingPublicKey,
      ),
    ).toBe(false);
  }
});

test("write headers reject correctly signed noncanonical timestamps", async () => {
  const signing = generateSigningSeedAndKeyPair();
  const header = await createWriteHeaderFixture({
    accessManifestHash: await fixtureHash("timestamp-access"),
    targetHash: await fixtureHash("timestamp-targets"),
    objectId: "document-1",
    organizationId: "organization-1",
    writerUserId: "alice",
    signing,
  });
  const { signature: _signature, ...original } = header;
  for (const signedAt of nonCanonicalTimestamps) {
    const unsigned = { ...original, signedAt };
    const signature = sign(
      encodeDomainPayload("tearleads.keying.write-header-signing", unsigned),
      signing.signingPrivateKey,
    );
    expect(
      await verifyWriteHeader({
        header: { ...unsigned, signature: bytesToBase64(signature) },
        writerPublicKey: signing.signingPublicKey,
      }),
    ).toMatchObject({ ok: false, error: { code: "invalid_shape" } });
  }
});

test("transparency heads reject correctly signed noncanonical timestamps", async () => {
  const signing = generateSigningSeedAndKeyPair();
  const { treeHead } = await signTransparencyTreeHeadFixture({
    leafHashes: [],
    signing,
  });
  const { signature: _signature, ...original } = treeHead;
  for (const signedAt of nonCanonicalTimestamps) {
    const unsigned = { ...original, signedAt };
    const signature = sign(
      encodeDomainPayload(
        "tearleads.keying.transparency-tree-head-signing",
        unsigned,
      ),
      signing.signingPrivateKey,
    );
    expect(
      await verifySignedTransparencyTreeHead({
        treeHead: { ...unsigned, signature: bytesToBase64(signature) },
        logPublicKey: signing.signingPublicKey,
      }),
    ).toMatchObject({ ok: false, error: { code: "invalid_shape" } });
  }
});

test("principal state signatures and hashes bind their signing domain", async () => {
  const { input, signingPrivateKey, signingPublicKey } =
    await createPrincipalInput();
  const serialized = await serializeUnsignedPrincipalState(input);
  expect(serialized).toStartWith('{"domain":"tearleads.principal-state",');
  const bytes = new TextEncoder().encode(serialized);
  const signature = sign(bytes, signingPrivateKey);
  expect(
    await verifySignedPrincipalState(
      { ...input, signature: bytesToBase64(signature) },
      signingPublicKey,
    ),
  ).toBe(true);
  expect(await computePrincipalStateHash(input)).toBe(
    await toFingerprint(bytes),
  );

  for (const unbound of [
    serialized.replace('"domain":"tearleads.principal-state",', ""),
    serialized.replace("tearleads.principal-state", "tearleads.other-state"),
  ]) {
    const otherBytes = new TextEncoder().encode(unbound);
    expect(verify(signature, otherBytes, signingPublicKey)).toBe(false);
    expect(await toFingerprint(otherBytes)).not.toBe(
      await computePrincipalStateHash(input),
    );
    expect(
      await verifySignedPrincipalState(
        {
          ...input,
          signature: bytesToBase64(sign(otherBytes, signingPrivateKey)),
        },
        signingPublicKey,
      ),
    ).toBe(false);
  }
});
