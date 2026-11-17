import { KeyingCheckpointRepository } from "../../../persistence/keyingCheckpoints/keyingCheckpointRepository";
import {
  type AuthoredManifestBundle,
  type LocallyAcknowledgedAccessManifestHead,
  locallyAcknowledgedAuthoredHead,
} from "../../../persistence/keyingCheckpoints/locallyAcknowledgedCheckpointPersistence";
import type { ExecSql } from "../../../sqlite/sqlSchema";

/**
 * A matched document head, carrying its authored bundle for citation when
 * the acknowledgement's digest names exactly it.
 */
export async function locallyAcknowledgedDocumentHead(
  plan: AuthoredManifestBundle,
  bundleDigest: string,
): Promise<LocallyAcknowledgedAccessManifestHead> {
  return locallyAcknowledgedAuthoredHead(plan, bundleDigest);
}

/** Advances a document head only after its response was matched to this plan. */
export async function acknowledgeDocumentMutation(input: {
  readonly bundleDigest: string;
  readonly execSql: ExecSql;
  readonly plan: AuthoredManifestBundle;
  readonly stillCurrent?: (() => boolean) | undefined;
}): Promise<void> {
  await new KeyingCheckpointRepository(
    input.execSql,
  ).advanceLocallyAcknowledgedAccessManifestHeadsAtomically({
    heads: [
      await locallyAcknowledgedDocumentHead(input.plan, input.bundleDigest),
    ],
    stillCurrent: input.stillCurrent,
  });
}
