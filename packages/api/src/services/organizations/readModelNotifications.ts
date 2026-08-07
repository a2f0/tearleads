import { publishBestEffort } from "../../utils/publishBestEffort";
import {
  type CommittedOrganizationReadModelChange,
  listCommittedOrganizationReadModelChanges,
  type ObservedOrganizationReadModelChange,
} from "../../workflows/organizations/readModelChanges";
import type { ApiServiceRuntime } from "../runtime";

interface OrganizationReadModelChangedOrigin {
  readonly sessionId: string;
  readonly userId: string;
}

function createOrganizationReadModelChangedEvent(input: {
  readonly organizationId: string;
  readonly origin: OrganizationReadModelChangedOrigin;
  readonly recipientUserIds: readonly string[];
}): Record<string, unknown> {
  return {
    type: "organization_read_model_changed",
    organizationId: input.organizationId,
    origin: input.origin,
    recipientUserIds: [...input.recipientUserIds],
  };
}

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
 * Publish only after the source transaction has committed. Realtime is a lossy,
 * content-free wake-up; the cursor feed remains authoritative, so a broker
 * failure must not turn a committed mutation into a retrying HTTP failure.
 */
export async function publishOrganizationReadModelChanged(input: {
  readonly organizationId: string;
  readonly origin: OrganizationReadModelChangedOrigin;
  readonly publish: ApiServiceRuntime["eventPublisher"]["publish"];
  readonly recipientUserIds: readonly string[];
}): Promise<void> {
  await publishBestEffort(
    input.publish,
    createOrganizationReadModelChangedEvent(input),
    "organization read-model notification",
  );
}
