import { expect, test } from "bun:test";
import {
  type AccessFingerprintPayload,
  computeAccessFingerprint,
} from "./accessFingerprint";

test("access fingerprints use canonical object keys and set ordering", async () => {
  const fingerprint = await computeAccessFingerprint({
    objectType: "container",
    ancestorContainerIds: ["root-container", "child-container"],
    containerId: "child-container",
    grants: [
      {
        objectId: "root-container",
        subjectType: "user",
        subjectId: "alice",
        accessLevel: "admin",
      },
      {
        objectId: "child-container",
        subjectType: "user",
        subjectId: "bob",
        accessLevel: "read",
      },
    ],
    recipients: [
      {
        principalType: "user",
        principalId: "alice",
        accessLevel: "admin",
        keyFingerprint: "alice-key",
      },
      {
        principalType: "user",
        principalId: "bob",
        accessLevel: "read",
        keyFingerprint: "bob-key",
      },
    ],
  });

  await expect(
    computeAccessFingerprint({
      recipients: [
        {
          keyFingerprint: "bob-key",
          accessLevel: "read",
          principalId: "bob",
          principalType: "user",
        },
        {
          accessLevel: "admin",
          principalType: "user",
          keyFingerprint: "alice-key",
          principalId: "alice",
        },
      ],
      grants: [
        {
          subjectId: "bob",
          objectId: "child-container",
          accessLevel: "read",
          subjectType: "user",
        },
        {
          accessLevel: "admin",
          subjectType: "user",
          objectId: "root-container",
          subjectId: "alice",
        },
      ],
      containerId: "child-container",
      objectType: "container",
      ancestorContainerIds: ["root-container", "child-container"],
    }),
  ).resolves.toBe(fingerprint);
});

test("access fingerprints preserve ordered path inputs", async () => {
  const fingerprint = await computeAccessFingerprint({
    objectType: "container",
    ancestorContainerIds: ["root-container", "child-container"],
    containerId: "child-container",
    grants: [],
    recipients: [],
  });

  await expect(
    computeAccessFingerprint({
      objectType: "container",
      ancestorContainerIds: ["child-container", "root-container"],
      containerId: "child-container",
      grants: [],
      recipients: [],
    }),
  ).resolves.not.toBe(fingerprint);
});

test("access fingerprints reject unexpected payload fields", async () => {
  const payloadWithExtraRecipientField = {
    objectType: "blob",
    blobId: "blob",
    linkedDocumentIds: ["document"],
    linkedDocumentFingerprints: ["document-fingerprint"],
    recipients: [
      {
        principalType: "user",
        principalId: "alice",
        accessLevel: "read",
        keyFingerprint: "alice-key",
        encapsulationPublicKey: "unexpected-key-material",
      },
    ],
  } as unknown as AccessFingerprintPayload;

  await expect(
    computeAccessFingerprint(payloadWithExtraRecipientField),
  ).rejects.toThrow("Access fingerprint recipient has unexpected keys");
});

test("access fingerprints reject values JSON would silently drop", async () => {
  const payloadWithUndefined = {
    objectType: "blob",
    blobId: "blob",
    linkedDocumentIds: ["document"],
    linkedDocumentFingerprints: [undefined],
    recipients: [],
  } as unknown as AccessFingerprintPayload;

  await expect(computeAccessFingerprint(payloadWithUndefined)).rejects.toThrow(
    "unsupported value type: undefined",
  );
});

test("access fingerprints reject sparse arrays", async () => {
  const payloadWithSparseArray = {
    objectType: "blob",
    blobId: "blob",
    linkedDocumentIds: Array(1),
    linkedDocumentFingerprints: ["document-fingerprint"],
    recipients: [],
  } as unknown as AccessFingerprintPayload;

  await expect(
    computeAccessFingerprint(payloadWithSparseArray),
  ).rejects.toThrow("Access fingerprint payload contains a sparse array");
});
