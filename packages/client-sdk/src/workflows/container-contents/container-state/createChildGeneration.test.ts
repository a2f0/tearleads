import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createContainerMetadataDocument } from "../../../data/containers/containerMetadataDocument";
import {
  type ContainerContentsPersistence,
  defaultContainerContentsPersistence,
} from "../containerPersistence";
import {
  createContainerRecord,
  createDocumentRecord,
} from "../metadata.testFixtures";
import { createChildContainerState } from "./createChild";
import type { ContainerWorkflowRuntime } from "./types";

test("decorated legacy child persistence refuses before remote mutation", async () => {
  const { close, execSql } = await createTestExecSql(
    "legacy-child-create-generation",
  );
  const parentContainer = createContainerRecord({
    id: "legacy-parent",
    parentId: null,
  });
  const parentRecord = createDocumentRecord({ id: parentContainer.id });
  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    await defaultContainerContentsPersistence.saveContainer(
      execSql,
      parentContainer,
      parentRecord,
    );
    let saveCalled = false;
    const persistence: ContainerContentsPersistence = {
      ...defaultContainerContentsPersistence,
      saveContainer: async (...args) => {
        saveCalled = true;
        const saved = await defaultContainerContentsPersistence.saveContainer(
          ...args,
        );
        return saved;
      },
    };

    const result = await createChildContainerState({
      createRemote: true,
      name: "Expired child",
      parentState: {
        container: parentContainer,
        doc: await createContainerMetadataDocument(parentContainer.id),
        record: parentRecord,
      },
      persistence,
      resolveProjectionUserKey: async () => null,
      runtime: { infra: { execSql } } as ContainerWorkflowRuntime,
      stillCurrent: () => true,
    });

    expect(result).toBeNull();
    expect(saveCalled).toBe(false);
    await expect(
      defaultContainerContentsPersistence.loadContainers(execSql),
    ).resolves.toHaveLength(1);
  } finally {
    close();
  }
});
