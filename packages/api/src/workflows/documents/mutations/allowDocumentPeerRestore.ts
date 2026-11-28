import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import { documentPeerOwners, documents } from "@tearleads/api-shared/schema";
import type { DocumentPeerRestoreAllowRequest } from "@tearleads/validators/request";
import type { DocumentPeerRestoreAllowResponse } from "@tearleads/validators/response";
import { and, eq } from "drizzle-orm";
import { lockAccessManifestHeadRows } from "../../../access/read/accessManifestStore";
import { resolveCurrentDocumentKekTargets } from "../../../access/read/documentKekTargets";
import { findPersonalOrganizationOwnerId } from "../../billing/purgedObjectReservations";
import {
  DocumentMutationError,
  documentNotFound,
  toMutationError,
} from "./errors";
import { ensureCurrentDocumentAccess } from "./syncAccess";

export interface AllowDocumentPeerRestoreInput {
  readonly documentId: string;
  readonly request: DocumentPeerRestoreAllowRequest;
  readonly userId: string;
}

export interface DocumentPeerRestoreAllowWorkflowResult {
  readonly containerPaths: Readonly<Record<string, readonly string[]>>;
  readonly linkedContainerIds: readonly string[];
  readonly response: DocumentPeerRestoreAllowResponse;
}

/**
 * Lets the personal organization's owner toggle `allow_member_restore` on a
 * recovered document's pre-purge peer-owner rows (#3263). Serializes under the
 * document head lock with sync writes so an in-flight sync sees either the old
 * or new flag atomically.
 */
export async function runAllowDocumentPeerRestoreWorkflow(
  db: ApiDatabase,
  input: AllowDocumentPeerRestoreInput,
): Promise<DocumentPeerRestoreAllowWorkflowResult> {
  try {
    return await db.transaction(async (tx) => {
      await lockAccessManifestHeadRows(
        "document",
        [input.documentId],
        tx,
        "update",
      );
      const [document] = await tx
        .select({ id: documents.id })
        .from(documents)
        .where(eq(documents.id, input.documentId))
        .limit(1);
      if (!document) {
        throw documentNotFound();
      }
      const currentTargets = await resolveCurrentDocumentKekTargets(
        input.documentId,
        tx,
        true,
      );
      const linkedContainerIds = currentTargets.targets.map(
        (target) => target.containerId,
      );
      await ensureCurrentDocumentAccess({
        containerIds: linkedContainerIds,
        executor: tx,
        minimumAccessLevel: "write",
        userId: input.userId,
      });
      const ownerId = await findPersonalOrganizationOwnerId(
        tx,
        currentTargets.organizationId,
      );
      if (ownerId !== input.userId) {
        throw new DocumentMutationError(
          "Only the organization owner may allow member peer restoration",
          403,
        );
      }
      const updated = await tx
        .update(documentPeerOwners)
        .set({ allowMemberRestore: input.request.allowMemberRestore })
        .where(
          and(
            eq(documentPeerOwners.documentId, input.documentId),
            eq(documentPeerOwners.recoveryOwnerUserId, input.userId),
          ),
        )
        .returning({ peerId: documentPeerOwners.peerId });
      return {
        containerPaths: currentTargets.containerPaths,
        linkedContainerIds,
        response: {
          allowMemberRestore: input.request.allowMemberRestore,
          documentId: input.documentId,
          updatedPeerCount: updated.length,
        },
      };
    });
  } catch (error) {
    const mutationError = toMutationError(error);
    if (mutationError) {
      throw mutationError;
    }
    throw error;
  }
}
