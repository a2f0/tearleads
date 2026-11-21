import { afterEach, expect, spyOn, test } from "bun:test";
import * as Sdk from "@tearleads/client-sdk";
import {
  createMemoryBlobStore,
  type DocumentStore,
  Tearleads,
} from "@tearleads/client-sdk";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useContext, useEffect } from "react";
import { DOCUMENT_RELINKED_LABELS } from "../../components/shared/DocumentRelinkedNotice";
import * as SdkProvider from "../../providers/sdk/TearleadsProvider";
import {
  DocumentContext,
  DocumentsProvider,
  useDocument,
} from "./DocumentsProvider";

afterEach(cleanup);

test("a view another pane relinked goes read-only and reopens on request", async () => {
  const client = new Tearleads({ blobStore: createMemoryBlobStore() });
  client.network.setOnline(false);
  const sdk = spyOn(SdkProvider, "useTearleads").mockReturnValue(client);
  const input = client.runtime.input();
  const runtime = spyOn(SdkProvider, "useTearleadsRuntime").mockReturnValue({
    ...input,
    auth: { ...input.auth, authToken: null },
    infra: { ...input.infra, dbId: null },
  });
  const stores: DocumentStore[] = [];
  let mounts = 0;
  function Editor() {
    const store = useContext(DocumentContext);
    const document = useDocument();
    useEffect(() => {
      mounts += 1;
      if (store) stores.push(store);
    }, [store]);
    return <p>{document.canWrite ? "editable" : "read-only"}</p>;
  }
  try {
    const view = render(
      <DocumentsProvider localId="relinked-note" documentId="remote-note">
        <Editor />
      </DocumentsProvider>,
    );
    expect(view.queryByRole("status")).toBeNull();
    expect(view.getByText("editable")).toBeTruthy();
    const store = stores[0] as DocumentStore & { supersede: () => void };
    await act(async () => {
      store.supersede();
    });
    expect(view.getByRole("status").textContent).toContain(
      DOCUMENT_RELINKED_LABELS.message,
    );
    expect(view.getByText("read-only")).toBeTruthy();
    expect(mounts).toBe(1);

    // The relinked record's store now answers for this document.
    const replacement = client.documents.open({
      documentId: "replacement-remote-note",
      localId: "replacement-note",
    });
    expect(replacement).not.toBe(store);
    const resolve = spyOn(Sdk, "getOrCreateDocumentStore").mockReturnValue(
      replacement,
    );
    try {
      await act(async () => {
        fireEvent.click(
          view.getByRole("button", { name: DOCUMENT_RELINKED_LABELS.reopen }),
        );
      });
    } finally {
      resolve.mockRestore();
    }
    // Reopening remounts the view on the store resolved again.
    expect(mounts).toBe(2);
    expect(stores.at(-1)).toBe(replacement);
    expect(view.queryByRole("status")).toBeNull();
    expect(view.getByText("editable")).toBeTruthy();
  } finally {
    runtime.mockRestore();
    sdk.mockRestore();
  }
});
