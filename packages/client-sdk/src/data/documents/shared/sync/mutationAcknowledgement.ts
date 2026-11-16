import { KeyingCheckpointRepository } from "../../../persistence/keyingCheckpoints/keyingCheckpointRepository";
import { locallyAuthoredAccessManifestHead } from "../../../persistence/keyingCheckpoints/locallyAcknowledgedCheckpointPersistence";
import type { ExecSql } from "../../../sqlite/sqlSchema";

/** Advances a document head only after its response was matched to this plan. */
export async function acknowledgeDocumentMutation(input: {
  readonly execSql: ExecSql;
  readonly plan: Parameters<typeof locallyAuthoredAccessManifestHead>[0];
  readonly stillCurrent?: (() => boolean) | undefined;
}): Promise<void> {
  await new KeyingCheckpointRepository(
    input.execSql,
  ).advanceLocallyAcknowledgedAccessManifestHeadsAtomically({
    heads: [locallyAuthoredAccessManifestHead(input.plan)],
    stillCurrent: input.stillCurrent,
  });
}
