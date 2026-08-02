import type {
  InternalRuntime,
  InternalWorkflowRuntimeInput,
} from "./workflowRuntime";

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
  organizationId: string,
  workflow: OrganizationWorkflow<T>,
): Promise<T | null> {
  const runtime = runtimeService.workflowInput();
  return authenticatedOrganizationId(runtime) !== null &&
    organizationId.length > 0
    ? workflow({ apiClient: runtime.apiClient, organizationId })
    : Promise.resolve(null);
}

export function runForAuthenticatedOrganization<T>(
  runtimeService: InternalRuntime,
  workflow: OrganizationWorkflow<T>,
): Promise<T | null> {
  const runtime = runtimeService.workflowInput();
  const organizationId = authenticatedOrganizationId(runtime);
  return organizationId
    ? workflow({ apiClient: runtime.apiClient, organizationId })
    : Promise.resolve(null);
}
