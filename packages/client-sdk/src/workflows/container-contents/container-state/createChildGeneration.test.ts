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

test("decorated child persistence uses its overridden save atomically", async () => {
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
    let current = true;
    let childId: string | null = null;
    const persistence: ContainerContentsPersistence = {
      ...defaultContainerContentsPersistence,
      saveContainer: async (...args) => {
        const saved = await defaultContainerContentsPersistence.saveContainer(
          ...args,
        );
        if (saved.parentId !== null) {
          childId = saved.id;
          current = false;
        }
        return saved;
      },
    };

    const result = await createChildContainerState({
      createRemote: false,
      name: "Expired child",
      parentState: {
        container: parentContainer,
        doc: await createContainerMetadataDocument(parentContainer.id),
        record: parentRecord,
      },
      persistence,
      resolveProjectionUserKey: async () => null,
      runtime: { infra: { execSql } } as ContainerWorkflowRuntime,
      stillCurrent: () => current,
    });

    expect(result).toBeNull();
    expect(childId).not.toBeNull();
    expect(
      await defaultContainerContentsPersistence.containerExists(
        execSql,
        childId ?? "",
      ),
    ).toBe(false);
    expect(
      await defaultContainerContentsPersistence.listPendingUpdates(
        execSql,
        childId ?? "",
      ),
    ).toEqual([]);
  } finally {
    close();
  }
});
