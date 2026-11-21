import { expect, test } from "bun:test";
import type { PendingAttachmentRecord } from "../../../../workflows/documents";
import type { DocumentsRuntime } from "../../types";
import {
  MAX_CONSECUTIVE_DOCUMENT_CHANGED_PASSES,
  shouldRepullAfterDocumentChanged,
} from "../attachmentUpload/attachmentDocumentVersion";
import { noopDocumentStorePersistenceEffects } from "../documentStore.testFixtures";
import { createDocumentStoreState } from "../state";
import { installPersistedAttachments } from "./initializationAttachments";

test("a pending upload reloaded after a reset pulls again on its next refusal", () => {
  const state = createDocumentStoreState(
    "local-reloaded-upload",
    {
      apiClient: {},
      auth: undefined,
      infra: {
        blobStore: {},
        documentProjectors: {},
        execSql: () => undefined,
      },
      resolveTrustedUserIdentity: async () => null,
      state: { domainScope: "scope-1", events: [], peerScope: "peer-1" },
    } as unknown as DocumentsRuntime,
    {} as never,
    noopDocumentStorePersistenceEffects,
    null,
  );
  const upload = {
    slotId: "preview",
    storageKey: "preview-bytes",
  } as PendingAttachmentRecord;
  const reload = () =>
    installPersistedAttachments(state, {
      document: null,
      historyRestoreState: null,
      localAttachments: [],
      pendingAttachments: [upload],
    } as never);
  reload();
  for (
    let pass = 0;
    pass <= MAX_CONSECUTIVE_DOCUMENT_CHANGED_PASSES;
    pass += 1
  ) {
    shouldRepullAfterDocumentChanged(state, upload);
  }
  expect(shouldRepullAfterDocumentChanged(state, upload)).toBe(false);

  reload();
  expect(shouldRepullAfterDocumentChanged(state, upload)).toBe(true);
});
