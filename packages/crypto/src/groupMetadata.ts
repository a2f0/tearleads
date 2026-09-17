import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { decryptWithDek, encryptWithDek } from "./symmetric";

export interface GroupMetadataKey {
  readonly organizationId: string;
  readonly containerId: string;
  readonly containerKeyEpochId: string;
  readonly keyMaterial: Uint8Array;
}

export type GroupMetadata =
  | {
      readonly format: "group-metadata-v1";
      readonly role: "admins" | "members";
    }
  | {
      readonly format: "group-metadata-v1";
      readonly organizationId: string;
      readonly groupId: string;
      readonly containerId: string;
      readonly containerKeyEpochId: string;
      readonly iv: string;
      readonly ciphertext: string;
    };

const format = "group-metadata-v1";
const encoder = new TextEncoder();

function readStringField(value: object, field: string): string {
  const result: unknown = Reflect.get(value, field);
  if (typeof result !== "string" || result.length === 0)
    throw new Error("Encrypted group metadata is invalid");
  return result;
}

export function encodeBuiltinGroupMetadata(role: "admins" | "members"): string {
  return bytesToBase64(encoder.encode(JSON.stringify({ format, role })));
}

/** Names are never accepted in the public, signed routing header. */
export function readGroupMetadata(payload: string): GroupMetadata {
  const value: unknown = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(base64ToBytes(payload)),
  );
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Reflect.get(value, "format") !== format
  ) {
    throw new Error("Group metadata format is invalid");
  }
  const role: unknown = Reflect.get(value, "role");
  if (role === "admins" || role === "members") {
    if (Object.keys(value).length !== 2)
      throw new Error("Built-in group metadata contains unexpected fields");
    return { format, role };
  }
  if (Object.keys(value).length !== 7) {
    throw new Error("Encrypted group metadata is invalid");
  }
  const metadata: GroupMetadata = {
    format,
    organizationId: readStringField(value, "organizationId"),
    groupId: readStringField(value, "groupId"),
    containerId: readStringField(value, "containerId"),
    containerKeyEpochId: readStringField(value, "containerKeyEpochId"),
    iv: readStringField(value, "iv"),
    ciphertext: readStringField(value, "ciphertext"),
  };
  if (
    base64ToBytes(metadata.iv).length !== 12 ||
    base64ToBytes(metadata.ciphertext).length < 16
  ) {
    throw new Error("Encrypted group metadata is invalid");
  }
  return metadata;
}

function context(
  input: Omit<GroupMetadataKey, "keyMaterial"> & { groupId: string },
): Uint8Array {
  return encoder.encode(
    JSON.stringify([
      "tearleads.group-metadata.v1",
      input.organizationId,
      input.groupId,
      input.containerId,
      input.containerKeyEpochId,
    ]),
  );
}

async function deriveKey(
  key: GroupMetadataKey,
  groupId: string,
): Promise<Uint8Array> {
  if (key.keyMaterial.length !== 32)
    throw new Error("Group metadata requires a 32-byte container key");
  const material = await crypto.subtle.importKey(
    "raw",
    key.keyMaterial.slice(),
    "HKDF",
    false,
    ["deriveBits"],
  );
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: new Uint8Array(),
        info: context({ ...key, groupId }).slice(),
      },
      material,
      256,
    ),
  );
}

export async function encryptGroupMetadata(input: {
  key: GroupMetadataKey;
  groupId: string;
  name: string;
}): Promise<string> {
  const encrypted = await encryptWithDek(
    encoder.encode(JSON.stringify({ name: input.name })),
    await deriveKey(input.key, input.groupId),
    context({ ...input.key, groupId: input.groupId }),
  );
  return bytesToBase64(
    encoder.encode(
      JSON.stringify({
        format,
        organizationId: input.key.organizationId,
        groupId: input.groupId,
        containerId: input.key.containerId,
        containerKeyEpochId: input.key.containerKeyEpochId,
        iv: bytesToBase64(encrypted.iv),
        ciphertext: bytesToBase64(encrypted.ciphertext),
      }),
    ),
  );
}

export async function decryptGroupMetadata(input: {
  key: GroupMetadataKey;
  groupId: string;
  payload: string;
}): Promise<string> {
  const metadata = readGroupMetadata(input.payload);
  if (
    "role" in metadata ||
    metadata.groupId !== input.groupId ||
    metadata.organizationId !== input.key.organizationId ||
    metadata.containerId !== input.key.containerId ||
    metadata.containerKeyEpochId !== input.key.containerKeyEpochId
  ) {
    throw new Error("Group metadata scope does not match");
  }
  const decrypted = await decryptWithDek(
    {
      iv: base64ToBytes(metadata.iv),
      ciphertext: base64ToBytes(metadata.ciphertext),
    },
    await deriveKey(input.key, input.groupId),
    context({ ...input.key, groupId: input.groupId }),
  );
  const value: unknown = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(decrypted),
  );
  const name: unknown =
    value && typeof value === "object" ? Reflect.get(value, "name") : undefined;
  if (
    typeof name !== "string" ||
    name.trim().length === 0 ||
    /[\p{Cc}\p{Cf}\p{Cs}\p{Default_Ignorable_Code_Point}]/u.test(name)
  )
    throw new Error("Group metadata name is invalid");
  return name;
}
