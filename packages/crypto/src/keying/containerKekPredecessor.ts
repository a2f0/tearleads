import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { assertAesGcmIv, decryptWithDek, encryptWithDek } from "../symmetric";
import {
  computeKeyingDomainHash,
  serializeKeyingCanonicalJson,
} from "./canonical";
import { isContainerKekMaterialId } from "./containerKekMaterial";
import {
  assertExactKeys,
  readPositiveInteger,
  readString,
  throwVerification,
} from "./shared";
import {
  CONTAINER_KEK_PREDECESSOR_WRAP_SUITE,
  type ContainerKekPredecessorBridge,
} from "./types";

const TEXT_ENCODER = new TextEncoder();

function bridgeAdditionalData(input: {
  containerId: string;
  predecessorContainerKeyEpochId: string;
  successorContainerKeyEpochId: string;
}): Uint8Array<ArrayBuffer> {
  return TEXT_ENCODER.encode(
    serializeKeyingCanonicalJson({
      domain: "tearleads.container-kek-predecessor-bridge.aad",
      payload: {
        version: 1,
        wrappingSuite: CONTAINER_KEK_PREDECESSOR_WRAP_SUITE,
        containerId: input.containerId,
        predecessorContainerKeyEpochId: input.predecessorContainerKeyEpochId,
        successorContainerKeyEpochId: input.successorContainerKeyEpochId,
      },
    }),
  );
}

function canonicalBase64(value: string, label: string): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(value);
  } catch {
    throwVerification("invalid_shape", `${label} must be base64`);
  }
  if (bytesToBase64(bytes) !== value) {
    throwVerification("invalid_shape", `${label} must use canonical base64`);
  }
  return bytes;
}

function assertBridgeMetadata(input: {
  containerId: string;
  predecessorContainerKeyEpochId: string;
  successorContainerKeyEpochId: string;
}): void {
  if (input.containerId.length === 0) {
    throwVerification(
      "invalid_shape",
      "container KEK predecessor bridge container id must not be empty",
    );
  }
  if (
    !isContainerKekMaterialId(input.predecessorContainerKeyEpochId) ||
    !isContainerKekMaterialId(input.successorContainerKeyEpochId)
  ) {
    throwVerification(
      "invalid_shape",
      "container KEK predecessor bridge epoch ids must commit to key material",
    );
  }
  if (
    input.predecessorContainerKeyEpochId === input.successorContainerKeyEpochId
  ) {
    throwVerification(
      "key_epoch_reuse",
      "container KEK predecessor bridge must connect distinct epochs",
    );
  }
}

export function normalizeContainerKekPredecessorBridge(
  value: unknown,
): ContainerKekPredecessorBridge {
  const record = assertExactKeys(
    value,
    [
      "containerId",
      "iv",
      "predecessorContainerKeyEpochId",
      "successorContainerKeyEpochId",
      "version",
      "wrappedKey",
      "wrappingSuite",
    ],
    "container KEK predecessor bridge",
  );
  const version = readPositiveInteger(
    record,
    "version",
    "container KEK predecessor bridge",
  );
  if (version !== 1) {
    throwVerification(
      "invalid_shape",
      "container KEK predecessor bridge version is unsupported",
    );
  }
  const wrappingSuite = readString(
    record,
    "wrappingSuite",
    "container KEK predecessor bridge",
  );
  if (wrappingSuite !== CONTAINER_KEK_PREDECESSOR_WRAP_SUITE) {
    throwVerification(
      "invalid_shape",
      "container KEK predecessor bridge wrapping suite is unsupported",
    );
  }
  const bridge: ContainerKekPredecessorBridge = {
    version: 1,
    wrappingSuite: CONTAINER_KEK_PREDECESSOR_WRAP_SUITE,
    containerId: readString(
      record,
      "containerId",
      "container KEK predecessor bridge",
    ),
    predecessorContainerKeyEpochId: readString(
      record,
      "predecessorContainerKeyEpochId",
      "container KEK predecessor bridge",
    ),
    successorContainerKeyEpochId: readString(
      record,
      "successorContainerKeyEpochId",
      "container KEK predecessor bridge",
    ),
    iv: readString(record, "iv", "container KEK predecessor bridge"),
    wrappedKey: readString(
      record,
      "wrappedKey",
      "container KEK predecessor bridge",
    ),
  };
  assertBridgeMetadata(bridge);
  const iv = canonicalBase64(bridge.iv, "container KEK predecessor bridge.iv");
  assertAesGcmIv(iv, "Container KEK predecessor bridge IV must be 12 bytes");
  const wrappedKey = canonicalBase64(
    bridge.wrappedKey,
    "container KEK predecessor bridge.wrappedKey",
  );
  if (wrappedKey.byteLength !== 48) {
    throwVerification(
      "invalid_shape",
      "container KEK predecessor bridge ciphertext must be 48 bytes",
    );
  }
  return bridge;
}

export async function computeContainerKekPredecessorBridgeHash(
  value: unknown,
): Promise<string> {
  const bridge = normalizeContainerKekPredecessorBridge(value);
  return computeKeyingDomainHash(
    "tearleads.keying.container-kek-predecessor-bridge",
    {
      version: bridge.version,
      wrappingSuite: bridge.wrappingSuite,
      containerId: bridge.containerId,
      predecessorContainerKeyEpochId: bridge.predecessorContainerKeyEpochId,
      successorContainerKeyEpochId: bridge.successorContainerKeyEpochId,
      iv: bridge.iv,
      wrappedKey: bridge.wrappedKey,
    },
  );
}

export async function createContainerKekPredecessorBridge(input: {
  containerId: string;
  predecessorContainerKey: Uint8Array;
  predecessorContainerKeyEpochId: string;
  successorContainerKey: Uint8Array;
  successorContainerKeyEpochId: string;
}): Promise<ContainerKekPredecessorBridge> {
  // Move rotations may deliberately wrap the same 32-byte KEK under itself;
  // AES-GCM supports that key-dependent message in this suite. Revisit this
  // seam explicitly before substituting a different wrapping primitive.
  if (
    input.predecessorContainerKey.byteLength !== 32 ||
    input.successorContainerKey.byteLength !== 32
  ) {
    throwVerification(
      "invalid_shape",
      "container KEK predecessor bridge keys must be 32 bytes",
    );
  }
  const metadata = {
    version: 1,
    wrappingSuite: CONTAINER_KEK_PREDECESSOR_WRAP_SUITE,
    containerId: input.containerId,
    predecessorContainerKeyEpochId: input.predecessorContainerKeyEpochId,
    successorContainerKeyEpochId: input.successorContainerKeyEpochId,
  } as const;
  assertBridgeMetadata(metadata);
  const encrypted = await encryptWithDek(
    input.predecessorContainerKey,
    input.successorContainerKey,
    bridgeAdditionalData(metadata),
  );
  return {
    ...metadata,
    iv: bytesToBase64(encrypted.iv),
    wrappedKey: bytesToBase64(encrypted.ciphertext),
  };
}

export async function unwrapContainerKekPredecessorBridge(input: {
  bridge: ContainerKekPredecessorBridge;
  successorContainerKey: Uint8Array;
}): Promise<Uint8Array> {
  const bridge = normalizeContainerKekPredecessorBridge(input.bridge);
  const predecessorKey = await decryptWithDek(
    {
      iv: base64ToBytes(bridge.iv),
      ciphertext: base64ToBytes(bridge.wrappedKey),
    },
    input.successorContainerKey,
    bridgeAdditionalData(bridge),
  );
  if (predecessorKey.byteLength !== 32) {
    throwVerification(
      "invalid_shape",
      "container KEK predecessor bridge plaintext must be 32 bytes",
    );
  }
  return predecessorKey;
}
