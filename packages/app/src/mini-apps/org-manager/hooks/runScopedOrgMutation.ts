import { runAfterBusyPaint } from "../../../components/mini-app/MiniAppLayout";
import { setUnknownError } from "../refresh";

interface ScopedOrgMutationInput {
  readonly isOperationActive: (organizationId: string) => boolean;
  readonly logError: (message: string | Error, cause?: unknown) => void;
  readonly operationOrganizationId: string;
  readonly run: () => Promise<void>;
  readonly setError: (error: string | null) => void;
  readonly setMutating: (mutating: boolean) => void;
}

export async function runScopedOrgMutation(
  input: ScopedOrgMutationInput,
): Promise<void> {
  const { isOperationActive, operationOrganizationId } = input;
  if (!isOperationActive(operationOrganizationId)) {
    return;
  }

  input.setMutating(true);
  input.setError(null);
  try {
    // Mutations derive and seal keys on the main thread; let the busy panel
    // paint first so its spinner keeps turning while they run.
    await runAfterBusyPaint(
      () => isOperationActive(operationOrganizationId),
      input.run,
    );
  } catch (error) {
    if (isOperationActive(operationOrganizationId)) {
      input.logError("Organization mutation failed", error);
      setUnknownError(input.setError, error);
    }
  } finally {
    if (isOperationActive(operationOrganizationId)) {
      input.setMutating(false);
    }
  }
}
