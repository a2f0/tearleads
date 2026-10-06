import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import type { ProjectionPolicyHistoryQuery } from "@tearleads/validators/operation";
import type { PrincipalPolicySnapshotPageResponse } from "@tearleads/validators/response";
import {
  getPrincipalStatesForReferences,
  principalStateReferenceKey,
} from "../../access/read/principalStateStore";
import { canonicalJsonEquals } from "../../utils/canonicalJson";
import { ContainerWriterProjectionError } from "../containers/writerProjection";
import { StoredDocumentManifestError } from "../documents/storedDocumentManifestVerification";
import { DocumentWriterProjectionError } from "../documents/writerProjectionError";
import { principalHistoryHead } from "./principalHistoryRecords";
import { runPrincipalHistoryTransaction } from "./principalHistoryTransaction";
import { buildPrincipalPolicySnapshotPage } from "./principalPolicySnapshotPage";
import { assertProjectionPolicyHistoryAccess } from "./projectionPolicyHistoryAccess";
import { readProjectionPolicyHistoryGrant } from "./projectionPolicyHistoryGrant";
import { PrincipalPolicyError } from "./shared";

export async function runReadProjectionPolicyHistoryWorkflow(
  db: ApiDatabase,
  input: ProjectionPolicyHistoryQuery & { readonly requesterUserId: string },
): Promise<PrincipalPolicySnapshotPageResponse> {
  const grant = readProjectionPolicyHistoryGrant(
    input.grant,
    input.requesterUserId,
  );
  try {
    return await runPrincipalHistoryTransaction(db, async (tx) => {
      await assertProjectionPolicyHistoryAccess(tx, grant);
      const head = (
        await getPrincipalStatesForReferences([grant.head], tx)
      ).get(principalStateReferenceKey(grant.head));
      if (!head || !canonicalJsonEquals(principalHistoryHead(head), grant.head))
        throw new PrincipalPolicyError(
          "Projection policy history head is unavailable",
          409,
        );
      return buildPrincipalPolicySnapshotPage(
        tx,
        head,
        input.afterVersion ?? 0,
      );
    });
  } catch (error) {
    if (
      error instanceof ContainerWriterProjectionError ||
      error instanceof DocumentWriterProjectionError ||
      error instanceof StoredDocumentManifestError
    )
      throw new PrincipalPolicyError(error.message, error.status);
    throw error;
  }
}
