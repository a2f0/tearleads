import { afterEach, expect, test } from "bun:test";
import { waitFor } from "@testing-library/react";
import {
  createTinySvgImageFile,
  uploadExplorerFile,
} from "../../../test/helpers/explorerUpload";
import { registerAndWaitForUserId } from "../../../test/helpers/identityPaneTestUtils";
import {
  listProxiedApiRequests,
  useTestApiAppHandlers,
} from "../../../test/helpers/mswServer";
import {
  cleanupPaneTestEnvironment,
  generateIdentityAndWaitForDb,
  openExplorer,
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
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
  // The aggregate cap is the profiled steady path plus one request of
  // headroom. Per-route caps below are independent maxima: optional writer and
  // discovery reads need not occur together and therefore need not sum to it.
  total: 10,
  byRequest: {
    // Create the image document shell, upload + bind its attachment blob, and
    // probe the remote document before blob staging, then sync the document
    // content before and after the attachment bind. A small encrypted blob is
    // one multipart part.
    "POST /documents": 1,
    "POST /blobs/stages/multipart": 1,
    "PUT /blobs/stages/multipart/:stageId/parts/:partNumber/bytes": 1,
    "POST /blobs/stages/multipart/:stageId/complete": 1,
    "POST /blobs/:blobId/attachment-bindings": 1,
    "POST /documents/:documentId/sync": 3,
    "GET /documents/:documentId/attachments": 2,
    // With system bootstrap decoupled from Explorer startup, the upload path may
    // be the first writer to need the root container projection in this settled
    // test window.
    "GET /containers/:containerId/writer-projection": 1,
    // Device-first reconciliation re-discovers the active container once after
    // the new document lands so the explorer view reflects it.
    "GET /containers/:containerId/documents": 1,
  },
};

function uploadedAttachmentBindingSucceeded(startIndex: number): boolean {
  return listProxiedApiRequests()
    .slice(startIndex)
    .some(
      (request) =>
        request.method === "POST" &&
        request.status === 200 &&
        /\/blobs\/[^/]+\/attachment-bindings/u.test(request.url),
    );
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
