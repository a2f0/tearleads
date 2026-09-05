import { expect } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import type { DomainScope } from "../../src/data/domainScope";
import type { ExecSql } from "../../src/data/sqlite/sqlSchema";
import { createContainerContentsStore } from "../../src/stores/container-contents/containerContentsStore";
import {
  createContainerContentsTestRuntime,
  seedLocalRootContainer,
} from "../../src/stores/container-contents/runtime.testFixtures";
import { waitFor } from "./waitFor";

// A non-built-in system slot is enough to exercise the device-first create path;
// the slot string only needs to be stable for `findSystemContainerState`.
export const TEST_SYSTEM_SLOT =
  "sys_v1_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as ContainerSystemSlot;
export const ROOT_CONTAINER_ID = "device-first-root";

export function createAuthenticatedRuntime(input: {
  apiClient: ReturnType<typeof createMockApiClient>;
  domainScope: DomainScope;
  execSql: ExecSql;
  online: boolean;
  organizationId?: string | undefined;
  rootContainerId?: string | undefined;
  writerReady?: boolean | undefined;
}) {
  return createContainerContentsTestRuntime({
    apiClient: input.apiClient,
    containerId: input.rootContainerId ?? ROOT_CONTAINER_ID,
    domainScope: input.domainScope,
    encapsulationKeyPair: input.writerReady
      ? generateKemSeedAndKeyPair()
      : null,
    execSql: input.execSql,
    online: input.online,
    organizationId: input.organizationId ?? "org-1",
  });
}

export async function withReadyStore(
  online: boolean,
  listContainerParentLanes: ReturnType<
    typeof createMockApiClient
  >["listContainerParentLanes"],
  body: (
    store: ReturnType<typeof createContainerContentsStore>,
    execSql: ExecSql,
  ) => Promise<void>,
  options: {
    apiClientOverrides?: Partial<ReturnType<typeof createMockApiClient>>;
    writerReady?: boolean | undefined;
  } = {},
): Promise<void> {
  const { close, execSql } = await createTestExecSql(
    "ensure-system-container-device-first-test",
  );
  try {
    await seedLocalRootContainer(execSql, {
      rootContainerId: ROOT_CONTAINER_ID,
    });
    const runtime = createAuthenticatedRuntime({
      apiClient: createMockApiClient({
        listContainerParentLanes,
        ...options.apiClientOverrides,
      }),
      domainScope: {} as DomainScope,
      execSql,
      online,
      writerReady: options.writerReady,
    });
    const store = createContainerContentsStore(runtime);
    store.updateRuntime(runtime);

    await waitFor(
      () => store.getSnapshot().ready,
      "Container contents store did not become ready from the local root.",
      2_000,
    );
    expect(store.getSnapshot().nodes.map((node) => node.id)).toContain(
      ROOT_CONTAINER_ID,
    );

    await body(store, execSql);
  } finally {
    close();
  }
}
