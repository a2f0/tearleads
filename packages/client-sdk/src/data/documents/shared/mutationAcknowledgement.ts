import {
  advanceLocallyAcknowledgedAccessManifestHeadsAtomically,
  type LocallyAcknowledgedAccessManifestHead,
  locallyAuthoredAccessManifestHead,
} from "../../persistence/locallyAcknowledgedCheckpointPersistence";
import type { ExecSql } from "../../sqlite/sqlSchema";

export function locallyAcknowledgedDocumentMutationHead(plan: {
  readonly manifest: Parameters<
    typeof locallyAuthoredAccessManifestHead
  >[0]["manifest"];
  readonly manifestHash: string;
}): LocallyAcknowledgedAccessManifestHead {
  return locallyAuthoredAccessManifestHead(plan);
}

/** Advances a document head only after its response was matched to this plan. */
export async function acknowledgeDocumentMutation(input: {
  readonly execSql: ExecSql;
  readonly plan: Parameters<typeof locallyAcknowledgedDocumentMutationHead>[0];
}): Promise<void> {
  await advanceLocallyAcknowledgedAccessManifestHeadsAtomically({
    execSql: input.execSql,
    heads: [locallyAcknowledgedDocumentMutationHead(input.plan)],
  });
}
