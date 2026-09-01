import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";

function withDirectGrant(input: {
  accessLevel: "read" | "write" | "admin";
  createdAt: string;
  projection: ContainerWriterProjectionResponse;
  referencedPrincipalHeads: ReadonlyArray<Record<string, unknown>>;
  remoteAccessStateHash: string;
  remoteEpoch: number;
  subjectId: string;
  subjectType: "group" | "user";
  updatedAt: string;
}): ContainerWriterProjectionResponse {
  const target = input.projection.path.at(-1);
  const targetKek = input.projection.containerKeks.at(-1);
  if (!target || !targetKek) {
    throw new Error("Expected projection target.");
  }

  return {
    ...input.projection,
    createdAt: input.createdAt,
    containerKeks: [
      ...input.projection.containerKeks.slice(0, -1),
      {
        ...targetKek,
        accessManifestHash: input.remoteAccessStateHash,
      },
    ],
    path: [
      ...input.projection.path.slice(0, -1),
      {
        ...target,
        manifestHash: input.remoteAccessStateHash,
        state: {
          ...target.state,
          directGrants: [
            {
              accessLevel: input.accessLevel,
              subjectId: input.subjectId,
              subjectType: input.subjectType,
            },
          ],
          referencedPrincipalHeads: input.referencedPrincipalHeads,
          epoch: input.remoteEpoch,
        },
      },
    ],
    updatedAt: input.updatedAt,
  } as ContainerWriterProjectionResponse;
}

export function withDirectUserGrant(input: {
  accessLevel: "read" | "write" | "admin";
  createdAt: string;
  projection: ContainerWriterProjectionResponse;
  referencedPrincipalHeads?: ReadonlyArray<Record<string, unknown>>;
  remoteAccessStateHash: string;
  remoteEpoch: number;
  updatedAt: string;
  userId: string;
}): ContainerWriterProjectionResponse {
  return withDirectGrant({
    accessLevel: input.accessLevel,
    createdAt: input.createdAt,
    projection: input.projection,
    referencedPrincipalHeads: input.referencedPrincipalHeads ?? [],
    remoteAccessStateHash: input.remoteAccessStateHash,
    remoteEpoch: input.remoteEpoch,
    subjectId: input.userId,
    subjectType: "user",
    updatedAt: input.updatedAt,
  });
}

export function withDirectGroupGrant(input: {
  accessLevel: "read" | "write" | "admin";
  createdAt: string;
  groupId: string;
  pinnedKeyEpoch: number;
  projection: ContainerWriterProjectionResponse;
  remoteAccessStateHash: string;
  remoteEpoch: number;
  updatedAt: string;
}): ContainerWriterProjectionResponse {
  return withDirectGrant({
    accessLevel: input.accessLevel,
    createdAt: input.createdAt,
    projection: input.projection,
    referencedPrincipalHeads: [
      {
        keyEpoch: input.pinnedKeyEpoch,
        keyFingerprint: `group-key-fingerprint-${input.pinnedKeyEpoch}`,
        principalId: input.groupId,
        principalType: "group",
        stateHash: `group-state-hash-${input.pinnedKeyEpoch}`,
        version: input.pinnedKeyEpoch,
      },
    ],
    remoteAccessStateHash: input.remoteAccessStateHash,
    remoteEpoch: input.remoteEpoch,
    subjectId: input.groupId,
    subjectType: "group",
    updatedAt: input.updatedAt,
  });
}
