import { base64ToBytes } from "@tearleads/encoding";
import type {
  EncapsulationKeyResponse,
  ReferencedPrincipalStateResponse,
} from "@tearleads/validators/response";
import { createDocumentSignerDeviceId } from "../../data/documents/documentConstants";
import { createProjectionUserKeyResolver } from "../../data/keyingProjectionVerification";
import type { DocumentRecord } from "../../data/sqlite/documentPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  createRemoteContainer,
  moveRemoteContainer,
  shareRemoteContainer,
} from "../containers";
import { createRemoteDocument, type DocumentCreateAuthor } from "../documents";

type ExplorerContainerWorkflowApi = Parameters<
  typeof createRemoteContainer
>[0]["apiClient"] &
  Parameters<typeof shareRemoteContainer>[0]["apiClient"] &
  Parameters<typeof moveRemoteContainer>[0]["apiClient"] &
  Parameters<typeof createRemoteDocument>[0]["apiClient"] & {
    getEncapsulationKey(
      userId: string,
    ): Promise<EncapsulationKeyResponse | null>;
  };

interface ExplorerContainerWorkflowRuntime {
  apiClient: ExplorerContainerWorkflowApi;
  encapsulationKeyPair?: {
    publicKey: Uint8Array;
    secretKey: Uint8Array;
  } | null;
  execSql: ExecSql;
  log: (message: string) => void;
  organizationId?: string | null;
  signingFingerprint?: string | null;
  signingKeyPair?:
    | {
        signingPrivateKey: Uint8Array;
        signingPublicKey: Uint8Array;
      }
    | null
    | undefined;
  userId?: string | null;
}

interface CreatedExplorerContainer {
  accessManifestHash: string;
  containerId: string;
  metadataDocumentId: string;
  organizationId: string;
  parentId: string | null;
  persistedMetadataState: Pick<
    DocumentRecord,
    | "documentId"
    | "contentKeyBundle"
    | "documentKekTargets"
    | "documentManifestBundle"
  >;
}

interface SharedExplorerContainer {
  accessEpoch: number;
  accessManifestHash: string;
  metadataDocumentId: string;
  referencedPrincipalHeads: ReferencedPrincipalStateResponse[];
}

interface RemoteExplorerContainer {
  id: string;
  metadataAccessEpoch: number;
  metadataAccessStateHash: string;
  metadataDocumentId: string;
  metadataReferencedPrincipals: ReferencedPrincipalStateResponse[];
  organizationId: string;
  parentId: string | null;
}

export function resolveExplorerWorkflowAuthor(
  runtime: ExplorerContainerWorkflowRuntime,
): DocumentCreateAuthor | null {
  if (
    !runtime.organizationId ||
    !runtime.signingFingerprint ||
    !runtime.signingKeyPair ||
    !runtime.userId
  ) {
    return null;
  }

  return {
    organizationId: runtime.organizationId,
    signerDeviceId: createDocumentSignerDeviceId(runtime.signingFingerprint),
    signerKeyFingerprint: runtime.signingFingerprint,
    signerPrivateKey: runtime.signingKeyPair.signingPrivateKey,
    signerUserId: runtime.userId,
  };
}

function readMutationMetadataDocumentId(input: {
  response: {
    accessManifest: { state: Record<string, unknown> };
  };
}): string {
  const metadataDocumentId = Reflect.get(
    input.response.accessManifest.state,
    "metadataDocumentId",
  );
  if (
    typeof metadataDocumentId !== "string" ||
    metadataDocumentId.length === 0
  ) {
    throw new Error("Container mutation response is missing metadata state");
  }

  return metadataDocumentId;
}

function referencedPrincipalHeadsFromResponse(input: {
  response: { referencedPrincipalHeads: readonly Record<string, unknown>[] };
}): ReferencedPrincipalStateResponse[] {
  return input.response.referencedPrincipalHeads.flatMap((head) => {
    const principalType = Reflect.get(head, "principalType");
    const principalId = Reflect.get(head, "principalId");
    const version = Reflect.get(head, "version");
    const keyEpoch = Reflect.get(head, "keyEpoch");
    const stateHash = Reflect.get(head, "stateHash");

    if (
      (principalType !== "group" && principalType !== "organization") ||
      typeof principalId !== "string" ||
      !Number.isInteger(version) ||
      !Number.isInteger(keyEpoch) ||
      typeof stateHash !== "string"
    ) {
      return [];
    }

    return [
      {
        principalType,
        principalId,
        version: version as number,
        keyEpoch: keyEpoch as number,
        stateHash,
      },
    ];
  });
}

export async function createRemoteExplorerContainer(input: {
  containerId: string;
  parentContainerId: string;
  runtime: ExplorerContainerWorkflowRuntime;
}): Promise<CreatedExplorerContainer | null> {
  const author = resolveExplorerWorkflowAuthor(input.runtime);
  const { apiClient } = input.runtime;
  const parentSecretKey = input.runtime.encapsulationKeyPair?.secretKey;
  if (!author || !parentSecretKey) {
    input.runtime.log(
      "Explorer: skipped container create because the writer context is unavailable.",
    );
    return null;
  }

  const createdContainer = await createRemoteContainer({
    apiClient,
    author,
    containerId: input.containerId,
    execSql: input.runtime.execSql,
    metadataDocumentId: input.containerId,
    parentContainerId: input.parentContainerId,
    parentSecretKey,
    resolveProjectionUserKey: createProjectionUserKeyResolver(
      input.runtime,
      "Explorer",
    ),
  });
  if (!createdContainer) {
    return null;
  }

  const createdMetadataDocument = await createRemoteDocument({
    apiClient,
    author,
    containerId: createdContainer.containerId,
    documentId: createdContainer.metadataDocumentId,
    execSql: input.runtime.execSql,
    resolveProjectionUserKey: createProjectionUserKeyResolver(
      input.runtime,
      "Explorer",
    ),
    targetSecretKey: parentSecretKey,
  });
  if (!createdMetadataDocument) {
    return null;
  }

  return {
    accessManifestHash: createdContainer.response.manifestHead.manifestHash,
    containerId: createdContainer.containerId,
    metadataDocumentId: createdMetadataDocument.documentId,
    organizationId: createdContainer.response.organizationId,
    parentId: createdContainer.response.parentId,
    persistedMetadataState: createdMetadataDocument.persistedState,
  };
}

export async function shareRemoteExplorerContainer(input: {
  accessLevel: "read" | "write" | "admin";
  containerId: string;
  recipientUserId: string;
  runtime: ExplorerContainerWorkflowRuntime;
}): Promise<SharedExplorerContainer | null> {
  const author = resolveExplorerWorkflowAuthor(input.runtime);
  const { apiClient } = input.runtime;
  const targetSecretKey = input.runtime.encapsulationKeyPair?.secretKey;
  if (!author || !targetSecretKey) {
    input.runtime.log(
      "Explorer: skipped container share because the writer context is unavailable.",
    );
    return null;
  }

  const recipientKey = await input.runtime.apiClient.getEncapsulationKey(
    input.recipientUserId,
  );
  if (!recipientKey) {
    return null;
  }

  const shared = await shareRemoteContainer({
    accessLevel: input.accessLevel,
    apiClient,
    author,
    containerId: input.containerId,
    execSql: input.runtime.execSql,
    recipientEncapsulationPublicKey: base64ToBytes(
      recipientKey.encapsulationPublicKey,
    ),
    recipientUserId: input.recipientUserId,
    resolveProjectionUserKey: createProjectionUserKeyResolver(
      input.runtime,
      "Explorer",
    ),
    targetSecretKey,
  });
  if (!shared) {
    return null;
  }

  return {
    accessManifestHash: shared.response.manifestHead.manifestHash,
    accessEpoch: shared.response.manifestHead.epoch,
    metadataDocumentId: readMutationMetadataDocumentId({
      response: shared.response,
    }),
    referencedPrincipalHeads: referencedPrincipalHeadsFromResponse({
      response: shared.response,
    }),
  };
}

export async function moveRemoteExplorerContainer(input: {
  containerId: string;
  parentContainerId: string;
  runtime: ExplorerContainerWorkflowRuntime;
}): Promise<RemoteExplorerContainer | null> {
  const author = resolveExplorerWorkflowAuthor(input.runtime);
  const { apiClient } = input.runtime;
  const targetSecretKey = input.runtime.encapsulationKeyPair?.secretKey;
  if (!author || !targetSecretKey) {
    input.runtime.log(
      "Explorer: skipped container move because the writer context is unavailable.",
    );
    return null;
  }

  const moved = await moveRemoteContainer({
    apiClient,
    author,
    containerId: input.containerId,
    destinationParentContainerId: input.parentContainerId,
    execSql: input.runtime.execSql,
    resolveProjectionUserKey: createProjectionUserKeyResolver(
      input.runtime,
      "Explorer",
    ),
    targetSecretKey,
  });
  if (!moved) {
    return null;
  }

  return {
    id: moved.response.containerId,
    organizationId: moved.response.organizationId,
    parentId: moved.response.parentId,
    metadataDocumentId: readMutationMetadataDocumentId({
      response: moved.response,
    }),
    metadataAccessEpoch: moved.response.manifestHead.epoch,
    metadataAccessStateHash: moved.response.manifestHead.manifestHash,
    metadataReferencedPrincipals: referencedPrincipalHeadsFromResponse({
      response: moved.response,
    }),
  };
}
