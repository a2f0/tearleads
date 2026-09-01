import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import { waitFor } from "../../../test/helpers/waitFor";
import type { DomainScope } from "../../data/domainScope";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { defaultContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import { createContainerContentsStore } from "./containerContentsStore";
import {
  createContainerContentsTestRuntime,
  seedLocalRootContainer,
} from "./runtime.testFixtures";

function createRuntime(input: {
  domainScope: DomainScope;
  execSql: ExecSql;
  organizationId: string | null;
  rootContainerId: string;
}) {
  return createContainerContentsTestRuntime({
    apiClient: createMockApiClient(),
    containerId: input.rootContainerId,
    domainScope: input.domainScope,
    execSql: input.execSql,
    organizationId: input.organizationId,
  });
}

test("container contents store merges locally persisted bootstrap rows after context changes", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-contents-store-context-local-merge-test",
  );
  const domainScope = {} as DomainScope;
  const rootContainerId = "registered-root";

  try {
    await seedLocalRootContainer(execSql, {
      organizationId: "",
      rootContainerId,
    });

    const store = createContainerContentsStore(
      createRuntime({
        domainScope,
        execSql,
        organizationId: null,
        rootContainerId,
      }),
    );
    store.updateRuntime(
      createRuntime({
        domainScope,
        execSql,
        organizationId: null,
        rootContainerId,
      }),
    );

    await waitFor(
      () => store.getSnapshot().ready,
      "Container contents store did not become ready.",
    );
    expect(store.getSnapshot().nodes.map((node) => node.id)).toEqual([
      rootContainerId,
    ]);

    await defaultContainerContentsPersistence.saveContainer(
      execSql,
      {
        icon: "trash",
        id: "registered-trash",
        effectiveAccessLevel: "admin",
        metadataDocumentId: "registered-trash-metadata-document",
        name: "Trash",
        organizationId: "org-1",
        parentId: rootContainerId,
        systemSlot: "sys_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      null,
    );

    store.updateRuntime(
      createRuntime({
        domainScope,
        execSql,
        organizationId: "org-1",
        rootContainerId,
      }),
    );

    await waitFor(
      () =>
        store
          .getSnapshot()
          .nodes.some(
            (node) =>
              node.id === "registered-trash" &&
              node.name === "Trash" &&
              node.icon === "trash",
          ),
      "Container contents store did not merge the locally persisted Trash row.",
    );
  } finally {
    close();
  }
});
