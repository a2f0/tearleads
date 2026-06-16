import { afterEach, expect, test } from "bun:test";
import { waitFor } from "@testing-library/react";
import {
  createTinySvgImageFile,
  uploadExplorerFile,
} from "../../../test/helpers/explorerUpload";
import {
  listProxiedApiRequests,
  useTestApiAppHandlers,
} from "../../../test/helpers/mswServer";
import {
  cleanupPaneTestEnvironment,
  generateIdentityAndWaitForDb,
  openExplorer,
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
  registerAndWaitForUserId,
  renderPane,
  waitForPaneRuntimeToSettle,
} from "../../../test/helpers/paneTestUtils";
import {
  expectProxiedApiRequestBudget,
  type ProxiedApiRequestBudget,
  profileProxiedApiRequests,
} from "../../../test/helpers/proxiedApiRequestBudget";

afterEach(async () => {
  await cleanupPaneTestEnvironment();
});

// Baseline for the request volume produced by attaching a single small image
// via Explorer's container "Upload" action. Measured as the delta after the
// registered pane and explorer have already settled their bootstrap sync, so
// this only covers the upload itself (local import -> document sync -> blob
// bytes upload -> attachment binding). Run with DUAL_PANE_REQUEST_PROFILE=1 to
// print the observed volume when re-baselining.
const EXPLORER_SINGLE_FILE_UPLOAD_REQUEST_BUDGET: ProxiedApiRequestBudget = {
  total: 5,
  byRequest: {
    // Create the image document shell, stage + bind its attachment blob, and
    // sync the document content twice (push update, then the post-binding
    // follow-up).
    "POST /documents": 1,
    "POST /blobs/stage": 1,
    "POST /blobs/:blobId/attachment-bindings": 1,
    "POST /documents/:documentId/sync": 2,
  },
};

function uploadedAttachmentBindingSucceeded(startIndex: number): boolean {
  return listProxiedApiRequests()
    .slice(startIndex)
    .some((request) => {
      if (request.method !== "POST" || request.status !== 200) {
        return false;
      }
      try {
        return /^\/blobs\/[^/]+\/attachment-bindings$/u.test(
          new URL(request.url).pathname,
        );
      } catch {
        return false;
      }
    });
}

test(
  "explorer single-file upload baselines attachment request volume",
  async () => {
    useTestApiAppHandlers();
    const view = renderPane();

    await generateIdentityAndWaitForDb(view);
    await registerAndWaitForUserId(view);
    const explorer = await openExplorer(view);

    // Settle bootstrap sync so the baseline measures only the upload delta.
    await waitForPaneRuntimeToSettle(PANE_LONG_ASYNC_TEST_TIMEOUT_MS);

    const uploadRequestStartIndex = listProxiedApiRequests().length;
    uploadExplorerFile(view, explorer, "/", createTinySvgImageFile());

    // The upload import is fire-and-forget; wait until the attachment blob has
    // actually been bound on the server before settling and measuring volume.
    await waitFor(
      () => {
        expect(
          uploadedAttachmentBindingSucceeded(uploadRequestStartIndex),
        ).toBe(true);
      },
      { timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS },
    );
    await waitForPaneRuntimeToSettle(PANE_LONG_ASYNC_TEST_TIMEOUT_MS);

    profileProxiedApiRequests(
      "explorer single-file upload",
      uploadRequestStartIndex,
    );
    expectProxiedApiRequestBudget(
      "explorer single-file upload",
      listProxiedApiRequests().slice(uploadRequestStartIndex),
      EXPLORER_SINGLE_FILE_UPLOAD_REQUEST_BUDGET,
    );

    view.unmount();
  },
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
);
