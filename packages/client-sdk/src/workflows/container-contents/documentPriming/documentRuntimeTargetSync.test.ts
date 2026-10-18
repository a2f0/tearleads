import { expect, test } from "bun:test";
import {
  requestDocumentRuntimeTargetSync,
  requestRemoteDocumentRuntimeTargetSync,
} from "./documentRuntimeTargetSync";

test("document runtime target sync yields between eight-store chunks", async () => {
  const openedAfterYield: boolean[] = [];
  let yielded = false;
  setTimeout(() => {
    yielded = true;
  }, 0);

  await requestDocumentRuntimeTargetSync({
    host: {
      documentWorkflowRuntime: (containerId) => containerId,
      openDocumentStore: () => {
        openedAfterYield.push(yielded);
        return { requestSync: () => undefined };
      },
    },
    targets: Array.from({ length: 9 }, (_, index) => ({
      documentId: `document-${index}`,
      localId: `local-${index}`,
      runtimeContainerId: "root",
    })),
  });

  expect(openedAfterYield.slice(0, 8)).toEqual(Array(8).fill(false));
  expect(openedAfterYield[8]).toBe(true);
});

test("remote target sync records a probe before store initialization", async () => {
  let remoteSyncRequests = 0;

  await requestRemoteDocumentRuntimeTargetSync({
    host: {
      documentWorkflowRuntime: (containerId) => containerId,
      openDocumentStore: () => ({
        requestRemoteSync: () => {
          remoteSyncRequests += 1;
        },
      }),
    },
    targets: [
      {
        documentId: "document-1",
        localId: "local-1",
        runtimeContainerId: "root",
      },
    ],
  });

  expect(remoteSyncRequests).toBe(1);
});
