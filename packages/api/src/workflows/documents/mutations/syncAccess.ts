import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import type { PrincipalPolicyAuthorization } from "@tearleads/crypto";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import {
  type ContainerAccessProjection,
  type ContainerWriterProjectionContext,
  ContainerWriterProjectionError,
  createContainerWriterProjectionContext,
  resolveContainerAccessProjection,
} from "../../containers/writerProjection";
import { DocumentMutationError } from "./errors";

export interface VerifiedDocumentAccessResult {
  readonly access: ContainerAccessProjection;
  readonly context: ContainerWriterProjectionContext;
}

export async function ensureCurrentDocumentAccess(input: {
  /** The document's linked container ids, in link order. */
  readonly containerIds: readonly string[];
  readonly context?: ContainerWriterProjectionContext | undefined;
  readonly executor: DatabaseTransaction;
  readonly minimumAccessLevel: "read" | "write";
  readonly userId: string;
  readonly verifiedPrincipalPolicies?:
    | readonly PrincipalPolicyAuthorization[]
    | undefined;
}): Promise<VerifiedDocumentAccessResult> {
  const context =
    input.context ??
    createContainerWriterProjectionContext(
      input.executor,
      input.verifiedPrincipalPolicies,
    );

  for (const containerId of new Set(input.containerIds)) {
    try {
      const access = await resolveContainerAccessProjection({
        containerId,
        context,
        executor: input.executor,
        minimumAccessLevel: input.minimumAccessLevel,
        userId: input.userId,
      });
      return { access, context };
    } catch (error) {
      if (
        error instanceof ContainerWriterProjectionError &&
        error.status === 403
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new DocumentMutationError("Forbidden", 403);
}

export async function ensureSyncDocumentAccess(input: {
  readonly containerIds: readonly string[];
  readonly context?: ContainerWriterProjectionContext | undefined;
  readonly executor: DatabaseTransaction;
  readonly request: DocumentSyncRequest;
  readonly userId: string;
  readonly verifiedPrincipalPolicies?:
    | readonly PrincipalPolicyAuthorization[]
    | undefined;
}): Promise<VerifiedDocumentAccessResult> {
  // Empty sync requests only pull missing updates, so read access is enough.
  const minimumAccessLevel =
    input.request.outgoingUpdates.length > 0
      ? ("write" as const)
      : ("read" as const);
  return ensureCurrentDocumentAccess({
    containerIds: input.containerIds,
    context: input.context,
    executor: input.executor,
    minimumAccessLevel,
    userId: input.userId,
    verifiedPrincipalPolicies: input.verifiedPrincipalPolicies,
  });
}
