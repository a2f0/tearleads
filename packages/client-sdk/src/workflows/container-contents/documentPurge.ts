import type { DocumentPurgeResponse } from "@symcrypt/validators/response";
import type { StoredDocumentKind } from "../../data/documents/documentKinds";
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
import { ensureDocumentClientProjectionTables } from "../documents/persistence";
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

interface PurgeRemoteContainerDocumentInput {
  documentId: string;
  documentKind: StoredDocumentKind;
  noteId: string;
  persistence?: DocumentsPersistence | undefined;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContainerDocumentPurgeRuntime;
}

async function deleteAbsentDocumentState(input: {
  readonly commitPurgeProof: (
    transactionExecSql: ContainerDocumentPurgeRuntime["infra"]["execSql"],
  ) => Promise<void>;
  readonly documentId: string;
  readonly documentKind: StoredDocumentKind;
  readonly noteId: string;
  readonly persistence: DocumentsPersistence;
  readonly runtime: ContainerDocumentPurgeRuntime;
}): Promise<boolean> {
  return input.persistence.deleteDocumentSideRowsIfAbsent(
    input.runtime.infra.execSql,
    input.noteId,
    input.documentId,
    async (transactionExecSql) => {
      await input.runtime.infra.documentProjectors.deleteStoredDocumentClientProjection(
        {
          documentKind: input.documentKind,
          execSql: transactionExecSql,
          localId: input.noteId,
        },
      );
      await input.commitPurgeProof(transactionExecSql);
    },
  );
}

async function commitVerifiedDocumentPurge(input: {
  readonly commitPurgeProof: (
    transactionExecSql: ContainerDocumentPurgeRuntime["infra"]["execSql"],
  ) => Promise<void>;
  readonly documentId: string;
  readonly documentKind: StoredDocumentKind;
  readonly noteId: string;
  readonly persistence: DocumentsPersistence;
  readonly runtime: ContainerDocumentPurgeRuntime;
}): Promise<boolean> {
  await input.persistence.ensureSchema(input.runtime.infra.execSql);
  await ensureDocumentClientProjectionTables({
    documentProjectors: input.runtime.infra.documentProjectors,
    execSql: input.runtime.infra.execSql,
  });
  const expectedRecord = await input.persistence.loadDocument(
    input.runtime.infra.execSql,
    input.noteId,
  );
  if (expectedRecord && expectedRecord.documentId !== input.documentId) {
    throw new Error(
      "Local document identity changed while its remote purge was committing",
    );
  }
  const deleted = expectedRecord
    ? await deletePersistedDocument({
        beforeDeleteInTransaction: input.commitPurgeProof,
        documentProjectors: input.runtime.infra.documentProjectors,
        execSql: input.runtime.infra.execSql,
        expectedRecord,
        localId: input.noteId,
        persistence: input.persistence,
      })
    : await deleteAbsentDocumentState(input);
  if (!deleted) {
    throw new Error(
      "Local document state changed while its remote purge was committing",
    );
  }
  return true;
}

export async function purgeRemoteContainerDocument(
  input: PurgeRemoteContainerDocumentInput,
): Promise<DocumentPurgeResult> {
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
        deleted = await commitVerifiedDocumentPurge({
          commitPurgeProof,
          documentId,
          documentKind: input.documentKind,
          noteId,
          persistence,
          runtime,
        });
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
