import { expect, test } from "bun:test";
import { takePendingReconciliationEvents } from "./useDeviceFirstBinding";

test.each([
  { type: "document_update_created", documentId: "document-1" },
  { type: "document_update_created", containerIds: ["container-1"] },
  {
    type: "document_update_created",
    documentId: "document-1",
    containerIds: [""],
  },
])(
  "obsolete or malformed hints never enter app reconciliation: %j",
  (event) => {
    const processedEventKeys = new Set<string>();
    expect(
      takePendingReconciliationEvents({
        events: [event],
        knownContainerIds: ["container-1"],
        processedEventKeys,
      }),
    ).toEqual([]);
    expect(processedEventKeys.size).toBe(0);
  },
);
