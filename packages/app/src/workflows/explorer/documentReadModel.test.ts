import { expect, test } from "bun:test";
import { createTestExecSql } from "../../../test/helpers/createTestExecSql";
import {
  createExplorerDocumentReadModelFromRuntime,
  listExplorerDocumentRuntimeTargetsForContainerSubtreeFromRuntime,
} from "./documentReadModel";

test("createExplorerDocumentReadModelFromRuntime uses the runtime executor", async () => {
  const { close, execSql } = await createTestExecSql(
    "explorer-document-read-model-runtime",
  );
  try {
    const readModel = createExplorerDocumentReadModelFromRuntime({ execSql });
    const watermark = {
      id: "document-1",
      updatedAt: "2026-05-09T00:00:00.000Z",
    };

    await readModel.saveContainerDocumentWatermark("container-1", watermark);

    expect(
      await readModel.loadContainerDocumentWatermark("container-1"),
    ).toEqual(watermark);
  } finally {
    close();
  }
});

test("listExplorerDocumentRuntimeTargetsForContainerSubtreeFromRuntime uses the runtime executor", async () => {
  const { close, execSql } = await createTestExecSql(
    "explorer-document-runtime-targets",
  );
  try {
    const readModel = createExplorerDocumentReadModelFromRuntime({ execSql });
    await readModel.upsertDiscoveredDocuments([
      {
        accessEpoch: 1,
        accessStateHash: "access-state-hash-1",
        containerId: "private-container",
        createdAt: "2026-05-09T00:00:00.000Z",
        documentId: "remote-document-1",
        linkedContainerIds: ["private-container", "shared-root"],
      },
    ]);
    await readModel.replaceDocumentLinks("remote-document-1", [
      "private-container",
      "shared-root",
    ]);

    const targets =
      await listExplorerDocumentRuntimeTargetsForContainerSubtreeFromRuntime({
        containersById: new Map([
          [
            "shared-root",
            {
              container: {
                id: "shared-root",
                parentId: null,
              },
            },
          ],
        ]),
        rootContainerId: "shared-root",
        runtime: { execSql },
      });

    expect(targets).toEqual([
      {
        documentId: "remote-document-1",
        localId: "remote-document-1",
        runtimeContainerId: "shared-root",
      },
    ]);
  } finally {
    close();
  }
});
