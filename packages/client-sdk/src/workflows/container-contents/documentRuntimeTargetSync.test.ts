import { expect, test } from "bun:test";
import { requestDocumentRuntimeTargetSync } from "./documentRuntimeTargetSync";

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
