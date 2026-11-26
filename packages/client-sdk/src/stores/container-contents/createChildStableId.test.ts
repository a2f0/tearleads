import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import { waitFor } from "../../../test/helpers/data/waitFor";
import {
  createContainerContentsTestRuntime,
  seedLocalRootContainer,
} from "../../../test/helpers/workflows/containerContentsTestRuntime";
import type { DomainScope } from "../../data/shared/domainScope";
import { createContainerContentsStore } from "./containerContentsStore";

const ROOT_CONTAINER_ID = "stable-id-root";
const STABLE_ID = "5d0c2a7e-91b4-4c3f-8e2d-6a1f0b9c4d73";

test("createChild takes a stable id once, and refuses a malformed one", async () => {
  const { close, execSql } = await createTestExecSql("create-child-stable-id");
  try {
    await seedLocalRootContainer(execSql, {
      rootContainerId: ROOT_CONTAINER_ID,
    });
    const runtime = createContainerContentsTestRuntime({
      apiClient: createMockApiClient({
        listContainerParentLanes: async () => null,
      }),
      containerId: ROOT_CONTAINER_ID,
      domainScope: {} as DomainScope,
      execSql,
      online: false,
    });
    const store = createContainerContentsStore(runtime);
    store.updateRuntime(runtime);
    await waitFor(
      () => store.getSnapshot().ready,
      "Container contents store did not become ready.",
      2_000,
    );

    const stable = await store.createChild(ROOT_CONTAINER_ID, "Family", {
      id: STABLE_ID,
    });
    expect(stable?.id).toBe(STABLE_ID);
    expect(stable?.name).toBe("Family");
    // An id already in the tree is never made twice.
    expect(
      await store.createChild(ROOT_CONTAINER_ID, "Again", { id: STABLE_ID }),
    ).toBeNull();
    expect(
      await store.createChild(ROOT_CONTAINER_ID, "Bad", { id: "not-a-uuid" }),
    ).toBeNull();
    const random = await store.createChild(ROOT_CONTAINER_ID, "Other");
    expect(random?.id).not.toBe(STABLE_ID);
    expect(
      store
        .getSnapshot()
        .nodes.filter((node) => node.parentId === ROOT_CONTAINER_ID)
        .map((node) => node.name)
        .sort(),
    ).toEqual(["Family", "Other"]);
  } finally {
    close();
  }
});
