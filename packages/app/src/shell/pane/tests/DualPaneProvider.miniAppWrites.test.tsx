import { afterEach, expect, test } from "bun:test";
import { DEFAULT_DOCUMENT_KIND, type Tearleads } from "@tearleads/client-sdk";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import invariant from "invariant";
import {
  getPaneUserId,
  interact,
} from "../../../../test/helpers/dual-pane/dualPaneCore";
import {
  createMiniAppContact,
  editMiniAppContact,
  importMiniAppContact,
  openMiniApp,
  renderSeededDemo,
  typeMiniAppNote,
} from "../../../../test/helpers/dual-pane/dualPaneMiniAppKit";
import { addPeerToAdminsGroup } from "../../../../test/helpers/dual-pane/dualPaneSharingKit";
import {
  capturePostShareSyncBaseline,
  waitForNoPostShareSyncFailures,
} from "../../../../test/helpers/dual-pane/dualPaneSyncKit";
import {
  listProxiedApiRequests,
  resetMockServer,
  useTestApiAppHandlers,
} from "../../../../test/helpers/mswServer";

afterEach(async () => {
  cleanup();
  globalThis.localStorage.clear();
  await resetMockServer();
});

function createdDocumentIds(startIndex: number): string[] {
  return listProxiedApiRequests()
    .slice(startIndex)
    .filter(
      (request) =>
        request.method === "POST" &&
        new URL(request.url).pathname === "/documents" &&
        request.status === 200,
    )
    .map((request) => {
      const response: unknown = JSON.parse(request.responseBody);
      invariant(
        response &&
          typeof response === "object" &&
          "id" in response &&
          typeof response.id === "string",
        "Expected document create response.",
      );
      return response.id;
    });
}

async function receiveSharedDocuments(
  owner: Tearleads,
  peer: Tearleads,
  app: "Notes" | "Contacts",
  documents: ReadonlyArray<{ id: string; title: string }>,
) {
  const summaries = await owner.documents.list();
  for (const document of documents) {
    const summary = summaries?.rows.find(
      (row) => row.documentId === document.id,
    );
    invariant(
      summary?.containerId,
      "Expected a remotely saved document with a container.",
    );
    // Verify actual decrypted server content in Peer 2's independent runtime.
    // Explorer's lazy folder navigation is not needed to drive either writer.
    const store = peer.documents.open({
      containerId: summary.containerId,
      documentId: document.id,
      localId: document.id,
      initialDocumentKind: app === "Notes" ? DEFAULT_DOCUMENT_KIND : "contact",
    });
    store.requestSync();
    await waitFor(
      () => {
        const snapshot = store.getSnapshot();
        const { nickname } = snapshot.structuredFields;
        expect(snapshot.ready).toBe(true);
        expect(app === "Notes" ? snapshot.text : nickname).toBe(document.title);
      },
      { timeout: 10_000 },
    );
  }
}

for (const app of ["Notes", "Contacts"] as const) {
  test(`${app} writes and shares after clearing browser cache and adding an Admin`, async () => {
    useTestApiAppHandlers();
    const previous = await renderSeededDemo();
    const previousPeerUserId = getPaneUserId(previous.rightPane);
    const initialBaseline = capturePostShareSyncBaseline();
    if (app === "Notes") {
      const notes = await openMiniApp(previous.leftPane, "Notes");
      await typeMiniAppNote(notes, "Note from the previous browser identity");
    }
    // Contacts seeding already imported previousPeerUserId into Peer 1's book.
    await waitForNoPostShareSyncFailures(
      [previous.leftPane, previous.rightPane],
      initialBaseline,
    );
    previous.view.unmount();
    cleanup();
    globalThis.localStorage.clear();
    // Keep the API database: browser cache clearing does not delete server data.
    const { leftPane, rightPane, leftRuntime, rightRuntime } =
      await renderSeededDemo();
    await addPeerToAdminsGroup(leftPane, getPaneUserId(rightPane));
    const baseline = capturePostShareSyncBaseline();
    const window = await openMiniApp(leftPane, app);
    const title = `Shared from ${app}`;
    if (app === "Notes") {
      await typeMiniAppNote(window, title);
    } else {
      await importMiniAppContact(window, previousPeerUserId);
      await editMiniAppContact(window, title);
    }
    await waitForNoPostShareSyncFailures([leftPane, rightPane], baseline);
    for (const text of [`${title} edited`, `${title} edited again`]) {
      if (app === "Notes") await typeMiniAppNote(window, text);
      else await editMiniAppContact(window, text);
      await waitForNoPostShareSyncFailures([leftPane, rightPane], baseline);
    }
    // Also cover explicit creation through each mini-app's own controls.
    if (app === "Notes") {
      await interact(() =>
        fireEvent.click(
          within(window).getByRole("button", { name: "New Note" }),
        ),
      );
      await typeMiniAppNote(window, `${title} new`);
    } else {
      await createMiniAppContact(window, `${title} new`);
      await editMiniAppContact(window, `${title} new edited`);
    }
    await waitForNoPostShareSyncFailures([leftPane, rightPane], baseline);
    const ids = createdDocumentIds(baseline.requestStartIndex);
    expect(ids).toHaveLength(2);
    const [firstId, secondId] = ids;
    invariant(firstId && secondId, "Expected two persisted documents.");
    expect(firstId).not.toBe(secondId);
    await receiveSharedDocuments(leftRuntime, rightRuntime, app, [
      { id: firstId, title: `${title} edited again` },
      {
        id: secondId,
        title: `${title} new${app === "Contacts" ? " edited" : ""}`,
      },
    ]);
    await waitForNoPostShareSyncFailures([leftPane, rightPane], baseline);
  }, 90_000);
}
