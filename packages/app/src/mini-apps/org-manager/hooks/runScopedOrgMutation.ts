import { setUnknownError } from "../refresh";

interface ScopedOrgMutationInput {
  readonly isOperationActive: (organizationId: string) => boolean;
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
    await input.run();
  } catch (error) {
    if (isOperationActive(operationOrganizationId)) {
      setUnknownError(input.setError, error);
    }
  } finally {
    if (isOperationActive(operationOrganizationId)) {
      input.setMutating(false);
    }
  }
}
