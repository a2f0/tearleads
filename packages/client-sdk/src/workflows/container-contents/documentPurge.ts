import type { DocumentPurgeResponse } from "@symcrypt/validators/response";
import { errorMessage } from "../../data/errorMessage";
import type { ProjectionUserKeyResolver } from "../../data/keyingProjectionVerification";
import { reportAndRethrowKeyingVerificationError } from "../../data/keyingProjectionVerification/error";
import {
  type DocumentsPersistence,
  defaultDocumentsPersistence,
  deletePersistedDocument,
  purgeRemoteDocument,
  reclaimDocumentOrphanBlobs,
  resolveDocumentCreateAuthor,
} from "../documents";
import { createRuntimePrincipalPolicyWarmer } from "../principals/runtimePolicyWarmer";
import type { ContainerContentsWorkflowRuntime } from "./runtime";

type ContainerDocumentPurgeApi = Pick<
  ContainerContentsWorkflowRuntime["apiClient"],
  | "getCurrentPrincipalPolicy"
  | "getDocumentPurgeProof"
  | "getDocumentWriterProjectionResult"
  | "purgeDocument"
>;
type DocumentPurgeResult =
  | DocumentPurgeResponse
  | {
      readonly documentId: string;
      readonly purgedAt: string;
      readonly reclaimedBlobStorageKeys: readonly string[];
    }
  | null;

interface ContainerDocumentPurgeRuntime
  extends Pick<
    ContainerContentsWorkflowRuntime,
    | "auth"
    | "crypto"
    | "infra"
    | "resolveTrustedUserIdentity"
    | "state"
    | "util"
  > {
  apiClient: ContainerDocumentPurgeApi;
}

export async function purgeRemoteContainerDocument(input: {
  documentId: string;
  noteId: string;
  persistence?: DocumentsPersistence | undefined;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContainerDocumentPurgeRuntime;
}): Promise<DocumentPurgeResult> {
  const { documentId, noteId, runtime } = input;
  const persistence = input.persistence ?? defaultDocumentsPersistence;
  try {
    const author = resolveDocumentCreateAuthor(runtime);
    if (!author) {
      runtime.util.log(
        `Container contents: failed to purge note ${noteId} because the local signing context is unavailable`,
      );
      return null;
    }
    let deleted = false;
    const response = await purgeRemoteDocument({
      apiClient: runtime.apiClient,
      author,
      documentId,
      execSql: runtime.infra.execSql,
      onVerifiedPurge: async ({ commitPurgeProof }) => {
        await persistence.ensureSchema(runtime.infra.execSql);
        const expectedRecord = await persistence.loadDocument(
          runtime.infra.execSql,
          noteId,
        );
        if (!expectedRecord) {
          await commitPurgeProof(runtime.infra.execSql);
          deleted = true;
          return;
        }
        if (expectedRecord.documentId !== documentId) {
          throw new Error(
            "Local document identity changed while its remote purge was committing",
          );
        }
        deleted = await deletePersistedDocument({
          beforeDeleteInTransaction: commitPurgeProof,
          documentProjectors: runtime.infra.documentProjectors,
          execSql: runtime.infra.execSql,
          expectedRecord,
          localId: noteId,
          persistence,
        });
        if (!deleted) {
          throw new Error(
            "Local document state changed while its remote purge was committing",
          );
        }
      },
      resolveProjectionUserKey: input.resolveProjectionUserKey,
      warmReferencedPrincipalPolicies:
        createRuntimePrincipalPolicyWarmer(runtime),
    });
    if (!response) {
      runtime.util.log(
        `Container contents: failed to purge note ${noteId} (document ${documentId})`,
      );
      return null;
    }
    if (deleted && persistence === defaultDocumentsPersistence) {
      void reclaimDocumentOrphanBlobs(runtime);
    }
    runtime.util.log(
      `Container contents: purged note ${noteId} (document ${documentId})`,
    );
    return response;
  } catch (error) {
    await reportAndRethrowKeyingVerificationError(
      error,
      runtime.util.reportSecurityIncident,
      {
        objectId: documentId,
        objectKind: "document",
        operation: "document.purge",
      },
    );
    runtime.util.log(
      `Container contents: failed to purge note ${noteId} (document ${documentId}): ${errorMessage(error)}`,
    );
    return null;
  }
}

interface ContainerDocumentLocalPurgeRuntime
  extends Pick<ContainerContentsWorkflowRuntime, "infra" | "util"> {}

export async function purgeLocalContainerDocument(input: {
  noteId: string;
  persistence?: DocumentsPersistence | undefined;
  runtime: ContainerDocumentLocalPurgeRuntime;
}): Promise<DocumentPurgeResult> {
  const { noteId, runtime } = input;
  const persistence = input.persistence ?? defaultDocumentsPersistence;
  try {
    const deleted = await deletePersistedDocument({
      documentProjectors: runtime.infra.documentProjectors,
      execSql: runtime.infra.execSql,
      localId: noteId,
      persistence,
    });
    if (deleted && persistence === defaultDocumentsPersistence) {
      void reclaimDocumentOrphanBlobs(runtime);
    }
    runtime.util.log(`Container contents: purged local-only note ${noteId}`);
    return {
      documentId: noteId,
      purgedAt: new Date().toISOString(),
      reclaimedBlobStorageKeys: [],
    };
  } catch (error) {
    runtime.util.log(
      `Container contents: failed to purge local-only note ${noteId}: ${errorMessage(error)}`,
    );
    return null;
  }
}
