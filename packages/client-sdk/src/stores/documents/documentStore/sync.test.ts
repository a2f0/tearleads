import { expect, test } from "bun:test";
import type { DocumentStoreState } from "./state";
import { hasRemoteDocumentUpdateEvent } from "./sync";

function createEventTestState(
  locallyAcceptedUpdateIds: readonly string[],
): DocumentStoreState {
  return {
    locallyAcceptedUpdateIds: new Set(locallyAcceptedUpdateIds),
    record: {
      documentId: "document-1",
    },
  } as DocumentStoreState;
}

test("hasRemoteDocumentUpdateEvent cleans local echo ids after earlier remote events", () => {
  const state = createEventTestState(["local-update-1"]);

  expect(
    hasRemoteDocumentUpdateEvent(state, [
      {
        documentId: "document-1",
        type: "document_update_created",
      },
      {
        documentId: "document-1",
        type: "document_update_created",
        updateIds: ["local-update-1"],
      },
    ]),
  ).toBe(true);

  expect(state.locallyAcceptedUpdateIds.has("local-update-1")).toBe(false);
});

test("hasRemoteDocumentUpdateEvent cleans local ids from mixed update events", () => {
  const state = createEventTestState(["local-update-1", "local-update-2"]);

  expect(
    hasRemoteDocumentUpdateEvent(state, [
      {
        documentId: "document-1",
        type: "document_update_created",
        updateIds: ["local-update-1", "remote-update-1", "local-update-2"],
      },
    ]),
  ).toBe(true);

  expect([...state.locallyAcceptedUpdateIds]).toEqual([]);
});
