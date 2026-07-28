import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import type { DocumentCreateApi } from "../../data/documents/shared/types";

export type DocumentCreateTerminalFailureHandler = (failure: {
  readonly message: string;
  readonly status: number | null;
}) => Promise<void> | void;

/**
 * Resolve the container writer projection a create is authored against,
 * persisting a terminal fetch failure through the caller's handler. A pending
 * local create can never submit without this projection, so the failure (e.g.
 * a 402 billing block or a 403 after access revocation) is what the write
 * queue must surface — collapsing it to a silent null left the queued create
 * invisible forever: no failure row, no attempt timestamp, and sync telemetry
 * reporting no pending work. Falls back to the plain fetch for simple test
 * doubles, preserving the pre-existing silent-null behavior there.
 *
 * The recorded row follows the standard failure lifecycle rather than
 * sticking: a document whose create later succeeds cannot skip its follow-up
 * sync (its record carries no commit LSN until a sync response persists one,
 * so shouldSkipCleanScheduledDocumentSync stays false), and that clean pass
 * clears the row. Across restarts the row itself is a priming ticket that
 * re-drives the store, exactly like a recorded revalidation refusal.
 */
export async function fetchContainerWriterProjectionForCreate(input: {
  apiClient: DocumentCreateApi;
  containerId: string;
  onTerminalSubmitFailure?: DocumentCreateTerminalFailureHandler | undefined;
}): Promise<ContainerWriterProjectionResponse | null> {
  if (input.apiClient.getContainerWriterProjectionResult) {
    const result = await input.apiClient.getContainerWriterProjectionResult(
      input.containerId,
      { reportErrors: false },
    );
    if (result.ok) {
      return result.data;
    }

    result.report();
    await input.onTerminalSubmitFailure?.(result);
    return null;
  }

  return input.apiClient.getContainerWriterProjection(input.containerId);
}
