import type { ProjectionUserKeyResolver } from "../../data/keyingProjectionVerification";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  type RelinkRemoteDocumentResult,
  relinkRemoteDocument,
  resolveDocumentCreateAuthor,
} from "../documents";

type ExplorerDocumentLinkApi = Parameters<
  typeof relinkRemoteDocument
>[0]["apiClient"];
type ExplorerDocumentLinkOperation = Parameters<
  typeof relinkRemoteDocument
>[0]["operation"];

interface ExplorerDocumentLinkRuntime {
  apiClient: ExplorerDocumentLinkApi;
  encapsulationKeyPair?: { secretKey: Uint8Array } | null;
  execSql: ExecSql;
  log: (message: string) => void;
  organizationId?: string | null;
  signingFingerprint?: string | null;
  signingKeyPair?:
    | {
        signingPrivateKey: Uint8Array;
      }
    | null
    | undefined;
  userId?: string | null;
}

export async function relinkRemoteExplorerDocument(input: {
  documentId: string;
  noteId: string;
  operation: ExplorerDocumentLinkOperation;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ExplorerDocumentLinkRuntime;
  targetContainerId: string;
}): Promise<RelinkRemoteDocumentResult | null> {
  const { documentId, noteId, operation, runtime, targetContainerId } = input;
  const author = resolveDocumentCreateAuthor(runtime);
  const targetSecretKey = runtime.encapsulationKeyPair?.secretKey;
  if (!author || !targetSecretKey) {
    runtime.log(
      "Explorer: document mutation skipped because the local key context is unavailable",
    );
    return null;
  }

  try {
    const result = await relinkRemoteDocument({
      apiClient: runtime.apiClient,
      author,
      documentId,
      execSql: runtime.execSql,
      operation,
      resolveProjectionUserKey: input.resolveProjectionUserKey,
      targetContainerId,
      targetSecretKey,
    });
    if (!result) {
      runtime.log(
        `Explorer: failed to ${operation} note ${noteId} ${operation === "link" ? "to" : "from"} container ${targetContainerId}`,
      );
      return null;
    }

    return result;
  } catch (error) {
    runtime.log(
      `Explorer: failed to ${operation} note ${noteId} ${operation === "link" ? "to" : "from"} container ${targetContainerId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}
