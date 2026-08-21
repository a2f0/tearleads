import { expect, test } from "bun:test";
import type { ContainerKekTarget } from "./index";
import {
  BLOB_CONTENT_KEY_WRAP_SUITE,
  CONTAINER_KEK_MATERIAL_ID_PREFIX,
  CONTAINER_KEK_PARENT_WRAP_SUITE,
  CONTAINER_KEK_USER_WRAP_SUITE,
  CONTENT_RECORD_ENCRYPTION_SUITE,
  computeContainerKekMaterialId,
  computeDocumentContentKeyTargetHash,
  computeDocumentContentRecordPlaintextHash,
  DOCUMENT_CONTENT_KEY_WRAP_SUITE,
  isContainerKekMaterialId,
  serializeKeyingCanonicalJson,
} from "./index";
import { fixtureHash } from "./testFixtures";

test("suite identifiers distinguish content records from key wrapping", () => {
  expect(CONTENT_RECORD_ENCRYPTION_SUITE).toBe(
    "aes-256-gcm-hkdf-sha256-record-key",
  );
  expect(DOCUMENT_CONTENT_KEY_WRAP_SUITE).toBe(
    "symcrypt.document.content-key-wrap.aes-256-gcm-container-kek",
  );
  expect(BLOB_CONTENT_KEY_WRAP_SUITE).toBe(
    "symcrypt.blob.content-key-wrap.aes-256-gcm-container-kek",
  );
  expect(CONTAINER_KEK_USER_WRAP_SUITE).toBe(
    "symcrypt.container-kek-wrap.ml-kem-1024-aes-256-gcm",
  );
  expect(CONTAINER_KEK_PARENT_WRAP_SUITE).toBe(
    "symcrypt.container-kek-wrap.aes-256-gcm-parent-kek",
  );
});

test("container KEK material ids commit to context and key material", async () => {
  const keyMaterial = new Uint8Array(32).fill(7);
  const id = await computeContainerKekMaterialId({
    containerId: "container-1",
    keyEpoch: 1,
    keyMaterial,
  });

  expect(id.startsWith(CONTAINER_KEK_MATERIAL_ID_PREFIX)).toBe(true);
  expect(isContainerKekMaterialId(id)).toBe(true);
  expect(
    isContainerKekMaterialId(
      `${CONTAINER_KEK_MATERIAL_ID_PREFIX}${"g".repeat(64)}`,
    ),
  ).toBe(false);
  expect(
    await computeContainerKekMaterialId({
      containerId: "container-1",
      keyEpoch: 2,
      keyMaterial,
    }),
  ).not.toBe(id);
  expect(
    await computeContainerKekMaterialId({
      containerId: "container-1",
      keyEpoch: 1,
      keyMaterial: new Uint8Array(32).fill(8),
    }),
  ).not.toBe(id);
  expect(isContainerKekMaterialId("legacy-container-key-epoch")).toBe(false);
});

test("keying canonical JSON sorts object keys deterministically", () => {
  const umlautA = "\u00e4";

  expect(
    serializeKeyingCanonicalJson({
      z: "last",
      a: { y: "why", b: "bee" },
    }),
  ).toBe(
    serializeKeyingCanonicalJson({
      a: { b: "bee", y: "why" },
      z: "last",
    }),
  );

  expect(
    serializeKeyingCanonicalJson({
      [umlautA]: "umlaut",
      z: "zed",
      a: "aye",
    }),
  ).toBe(`{"a":"aye","z":"zed","${umlautA}":"umlaut"}`);
});

test("document plaintext HMAC uses the domain-framed bytes", async () => {
  const key = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(Array.from({ length: 32 }, (_, index) => index)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  await expect(
    computeDocumentContentRecordPlaintextHash(
      new Uint8Array([0, 1, 2, 255]),
      key,
    ),
  ).resolves.toBe(
    "96a66fd34eed03a604019b1a84d92b8a29092fb45d6cfae43a0e2a44770a8ad8",
  );
});

test("keying target hashes sort arrays where ordering is a set", async () => {
  const firstTarget: ContainerKekTarget = {
    containerId: "container-a",
    containerManifestHash: await fixtureHash("container-a-manifest"),
    containerKeyEpochId: "container-a-key-epoch",
    containerKeyEpoch: 1,
  };
  const secondTarget: ContainerKekTarget = {
    containerId: "container-b",
    containerManifestHash: await fixtureHash("container-b-manifest"),
    containerKeyEpochId: "container-b-key-epoch",
    containerKeyEpoch: 1,
  };

  await expect(
    computeDocumentContentKeyTargetHash([firstTarget, secondTarget]),
  ).resolves.toBe(
    await computeDocumentContentKeyTargetHash([secondTarget, firstTarget]),
  );
});

test("keying target hashes reject duplicate canonical entries", async () => {
  const target: ContainerKekTarget = {
    containerId: "container-a",
    containerManifestHash: await fixtureHash("container-a-manifest"),
    containerKeyEpochId: "container-a-key-epoch",
    containerKeyEpoch: 1,
  };

  await expect(
    computeDocumentContentKeyTargetHash([target, target]),
  ).rejects.toThrow("document content-key targets contains a duplicate");
});
