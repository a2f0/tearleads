import {
  type containerKeyEpochs,
  containerKeyWraps,
} from "@tearleads/api-shared/schema";
import type {
  ContainerKekKeyring,
  ContainerKekPredecessorBridge,
  ContainerKeyEpoch,
  ContainerKeyWrap,
} from "@tearleads/crypto";
import {
  CONTAINER_KEK_KEYRING_SEAL_SUITE,
  CONTAINER_KEK_PREDECESSOR_WRAP_SUITE,
} from "@tearleads/crypto";
import { and, eq } from "drizzle-orm";

export interface StoredContainerKeyEpoch extends ContainerKeyEpoch {
  readonly createdAt: Date;
  readonly keyring: ContainerKekKeyring | null;
  readonly predecessorBridge: ContainerKekPredecessorBridge | null;
}

export interface StoredContainerKeyWrap extends ContainerKeyWrap {
  readonly id: string;
  readonly createdAt: Date;
}

function predecessorBridgeFromRow(
  row: typeof containerKeyEpochs.$inferSelect,
): ContainerKekPredecessorBridge | null {
  const predecessorId = row.predecessorContainerKeyEpochId;
  const bridgeVersion = row.predecessorBridgeVersion;
  const bridgeSuite = row.predecessorBridgeSuite;
  const bridgeIv = row.predecessorBridgeIv;
  const wrappedPredecessorKey = row.wrappedPredecessorKey;
  if (
    predecessorId === null &&
    bridgeVersion === null &&
    bridgeSuite === null &&
    bridgeIv === null &&
    wrappedPredecessorKey === null
  ) {
    return null;
  }
  if (
    predecessorId === null ||
    bridgeVersion === null ||
    bridgeSuite === null ||
    bridgeIv === null ||
    wrappedPredecessorKey === null
  ) {
    throw new Error("Container key predecessor bridge is incomplete");
  }
  if (
    bridgeVersion !== 1 ||
    bridgeSuite !== CONTAINER_KEK_PREDECESSOR_WRAP_SUITE
  ) {
    throw new Error("Container key predecessor bridge suite is unsupported");
  }

  return {
    version: 1,
    wrappingSuite: CONTAINER_KEK_PREDECESSOR_WRAP_SUITE,
    containerId: row.containerId,
    predecessorContainerKeyEpochId: predecessorId,
    successorContainerKeyEpochId: row.id,
    iv: bridgeIv,
    wrappedKey: wrappedPredecessorKey,
  };
}

function keyringFromRow(
  row: typeof containerKeyEpochs.$inferSelect,
): ContainerKekKeyring | null {
  const keyringIv = row.keyringIv;
  const sealedKeyring = row.sealedKeyring;
  if (keyringIv === null && sealedKeyring === null) {
    return null;
  }
  if (keyringIv === null || sealedKeyring === null) {
    throw new Error("Container KEK keyring is incomplete");
  }

  return {
    version: 1,
    sealingSuite: CONTAINER_KEK_KEYRING_SEAL_SUITE,
    containerId: row.containerId,
    containerKeyEpochId: row.id,
    iv: keyringIv,
    sealed: sealedKeyring,
  };
}

export function toStoredContainerKeyEpoch(
  row: typeof containerKeyEpochs.$inferSelect,
): StoredContainerKeyEpoch {
  return {
    id: row.id,
    containerId: row.containerId,
    keyEpoch: row.keyEpoch,
    accessManifestHash: row.accessManifestHash,
    parentContainerKeyEpochId: row.parentContainerKeyEpochId,
    createdByEventHash: row.createdByEventHash,
    createdByManifestHash: row.createdByManifestHash,
    createdAt: row.createdAt,
    keyring: keyringFromRow(row),
    predecessorBridge: predecessorBridgeFromRow(row),
  };
}

export function predecessorBridgesEqual(
  left: ContainerKekPredecessorBridge | null,
  right: ContainerKekPredecessorBridge | null,
): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return (
    left.version === right.version &&
    left.wrappingSuite === right.wrappingSuite &&
    left.containerId === right.containerId &&
    left.predecessorContainerKeyEpochId ===
      right.predecessorContainerKeyEpochId &&
    left.successorContainerKeyEpochId === right.successorContainerKeyEpochId &&
    left.iv === right.iv &&
    left.wrappedKey === right.wrappedKey
  );
}

export function keyringsEqual(
  left: ContainerKekKeyring | null,
  right: ContainerKekKeyring | null,
): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return (
    left.version === right.version &&
    left.sealingSuite === right.sealingSuite &&
    left.containerId === right.containerId &&
    left.containerKeyEpochId === right.containerKeyEpochId &&
    left.iv === right.iv &&
    left.sealed === right.sealed
  );
}

export function toStoredContainerKeyWrap(
  row: typeof containerKeyWraps.$inferSelect,
): StoredContainerKeyWrap {
  return {
    id: row.id,
    containerKeyEpochId: row.containerKeyEpochId,
    recipientKind: row.recipientKind,
    recipientId: row.recipientId,
    recipientKeyEpochId: row.recipientKeyEpochId,
    recipientKeyFingerprint: row.recipientKeyFingerprint,
    kemCipherText: row.kemCipherText,
    wrappedKey: row.wrappedKey,
    wrapManifestHash: row.wrapManifestHash,
    createdAt: row.createdAt,
  };
}

export function toContainerKeyEpoch(
  storedEpoch: StoredContainerKeyEpoch,
): ContainerKeyEpoch {
  return {
    id: storedEpoch.id,
    containerId: storedEpoch.containerId,
    keyEpoch: storedEpoch.keyEpoch,
    accessManifestHash: storedEpoch.accessManifestHash,
    parentContainerKeyEpochId: storedEpoch.parentContainerKeyEpochId,
    createdByEventHash: storedEpoch.createdByEventHash,
    createdByManifestHash: storedEpoch.createdByManifestHash,
  };
}

export function toContainerKeyWrap(
  storedWrap: StoredContainerKeyWrap,
): ContainerKeyWrap {
  return {
    containerKeyEpochId: storedWrap.containerKeyEpochId,
    recipientKind: storedWrap.recipientKind,
    recipientId: storedWrap.recipientId,
    recipientKeyEpochId: storedWrap.recipientKeyEpochId,
    recipientKeyFingerprint: storedWrap.recipientKeyFingerprint,
    kemCipherText: storedWrap.kemCipherText,
    wrappedKey: storedWrap.wrappedKey,
    wrapManifestHash: storedWrap.wrapManifestHash,
  };
}

export function containerKeyWrapConflictWhere(wrap: ContainerKeyWrap) {
  return and(
    eq(containerKeyWraps.containerKeyEpochId, wrap.containerKeyEpochId),
    eq(containerKeyWraps.recipientKind, wrap.recipientKind),
    eq(containerKeyWraps.recipientId, wrap.recipientId),
    eq(containerKeyWraps.recipientKeyEpochId, wrap.recipientKeyEpochId),
  );
}

export interface ContainerKeyWrapConflictTarget {
  readonly containerKeyEpochId: string;
  readonly recipientKind: ContainerKeyWrap["recipientKind"];
  readonly recipientId: string;
  readonly recipientKeyEpochId: string;
}

export function containerKeyWrapConflictKey(
  wrap: ContainerKeyWrapConflictTarget,
): string {
  return [
    wrap.containerKeyEpochId,
    wrap.recipientKind,
    wrap.recipientId,
    wrap.recipientKeyEpochId,
  ].join(":");
}
