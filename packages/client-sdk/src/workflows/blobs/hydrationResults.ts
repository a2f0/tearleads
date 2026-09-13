import {
  reportKeyingVerificationErrorInCauseChain,
  rethrowDatabaseUnavailableError,
} from "../../data/keyingProjectionVerification/error";
import { rethrowProjectionVerificationCancelled } from "../../data/keyingProjectionVerification/types";
import type { SecurityIncidentReporter } from "../../data/securityIncidents";

/** One unavailable or invalid attachment does not suppress independent successes. */
export async function collectHydrationResults<T>(input: {
  tasks: readonly { blobId: string; run: () => Promise<T> }[];
  reportSecurityIncident?: SecurityIncidentReporter | undefined;
  log?: ((message: string) => void) | undefined;
}): Promise<T[]> {
  const outcomes = await Promise.allSettled(
    input.tasks.map((task) => task.run()),
  );
  const values: T[] = [];
  for (const [index, outcome] of outcomes.entries()) {
    if (outcome.status === "fulfilled") {
      values.push(outcome.value);
      continue;
    }
    rethrowDatabaseUnavailableError(outcome.reason);
    rethrowProjectionVerificationCancelled(outcome.reason);
    await reportKeyingVerificationErrorInCauseChain(
      outcome.reason,
      input.reportSecurityIncident,
      {
        operation: "hydrate_attachment",
        objectKind: "blob",
        objectId: input.tasks[index]?.blobId ?? null,
      },
    );
    input.log?.("Documents: an attachment is unavailable during hydration.");
  }
  return values;
}
