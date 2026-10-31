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
import { waitForPersonalBootstrap } from "../../../test/helpers/waitForPersonalBootstrap";

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
  // Seven mutation/blob requests and three directory discovery reads (one per
  // workflow operation) measured 10 calls; the stage now carries its part
  // upload source and the bind completes it, two fewer calls (measured 8).
  // Held bytes match the authenticated attachment intent, so local settlement
  // needs no binding listing. The bind carries the document's deferred first
  // update, so neither that sync nor its directory discovery read is sent
  // (measured 8 before, 6 after). Keep one request of scheduling headroom.
  total: 7,
  // Each discovery read names the held directory head and receives that head
  // alone. The carried update moves the sync's 9.7 KB into the bind request:
  // measured 34.8 KB sent and 29.2 KB received; keep about 10% headroom.
  bodyBytes: { request: 38_000, response: 32_500 },
  byRequest: {
    // Completed public stages of the cited heads need no confirmation read.
    "GET /principals/history": 0,
    // Each workflow operation discovers the server-current directory head once
    // (the create and the bind); its completed directory and Admins stages
    // need no pinned read.
    "GET /principals/organization/:organizationId/policy": 2,
    "GET /principals/group/:groupId/policy": 0,
    // Create the image document shell, then upload + bind its attachment
    // blob. The bind commits the held-back first content update after its
    // binding, so no document sync follows. A small encrypted blob is one
    // multipart part. Its upload source rides on the stage response, and the
    // bind completes the stage, so neither a per-part authorization nor a
    // completion request is sent.
    "POST /documents": 1,
    "POST /blobs/stages/multipart": 1,
    "POST /blobs/stages/multipart/:stageId/parts/:partNumber/upload": 0,
    "PUT /blobs/stages/multipart/:stageId/parts/:partNumber/bytes": 1,
    "POST /blobs/:blobId/attachment-bindings": 1,
    "POST /documents/:documentId/sync": 0,
    "GET /documents/:documentId/attachments": 0,
    // With system bootstrap decoupled from Explorer startup, the upload path may
    // be the first writer to need the root container projection in this settled
    // test window.
    "GET /containers/:containerId/writer-projection": 1,
    // Device-first reconciliation re-discovers the active container once after
    // the new document lands so the explorer view reflects it.
    "POST /containers/documents/query": 1,
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

    await waitForPersonalBootstrap();

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
