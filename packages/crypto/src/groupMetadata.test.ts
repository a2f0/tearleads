import { expect, test } from "bun:test";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import {
  decryptGroupMetadata,
  encodeBuiltinGroupMetadata,
  encryptGroupMetadata,
  type GroupMetadataKey,
  readGroupMetadata,
} from "./groupMetadata";

const key: GroupMetadataKey = {
  organizationId: "organization-1",
  containerId: "metadata-1",
  containerKeyEpochId: "epoch-1",
  keyMaterial: crypto.getRandomValues(new Uint8Array(32)),
};

test("group names require the shared organization metadata key", async () => {
  const name = "Confidential acquisition team";
  const payload = await encryptGroupMetadata({ key, groupId: "group-1", name });
  const publicPayload = new TextDecoder().decode(base64ToBytes(payload));
  expect(publicPayload).not.toContain(name);
  expect(publicPayload).not.toContain('"name"');
  expect(await decryptGroupMetadata({ key, groupId: "group-1", payload })).toBe(
    name,
  );
  await expect(
    decryptGroupMetadata({
      key: { ...key, keyMaterial: crypto.getRandomValues(new Uint8Array(32)) },
      groupId: "group-1",
      payload,
    }),
  ).rejects.toThrow();
});

test("group metadata binds group, organization, container and epoch", async () => {
  const payload = await encryptGroupMetadata({
    key,
    groupId: "group-1",
    name: "Operators",
  });
  for (const field of [
    "organizationId",
    "containerId",
    "containerKeyEpochId",
  ] as const) {
    await expect(
      decryptGroupMetadata({
        key: { ...key, [field]: "other" },
        groupId: "group-1",
        payload,
      }),
    ).rejects.toThrow();
  }
  await expect(
    decryptGroupMetadata({ key, groupId: "group-2", payload }),
  ).rejects.toThrow();
  const metadata = readGroupMetadata(payload);
  if ("role" in metadata) throw new Error("Expected encrypted metadata");
  // Rewriting the public header cannot transfer authenticated ciphertext.
  const moved = bytesToBase64(
    new TextEncoder().encode(
      JSON.stringify({ ...metadata, groupId: "group-2" }),
    ),
  );
  await expect(
    decryptGroupMetadata({ key, groupId: "group-2", payload: moved }),
  ).rejects.toThrow();
});

test("legacy name payloads and extra public fields are rejected", () => {
  for (const value of [
    { name: "Operators", members: [] },
    { format: "group-metadata-v1", role: "admins", name: "Admins" },
  ]) {
    expect(() =>
      readGroupMetadata(
        bytesToBase64(new TextEncoder().encode(JSON.stringify(value))),
      ),
    ).toThrow();
  }
  expect(readGroupMetadata(encodeBuiltinGroupMetadata("admins"))).toEqual({
    format: "group-metadata-v1",
    role: "admins",
  });
});

test("encrypting a name twice uses independent nonces", async () => {
  const input = { key, groupId: "group-1", name: "Operators" };
  expect(await encryptGroupMetadata(input)).not.toBe(
    await encryptGroupMetadata(input),
  );
});
