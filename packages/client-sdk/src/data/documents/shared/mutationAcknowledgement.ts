import {
  advanceLocallyAcknowledgedAccessManifestHeadsAtomically,
  locallyAuthoredAccessManifestHead,
} from "../../persistence/locallyAcknowledgedCheckpointPersistence";
import type { ExecSql } from "../../sqlite/sqlSchema";

/** Advances a document head only after its response was matched to this plan. */
export async function acknowledgeDocumentMutation(input: {
  readonly execSql: ExecSql;
  readonly plan: Parameters<typeof locallyAuthoredAccessManifestHead>[0];
  readonly stillCurrent?: (() => boolean) | undefined;
}): Promise<void> {
  await advanceLocallyAcknowledgedAccessManifestHeadsAtomically({
    execSql: input.execSql,
    heads: [locallyAuthoredAccessManifestHead(input.plan)],
    stillCurrent: input.stillCurrent,
  });
}
