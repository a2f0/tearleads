import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import type { HeldDirectoryCitation } from "@tearleads/validators/response";
import { KNOWN_DIRECTORY_HINT_LIMIT } from "@tearleads/validators/util";
import { generateKemSeedAndKeyPair } from "../encapsulation/generateKeyPair";
import { toFingerprint } from "../fingerprint";
import {
  buildPrincipalStateSigningInput,
  computePrincipalStateHash,
  signPrincipalState,
} from "../principalState";
import { generateSigningSeedAndKeyPair } from "../signing/generateKeyPair";
import { prepareHeldProjectionCitations } from "./heldProjectionCitations";

const SIGNED_AT = "2026-11-17T00:00:00.000Z";

async function heldDirectory(
  ciphertext: string,
  principalId = "organization-1",
): Promise<HeldDirectoryCitation> {
  const signing = generateSigningSeedAndKeyPair();
  const { publicKey } = generateKemSeedAndKeyPair();
  const signed = await signPrincipalState(
    await buildPrincipalStateSigningInput({
      principalType: "organization",
      principalId,
      version: 1,
      prevStateHash: null,
      keyEpoch: 1,
      encapsulationPublicKey: bytesToBase64(publicKey),
      keyFingerprint: await toFingerprint(publicKey),
      members: [{ userId: "user-1" }],
      memberEnvelopes: [],
      projection: [],
      grants: [],
      payloadCiphertext: ciphertext,
      externalAuthority: null,
      signedAt: SIGNED_AT,
      signerUserId: "user-1",
      signerUserKeyFingerprint: "e".repeat(64),
    }),
    signing.signingPrivateKey,
  );
  const stateHash = await computePrincipalStateHash(signed);
  return {
    directoryState: { ...signed, stateHash, createdAt: SIGNED_AT },
    directoryPayload: { ciphertext },
  };
}

test("a held directory payload is cited under its signed state's hash", async () => {
  const directory = await heldDirectory("directory-v1");
  const held = await prepareHeldProjectionCitations([directory]);
  expect([...held.directories]).toEqual([
    [directory.directoryState.stateHash, directory.directoryPayload],
  ]);
  expect(held.bundles.size + held.kekLevels.size).toBe(0);
});

test("a payload its signed state does not commit is never cited", async () => {
  const directory = await heldDirectory("directory-v1");
  const held = await prepareHeldProjectionCitations([
    { ...directory, directoryPayload: { ciphertext: "directory-v2" } },
  ]);
  expect(held.directories.size).toBe(0);
});

test("a state whose hash does not recompute is never cited", async () => {
  const directory = await heldDirectory("directory-v1");
  const forged = (stateHash: string) => ({
    ...directory,
    directoryState: { ...directory.directoryState, stateHash },
  });
  const held = await prepareHeldProjectionCitations([
    forged("f".repeat(64)),
    forged("not-a-digest"),
    {
      ...directory,
      directoryState: { ...directory.directoryState, version: 2 },
    },
  ]);
  expect(held.directories.size).toBe(0);
});

test("directory citations keep the first held per state, within the hint limit", async () => {
  const directories = await Promise.all(
    Array.from({ length: KNOWN_DIRECTORY_HINT_LIMIT + 1 }, (_, index) =>
      heldDirectory(`directory-${index}`, `organization-${index}`),
    ),
  );
  const [first] = directories;
  if (!first) throw new Error("fixture missing");
  const held = await prepareHeldProjectionCitations([
    first,
    { ...first, directoryPayload: { ...first.directoryPayload } },
    ...directories.slice(1),
  ]);
  expect([...held.directories.keys()]).toEqual(
    directories
      .slice(0, KNOWN_DIRECTORY_HINT_LIMIT - 1)
      .map(({ directoryState }) => directoryState.stateHash),
  );
});

test("cited bytes are copies a later change to the source cannot reach", async () => {
  const directory = await heldDirectory("directory-v1");
  const source = structuredClone(directory);
  const held = await prepareHeldProjectionCitations([source]);
  Reflect.set(source.directoryPayload, "ciphertext", "directory-v2");
  expect(held.directories.get(directory.directoryState.stateHash)).toEqual(
    directory.directoryPayload,
  );
});

test("entries of no held kind are ignored without failing preparation", async () => {
  const uncloneable = { ...(await heldDirectory("directory-v1")) };
  Reflect.set(uncloneable.directoryPayload, "extra", () => undefined);
  const held = await prepareHeldProjectionCitations([
    null,
    1,
    "m:abc",
    {},
    { directoryState: {}, directoryPayload: {} },
    uncloneable,
  ]);
  expect(held.bundles.size + held.kekLevels.size + held.directories.size).toBe(
    0,
  );
});
