import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import { createOrganizationReadModelCoordinator } from "../../../src/client/organizations/organizationReadModels";
import { OrganizationReadModelRepository } from "../../../src/data/persistence/organizations/organizationReadModelRepository";
import {
  organizationReadModelCursorAt,
  organizationReadModelGroupsDelta,
  organizationReadModelOrganizationId,
  organizationReadModelSnapshot,
  organizationReadModelUserId,
} from "../data/organizationReadModelProjectionFixtures";
import {
  createInternalRuntimeFixture,
  createWorkflowInputFixture,
} from "../workflows/internalRuntimeFixtures";

const organizationId = organizationReadModelOrganizationId;
const userId = organizationReadModelUserId;
const cursorAt = (position: number) => organizationReadModelCursorAt(position);

/**
 * A coordinator over a projection at cursor 1 whose feed answers cursor 9,
 * recording each feed request, with session and domain-scope transitions.
 */
export async function committedFixture(name: string, feedGate?: Promise<void>) {
  const { close, execSql } = await createTestExecSql(name);
  await new OrganizationReadModelRepository(
    execSql,
  ).applyOrganizationReadModelResponse({
    currentUserId: userId,
    requestedCursor: null,
    response: organizationReadModelSnapshot({ cursor: cursorAt(1) }),
  });
  const requestedCursors: Array<string | undefined> = [];
  const apiClient = createMockApiClient({
    async getOrganizationReadModelResult(_organizationId, cursor) {
      requestedCursors.push(cursor);
      await feedGate;
      return {
        data: organizationReadModelGroupsDelta({
          cursor: cursorAt(9),
          groupName: "Operators",
        }),
        ok: true,
      };
    },
  });
  let workflowInput = createWorkflowInputFixture({
    apiClient,
    auth: { organizationId, userId },
    execSql,
  });
  let sessionGeneration = 0;
  const runtime = {
    ...createInternalRuntimeFixture(() => workflowInput),
    get sessionGeneration() {
      return sessionGeneration;
    },
  };
  const coordinator = createOrganizationReadModelCoordinator(runtime);
  const scope = {
    domainScope: workflowInput.state.domainScope,
    execSql,
    organizationId,
    sessionGeneration: 0,
    userId,
  };
  // A logout and a login of the same identity keep the domain scope.
  const advanceSession = () => {
    sessionGeneration += 1;
    return { ...scope, sessionGeneration };
  };
  // A logout or identity switch hands the runtime a new domain scope.
  const switchDomainScope = () => {
    workflowInput = createWorkflowInputFixture({
      apiClient,
      auth: { organizationId, userId },
      execSql,
    });
    return { ...scope, domainScope: workflowInput.state.domainScope };
  };
  return {
    advanceSession,
    close,
    coordinator,
    execSql,
    requestedCursors,
    runtime,
    scope,
    switchDomainScope,
  };
}
