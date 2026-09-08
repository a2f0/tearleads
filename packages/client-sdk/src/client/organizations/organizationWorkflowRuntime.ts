import type {
  InternalRuntime,
  InternalWorkflowRuntimeInput,
} from "../workflowRuntime";

type OrganizationWorkflow<T> = (input: {
  readonly apiClient: InternalWorkflowRuntimeInput["apiClient"];
  readonly organizationId: string;
}) => Promise<T>;

export function authenticatedOrganizationId(
  runtime: InternalWorkflowRuntimeInput,
): string | null {
  return runtime.auth.organizationId && runtime.auth.isAuthenticated
    ? runtime.auth.organizationId
    : null;
}

export function runForOrganization<T>(
  runtimeService: InternalRuntime,
  workflow: OrganizationWorkflow<T>,
  targetOrganizationId?: string,
): Promise<T | null> {
  const runtime = runtimeService.workflowInput();
  const activeOrganizationId = authenticatedOrganizationId(runtime);
  const organizationId =
    targetOrganizationId === undefined
      ? activeOrganizationId
      : targetOrganizationId;
  if (!activeOrganizationId || !organizationId) {
    return Promise.resolve(null);
  }

  return workflow({ apiClient: runtime.apiClient, organizationId });
}

export interface ActiveOrganizationDataRuntime {
  readonly runtime: InternalWorkflowRuntimeInput;
  readonly organizationId: string;
  readonly userId: string;
}

export function activeOrganizationDataRuntime(
  runtimeService: InternalRuntime,
  expectedOrganizationId?: string,
): ActiveOrganizationDataRuntime | null {
  const runtime = runtimeService.workflowInput();
  const organizationId = runtime.auth.organizationId;
  const userId = runtime.auth.userId;
  if (
    !runtime.auth.isAuthenticated ||
    !organizationId ||
    !userId ||
    runtime.infra.dbStatus !== "ready" ||
    (expectedOrganizationId !== undefined &&
      organizationId !== expectedOrganizationId)
  ) {
    return null;
  }

  return { runtime, organizationId, userId };
}
