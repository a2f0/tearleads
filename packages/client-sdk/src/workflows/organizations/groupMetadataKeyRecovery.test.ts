import { expect, test } from "bun:test";
import {
  computeContainerKekMaterialId,
  generateKemSeedAndKeyPair,
  toFingerprint,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { createTestExecSql } from "@tearleads/test-utils";
import { recoverGroupMetadataReadKey } from "./groupMetadataKeyRecovery";

test("key-log recovery accepts only the material committed by the signed group", async () => {
  const { close, execSql } = await createTestExecSql("group-name-log-recovery");
  try {
    const identity = generateKemSeedAndKeyPair();
    const keyMaterial = crypto.getRandomValues(new Uint8Array(32));
    const containerId = "metadata-container";
    const containerKeyEpochId = await computeContainerKekMaterialId({
      containerId,
      keyEpoch: 1,
      keyMaterial,
    });
    const envelope = async (key: Uint8Array) => {
      const [wrap] = await wrapDekForRecipients(key, [identity.publicKey]);
      if (!wrap) throw new Error("Expected key wrap");
      return {
        containerKeyEpochId,
        recipientKind: "user",
        recipientId: "reader",
        recipientKeyEpochId: "reader-key",
        recipientKeyFingerprint: await toFingerprint(identity.publicKey),
        kemCipherText: bytesToBase64(wrap.kemCipherText),
        wrappedKey: bytesToBase64(wrap.wrappedKey),
        wrapManifestHash: "manifest",
      };
    };
    const epoch = {
      accessManifestHash: "manifest",
      bridge: null,
      containerKeyEpoch: 1,
      containerKeyEpochId,
      keyring: null,
      parentContainerKeyEpochId: null,
      wraps: [await envelope(keyMaterial)],
    };
    const log = { containerId, epochs: [epoch], hasMore: false };
    const input = {
      apiClient: { getContainerKekLog: async () => log },
      execSql,
      metadata: { organizationId: "org", containerId, containerKeyEpochId },
      targetSecretKey: identity.secretKey,
      warmKeys: async () => {},
      stillCurrent: () => true,
    };
    await expect(recoverGroupMetadataReadKey(input)).resolves.toEqual(
      keyMaterial,
    );
    epoch.wraps = [await envelope(crypto.getRandomValues(new Uint8Array(32)))];
    await expect(recoverGroupMetadataReadKey(input)).rejects.toThrow(
      "key is unavailable",
    );
    epoch.wraps = [await envelope(keyMaterial)];
    await expect(
      recoverGroupMetadataReadKey({
        ...input,
        metadata: { ...input.metadata, containerKeyEpochId: "forged-epoch" },
      }),
    ).rejects.toThrow("absent");
    await expect(
      recoverGroupMetadataReadKey({ ...input, stillCurrent: () => false }),
    ).rejects.toThrow();
  } finally {
    close();
  }
});
