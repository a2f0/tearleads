import { publishBestEffort } from "../../utils/publishBestEffort";
import {
  type CommittedOrganizationReadModelChange,
  listCommittedOrganizationReadModelChanges,
  type ObservedOrganizationReadModelChange,
} from "../../workflows/organizations/readModelChanges";
import { encodeOrganizationReadModelCursor } from "../../workflows/organizations/readModelCursor";
import type { ApiServiceRuntime } from "../runtime";

export async function resolveCommittedOrganizationReadModelChanges(input: {
  readonly observedChanges: readonly ObservedOrganizationReadModelChange[];
  readonly runtime: ApiServiceRuntime;
}): Promise<CommittedOrganizationReadModelChange[]> {
  return listCommittedOrganizationReadModelChanges(
    input.runtime.db,
    input.observedChanges,
  );
}

/**
 * Publish only after the source transaction has committed. Realtime is a lossy
 * wake-up carrying only the committed cursor, which the audience already reads
 * as `nextCursor`; the cursor feed remains authoritative, so a broker failure
 * must not turn a committed mutation into a retrying HTTP failure.
 */
export async function publishOrganizationReadModelChanged(input: {
  readonly change: CommittedOrganizationReadModelChange;
  readonly publish: ApiServiceRuntime["eventPublisher"]["publish"];
}): Promise<void> {
  await publishBestEffort(
    input.publish,
    {
      type: "organization_read_model_changed",
      organizationId: input.change.organizationId,
      cursor: encodeOrganizationReadModelCursor(
        input.change.organizationId,
        input.change.cursor,
      ),
      recipientUserIds: [...input.change.recipientUserIds],
    },
    "organization read-model notification",
  );
}
