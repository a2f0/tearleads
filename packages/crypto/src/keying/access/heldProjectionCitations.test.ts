import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  type ContainerKekResponse,
  containerKekWireLevel,
  type HeldDirectoryCitation,
} from "@tearleads/validators/response";
import {
  type AccessManifestBundleWireResponse,
  KNOWN_DIRECTORY_HINT_LIMIT,
  KNOWN_MANIFEST_HINT_LIMIT,
  toServedAccessManifestBundle,
} from "@tearleads/validators/util";
import { generateKemSeedAndKeyPair } from "../../encapsulation/generateKeyPair";
import { toFingerprint } from "../../primitives/fingerprint";
import {
  buildPrincipalStateSigningInput,
  computePrincipalStateHash,
  signPrincipalState,
} from "../../principalState/principalState";
import { generateSigningSeedAndKeyPair } from "../../signing/generateKeyPair";
import { computeContainerKekLevelDigest } from "../core/canonicalJsonGuard";
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

function heldBundle(manifestHash: string, objectId = "container-1") {
  const bundle: AccessManifestBundleWireResponse = {
    event: {
      event: { eventType: "container.create" },
      body: { eventType: "container.create" },
      eventHash: "e".repeat(64),
    },
    manifest: { objectId, objectKind: "container" },
    manifestHash,
    state: { containerId: objectId },
  } as AccessManifestBundleWireResponse;
  return toServedAccessManifestBundle(bundle);
}

function heldLevel(containerId = "container-1") {
  return containerKekWireLevel({
    containerId,
    accessManifestHash: "c".repeat(64),
    containerKeyEpochId: "epoch-1",
    containerKeyEpoch: 1,
    keyring: null,
    keyEpoch: { containerId, containerKeyEpochId: "epoch-1" },
    keyEpochHash: "d".repeat(64),
    keyTargetHash: "f".repeat(64),
    containerManifestHistory: [],
    parentContainerKeyEpochId: null,
    recipientTargets: [{ recipientKind: "user" }],
    wraps: [{ containerKeyEpochId: "epoch-1" }],
  } as unknown as ContainerKekResponse);
}

async function levelDigest(level: ReturnType<typeof heldLevel>) {
  const digest = await computeContainerKekLevelDigest(level);
  if (digest === null) throw new Error("fixture level is not canonical");
  return digest;
}

const digestHex = (index: number) => index.toString(16).padStart(64, "0");

test("a held bundle is cited by its manifest hash, first held first", async () => {
  const first = heldBundle("c".repeat(64));
  const held = await prepareHeldProjectionCitations([
    first,
    heldBundle("c".repeat(64), "container-2"),
    heldBundle("not-a-digest"),
  ]);
  expect([...held.bundles]).toEqual([["c".repeat(64), first]]);
  expect(held.bundles.get("c".repeat(64))).not.toBe(first);
});

test("a held KEK level is keyed by the digest of its own bytes", async () => {
  const level = heldLevel();
  const other = heldLevel("container-2");
  const held = await prepareHeldProjectionCitations([level, other, level]);
  expect([...held.kekLevels]).toEqual([
    [await levelDigest(level), level],
    [await levelDigest(other), other],
  ]);
});

test("bundles and KEK levels share one hint limit; directories have their own", async () => {
  const bundles = Array.from(
    { length: KNOWN_MANIFEST_HINT_LIMIT },
    (_, index) => heldBundle(digestHex(index + 1)),
  );
  const directory = await heldDirectory("directory-v1");
  const held = await prepareHeldProjectionCitations([
    heldLevel(),
    ...bundles,
    directory,
  ]);
  // The level takes one of the shared slots, so the last bundle travels.
  expect(held.kekLevels.size).toBe(1);
  expect([...held.bundles.keys()]).toEqual(
    bundles.slice(0, -1).map(({ manifestHash }) => manifestHash),
  );
  expect([...held.directories.keys()]).toEqual([
    directory.directoryState.stateHash,
  ]);
});
