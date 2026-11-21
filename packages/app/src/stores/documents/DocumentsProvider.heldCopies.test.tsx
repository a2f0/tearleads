import { afterEach, expect, spyOn, test } from "bun:test";
import * as Sdk from "@tearleads/client-sdk";
import { createMemoryBlobStore, Tearleads } from "@tearleads/client-sdk";
import { cleanup, render } from "@testing-library/react";
import * as SdkProvider from "../../providers/sdk/TearleadsProvider";
import { DocumentsProvider } from "./DocumentsProvider";

afterEach(cleanup);

test("opening a document checks its held attachment files", () => {
  const client = new Tearleads({ blobStore: createMemoryBlobStore() });
  client.network.setOnline(false);
  const sdk = spyOn(SdkProvider, "useTearleads").mockReturnValue(client);
  const input = client.runtime.input();
  const runtime = spyOn(SdkProvider, "useTearleadsRuntime").mockReturnValue({
    ...input,
    auth: { ...input.auth, authToken: null },
    infra: { ...input.infra, dbId: null },
  });
  const store = client.documents.open({
    documentId: "remote-note",
    localId: "held-note",
  });
  const check = spyOn(store, "checkHeldAttachments");
  const resolve = spyOn(Sdk, "getOrCreateDocumentStore").mockReturnValue(store);
  const open = () => (
    <DocumentsProvider localId="held-note" documentId="remote-note">
      <p>note</p>
    </DocumentsProvider>
  );
  try {
    const view = render(open());
    view.rerender(open());
    // First access, not every render: the store checks each copy once.
    expect(check).toHaveBeenCalledTimes(1);
  } finally {
    resolve.mockRestore();
    check.mockRestore();
    runtime.mockRestore();
    sdk.mockRestore();
  }
});
