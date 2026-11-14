import { expect, spyOn, test } from "bun:test";
import { createMemoryBlobStore, Tearleads } from "@tearleads/client-sdk";
import { act, renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { prepareAddressAuthor } from "../../../test/helpers/contacts/contactAddressAuthorHarness";
import {
  createAddressRetryHarness,
  retryFields,
} from "../../../test/helpers/contacts/contactAddressRetryHarness";
import { useContactDocumentAddresses } from "../../document-types/contact/useContactDocumentAddresses";
import * as SdkProvider from "../../providers/sdk/TearleadsProvider";
import { DocumentsProvider, useDocument } from "./DocumentsProvider";

test("document provider adopts an author without render-phase subscriber updates", async () => {
  const f = await createAddressRetryHarness("contacts");
  const client = new Tearleads({ blobStore: createMemoryBlobStore() });
  client.network.setOnline(false);
  const identity = await prepareAddressAuthor(f);
  let documents = identity.runtimeFor(null);
  const input = client.runtime.input();
  let runtime: SdkProvider.RuntimeSnapshot = {
    ...input,
    auth: { ...documents.auth, authToken: null },
    infra: { ...input.infra, dbId: "provider-author-test" },
  };
  // Only substitute the host runtime inputs. The real provider, public SDK
  // store factory, subscriptions and SQLite persistence remain intact.
  const sdk = spyOn(SdkProvider, "useTearleads").mockReturnValue(client);
  const runtimeHook = spyOn(
    SdkProvider,
    "useTearleadsRuntime",
  ).mockImplementation(() => runtime);
  const workflow = spyOn(
    client.documents,
    "workflowRuntime",
  ).mockImplementation(() => documents);
  const diagnostics: string[] = [];
  const logError = console.error.bind(console);
  const consoleError = spyOn(console, "error").mockImplementation((...args) => {
    diagnostics.push(args.map(String).join(" "));
    logError(...args);
  });
  const view = renderHook(
    () => ({ document: useDocument(), ...useContactDocumentAddresses() }),
    {
      wrapper: ({ children }: PropsWithChildren) => (
        <DocumentsProvider
          localId={f.contactId}
          containerId="contacts"
          initialDocumentKind="contact"
        >
          {children}
        </DocumentsProvider>
      ),
    },
  );
  try {
    expect(view.result.current.document.currentAuthorId).toBeNull();
    const oldActions = view.result.current.actions;
    documents = identity.runtimeFor("provider-author");
    runtime = { ...runtime, auth: { ...documents.auth, authToken: null } };
    view.rerender();
    expect(
      diagnostics.filter((line) =>
        /Cannot update .*while rendering/.test(line),
      ),
    ).toEqual([]);
    expect(view.result.current.document.currentAuthorId).toBe(
      "provider-author",
    );
    const refused = await oldActions.onAddAddress(retryFields).then(
      () => null,
      (error: unknown) => error,
    );
    expect(refused).toBeInstanceOf(Error);
    expect((await f.reopen()).rows).toEqual([]);
    let id: string | null = null;
    await act(async () => {
      id = await view.result.current.actions.onAddAddress(retryFields);
    });
    expect(id).not.toBeNull();
    expect((await f.reopen()).rows).toEqual([
      expect.objectContaining({ id, createdBy: "provider-author" }),
    ]);
  } finally {
    view.unmount();
    consoleError.mockRestore();
    workflow.mockRestore();
    runtimeHook.mockRestore();
    sdk.mockRestore();
    client.dispose();
    f.close();
  }
});
