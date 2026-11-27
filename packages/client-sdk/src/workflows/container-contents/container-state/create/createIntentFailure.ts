import { errorMessage } from "../../../../data/shared/errorMessage";
import { reportAndRethrowKeyingVerificationError } from "../../../../data/shared/securityIncidents";
import type {
  ContainerCreateIntentSyncInput,
  ContainerCreateIntentSyncState,
} from "../types";

/** A create the server accepted whose local settlement did not complete. */
export class IncompleteContainerCreateSettlementError extends Error {}

async function reportContainerCreateIntegrityFailure(input: {
  readonly containerId: string;
  readonly error: unknown;
  readonly organizationId: string;
  readonly state: ContainerCreateIntentSyncState;
}): Promise<void> {
  await reportAndRethrowKeyingVerificationError(
    input.error,
    input.state.runtime.util.reportSecurityIncident,
    {
      objectId: input.containerId,
      objectKind: "container",
      operation: "container.create.replay",
      organizationId: input.organizationId,
    },
  );
}

/**
 * Records a create that threw. A keying verification failure is reported as a
 * security incident and rethrown; any other failure is recorded on the intent.
 */
export async function recordContainerCreateFailure(input: {
  readonly error: unknown;
  readonly isCurrent: () => boolean;
  readonly intent: ContainerCreateIntentSyncInput["intent"];
  readonly organizationId: string;
  readonly state: ContainerCreateIntentSyncState;
}): Promise<"abandoned" | "failed"> {
  if (!input.isCurrent()) {
    return "abandoned";
  }
  await reportContainerCreateIntegrityFailure({
    containerId: input.intent.containerId,
    error: input.error,
    organizationId: input.organizationId,
    state: input.state,
  });
  if (!input.isCurrent()) {
    return "abandoned";
  }
  await input.state.persistence.recordCreateIntentRevisionError(
    input.state.runtime.infra.execSql,
    {
      containerId: input.intent.containerId,
      expectedIntentId: input.intent.id,
      expectedUpdatedAt: input.intent.updatedAt,
      message: `${input.error instanceof IncompleteContainerCreateSettlementError ? "Container create persistence failed" : "Remote container create failed"}: ${errorMessage(input.error)}`,
      stillCurrent: input.isCurrent,
    },
  );
  return input.isCurrent() ? "failed" : "abandoned";
}
