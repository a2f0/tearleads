import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { lockAccessManifestHeadsForShare } from "../../../access/read/accessManifestStore";
import { resolveCurrentDocumentKekTargets } from "../../../access/read/documentKekTargets";
import { DocumentMutationError } from "./errors";

/** Serialize an old-head sync write against a concurrent link-set rotation. */
export async function lockSyncDocumentWriteFrontier(input: {
  readonly currentTargets: Awaited<
    ReturnType<typeof resolveCurrentDocumentKekTargets>
  >;
  readonly documentId: string;
  readonly tx: DatabaseTransaction;
}): Promise<Awaited<ReturnType<typeof resolveCurrentDocumentKekTargets>>> {
  await lockAccessManifestHeadsForShare(
    "container",
    input.currentTargets.targets.map((target) => target.containerId),
    input.tx,
  );
  await lockAccessManifestHeadsForShare(
    "document",
    [input.documentId],
    input.tx,
  );
  const lockedTargets = await resolveCurrentDocumentKekTargets(
    input.documentId,
    input.tx,
  );
  if (
    lockedTargets.linkSetManifestHash !==
    input.currentTargets.linkSetManifestHash
  ) {
    throw new DocumentMutationError("Document manifest is stale", 409);
  }
  return lockedTargets;
}
